import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/firebase'
import { StoreProvider, useStore } from './lib/store'
import { signOut, useAuth } from './lib/auth'
import { Access } from './pages/Access'
import { NoAccess, SignIn, VerifyEmail } from './pages/SignIn'
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

/**
 * Decides what a visitor sees before any studio data loads: setup, sign-in,
 * "check your email", "no access", or the app itself. The data store only
 * mounts for allowlisted staff, so nobody else's browser even subscribes.
 */
export function AuthGate() {
  const { state } = useAuth()

  if (!isConfigured) return <Setup />

  switch (state.status) {
    case 'loading':
      return (
        <div className="setup">
          <div className="loading">
            <span className="spinner" aria-hidden="true" />
            <p>Signing you in…</p>
          </div>
        </div>
      )
    case 'signed-out':
      return <SignIn />
    case 'unverified':
      return <VerifyEmail email={state.user.email ?? ''} />
    case 'no-access':
      return <NoAccess email={state.user.email ?? ''} />
    case 'staff':
      return (
        <StoreProvider>
          <App />
        </StoreProvider>
      )
  }
}

export default function App() {
  const { ready, error, openLoans } = useStore()
  const { state } = useAuth()
  const isAdmin = state.status === 'staff' && state.role === 'admin'
  const email = state.status === 'staff' ? (state.user.email ?? '') : ''

  const overdueCount = openLoans.filter((l) => l.isOverdue).length
  const nav = isAdmin ? [...NAV, { to: '/access', label: 'Access', icon: '🔐', end: false }] : NAV

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
          {nav.map((tab) => (
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
        <div className="topbar__account">
          <span className="topbar__email" title={email}>
            {email}
          </span>
          <button className="btn btn--small btn--ghost" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
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
            <Route path="/access" element={<Access />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  )
}
