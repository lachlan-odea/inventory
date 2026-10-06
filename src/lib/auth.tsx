import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore'
import { auth, db, isConfigured } from './firebase'

/**
 * Accounts that are always admins, so the studio can never be locked out of
 * its own app. MUST match the list in isOwner() in firestore.rules — the rules
 * are what actually enforce it; this copy only lets the UI bootstrap the
 * owner's own staff record on first sign-in.
 */
export const OWNER_EMAILS = ['lachlan.odea@wisetechglobal.com']

export type StaffRole = 'admin' | 'member'

/** One allowlist entry. The doc ID is the lowercased email. */
export interface StaffMember {
  email: string
  role: StaffRole
  addedBy: string
  addedAt: Timestamp | null
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  /** Signed in, but hasn't clicked the link in the verification email yet. */
  | { status: 'unverified'; user: User }
  /** Verified, but not on the allowlist. */
  | { status: 'no-access'; user: User }
  | { status: 'staff'; user: User; role: StaffRole }

export interface AuthValue {
  state: AuthState
  /** Re-reads the user after they've clicked the verification link. */
  refresh: () => Promise<void>
}

/** Exported so tests can inject a signed-in user without Firebase. */
export const AuthContext = createContext<AuthValue | null>(null)

const staffCol = collection(db, 'staff')

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  // Bumped by refresh() to re-run the access check with a fresh token.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!isConfigured) return
    let unsubStaff: (() => void) | null = null

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubStaff?.()
      unsubStaff = null

      if (!user) return setState({ status: 'signed-out' })
      if (!user.emailVerified) return setState({ status: 'unverified', user })

      const email = normaliseEmail(user.email ?? '')
      const ref = doc(staffCol, email)

      const watch = () => {
        // Live, so someone waiting on "no access" gets in the moment an admin
        // adds them, and loses access the moment they're removed.
        unsubStaff = onSnapshot(
          ref,
          (snap) => {
            if (snap.exists()) {
              setState({ status: 'staff', user, role: snap.data().role === 'admin' ? 'admin' : 'member' })
            } else {
              setState({ status: 'no-access', user })
            }
          },
          () => setState({ status: 'no-access', user }),
        )
      }

      if (OWNER_EMAILS.includes(email)) {
        // First sign-in for the owner: create their own admin record.
        getDoc(ref)
          .then((snap) =>
            snap.exists()
              ? undefined
              : setDoc(ref, { email, role: 'admin', addedBy: email, addedAt: serverTimestamp() }),
          )
          .catch(() => undefined)
          .finally(watch)
      } else {
        watch()
      }
    })

    return () => {
      unsubAuth()
      unsubStaff?.()
    }
  }, [generation])

  async function refresh() {
    const user = auth.currentUser
    if (!user) return
    await user.reload()
    // A fresh ID token carries the new email_verified claim to the rules.
    await user.getIdToken(true)
    setGeneration((g) => g + 1)
  }

  return <AuthContext.Provider value={{ state, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/* ------------------------------------------------------------------ actions */

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, normaliseEmail(email), password)
}

/** Creates the account and sends the verification email straight away. */
export async function signUp(email: string, password: string): Promise<void> {
  const cred = await createUserWithEmailAndPassword(auth, normaliseEmail(email), password)
  await sendEmailVerification(cred.user)
}

export async function resendVerification(): Promise<void> {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser)
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, normaliseEmail(email))
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
}

/* ---------------------------------------------------------------- allowlist */

export function watchStaff(onData: (rows: StaffMember[]) => void, onError: (err: Error) => void) {
  return onSnapshot(
    query(staffCol, orderBy('email')),
    (snap) =>
      onData(
        snap.docs.map((d) => {
          const data = d.data()
          return {
            email: data.email ?? d.id,
            role: data.role === 'admin' ? 'admin' : 'member',
            addedBy: data.addedBy ?? '',
            addedAt: data.addedAt ?? null,
          }
        }),
      ),
    onError,
  )
}

export async function addStaff(email: string, role: StaffRole, addedBy: string): Promise<void> {
  const clean = normaliseEmail(email)
  await setDoc(doc(staffCol, clean), {
    email: clean,
    role,
    addedBy: normaliseEmail(addedBy),
    addedAt: serverTimestamp(),
  })
}

export async function setStaffRole(email: string, role: StaffRole): Promise<void> {
  await setDoc(doc(staffCol, normaliseEmail(email)), { role }, { merge: true })
}

export async function removeStaff(email: string): Promise<void> {
  await deleteDoc(doc(staffCol, normaliseEmail(email)))
}

/** Firebase Auth error codes → plain English for the sign-in form. */
export function describeAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'That email and password don’t match an account.'
    case 'auth/invalid-email':
      return 'That doesn’t look like an email address.'
    case 'auth/email-already-in-use':
      return 'There’s already an account for that email — sign in instead, or reset the password.'
    case 'auth/weak-password':
      return 'Pick a password of at least 8 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'Can’t reach the sign-in service. Check your connection.'
    case 'auth/operation-not-allowed':
      return 'Email sign-in isn’t enabled. Firebase console → Authentication → Sign-in method → enable Email/Password.'
    default:
      return (err as { message?: string })?.message ?? String(err)
  }
}
