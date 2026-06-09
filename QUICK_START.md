# Quick Start: RLS Implementation

## TL;DR

Users are isolated by default. Use `/grant` to share.

## Commands

### Telegram
```
/grant telegram:456 session:telegram:123 read 7
/revoke grant_abc123
/shares
```

### Discord  
```
/grant (interactive slash command)
/revoke grantid:grant_abc123
/shares
```

## How It Works

1. **Default**: Your data is private
2. **Grant**: You can share with others temporarily
3. **Revoke**: You can revoke access anytime
4. **Expiration**: Grants auto-expire

## Visual Guides

All diagrams in `VISUAL_GUIDE.md`:
- `rls_how_it_works.png` - Simple flow
- `rls_example_usage.png` - Step by step
- `rls_permissions.png` - Permission levels

## Files Changed

- `src/channels/telegram.ts` - Added grant commands
- `src/channels/discord.ts` - Added slash commands
- `src/rls.ts` - Core RLS functions
- `src/memory.ts` - Protected session/memory access

## Test It

```bash
bun test-rls.ts
```

## Deploy

```bash
npx wrangler deploy
```

That's it! 🎉
