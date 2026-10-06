import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store'
import { ItemDialog } from '../components/ItemDialog'
import { CheckOutDialog } from '../components/CheckOutDialog'
import { ImportDialog } from '../components/ImportDialog'
import { EmptyState, ItemThumb, StockBadge, ConditionBadge, ServiceBadge } from '../components/ui'
import { plural } from '../lib/format'
import { STUDIO_LOCATIONS, type Item } from '../lib/types'

type StockFilter = 'all' | 'available' | 'out'

/** Remembered per browser, so each studio's staff land on their own gear. */
const LOCATION_STORAGE_KEY = 'inventory.location'

/** "syd ", "Syd" and "SYD" are the same studio. */
function locationKey(location: string): string {
  return location.trim().toUpperCase()
}

function readSavedLocation(): string {
  try {
    return localStorage.getItem(LOCATION_STORAGE_KEY) || 'all'
  } catch {
    return 'all'
  }
}

export function Inventory() {
  const { items, openLoansByItem } = useStore()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [location, setLocationState] = useState(readSavedLocation)
  const [stock, setStock] = useState<StockFilter>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [checkOutItem, setCheckOutItem] = useState<Item | null>(null)

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
    [items],
  )
  const locations = useMemo(
    () => [...new Set(items.map((i) => i.location).filter(Boolean))].sort(),
    [items],
  )

  // The studios are always offered, plus any other location the data uses,
  // each with how many items (in the current archived/active view) it holds.
  const locationCounts = useMemo(() => {
    const counts = new Map<string, number>(STUDIO_LOCATIONS.map((l) => [l, 0]))
    for (const item of items) {
      if (item.archived !== showArchived) continue
      const key = locationKey(item.location)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts]
  }, [items, showArchived])

  function setLocation(value: string) {
    setLocationState(value)
    try {
      localStorage.setItem(LOCATION_STORAGE_KEY, value)
    } catch {
      // Private mode or blocked storage — the filter just won't be remembered.
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (item.archived !== showArchived) return false
      if (category !== 'all' && item.category !== category) return false
      if (location !== 'all' && locationKey(item.location) !== location) return false
      if (stock === 'available' && item.availableQty === 0) return false
      if (stock === 'out' && item.availableQty === item.totalQty) return false
      if (!q) return true
      return [
        item.idNumber,
        item.name,
        item.category,
        item.location,
        item.modelNumber,
        item.serialNumber,
        item.description,
        item.accessories,
        item.notes,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [items, search, category, location, stock, showArchived])

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Inventory</h1>
          <p className="muted">{plural(items.filter((i) => !i.archived).length, 'item')} tracked</p>
        </div>
        <div className="btn-row">
          <button className="btn btn--ghost" onClick={() => setImporting(true)}>
            Import from Excel
          </button>
          <button className="btn btn--primary" onClick={() => setAdding(true)}>
            Add item
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Studio location">
          <button
            className={location === 'all' ? 'is-on' : undefined}
            aria-pressed={location === 'all'}
            onClick={() => setLocation('all')}
          >
            All
          </button>
          {locationCounts.map(([loc, count]) => (
            <button
              key={loc}
              className={location === loc ? 'is-on' : undefined}
              aria-pressed={location === loc}
              onClick={() => setLocation(loc)}
            >
              {loc} <span className="muted">{count}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="toolbar__search"
          placeholder="Search ID, item, model, serial…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={stock} onChange={(e) => setStock(e.target.value as StockFilter)}>
          <option value="all">Any availability</option>
          <option value="available">On the shelf</option>
          <option value="out">Something out</option>
        </select>
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
          icon={items.length === 0 ? '📦' : '🔍'}
          title={items.length === 0 ? 'No gear yet' : 'Nothing matches'}
          message={
            items.length === 0
              ? 'Add your first piece of studio gear to start tracking it.'
              : 'Try a different search or clear the filters.'
          }
          action={
            items.length === 0 ? (
              <div className="btn-row">
                <button className="btn btn--primary" onClick={() => setImporting(true)}>
                  Import from Excel
                </button>
                <button className="btn btn--ghost" onClick={() => setAdding(true)}>
                  Add one by hand
                </button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <ul className="item-grid">
          {visible.map((item) => {
            const loans = openLoansByItem.get(item.id) ?? []
            const overdue = loans.some((l) => l.isOverdue)
            return (
              <li key={item.id} className={`item-card${overdue ? ' is-overdue' : ''}`}>
                <Link to={`/inventory/${item.id}`} className="item-card__link">
                  <ItemThumb item={item} size={64} />
                  <div className="item-card__body">
                    <div className="item-card__title">
                      <strong>{item.name}</strong>
                      <StockBadge item={item} />
                    </div>
                    {item.idNumber && <p className="item-card__id">{item.idNumber}</p>}
                    <p className="muted">
                      {[item.category, item.location, item.modelNumber]
                        .filter(Boolean)
                        .join(' · ') || 'No category'}
                    </p>
                    {loans.length > 0 && (
                      <p className={`muted small${overdue ? ' text-bad' : ''}`}>
                        Out with {loans.map((l) => l.personName).join(', ')}
                      </p>
                    )}
                    <div className="item-card__flags">
                      {item.condition !== 'good' && <ConditionBadge condition={item.condition} />}
                      <ServiceBadge item={item} />
                    </div>
                  </div>
                </Link>
                <div className="item-card__actions">
                  <button
                    className="btn btn--small"
                    disabled={item.availableQty === 0 || item.archived}
                    onClick={() => setCheckOutItem(item)}
                  >
                    Check out
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {adding && (
        <ItemDialog
          categories={categories}
          locations={locations}
          onClose={() => setAdding(false)}
        />
      )}
      {importing && <ImportDialog kind="items" onClose={() => setImporting(false)} />}
      {checkOutItem && (
        <CheckOutDialog item={checkOutItem} onClose={() => setCheckOutItem(null)} />
      )}
    </div>
  )
}
