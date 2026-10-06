import { useState } from 'react'
import { Modal } from './Modal'
import { Field } from './ui'
import { PhotoPicker } from './PhotoPicker'
import { checkIn } from '../lib/db'
import { describeFirebaseError } from '../lib/store'
import { useToast } from './Toast'
import { formatDate, plural } from '../lib/format'
import { ITEM_CONDITIONS, type ItemCondition, type LoanView } from '../lib/types'

interface Props {
  loan: LoanView
  onClose: () => void
}

export function CheckInDialog({ loan, onClose }: Props) {
  const toast = useToast()
  const [qty, setQty] = useState(loan.outstandingQty)
  const [condition, setCondition] = useState<ItemCondition>('good')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (qty < 1) return setError('Return at least one unit.')
    if (qty > loan.outstandingQty) {
      return setError(`Only ${plural(loan.outstandingQty, 'unit')} still out on this loan.`)
    }
    if ((condition === 'damaged' || condition === 'repair') && !notes.trim()) {
      return setError('Add a note describing the damage before checking this back in.')
    }

    setBusy(true)
    try {
      await checkIn({ loanId: loan.id, qty, condition, notes, photo })
      const partial = qty < loan.outstandingQty
      toast.success(
        partial
          ? `${plural(qty, 'unit')} of ${loan.itemName} back in — ${loan.outstandingQty - qty} still out.`
          : `${loan.itemName} checked back in from ${loan.personName}.`,
      )
      onClose()
    } catch (err) {
      setError(describeFirebaseError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Check in"
      subtitle={`${loan.itemName} — out with ${loan.personName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="checkin-form" className="btn btn--primary" disabled={busy}>
            {busy ? 'Checking in…' : 'Check in'}
          </button>
        </>
      }
    >
      <div className="loan-recap">
        <div>
          <span className="muted">Checked out</span>
          <strong>{formatDate(loan.checkedOutAt)}</strong>
        </div>
        <div>
          <span className="muted">Due</span>
          <strong className={loan.isOverdue ? 'text-bad' : undefined}>
            {formatDate(loan.dueAt)}
          </strong>
        </div>
        <div>
          <span className="muted">Still out</span>
          <strong>{plural(loan.outstandingQty, 'unit')}</strong>
        </div>
      </div>

      {loan.checkoutNotes && (
        <p className="callout">
          <span className="muted">Checkout note:</span> {loan.checkoutNotes}
        </p>
      )}

      <form id="checkin-form" onSubmit={submit} className="form">
        {loan.qty > 1 && (
          <Field
            label="How many are coming back?"
            hint="Return part of a loan now and the rest later"
            required
          >
            <input
              type="number"
              min={1}
              max={loan.outstandingQty}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              required
            />
          </Field>
        )}

        <Field label="Condition on return" required>
          <div className="chip-row">
            {ITEM_CONDITIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`chip${condition === c.value ? ' chip--on' : ''} chip--${c.value}`}
                onClick={() => setCondition(c.value)}
                aria-pressed={condition === c.value}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Condition notes"
          hint={
            condition === 'damaged' || condition === 'repair'
              ? 'Required — describe what is wrong'
              : 'Optional'
          }
        >
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Scuff on the barrel, cable jacket split near the connector…"
          />
        </Field>

        <PhotoPicker label="Condition photo" onChange={setPhoto} />

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
