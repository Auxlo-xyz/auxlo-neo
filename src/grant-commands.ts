import type { Env } from "./types";
import { grantAccess, revokeAccessByGrantId, listGrantsForOwner, listGrantsForRecipient } from "./rls";

/**
 * Grant management commands
 */

export interface GrantCommandResult {
  success: boolean;
  message: string;
}

/**
 * Handle /grant command
 * 
 * Usage: /grant <userId> <resourceId> [permission] [days]
 * Example: /grant telegram:456 session:telegram:123 read 7
 */
export async function handleGrantCommand(
  env: Env,
  ownerId: string,
  args: string
): Promise<GrantCommandResult> {
  const parts = args.split(/\s+/);
  
  if (parts.length < 2) {
    return {
      success: false,
      message: `*Usage:* /grant <userId> <resourceId> [permission] [days]

*Examples:*
• \`/grant telegram:456 session:telegram:123\`
• \`/grant telegram:456 memory:telegram:123:preferences read 7\`

*Permissions:* read, write, admin (default: read)
*Days:* Optional expiry (default: 30 days)`,
    };
  }

  const recipientId = parts[0];
  const resourceId = parts[1];
  const permission = parts[2] || "read";
  const days = parts[3] ? parseInt(parts[3], 10) : 30;

  // Validate
  if (!recipientId.includes(":")) {
    return { success: false, message: "Invalid userId format. Use: telegram:123 or discord:456" };
  }

  if (!resourceId.includes(":")) {
    return { success: false, message: "Invalid resourceId format. Use: session:telegram:123" };
  }

  if (!["read", "write", "admin"].includes(permission)) {
    return { success: false, message: "Invalid permission. Use: read, write, or admin" };
  }

  if (days < 1 || days > 365) {
    return { success: false, message: "Days must be between 1 and 365" };
  }

  // Extract resource type from resourceId
  let resourceType: "session" | "memory";
  if (resourceId.startsWith("session:")) {
    resourceType = "session";
  } else if (resourceId.startsWith("memory:")) {
    resourceType = "memory";
  } else {
    return { success: false, message: "Invalid resourceId. Must start with session: or memory:" };
  }

  // Extract clean resource ID
  const resourceIdClean = resourceId.startsWith("session:") 
    ? resourceId.replace("session:", "") 
    : resourceId.startsWith("memory:")
    ? resourceId.replace("memory:", "")
    : resourceId;

  // Grant access
  await grantAccess(env, resourceType, resourceIdClean, ownerId, recipientId, permission as "read" | "write", days);
  
  // Generate a grant ID to return (for simplicity, use a simple format)
  const grantId = `grant_${ownerId}:${recipientId}:${resourceType}:${resourceIdClean}`;
  
  return {
    success: true,
    message: `✓ Access granted

*Recipient:* \`${recipientId}\`
*Resource:* \`${resourceId}\`
*Permission:* ${permission}
*Expires:* ${days} days
*Grant ID:* \`${grantId}\``,
  };
}

/**
 * Handle /revoke command
 * 
 * Usage: /revoke <grantId>
 * Example: /revoke grant_tel:123:tel:456:session:tel:123
 */
export async function handleRevokeCommand(
  env: Env,
  ownerId: string,
  args: string
): Promise<GrantCommandResult> {
  const grantId = args.trim();

  if (!grantId) {
    return {
      success: false,
      message: `*Usage:* /revoke <grantId>

Use /shares to see your grant IDs.`,
    };
  }

  const revoked = await revokeAccessByGrantId(env, grantId);
  
  if (revoked) {
    return { success: true, message: `✓ Access revoked: \`${grantId}\`` };
  } else {
    return { success: false, message: `Grant not found or already expired: \`${grantId}\`` };
  }
}

/**
 * Handle /shares command
 * 
 * Lists all grants where user is owner or recipient
 */
export async function handleListSharesCommand(
  env: Env,
  userId: string
): Promise<GrantCommandResult> {
  const owned = await listGrantsForOwner(env, userId);
  const received = await listGrantsForRecipient(env, userId);

  let message = "*Your Data Shares*\\n\\n";

  if (owned.length > 0) {
    message += "*Granted by you:*\\n";
    for (const grant of owned) {
      const expiry = grant.expires_at ? new Date(grant.expires_at).toLocaleDateString() : "never";
      message += `• \`${grant.grant_id}\`\n`;
      message += `  To: ${grant.granted_to} | ${grant.resource_id} | ${grant.permission} | Expires: ${expiry}\n`;
    }
    message += "\\n";
  }

  if (received.length > 0) {
    message += "*Granted to you:*\n";
    for (const grant of received) {
      const expiry = grant.expires_at ? new Date(grant.expires_at).toLocaleDateString() : "never";
      message += `• Resource: \`${grant.resource_type}:${grant.resource_id}\`\n`;
      message += `  From: ${grant.owner_id} | ${grant.permission} | Expires: ${expiry}\n`;
    }
  }

  if (owned.length === 0 && received.length === 0) {
    message += "No active shares.\\n\\n";
    message += "Use /grant to share your data with others.";
  }

  return { success: true, message };
}
