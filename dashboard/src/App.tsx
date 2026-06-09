import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import AuthGate from './components/AuthGate'
import Sidebar from './components/Sidebar'
import SessionView from './components/SessionView'
import ToolGraph from './components/ToolGraph'
import ProviderPanel from './components/ProviderPanel'
import SomniaOps from './components/SomniaOps'
import UsageStats from './components/UsageStats'
import AdminPanel from './components/AdminPanel'

export interface User {
  id: string
  channel: 'telegram' | 'discord'
  username?: string
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if user is already authenticated
    const stored = sessionStorage.getItem('auxlo_user')
    if (stored) {
      setUser(JSON.parse(stored))
    }
    setLoading(false)
  }, [])

  const handleLogin = (u: User) => {
    setUser(u)
    sessionStorage.setItem('auxlo_user', JSON.stringify(u))
  }

  const handleLogout = () => {
    setUser(null)
    sessionStorage.removeItem('auxlo_user')
    sessionStorage.removeItem('auth_token')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent)]" />
      </div>
    )
  }

  if (!user) {
    return <AuthGate onLogin={handleLogin} />
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} onLogout={handleLogout} />
      <main className="flex-1 ml-64 p-6 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<SessionView user={user} />} />
          <Route path="/sessions/:sessionId" element={<SessionView user={user} />} />
          <Route path="/tools" element={<ToolGraph />} />
          <Route path="/providers" element={<ProviderPanel />} />
          <Route path="/somnia" element={<SomniaOps />} />
          <Route path="/usage" element={<UsageStats user={user} />} />
          <Route path="/admin" element={<AdminPanel />} />
        </Routes>
      </main>
    </div>
  )
}
