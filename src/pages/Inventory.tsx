import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store'
import { ItemDialog } from '../components/ItemDialog'
import { CheckOutDialog } from '../components/CheckOutDialog'
import { ImportDialog } from '../components/ImportDialog'
import { PhoneCameraDialog } from '../components/PhoneCameraDialog'
import { EmptyState, ItemThumb, StockBadge, ConditionBadge, ServiceBadge } from '../components/ui'
import { plural } from '../lib/format'
import { STUDIO_LOCATIONS, type Item, type LoanView } from '../lib/types'

type StockFilter = 'all' | 'available' | 'out'

type InventoryView = 'tiles' | 'list' | 'mosaic'

const VIEWS: { value: InventoryView; label: string; icon: string }[] = [
  { value: 'tiles', label: 'Tiles', icon: '▦' },
  { value: 'list', label: 'List', icon: '☰' },
  { value: 'mosaic', label: 'Mosaic', icon: '▩' },
]

// Both remembered per browser, so each studio's staff land on their own gear,
// laid out the way they like it.
const LOCATION_STORAGE_KEY = 'inventory.location'
const VIEW_STORAGE_KEY = 'inventory.view'

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage — the choice just won't be remembered.
  }
}

/** "syd ", "Syd" and "SYD" are the same studio. */
function locationKey(location: string): string {
  return location.trim().toUpperCase()
}

export function Inventory() {
  const { items, openLoansByItem } = useStore()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [location, setLocationState] = useState(() => load(LOCATION_STORAGE_KEY) || 'all')
  const [view, setViewState] = useState<InventoryView>(() => {
    const saved = load(VIEW_STORAGE_KEY)
    return VIEWS.some((v) => v.value === saved) ? (saved as InventoryView) : 'tiles'
  })
  const [stock, setStock] = useState<StockFilter>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  // Frozen when opened, so the session covers what was on screen at the time.
  const [phoneItems, setPhoneItems] = useState<Item[] | null>(null)
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
    save(LOCATION_STORAGE_KEY, value)
  }

  function setView(value: InventoryView) {
    setViewState(value)
    save(VIEW_STORAGE_KEY, value)
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
          <button
            className="btn btn--ghost"
            disabled={visible.length === 0}
            title="Show a QR code so someone can photograph the items listed below on their phone"
            onClick={() => setPhoneItems(visible)}
          >
            📱 Photos from phone
          </button>
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
        <div className="segmented view-switch" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              className={view === v.value ? 'is-on' : undefined}
              aria-pressed={view === v.value}
              onClick={() => setView(v.value)}
              title={`${v.label} view`}
            >
              <span aria-hidden="true">{v.icon}</span> {v.label}
            </button>
          ))}
        </div>
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
        <ItemsView
          view={view}
          items={visible}
          openLoansByItem={openLoansByItem}
          onCheckOut={setCheckOutItem}
        />
      )}

      {adding && (
        <ItemDialog
          categories={categories}
          locations={locations}
          onClose={() => setAdding(false)}
        />
      )}
      {importing && <ImportDialog kind="items" onClose={() => setImporting(false)} />}
      {phoneItems && (
        <PhoneCameraDialog
          items={phoneItems}
          label={[location === 'all' ? 'All locations' : location, category === 'all' ? '' : category]
            .filter(Boolean)
            .join(' · ')}
          onClose={() => setPhoneItems(null)}
        />
      )}
      {checkOutItem && (
        <CheckOutDialog item={checkOutItem} onClose={() => setCheckOutItem(null)} />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- views */

interface ViewProps {
  items: Item[]
  openLoansByItem: Map<string, LoanView[]>
  onCheckOut: (item: Item) => void
}

function ItemsView({ view, ...props }: ViewProps & { view: InventoryView }) {
  if (view === 'list') return <ListView {...props} />
  if (view === 'mosaic') return <MosaicView {...props} />
  return <TilesView {...props} />
}

function CheckOutButton({ item, onCheckOut }: { item: Item; onCheckOut: (item: Item) => void }) {
  return (
    <button
      className="btn btn--small"
      disabled={item.availableQty === 0 || item.archived}
      onClick={() => onCheckOut(item)}
    >
      Check out
    </button>
  )
}

/** Cards with photo, details, who has it and condition flags. */
function TilesView({ items, openLoansByItem, onCheckOut }: ViewProps) {
  return (
    <ul className="item-grid">
      {items.map((item) => {
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
                  {[item.category, item.location, item.modelNumber].filter(Boolean).join(' · ') ||
                    'No category'}
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
              <CheckOutButton item={item} onCheckOut={onCheckOut} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Dense rows for scanning a long inventory. */
function ListView({ items, openLoansByItem, onCheckOut }: ViewProps) {
  return (
    <div className="table-wrap">
      <table className="table item-table">
        <thead>
          <tr>
            <th aria-label="Photo" />
            <th>Item</th>
            <th>ID</th>
            <th>Category</th>
            <th>Location</th>
            <th>Stock</th>
            <th>Out with</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const loans = openLoansByItem.get(item.id) ?? []
            const overdue = loans.some((l) => l.isOverdue)
            return (
              <tr key={item.id} className={overdue ? 'is-overdue' : undefined}>
                <td className="item-table__thumb">
                  <ItemThumb item={item} size={36} />
                </td>
                <td>
                  <Link className="link" to={`/inventory/${item.id}`}>
                    {item.name}
                  </Link>
                  <div className="item-table__flags">
                    {item.condition !== 'good' && <ConditionBadge condition={item.condition} />}
                    <ServiceBadge item={item} />
                  </div>
                </td>
                <td className="item-table__id">{item.idNumber || '—'}</td>
                <td>{item.category || <span className="muted">—</span>}</td>
                <td>{item.location || <span className="muted">—</span>}</td>
                <td>
                  <StockBadge item={item} />
                </td>
                <td className={overdue ? 'text-bad' : undefined}>
                  {loans.length > 0 ? loans.map((l) => l.personName).join(', ') : <span className="muted">—</span>}
                </td>
                <td className="table__actions">
                  <CheckOutButton item={item} onCheckOut={onCheckOut} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Photo-first grid — for finding gear by how it looks. */
function MosaicView({ items, openLoansByItem }: ViewProps) {
  return (
    <ul className="mosaic">
      {items.map((item) => {
        const overdue = (openLoansByItem.get(item.id) ?? []).some((l) => l.isOverdue)
        return (
          <li key={item.id} className={`mosaic__tile${overdue ? ' is-overdue' : ''}`}>
            <Link to={`/inventory/${item.id}`} className="mosaic__link" title={item.name}>
              {item.photoUrl ? (
                <img className="mosaic__img" src={item.photoUrl} alt="" loading="lazy" />
              ) : (
                <span className="mosaic__img mosaic__img--empty" aria-hidden="true">
                  📦
                </span>
              )}
              <span className="mosaic__badge">
                <StockBadge item={item} />
              </span>
              <span className="mosaic__caption">
                <strong>{item.name}</strong>
                {item.idNumber && <span>{item.idNumber}</span>}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
