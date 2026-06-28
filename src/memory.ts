import type { KVNamespace, D1Database } from "@cloudflare/workers-types";
import type { Env, SessionState, Message, SessionGrant } from "./types";
import { StorageService } from "./storage";

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const MAX_MESSAGES = 50;
const MEMORY_TTL = 60 * 60 * 24 * 30; // 30 days

export function createSession(sessionId: string, ownerId?: string): SessionState {
  return {
    sessionId,
    owner_id: ownerId || sessionId.split(":")[0] + ":" + sessionId.split(":")[1], // Default to channel:user format
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function getSession(db: D1Database, sessionId: string): Promise<SessionState | null> {
  const row = await db.prepare(
    "SELECT session_data FROM sessions WHERE session_id = ? LIMIT 1"
  )
  .bind(sessionId)
  .first<{ session_data: string }>();

  if (!row) return null;
  try {
    return JSON.parse(row.session_data) as SessionState;
  } catch {
    return null;
  }
}

export async function saveSession(db: D1Database, sessionId: string, session: SessionState): Promise<void> {
  if (!session.owner_id) {
    session.owner_id = sessionId;
  }
  const now = Date.now();
  session.updatedAt = now;

  await db.prepare(
    "INSERT INTO sessions (session_id, owner_id, session_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(session_id) DO UPDATE SET session_data = excluded.session_data, updated_at = excluded.updated_at"
  )
  .bind(sessionId, session.owner_id, JSON.stringify(session), session.createdAt || now, now)
  .run();
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE session_id = ?").bind(sessionId).run();
}

export function addMessage(session: SessionState, message: Message): void {
  session.messages.push(message);
  trimSession(session);
}

export function trimSession(session: SessionState): void {
  if (session.messages.length <= MAX_MESSAGES) return;

  // Keep the first message (system context) and the last MAX_MESSAGES messages
  const system = session.messages.filter((m) => m.role === "system");
  const nonSystem = session.messages.filter((m) => m.role !== "system");

  // Keep the most recent non-system messages
  const kept = nonSystem.slice(-MAX_MESSAGES);
  session.messages = [...system, ...kept];
}

// ==================== RLS-Protected Functions ====================

export interface AccessGrant {
  resource_type: "session" | "memory" | "usage";
  resource_id: string;
  owner_id: string;
  granted_to: string;
  permission: "read" | "write" | "admin";
  granted_at: number;
  expires_at?: number;
}

/**
 * Check if a user has explicit access grant to a resource
 */
async function checkSessionAccess(
  env: Env,
  resourceId: string,
  requesterId: string
): Promise<boolean> {
  const grantKey = `grant:${resourceId}:${requesterId}`;
  const grant = await env.CONFIG.get(grantKey, "json") as { expires_at?: number } | null;
  
  if (!grant) return false;
  
  // Check expiration
  if (grant.expires_at && grant.expires_at < Date.now()) {
    await env.CONFIG.delete(grantKey);
    return false;
  }
  
  return true;
}

/**
 * RLS-protected session getter
 * - Owners always have access
 * - Non-owners must have explicit grant
 * - Throws on unauthorized access
 */
export async function getSessionWithRLS(
  env: Env,
  sessionId: string,
  requesterId: string,
  permission: "read" | "write" = "read"
): Promise<SessionState | null> {
  const session = await getSession(env.DB, sessionId);
  
  if (!session) return null;
  
  // Extract owner from session or infer from sessionId
  const ownerId = session.owner_id || sessionId;
  
  // Owner always has access
  if (requesterId === ownerId) {
    return session;
  }
  
  // Check for explicit grant
  const hasAccess = await checkSessionAccess(env, sessionId, requesterId);
  
  if (!hasAccess) {
    console.error(`[RLS] Access denied: ${requesterId} -> ${sessionId}`);
    return null;
  }
  
  return session;
}

/**
 * RLS-protected session setter
 * - Only owners or users with write permission can save
 */
export async function saveSessionWithRLS(
  env: Env,
  sessionId: string,
  session: SessionState,
  requesterId: string,
  permission: "write" | "admin" = "write"
): Promise<void> {
  const ownerId = session.owner_id || sessionId;
  
  // Owner can always save
  if (requesterId !== ownerId) {
    // Non-owner would need write grant check here
    // For now, we enforce owner-only writes for simplicity
    console.error(`[RLS] Write denied: ${requesterId} -> ${sessionId}`);
    return;
  }
  
  await saveSession(env.DB, sessionId, session);
}

// ---- Usage tracking ----

export interface UsageStats {
  session_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  requests: number;
  last_model?: string;
  last_provider?: string;
  last_updated: number;
}

export async function trackUsage(
  db: D1Database,
  sessionId: string,
  usage: { prompt_tokens?: number; completion_tokens?: number },
  model?: string,
  provider?: string
): Promise<void> {
  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  const total = prompt + completion;
  const now = Date.now();

  await db.prepare(
    "INSERT INTO usage_stats (session_id, prompt_tokens, completion_tokens, total_tokens, requests, last_model, last_provider, last_updated) VALUES (?, ?, ?, ?, 1, ?, ?, ?) " +
    "ON CONFLICT(session_id) DO UPDATE SET " +
    "prompt_tokens = prompt_tokens + excluded.prompt_tokens, " +
    "completion_tokens = completion_tokens + excluded.completion_tokens, " +
    "total_tokens = total_tokens + excluded.total_tokens, " +
    "requests = requests + 1, " +
    "last_model = COALESCE(excluded.last_model, last_model), " +
    "last_provider = COALESCE(excluded.last_provider, last_provider), " +
    "last_updated = excluded.last_updated"
  )
  .bind(sessionId, prompt, completion, total, model || null, provider || null, now)
  .run();
}

export async function getUsage(db: D1Database, sessionId: string): Promise<UsageStats | null> {
  const row = await db.prepare(
    "SELECT * FROM usage_stats WHERE session_id = ? LIMIT 1"
  )
  .bind(sessionId)
  .first<UsageStats>();

  return row || null;
}

/**
 * Save a trading lesson for a user.
 * Uses userId for cross-session persistence, falls back to sessionId.
 */
export async function saveTradingLesson(
  env: Env,
  userId: string | undefined,
  sessionId: string,
  lesson: { verdict: string; lesson: string; score: number; timestamp: number }
): Promise<void> {
  const storage = new StorageService(env);
  const ownerId = userId
    ? (userId.includes(":") ? userId.split(":")[1] : userId)
    : (sessionId.includes(":") ? sessionId.split(":")[1] : sessionId);
  const key = `lesson:${lesson.verdict.toLowerCase()}:${Date.now()}`;
  await storage.saveMemory(ownerId, key, JSON.stringify(lesson));
}

/**
 * Get recent trading lessons for a user.
 */
export async function getTradingLessons(
  env: Env,
  userId: string | undefined,
  sessionId: string,
  limit: number = 5
): Promise<Array<{ verdict: string; lesson: string; score: number }>> {
  const storage = new StorageService(env);
  const ownerId = userId
    ? (userId.includes(":") ? userId.split(":")[1] : userId)
    : (sessionId.includes(":") ? sessionId.split(":")[1] : sessionId);
  const raw = await storage.getMemories(ownerId, "lesson:");
  const lessons: Array<{ verdict: string; lesson: string; score: number }> = [];
  for (const m of raw.slice(0, limit)) {
    try {
      lessons.push(JSON.parse(m.value));
    } catch { /* skip malformed */ }
  }
  return lessons;
}

export async function revokeAccess(env: Env, grantId: string): Promise<boolean> {
  const grant = await env.CONFIG.get(`grant:${grantId}`, "json") as AccessGrant | null;
  if (!grant) return false;
  
  await env.CONFIG.delete(`grant:${grantId}`);
  return true;
}

export async function saveSessionGrant(env: Env, userId: string, grant: SessionGrant): Promise<void> {
  await env.CONFIG.put(`grant_session:${userId}`, JSON.stringify(grant));
}

export async function getSessionGrant(env: Env, userId: string): Promise<SessionGrant | null> {
  const raw = await env.CONFIG.get(`grant_session:${userId}`, "json");
  return raw as SessionGrant | null;
}

export async function updateSessionVolume(env: Env, userId: string, amountUsd: number): Promise<void> {
  const grant = await getSessionGrant(env, userId);
  if (grant) {
    grant.currentVolumeUsd += amountUsd;
    await saveSessionGrant(env, userId, grant);
  }
}