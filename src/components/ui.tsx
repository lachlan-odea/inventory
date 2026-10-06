import type { ReactNode } from 'react'
import { ITEM_CONDITIONS, type Item, type ItemCondition, type LoanView } from '../lib/types'
import { initials, plural, relativeDays } from '../lib/format'

/* ------------------------------------------------------------------- badges */

export function ConditionBadge({ condition }: { condition: ItemCondition | null }) {
  if (!condition) return null
  const label = ITEM_CONDITIONS.find((c) => c.value === condition)?.label ?? condition
  return <span className={`badge badge--condition-${condition}`}>{label}</span>
}

/** Availability at a glance: all in, partly out, or nothing on the shelf. */
export function StockBadge({ item }: { item: Item }) {
  if (item.archived) return <span className="badge badge--muted">Archived</span>
  if (item.totalQty === 0) return <span className="badge badge--muted">No stock</span>
  if (item.availableQty === 0) return <span className="badge badge--out">All out</span>
  if (item.availableQty < item.totalQty) {
    return (
      <span className="badge badge--partial">
        {item.availableQty} of {item.totalQty} in
      </span>
    )
  }
  return <span className="badge badge--in">{item.totalQty} in</span>
}

export function DueBadge({ loan }: { loan: LoanView }) {
  if (loan.daysUntilDue === null) return <span className="badge badge--muted">No due date</span>
  if (loan.isOverdue) {
    return <span className="badge badge--overdue">Overdue {relativeDays(loan.daysUntilDue)}</span>
  }
  if (loan.daysUntilDue <= 2) {
    return <span className="badge badge--due-soon">Due {relativeDays(loan.daysUntilDue)}</span>
  }
  return <span className="badge badge--muted">Due {relativeDays(loan.daysUntilDue)}</span>
}

/* ------------------------------------------------------------------ elements */

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{initials(name) || '?'}</span>
}

export function ItemThumb({ item, size = 44 }: { item: Item; size?: number }) {
  if (item.photoUrl) {
    return (
      <img
        className="thumb"
        src={item.photoUrl}
        alt=""
        loading="lazy"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span className="thumb thumb--empty" style={{ width: size, height: size }} aria-hidden="true">
      📦
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: string
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
}: {
  label: string
  value: number | string
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`stat stat--${tone}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </Tag>
  )
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string
  hint?: string
  children: ReactNode
  required?: boolean
}) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required && <span className="field__required" aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

/** Yes / No / Not recorded — the three states the spreadsheet actually has. */
export function TriStateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean | null
  onChange: (value: boolean | null) => void
}) {
  const options: Array<[boolean | null, string]> = [
    [true, 'Yes'],
    [false, 'No'],
    [null, 'Not recorded'],
  ]
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="chip-row">
        {options.map(([option, text]) => (
          <button
            key={text}
            type="button"
            className={`chip${value === option ? ` chip--on ${chipToneFor(option)}` : ''}`}
            onClick={() => onChange(option)}
            aria-pressed={value === option}
          >
            {text}
          </button>
        ))}
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  )
}

function chipToneFor(value: boolean | null): string {
  if (value === true) return 'chip--good'
  if (value === false) return 'chip--damaged'
  return 'chip--worn'
}

/** Only rendered when the answer is "no" — a yes needs no comment. */
export function ServiceBadge({ item }: { item: Item }) {
  if (item.fitForService !== false) return null
  return <span className="badge badge--overdue">Not fit for service</span>
}

export function YesNo({ value }: { value: boolean | null }) {
  if (value === null) return <span className="muted">Not recorded</span>
  return <>{value ? 'Yes' : 'No'}</>
}

export function LoanSummaryLine({ loan }: { loan: LoanView }) {
  return (
    <span className="loan-line">
      {plural(loan.outstandingQty, 'unit')} with <strong>{loan.personName}</strong>
    </span>
  )
}
