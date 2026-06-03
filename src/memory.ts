import type { KVNamespace } from "@cloudflare/workers-types";
import type { SessionState, Message } from "./types";

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const MAX_MESSAGES = 50;
const MEMORY_TTL = 60 * 60 * 24 * 30; // 30 days

export function createSession(sessionId: string): SessionState {
  return {
    sessionId,
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
export async function saveMemory(kv: KVNamespace, sessionId: string, key: string, value: string): Promise<void> {
  await kv.put(`memory:${sessionId}:${key}`, value, { expirationTtl: MEMORY_TTL });
}

// Get memory context for a session (recent memories)
export async function getMemory(kv: KVNamespace, sessionId: string): Promise<string | null> {
  const list = await kv.list({ prefix: `memory:${sessionId}:`, limit: 20 });
  if (list.keys.length === 0) return null;

  const memories: string[] = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name);
    if (val) memories.push(val);
  }

  return memories.length > 0 ? memories.join("\n") : null;
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
