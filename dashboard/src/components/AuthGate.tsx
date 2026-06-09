import { useState } from 'react'
import type { User } from '../App'

interface Props {
  onLogin: (user: User) => void
}

export default function AuthGate({ onLogin }: Props) {
  const [method, setMethod] = useState<'telegram' | 'discord' | null>(null)
  const [input, setInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [pendingAuth, setPendingAuth] = useState<{ channel: 'telegram' | 'discord'; identifier: string } | null>(null)

  const handleStartAuth = async (channel: 'telegram' | 'discord') => {
    if (!input.trim()) {
      setError('Please enter your Telegram user ID')
      return
    }
    
    setVerifying(true)
    setError('')
    
    try {
      // Start OAuth flow - send verification code to user
      const res = await fetch('/api/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          identifier: input.trim(),
        }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start authentication')
      }
      
      // Store pending auth and show code input
      setPendingAuth({ channel, identifier: input.trim() })
      setMethod(channel)
      setInput('')
      setError('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setVerifying(false)
    }
  }

  const handleVerify = async () => {
    if (!input.trim()) return
    setVerifying(true)
    setError('')

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: input.trim().toUpperCase(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Verification failed')
      }

      sessionStorage.setItem('auth_token', data.token)
      onLogin({
        id: data.user.id,
        channel: data.user.channel,
        username: data.user.username,
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-8 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">AuxloNeo</h1>
          <p className="text-[var(--text-secondary)]">
            Authenticate with Telegram or Discord to access your dashboard
          </p>
        </div>

        {!method ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Enter your Telegram user ID (numeric). A verification code will be sent to your bot DM.
            </p>
            
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Telegram user ID (e.g., 123456789)"
              className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] focus:border-[var(--accent)] outline-none text-[var(--text-primary)]"
            />

            {error && (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            )}

            <button
              onClick={() => handleStartAuth('telegram')}
              disabled={verifying || !input.trim()}
              className="w-full py-3 px-4 rounded-lg bg-[#0088cc] hover:bg-[#0099dd] transition disabled:opacity-50"
            >
              {verifying ? 'Sending code...' : 'Continue with Telegram'}
            </button>

            <p className="text-xs text-[var(--text-secondary)] text-center mt-4">
              You must have started a conversation with the AuxloNeo bot first.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={() => { setMethod(null); setPendingAuth(null); setInput(''); }}
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              &larr; Back
            </button>

            <p className="text-sm text-[var(--text-secondary)]">
              A verification code has been sent to your Telegram. Enter it below:
            </p>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="6-character code (e.g., A1B2C3)"
              className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] focus:border-[var(--accent)] outline-none text-[var(--text-primary)]"
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            />

            {error && (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            )}

            <button
              onClick={handleVerify}
              disabled={verifying || !input.trim()}
              className="w-full py-3 px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-dim)] transition text-black font-medium disabled:opacity-50"
            >
              {verifying ? 'Verifying...' : 'Verify'}
            </button>

            <p className="text-xs text-[var(--text-secondary)] text-center">
              Code expires in 5 minutes.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
