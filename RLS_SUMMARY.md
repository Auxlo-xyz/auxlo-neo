# RLS Implementation Summary

## How It Works

### Data Model

```typescript
// Ownership: Each resource has an owner_id in metadata
interface SessionState {
  sessionId: string;
  owner_id: string;  // NEW: telegram:123
  messages: Message[];
  // ...
}

// Access Grants: Stored in CONFIG KV
interface AccessGrant {
  resource_type: 'session' | 'memory' | 'usage';
  resource_id: string;    // e.g., "session:telegram:123"
  owner_id: string;       // e.g., "telegram:123"
  granted_to: string;     // e.g., "telegram:456"
  permission: 'read' | 'write' | 'admin';
  created_at: number;
  expires_at?: number;    // Optional TTL
}
```

### KV Key Structure

```
# Session (owned by User A)
session:telegram:123 -> {
  "sessionId": "telegram:123",
  "owner_id": "telegram:123",
  "messages": [...]
}

# Grants (stored in CONFIG KV)
grant:session:telegram:123:telegram:456 -> {
  "resource_type": "session",
  "resource_id": "session:telegram:123",
  "owner_id": "telegram:123",
  "granted_to": "telegram:456",
  "permission": "read",
  "created_at": 1734220800000,
  "expires_at": 1734825600000
}
```

### Permission Check Flow

```typescript
// 1. User B requests access to User A's session
const sessionId = "telegram:123";
const requesterId = "telegram:456";

// 2. Load session
const session = await getSession(env.SESSIONS, sessionId);

// 3. Check if requester is owner
if (session.owner_id === requesterId) {
  return session;  // Owner has full access
}

// 4. Check for explicit grant
const grantKey = `grant:session:${sessionId}:${requesterId}`;
const grant = await env.CONFIG.get(grantKey, "json");

// 5. Validate grant
if (!grant) {
  throw new Error("Access denied");
}

if (grant.expires_at && Date.now() > grant.expires_at) {
  throw new Error("Grant expired");
}

if (!['read', 'admin'].includes(grant.permission)) {
  throw new Error("Insufficient permissions");
}

// 6. Grant access
return session;
```

## Implementation Steps

### Step 1: Modify data types

```typescript
// src/types.ts
export interface SessionState {
  sessionId: string;
  owner_id?: string;  // NEW
  messages: Message[];
  model?: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
}
```

### Step 2: Set owner on session creation

```typescript
// src/memory.ts
export function createSession(sessionId: string, ownerId: string): SessionState {
  return {
    sessionId,
    owner_id: ownerId,  // NEW
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
```

### Step 3: RLS utility functions

```typescript
// src/rls.ts
export async function checkAccess(
  env: Env,
  resourceType: 'session' | 'memory',
  resourceId: string,
  requesterId: string,
  requiredPermission: 'read' | 'write' = 'read'
): Promise<{ allowed: boolean; reason?: string }> {
  
  // 1. Load resource to get owner
  const resource = await loadResource(env, resourceType, resourceId);
  
  // 2. Owner always has access
  if (resource.owner_id === requesterId) {
    return { allowed: true };
  }
  
  // 3. Check for grant
  const grantKey = `grant:${resourceType}:${resourceId}:${requesterId}`;
  const grant = await env.CONFIG.get(grantKey, "json");
  
  if (!grant) {
    return { allowed: false, reason: "No grant found" };
  }
  
  // 4. Check expiration
  if (grant.expires_at && Date.now() > grant.expires_at) {
    return { allowed: false, reason: "Grant expired" };
  }
  
  // 5. Check permission level
  if (requiredPermission === 'write' && grant.permission !== 'write' && grant.permission !== 'admin') {
    return { allowed: false, reason: "Insufficient permissions" };
  }
  
  return { allowed: true };
}

export async function grantAccess(
  env: Env,
  resourceType: 'session' | 'memory',
  resourceId: string,
  owner_id: string,
  granted_to: string,
  permission: 'read' | 'write' | 'admin',
  expires_in_days?: number
): Promise<void> {
  
  // 1. Verify ownership
  const resource = await loadResource(env, resourceType, resourceId);
  if (resource.owner_id !== owner_id) {
    throw new Error("Not resource owner");
  }
  
  // 2. Create grant
  const grant: AccessGrant = {
    resource_type: resourceType,
    resource_id: resourceId,
    owner_id,
    granted_to,
    permission,
    created_at: Date.now(),
    expires_at: expires_in_days ? Date.now() + expires_in_days * 86400000 : undefined,
  };
  
  // 3. Store grant
  const grantKey = `grant:${resourceType}:${resourceId}:${granted_to}`;
  await env.CONFIG.put(grantKey, JSON.stringify(grant));
  
  // 4. Also store in grants list for owner (for easy listing)
  await addToGrantsList(env, owner_id, grantKey, grant.expires_at);
}
```

