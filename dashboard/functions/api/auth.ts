type Env = {
  CONFIG: {
    get: (key: string, type?: 'json') => Promise<string | null>
    put: (key: string, value: string, options?: { expirationTtl: number }) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  TELEGRAM_BOT_TOKEN: string | undefined
  DISCORD_BOT_TOKEN: string | undefined
  DISCORD_APPLICATION_ID: string | undefined
}

interface OAuthResult {
  success: boolean
  code?: string
  error?: string
}

interface UserPayload {
  id: string
  channel: 'telegram' | 'discord'
  username?: string
}

// Generate verification code and send to user's channel
export async function handleOAuth(env: Env, channel: 'telegram' | 'discord', identifier: string): Promise<OAuthResult> {
  // Generate 6-digit code
  const code = Math.random().toString(36).substring(2, 8).toUpperCase()
  
  const payload = {
    id: identifier,
    channel,
    username: undefined as string | undefined,
  }
  
  // Store pending auth with CODE as key (lookup by code)
  await env.CONFIG.put(`pending_auth_code:${code}`, JSON.stringify(payload), { expirationTtl: 300 })
  
  // Also store by identifier for reference
  await env.CONFIG.put(`pending_auth:${channel}:${identifier}`, JSON.stringify({ code, ...payload }), { expirationTtl: 300 })

  // Send code to user via their channel
  if (channel === 'telegram') {
    const chatId = identifier // Should be numeric ID
    const token = env.TELEGRAM_BOT_TOKEN
    
    if (!token) {
      return { success: false, error: 'Telegram bot not configured' }
    }

    // Check if user has started bot
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🔐 *AuxloNeo Dashboard Login*\n\nYour verification code is: \`${code}\`\n\nEnter this code in the dashboard to complete login.\n\nThis code expires in 5 minutes.`,
        parse_mode: 'Markdown',
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return { success: false, error: `Failed to send Telegram message: ${err}` }
    }

  } else if (channel === 'discord') {
    // Discord DMs require user ID, not username
    const userId = identifier
    const token = env.DISCORD_BOT_TOKEN
    const appId = env.DISCORD_APPLICATION_ID

    if (!token) {
      return { success: false, error: 'Discord bot not configured' }
    }

    // Create DM channel
    const dmRes = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: userId }),
    })

    if (!dmRes.ok) {
      const err = await dmRes.text()
      return { success: false, error: `Failed to create Discord DM: ${err}` }
    }

    const dmChannel = await dmRes.json()
    const channelId = dmChannel.id

    // Send message
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: `🔐 **AuxloNeo Dashboard Login**\n\nYour verification code is: \`${code}\`\n\nEnter this code in the dashboard to complete login.\n\nThis code expires in 5 minutes.`,
      }),
    })

    if (!msgRes.ok) {
      const err = await msgRes.text()
      return { success: false, error: `Failed to send Discord message: ${err}` }
    }
  }

  return { success: true, code: 'pending' }
}

// Verify auth code and return user payload
export async function verifyToken(env: Env, token: string): Promise<UserPayload | null> {
  // Check if this is a pending auth code
  const pending = await env.CONFIG.get(`pending_auth_code:${token}`, 'json')
  if (pending) {
    return pending as UserPayload
  }

  // Check if this is an active session token
  const session = await env.CONFIG.get(`dashboard_session:${token}`, 'json')
  if (session) {
    return session as UserPayload
  }

  return null
}

// Create dashboard session after code verification
export async function createSession(env: Env, payload: UserPayload): Promise<string> {
  // Generate session token
  const sessionToken = crypto.randomUUID()
  
  // Store session (24 hour TTL)
  await env.CONFIG.put(`dashboard_session:${sessionToken}`, JSON.stringify(payload), { expirationTtl: 86400 })
  
  // Clean up the pending auth code
  const pendingKey = `pending_auth:${payload.channel}:${payload.id}`
  const pendingRaw = await env.CONFIG.get(pendingKey, 'json')
  if (pendingRaw) {
    const pending = pendingRaw as any
    if (pending.code) {
      await env.CONFIG.delete(`pending_auth_code:${pending.code}`)
    }
    await env.CONFIG.delete(pendingKey)
  }

  return sessionToken
}

// Helper to find pending auth by payload
async function findPendingAuth(env: Env, payload: UserPayload): Promise<string | null> {
  const key = `pending_auth:${payload.channel}:${payload.id}`
  const raw = await env.CONFIG.get(key, 'json')
  
  if (raw) {
    // Mark code as verified by storing it with the code as key
    const pending = raw as any
    await env.CONFIG.put(`pending_auth_code:${pending.code}`, JSON.stringify(payload), { expirationTtl: 300 })
    return key
  }
  
  return null
}
