import type { Env } from "./types";

/**
 * Row-Level Security (RLS) for cross-user data sharing
 * 
 * Ownership model:
 * - Resources (sessions, memories) stored with owner_id in metadata
 * - Access grants stored in CONFIG KV
 * - Simple prefix: "access:{resource_type}:{resource_id}:{user_id}"
 */

export interface AccessGrant {
  grant_id: string;         // "access:memory:telegram:123:fact:telegram:456"
  resource_type: "session" | "memory";
  resource_id: string;      // "telegram:123" or "telegram:123:fact_name"
  owner_id: string;         // "telegram:123"
  granted_to: string;       // "telegram:456"
  permission: "read" | "write";
  granted_at: number;
  expires_at?: number;
}

export interface ResourceMetadata {
  owner_id: string;
  resource_type: "session" | "memory";
  resource_id: string;
  created_at: number;
}

/**
 * Create ownership metadata for a resource
 */
export async function createOwnership(
  env: Env,
  resourceType: "session" | "memory",
  resourceId: string,
  ownerId: string
): Promise<void> {
  const meta: ResourceMetadata = {
    owner_id: ownerId,
    resource_type: resourceType,
    resource_id: resourceId,
    created_at: Date.now(),
  };
  
  const metaKey = `meta:${resourceType}:${resourceId}`;
  await env.CONFIG.put(metaKey, JSON.stringify(meta));
}

/**
 * Get owner of a resource
 */
export async function getOwner(
  env: Env,
  resourceType: "session" | "memory",
  resourceId: string
): Promise<string | null> {
  const metaKey = `meta:${resourceType}:${resourceId}`;
  const meta = await env.CONFIG.get(metaKey, "json") as ResourceMetadata | null;
  return meta?.owner_id || null;
}

/**
 * Check if user has access to resource
 */
export async function checkAccess(
  env: Env,
  userId: string,
  resourceType: "session" | "memory",
  resourceId: string
): Promise<{ canRead: boolean; canWrite: boolean; isOwner: boolean }> {
  // Get owner
  const ownerId = await getOwner(env, resourceType, resourceId);
  
  // No metadata = not created yet, allow first user to be owner
  if (!ownerId) {
    return { canRead: true, canWrite: true, isOwner: true };
  }
  
  // Owner has full access
  if (ownerId === userId) {
    return { canRead: true, canWrite: true, isOwner: true };
  }
  
  // Check for access grant
  const grantKey = `access:${resourceType}:${resourceId}:${userId}`;
  const grant = await env.CONFIG.get(grantKey, "json") as AccessGrant | null;
  
  if (!grant) {
    return { canRead: false, canWrite: false, isOwner: false };
  }
  
  // Check expiration
  if (grant.expires_at && grant.expires_at < Date.now()) {
    await env.CONFIG.delete(grantKey);
    return { canRead: false, canWrite: false, isOwner: false };
  }
  
  return {
    canRead: grant.permission === "read" || grant.permission === "write",
    canWrite: grant.permission === "write",
    isOwner: false
  };
}

/**
 * Grant access to a user
 */
export async function grantAccess(
  env: Env,
  resourceType: "session" | "memory",
  resourceId: string,
  requestorId: string,
  targetUserId: string,
  permission: "read" | "write",
  expiresInDays?: number
): Promise<void> {
  // Verify requestor is owner
  const { isOwner } = await checkAccess(env, requestorId, resourceType, resourceId);
  if (!isOwner) {
    throw new Error("Only owner can grant access");
  }
  
  const grant: AccessGrant = {
    grant_id: `access:${resourceType}:${resourceId}:${targetUserId}`,
    resource_type: resourceType,
    resource_id: resourceId,
    owner_id: requestorId,
    granted_to: targetUserId,
    permission,
    granted_at: Date.now(),
    expires_at: expiresInDays ? Date.now() + expiresInDays * 24 * 60 * 60 * 1000 : undefined,
  };
  
  const grantKey = `access:${resourceType}:${resourceId}:${targetUserId}`;
  await env.CONFIG.put(grantKey, JSON.stringify(grant), {
    expirationTtl: expiresInDays ? expiresInDays * 24 * 60 * 60 : undefined
  });
}

/**
 * Revoke access by grant ID (simple version for commands)
 */
export async function revokeAccessByGrantId(env: Env, grantId: string): Promise<boolean> {
  try {
    const grant = await env.CONFIG.get(`grant:${grantId}`, "json") as AccessGrant | null;
    if (!grant) return false;
    
    const grantKey = `access:${grant.resource_type}:${grant.resource_id}:${grant.granted_to}`;
    await env.CONFIG.delete(grantKey);
    await env.CONFIG.delete(`grant:${grantId}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Revoke access (full version - only owner can call)
 */
export async function revokeAccess(
  env: Env,
  resourceType: "session" | "memory",
  resourceId: string,
  requestorId: string,
  targetUserId: string
): Promise<void> {
  const { isOwner } = await checkAccess(env, requestorId, resourceType, resourceId);
  if (!isOwner) {
    throw new Error("Only owner can revoke access");
  }
  
  const grantKey = `access:${resourceType}:${resourceId}:${targetUserId}`;
  await env.CONFIG.delete(grantKey);
}

/**
 * List all grants for a resource
 */
export async function listResourceGrants(
  env: Env,
  resourceType: "session" | "memory",
  resourceId: string,
  requestorId: string
): Promise<AccessGrant[]> {
  const { isOwner } = await checkAccess(env, requestorId, resourceType, resourceId);
  if (!isOwner) {
    throw new Error("Only owner can list grants");
  }
  
  const prefix = `access:${resourceType}:${resourceId}:`;
  const list = await env.CONFIG.list({ prefix });
  
  const grants: AccessGrant[] = [];
  for (const key of list.keys) {
    const grant = await env.CONFIG.get(key.name, "json") as AccessGrant;
    if (grant) grants.push(grant);
  }
  
  return grants;
}

// Add missing listGrantsForOwner and listGrantsForRecipient functions
export async function listGrantsForOwner(env: Env, ownerId: string): Promise<AccessGrant[]> {
  const list = await env.CONFIG.list({ prefix: `grant_by_owner:${ownerId}:`, limit: 100 });
  const grants: AccessGrant[] = [];
  for (const key of list.keys) {
    const raw = await env.CONFIG.get(key.name, "json");
    if (raw) grants.push(raw as AccessGrant);
  }
  return grants;
}

export async function listGrantsForRecipient(env: Env, recipientId: string): Promise<AccessGrant[]> {
  const list = await env.CONFIG.list({ prefix: `grant_by_recipient:${recipientId}:`, limit: 100 });
  const grants: AccessGrant[] = [];
  for (const key of list.keys) {
    const raw = await env.CONFIG.get(key.name, "json");
    if (raw) grants.push(raw as AccessGrant);
  }
  return grants;
}

export async function listGrants(env: Env, userId: string): Promise<{
  owned: AccessGrant[];
  received: AccessGrant[];
}> {
  const owned = await listGrantsForOwner(env, userId);
  const received = await listGrantsForRecipient(env, userId);
  return { owned, received };
}
