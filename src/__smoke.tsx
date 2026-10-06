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
import { KitDialog } from './components/KitDialog'
import { KitCheckOutDialog } from './components/KitCheckOutDialog'
import { KitCheckInDialog } from './components/KitCheckInDialog'
import { groupKitCheckouts } from './lib/kits'
import { Kits } from './pages/Kits'
import { runLogicTests } from './__logic-tests'
import type { Item, Kit, Loan, LoanView, Person } from './lib/types'
import type { User } from 'firebase/auth'
import { AuthContext, type AuthState } from './lib/auth'
import { Access } from './pages/Access'
import { NoAccess, SignIn, VerifyEmail } from './pages/SignIn'
import App from './App'

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
    kitId: null,
    kitName: null,
    kitCheckoutId: null,
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
    kitId: null,
    kitName: null,
    kitCheckoutId: null,
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
    kitId: null,
    kitName: null,
    kitCheckoutId: null,
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
    kitId: null,
    kitName: null,
    kitCheckoutId: null,
  },
]

const kits: Kit[] = [
  {
    id: 'kit1',
    name: 'Interview kit',
    description: 'Two-camera sit-down',
    components: [
      { itemId: 'cam1', qty: 1 },
      { itemId: 'cbl1', qty: 4 },
    ],
    archived: false,
    createdAt: daysFromNow(-20),
    updatedAt: null,
  },
  {
    // Needs more cameras than are on the shelf, so it must show as blocked.
    id: 'kit2',
    name: 'Multicam kit',
    description: '',
    components: [{ itemId: 'cam1', qty: 2 }],
    archived: false,
    createdAt: daysFromNow(-10),
    updatedAt: null,
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
    kits,
    openLoans: open,
    history: views,
    itemsById: new Map(items.map((i) => [i.id, i])),
    peopleById: new Map(people.map((p) => [p.id, p])),
    kitsById: new Map(kits.map((k) => [k.id, k])),
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
  kits: [],
  kitsById: new Map(),
  openLoansByItem: new Map(),
  openLoansByPerson: new Map(),
})

/** The Interview kit checked out to Grace — two loans sharing a checkout id. */
const kitOutLoans: LoanView[] = ([
  { ...loans[0]!, id: 'kl1', status: 'out', returnedQty: 0, dueAt: daysFromNow(3) },
  { ...loans[1]!, id: 'kl2', status: 'out', qty: 4, returnedQty: 0, dueAt: daysFromNow(3) },
] satisfies Loan[]).map((l) =>
  toLoanView({
    ...l,
    personId: 'p2',
    personName: 'Grace Hopper',
    kitId: 'kit1',
    kitName: 'Interview kit',
    kitCheckoutId: 'co1',
  }),
)
const kitOutStore = buildStore({ openLoans: kitOutLoans })

/** Signed-in staff, for screens that read useAuth(). */
const adminState: Extract<AuthState, { status: 'staff' }> = {
  status: 'staff',
  user: { email: 'admin@example.com' } as User,
  role: 'admin',
}

