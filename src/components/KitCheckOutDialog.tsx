import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Field, ItemThumb } from './ui'
import { useStore, describeFirebaseError } from '../lib/store'
import { checkOutKit } from '../lib/db'
import { kitStatus } from '../lib/kits'
import { useToast } from './Toast'
import { plural, toDateInputValue } from '../lib/format'
import type { Kit } from '../lib/types'

interface Props {
  kit: Kit
  onClose: () => void
}

/** Same default as a single-item checkout. */
const DEFAULT_LOAN_DAYS = 7

export function KitCheckOutDialog({ kit, onClose }: Props) {
  const { people, itemsById } = useStore()
  const toast = useToast()

  const [personId, setPersonId] = useState('')
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + DEFAULT_LOAN_DAYS)
    return toDateInputValue(d)
  })
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status = useMemo(() => kitStatus(kit, itemsById), [kit, itemsById])
  const activePeople = useMemo(() => people.filter((p) => !p.archived), [people])
  const notFit = status.lines.filter((l) => l.item?.fitForService === false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!personId) return setError('Pick who is taking it.')
    if (!status.ready) return setError('Some items in this kit aren’t available — see the list above.')

    setBusy(true)
    try {
      await checkOutKit({ kitId: kit.id, personId, dueDate, notes })
      const personName = activePeople.find((p) => p.id === personId)?.name ?? 'them'
      toast.success(`${kit.name} checked out to ${personName}.`)
      onClose()
    } catch (err) {
      setError(describeFirebaseError(err))
    } finally {
      setBusy(false)
    }
  }

  const noPeople = activePeople.length === 0

  return (
    <Modal
      title={`Check out ${kit.name}`}
      subtitle={`${plural(status.lines.length, 'item')} · ${plural(status.totalUnits, 'unit')} go out together.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="kit-checkout-form"
            className="btn btn--primary"
            disabled={busy || noPeople || !status.ready}
          >
            {busy ? 'Checking out…' : 'Check out kit'}
          </button>
        </>
      }
    >
      {noPeople && (
        <p className="form-error">
          No one is on the borrower list yet — add people on the People tab first.
        </p>
      )}
      {!status.ready && status.lines.length > 0 && (
        <p className="callout callout--warn">
          <strong>This kit can't go out right now.</strong> {plural(status.blocked.length, 'item')}{' '}
          {status.blocked.length === 1 ? 'is' : 'are'} short. Check them in, or edit the kit.
        </p>
      )}

      <ul className="kit-lines">
        {status.lines.map((line) => (
          <li key={line.itemId} className={line.problem ? 'is-blocked' : undefined}>
            {line.item ? (
              <ItemThumb item={line.item} size={36} />
            ) : (
              <span className="thumb thumb--empty">📦</span>
            )}
            <div className="kit-lines__main">
              <strong>{line.item?.name ?? 'Deleted item'}</strong>
              <p className="muted small">
                {line.item?.idNumber ? `${line.item.idNumber} · ` : ''}
                {line.item?.accessories ? `with ${line.item.accessories}` : ''}
              </p>
            </div>
            <span className="kit-lines__count">×{line.needed}</span>
            {line.problem ? (
              <span className="badge badge--out">{line.problem}</span>
            ) : (
              <span className="badge badge--in">{line.available} available</span>
            )}
          </li>
        ))}
      </ul>

      {notFit.length > 0 && (
        <p className="callout callout--warn">
          <strong>
            {notFit.map((l) => l.item!.name).join(', ')} {notFit.length === 1 ? 'is' : 'are'} marked
            not fit for service.
          </strong>{' '}
          Check with the studio before the kit leaves.
        </p>
      )}

      <form id="kit-checkout-form" onSubmit={submit} className="form">
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

        <Field label="Due back" hint="Leave blank for an open-ended loan">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>

        <Field label="Notes" hint="Recorded on every item in the kit">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
