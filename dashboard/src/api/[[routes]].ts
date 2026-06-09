import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { handleOAuth, verifyToken, createSession } from './auth'

type Env = {
  SESSIONS: KVNamespace
  MEMORY: KVNamespace
  CONFIG: KVNamespace
  TELEGRAM_BOT_TOKEN?: string
  DISCORD_BOT_TOKEN?: string
  DISCORD_PUBLIC_KEY?: string
  DISCORD_APPLICATION_ID?: string
  API_KEY?: string
  AUXLO_NEO_API_URL?: string
}

const app = new Hono<{ Bindings: Env }>()

// CORS for SPA
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ==================== Auth Routes ====================

// Start OAuth flow
app.post('/auth/start', async (c) => {
  const { channel, identifier } = await c.req.json()
  
  if (channel !== 'telegram' && channel !== 'discord') {
    return c.json({ error: 'Invalid channel' }, 400)
  }

  const result = await handleOAuth(c.env, channel, identifier)
  return c.json(result)
})

// Verify auth code and return user payload
app.post('/auth/verify', async (c) => {
  const { code } = await c.req.json()
  
  if (!code || typeof code !== 'string') {
    return c.json({ error: 'Code required' }, 400)
  }
  
  // Look up the pending auth by code
  const pendingKey = `pending_auth_code:${code.toUpperCase()}`
  const pending = await c.env.CONFIG.get(pendingKey, 'json')
  
  if (!pending) {
    return c.json({ error: 'Invalid or expired code' }, 401)
  }
  
  const payload = pending as { id: string; channel: 'telegram' | 'discord'; username?: string }
  
  // Generate session token
  const sessionToken = crypto.randomUUID()
  
  // Store session (24 hour TTL)
  await c.env.CONFIG.put(`dashboard_session:${sessionToken}`, JSON.stringify(payload), { expirationTtl: 86400 })
  
  // Delete the pending auth code
  await c.env.CONFIG.delete(pendingKey)
  
  return c.json({ token: sessionToken, user: payload })
})

// Get current user
app.get('/auth/me', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = auth.slice(7)
  const user = await verifyToken(c.env, token)
  
  if (!user) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  return c.json({ user })
})

// Logout
app.post('/auth/logout', async (c) => {
  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7)
    await c.env.CONFIG.delete(`dashboard_session:${token}`)
  }
  return c.json({ ok: true })
})

// ==================== Session Routes ====================

// List user's sessions
app.get('/sessions', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const prefix = `session:${user.channel}:${user.id}`
  const list = await c.env.SESSIONS.list({ prefix, limit: 50 })
  
  const sessions = []
  for (const key of list.keys) {
    const raw = await c.env.SESSIONS.get(key.name, 'json')
    if (raw) {
      const s = raw as any
      sessions.push({
        id: key.name.replace('session:', ''),
        message_count: s.messages?.length || 0,
        model: s.model,
        provider: s.provider,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
      })
    }
  }

  return c.json({ sessions })
})

// Get session details
app.get('/sessions/:id', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const sessionId = c.req.param('id')
  
  // RLS check: user must own session or have grant
  const session = await c.env.SESSIONS.get(`session:${sessionId}`, 'json')
  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const s = session as any
  const ownerId = s.owner_id || sessionId.split(':').slice(0, 2).join(':')
  const userId = `${user.channel}:${user.id}`

  if (ownerId !== userId) {
    // Check for grant
    const grant = await c.env.CONFIG.get(`grant:${sessionId}:${userId}`, 'json')
    if (!grant) {
      return c.json({ error: 'Access denied' }, 403)
    }
  }

  return c.json({ session: s })
})

// Delete session
app.delete('/sessions/:id', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const sessionId = c.req.param('id')
  const userId = `${user.channel}:${user.id}`

  // Verify ownership
  const raw = await c.env.SESSIONS.get(`session:${sessionId}`, 'json')
  const session = raw as any
  const ownerId = session?.owner_id || sessionId

  if (ownerId !== userId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  await c.env.SESSIONS.delete(`session:${sessionId}`)
  return c.json({ ok: true })
})

// ==================== Provider Routes ====================

app.get('/providers', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  // Proxy to AuxloNeo API
  const apiUrl = c.env.AUXLO_NEO_API_URL || 'https://auxlo-neo.workers.dev'
  const res = await fetch(`${apiUrl}/admin/providers`, {
    headers: { Authorization: `Bearer ${c.env.API_KEY}` },
  })
  const data = await res.json()
  return c.json(data)
})

