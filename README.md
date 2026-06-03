# AuxloNeo

**The edge-native AI agent.** Runs on Cloudflare Workers -- zero servers, global low-latency, free tier eligible.

AuxloNeo is the stripped-down, edge-first version of [auxloclaw](https://github.com/Auxlo-xyz/auxloclaw). Where auxloclaw is a full daemon (35k lines, SQLite, subprocesses, WebSocket connections), AuxloNeo is ~500 lines of TypeScript that gives you a multi-provider AI agent with tool calling, session memory, and channel integrations -- all on Cloudflare's free tier.

## What you get

- **Dual-Layer Memory**:
  - **Automatic Reflection**: Background analysis of conversations to learn preferences and facts across sessions.
  - **Explicit Memory**: Manual `remember` and `recall` tools for high-priority storage.
- **Context Compaction**: Automatic summarization of long conversations to keep tokens low while preserving context.
- **OpenAI-compatible API** at `/v1/chat/completions` (drop-in replacement for any OpenAI client)
- **Telegram bot** webhook handler with typing indicators and usage stats
- **Discord bot** slash commands (`/chat`, `/reset`, `/help`)
- **Multi-provider LLM support**: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek
- **Built-in tools**: `web_search` (DuckDuckGo), `web_fetch` (URL reading), `x_fetch` (X/Twitter), `send_message`, `current_time`
- **Session memory** via Cloudflare KV (7-day TTL)
- **Tool calling loop** (up to 8 rounds per request)
- **Streaming** support for OpenAI-compatible API
- **Admin config** via KV (persona, model, temperature)

## Architecture

```
Request → index.ts (router) → Channel handler → agentChat() → Provider loop → Tools → Response
                                         ↕
                                    KV (sessions, memory, config)
                                         ↕
                                 Compression & Reflection
```

Everything is stateless HTTP. No long-lived processes, no WebSocket connections, no filesystem, no databases. Cloudflare KV handles all persistence.

## Quick start

```bash
npm install
npm run dev        # local dev with wrangler
npm run deploy     # deploy to Cloudflare
```

## Configuration

### Secrets (set via `wrangler secret put`)

| Secret | Required | Description |
|--------|----------|-------------|
| `OPENAI_API_KEY` | One LLM key needed | OpenAI API key |
| `ANTHROPIC_API_KEY` | Alternative | Anthropic API key |
| `GOOGLE_API_KEY` | Alternative | Google Gemini API key |
| `OPENROUTER_API_KEY` | Alternative | OpenRouter API key |
| `GROQ_API_KEY` | Alternative | Groq API key |
| `DEEPSEEK_API_KEY` | Alternative | DeepSeek API key |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Telegram bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | Webhook verification secret |
| `DISCORD_BOT_TOKEN` | For Discord | Discord bot token |
| `DISCORD_PUBLIC_KEY` | For Discord | Discord app public key (Ed25519) |
| `DISCORD_APPLICATION_ID` | For Discord | Discord app ID |
| `API_KEY` | Optional | Protects the `/v1/chat/completions` endpoint |

### KV namespaces (set in wrangler.toml)

Create three KV namespaces and bind them:

```bash
wrangler kv:namespace create SESSIONS
wrangler kv:namespace create MEMORY
wrangler kv:namespace create CONFIG
```

Update `wrangler.toml` with the generated IDs.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_PROVIDER` | `openai` | Default LLM provider |
| `DEFAULT_MODEL` | provider default | Override default model |
| `DEFAULT_SYSTEM_PROMPT` | built-in | Custom system prompt |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check + status |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat API |
| `POST` | `/api/chat/completions` | Alias for above |
| `POST` | `/telegram` | Telegram webhook handler |
| `POST` | `/discord` | Discord interaction handler |
| `POST` | `/admin/configure` | Update config (requires API_KEY) |
| `POST` | `/admin/setup-telegram` | Register Telegram webhook |
| `POST` | `/admin/setup-discord` | Register Discord slash commands |

## Telegram setup

```bash
# 1. Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET  # optional

# 2. Deploy
npm run deploy

# 3. Register webhook
curl -X POST https://your-worker.workers.dev/admin/setup-telegram
```

## Discord setup

```bash
# 1. Set secrets
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID

# 2. Deploy
npm run deploy

# 3. Register slash commands
curl -X POST https://your-worker.workers.dev/admin/setup-discord

# 4. Set interaction URL in Discord Developer Portal
#    → General Information → Interactions Endpoint URL
#    → https://your-worker.workers.dev/discord
```

## API usage

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "session_id": "my-session"
  }'
```

With streaming:
```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## What's stripped vs auxloclaw

| auxloclaw | AuxloNeo |
|-----------|----------|
| 35k lines Rust | ~500 lines TypeScript |
| SQLite memory | KV memory |
| Filesystem config | KV config |
| Subprocess tools (agent-browser, webserp) | Pure fetch (web_search, web_fetch) |
| Telegram long-polling / WebSocket | HTTP webhooks only |
| Discord gateway | Discord interactions endpoint |
| MCP server integration | None (future) |
| Scheduling / cron | Cloudflare Cron Triggers (future) |
| Voice I/O | None |
| Code execution | None |
| Docker / SSH environments | None |

## What's preserved

- Multi-provider LLM abstraction (6 providers)
- OpenAI-compatible API
- Tool calling loop with execution
- Session-based conversation memory
- Telegram + Discord channel integration
- Streaming responses
- Web search (DuckDuckGo)
- Automatic Memory & Context Compaction

## License

MIT
