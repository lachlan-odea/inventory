import { useMemo, useState } from 'react'
import { useStore, describeFirebaseError } from '../lib/store'
import { PersonDialog } from '../components/PersonDialog'
import { CheckInDialog } from '../components/CheckInDialog'
import { ImportDialog } from '../components/ImportDialog'
import { Avatar, DueBadge, EmptyState } from '../components/ui'
import { deletePerson, setPersonArchived } from '../lib/db'
import { useToast } from '../components/Toast'
import { formatDate, plural } from '../lib/format'
import type { LoanView, Person } from '../lib/types'

export function People() {
  const { people, openLoansByPerson, history } = useStore()
  const toast = useToast()

  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState<Person | null>(null)
  const [checkingIn, setCheckingIn] = useState<LoanView | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const roles = useMemo(
    () => [...new Set(people.map((p) => p.role).filter(Boolean))].sort(),
    [people],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return people.filter((p) => {
      if (p.archived !== showArchived) return false
      if (!q) return true
      return [p.name, p.email, p.role, p.phone].join(' ').toLowerCase().includes(q)
    })
  }, [people, search, showArchived])

  async function toggleArchive(person: Person) {
    const holding = openLoansByPerson.get(person.id) ?? []
    if (!person.archived && holding.length > 0) {
      toast.error(`${person.name} still has gear checked out — check it in first.`)
      return
    }
    try {
      await setPersonArchived(person.id, !person.archived)
      toast.success(person.archived ? `${person.name} restored.` : `${person.name} archived.`)
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  async function remove(person: Person) {
    const everBorrowed = history.some((l) => l.personId === person.id)
    if (everBorrowed) {
      toast.error('This person has borrowing history — archive them instead of deleting.')
      return
    }
    if (!window.confirm(`Delete ${person.name}?`)) return
    try {
      await deletePerson(person.id)
      toast.success('Person deleted.')
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>People</h1>
          <p className="muted">
            {plural(people.filter((p) => !p.archived).length, 'borrower')} on the list
          </p>
        </div>
        <div className="btn-row">
          <button className="btn btn--ghost" onClick={() => setImporting(true)}>
            Import from Excel
          </button>
          <button className="btn btn--primary" onClick={() => setAdding(true)}>
            Add person
          </button>
        </div>
      </header>

      <div className="toolbar">
        <input
          type="search"
          className="toolbar__search"
          placeholder="Search name, email, role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Archived
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={people.length === 0 ? '👥' : '🔍'}
          title={people.length === 0 ? 'No borrowers yet' : 'Nothing matches'}
          message={
            people.length === 0
              ? 'Add the people who borrow studio gear so you can attribute checkouts to them.'
              : 'Try a different search.'
          }
          action={
            people.length === 0 ? (
              <div className="btn-row">
                <button className="btn btn--primary" onClick={() => setImporting(true)}>
                  Import from Excel
                </button>
                <button className="btn btn--ghost" onClick={() => setAdding(true)}>
                  Add one by hand
                </button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <ul className="person-list">
          {visible.map((person) => {
            const loans = openLoansByPerson.get(person.id) ?? []
            const unitsOut = loans.reduce((sum, l) => sum + l.outstandingQty, 0)
            const overdue = loans.filter((l) => l.isOverdue).length
            const isOpen = expanded === person.id
            return (
              <li key={person.id} className={`person-card${overdue ? ' is-overdue' : ''}`}>
                <div className="person-card__row">
                  <Avatar name={person.name} />
                  <div className="person-card__main">
                    <strong>{person.name}</strong>
                    <p className="muted">
                      {[person.role, person.email, person.phone].filter(Boolean).join(' · ') ||
                        'No contact details'}
                    </p>
                  </div>
                  <div className="person-card__status">
                    {unitsOut > 0 ? (
                      <button
                        className={`badge badge--${overdue ? 'overdue' : 'partial'} badge--button`}
                        onClick={() => setExpanded(isOpen ? null : person.id)}
                      >
                        {plural(unitsOut, 'unit')} out
                        {overdue > 0 ? ` · ${overdue} overdue` : ''}
                      </button>
                    ) : (
                      <span className="badge badge--muted">Nothing out</span>
                    )}
                  </div>
                  <div className="person-card__actions">
                    <button className="btn btn--small" onClick={() => setEditing(person)}>
                      Edit
                    </button>
                    <button className="btn btn--small btn--ghost" onClick={() => toggleArchive(person)}>
                      {person.archived ? 'Restore' : 'Archive'}
                    </button>
                    {person.archived && (
                      <button
                        className="btn btn--small btn--ghost btn--danger"
                        onClick={() => remove(person)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && loans.length > 0 && (
                  <ul className="loan-list loan-list--compact person-card__loans">
                    {loans.map((loan) => (
                      <li key={loan.id} className={loan.isOverdue ? 'is-overdue' : undefined}>
                        <div className="loan-list__main">
                          <strong>{loan.itemName}</strong>
                          <p className="muted">
                            {plural(loan.outstandingQty, 'unit')} · since{' '}
                            {formatDate(loan.checkedOutAt)}
                          </p>
                        </div>
                        <DueBadge loan={loan} />
                        <button className="btn btn--small" onClick={() => setCheckingIn(loan)}>
                          Check in
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {adding && <PersonDialog roles={roles} onClose={() => setAdding(false)} />}
      {importing && <ImportDialog kind="people" onClose={() => setImporting(false)} />}
      {editing && (
        <PersonDialog person={editing} roles={roles} onClose={() => setEditing(null)} />
      )}
      {checkingIn && <CheckInDialog loan={checkingIn} onClose={() => setCheckingIn(null)} />}
    </div>
  )
}
