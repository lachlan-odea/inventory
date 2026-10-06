/**
 * Runtime smoke test — renders every page against fixture data so broken JSX,
 * bad hook usage or a null-deref shows up here instead of in the browser.
 * Run with: npm run smoke
 */
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
// react-router v7 exports StaticRouter from the core package.
import { Route, Routes, StaticRouter } from 'react-router'
import { Timestamp } from 'firebase/firestore'
import { StoreContext, type StoreValue } from './lib/store'
import { ToastProvider } from './components/Toast'
import { CheckOutDialog } from './components/CheckOutDialog'
import { CheckInDialog } from './components/CheckInDialog'
import { ItemDialog } from './components/ItemDialog'
import { PersonDialog } from './components/PersonDialog'
import { toLoanView } from './lib/format'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { ItemDetail } from './pages/ItemDetail'
import { Loans } from './pages/Loans'
import { People } from './pages/People'
import { Setup } from './pages/Setup'
import { ImportDialog } from './components/ImportDialog'
import { runLogicTests } from './__logic-tests'
import type { Item, Loan, LoanView, Person } from './lib/types'

const daysFromNow = (n: number) => Timestamp.fromDate(new Date(Date.now() + n * 86400000))

const baseItem = {
  idNumber: '',
  modelNumber: '',
  serialNumber: '',
  accessories: '',
  purchaseDate: '',
  lastInspectionDate: '',
  labelled: null,
  fitForService: null,
  photoUrl: null,
  photoPath: null,
  archived: false,
  updatedAt: null,
} satisfies Partial<Item>

const items: Item[] = [
  {
    ...baseItem,
    id: 'cam1',
    idNumber: 'STUDIO 102',
    name: 'Sony A6500',
    category: 'Camera',
    location: 'SYD',
    modelNumber: 'SONY ILCE-6500',
    serialNumber: '4498703',
    description: 'Black',
    condition: 'good',
    accessories: 'Shoulder Strap',
    notes: 'Firmware 4.0',
    purchaseDate: '2021-06-01',
    lastInspectionDate: '2023-02-02',
    labelled: true,
    fitForService: true,
    totalQty: 2,
    availableQty: 1,
    createdAt: daysFromNow(-200),
    updatedAt: daysFromNow(-2),
  },
  {
    ...baseItem,
    id: 'cbl1',
    idNumber: 'STUDIO 210',
    name: 'XLR cable 5m',
    category: 'Audio',
    location: 'SYD',
    description: '',
    condition: 'worn',
    notes: '',
    totalQty: 12,
    availableQty: 6,
    // Deliberately flagged unusable, to exercise the checkout warning.
    fitForService: false,
    createdAt: daysFromNow(-400),
    updatedAt: daysFromNow(-30),
  },
  {
    ...baseItem,
    id: 'old1',
    name: 'Retired tripod',
    category: 'Grip',
    location: 'MEL',
    description: '',
    condition: 'damaged',
    notes: '',
    totalQty: 1,
    availableQty: 1,
    archived: true,
    createdAt: daysFromNow(-900),
    updatedAt: daysFromNow(-100),
  },
]

const people: Person[] = [
  {
    id: 'p1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '',
    role: 'Producer',
    notes: '',
    archived: false,
    createdAt: daysFromNow(-100),
    updatedAt: null,
  },
  {
    id: 'p2',
    name: 'Grace Hopper',
    email: '',
    phone: '0400 000 000',
    role: 'Editor',
    notes: '',
    archived: false,
    createdAt: daysFromNow(-50),
    updatedAt: null,
  },
]

