import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Field, ItemThumb } from './ui'
import { useStore, describeFirebaseError } from '../lib/store'
import { checkOutBooking, MAX_BOOKING_LINES } from '../lib/db'
import { useToast } from './Toast'
import { plural, toDateInputValue } from '../lib/format'
import type { Item, KitComponent } from '../lib/types'

interface Props {
  /** Pre-selected item, when opened from an item row. */
  item?: Item
  onClose: () => void
}

/** Default loan length. Studios mostly lend for a shoot week. */
const DEFAULT_LOAN_DAYS = 7

export function CheckOutDialog({ item, onClose }: Props) {
  const { items, people, itemsById } = useStore()
  const toast = useToast()

  const [lines, setLines] = useState<KitComponent[]>(() =>
    item ? [{ itemId: item.id, qty: 1 }] : [],
  )
  const [personId, setPersonId] = useState('')
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + DEFAULT_LOAN_DAYS)
    return toDateInputValue(d)
  })
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activePeople = useMemo(() => people.filter((p) => !p.archived), [people])
  const inBooking = useMemo(() => new Set(lines.map((l) => l.itemId)), [lines])
  const anyAvailable = useMemo(() => items.some((i) => !i.archived && i.availableQty > 0), [items])

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => !i.archived && i.availableQty > 0 && !inBooking.has(i.id))
      .filter(
        (i) =>
          !q ||
          [i.idNumber, i.name, i.category, i.modelNumber, i.serialNumber]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
      .slice(0, 30)
  }, [items, inBooking, search])

  const rows = lines.map((l) => {
    const it = itemsById.get(l.itemId) ?? null
    const available = it?.availableQty ?? 0
    let problem: string | null = null
    if (!it) problem = 'No longer in the inventory'
    else if (it.archived) problem = 'Archived'
    else if (available === 0) problem = 'All out'
    else if (!(l.qty >= 1)) problem = 'Enter a quantity'
    else if (l.qty > available) problem = `Only ${available} available`
    return { ...l, item: it, available, problem }
  })
  const blocked = rows.filter((r) => r.problem)
  const notFit = rows.filter((r) => r.item?.fitForService === false)
  const totalUnits = rows.reduce((sum, r) => sum + (r.qty >= 1 ? r.qty : 0), 0)

  const add = (itemId: string) => {
    setLines((ls) => [...ls, { itemId, qty: 1 }])
    setSearch('')
  }
  const remove = (itemId: string) => setLines((ls) => ls.filter((l) => l.itemId !== itemId))
  const setQty = (itemId: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, qty } : l)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (lines.length === 0) return setError('Add at least one item.')
    if (!personId) return setError('Pick who is taking it.')
    if (blocked.length) return setError('Fix the highlighted items before checking out.')

    setBusy(true)
    try {
      const count = await checkOutBooking({
        lines: lines.map((l) => ({ itemId: l.itemId, qty: Math.floor(l.qty) })),
        personId,
        dueDate,
        notes,
      })
      const personName = activePeople.find((p) => p.id === personId)?.name ?? 'them'
      const what = count === 1 ? (rows[0]?.item?.name ?? '1 item') : plural(count, 'item')
      toast.success(`${what} checked out to ${personName}.`)
      onClose()
    } catch (err) {
      setError(describeFirebaseError(err))
    } finally {
      setBusy(false)
    }
  }

  const noPeople = activePeople.length === 0
  const nothingToBook = !anyAvailable && lines.length === 0
  const full = lines.length >= MAX_BOOKING_LINES

  return (
    <Modal
      title="Check out"
      subtitle="Record who is taking gear and when it's due back. Add as many items as are going out together."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="checkout-form"
            className="btn btn--primary"
            disabled={busy || noPeople || lines.length === 0}
          >
            {busy
              ? 'Checking out…'
              : lines.length > 1
                ? `Check out ${plural(lines.length, 'item')}`
                : 'Check out'}
          </button>
        </>
      }
    >
      {noPeople && (
        <p className="form-error">
          No one is on the borrower list yet — add people on the People tab first.
        </p>
      )}
      {nothingToBook && !noPeople && (
        <p className="form-error">Nothing is available to check out right now.</p>
      )}

      <form id="checkout-form" onSubmit={submit} className="form">
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

        <div className="field">
          <span className="field__label">
            Items in this booking
            {lines.length > 0 && (
              <span className="muted">
                {' '}
                · {plural(lines.length, 'item')}, {plural(totalUnits, 'unit')}
              </span>
            )}
          </span>
          {lines.length === 0 ? (
            <p className="muted small">Nothing yet — search below and add each item going out.</p>
          ) : (
            <ul className="kit-lines">
              {rows.map((r) => (
                <li key={r.itemId} className={r.problem ? 'is-blocked' : undefined}>
                  {r.item ? (
                    <ItemThumb item={r.item} size={36} />
                  ) : (
                    <span className="thumb thumb--empty">📦</span>
                  )}
                  <div className="kit-lines__main">
                    <strong>{r.item?.name ?? 'Deleted item'}</strong>
                    <p className="muted small">
                      {r.item
                        ? [r.item.idNumber, r.item.location, `${r.available} available`]
                            .filter(Boolean)
                            .join(' · ')
                        : 'Remove this line'}
                    </p>
                    {r.item?.accessories && (
                      <p className="muted small">Goes out with: {r.item.accessories}</p>
                    )}
                  </div>
                  {r.problem && <span className="badge badge--out">{r.problem}</span>}
                  {r.available > 1 || r.qty > 1 ? (
                    <input
                      type="number"
                      className="kit-lines__qty"
                      min={1}
                      max={Math.max(1, r.available)}
                      value={Number.isNaN(r.qty) ? '' : r.qty}
                      onChange={(e) => setQty(r.itemId, e.target.valueAsNumber)}
                      aria-label={`Quantity of ${r.item?.name ?? 'item'}`}
                    />
                  ) : (
                    <span className="kit-lines__count">×1</span>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => remove(r.itemId)}
                    aria-label={`Remove ${r.item?.name ?? 'item'} from booking`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {notFit.length > 0 && (
          <p className="callout callout--warn">
            <strong>
              {notFit.map((r) => r.item!.name).join(', ')} {notFit.length === 1 ? 'is' : 'are'}{' '}
              marked not fit for service.
            </strong>{' '}
            Check with the studio before it leaves — you can still record the loan if it's going
            out for repair.
          </p>
        )}

        {!full && anyAvailable && (
          <div className="field">
            <span className="field__label">Add items</span>
            <input
              type="search"
              placeholder="Search ID, item, category, serial…"
              value={search}
              autoFocus={!item}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds the top match instead of submitting, so typing an
                // asset ID then Enter is a fast way to build the list.
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (search.trim() && candidates[0]) add(candidates[0].id)
              }}
              aria-label="Search items to add"
            />
            {candidates.length === 0 ? (
              <p className="muted small">
                {search.trim() ? 'No available items match.' : 'Everything available is already added.'}
              </p>
            ) : (
              <ul className="kit-picker">
                {candidates.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => add(i.id)}>
                      <span>
                        {i.idNumber ? `${i.idNumber} — ` : ''}
                        {i.name}
                        {i.category ? <span className="muted"> · {i.category}</span> : null}
                        <span className="muted"> ({i.availableQty} available)</span>
                      </span>
                      <span className="kit-picker__add" aria-hidden="true">
                        + Add
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="form-row">
          <Field label="Due back" hint="Leave blank for an open-ended loan">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Notes" hint="Shoot name, anything worth recording — saved on every item">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
