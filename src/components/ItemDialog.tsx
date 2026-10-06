import { useState } from 'react'
import { Modal } from './Modal'
import { Field, SuggestInput, TriStateField } from './ui'
import { PhotoPicker } from './PhotoPicker'
import { createItem, removeItemPhoto, setItemPhoto, updateItem } from '../lib/db'
import { describeFirebaseError } from '../lib/store'
import { useToast } from './Toast'
import {
  EMPTY_ITEM,
  ITEM_CONDITIONS,
  STUDIO_LOCATIONS,
  type Item,
  type ItemCondition,
  type NewItemInput,
} from '../lib/types'

interface Props {
  /** Omit to create a new item. */
  item?: Item
  /** Existing values, offered as autocomplete so spelling stays consistent. */
  categories: string[]
  locations: string[]
  onClose: () => void
}

export function ItemDialog({ item, categories, locations, onClose }: Props) {
  const toast = useToast()
  const editing = Boolean(item)

  const [form, setForm] = useState<NewItemInput>(() =>
    item
      ? {
          idNumber: item.idNumber,
          name: item.name,
          category: item.category,
          location: item.location,
          modelNumber: item.modelNumber,
          serialNumber: item.serialNumber,
          description: item.description,
          condition: item.condition,
          accessories: item.accessories,
          notes: item.notes,
          purchaseDate: item.purchaseDate,
          lastInspectionDate: item.lastInspectionDate,
          labelled: item.labelled,
          fitForService: item.fitForService,
          totalQty: item.totalQty,
        }
      : { ...EMPTY_ITEM },
  )
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof NewItemInput>(key: K, value: NewItemInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const onLoan = item ? item.totalQty - item.availableQty : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.name.trim()) return setError('Give the item a name.')
    if (!Number.isFinite(form.totalQty) || form.totalQty < 0) {
      return setError('Quantity must be zero or more.')
    }
    if (editing && form.totalQty < onLoan) {
      return setError(`${onLoan} of these are checked out — the total can't go below that.`)
    }

    setBusy(true)
    try {
      const clean = { ...form, name: form.name.trim(), totalQty: Math.floor(form.totalQty) }
      if (item) {
        await updateItem(item.id, clean)
        if (photo) await setItemPhoto(item.id, photo)
        toast.success(`${clean.name} updated.`)
      } else {
        await createItem(clean, photo)
        toast.success(`${clean.name} added to the inventory.`)
      }
      onClose()
    } catch (err) {
      setError(describeFirebaseError(err))
    } finally {
      setBusy(false)
    }
  }

  async function dropPhoto() {
    if (!item) return
    try {
      await removeItemPhoto(item.id)
      toast.info('Photo removed.')
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  return (
    <Modal
      title={editing ? 'Edit item' : 'Add item'}
      subtitle={editing ? item!.name : 'Add a piece of gear to the studio inventory.'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="item-form" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
          </button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="form">
        <div className="form-row">
          <Field label="ID Number" hint="e.g. STUDIO 102">
            <input
              value={form.idNumber}
              onChange={(e) => set('idNumber', e.target.value)}
              placeholder="STUDIO 000"
            />
          </Field>
          <Field label="Item" required>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Sony A6500"
              autoFocus
              required
            />
          </Field>
        </div>

        <div className="form-row">
          <Field label="Category">
            <SuggestInput
              value={form.category}
              onChange={(v) => set('category', v)}
              options={categories}
              placeholder="Camera"
            />
          </Field>
          <Field label="Studio Location">
            <SuggestInput
              value={form.location}
              onChange={(v) => set('location', v)}
              options={[...new Set([...STUDIO_LOCATIONS, ...locations])].sort()}
              placeholder="SYD"
            />
          </Field>
        </div>

        <div className="form-row">
          <Field label="Model Number">
            <input
              value={form.modelNumber}
              onChange={(e) => set('modelNumber', e.target.value)}
              placeholder="SONY ILCE-6500"
            />
          </Field>
          <Field label="Serial Number">
            <input
              value={form.serialNumber}
              onChange={(e) => set('serialNumber', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Description">
          <input
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Black"
          />
        </Field>

        <div className="form-row">
          <Field label="Condition">
            <select
              value={form.condition}
              onChange={(e) => set('condition', e.target.value as ItemCondition)}
            >
              {ITEM_CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Quantity"
            hint={
              editing && onLoan > 0
                ? `${onLoan} currently checked out`
                : 'Leave at 1 for a single asset'
            }
            required
          >
            <input
              type="number"
              min={editing ? onLoan : 0}
              value={form.totalQty}
              onChange={(e) => set('totalQty', Number(e.target.value))}
              required
            />
          </Field>
        </div>

        <Field label="Accessories" hint="What goes out with it">
          <input
            value={form.accessories}
            onChange={(e) => set('accessories', e.target.value)}
            placeholder="Shoulder Strap"
          />
        </Field>

        <div className="form-row">
          <Field label="Purchase date">
            <input
              type="date"
              value={form.purchaseDate}
              onChange={(e) => set('purchaseDate', e.target.value)}
            />
          </Field>
          <Field label="Last inspection date">
            <input
              type="date"
              value={form.lastInspectionDate}
              onChange={(e) => set('lastInspectionDate', e.target.value)}
            />
          </Field>
        </div>

        <div className="form-row">
          <TriStateField
            label="Labelled"
            value={form.labelled}
            onChange={(v) => set('labelled', v)}
          />
          <TriStateField
            label="Fit for Service"
            hint="Items marked No are flagged before checkout"
            value={form.fitForService}
            onChange={(v) => set('fitForService', v)}
          />
        </div>

        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <PhotoPicker
          currentUrl={item?.photoUrl ?? null}
          onChange={setPhoto}
          onRemoveExisting={item?.photoUrl ? dropPhoto : undefined}
        />

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
