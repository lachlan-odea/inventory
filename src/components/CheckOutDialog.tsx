import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Field, ItemThumb } from './ui'
import { useStore, describeFirebaseError } from '../lib/store'
import { checkOut } from '../lib/db'
import { useToast } from './Toast'
import { toDateInputValue } from '../lib/format'
import type { Item } from '../lib/types'

interface Props {
  /** Pre-selected item, when opened from an item row. */
  item?: Item
  onClose: () => void
}

/** Default loan length. Studios mostly lend for a shoot week. */
const DEFAULT_LOAN_DAYS = 7

export function CheckOutDialog({ item, onClose }: Props) {
  const { items, people } = useStore()
  const toast = useToast()

  const [itemId, setItemId] = useState(item?.id ?? '')
  const [personId, setPersonId] = useState('')
  const [qty, setQty] = useState(1)
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + DEFAULT_LOAN_DAYS)
    return toDateInputValue(d)
  })
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableItems = useMemo(
    () => items.filter((i) => !i.archived && (i.availableQty > 0 || i.id === itemId)),
    [items, itemId],
  )
  const activePeople = useMemo(() => people.filter((p) => !p.archived), [people])
  const selected = items.find((i) => i.id === itemId) ?? null
  const maxQty = selected?.availableQty ?? 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!itemId) return setError('Pick an item.')
    if (!personId) return setError('Pick who is taking it.')
    if (qty < 1) return setError('Quantity must be at least 1.')
    if (qty > maxQty) return setError(`Only ${maxQty} available.`)

    setBusy(true)
    try {
      await checkOut({ itemId, personId, qty, dueDate, notes })
      const personName = activePeople.find((p) => p.id === personId)?.name ?? 'them'
      toast.success(`${selected?.name} checked out to ${personName}.`)
      onClose()
    } catch (err) {
      setError(describeFirebaseError(err))
    } finally {
      setBusy(false)
    }
  }

  const noPeople = activePeople.length === 0
  const noItems = availableItems.length === 0

  return (
    <Modal
      title="Check out"
      subtitle="Record who is taking gear and when it's due back."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="checkout-form"
            className="btn btn--primary"
            disabled={busy || noPeople || noItems}
          >
            {busy ? 'Checking out…' : 'Check out'}
          </button>
        </>
      }
    >
      {noPeople && (
        <p className="form-error">
          No one is on the borrower list yet — add people on the People tab first.
        </p>
      )}
      {noItems && !noPeople && (
        <p className="form-error">Nothing is available to check out right now.</p>
      )}

      <form id="checkout-form" onSubmit={submit} className="form">
        <Field label="Item" required>
          <select
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value)
              setQty(1)
            }}
            required
          >
            <option value="">Select an item…</option>
            {availableItems.map((i) => (
              <option key={i.id} value={i.id}>
                {i.idNumber ? `${i.idNumber} — ` : ''}
                {i.name}
                {i.category ? ` · ${i.category}` : ''} ({i.availableQty} available)
              </option>
            ))}
          </select>
        </Field>

        {selected && (
          <>
            <div className="picked-item">
              <ItemThumb item={selected} size={52} />
              <div>
                <strong>{selected.name}</strong>
                <p className="muted">
                  {[selected.idNumber, selected.location].filter(Boolean).join(' · ')}
                  {selected.idNumber || selected.location ? ' · ' : ''}
                  {selected.availableQty} of {selected.totalQty} on the shelf
                </p>
                {selected.accessories && (
                  <p className="muted small">Goes out with: {selected.accessories}</p>
                )}
              </div>
            </div>
            {selected.fitForService === false && (
              <p className="callout callout--warn">
                <strong>{selected.name} is marked not fit for service.</strong> Check with the
                studio before it leaves — you can still record the loan if it's going out for
                repair.
              </p>
            )}
          </>
        )}

        <Field label="Borrower" required>
          <select value={personId} onChange={(e) => setPersonId(e.target.value)} required>
            <option value="">Select a person…</option>
            {activePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.role ? ` · ${p.role}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="form-row">
          <Field label="Quantity" hint={selected ? `${maxQty} available` : undefined} required>
            <input
              type="number"
              min={1}
              max={Math.max(1, maxQty)}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Due back" hint="Leave blank for an open-ended loan">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Notes" hint="Anything worth recording — shoot name, accessories included">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
