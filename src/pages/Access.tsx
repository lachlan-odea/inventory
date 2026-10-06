import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Avatar, EmptyState, Field } from '../components/ui'
import { useToast } from '../components/Toast'
import {
  OWNER_EMAILS,
  addStaff,
  normaliseEmail,
  removeStaff,
  setStaffRole,
  useAuth,
  watchStaff,
  type StaffMember,
  type StaffRole,
} from '../lib/auth'
import { describeFirebaseError } from '../lib/store'
import { formatDate, plural } from '../lib/format'

/** Admins only: who can sign in to the app. */
export function Access() {
  const { state } = useAuth()
  const toast = useToast()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loaded, setLoaded] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = state.status === 'staff' && state.role === 'admin'
  const me = state.status === 'staff' ? normaliseEmail(state.user.email ?? '') : ''

  useEffect(() => {
    if (!isAdmin) return
    return watchStaff(
      (rows) => {
        setStaff(rows)
        setLoaded(true)
      },
      (err) => setError(describeFirebaseError(err)),
    )
  }, [isAdmin])

  if (!isAdmin) return <Navigate to="/" replace />

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const clean = normaliseEmail(email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return setError('Enter a valid email address.')
    if (staff.some((s) => s.email === clean)) return setError(`${clean} is already on the list.`)

    setBusy(true)
    try {
      await addStaff(clean, role, me)
      toast.success(`${clean} added. They can now create an account and sign in.`)
      setEmail('')
      setRole('member')
    } catch (err) {
      setError(describeFirebaseError(err))
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: StaffMember, next: StaffRole) {
    try {
      await setStaffRole(member.email, next)
      toast.success(`${member.email} is now ${next === 'admin' ? 'an admin' : 'a member'}.`)
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  async function remove(member: StaffMember) {
    if (!window.confirm(`Remove ${member.email}? They'll lose access straight away.`)) return
    try {
      await removeStaff(member.email)
      toast.success(`${member.email} removed.`)
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Access</h1>
          <p className="muted">
            {plural(staff.length, 'person', 'people')} can sign in. Admins can also manage this list.
          </p>
        </div>
      </header>

      <section className="panel">
        <h2>Add someone</h2>
        <p className="muted small">
          Once added, they create their own account on the sign-in page with this email and confirm
          it from their inbox.
        </p>
        <form className="access-add" onSubmit={add}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@wisetechglobal.com"
            />
          </Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
      </section>

      <section className="panel">
        <h2>Who has access</h2>
        {loaded && staff.length === 0 ? (
          <EmptyState icon="🔐" title="Nobody yet" message="Add the first person above." />
        ) : (
          <ul className="access-list">
            {staff.map((member) => {
              const isOwner = OWNER_EMAILS.includes(member.email)
              const isMe = member.email === me
              return (
                <li key={member.email}>
                  <Avatar name={member.email} />
                  <div className="access-list__main">
                    <strong>{member.email}</strong>
                    <p className="muted small">
                      {isOwner ? 'Owner · ' : ''}
                      {isMe ? 'You · ' : ''}
                      Added {formatDate(member.addedAt)}
                      {member.addedBy && member.addedBy !== member.email ? ` by ${member.addedBy}` : ''}
                    </p>
                  </div>
                  {isOwner ? (
                    <span className="badge badge--in">Admin</span>
                  ) : (
                    <select
                      value={member.role}
                      disabled={isMe}
                      onChange={(e) => changeRole(member, e.target.value as StaffRole)}
                      aria-label={`Role for ${member.email}`}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                  {!isOwner && !isMe && (
                    <button className="btn btn--small btn--ghost btn--danger" onClick={() => remove(member)}>
                      Remove
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
