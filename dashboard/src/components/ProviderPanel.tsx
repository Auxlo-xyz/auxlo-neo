import { useState, useEffect } from 'react'
import { Server, Plus, Trash2, Settings, Check, X } from 'lucide-react'

interface Provider {
  id: string
  name: string
  model: string
  type: string
  status?: 'active' | 'inactive'
}

export default function ProviderPanel() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    loadProviders()
  }, [])

  const loadProviders = async () => {
    try {
      const res = await fetch('/api/providers', {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('auth_token')}`,
        },
      })
      const data = await res.json()
      setProviders(data.providers || [])
    } catch (err) {
      console.error('Failed to load providers:', err)
    } finally {
      setLoading(false)
    }
  }

  const typeColors: Record<string, string> = {
    'builtin': 'bg-blue-900/30 text-blue-400',
    'builtin (no key)': 'bg-gray-900/30 text-gray-500',
    'custom': 'bg-purple-900/30 text-purple-400',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Providers</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg font-medium hover:bg-[var(--accent-dim)] transition"
        >
          <Plus className="w-4 h-4" />
          Add Custom
        </button>
      </div>

      <div className="space-y-3">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="flex items-center justify-between p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
          >
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)]">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-mono font-medium">{provider.id}</p>
                  <span className={`text-xs px-2 py-0.5 rounded ${typeColors[provider.type] || 'bg-gray-900/30 text-gray-400'}`}>
                    {provider.type}
                  </span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                  Model: <span className="font-mono">{provider.model}</span>
                </p>
              </div>
            </div>

            {provider.type === 'custom' && (
              <button
                onClick={() => deleteProvider(provider.id)}
                className="p-2 hover:text-[var(--danger)] transition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add Provider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">Add Custom Provider</h3>
            <form onSubmit={handleAddProvider}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm mb-1">Endpoint Type</label>
                  <select className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
                    <option value="openai">OpenAI-Compatible</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Base URL</label>
                  <input
                    type="url"
                    placeholder="https://api.example.com/v1"
                    className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">API Key</label>
                  <input
                    type="password"
                    className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Default Model</label>
                  <input
                    type="text"
                    placeholder="gpt-4o"
                    className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-white/5 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg font-medium hover:bg-[var(--accent-dim)] transition"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )

  async function deleteProvider(id: string) {
    if (!confirm('Delete this provider?')) return
    try {
      await fetch(`/api/providers/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('auth_token')}`,
        },
      })
      loadProviders()
    } catch (err) {
      console.error('Failed to delete provider:', err)
    }
  }

  async function handleAddProvider(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Implementation would extract form data and POST to /api/providers
    setShowAddModal(false)
    loadProviders()
  }
}
