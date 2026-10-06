import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ensureSignedIn, isConfigured } from './firebase'
import { watchItems, watchKits, watchLoanHistory, watchOpenLoans, watchPeople } from './db'
import { toLoanView } from './format'
import type { Item, Kit, Loan, LoanView, Person } from './types'

export interface StoreValue {
  ready: boolean
  error: string | null
  items: Item[]
  people: Person[]
  kits: Kit[]
  /** Loans with units still out, soonest due first. */
  openLoans: LoanView[]
  /** Recent loan records including returned ones, newest checkout first. */
  history: LoanView[]
  itemsById: Map<string, Item>
  peopleById: Map<string, Person>
  kitsById: Map<string, Kit>
  /** Open loans keyed by item, for the "who has it" list on an item. */
  openLoansByItem: Map<string, LoanView[]>
  /** Open loans keyed by person. */
  openLoansByPerson: Map<string, LoanView[]>
}

/** Exported so tests can inject a fixture store without touching Firebase. */
export const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [kits, setKits] = useState<Kit[]>([])
  const [openLoansRaw, setOpenLoansRaw] = useState<Loan[]>([])
  const [historyRaw, setHistoryRaw] = useState<Loan[]>([])
  const [loaded, setLoaded] = useState({
    items: false,
    people: false,
    kits: false,
    loans: false,
    history: false,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false
    const unsubs: Array<() => void> = []

    const fail = (err: Error) => {
      if (!cancelled) setError(describeFirebaseError(err))
    }

    ensureSignedIn()
      .then(() => {
        if (cancelled) return
        unsubs.push(
          watchItems((rows) => {
            setItems(rows)
            setLoaded((s) => ({ ...s, items: true }))
          }, fail),
          watchPeople((rows) => {
            setPeople(rows)
            setLoaded((s) => ({ ...s, people: true }))
          }, fail),
          watchKits((rows) => {
            setKits(rows)
            setLoaded((s) => ({ ...s, kits: true }))
          }, fail),
          watchOpenLoans((rows) => {
            setOpenLoansRaw(rows)
            setLoaded((s) => ({ ...s, loans: true }))
          }, fail),
          watchLoanHistory((rows) => {
            setHistoryRaw(rows)
            setLoaded((s) => ({ ...s, history: true }))
          }, fail),
        )
      })
      .catch((err: Error) => fail(err))

    return () => {
      cancelled = true
      unsubs.forEach((u) => u())
    }
  }, [])

  const value = useMemo<StoreValue>(() => {
    const openLoans = openLoansRaw.map(toLoanView).sort(byDueDate)
    const history = historyRaw.map(toLoanView)

    const openLoansByItem = new Map<string, LoanView[]>()
    const openLoansByPerson = new Map<string, LoanView[]>()
    for (const loan of openLoans) {
      push(openLoansByItem, loan.itemId, loan)
      push(openLoansByPerson, loan.personId, loan)
    }

    return {
      ready: loaded.items && loaded.people && loaded.kits && loaded.loans && loaded.history,
      error,
      items,
      people,
      kits,
      openLoans,
      history,
      itemsById: new Map(items.map((i) => [i.id, i])),
      peopleById: new Map(people.map((p) => [p.id, p])),
      kitsById: new Map(kits.map((k) => [k.id, k])),
      openLoansByItem,
      openLoansByPerson,
    }
  }, [items, people, kits, openLoansRaw, historyRaw, loaded, error])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}

/** Overdue first, then soonest due; loans without a due date sit at the end. */
function byDueDate(a: LoanView, b: LoanView): number {
  const aDue = a.dueAt?.toMillis() ?? Number.POSITIVE_INFINITY
  const bDue = b.dueAt?.toMillis() ?? Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  return (b.checkedOutAt?.toMillis() ?? 0) - (a.checkedOutAt?.toMillis() ?? 0)
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key)
  if (existing) existing.push(value)
  else map.set(key, [value])
}

/** Turns Firebase's error codes into something a studio manager can act on. */
export function describeFirebaseError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  const message = (err as { message?: string })?.message ?? String(err)

  if (code.includes('permission-denied') || code.includes('unauthorized')) {
    return 'Permission denied by Firebase. Check that firestore.rules is deployed (firebase deploy --only firestore:rules).'
  }
  if (code.includes('unavailable') || code.includes('network')) {
    return 'Cannot reach Firebase. Check your connection — changes you make will sync when it comes back.'
  }
  if (code.includes('auth/admin-restricted-operation') || code.includes('auth/operation-not-allowed')) {
    return 'Anonymous sign-in is not enabled. Firebase console → Authentication → Sign-in method → enable Anonymous.'
  }
  if (code.includes('failed-precondition') && message.includes('index')) {
    return `Firestore needs an index for this query. ${message}`
  }
  return message
}
