# Discord RLS Commands - Complete Implementation

## Overview

Discord now has full RLS (Row-Level Security) support with slash commands for all grant management operations.

## Implemented Discord Slash Commands

### 1. `/grant` - Grant Access to Another User

**Usage:**
```
/grant recipient:discord:456 resource:session permission:read days:30
```

**Parameters:**
- `recipient` (required): User ID with channel prefix (e.g., `discord:456`, `telegram:123`)
- `resource` (required): Resource ID (e.g., `session:discord:123`, `memory:discord:123:some_key`)
- `permission` (required): Either `read` or `write`
- `days` (optional): Expiration in days (defaults to permanent)

**Example Responses:**
✓ Success: "Access granted to `discord:456` for `session:discord:123` with `read` permission"
✗ Error: "Invalid resourceId format"

---

### 2. `/revoke` - Revoke Access

**Usage:**
```
/revoke grantid:access:session:discord:123:discord:456
```

**Parameters:**
- `grantid` (required): The grant ID returned from `/shares`

**Example Responses:**
✓ Success: "Access revoked: `access:session:discord:123:discord:456`"
✗ Error: "Grant not found or already expired"

---

### 3. `/shares` - List All Your Grants

**Usage:**
```
/shares
```

**No parameters needed**

**Example Response:**
```
=== Your Grants ===

Granted by you:
• `access:session:discord:123:discord:456`
  To: discord:456 | session:discord:123 | read | Expires: 2026-07-08

Granted to you:
• `access:memory:telegram:789:discord:123`
  From: telegram:789 | memory:some_key | read | Expires: never
```

---

## Discord Command Registration

The commands are automatically registered when you call:

```bash
curl -X POST https://auxlo-neo.YOUR-SUBDOMAIN.workers.dev/admin/setup-discord \
  -H "Authorization: Bearer $API_KEY"
```

This registers these slash commands:
1. `/chat` - Send message to AI
2. `/reset` - Clear conversation history
3. `/grant` - Grant access to your data
4. `/revoke` - Revoke access
5. `/shares` - List your grants
6. `/help` - Show all commands

---

## Technical Implementation

### File: `src/channels/discord.ts`

**Changes:**
1. Added case handlers for `grant`, `revoke`, `shares` (lines 180-220)
2. Updated command registration to include new commands (lines 228-256)
3. Updated help text to show all commands (lines 154-169)

### Integration Flow:

```typescript
// Discord interaction received
interaction.data.name = "grant"

// Extract parameters
const recipient = interaction.data.options[0].value
const resource = interaction.data.options[1].value
const permission = interaction.data.options[2].value
const days = interaction.data.options[3]?.value

// Call handler
const { handleGrantCommand } = await import("../grant-commands")
const result = await handleGrantCommand(env, userId, args)

// Send response
await sendDiscordFollowup(env, interaction.token, result.message)
```

---

## Examples

### Example 1: Grant Read Access to Session

**User A (Discord ID: 123) wants to share their session with User B (Discord ID: 456)**

```
User A types:
/grant recipient:discord:456 resource:session:discord:123 permission:read days:7
```

**Response:**
```
✓ Access granted

Recipient: `discord:456`
Resource: `session:discord:123`
Permission: read
Expires: 2026-06-15
```

**Now User B can read User A's session:**
```
User B types:
/chat message:What did User A discuss?
```

**System checks:**
- User B's ID: `discord:456`
- Resource: `session:discord:123`
- Check: `hasAccess(env, "discord:456", "session", "discord:123")`
- Result: ✓ TRUE (grant exists)
- Action: Load session and respond

---

### Example 2: Revoke Access

**User A wants to revoke User B's access:**

```
User A types first:
/shares

Response:
Your Grants:
• `access:session:discord:123:discord:456`
  To: discord:456 | read | Expires: 2026-06-15

User A types:
/revoke grantid:access:session:discord:123:discord:456

Response:
✓ Access revoked: `access:session:discord:123:discord:456`

Now User B can no longer access User A's session.
```

---

## Security Features

### 1. Strict Isolation by Default
- Users can ONLY access their own data
- Cross-user access requires explicit grant

### 2. Owner Verification
- Only the owner can grant access to their resources
- Only the owner can revoke access they've granted

### 3. Expiration
- Grants can have optional expiration dates
- Expired grants are automatically deleted

### 4. Granular Permissions
- `read`: Recipient can only view the resource
- `write`: Recipient can modify the resource

---

## Testing

Run the test script to verify:

```bash
cd /home/workspace/AuxloNeo
bun test-rls.ts
```

Expected output:
```
=== RLS Implementation Test ===

Test 1: Owner has full access
  Session is owned by telegram:123 -> YES

Test 2: Non-owner is blocked
  User (telegram:456) is owner -> NO
  Access denied without grant

Test 3: Grant-based access
  Grant created -> SUCCESS
  User (telegram:456) has access -> YES

Test 4: Revoke access
  Access revoked -> SUCCESS
  User (telegram:456) has access -> NO

All tests passed!
```

---

## Comparison: Telegram vs Discord

| Feature | Telegram | Discord |
|---------|----------|---------|
| **Commands** | `/grant`, `/revoke`, `/shares` | `/grant`, `/revoke`, `/shares` |
| **Implementation** | Text commands with args | Slash commands with options |
| **Response** | Direct message | Followup message |
| **Registration** | `setMyCommands` API | Discord Slash Commands API |
| **UX** | Type `/grant args...` | Click `/grant` → fill form |

Both channels have **identical RLS functionality** - just different UX.

---

## Files Modified

1. `src/channels/discord.ts` - Added grant command handlers and registration
2. `src/channels/telegram.ts` - Added grant command handlers (already done)
3. `src/grant-commands.ts` - Shared command handlers for both channels
4. `src/rls.ts` - Core RLS logic (grantAccess, revokeAccess, checkAccess)
5. `src/memory.ts` - RLS-protected session/memory functions

---

## Next Steps

1. **Deploy to Production:**
   ```bash
   cd /home/workspace/AuxloNeo
   CLOUDFLARE_API_TOKEN="$CF_TOKEN" npx wrangler deploy
   ```

2. **Register Discord Commands:**
   ```bash
   curl -X POST https://auxlo-neo.contactauxlo.workers.dev/admin/setup-discord \
     -H "Authorization: Bearer $API_KEY"
   ```

3. **Test in Discord:**
   - Type `/grant` and fill the form
   - Type `/shares` to see grants
   - Type `/revoke` to remove access

---

## Summary

✅ Discord has full RLS support
✅ All 3 slash commands implemented
✅ Works identically to Telegram
✅ Strict isolation + grant-based sharing
✅ TypeScript compiles successfully
✅ Ready for deployment
