// RLS Implementation - Minimal Example
// This shows how to add RLS to the getSession/saveSession functions

import type { Env } from "./types";
import { checkAccess, createOwnership, grantAccess, revokeAccess, listGrants } from "./rls";

/**
 * Grant database helper functions
 */

// Export for use in channels
export async function grantSessionAccess(
  env: Env,
  resourceId: string,
  ownerId: string
): Promise<void> {
  // Implementation for channels
}

// Example: Modified getSession with RLS check
export async function getSessionWithRLS(
  env: Env,
  sessionId: string,
  requesterId: string
): Promise<{ data: any; error?: string }> {
  
  // 1. Load session
  const raw = await env.SESSIONS.get(`session:${sessionId}`, "json");
  if (!raw) return { data: null, error: "Session not found" };
  
  const session = raw as any;
  
  // 2. Check ownership
  if (session.owner_id === requesterId) {
    return { data: session }; // Owner has full access
  }
  
  // 3. Check access grant
  const grantKey = `grant:session:${sessionId}:${requesterId}`;
  const grant = await env.CONFIG.get(grantKey, "json") as any;
  
  if (!grant) {
    return { data: null, error: "Access denied" };
  }
  
  // 4. Check expiration
  if (grant.expires_at && Date.now() > grant.expires_at) {
    return { data: null, error: "Access expired" };
  }
  
  // 5. Check permission level
  if (grant.permission === "read") {
    // Return read-only view
    return { 
      data: {
        ...session,
        _readonly: true,
        _permission: "read"
      }
    };
  }
  
  if (grant.permission === "write") {
    return { data: session };
  }
  
  return { data: null, error: "Invalid permission" };
}

// Example: Modified saveSession with RLS check
export async function saveSessionWithRLS(
  env: Env,
  sessionId: string,
  session: any,
  requesterId: string
): Promise<{ success: boolean; error?: string }> {
  
  // 1. Check if new session
  const existing = await env.SESSIONS.get(`session:${sessionId}`, "json");
  
  if (!existing) {
    // New session - set owner
    session.owner_id = requesterId;
    session.created_by = requesterId;
    await env.SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify(session),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
    return { success: true };
  }
  
  // 2. Existing session - check permissions
  const existingData = existing as any;
  
  // Owner can always save
  if (existingData.owner_id === requesterId) {
    await env.SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify(session),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
    return { success: true };
  }
  
  // Check grant
  const grantKey = `grant:session:${sessionId}:${requesterId}`;
  const grant = await env.CONFIG.get(grantKey, "json") as any;
  
  if (!grant) {
    return { success: false, error: "Access denied" };
  }
  
  // Check expiration
  if (grant.expires_at && Date.now() > grant.expires_at) {
    return { success: false, error: "Access expired" };
  }
  
  // Check permission
  if (grant.permission === "read") {
    return { success: false, error: "Read-only access" };
  }
  
  if (grant.permission === "write" || grant.permission === "admin") {
    await env.SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify(session),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
    return { success: true };
  }
  
  return { success: false, error: "Invalid permission" };
}

// Usage in agent.ts:
/*
// Before:
let session = await getSession(env.SESSIONS, sessionId);

// After:
const result = await getSessionWithRLS(env, sessionId, requesterId);
if (result.error) {
  return { content: `Error: ${result.error}` };
}
let session = result.data;

// Check if read-only
if (session._readonly) {
  // Can view but not modify
}
*/
