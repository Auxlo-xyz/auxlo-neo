import { useState, useEffect } from 'react'
import {
  Globe,
  Search,
  Send,
  Clock,
  Database,
  Zap,
  ExternalLink,
} from 'lucide-react'

interface ToolData {
  name: string
  description: string
  callCount: number
  lastUsed?: number
  successful: number
  failed: number
}

interface Props {}

export default function ToolGraph({}: Props) {
  const [tools, setTools] = useState<ToolData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadToolStats()
  }, [])

  const loadToolStats = async () => {
    try {
      const res = await fetch('/api/tools/stats', {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('auth_token')}`,
        },
      })
      const data = await res.json()
      setTools(data.tools || getDefaultTools())
    } catch (err) {
      setTools(getDefaultTools())
    } finally {
      setLoading(false)
    }
  }

  const getDefaultTools = (): ToolData[] => [
    { name: 'web_search', description: 'Search the web (DuckDuckGo)', callCount: 0, successful: 0, failed: 0 },
    { name: 'web_fetch', description: 'Fetch URL content', callCount: 0, successful: 0, failed: 0 },
    { name: 'x_fetch', description: 'Fetch X/Twitter data', callCount: 0, successful: 0, failed: 0 },
    { name: 'remote_exec', description: 'Execute shell commands', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_snoop', description: 'Analyze Somnia targets', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_balance', description: 'Check STT balance', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_send', description: 'Send STT tokens', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_call_contract', description: 'Call smart contract', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_publish_stream', description: 'Publish to stream', callCount: 0, successful: 0, failed: 0 },
    { name: 'somnia_read_stream', description: 'Read from stream', callCount: 0, successful: 0, failed: 0 },
    { name: 'send_message', description: 'Proactive notifications', callCount: 0, successful: 0, failed: 0 },
    { name: 'remember', description: 'Save to memory', callCount: 0, successful: 0, failed: 0 },
    { name: 'recall', description: 'Recall from memory', callCount: 0, successful: 0, failed: 0 },
    { name: 'set_cron', description: 'Schedule cron jobs', callCount: 0, successful: 0, failed: 0 },
  ]

  const getToolIcon = (name: string) => {
    if (name.startsWith('somnia')) return <Zap className="w-5 h-5 text-[var(--accent)]" />
    if (name.includes('web') || name === 'x_fetch') return <Globe className="w-5 h-5 text-blue-400" />
    if (name.includes('mem')) return <Database className="w-5 h-5 text-purple-400" />
    if (name === 'remote_exec') return <ExternalLink className="w-5 h-5 text-orange-400" />
    if (name === 'send_message') return <Send className="w-5 h-5 text-green-400" />
    return <Zap className="w-5 h-5 text-gray-400" />
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Tool Registry</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)]">
                {getToolIcon(tool.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-medium">{tool.name}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                  {tool.description}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-bold">{tool.callCount}</p>
                <p className="text-xs text-[var(--text-secondary)]">Calls</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-400">{tool.successful}</p>
                <p className="text-xs text-[var(--text-secondary)]">OK</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--danger)]">{tool.failed}</p>
                <p className="text-xs text-[var(--text-secondary)]">Err</p>
              </div>
            </div>

            {tool.lastUsed && (
              <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                <Clock className="w-3 h-3" />
                Last used: {new Date(tool.lastUsed).toLocaleString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
