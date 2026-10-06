import { useState } from 'react'
import { Field } from '../components/ui'
import {
  describeAuthError,
  resendVerification,
  resetPassword,
  signIn,
  signOut,
  signUp,
  useAuth,
} from '../lib/auth'

type Mode = 'sign-in' | 'sign-up' | 'reset'

const MIN_PASSWORD = 8

const COPY: Record<Mode, { title: string; lead: string; submit: string; busy: string }> = {
  'sign-in': {
    title: 'Sign in',
    lead: 'Use the email address the studio added to the access list.',
    submit: 'Sign in',
    busy: 'Signing in…',
  },
  'sign-up': {
    title: 'Create your account',
    lead: 'Use the email address the studio added to the access list. We’ll send a link to confirm it’s yours.',
    submit: 'Create account',
    busy: 'Creating account…',
  },
  reset: {
    title: 'Reset your password',
    lead: 'We’ll email you a link to choose a new one.',
    submit: 'Send reset link',
    busy: 'Sending…',
  },
}

function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="setup">
      <div className="setup__card auth-card">
        <span className="setup__logo" aria-hidden="true">
          📦
        </span>
        <p className="muted small">Studio Inventory</p>
        {children}
      </div>
    </div>
  )
}

export function SignIn() {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const copy = COPY[mode]

  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
    setPassword('')
    setConfirm('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (!email.trim()) return setError('Enter your email address.')

    if (mode === 'sign-up') {
      if (password.length < MIN_PASSWORD) {
        return setError(`Pick a password of at least ${MIN_PASSWORD} characters.`)
      }
      if (password !== confirm) return setError('The two passwords don’t match.')
    }
    if (mode === 'sign-in' && !password) return setError('Enter your password.')

    setBusy(true)
    try {
      if (mode === 'sign-in') await signIn(email, password)
      else if (mode === 'sign-up') await signUp(email, password)
      else {
        await resetPassword(email)
        // Same message whether or not the account exists, so the form can't be
        // used to find out who has one.
        setNotice(`If there’s an account for ${email.trim()}, a reset link is on its way.`)
      }
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (mode === 'reset' && code === 'auth/user-not-found') {
        setNotice(`If there’s an account for ${email.trim()}, a reset link is on its way.`)
      } else {
        setError(describeAuthError(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard>
      <h1>{copy.title}</h1>
      <p className="muted">{copy.lead}</p>

      <form onSubmit={submit} className="form">
        <Field label="Email" required>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </Field>

        {mode !== 'reset' && (
          <Field
            label="Password"
            hint={mode === 'sign-up' ? `At least ${MIN_PASSWORD} characters` : undefined}
            required
          >
            <input
              type="password"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        )}

        {mode === 'sign-up' && (
          <Field label="Confirm password" required>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </Field>
        )}

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="auth-note">{notice}</p>}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? copy.busy : copy.submit}
        </button>
      </form>

      <div className="auth-switch">
        {mode === 'sign-in' ? (
          <>
            <button type="button" onClick={() => switchTo('sign-up')}>
              First time? Create an account
            </button>
            <button type="button" onClick={() => switchTo('reset')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" onClick={() => switchTo('sign-in')}>
            ← Back to sign in
          </button>
        )}
      </div>
    </AuthCard>
  )
}

/** Signed in, but the email hasn't been confirmed yet. */
export function VerifyEmail({ email }: { email: string }) {
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function check() {
    setBusy(true)
    setMessage(null)
    try {
      await refresh()
      setMessage('Still not confirmed — open the link in the email, then try again.')
    } catch (err) {
      setMessage(describeAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    try {
      await resendVerification()
      setMessage(`Sent another link to ${email}.`)
    } catch (err) {
      setMessage(describeAuthError(err))
    }
  }

  return (
    <AuthCard>
      <h1>Check your email</h1>
      <p className="muted">
        We sent a link to <strong>{email}</strong>. Open it to confirm the address is yours, then
        come back here. Check spam if it hasn’t arrived.
      </p>
      {message && <p className="auth-note">{message}</p>}
      <div className="form">
        <button className="btn btn--primary" onClick={check} disabled={busy}>
          {busy ? 'Checking…' : 'I’ve confirmed it — continue'}
        </button>
      </div>
      <div className="auth-switch">
        <button type="button" onClick={resend}>
          Resend the link
        </button>
        <button type="button" onClick={() => signOut()}>
          Use a different account
        </button>
      </div>
    </AuthCard>
  )
}

/** Verified, but not on the allowlist. Updates live if an admin adds them. */
export function NoAccess({ email }: { email: string }) {
  return (
    <AuthCard>
      <h1>No access yet</h1>
      <p className="muted">
        <strong>{email}</strong> isn’t on the studio’s access list. Ask a studio admin to add you
        — this page will let you in as soon as they do.
      </p>
      <div className="auth-switch">
        <button type="button" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </AuthCard>
  )
}
