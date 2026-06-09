import { useState, useEffect } from 'react'
import { BarChart2, TrendingUp, Zap, Clock, DollarSign } from 'lucide-react'
import type { User } from '../App'

interface UsageData {
  totalRequests: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  byProvider: Record<string, { requests: number; tokens: number }>
  byModel: Record<string, { requests: number; tokens: number }>
  sessions: Array<{
    id: string
    requests: number
    tokens: number
    lastActive: number
  }>
}

interface Props {
  user: User
}

export default function UsageStats({ user }: Props) {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('7d')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUsage()
  }, [user, timeRange])

  const loadUsage = async () => {
    try {
      const res = await fetch(`/api/usage?range=${timeRange}`, {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('auth_token')}`,
        },
      })
      const data = await res.json()
      setUsage(data)
    } catch (err) {
      console.error('Failed to load usage:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--text-secondary)]">
        <BarChart2 className="w-12 h-12 mb-4" />
        <p>No usage data yet</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Usage Statistics</h2>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as any)}
          className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg"
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="p-6 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-[var(--accent)]" />
            <p className="text-sm text-[var(--text-secondary)]">Total Requests</p>
          </div>
          <p className="text-3xl font-bold">{usage.totalRequests.toLocaleString()}</p>
        </div>

        <div className="p-6 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <p className="text-sm text-[var(--text-secondary)]">Total Tokens</p>
          </div>
          <p className="text-3xl font-bold">{usage.totalTokens.toLocaleString()}</p>
        </div>

        <div className="p-6 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            <p className="text-sm text-[var(--text-secondary)]">Prompt Tokens</p>
          </div>
          <p className="text-3xl font-bold">{usage.promptTokens.toLocaleString()}</p>
        </div>

        <div className="p-6 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-purple-400" />
            <p className="text-sm text-[var(--text-secondary)]">Completion Tokens</p>
          </div>
          <p className="text-3xl font-bold">{usage.completionTokens.toLocaleString()}</p>
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div>
          <h3 className="text-lg font-semibold mb-4">By Provider</h3>
          <div className="space-y-2">
            {Object.entries(usage.byProvider).map(([provider, data]) => (
              <div
                key={provider}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
              >
                <span className="font-mono text-sm">{provider}</span>
                <div className="text-right">
                  <p className="text-sm font-medium">{data.requests} requests</p>
                  <p className="text-xs text-[var(--text-secondary)]">{data.tokens.toLocaleString()} tokens</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">By Model</h3>
          <div className="space-y-2">
            {Object.entries(usage.byModel).map(([model, data]) => (
              <div
                key={model}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
              >
                <span className="font-mono text-sm truncate max-w-[200px]">{model}</span>
                <div className="text-right">
                  <p className="text-sm font-medium">{data.requests} requests</p>
                  <p className="text-xs text-[var(--text-secondary)]">{data.tokens.toLocaleString()} tokens</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sessions */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Top Sessions</h3>
        <table className="w-full">
          <thead className="text-left text-sm text-[var(--text-secondary)]">
            <tr>
              <th className="pb-3">Session ID</th>
              <th className="pb-3">Requests</th>
              <th className="pb-3">Tokens</th>
              <th className="pb-3">Last Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {usage.sessions.slice(0, 10).map((session) => (
              <tr key={session.id}>
                <td className="py-3 font-mono text-sm">{session.id}</td>
                <td className="py-3">{session.requests}</td>
                <td className="py-3">{session.tokens.toLocaleString()}</td>
                <td className="py-3 text-sm text-[var(--text-secondary)]">
                  {new Date(session.lastActive).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
