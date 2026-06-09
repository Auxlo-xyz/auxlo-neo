const API_BASE = import.meta.env.VITE_API_BASE || ''

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${API_BASE}/api${path}`
  
  const token = sessionStorage.getItem('auth_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, {
    ...options,
    headers,
  })
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options)
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  return res.json()
}

// Auth
export const auth = {
  start: (channel: 'telegram' | 'discord', identifier: string) =>
    apiJson<{ success: boolean; code?: string; error?: string }>('/auth/start', {
      method: 'POST',
      body: JSON.stringify({ channel, identifier }),
    }),

  verify: (code: string) =>
    apiJson<{ token: string; user: any }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  me: () => apiJson<{ user: any }>('/auth/me'),

  logout: () =>
    apiJson<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
}

// Sessions
export const sessions = {
  list: () => apiJson<{ sessions: any[] }>('/sessions'),

  get: (id: string) => apiJson<{ session: any }>(`/sessions/${id}`),

  delete: (id: string) =>
    apiJson<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
}

// Providers
export const providers = {
  list: () => apiJson<{ providers: any[] }>('/providers'),

  add: (config: any) =>
    apiJson<{ ok: boolean; provider: any }>('/providers', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  remove: (id: string) =>
    apiJson<{ ok: boolean }>(`/providers/${id}`, { method: 'DELETE' }),
}

// Usage
export const usage = {
  get: (range?: string) =>
    apiJson<{ totalRequests: number; totalTokens: number; [key: string]: any }>('/usage' + (range ? `?range=${range}` : '')),
}

// Tools
export const tools = {
  list: () => apiJson<{ tools: any[] }>('/tools'),
}

// Somnia
export const somnia = {
  balance: () => apiJson<{ balance: string | null }>('/somnia/balance'),

  activity: () => apiJson<{ activities: any[] }>('/somnia/activity'),
}

// Admin
export const admin = {
  scanTargets: {
    list: () => apiJson<{ targets: string[] }>('/admin/scan-targets'),

    add: (target: string) =>
      apiJson<{ ok: boolean }>('/admin/scan-targets', {
        method: 'POST',
        body: JSON.stringify({ target }),
      }),

    remove: (target: string) =>
      apiJson<{ ok: boolean }>(`/admin/scan-targets/${encodeURIComponent(target)}`, {
        method: 'DELETE',
      }),
  },

  scanNow: () => apiJson<{ ok: boolean }>('/admin/scan-now', { method: 'POST' }),

  crons: () => apiJson<{ schedules: string[] }>('/admin/crons'),
}
