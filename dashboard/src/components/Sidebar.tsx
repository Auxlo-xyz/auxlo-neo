import { NavLink } from 'react-router-dom'
import {
  MessageSquare,
  Wrench,
  Server,
  Sparkles,
  BarChart2,
  Settings,
  LogOut,
} from 'lucide-react'
import type { User } from '../App'

interface Props {
  user: User
  onLogout: () => void
}

export default function Sidebar({ user, onLogout }: Props) {
  const navItems = [
    { to: '/sessions', icon: MessageSquare, label: 'Sessions' },
    { to: '/tools', icon: Wrench, label: 'Tools' },
    { to: '/providers', icon: Server, label: 'Providers' },
    { to: '/somnia', icon: Sparkles, label: 'Somnia Ops' },
    { to: '/usage', icon: BarChart2, label: 'Usage' },
  ]

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-[var(--border)]">
        <h1 className="text-xl font-bold">AuxloNeo</h1>
        <p className="text-xs text-[var(--text-secondary)] mt-1">Dashboard v0.1.0</p>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${user.channel === 'telegram' ? 'bg-[#0088cc]' : 'bg-[#5865F2]'}`} />
          <span className="text-sm text-[var(--text-secondary)]">
            {user.channel === 'telegram' ? 'Telegram' : 'Discord'}
          </span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mt-1 truncate">
          @{user.username || user.id}
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-6 py-2.5 text-sm transition ${
                isActive
                  ? 'text-[var(--accent)] bg-[var(--accent)]/10 border-l-2 border-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
              }`
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Admin & Logout */}
      <div className="border-t border-[var(--border)] py-4">
        <NavLink
          to="/admin"
          className={({ isActive }) =>
            `flex items-center gap-3 px-6 py-2.5 text-sm transition ${
              isActive
                ? 'text-[var(--accent)] bg-[var(--accent)]/10'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`
          }
        >
          <Settings className="w-4 h-4" />
          Admin
        </NavLink>

        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-6 py-2.5 w-full text-sm text-[var(--text-secondary)] hover:text-[var(--danger)] transition"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  )
}
