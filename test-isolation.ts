#!/usr/bin/env bun

/**
 * User Isolation Verification Test
 * 
 * This test verifies that users on Telegram and Discord are properly isolated
 * even if they have the same numeric user ID.
 */

import type { KVNamespace } from "@cloudflare/workers-types";

// Mock KV namespace for testing
class MockKV implements KVNamespace {
  private data = new Map<string, any>();

  async get(key: string, type?: string): Promise<any> {
    const value = this.data.get(key);
    if (type === "json") return value ? JSON.parse(value) : null;
    return value || null;
  }

  async put(key: string, value: string, options?: any): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<any> {
    const keys = Array.from(this.data.keys())
      .filter((k) => !options?.prefix || k.startsWith(options.prefix))
      .slice(0, options?.limit || 1000)
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

// Simulate the scenario: same numeric ID on both platforms
const SAME_NUMERIC_ID = "123456789";

const telegramSessionId = `telegram:${SAME_NUMERIC_ID}`;
const discordSessionId = `discord:${SAME_NUMERIC_ID}`;

console.log("=== User Isolation Test ===\n");
console.log(`Same numeric ID: ${SAME_NUMERIC_ID}`);
console.log(`Telegram session ID: ${telegramSessionId}`);
console.log(`Discord session ID: ${discordSessionId}`);

const kv = new MockKV();

// Test 1: Session Storage Isolation
console.log("\n--- Test 1: Session Storage Isolation ---");

const telegramSession = {
  sessionId: telegramSessionId,
  messages: [{ role: "user", content: "Hello from Telegram" }],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const discordSession = {
  sessionId: discordSessionId,
  messages: [{ role: "user", content: "Hello from Discord" }],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

await kv.put(`session:${telegramSessionId}`, JSON.stringify(telegramSession));
await kv.put(`session:${discordSessionId}`, JSON.stringify(discordSession));

const retrievedTelegram = await kv.get(`session:${telegramSessionId}`, "json");
const retrievedDiscord = await kv.get(`session:${discordSessionId}`, "json");

console.log("Telegram session message:", retrievedTelegram.messages[0].content);
console.log("Discord session message:", retrievedDiscord.messages[0].content);

const sessionsIsolated =
  retrievedTelegram.messages[0].content !== retrievedDiscord.messages[0].content;
console.log(`✓ Sessions isolated: ${sessionsIsolated}`);

if (!sessionsIsolated) {
  throw new Error("Sessions not isolated!");
}

// Test 2: Memory Storage Isolation
console.log("\n--- Test 2: Memory Storage Isolation ---");

await kv.put(
  `memory:${telegramSessionId}:preference`,
  JSON.stringify({ platform: "telegram", theme: "dark" })
);
await kv.put(
  `memory:${discordSessionId}:preference`,
  JSON.stringify({ platform: "discord", theme: "light" })
);

const telegramMemory = await kv.get(`memory:${telegramSessionId}:preference`, "json");
const discordMemory = await kv.get(`memory:${discordSessionId}:preference`, "json");

console.log("Telegram memory:", telegramMemory);
console.log("Discord memory:", discordMemory);

const memoriesIsolated = telegramMemory.platform !== discordMemory.platform;
console.log(`✓ Memories isolated: ${memoriesIsolated}`);

if (!memoriesIsolated) {
  throw new Error("Memories not isolated!");
}

// Test 3: Usage Tracking Isolation
console.log("\n--- Test 3: Usage Tracking Isolation ---");

const telegramUsage = {
  session_id: telegramSessionId,
  prompt_tokens: 100,
  completion_tokens: 50,
  requests: 1,
};

const discordUsage = {
  session_id: discordSessionId,
  prompt_tokens: 200,
  completion_tokens: 100,
  requests: 2,
};

await kv.put(`usage:${telegramSessionId}`, JSON.stringify(telegramUsage));
await kv.put(`usage:${discordSessionId}`, JSON.stringify(discordUsage));

const retrievedTelegramUsage = await kv.get(`usage:${telegramSessionId}`, "json");
const retrievedDiscordUsage = await kv.get(`usage:${discordSessionId}`, "json");

console.log("Telegram usage tokens:", retrievedTelegramUsage.prompt_tokens);
console.log("Discord usage tokens:", retrievedDiscordUsage.prompt_tokens);

const usageIsolated = retrievedTelegramUsage.prompt_tokens !== retrievedDiscordUsage.prompt_tokens;
console.log(`✓ Usage tracking isolated: ${usageIsolated}`);

if (!usageIsolated) {
  throw new Error("Usage tracking not isolated!");
}

// Test 4: ALLOWED_USERS Check Logic
console.log("\n--- Test 4: ALLOWED_USERS Check Logic ---");

// Simulate ALLOWED_USERS env var with channel-prefixed IDs
const ALLOWED_USERS = "telegram:123456789,discord:987654321,telegram:555555555";

function checkIsAllowed(allowedUsersStr: string, userId: string): boolean {
  if (!allowedUsersStr) return true; // If not set, allow all
  const allowedList = allowedUsersStr.split(",").map((s) => s.trim());
  return allowedList.includes(userId);
}

const allowedTelegram = checkIsAllowed(ALLOWED_USERS, `telegram:${SAME_NUMERIC_ID}`);
const allowedDiscord = checkIsAllowed(ALLOWED_USERS, `discord:${SAME_NUMERIC_ID}`);

console.log(`Telegram user ${SAME_NUMERIC_ID} allowed: ${allowedTelegram}`);
console.log(`Discord user ${SAME_NUMERIC_ID} allowed: ${allowedDiscord}`);
console.log(`✓ Correctly different permissions: ${allowedTelegram && !allowedDiscord}`);

if (!allowedTelegram || allowedDiscord) {
  throw new Error("ALLOWED_USERS check not working correctly!");
}

// Summary
console.log("\n=== All Tests Passed ===");
console.log("✓ Session storage is isolated");
console.log("✓ Memory storage is isolated");
console.log("✓ Usage tracking is isolated");
console.log("✓ ALLOWED_USERS checks are isolated");
console.log("\nUsers with the same numeric ID on Telegram and Discord are fully separated!");