app.post('/providers', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json()
  const apiUrl = c.env.AUXLO_NEO_API_URL || 'https://auxlo-neo.workers.dev'
  const res = await fetch(`${apiUrl}/admin/providers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return c.json(data)
})

app.delete('/providers/:id', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const id = c.req.param('id')
  const apiUrl = c.env.AUXLO_NEO_API_URL || 'https://auxlo-neo.workers.dev'
  const res = await fetch(`${apiUrl}/admin/providers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${c.env.API_KEY}` },
  })
  const data = await res.json()
  return c.json(data)
})

// ==================== Usage Routes ====================

app.get('/usage', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const range = c.req.query('range') || '7d'
  const userId = `${user.channel}:${user.id}`

  // Aggregate usage from MEMORY KV
  const list = await c.env.MEMORY.list({ prefix: `usage:${userId}`, limit: 100 })
  
  let totalRequests = 0
  let totalTokens = 0
  let promptTokens = 0
  let completionTokens = 0
  const byProvider: Record<string, any> = {}
  const byModel: Record<string, any> = {}
  const sessions: any[] = []

  for (const key of list.keys) {
    const raw = await c.env.MEMORY.get(key.name, 'json')
    if (raw) {
      const stats = raw as any
      totalRequests += stats.requests || 0
      totalTokens += stats.total_tokens || 0
      promptTokens += stats.prompt_tokens || 0
      completionTokens += stats.completion_tokens || 0

      if (stats.last_provider) {
        byProvider[stats.last_provider] = byProvider[stats.last_provider] || { requests: 0, tokens: 0 }
        byProvider[stats.last_provider].requests += stats.requests || 0
        byProvider[stats.last_provider].tokens += stats.total_tokens || 0
      }

      if (stats.last_model) {
        byModel[stats.last_model] = byModel[stats.last_model] || { requests: 0, tokens: 0 }
        byModel[stats.last_model].requests += stats.requests || 0
        byModel[stats.last_model].tokens += stats.total_tokens || 0
      }

      sessions.push({
        id: stats.session_id,
        requests: stats.requests,
        tokens: stats.total_tokens,
        lastActive: stats.last_updated,
      })
    }
  }

  return c.json({
    totalRequests,
    totalTokens,
    promptTokens,
    completionTokens,
    byProvider,
    byModel,
    sessions: sessions.sort((a, b) => b.lastActive - a.lastActive),
  })
})

// ==================== Tool Stats ====================

app.get('/tools', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  // Tool stats would need to be tracked separately in a real impl
  // For now, return static tool list
  const tools = [
    { name: 'web_search', description: 'Search the web using DuckDuckGo', callCount: 0, successful: 0, failed: 0 },
    { name: 'web_fetch', description: 'Fetch and extract text from URLs', callCount: 0, successful: 0, failed: 0 },
    { name: 'send_message', description: 'Send proactive notifications', callCount: 0, successful: 0, failed: 0 },
    { name: 'remember', description: 'Save to long-term memory', callCount: 0, successful: 0, failed: 0 },
    { name: 'recall', description: 'Search long-term memory', callCount: 0, successful: 0, failed: 0 },
    { name: 'x_fetch', description: 'Fetch X/Twitter data', callCount: 0, successful: 0, failed: 0 },
    { name: 'remote_exec', description: 'Execute shell commands', callCount: 0, successful: 0, failed: 0 },
    { name: 'set_cron', description: 'Create cron triggers', callCount: 0, successful: 0, failed: 0 },
    { name: 'list_crons', description: 'List cron schedules', callCount: 0, successful: 0, failed: 0 },
    { name: 'current_time', description: 'Get current UTC time', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_balance', description: 'Check STT balance', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_send', description: 'Send STT tokens', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_call_contract', description: 'Call smart contracts', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_publish_stream', description: 'Publish to data streams', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_read_stream', description: 'Read data streams', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_snoop', description: 'Analyze targets for legitimacy', callCount: 0, successful: 0, failed: 0 },
  ]

  return c.json({ tools })
})

// ==================== Somnia Ops ====================

app.get('/somnia/balance', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  // Would need configured wallet - return placeholder
  return c.json({ balance: null })
})

app.get('/somnia/activity', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  // Activity would need to be tracked in KV
  return c.json({ activities: [] })
})

// ==================== Admin Routes ====================

app.get('/admin/scan-targets', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const apiUrl = c.env.AUXLO_NEO_API_URL || 'https://auxlo-neo.workers.dev'
  const res = await fetch(`${apiUrl}/admin/scan-targets`, {
    headers: { Authorization: `Bearer ${c.env.API_KEY}` },
  })
  const data = await res.json()
  return c.json(data)
})

app.post('/admin/scan-targets', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json()
  const apiUrl = c.env.AUXLO_NEO_API_URL || 'https://auxlo-neo.workers.dev'
  const res = await fetch(`${apiUrl}/admin/scan-targets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return c.json(data)
})

app.delete('/admin/scan-targets/:target', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const target = c.req.param('target')
  const apiUrl = c.env.AUXLO_NEO_API_URL || 'https://auxlo-neo.workers.dev'
  const res = await fetch(`${apiUrl}/admin/scan-targets/${encodeURIComponent(target)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${c.env.API_KEY}` },
  })
  const data = await res.json()
  return c.json(data)
})

app.post('/admin/scan-now', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const apiUrl = c.env.AUXLO_NEO_API_URL || 'https://auxlo-neo.workers.dev'
  const res = await fetch(`${apiUrl}/admin/scan-now`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.API_KEY}` },
  })
  const data = await res.json()
  return c.json(data)
})

app.get('/admin/crons', async (c) => {
  const user = await requireAuth(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  // This would call Cloudflare API to list cron schedules
  // For now, return known schedules
  return c.json({
    schedules: ['*/5 * * * *', '0 * * * *']
  })
})

// ==================== Helper ====================

async function requireAuth(c: any): Promise<{ id: string; channel: 'telegram' | 'discord'; username?: string } | null> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return null

  const token = auth.slice(7)
  return await verifyToken(c.env, token)
}

export default app
