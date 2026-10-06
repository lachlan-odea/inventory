import { useState } from 'react'
import { Modal } from './Modal'
import { Field } from './ui'
import { createPerson, updatePerson } from '../lib/db'
import { describeFirebaseError } from '../lib/store'
import { useToast } from './Toast'
import type { NewPersonInput, Person } from '../lib/types'

interface Props {
  /** Omit to add someone new. */
  person?: Person
  roles: string[]
  onClose: () => void
}

export function PersonDialog({ person, roles, onClose }: Props) {
  const toast = useToast()
  const editing = Boolean(person)

  const [form, setForm] = useState<NewPersonInput>({
    name: person?.name ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    role: person?.role ?? '',
    notes: person?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof NewPersonInput>(key: K, value: NewPersonInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError('A name is required.')

    setBusy(true)
    try {
      const clean = { ...form, name: form.name.trim() }
      if (person) {
        await updatePerson(person.id, clean)
        toast.success(`${clean.name} updated.`)
      } else {
        await createPerson(clean)
        toast.success(`${clean.name} added.`)
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
      title={editing ? 'Edit person' : 'Add person'}
      subtitle="People on this list can be picked as borrowers at checkout."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="person-form" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add person'}
          </button>
        </>
      }
    >
      <form id="person-form" onSubmit={submit} className="form">
        <Field label="Name" required>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus required />
        </Field>

        <div className="form-row">
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
        </div>

        <Field label="Role" hint="Producer, Editor, Contractor…">
          <input value={form.role} onChange={(e) => set('role', e.target.value)} list="role-options" />
          <datalist id="role-options">
            {roles.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>

        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
