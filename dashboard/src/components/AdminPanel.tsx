import { useState, useEffect } from 'react'
import {
  Settings,
  RefreshCw,
  Play,
  Trash2,
  Clock,
  AlertCircle,
} from 'lucide-react'

interface ScanTarget {
  url: string
  addedAt: number
  lastScan?: number
}

interface Props {}

export default function AdminPanel({}: Props) {
  const [scanTargets, setScanTargets] = useState<ScanTarget[]>([])
  const [newTarget, setNewTarget] = useState('')
  const [cronSchedules, setCronSchedules] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAdminData()
  }, [])

  const loadAdminData = async () => {
    try {
      const [targetsRes, cronsRes] = await Promise.all([
        fetch('/api/admin/scan-targets', {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
        }).then(r => r.json()),
        fetch('/api/admin/crons', {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
        }).then(r => r.json()),
      ])

      setScanTargets(targetsRes.targets || [])
      setCronSchedules(cronsRes.schedules || [])
    } catch (err) {
      console.error('Failed to load admin data:', err)
    } finally {
      setLoading(false)
    }
  }

  const addScanTarget = async () => {
    if (!newTarget.trim()) return
    try {
      await fetch('/api/admin/scan-targets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target: newTarget.trim() }),
      })
      setNewTarget('')
      loadAdminData()
    } catch (err) {
      console.error('Failed to add target:', err)
    }
  }

  const deleteScanTarget = async (target: string) => {
    try {
      await fetch(`/api/admin/scan-targets/${encodeURIComponent(target)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
      })
      loadAdminData()
    } catch (err) {
      console.error('Failed to delete target:', err)
    }
  }

  const triggerScan = async () => {
    try {
      await fetch('/api/admin/scan-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
      })
      alert('Scan triggered')
    } catch (err) {
      console.error('Failed to trigger scan:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Admin Settings</h2>

      {/* Cron Schedules */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Periodic Jobs
        </h3>
        <div className="space-y-2">
          {cronSchedules.length === 0 ? (
            <p className="text-[var(--text-secondary)] text-sm">No cron schedules configured.</p>
          ) : (
            cronSchedules.map((schedule, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
              >
                <span className="font-mono">{schedule}</span>
                <span className="text-xs text-[var(--accent)]">Active</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Scan Targets */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-4">Periodic Scan Targets</h3>
        
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            placeholder="X handle (@somnia_network) or URL"
            className="flex-1 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg"
          />
          <button
            onClick={addScanTarget}
            className="px-4 py-2 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg font-medium"
          >
            Add
          </button>
        </div>

        <div className="space-y-2">
          {scanTargets.length === 0 ? (
            <p className="text-[var(--text-secondary)] text-sm">No scan targets. Add targets above for periodic monitoring.</p>
          ) : (
            scanTargets.map((target, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
              >
                <div>
                  <p className="font-mono text-sm">{target.url}</p>
                  {target.lastScan && (
                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                      Last scanned: {new Date(target.lastScan).toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => deleteScanTarget(target.url)}
                  className="p-2 hover:text-[var(--danger)] transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <button
          onClick={triggerScan}
          className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-white/5 transition mt-4"
        >
          <Play className="w-4 h-4" />
          Run Manual Scan
        </button>
      </div>

      {/* Danger Zone */}
      <div className="p-6 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-[var(--danger)]">
          <AlertCircle className="w-5 h-5" />
          Danger Zone
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          These actions are irreversible. Proceed with caution.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (confirm('Clear all sessions? This cannot be undone.')) {
                fetch('/api/admin/sessions', {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
                })
              }
            }}
            className="px-4 py-2 border border-[var(--danger)] text-[var(--danger)] rounded-lg hover:bg-[var(--danger)]/10 transition"
          >
            Clear All Sessions
          </button>
          <button
            onClick={() => {
              if (confirm('Clear all memory? This cannot be undone.')) {
                fetch('/api/admin/memory', {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${sessionStorage.getItem('auth_token')}` },
                })
              }
            }}
            className="px-4 py-2 border border-[var(--danger)] text-[var(--danger)] rounded-lg hover:bg-[var(--danger)]/10 transition"
          >
            Clear All Memory
          </button>
        </div>
      </div>
    </div>
  )
}