function withAuth(element: ReactElement, state: AuthState): ReactElement {
  return (
    <AuthContext.Provider value={{ state, refresh: async () => {} }}>{element}</AuthContext.Provider>
  )
}

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
  { name: 'Setup', route: '/', element: <Setup />, store: empty, expect: ['Studio Inventory'] },

  // Dialogs — the flows that actually move stock.
  {
    name: 'CheckOutDialog',
    route: '/',
    element: <CheckOutDialog onClose={noop} />,
    store: buildStore(),
    expect: [
      'Check out',
      'Items in this booking',
      'Nothing yet',
      'Add items',
      'STUDIO 102 — Sony A6500',
      'Ada Lovelace',
      'Due back',
    ],
  },
  {
    name: 'CheckOutDialog (item not fit for service)',
    route: '/',
    element: <CheckOutDialog item={items[1]!} onClose={noop} />,
    store: buildStore(),
    // The pre-selected item lands in the booking and drops out of the picker.
    expect: ['is marked not fit for service', 'Remove ', 'from booking', 'Add items'],
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
    name: 'Kits',
    route: '/kits',
    element: <Kits />,
    store: buildStore(),
    expect: ['Interview kit', 'Two-camera sit-down', 'Ready', 'Multicam kit', '1 item short', 'Only 1 available'],
  },
  {
    name: 'Kits (empty)',
    route: '/kits',
    element: <Kits />,
    store: empty,
    expect: ['No kits yet', 'Build a kit'],
  },
  {
    name: 'KitDialog (new)',
    route: '/',
    element: <KitDialog onClose={noop} />,
    store: buildStore(),
    // Archived items must not be offered for a new kit.
    expect: ['New kit', 'Kit name', 'Nothing yet', 'STUDIO 102 — Sony A6500'],
    reject: ['Retired tripod'],
  },
  {
    name: 'KitDialog (edit)',
    route: '/',
    element: <KitDialog kit={kits[0]!} onClose={noop} />,
    store: buildStore(),
    expect: ['Edit kit', 'Interview kit', 'Sony A6500', 'XLR cable 5m'],
  },
  {
    name: 'KitCheckOutDialog (ready)',
    route: '/',
    element: <KitCheckOutDialog kit={kits[0]!} onClose={noop} />,
    store: buildStore(),
    expect: ['Check out Interview kit', '2 items · 5 units', 'Ada Lovelace', 'not fit for service'],
    reject: ["can't go out right now"],
  },
  {
    name: 'KitCheckOutDialog (short)',
    route: '/',
    element: <KitCheckOutDialog kit={kits[1]!} onClose={noop} />,
    store: buildStore(),
    expect: ["This kit can't go out right now", 'Only 1 available'],
  },
  {
    name: 'Kits (kit out with someone)',
    route: '/kits',
    element: <Kits />,
    store: kitOutStore,
    expect: ['Out with Grace Hopper', 'Whole kit out', 'Check in kit'],
  },
  {
    name: 'KitCheckInDialog',
    route: '/',
    element: <KitCheckInDialog checkout={groupKitCheckouts(kitOutStore.openLoans)[0]!} onClose={noop} />,
    store: kitOutStore,
    expect: [
      'Check in Interview kit',
      'Out with Grace Hopper',
      'Sony A6500',
      'XLR cable 5m',
      'Set every item to',
      'Check in whole kit',
    ],
  },
  {
    name: 'SignIn',
    route: '/',
    element: <SignIn />,
    store: empty,
    expect: ['Sign in', 'Email', 'Password', 'Create an account', 'Forgot password?'],
  },
  {
    name: 'VerifyEmail',
    route: '/',
    element: withAuth(<VerifyEmail email="ada@example.com" />, { status: 'signed-out' }),
    store: empty,
    expect: ['Check your email', 'ada@example.com', 'Resend the link'],
  },
  {
    name: 'NoAccess',
    route: '/',
    element: <NoAccess email="stranger@example.com" />,
    store: empty,
    expect: ['No access yet', 'stranger@example.com'],
  },
  {
    name: 'Access (admin)',
    route: '/',
    element: withAuth(<Access />, adminState),
    store: buildStore(),
    expect: ['Access', 'Add someone', 'Member', 'Admin'],
  },
  {
    name: 'Access (member is sent away)',
    route: '/',
    element: withAuth(<Access />, { ...adminState, role: 'member' }),
    store: buildStore(),
    reject: ['Add someone'],
  },
  {
    name: 'App shell (admin)',
    route: '*',
    url: '/kits',
    element: withAuth(<App />, adminState),
    store: buildStore(),
    expect: ['Studio Inventory', 'Access', 'Sign out', 'admin@example.com', 'Interview kit'],
  },
  {
    name: 'App shell (member has no Access tab)',
    route: '*',
    url: '/',
    element: withAuth(<App />, { ...adminState, role: 'member' }),
    store: buildStore(),
    expect: ['Sign out'],
    reject: ['Access'],
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