const loans: Loan[] = [
  {
    id: 'l1',
    itemId: 'cam1',
    itemName: 'Sony A6500',
    personId: 'p1',
    personName: 'Ada Lovelace',
    qty: 1,
    returnedQty: 0,
    status: 'out',
    checkedOutAt: daysFromNow(-12),
    dueAt: daysFromNow(-3), // overdue
    returnedAt: null,
    checkoutNotes: 'Client shoot',
    returnCondition: null,
    returnNotes: '',
    returnPhotoUrl: null,
    returnPhotoPath: null,
  },
  {
    id: 'l2',
    itemId: 'cbl1',
    itemName: 'XLR cable 5m',
    personId: 'p2',
    personName: 'Grace Hopper',
    qty: 6,
    returnedQty: 2, // partial return
    status: 'out',
    checkedOutAt: daysFromNow(-1),
    dueAt: daysFromNow(1),
    returnedAt: null,
    checkoutNotes: '',
    returnCondition: 'good',
    returnNotes: '',
    returnPhotoUrl: null,
    returnPhotoPath: null,
  },
  {
    id: 'l3',
    itemId: 'cam1',
    itemName: 'Sony A6500',
    personId: 'p2',
    personName: 'Grace Hopper',
    qty: 1,
    returnedQty: 1,
    status: 'returned',
    checkedOutAt: daysFromNow(-40),
    dueAt: daysFromNow(-33),
    returnedAt: daysFromNow(-34),
    checkoutNotes: '',
    returnCondition: 'worn',
    returnNotes: 'Scuff on the cage',
    returnPhotoUrl: 'https://example.com/photo.jpg',
    returnPhotoPath: 'items/l3/photo.jpg',
  },
  {
    id: 'l4',
    itemId: 'cbl1',
    itemName: 'XLR cable 5m',
    personId: 'p1',
    personName: 'Ada Lovelace',
    qty: 2,
    returnedQty: 2,
    status: 'returned',
    checkedOutAt: daysFromNow(-9),
    dueAt: null, // no due date
    returnedAt: daysFromNow(-5),
    checkoutNotes: '',
    returnCondition: 'good',
    returnNotes: '',
    returnPhotoUrl: null,
    returnPhotoPath: null,
  },
]

function buildStore(overrides: Partial<StoreValue> = {}): StoreValue {
  const views = loans.map(toLoanView)
  const open = views.filter((l) => l.status === 'out')
  const byItem = new Map<string, LoanView[]>()
  const byPerson = new Map<string, LoanView[]>()
  for (const l of open) {
    byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l])
    byPerson.set(l.personId, [...(byPerson.get(l.personId) ?? []), l])
  }
  return {
    ready: true,
    error: null,
    items,
    people,
    openLoans: open,
    history: views,
    itemsById: new Map(items.map((i) => [i.id, i])),
    peopleById: new Map(people.map((p) => [p.id, p])),
    openLoansByItem: byItem,
    openLoansByPerson: byPerson,
    ...overrides,
  }
}

const empty = buildStore({
  items: [],
  people: [],
  openLoans: [],
  history: [],
  itemsById: new Map(),
  peopleById: new Map(),
  openLoansByItem: new Map(),
  openLoansByPerson: new Map(),
})

interface Case {
  name: string
  /** Route pattern, so pages reading useParams() actually get their params. */
  route: string
  /** URL to render. Defaults to `route`. */
  url?: string
  element: ReactElement
  store: StoreValue
  /** Substrings the rendered HTML must contain. */
  expect?: string[]
  /** Substrings that must NOT appear. */
  reject?: string[]
}

const noop = () => {}

