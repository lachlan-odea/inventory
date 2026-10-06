import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/firebase'
import { useStore } from './lib/store'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { Kits } from './pages/Kits'
import { ItemDetail } from './pages/ItemDetail'
import { People } from './pages/People'
import { Loans } from './pages/Loans'
import { Setup } from './pages/Setup'

const NAV = [
  { to: '/', label: 'Today', icon: '🏠', end: true },
  { to: '/inventory', label: 'Inventory', icon: '📦', end: false },
  { to: '/kits', label: 'Kits', icon: '🧰', end: false },
  { to: '/loans', label: 'Loans', icon: '🔄', end: false },
  { to: '/people', label: 'People', icon: '👥', end: false },
]

export default function App() {
  const { ready, error, openLoans } = useStore()

  if (!isConfigured) return <Setup />

  const overdueCount = openLoans.filter((l) => l.isOverdue).length

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">
            📦
          </span>
          <span>Studio Inventory</span>
        </div>
        <nav className="topbar__nav">
          {NAV.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className="tab">
              <span aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.to === '/loans' && overdueCount > 0 && (
                <span className="tab__count" title={`${overdueCount} overdue`}>
                  {overdueCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      )}

      <main className="main">
        {!ready && !error ? (
          <div className="loading">
            <span className="spinner" aria-hidden="true" />
            <p>Loading studio inventory…</p>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/inventory/:itemId" element={<ItemDetail />} />
            <Route path="/kits" element={<Kits />} />
            <Route path="/loans" element={<Loans />} />
            <Route path="/people" element={<People />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  )
}
