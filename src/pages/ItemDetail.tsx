import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore, describeFirebaseError } from '../lib/store'
import { ItemDialog } from '../components/ItemDialog'
import { CheckOutDialog } from '../components/CheckOutDialog'
import { CheckInDialog } from '../components/CheckInDialog'
import { PhoneCameraDialog } from '../components/PhoneCameraDialog'
import {
  ConditionBadge,
  DueBadge,
  EmptyState,
  ServiceBadge,
  StockBadge,
  YesNo,
} from '../components/ui'
import { deleteItem, setItemArchived } from '../lib/db'
import { useToast } from '../components/Toast'
import { formatDate, formatDateString, formatDateTime, plural } from '../lib/format'
import type { LoanView } from '../lib/types'

export function ItemDetail() {
  const { itemId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { items, itemsById, openLoansByItem, history } = useStore()

  const [editing, setEditing] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkingIn, setCheckingIn] = useState<LoanView | null>(null)
  const [phonePhoto, setPhonePhoto] = useState(false)

  const item = itemsById.get(itemId)
  const openLoans = openLoansByItem.get(itemId) ?? []
  const itemHistory = useMemo(
    () => history.filter((l) => l.itemId === itemId),
    [history, itemId],
  )
  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
    [items],
  )
  const locations = useMemo(
    () => [...new Set(items.map((i) => i.location).filter(Boolean))].sort(),
    [items],
  )

  if (!item) {
    return (
      <div className="page">
        <EmptyState
          icon="🤷"
          title="Item not found"
          message="It may have been deleted, or the link is out of date."
          action={
            <Link className="btn btn--primary" to="/inventory">
              Back to inventory
            </Link>
          }
        />
      </div>
    )
  }

  const onLoan = item.totalQty - item.availableQty
  const everLoaned = itemHistory.length > 0

  async function toggleArchive() {
    try {
      await setItemArchived(item!.id, !item!.archived)
      toast.success(item!.archived ? 'Item restored.' : 'Item archived — hidden from checkout.')
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${item!.name}" permanently? This can't be undone.`)) return
    try {
      await deleteItem(item!.id)
      toast.success('Item deleted.')
      navigate('/inventory')
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  return (
    <div className="page">
      <Link className="back-link" to="/inventory">
        ← Inventory
      </Link>

      <header className="detail-head">
        {item.photoUrl ? (
          <img className="detail-photo" src={item.photoUrl} alt={item.name} />
        ) : (
          <div className="detail-photo detail-photo--empty" aria-hidden="true">
            📦
          </div>
        )}
        <div className="detail-head__body">
          <div className="detail-head__title">
            <h1>{item.name}</h1>
            <StockBadge item={item} />
            <ConditionBadge condition={item.condition} />
            <ServiceBadge item={item} />
          </div>
          {item.idNumber && <p className="detail-id">{item.idNumber}</p>}
          <p className="muted">
            {[item.category, item.location, item.modelNumber].filter(Boolean).join(' · ') ||
              'No category set'}
          </p>
          {item.description && <p className="detail-description">{item.description}</p>}

          <div className="btn-row">
            <button
              className="btn btn--primary"
              disabled={item.availableQty === 0 || item.archived}
              onClick={() => setCheckingOut(true)}
            >
              Check out
            </button>
            <button className="btn btn--ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn btn--ghost" onClick={() => setPhonePhoto(true)}>
              📱 Photo from phone
            </button>
            <button className="btn btn--ghost" onClick={toggleArchive}>
              {item.archived ? 'Restore' : 'Archive'}
            </button>
            {!everLoaned && onLoan === 0 && (
              <button className="btn btn--ghost btn--danger" onClick={remove}>
                Delete
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="detail-grid">
        <div className="panel">
          <h2>Details</h2>
          <dl className="kv kv--wide">
            <div>
              <dt>ID Number</dt>
              <dd>{item.idNumber || <span className="muted">—</span>}</dd>
            </div>
            <div>
              <dt>Model Number</dt>
              <dd>{item.modelNumber || <span className="muted">—</span>}</dd>
            </div>
            <div>
              <dt>Serial Number</dt>
              <dd>{item.serialNumber || <span className="muted">—</span>}</dd>
            </div>
            <div>
              <dt>Accessories</dt>
              <dd>{item.accessories || <span className="muted">—</span>}</dd>
            </div>
            <div>
              <dt>Purchase date</dt>
              <dd>{formatDateString(item.purchaseDate)}</dd>
            </div>
            <div>
              <dt>Last inspection</dt>
              <dd>{formatDateString(item.lastInspectionDate)}</dd>
            </div>
            <div>
              <dt>Labelled</dt>
              <dd>
                <YesNo value={item.labelled} />
              </dd>
            </div>
            <div>
              <dt>Fit for Service</dt>
              <dd className={item.fitForService === false ? 'text-bad' : undefined}>
                <YesNo value={item.fitForService} />
              </dd>
            </div>
          </dl>
          {item.notes && (
            <p className="callout">
              <span className="muted">Notes:</span> {item.notes}
            </p>
          )}
        </div>

        <div className="panel">
          <h2>Stock</h2>
          <dl className="kv">
            <div>
              <dt>Owned</dt>
              <dd>{plural(item.totalQty, 'unit')}</dd>
            </div>
            <div>
              <dt>On the shelf</dt>
              <dd>{item.availableQty}</dd>
            </div>
            <div>
              <dt>Checked out</dt>
              <dd className={onLoan > 0 ? 'text-warn' : undefined}>{onLoan}</dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{formatDate(item.createdAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="panel">
          <h2>Out right now</h2>
          {openLoans.length === 0 ? (
            <p className="muted pad">All units are on the shelf.</p>
          ) : (
            <ul className="loan-list loan-list--compact">
              {openLoans.map((loan) => (
                <li key={loan.id} className={loan.isOverdue ? 'is-overdue' : undefined}>
                  <div className="loan-list__main">
                    <strong>{loan.personName}</strong>
                    <p className="muted">
                      {plural(loan.outstandingQty, 'unit')} · since {formatDate(loan.checkedOutAt)}
                      {loan.returnedQty > 0 && ` · ${loan.returnedQty} already back`}
                    </p>
                    {loan.checkoutNotes && <p className="muted small">{loan.checkoutNotes}</p>}
                  </div>
                  <DueBadge loan={loan} />
                  <button className="btn btn--small" onClick={() => setCheckingIn(loan)}>
                    Check in
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>History</h2>
        {itemHistory.length === 0 ? (
          <p className="muted pad">This item has never been checked out.</p>
        ) : (
          <ul className="feed">
            {itemHistory.map((loan) => (
              <li key={loan.id}>
                <span className={`dot dot--${loan.status}`} aria-hidden="true" />
                <div>
                  <strong>{loan.personName}</strong> took {plural(loan.qty, 'unit')} ·{' '}
                  {formatDateTime(loan.checkedOutAt)}
                  <p className="muted">
                    {loan.status === 'returned'
                      ? `Returned ${formatDateTime(loan.returnedAt)}`
                      : `${plural(loan.outstandingQty, 'unit')} still out`}
                    {loan.returnCondition ? ` · condition: ${loan.returnCondition}` : ''}
                  </p>
                  {loan.returnNotes && <p className="muted small">“{loan.returnNotes}”</p>}
                  {loan.returnPhotoUrl && (
                    <a
                      className="link small"
                      href={loan.returnPhotoUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View condition photo
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <ItemDialog
          item={item}
          categories={categories}
          locations={locations}
          onClose={() => setEditing(false)}
        />
      )}
      {checkingOut && <CheckOutDialog item={item} onClose={() => setCheckingOut(false)} />}
      {checkingIn && <CheckInDialog loan={checkingIn} onClose={() => setCheckingIn(null)} />}
      {phonePhoto && (
        <PhoneCameraDialog items={[item]} label={item.idNumber || item.name} onClose={() => setPhonePhoto(false)} />
      )}
    </div>
  )
}
