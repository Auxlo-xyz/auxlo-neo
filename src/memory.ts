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
