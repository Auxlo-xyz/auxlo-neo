import type { Env } from "./types";
import { checkAccess, createOwnership, grantAccess, revokeAccess } from "./rls";

/**
 * Example: How to use RLS in AuxloNeo
 * 
 * This shows how User A can share data with User B
 */

// Example 1: Create a shared memory
export async function example_createSharedMemory(env: Env) {
  const ownerUserId = "telegram:123";  // User A
  const targetUserId = "telegram:456";  // User B
  const sessionId = "telegram:123";
  const memoryKey = "shared_project_notes";
  
  // Step 1: Owner creates the memory
  const memoryValue = "Project deadline: Jan 15";
  await env.MEMORY.put(
    `memory:${sessionId}:${memoryKey}`,
    JSON.stringify({ owner_id: ownerUserId, value: memoryValue }),
    { expirationTtl: 30 * 24 * 60 * 60 }
  );
  
  // Step 2: Create ownership metadata
  await createOwnership(env, "memory", `${sessionId}:${memoryKey}`, ownerUserId);
  
  // Step 3: Grant read access to User B
  await grantAccess(
    env,
    "memory",
    `${sessionId}:${memoryKey}`,
    ownerUserId,
    targetUserId,
    "read",
    7  // 7 days
  );
}

// Example 2: User B reads User A's shared memory
export async function example_readSharedMemory(env: Env) {
  const userId = "telegram:456";  // User B
  const sessionId = "telegram:123";  // User A's session
  const memoryKey = "shared_project_notes";
  
  // Check if User B has access
  const { canRead } = await checkAccess(env, userId, "memory", `${sessionId}:${memoryKey}`);
  
  if (!canRead) {
    throw new Error("Access denied");
  }
  
  // Read the memory
  const data = await env.MEMORY.get(`memory:${sessionId}:${memoryKey}`, "json");
  console.log("Shared memory:", data);
}

// Example 3: User A shares entire session with User B
export async function example_shareSession(env: Env) {
  const ownerUserId = "telegram:123";  // User A
  const targetUserId = "telegram:456";  // User B
  const sessionId = "telegram:123";
  
  // Create ownership for the session
  await createOwnership(env, "session", sessionId, ownerUserId);
  
  // Grant write access (User B can add messages to User A's session)
  await grantAccess(
    env,
    "session",
    sessionId,
    ownerUserId,
    targetUserId,
    "write",
    1  // 1 day
  );
}

// Example 4: User B sends message to User A's session
export async function example_writeToSharedSession(env: Env) {
  const userId = "telegram:456";  // User B
  const sessionId = "telegram:123";  // User A's session
  
  // Check write access
  const { canWrite } = await checkAccess(env, userId, "session", sessionId);
  
  if (!canWrite) {
    throw new Error("No write access to this session");
  }
  
  // Add message
  const { saveSession, getSession } = await import("./memory");
  const session = await getSession(env.SESSIONS, sessionId);
  
  if (session) {
    session.messages.push({
      role: "user",
      content: "Hi from User B!"
    });
    
    await saveSession(env.SESSIONS, sessionId, session);
  }
}

// Real implementation: Add RLS check before reading memory
export async function getMemoryWithRLS(
  env: Env,
  userId: string,
  sessionId: string
): Promise<string | null> {
  // Check if user owns this session
  const { canRead } = await checkAccess(env, userId, "session", sessionId);
  
  if (!canRead) {
    // Try to read individual memories with grants
    const list = await env.MEMORY.list({ prefix: `memory:${sessionId}:`, limit: 20 });
    const accessibleMemories: string[] = [];
    
    for (const key of list.keys) {
      const memoryKey = key.name.split(":").slice(2).join(":");
      const { canRead: canReadMemory } = await checkAccess(env, userId, "memory", `${sessionId}:${memoryKey}`);
      
      if (canReadMemory) {
        const val = await env.MEMORY.get(key.name);
        if (val) accessibleMemories.push(val);
      }
    }
    
    return accessibleMemories.length > 0 ? accessibleMemories.join("\n") : null;
  }
  
  // User has full access, return all
  const { getMemory } = await import("./memory");
  return await getMemory(env.MEMORY, sessionId);
}
