# RLS Quick Reference Card

## Discord Slash Commands

### Grant Access
```
/grant recipient:discord:456 resource:session permission:read days:30
```

### Revoke Access
```
/revoke grantid:access:session:discord:123:discord:456
```

### List Grants
```
/shares
```

---

## Telegram Commands

### Grant Access
```
/grant discord:456 session:telegram:123 read 30
```

### Revoke Access
```
/revoke access:session:telegram:123:discord:456
```

### List Grants
```
/shares
```

---

## Permission Types

- **read** - View only
- **write** - View and modify

---

## Resource IDs

- **Sessions**: `session:telegram:123` or `session:discord:456`
- **Memories**: `memory:telegram:123:fact_name`

---

## Grant ID Format

```
access:{type}:{resource_id}:{recipient_id}
```

Example: `access:session:telegram:123:discord:456`

---

## Security Model

1. ✅ **Strict Isolation** - Users can only access their own data by default
2. ✅ **Explicit Grant** - Owner must grant access
3. ✅ **Owner Verification** - Only owner can grant/revoke
4. ✅ **Expiration** - Optional time-limited access
5. ✅ **Granular** - Separate read/write permissions

---

## Implementation Status

| Component | Telegram | Discord |
|-----------|----------|---------|
| User Isolation | ✅ | ✅ |
| RLS Protection | ✅ | ✅ |
| /grant Command | ✅ | ✅ |
| /revoke Command | ✅ | ✅ |
| /shares Command | ✅ | ✅ |
| Slash Commands | N/A (text) | ✅ |

---

## Deploy Checklist

- [x] TypeScript compiles
- [x] Commands registered
- [x] RLS functions implemented
- [x] Both channels supported
- [ ] Deploy to Cloudflare Workers
- [ ] Register Discord slash commands
- [ ] Test in production

---

## Cost: Zero

- Runs on Cloudflare Workers free tier
- No additional infrastructure
- KV storage (built-in)
- All serverless

---

## Files

```
src/
├── rls.ts              # Core RLS logic
├── rls-implementation.ts # Integration examples
├── grant-commands.ts   # Command handlers
├── memory.ts           # RLS-protected functions
├── channels/
│   ├── telegram.ts     # Grant commands
│   └── discord.ts     # Grant slash commands
```
