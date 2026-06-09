import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MessageCircle, Trash2, Clock } from 'lucide-react'
import type { User } from '../App'

interface Session {
  id: string
  owner_id: string
  message_count: number
  created_at: number
  updated_at: number
  model?: string
  provider?: string
}

interface SessionDetail extends Session {
  messages: Array<{
    role: string
    content: string
    timestamp: number
  }>
}

interface Props {
  user: User
}

export default function SessionView({ user }: Props) {
  const { sessionId } = useParams()
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSessions()
  }, [user])

  useEffect(() => {
    if (sessionId) {
      loadSessionDetail(sessionId)
    }
  }, [sessionId])

  const loadSessions = async () => {
    try {
      const res = await fetch('/api/sessions', {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('auth_token')}`,
        },
      })
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch (err) {
      console.error('Failed to load sessions:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadSessionDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('auth_token')}`,
        },
      })
      const data = await res.json()
      setSelected(data)
    } catch (err) {
      console.error('Failed to load session detail:', err)
    }
  }

  const deleteSession = async (id: string) => {
    if (!confirm('Delete this session?')) return
    try {
      await fetch(`/api/sessions/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('auth_token')}`,
        },
      })
      setSessions(sessions.filter((s) => s.id !== id))
      if (selected?.id === id) setSelected(null)
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading sessions...</div>
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Sessions</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Session list */}
        <div className="lg:col-span-1 space-y-3">
          {sessions.length === 0 ? (
            <p className="text-[var(--text-secondary)]">No sessions found. Start a conversation on Telegram or Discord.</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => loadSessionDetail(session.id)}
                className={`w-full p-4 rounded-lg border text-left transition ${
                  selected?.id === session.id
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                    : 'border-[var(--border)] hover:bg-white/5'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium truncate">{session.id}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {session.message_count} msgs
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(session.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSession(session.id)
                    }}
                    className="p-1 hover:text-[var(--danger)]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {session.model && (
                  <p className="text-xs text-[var(--accent)] mt-2">{session.model}</p>
                )}
              </button>
            ))
          )}
        </div>

        {/* Session detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-6">
              <h3 className="font-bold mb-4">{selected.id}</h3>
              <div className="space-y-4 max-h-[600px] overflow-auto">
                {selected.messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-[var(--bg-secondary)] ml-8'
                        : msg.role === 'assistant'
                        ? 'bg-[var(--accent)]/10 mr-8'
                        : msg.role === 'system'
                        ? 'bg-yellow-900/20 border border-yellow-900/40'
                        : 'bg-[var(--bg-secondary)]/50'
                    }`}
                  >
                    <p className="text-xs text-[var(--text-secondary)] mb-1">{msg.role}</p>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-12 text-center">
              <p className="text-[var(--text-secondary)]">Select a session to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
