# RLS (Row-Level Security) Implementation Guide

## Overview

User A can grant User B access to their data (sessions, memories, usage stats).

## Commands (Telegram)

### /share    \[days\]

Grant access to another user.

Examples:

```markdown
/share telegram:456 session read 7
/share telegram:456 memory:project_notes read 30
/share telegram:456 session write 1
```

### /revoke  

Revoke access.

Examples:

```markdown
/revoke telegram:456 session
/revoke telegram:456 memory:project_notes
```

### /permissions \[resource\]

Show who has access to your resources.

Examples:

```markdown
/permissions
/permissions session
/permissions memory:project_notes
```

### /shared

Show resources others have shared with you.

Example:

```markdown
/shared
```

## Implementation

### 1. Ownership Tracking

Every resource has an owner:

```typescript
{
  resource_type: "session" | "memory" | "usage",
  resource_id: "telegram:123",
  owner_id: "telegram:123",
  created_at: Date.now()
}
```

### 2. Access Grants

```typescript
{
  resource_type: "session",
  resource_id: "telegram:123",
  granted_to: "telegram:456",
  permission: "read" | "write" | "admin",
  granted_by: "telegram:123",
  granted_at: Date.now(),
  expires_at: Date.now() + (days * 86400 * 1000)
}
```

### 3. Permission Levels

- **read**: View data
- **write**: Modify data (add messages, update memories)
- **admin**: Grant/revoke access to others

## Use Cases

### Collaborative Session

User A shares their session with User B:

```markdown
/share telegram:456 session write 1
```

User B can now:

- Read the conversation history
- Send messages to the agent
- Use the same provider/model settings

### Shared Knowledge Base

User A shares specific memories with User B:

```markdown
/share telegram:456 memory:project_notes read 30
```

User B can:

- Read these memories
- Use them in their conversations with the agent

### Delegate Administration

User A gives User B admin rights:

```markdown
/share telegram:456 session admin 7
```

User B can:

- Read/write the session
- Grant access to others
- Revoke access from others
- Delete the session

## Storage Schema

### KV Key Formats

```markdown
# Ownership
owner:session:telegram:123 -> { owner_id: "telegram:123", created_at: 1704067200000 }

# Grants
grant:session:telegram:123:telegram:456 -> { permission: "read", expires_at: 1704672000000 }

# User's grants (for /shared command)
user_grants:telegram:456 -> ["session:telegram:123", "memory:telegram:123:notes"]
```

## Security Considerations

1. **Ownership Verification**: Only owner can grant access
2. **Expiration**: Grants auto-expire after specified days
3. **Revocation**: Owner can revoke access at any time
4. **Audit Trail**: All grants logged with timestamp and granter
5. **Max Permissions**: No escalation (user can't grant more than they have)

## Example Flow

### User A shares session with User B:

1. User A runs `/share telegram:456 session read 7`
2. System:
   - Verifies User A owns `telegram:123` session
   - Creates grant: `grant:session:telegram:123:telegram:456`
   - Adds to User B's grant list: `user_grants:telegram:456`
3. User B runs `/shared`
4. System returns: "telegram:123 (session) - read access, expires in 7 days"
5. User B can now read User A's session via `/read telegram:123`

### User B reads shared session:

1. User B runs `/read telegram:123`
2. System:
   - Checks `grant:session:telegram:123:telegram:456`
   - Verifies not expired
   - Loads session from `session:telegram:123`
3. Returns session content to User B

## Next Steps

1. Add commands to Telegram bot
2. Add RLS checks to memory.ts functions
3. Add UI for viewing/managing permissions
4. Add audit logging
5. Add batch operations (share multiple resources)