import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Field, ItemThumb } from './ui'
import { createKit, updateKit } from '../lib/db'
import { normaliseComponents } from '../lib/kits'
import { describeFirebaseError, useStore } from '../lib/store'
import { useToast } from './Toast'
import type { Kit, KitComponent } from '../lib/types'

interface Props {
  /** Omit to build a new kit. */
  kit?: Kit
  onClose: () => void
}

export function KitDialog({ kit, onClose }: Props) {
  const { items, itemsById } = useStore()
  const toast = useToast()
  const editing = Boolean(kit)

  const [name, setName] = useState(kit?.name ?? '')
  const [description, setDescription] = useState(kit?.description ?? '')
  const [components, setComponents] = useState<KitComponent[]>(kit?.components ?? [])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inKit = useMemo(() => new Set(components.map((c) => c.itemId)), [components])

  // Items that can still be added: not archived, not already in the kit.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => !i.archived && !inKit.has(i.id))
      .filter(
        (i) =>
          !q ||
          [i.idNumber, i.name, i.category, i.modelNumber].join(' ').toLowerCase().includes(q),
      )
      .slice(0, 30)
  }, [items, inKit, search])

  const add = (itemId: string) => setComponents((cs) => [...cs, { itemId, qty: 1 }])
  const remove = (itemId: string) => setComponents((cs) => cs.filter((c) => c.itemId !== itemId))
  const setQty = (itemId: string, qty: number) =>
    setComponents((cs) => cs.map((c) => (c.itemId === itemId ? { ...c, qty } : c)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const clean = {
      name: name.trim(),
      description: description.trim(),
      components: normaliseComponents(components),
    }
    if (!clean.name) return setError('Give the kit a name.')
    if (clean.components.length === 0) return setError('Add at least one item to the kit.')

    setBusy(true)
    try {
      if (kit) {
        await updateKit(kit.id, clean)
        toast.success(`${clean.name} updated.`)
      } else {
        await createKit(clean)
        toast.success(`${clean.name} created.`)
      }
      onClose()
    } catch (err) {
      setError(describeFirebaseError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Edit kit' : 'New kit'}
      subtitle="A kit bundles items that usually go out together, so they can be checked out in one go."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="kit-form" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create kit'}
          </button>
        </>
      }
    >
      <form id="kit-form" onSubmit={submit} className="form">
        <Field label="Kit name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Interview kit"
            autoFocus
            required
          />
        </Field>

        <Field label="Description" hint="What it's for, or anything to know before taking it">
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="field">
          <span className="field__label">In this kit</span>
          {components.length === 0 ? (
            <p className="muted small">Nothing yet — add items from the list below.</p>
          ) : (
            <ul className="kit-lines">
              {components.map((c) => {
                const item = itemsById.get(c.itemId)
                return (
                  <li key={c.itemId}>
                    {item ? <ItemThumb item={item} size={36} /> : <span className="thumb thumb--empty">📦</span>}
                    <div className="kit-lines__main">
                      <strong>{item?.name ?? 'Deleted item'}</strong>
                      <p className="muted small">
                        {item
                          ? [item.idNumber, `${item.totalQty} owned`].filter(Boolean).join(' · ')
                          : 'Remove this line — the item is no longer in the inventory'}
                      </p>
                    </div>
                    <input
                      type="number"
                      className="kit-lines__qty"
                      min={1}
                      max={item ? Math.max(1, item.totalQty) : undefined}
                      value={c.qty}
                      onChange={(e) => setQty(c.itemId, Number(e.target.value))}
                      aria-label={`Quantity of ${item?.name ?? 'item'}`}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => remove(c.itemId)}
                      aria-label={`Remove ${item?.name ?? 'item'} from kit`}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="field">
          <span className="field__label">Add items</span>
          <input
            type="search"
            placeholder="Search ID, item, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {items.length === 0 ? (
            <p className="muted small">The inventory is empty — add items there first.</p>
          ) : candidates.length === 0 ? (
            <p className="muted small">No more items match.</p>
          ) : (
            <ul className="kit-picker">
              {candidates.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => add(i.id)}>
                    <span>
                      {i.idNumber ? `${i.idNumber} — ` : ''}
                      {i.name}
                      {i.category ? <span className="muted"> · {i.category}</span> : null}
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

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
