# Complete Visual Documentation Index

All architecture and RLS diagrams for AuxloNeo.

## Agent Architecture (10 Diagrams)

### Core Architecture
- `agent_architecture.png` - Overall system architecture
- `agent_loop_flow.png` - Step-by-step agent operation
- `tool_execution.png` - Tool execution loop (up to 8 rounds)

### Data Layer
- `kv_storage_structure.png` - Three KV namespaces (SESSIONS/MEMORY/CONFIG)
- `memory_system.png` - Short-term vs long-term memory
- `compaction_flow.png` - History compaction (50 message limit)

### Context & Providers
- `context_building.png` - How messages are assembled
- `provider_flow.png` - Provider/model resolution order
- `available_tools.png` - All available tools

### Infrastructure
- `edge_vs_traditional.png` - Edge vs traditional server comparison

## RLS System (6 Diagrams)

### How RLS Works
- `rls_how_it_works.png` - RLS access decision flow
- `rls_architecture.png` - Protection layers
- `rls_permissions.png` - Owner vs read vs write

### Using RLS
- `rls_commands_quick.png` - Available commands
- `rls_example_usage.png` - Step-by-step sharing example
- `rls_real_example.png` - Real-world use case

## Quick Reference

### Telegram Commands
```
/grant <recipient> <resource> <permission> [days]
/revoke <grant_id>
/shares
```

### Discord Slash Commands
```
/grant recipient:<id> resource:<id> permission:<read|write> days:<number>
/revoke grant_id:<id>
/shares
```

## File Sizes

All diagrams are optimized for readability:
- Small: 60-150KB (good for docs)
- Medium: 150-250KB (detailed flow)
- Large: 500KB+ (comprehensive architecture)

## Viewing

All PNG files can be:
- Embedded in markdown files
- Opened in any image viewer
- Shared directly
- Added to documentation

## Next Steps

1. View diagrams in order for learning
2. Use `agent_architecture.png` for overview
3. Reference `*_flow.png` for specific processes
4. Check `rls_*.png` for security model

---

Generated: 2026-06-08
Version: 1.0.0
