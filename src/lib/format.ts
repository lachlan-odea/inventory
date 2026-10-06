import type { Timestamp } from 'firebase/firestore'
import type { Loan, LoanView } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export function toDate(ts: Timestamp | null | undefined): Date | null {
  return ts ? ts.toDate() : null
}

export function formatDate(ts: Timestamp | null | undefined): string {
  const d = toDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(ts: Timestamp | null | undefined): string {
  const d = toDate(ts)
  if (!d) return '—'
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Formats a stored yyyy-mm-dd calendar date without going through UTC. */
export function formatDateString(value: string): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return value
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** "3 days ago", "in 2 days", "today" — relative to midnight boundaries. */
export function relativeDays(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days > 0) return `in ${days} days`
  return `${Math.abs(days)} days ago`
}

/** Whole days between today and `date`, counting from local midnight. */
export function daysFromToday(date: Date): number {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTarget = new Date(date)
  startOfTarget.setHours(0, 0, 0, 0)
  return Math.round((startOfTarget.getTime() - startOfToday.getTime()) / DAY_MS)
}

/** Adds the fields the UI cares about but Firestore doesn't store. */
export function toLoanView(loan: Loan): LoanView {
  const outstandingQty = Math.max(0, loan.qty - loan.returnedQty)
  const due = toDate(loan.dueAt)
  const daysUntilDue = due ? daysFromToday(due) : null
  return {
    ...loan,
    outstandingQty,
    daysUntilDue,
    isOverdue: loan.status === 'out' && daysUntilDue !== null && daysUntilDue < 0,
  }
}

/** yyyy-mm-dd for <input type="date">, in local time (not UTC — that shifts the day). */
export function toDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parses a yyyy-mm-dd input value as end-of-day local time — due "on the 5th"
 *  means anything returned during the 5th is on time. */
export function parseDueDate(value: string): Date | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 23, 59, 59, 999)
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}
