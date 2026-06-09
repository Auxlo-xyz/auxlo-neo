#!/bin/bash

# Documentation: User Isolation Strategy for AuxloNeo

# Auxlo Neo - User Isolation Strategy

## Overview

Users who access AuxloNeo through both Telegram and Discord are completely isolated from each other, even if they have the same numeric user ID on both platforms.

## Implementation

### 1. Channel-Prefixed Session IDs

All session IDs are prefixed with their channel:

```typescript
// Telegram
const sessionId = `telegram:${chatId}`;  // Example: "telegram:123456789"

// Discord  
const sessionId = `discord:${userId}`;   // Example: "discord:123456789"
```

### 2. KV Namespace Isolation

Each KV namespace uses the full channel-prefixed sessionId as keys:

#### SESSIONS KV
- Telegram: `session:telegram:123456789`
- Discord: `session:discord:123456789`

#### MEMORY KV  
- Telegram: `memory:telegram:123456789:preference_name`
- Discord: `memory:discord:123456789:preference_name`

#### CONFIG KV
- Wizard state (Telegram): `wizard:telegram:123456789`
- Per-session persona: `persona:telegram:123456789`

#### Usage Tracking
- Telegram: `usage:telegram:123456789`
- Discord: `usage:discord:123456789`

### 3. ALLOWED_USERS Enforcement

The allowlist check uses channel-prefixed user IDs:

```typescript
// Telegram handler
const userId = `telegram:${msg.from.id.toString()}`;
if (!(await checkAllowed(env, userId))) { /* deny */ }

// Discord handler  
const userId = `discord:${userId_num}`;
if (!(await checkAllowed(env, userId))) { /* deny */ }
```

**ALLOWED_USERS format in environment:**
```
telegram:123456789
telegram:987654321
discord:555666777
```

This allows granular control - you can allow a user on Telegram but not Discord, or vice versa.

### 4. What's Isolated

✓ **Sessions** - Message history is separate  
✓ **Memories** - User facts/preferences don't cross channels  
✓ **Usage tracking** - Token counts are per-channel  
✓ **Allowlist** - Users must be explicitly allowed per channel  
✓ **Wizard state** - Endpoint setup flows don't interfere  
✓ **Per-session persona** - Custom system prompts per channel  

### 5. What's Shared

- Global provider configs (in CONFIG KV)
- Custom providers added via `/admin/providers`
- Global default model/provider settings

## Testing

Run the isolation test:

```bash
bun run test-isolation.ts
```

This verifies:
1. Sessions for same numeric ID don't mix
2. Memories are isolated
3. Usage tracking is separate
4. ALLOWED_USERS checks work independently

## Files Modified

- `src/channels/telegram.ts` - Channel-prefixed userId in ALLOWED_USERS check and wizard state
- `src/channels/discord.ts` - Channel-prefixed userId in ALLOWED_USERS check
- `src/memory.ts` - Uses full sessionId (already had correct behavior)
- `src/agent.ts` - Uses full sessionId (already had correct behavior)

## Migration Notes

**No migration needed** - existing sessions will continue to work. The channel-prefixed sessionIds were already in use for sessions, this just extends the pattern to:

1. Wizard state keys (new)
2. ALLOWED_USERS checks (changed)
3. Documentation (new)

Existing users will see no disruption. The isolation is now explicit and documented.

## Problem
When the same user uses both Telegram and Discord channels, their data (sessions, memories, usage stats) could mix if they have the same numeric ID on both platforms.

## Solution
Use **channel-prefixed session IDs** everywhere:

### Format
- **Telegram**: `telegram:<chatId>` (e.g., `telegram:123456789`)
- **Discord**: `discord:<userId>` (e.g., `discord:987654321`)

### What's Already Isolated
1. **Sessions** (SESSIONS KV)
   - Key: `session:telegram:123456789` or `session:discord:987654321`
   - Already isolated ✓

2. **ALLOWED_USERS checks**
   - Key: `telegram:123456789` or `discord:987654321`
   - Already isolated ✓

### What's Now Fixed
3. **Memory** (MEMORY KV)
   - Key: `memory:telegram:123456789:fact_name`
   - Previously used `memory:123456789:fact_name` (would mix TG/Discord)
   - Now uses full sessionId with prefix ✓

4. **Usage Stats** (MEMORY KV)
   - Key: `usage:telegram:123456789`
   - Previously used `usage:123456789` (would mix TG/Discord)
   - Now uses full sessionId with prefix ✓

## Implementation Details

### Files Modified
1. `src/channels/telegram.ts`:
   - `userId` now includes `telegram:` prefix for ALLOWED_USERS check
   - `sessionId` already had `telegram:` prefix

2. `src/channels/discord.ts`:
   - `userId` now includes `discord:` prefix for ALLOWED_USERS check
   - `sessionId` already had `discord:` prefix

3. `src/memory.ts`:
   - All KV operations already use `sessionId` parameter directly
   - No changes needed - isolation happens automatically via prefixed sessionId

### Memory Functions
```typescript
// Session (already isolated)
getSession(env.SESSIONS, sessionId)  // session:telegram:123456789

// Memory (now isolated)
saveMemory(env.MEMORY, sessionId, key, value)  // memory:telegram:123456789:key

// Usage (now isolated)
trackUsage(env.MEMORY, sessionId, usage)  // usage:telegram:123456789
```

## Testing

To verify isolation works:

1. **Same user ID on both platforms**:
   - Create Telegram user with ID: 12345
   - Create Discord user with ID: 12345
   - Each should have separate sessions, memories, and usage stats

2. **Check KV keys**:
   ```bash
   wrangler kv key list --namespace-id=<SESSIONS_ID>
   # Should show: session:telegram:12345, session:discord:12345
   
   wrangler kv key list --namespace-id=<MEMORY_ID>
   # Should show: memory:telegram:12345:*, memory:discord:12345:*, usage:telegram:12345, usage:discord:12345
   ```

## Future Considerations

- **Cross-channel identity**: If you want to link accounts across channels, create a separate mapping:
  `identity:telegram:12345 -> identity:discord:67890`
  
- **Data migration**: If you have existing data without prefixes, write a migration script:
  ```typescript
  // For each session key without prefix
  // Determine channel from metadata
  // Rename to prefixed format
  ```
