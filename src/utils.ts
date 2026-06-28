import type { Env } from "./types";

/**
 * Check if a user is allowed to use the bot.
 * Supports channel-prefixed IDs (e.g. telegram:123) for isolation.
 * 
 * @param env - Environment with ALLOWED_USERS config
 * @param userId - User ID (should be channel-prefixed: "telegram:123")
 * @returns true if user is allowed or if allowlist is not configured
 */
export async function checkAllowed(env: Env, userId: string): Promise<boolean> {
  // If no allowlist configured, allow everyone
  if (!env.ALLOWED_USERS) return true;
  
  // Parse allowlist (comma-separated: "telegram:123")
  const allowed = env.ALLOWED_USERS.split(",")
    .map(id => id.trim())
    .filter(id => id.length > 0);
  
  // Check if user is in the allowlist
  return allowed.includes(userId);
}