### Step 4: Commands (Telegram)

```typescript
// Add to BOT_COMMANDS
{ command: "share", description: "Grant access to your data" },
{ command: "revoke", description: "Revoke access" },
{ command: "grants", description: "List your grants" },

// Handle commands
case "/share": {
  // Usage: /share telegram:456 session read 7
  const args = text.split(" ");
  const granteeId = args[1];    // telegram:456
  const resourceType = args[2]; // session
  const permission = args[3];   // read
  const days = args[4];         // 7 (optional)
  
  await grantAccess(
    env,
    resourceType as 'session',
    sessionId,
    userId,      // Owner
    granteeId,   // Grantee
    permission as 'read',
    days ? parseInt(days) : undefined
  );
  
  await sendText(env, chatId, `✓ Granted ${permission} access to ${granteeId} for ${resourceType}`);
}

case "// revoke": {
  // Usage: /revoke telegram:456 session
  const args = text.split(" ");
  const granteeId = args[1];
  const resourceType = args[2];
  
  await revokeAccess(env, resourceType, sessionId, userId, granteeId);
  await sendText(env, chatId, `✓ Revoked access from ${granteeId}`);
}
```

## Security Considerations

1. **Owner always has full access** - No grants needed for owner
2. **Explicit grants only** - No implicit sharing
3. **Time-limited** - Optional expiration prevents stale access
4. **Revocable** - Owner can revoke at any time
5. **Audit trail** - All grants logged with timestamps

## Use Cases

### 1. Share session with team member
```
/share telegram:456 session read 7
```
User 456 can read your session for 7 days.

### 2. Share memory context
```
/share telegram:456 memory read
```
User 456 can read your memories (permanent).

### 3. Admin access for moderation
```
/share telegram:456 session admin
```
User 456 gets admin access (read + write + delete).

### 4. Revoke access
```
/revoke telegram:456 session
```
Immediately revokes User 456's access.

## Performance

- **Grant check**: O(1) - Single KV lookup
- **Ownership check**: O(1) - Part of resource metadata
- **List grants**: O(n) - Scan grants list in CONFIG

## Trade-offs

**Pros:**
- Simple implementation
- No database schema changes
- Flexible permission levels
- Time-limited grants

**Cons:**
- No native RBAC (Role-Based Access Control)
- Manual grant management
- No group/team support

## Alternatives

### Option 2: Shared Sessions (Simpler)

Instead of RLS, create a shared session:

```typescript
const sharedSessionId = `shared:team-alpha`;
// Multiple users can access the same session
```

**Use case**: Team collaboration where everyone shares one session.

### Option 3: Public Resources

Mark resources as public:

```typescript
interface SessionState {
  sessionId: string;
  owner_id: string;
  public: boolean;  // If true, anyone can read
  messages: Message[];
}
```

**Use case**: Public demos, templates.

## Recommendation

Start with **Option 1 (RLS)** only if you need flexible, user-to-user sharing.

For team collaboration, **Option 2 (Shared Sessions)** is simpler and more practical.

---

**Files created:**
- `/src/rls.ts` - Core RLS logic
- `/src/rls-examples.ts` - Usage examples
- `/src/rls-implementation.ts` - Integration examples
- `RLS_GUIDE.md` - User guide
