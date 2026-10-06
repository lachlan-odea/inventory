import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, describeFirebaseError } from '../lib/store'
import { KitDialog } from '../components/KitDialog'
import { KitCheckOutDialog } from '../components/KitCheckOutDialog'
import { KitCheckInDialog } from '../components/KitCheckInDialog'
import { DueBadge, EmptyState } from '../components/ui'
import { deleteKit, setKitArchived } from '../lib/db'
import { groupKitCheckouts, kitStatus, type KitCheckout } from '../lib/kits'
import { useToast } from '../components/Toast'
import { plural } from '../lib/format'
import type { Kit } from '../lib/types'

export function Kits() {
  const { kits, itemsById, openLoans } = useStore()
  const toast = useToast()

  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Kit | null>(null)
  const [checkingOut, setCheckingOut] = useState<Kit | null>(null)
  const [checkingIn, setCheckingIn] = useState<KitCheckout | null>(null)

  // Each kit checkout still (partly) out, grouped under its kit.
  const checkoutsByKit = useMemo(() => {
    const map = new Map<string, KitCheckout[]>()
    for (const group of groupKitCheckouts(openLoans)) {
      map.set(group.kitId, [...(map.get(group.kitId) ?? []), group])
    }
    return map
  }, [openLoans])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return kits.filter((kit) => {
      if (kit.archived !== showArchived) return false
      if (!q) return true
      const itemNames = kit.components.map((c) => itemsById.get(c.itemId)?.name ?? '')
      return [kit.name, kit.description, ...itemNames].join(' ').toLowerCase().includes(q)
    })
  }, [kits, itemsById, search, showArchived])

  async function toggleArchive(kit: Kit) {
    try {
      await setKitArchived(kit.id, !kit.archived)
      toast.success(kit.archived ? `${kit.name} restored.` : `${kit.name} archived.`)
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  async function remove(kit: Kit) {
    if (!window.confirm(`Delete the "${kit.name}" kit? The items in it stay in the inventory.`)) return
    try {
      await deleteKit(kit.id)
      toast.success('Kit deleted.')
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Kits</h1>
          <p className="muted">
            {plural(kits.filter((k) => !k.archived).length, 'kit')} · bundles of gear that go out
            together
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setAdding(true)}>
          New kit
        </button>
      </header>

      <div className="toolbar">
        <input
          type="search"
          className="toolbar__search"
          placeholder="Search kit or item name…"
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
          icon={kits.length === 0 ? '🧰' : '🔍'}
          title={kits.length === 0 ? 'No kits yet' : 'Nothing matches'}
          message={
            kits.length === 0
              ? 'Group gear that usually goes out together — an interview kit, a podcast kit — and check it all out in one step.'
              : 'Try a different search.'
          }
          action={
            kits.length === 0 ? (
              <button className="btn btn--primary" onClick={() => setAdding(true)}>
                Build a kit
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="kit-list">
          {visible.map((kit) => {
            const status = kitStatus(kit, itemsById)
            const checkouts = checkoutsByKit.get(kit.id) ?? []
            return (
              <li key={kit.id} className="kit-card">
                <div className="kit-card__head">
                  <div>
                    <strong className="kit-card__name">{kit.name}</strong>
                    <p className="muted">
                      {plural(status.lines.length, 'item')} · {plural(status.totalUnits, 'unit')}
                      {kit.description ? ` · ${kit.description}` : ''}
                    </p>
                  </div>
                  {kit.archived ? (
                    <span className="badge badge--muted">Archived</span>
                  ) : status.ready ? (
                    <span className="badge badge--in">Ready</span>
                  ) : (
                    <span className="badge badge--out">{plural(status.blocked.length, 'item')} short</span>
                  )}
                </div>

                <ul className="kit-card__items">
                  {status.lines.map((line) => (
                    <li key={line.itemId} className={line.problem ? 'is-blocked' : undefined}>
                      <span>
                        {line.needed > 1 && <span className="kit-card__qty">{line.needed}×</span>}
                        {line.item ? (
                          <Link className="link" to={`/inventory/${line.itemId}`}>
                            {line.item.name}
                          </Link>
                        ) : (
                          <span className="muted">Deleted item</span>
                        )}
                      </span>
                      {line.problem && <span className="small text-bad">{line.problem}</span>}
                    </li>
                  ))}
                </ul>

                {checkouts.length > 0 && (
                  <ul className="kit-card__out">
                    {checkouts.map((group) => {
                      const partial = group.loans.length < kit.components.length
                      return (
                        <li key={group.kitCheckoutId}>
                          <div>
                            <strong>Out with {group.personName}</strong>
                            <p className="muted small">
                              {partial
                                ? `${plural(group.loans.length, 'item')} still out`
                                : 'Whole kit out'}
                            </p>
                          </div>
                          <DueBadge loan={group.loans[0]!} />
                          <button className="btn btn--small" onClick={() => setCheckingIn(group)}>
                            Check in kit
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}

                <div className="kit-card__actions">
                  <button
                    className="btn btn--small btn--primary"
                    disabled={kit.archived || !status.ready}
                    onClick={() => setCheckingOut(kit)}
                  >
                    Check out kit
                  </button>
                  <button className="btn btn--small" onClick={() => setEditing(kit)}>
                    Edit
                  </button>
                  <button className="btn btn--small btn--ghost" onClick={() => toggleArchive(kit)}>
                    {kit.archived ? 'Restore' : 'Archive'}
                  </button>
                  {kit.archived && (
                    <button className="btn btn--small btn--ghost btn--danger" onClick={() => remove(kit)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {adding && <KitDialog onClose={() => setAdding(false)} />}
      {editing && <KitDialog kit={editing} onClose={() => setEditing(null)} />}
      {checkingOut && <KitCheckOutDialog kit={checkingOut} onClose={() => setCheckingOut(null)} />}
      {checkingIn && <KitCheckInDialog checkout={checkingIn} onClose={() => setCheckingIn(null)} />}
    </div>
  )
}
