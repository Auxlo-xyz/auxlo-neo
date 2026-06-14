import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env, SessionState, Message, SessionGrant } from "./types";

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

export async function getSession(kv: KVNamespace, sessionId: string): Promise<SessionState | null> {
  const raw = await kv.get(`session:${sessionId}`, "json");
  return raw as SessionState | null;
}

export async function saveSession(kv: KVNamespace, sessionId: string, session: SessionState): Promise<void> {
  // Ensure owner_id is set
  if (!session.owner_id) {
    session.owner_id = sessionId;
  }
  await kv.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
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

// Save a fact/memory to KV for cross-session recall
export async function saveMemory(kv: KVNamespace, sessionId: string, key: string, value: string, requesterId?: string, env?: Env): Promise<void> {
  if (requesterId && env) {
    const session = await getSession(kv, sessionId);
    const ownerId = session?.owner_id || sessionId;
    if (requesterId !== ownerId) {
      console.error(`[RLS] Memory write denied: ${requesterId} -> ${sessionId}`);
      return;
    }
  }
  await kv.put(`memory:${sessionId}:${key}`, value, { expirationTtl: MEMORY_TTL });
}

// Get memory context for a session (recent memories)
export async function getMemory(kv: KVNamespace, sessionId: string, requesterId?: string, env?: Env): Promise<string | null> {
  if (requesterId && env) {
    const session = await getSession(kv, sessionId);
    const ownerId = session?.owner_id || sessionId;
    if (requesterId !== ownerId) {
      console.error(`[RLS] Memory read denied: ${requesterId} -> ${sessionId}`);
      return null;
    }
  }
  const list = await kv.list({ prefix: `memory:${sessionId}:`, limit: 20 });
  if (list.keys.length === 0) return null;

  const memories: string[] = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name);
    if (val) memories.push(val);
  }

  return memories.length > 0 ? memories.join("\n") : null;
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
  const session = await getSession(env.SESSIONS, sessionId);
  
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
  kv: KVNamespace,
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
  
  await saveSession(kv, sessionId, session);
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
  kv: KVNamespace,
  sessionId: string,
  usage: { prompt_tokens?: number; completion_tokens?: number },
  model?: string,
  provider?: string
): Promise<void> {
  const key = "usage:" + sessionId;
  const raw = await kv.get(key, "json");
  const stats: UsageStats = raw
    ? (raw as UsageStats)
    : { session_id: sessionId, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, last_updated: 0 };

  stats.prompt_tokens += usage.prompt_tokens || 0;
  stats.completion_tokens += usage.completion_tokens || 0;
  stats.total_tokens += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  stats.requests += 1;
  stats.last_model = model || stats.last_model;
  stats.last_provider = provider || stats.last_provider;
  stats.last_updated = Date.now();

  await kv.put(key, JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 90 });
}

export async function getUsage(kv: KVNamespace, sessionId: string): Promise<UsageStats | null> {
  const raw = await kv.get("usage:" + sessionId, "json");
  return raw as UsageStats | null;
}

/**
 * Save a trading lesson for a user.
 * Uses userId for cross-session persistence, falls back to sessionId.
 */
export async function saveTradingLesson(
  kv: KVNamespace,
  userId: string | undefined,
  sessionId: string,
  lesson: { verdict: string; lesson: string; score: number; timestamp: number }
): Promise<void> {
  const keyPrefix = userId ? `lesson:${userId}` : `lesson:${sessionId}`;
  const key = `${keyPrefix}:${Date.now()}`;
  await kv.put(key, JSON.stringify(lesson), { expirationTtl: MEMORY_TTL });
}

/**
 * Get recent trading lessons for a user.
 */
export async function getTradingLessons(
  kv: KVNamespace,
  userId: string | undefined,
  sessionId: string,
  limit: number = 5
): Promise<Array<{ verdict: string; lesson: string; score: number }>> {
  const keyPrefix = userId ? `lesson:${userId}` : `lesson:${sessionId}`;
  const list = await kv.list({ prefix: keyPrefix, limit });
  
  if (list.keys.length === 0) return [];

  const lessons: any[] = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name);
    if (val) {
      const l = JSON.parse(val);
      lessons.push({
        verdict: l.verdict,
        lesson: l.lesson,
        score: l.score,
      });
    }
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