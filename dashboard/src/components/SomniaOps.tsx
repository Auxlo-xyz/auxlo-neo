import { useState, useEffect } from 'react'
import {
  Activity,
  Search,
  Send,
  Wallet,
  Target,
  TrendingUp,
  Clock,
} from 'lucide-react'

interface SomniaActivity {
  type: string
  timestamp: number
  details: Record<string, any>
}

interface Props {}

export default function SomniaOps({}: Props) {
  const [balance, setBalance] = useState<string | null>(null)
  const [activities, setActivities] = useState<SomniaActivity[]>([])
  const [scanTargets, setScanTargets] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [balanceRes, activityRes, targetsRes] = await Promise.all([
        fetch('/api/somnia/balance', {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
        }).then(r => r.json()),
        fetch('/api/somnia/activity', {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
        }).then(r => r.json()),
        fetch('/api/admin/scan-targets', {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
        }).then(r => r.json()),
      ])

      setBalance(balanceRes.balance || null)
      setActivities(activityRes.activities || [])
      setScanTargets(targetsRes.targets || [])
    } catch (err) {
      console.error('Failed to load Somnia data:', err)
    } finally {
      setLoading(false)
    }
  }

  const activityIcons: Record<string, any> = {
    'balance': Wallet,
    'send': Send,
    'contract': Target,
    'snoop': Search,
    'stream': Activity,
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Somnia Operations</h2>

      {/* Balance Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="md:col-span-1 p-6 rounded-lg bg-gradient-to-br from-[var(--accent)]/20 to-[var(--accent)]/5 border border-[var(--accent)]/30">
          <div className="flex items-center gap-3 mb-2">
            <Wallet className="w-6 h-6 text-[var(--accent)]" />
            <p className="text-sm text-[var(--text-secondary)]">Wallet Balance</p>
          </div>
          <p className="text-3xl font-bold">
            {balance || '0.00'} <span className="text-lg text-[var(--text-secondary)]">STT</span>
          </p>
        </div>

        <div className="p-6 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="flex items-center gap-3 mb-2">
            <Target className="w-6 h-6 text-blue-400" />
            <p className="text-sm text-[var(--text-secondary)]">Active Scan Targets</p>
          </div>
          <p className="text-3xl font-bold">{scanTargets.length}</p>
        </div>

        <div className="p-6 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-6 h-6 text-purple-400" />
            <p className="text-sm text-[var(--text-secondary)]">Total Actions</p>
          </div>
          <p className="text-3xl font-bold">{activities.length}</p>
        </div>
      </div>

      {/* Scan Targets */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-4">Periodic Scan Targets</h3>
        <div className="space-y-2">
          {scanTargets.length === 0 ? (
            <p className="text-[var(--text-secondary)] text-sm">No targets configured. Use the admin panel to add scan targets.</p>
          ) : (
            scanTargets.map((target) => (
              <div
                key={target}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
              >
                <span className="font-mono text-sm">{target}</span>
                <span className="text-xs text-[var(--text-secondary)]">Scanned every 5 min</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
        {activities.length === 0 ? (
          <p className="text-[var(--text-secondary)] text-sm">No Somnia activity yet. Use somnia tools via Telegram/Discord to see activity here.</p>
        ) : (
          <div className="space-y-2">
            {activities.slice(0, 20).map((activity, i) => {
              const Icon = activityIcons[activity.type] || Activity
              return (
                <div
                  key={i}
                  className="flex items-center gap-4 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
                >
                  <div className="p-2 rounded-lg bg-[var(--bg-secondary)]">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{activity.type}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {JSON.stringify(activity.details).slice(0, 60)}...
                    </p>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(activity.timestamp).toLocaleString()}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
