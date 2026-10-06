import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, describeFirebaseError } from '../lib/store'
import { CheckInDialog } from '../components/CheckInDialog'
import { DueBadge, EmptyState } from '../components/ui'
import { extendLoan } from '../lib/db'
import { useToast } from '../components/Toast'
import { formatDate, formatDateTime, plural, toDateInputValue } from '../lib/format'
import type { LoanView } from '../lib/types'

type Filter = 'out' | 'overdue' | 'returned' | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'out', label: 'Currently out' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'returned', label: 'Returned' },
  { value: 'all', label: 'All activity' },
]

export function Loans() {
  const { openLoans, history } = useStore()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('out')
  const [search, setSearch] = useState('')
  const [checkingIn, setCheckingIn] = useState<LoanView | null>(null)
  const [extending, setExtending] = useState<LoanView | null>(null)

  const rows = useMemo(() => {
    // Open loans come from the live subscription; returned ones from history.
    // History is capped, so an open loan older than the cap still shows up here.
    const openIds = new Set(openLoans.map((l) => l.id))
    const base =
      filter === 'out'
        ? openLoans
        : filter === 'overdue'
          ? openLoans.filter((l) => l.isOverdue)
          : filter === 'returned'
            ? history.filter((l) => l.status === 'returned')
            : [...openLoans, ...history.filter((l) => !openIds.has(l.id))].sort(
                (a, b) => (b.checkedOutAt?.toMillis() ?? 0) - (a.checkedOutAt?.toMillis() ?? 0),
              )

    const q = search.trim().toLowerCase()
    if (!q) return base
    return base.filter((l) =>
      [l.itemName, l.kitName ?? '', l.personName, l.checkoutNotes, l.returnNotes]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [filter, search, openLoans, history])

  function exportCsv() {
    const header = [
      'Item',
      'Kit',
      'Borrower',
      'Qty',
      'Returned qty',
      'Status',
      'Checked out',
      'Due',
      'Returned',
      'Condition on return',
      'Checkout notes',
      'Return notes',
    ]
    const lines = rows.map((l) => [
      l.itemName,
      l.kitName ?? '',
      l.personName,
      l.qty,
      l.returnedQty,
      l.status,
      formatDateTime(l.checkedOutAt),
      formatDate(l.dueAt),
      formatDateTime(l.returnedAt),
      l.returnCondition ?? '',
      l.checkoutNotes,
      l.returnNotes,
    ])
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `studio-inventory-${filter}-${toDateInputValue(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Loans</h1>
          <p className="muted">Every check-out and check-in, newest first.</p>
        </div>
        <button className="btn btn--ghost" onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </button>
      </header>

      <div className="toolbar">
        <div className="segmented">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={filter === f.value ? 'is-on' : undefined}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="toolbar__search"
          placeholder="Search item, person, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={filter === 'overdue' ? '🎉' : '📋'}
          title={filter === 'overdue' ? 'Nothing overdue' : 'Nothing here'}
          message={
            filter === 'overdue'
              ? 'Every loan is either on time or already back.'
              : 'Check some gear out and it will show up here.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Borrower</th>
                <th>Qty</th>
                <th>Out</th>
                <th>Due</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((loan) => (
                <tr key={loan.id} className={loan.isOverdue ? 'is-overdue' : undefined}>
                  <td>
                    <Link className="link" to={`/inventory/${loan.itemId}`}>
                      {loan.itemName}
                    </Link>
                    {loan.kitName && <p className="muted small">🧰 {loan.kitName}</p>}
                    {loan.returnNotes && <p className="muted small">“{loan.returnNotes}”</p>}
                  </td>
                  <td>{loan.personName}</td>
                  <td>
                    {loan.qty}
                    {loan.returnedQty > 0 && loan.status === 'out' && (
                      <span className="muted small"> ({loan.returnedQty} back)</span>
                    )}
                  </td>
                  <td>{formatDate(loan.checkedOutAt)}</td>
                  <td>{loan.status === 'out' ? <DueBadge loan={loan} /> : formatDate(loan.dueAt)}</td>
                  <td>
                    {loan.status === 'returned' ? (
                      <span className="badge badge--in">
                        Returned {formatDate(loan.returnedAt)}
                      </span>
                    ) : (
                      <span className="badge badge--out">
                        {plural(loan.outstandingQty, 'unit')} out
                      </span>
                    )}
                  </td>
                  <td className="table__actions">
                    {loan.status === 'out' && (
                      <>
                        <button className="btn btn--small btn--ghost" onClick={() => setExtending(loan)}>
                          Due date
                        </button>
                        <button className="btn btn--small" onClick={() => setCheckingIn(loan)}>
                          Check in
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checkingIn && <CheckInDialog loan={checkingIn} onClose={() => setCheckingIn(null)} />}
      {extending && (
        <DueDateDialog
          loan={extending}
          onClose={() => setExtending(null)}
          onSave={async (value) => {
            try {
              await extendLoan(extending.id, value)
              toast.success(value ? 'Due date updated.' : 'Due date cleared.')
              setExtending(null)
            } catch (err) {
              toast.error(describeFirebaseError(err))
            }
          }}
        />
      )}
    </div>
  )
}

function DueDateDialog({
  loan,
  onClose,
  onSave,
}: {
  loan: LoanView
  onClose: () => void
  onSave: (value: string) => void
}) {
  const [value, setValue] = useState(
    loan.dueAt ? toDateInputValue(loan.dueAt.toDate()) : toDateInputValue(new Date()),
  )
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--slim" role="dialog" aria-modal="true" aria-label="Change due date">
        <header className="modal__head">
          <div>
            <h2>Change due date</h2>
            <p className="modal__subtitle">
              {loan.itemName} · {loan.personName}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal__body">
          <label className="field">
            <span className="field__label">Due back</span>
            <input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
            <span className="field__hint">Clear the date for an open-ended loan.</span>
          </label>
        </div>
        <footer className="modal__foot">
          <button className="btn btn--ghost" onClick={() => onSave('')}>
            No due date
          </button>
          <button className="btn btn--primary" onClick={() => onSave(value)}>
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
