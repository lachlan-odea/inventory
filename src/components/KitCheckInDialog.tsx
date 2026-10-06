import { useState } from 'react'
import { Modal } from './Modal'
import { Field, ItemThumb } from './ui'
import { PhotoPicker } from './PhotoPicker'
import { checkInKit } from '../lib/db'
import { describeFirebaseError, useStore } from '../lib/store'
import { useToast } from './Toast'
import { formatDate, plural } from '../lib/format'
import type { KitCheckout } from '../lib/kits'
import { ITEM_CONDITIONS, type ItemCondition } from '../lib/types'

interface Props {
  checkout: KitCheckout
  onClose: () => void
}

interface Line {
  back: boolean
  condition: ItemCondition
}

/**
 * Returns a whole kit in one step. Every item is ticked by default; untick
 * anything that hasn't come back and it stays out on its own loan.
 */
export function KitCheckInDialog({ checkout, onClose }: Props) {
  const { itemsById } = useStore()
  const toast = useToast()

  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(checkout.loans.map((l) => [l.id, { back: true, condition: 'good' }])),
  )
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setLine = (loanId: string, patch: Partial<Line>) =>
    setLines((ls) => ({ ...ls, [loanId]: { ...ls[loanId]!, ...patch } }))
  const setAllConditions = (condition: ItemCondition) =>
    setLines((ls) =>
      Object.fromEntries(Object.entries(ls).map(([id, l]) => [id, { ...l, condition }])),
    )

  const returning = checkout.loans.filter((l) => lines[l.id]?.back)
  const staying = checkout.loans.length - returning.length
  const anyDamaged = returning.some((l) => {
    const c = lines[l.id]!.condition
    return c === 'damaged' || c === 'repair'
  })
  const first = checkout.loans[0]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (returning.length === 0) return setError('Tick at least one item that has come back.')
    if (anyDamaged && !notes.trim()) {
      return setError('Add a note describing the damage before checking this back in.')
    }

    setBusy(true)
    try {
      await checkInKit({
        kitCheckoutId: checkout.kitCheckoutId,
        returns: returning.map((l) => ({ loanId: l.id, condition: lines[l.id]!.condition })),
        notes,
        photo,
      })
      toast.success(
        staying === 0
          ? `${checkout.kitName} checked back in from ${checkout.personName}.`
          : `${plural(returning.length, 'item')} of ${checkout.kitName} back in — ${plural(staying, 'item')} still out.`,
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
      title={`Check in ${checkout.kitName}`}
      subtitle={`Out with ${checkout.personName}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="kit-checkin-form"
            className="btn btn--primary"
            disabled={busy || returning.length === 0}
          >
            {busy
              ? 'Checking in…'
              : staying === 0
                ? 'Check in whole kit'
                : `Check in ${plural(returning.length, 'item')}`}
          </button>
        </>
      }
    >
      {first && (
        <div className="loan-recap">
          <div>
            <span className="muted">Checked out</span>
            <strong>{formatDate(first.checkedOutAt)}</strong>
          </div>
          <div>
            <span className="muted">Due</span>
            <strong className={checkout.isOverdue ? 'text-bad' : undefined}>
              {formatDate(first.dueAt)}
            </strong>
          </div>
          <div>
            <span className="muted">Still out</span>
            <strong>{plural(checkout.loans.length, 'item')}</strong>
          </div>
        </div>
      )}

      {first?.checkoutNotes && (
        <p className="callout">
          <span className="muted">Checkout note:</span> {first.checkoutNotes}
        </p>
      )}

      <form id="kit-checkin-form" onSubmit={submit} className="form">
        <div className="field">
          <span className="field__label">Set every item to</span>
          <div className="chip-row">
            {ITEM_CONDITIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`chip chip--${c.value}`}
                onClick={() => setAllConditions(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="kit-lines">
          {checkout.loans.map((loan) => {
            const line = lines[loan.id]!
            const item = itemsById.get(loan.itemId)
            return (
              <li key={loan.id} className={line.back ? undefined : 'is-staying'}>
                <input
                  type="checkbox"
                  checked={line.back}
                  onChange={(e) => setLine(loan.id, { back: e.target.checked })}
                  aria-label={`${loan.itemName} has come back`}
                />
                {item ? <ItemThumb item={item} size={36} /> : <span className="thumb thumb--empty">📦</span>}
                <div className="kit-lines__main">
                  <strong>{loan.itemName}</strong>
                  <p className="muted small">
                    {plural(loan.outstandingQty, 'unit')}
                    {loan.returnedQty > 0 ? ` (${loan.returnedQty} already back)` : ''}
                    {line.back ? '' : ' · stays out'}
                  </p>
                </div>
                <select
                  value={line.condition}
                  disabled={!line.back}
                  onChange={(e) => setLine(loan.id, { condition: e.target.value as ItemCondition })}
                  aria-label={`Condition of ${loan.itemName}`}
                >
                  {ITEM_CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </li>
            )
          })}
        </ul>

        <Field
          label="Condition notes"
          hint={anyDamaged ? 'Required — describe what is wrong' : 'Optional — recorded on every item returned'}
        >
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Lens cap missing, one XLR jacket split near the connector…"
          />
        </Field>

        <PhotoPicker label="Condition photo" onChange={setPhoto} />

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