const cases: Case[] = [
  {
    name: 'Dashboard (populated)',
    route: '/',
    element: <Dashboard />,
    store: buildStore(),
    // The overdue FX3 loan and the partially-returned cables must both surface.
    expect: ['Overdue', 'Sony A6500', 'Ada Lovelace', 'XLR cable 5m', '4 units'],
  },
  {
    name: 'Dashboard (empty studio)',
    route: '/',
    element: <Dashboard />,
    store: empty,
    expect: ["Let's set up the studio"],
  },
  {
    name: 'Inventory',
    route: '/inventory',
    element: <Inventory />,
    store: buildStore(),
    expect: ['Sony A6500', '1 of 2 in', 'STUDIO 102', 'SONY ILCE-6500', 'Not fit for service'],
  },
  {
    name: 'Inventory (empty)',
    route: '/inventory',
    element: <Inventory />,
    store: empty,
    expect: ['No gear yet'],
  },
  {
    name: 'ItemDetail',
    route: '/inventory/:itemId',
    url: '/inventory/cam1',
    element: <ItemDetail />,
    store: buildStore(),
    expect: [
      'Sony A6500',
      'Ada Lovelace',
      'Grace Hopper',
      'Scuff on the cage',
      'STUDIO 102',
      '4498703',
      'Shoulder Strap',
      // Dates are stored as plain yyyy-mm-dd and must render as calendar dates.
      '2 Feb 2023',
    ],
  },
  {
    name: 'ItemDetail (missing)',
    route: '/inventory/:itemId',
    url: '/inventory/nope',
    element: <ItemDetail />,
    store: buildStore(),
    expect: ['Item not found'],
  },
  {
    name: 'Loans',
    route: '/loans',
    element: <Loans />,
    store: buildStore(),
    expect: ['Sony A6500', 'Grace Hopper', 'Overdue'],
  },
  {
    name: 'People',
    route: '/people',
    element: <People />,
    store: buildStore(),
    expect: ['Ada Lovelace', 'Producer', 'units out'],
  },
  { name: 'Setup', route: '/', element: <Setup />, store: empty, expect: ['Studio Stock'] },

  // Dialogs — the flows that actually move stock.
  {
    name: 'CheckOutDialog',
    route: '/',
    element: <CheckOutDialog onClose={noop} />,
    store: buildStore(),
    expect: ['Check out', 'STUDIO 102 — Sony A6500', 'Ada Lovelace', 'Due back'],
  },
  {
    name: 'CheckOutDialog (item not fit for service)',
    route: '/',
    element: <CheckOutDialog item={items[1]!} onClose={noop} />,
    store: buildStore(),
    expect: ['is marked not fit for service'],
  },
  {
    name: 'CheckOutDialog (no people on the list)',
    route: '/',
    element: <CheckOutDialog onClose={noop} />,
    store: empty,
    expect: ['No one is on the borrower list yet'],
  },
  {
    name: 'CheckInDialog (partial return)',
    route: '/',
    element: <CheckInDialog loan={toLoanView(loans[1]!)} onClose={noop} />,
    store: buildStore(),
    // qty > 1, so the "how many are coming back" field must be offered.
    expect: ['Check in', 'XLR cable 5m', 'How many are coming back?', '4 units', 'Damaged'],
  },
  {
    name: 'CheckInDialog (single unit)',
    route: '/',
    element: <CheckInDialog loan={toLoanView(loans[0]!)} onClose={noop} />,
    store: buildStore(),
    expect: ['Sony A6500', 'Client shoot'],
    reject: ['How many are coming back?'],
  },
  {
    name: 'ItemDialog (new)',
    route: '/',
    element: <ItemDialog categories={['Camera', 'Audio']} locations={['SYD']} onClose={noop} />,
    store: buildStore(),
    expect: [
      'Add item',
      'ID Number',
      'Model Number',
      'Serial Number',
      'Studio Location',
      'Accessories',
      'Purchase date',
      'Last inspection date',
      'Labelled',
      'Fit for Service',
    ],
  },
  {
    name: 'ItemDialog (edit)',
    route: '/',
    element: (
      <ItemDialog item={items[0]!} categories={['Camera']} locations={['SYD']} onClose={noop} />
    ),
    store: buildStore(),
    expect: ['Edit item', '1 currently checked out', 'STUDIO 102', 'SONY ILCE-6500'],
  },
  {
    name: 'PersonDialog',
    route: '/',
    element: <PersonDialog roles={['Producer']} onClose={noop} />,
    store: buildStore(),
    expect: ['Add person'],
  },
  {
    name: 'ImportDialog (items)',
    route: '/',
    element: <ImportDialog kind="items" onClose={noop} />,
    store: buildStore(),
    expect: ['Import inventory from a spreadsheet', 'Choose file', 'Download a template'],
  },
  {
    name: 'ImportDialog (people)',
    route: '/',
    element: <ImportDialog kind="people" onClose={noop} />,
    store: buildStore(),
    expect: ['Import people from a spreadsheet'],
  },
]

/**
 * React's SSR output escapes entities and separates adjacent text nodes with
 * `<!-- -->`, so "1 of 2 in" arrives as "1<!-- --> of <!-- -->2<!-- --> in".
 * Undo both so assertions can be written the way the page reads.
 */
function normalise(html: string): string {
  return html
    .replaceAll('<!-- -->', '')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

let failed = runLogicTests()

console.log('\nPage and dialog rendering')
for (const testCase of cases) {
  const { name, route, url, element, store, expect = [], reject = [] } = testCase
  try {
    const html = renderToString(
      <StaticRouter location={url ?? route}>
        <ToastProvider>
          <StoreContext.Provider value={store}>
            <Routes>
              <Route path={route} element={element} />
            </Routes>
          </StoreContext.Provider>
        </ToastProvider>
      </StaticRouter>,
    )
    const text = normalise(html)
    const missing = expect.filter((needle) => !text.includes(needle))
    if (missing.length) throw new Error(`missing from output: ${missing.join(', ')}`)
    const unexpected = reject.filter((needle) => text.includes(needle))
    if (unexpected.length) throw new Error(`unexpectedly present: ${unexpected.join(', ')}`)
    console.log(`  ok   ${name} (${html.length} chars)`)
  } catch (err) {
    failed++
    console.error(`  FAIL ${name}: ${(err as Error).message}`)
  }
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
