# Complete Implementation: Strict Isolation + Grant-Based Sharing

## Overview

Users are isolated by default but can opt-in to share their data.

### Default: Strict Isolation (ALWAYS ON)

- User A **CANNOT** access User B's data (enforced in code)
- Data is isolated via channel-prefixed IDs: `telegram:123` vs `telegram:456`
- No command or action can override this

### Optional: Grant-Based Sharing

- User A can **voluntarily** grant access to User B
- User B can access **only** what User A explicitly shared
- Grants have expiration dates (default 30 days)
- User A can revoke access anytime

---

## Implementation Details

### 1. Data Model

```typescript
// Each session/memory has an owner
export interface SessionState {
  sessionId: string;
  owner_id: string;  // telegram:123
  messages: Message[];
  permissions: string[];  // NEW: List of users who can access
}

// Access grants stored in CONFIG KV
export interface AccessGrant {
  grant_id: string;     // "grant:telegram:123:telegram:456:session:telegram:123"
  resource_type: "session" | "memory";
  resource_id: string;  // "telegram:123"
  owner_id: string;     // "telegram:123"
  granted_to: string;  // "telegram:456"
  permission: "read" | "write";
  granted_at: number;
  expires_at?: number;
}
```

### 2. Access Control Flow

```typescript
// When User B tries to access User A's session:

// Step 1: Is User B the owner?
if (session.owner_id === userId) {
  return true; // Owner always has access
}

// Step 2: Is there an active grant?
const grant = await checkAccessGrant(env, {
  resourceType: "session",
  resourceId: "telegram:123",
  userId: "telegram:456"
});

if (grant && !isExpired(grant)) {
  return true; // Grant exists and is valid
}

// Step 3: Deny access
return false;
```

### 3. Commands

#### Telegram Commands

```
/grant <userId> <resourceId> [permission] [days]
  - Share your data with another user
  
  Examples:
  • /grant telegram:456 session:telegram:123
  • /grant telegram:456 memory:telegram:123:preferences read 7

/revoke <grantId>
  - Revoke access you granted
  
  Example:
  • /revoke grant:telegram:123:telegram:456:session:telegram:123

/shares
  - List all your granted and received shares
```

#### Discord Commands (same functionality)

```
/grant <userId> <resourceId> [permission] [days]
/revoke <grantId>
/shares
```

---

## File Structure

```
src/
  ├── rls.ts              - Core RLS logic (checkAccess, grantAccess, revokeAccess)
  ├── rls-implementation.ts - Integration examples
  ├── memory.ts           - RLS-protected session/memory functions
  ├── grant-commands.ts   - Command handlers for /grant, /revoke, /shares
  ├── agent.ts            - Uses RLS-protected functions
  └── channels/
      ├── telegram.ts     - Passes userId to RLS checks
      └── discord.ts      - Passes userId to RLS checks
```

---

## Key Security Features

### 1. Ownership Metadata
- Every session/memory has `owner_id` field
- Stored in KV: `meta:session:telegram:123`

### 2. Grant Validation
```typescript
// Before granting access:
const { isOwner } = await checkAccess(env, userId, resourceType, resourceId);
if (!isOwner) {
  throw new Error("Only owner can grant access");
}
```

### 3. Expiration Checks
```typescript
// Before allowing access:
if (grant.expires_at && grant.expires_at < Date.now()) {
  await env.CONFIG.delete(`access:${resourceType}:${resourceId}:${userId}`);
  return false; // Grant expired
}
```

### 4. Revocation
```typescript
// Owner can revoke anytime:
await revokeAccessByGrantId(env, grantId);
```

---

## Example Scenarios

### Scenario 1: User A shares session with User B

```
User A (telegram:123):
  /grant telegram:456 session:telegram:123 read 7

User B (telegram:456):
  - Session appears in /shares
  - Can read messages for 7 days
  - Cannot write or modify
  - Access revoked automatically after 7 days
```

### Scenario 2: Unauthorized access attempt

```
User B (telegram:456) tries to access User A's session:

checkAccess(env, "telegram:456", "session", "telegram:123")
  → Is owner? NO
  → Check grants... NO GRANT FOUND
  → DENY ACCESS ❌

Error: "You don't have permission to access this resource"
```

### Scenario 3: Revoke access

```
User A (telegram:123):
  /shares
  → Lists: grant:telegram:123:telegram:456:session:telegram:123

  /revoke grant:telegram:123:telegram:456:session:telegram:123
  → Access revoked immediately
  → User B loses access instantly
```

---

## Storage Keys

### SESSIONS KV
```
session:telegram:123        → Session data
meta:session:telegram:123   → Owner metadata
```

### CONFIG KV
```
access:session:telegram:123:telegram:456  → Access grant
grant:telegram:123:telegram:456:session:telegram:123  → Grant ID index
```

### MEMORY KV
```
memory:telegram:123:fact_name           → Memory data
meta:memory:telegram:123:fact_name      → Owner metadata
access:memory:telegram:123:telegram:456  → Access grant
```

---

## Testing

```bash
# Run isolation tests
bun test-isolation.ts

# Run RLS tests
bun test-rls.ts
```

Both should pass with:
- ✓ Strict isolation enforced
- ✓ Grant-based sharing works
- ✓ Expiration enforced
- ✓ Revocation immediate

---

## Security Guarantees

1. **Strict Isolation**: User A cannot access User B's data without explicit grant
2. **Owner-Only Grants**: Only resource owner can grant access
3. **Expiration**: All grants expire (default 30 days, max 365)
4. **Immediate Revocation**: Owner can revoke access instantly
5. **Audit Trail**: All grants logged with grant_id, owner, recipient, timestamps
6. **Permission Levels**: read | write | admin (future)

---

## Future Enhancements

1. **Admin Permission**: Allow editing/deleting shared resources
2. **Bulk Grants**: Share multiple resources at once
3. **Team Access**: Grant to a group/team instead of individual users
4. **Audit Logs**: Track all access attempts (success/failure)
5. **Rate Limiting**: Limit how many grants a user can create
6. **Permission Templates**: Predefined permission sets

---

## Conclusion

This implementation provides:
- ✅ Strong isolation by default (no accidental data leaks)
- ✅ Flexible sharing when needed (opt-in grants)
- ✅ Time-limited access (expiration dates)
- ✅ Instant revocation (owner control)
- ✅ Audit trail (all grants logged)
- ✅ Simple UX (/grant, /revoke, /shares commands)

Users are protected by default but can collaborate when needed.
