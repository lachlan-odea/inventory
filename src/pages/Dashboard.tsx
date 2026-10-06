import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store'
import { CheckOutDialog } from '../components/CheckOutDialog'
import { CheckInDialog } from '../components/CheckInDialog'
import { Avatar, DueBadge, EmptyState, ItemThumb, StatCard } from '../components/ui'
import { formatDate, plural } from '../lib/format'
import type { LoanView } from '../lib/types'

export function Dashboard() {
  const { items, people, openLoans, history } = useStore()
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkingIn, setCheckingIn] = useState<LoanView | null>(null)

  const stats = useMemo(() => {
    const active = items.filter((i) => !i.archived)
    const unitsOut = openLoans.reduce((sum, l) => sum + l.outstandingQty, 0)
    const overdue = openLoans.filter((l) => l.isOverdue)
    const dueSoon = openLoans.filter(
      (l) => !l.isOverdue && l.daysUntilDue !== null && l.daysUntilDue <= 2,
    )
    return {
      itemCount: active.length,
      unitsTotal: active.reduce((sum, i) => sum + i.totalQty, 0),
      unitsOut,
      overdue,
      dueSoon,
      borrowers: new Set(openLoans.map((l) => l.personId)).size,
    }
  }, [items, openLoans])

  const recentReturns = useMemo(
    () =>
      history
        .filter((l) => l.status === 'returned')
        .sort((a, b) => (b.returnedAt?.toMillis() ?? 0) - (a.returnedAt?.toMillis() ?? 0))
        .slice(0, 6),
    [history],
  )

  const emptyStudio = items.length === 0 && people.length === 0

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Today</h1>
          <p className="muted">What's out, what's late, what's coming back.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setCheckingOut(true)}>
          Check out gear
        </button>
      </header>

      {emptyStudio ? (
        <EmptyState
          icon="🎬"
          title="Let's set up the studio"
          message="Add the gear you own and the people who borrow it, then start checking things in and out."
          action={
            <div className="btn-row">
              <Link className="btn btn--primary" to="/inventory">
                Add inventory
              </Link>
              <Link className="btn btn--ghost" to="/people">
                Add people
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <section className="stats">
            <StatCard label="Items tracked" value={stats.itemCount} hint={`${stats.unitsTotal} units total`} />
            <StatCard
              label="Units out"
              value={stats.unitsOut}
              hint={stats.borrowers ? `with ${plural(stats.borrowers, 'person', 'people')}` : 'all in'}
              tone={stats.unitsOut > 0 ? 'warn' : 'good'}
            />
            <StatCard
              label="Overdue"
              value={stats.overdue.length}
              hint={stats.overdue.length ? 'needs chasing' : 'nothing late'}
              tone={stats.overdue.length ? 'bad' : 'good'}
            />
            <StatCard
              label="Due in 48h"
              value={stats.dueSoon.length}
              hint="coming back soon"
              tone={stats.dueSoon.length ? 'warn' : 'neutral'}
            />
          </section>

          {stats.overdue.length > 0 && (
            <section className="panel panel--alert">
              <h2>Overdue</h2>
              <LoanList loans={stats.overdue} onCheckIn={setCheckingIn} />
            </section>
          )}

          <section className="panel">
            <div className="panel__head">
              <h2>Currently out</h2>
              <Link className="link" to="/loans">
                View all activity →
              </Link>
            </div>
            {openLoans.length === 0 ? (
              <EmptyState
                icon="✅"
                title="Everything is on the shelf"
                message="No gear is checked out right now."
              />
            ) : (
              <LoanList
                loans={openLoans.filter((l) => !l.isOverdue)}
                onCheckIn={setCheckingIn}
                emptyNote="Everything still out is overdue — see above."
              />
            )}
          </section>

          {recentReturns.length > 0 && (
            <section className="panel">
              <h2>Recently returned</h2>
              <ul className="feed">
                {recentReturns.map((loan) => (
                  <li key={loan.id}>
                    <Avatar name={loan.personName} />
                    <div>
                      <strong>{loan.itemName}</strong> back from {loan.personName}
                      <p className="muted">
                        {formatDate(loan.returnedAt)}
                        {loan.returnCondition && loan.returnCondition !== 'good'
                          ? ` · returned ${loan.returnCondition}`
                          : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {checkingOut && <CheckOutDialog onClose={() => setCheckingOut(false)} />}
      {checkingIn && <CheckInDialog loan={checkingIn} onClose={() => setCheckingIn(null)} />}
    </div>
  )
}

function LoanList({
  loans,
  onCheckIn,
  emptyNote,
}: {
  loans: LoanView[]
  onCheckIn: (loan: LoanView) => void
  emptyNote?: string
}) {
  const { itemsById } = useStore()

  if (loans.length === 0 && emptyNote) return <p className="muted pad">{emptyNote}</p>

  return (
    <ul className="loan-list">
      {loans.map((loan) => {
        const item = itemsById.get(loan.itemId)
        return (
          <li key={loan.id} className={loan.isOverdue ? 'is-overdue' : undefined}>
            {item ? <ItemThumb item={item} /> : <span className="thumb thumb--empty">📦</span>}
            <div className="loan-list__main">
              <Link to={`/inventory/${loan.itemId}`} className="loan-list__title">
                {loan.itemName}
              </Link>
              <p className="muted">
                {plural(loan.outstandingQty, 'unit')} with {loan.personName} · out since{' '}
                {formatDate(loan.checkedOutAt)}
              </p>
            </div>
            <DueBadge loan={loan} />
            <button className="btn btn--small" onClick={() => onCheckIn(loan)}>
              Check in
            </button>
          </li>
        )
      })}
    </ul>
  )
}
