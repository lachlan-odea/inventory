import type { Timestamp } from 'firebase/firestore'

/**
 * A thing the studio owns. Fields mirror the studio's existing inventory
 * spreadsheet so an import lands 1:1 with no reshaping.
 *
 * Quantity-aware as well: most rows are a single serialised asset (qty 1), but
 * one doc can also cover 12 XLR cables.
 */
export interface Item {
  id: string
  /** The studio's own asset ID, e.g. "STUDIO 102". Primary identifier. */
  idNumber: string
  /** "Item" in the spreadsheet, e.g. "Sony A6500". */
  name: string
  category: string
  /** "Studio Location", e.g. "SYD". */
  location: string
  /** Manufacturer model, e.g. "SONY ILCE-6500". */
  modelNumber: string
  serialNumber: string
  description: string
  condition: ItemCondition
  /** What comes with it, e.g. "Shoulder Strap". */
  accessories: string
  notes: string
  /** yyyy-mm-dd, or '' when unknown. Stored as text — these are calendar dates,
   *  not instants, and timezone conversion would shift them. */
  purchaseDate: string
  lastInspectionDate: string
  /** Tri-state: yes / no / not recorded. */
  labelled: boolean | null
  fitForService: boolean | null
  /** Total units the studio owns. */
  totalQty: number
  /** Units on the shelf right now. Maintained transactionally against loans. */
  availableQty: number
  photoUrl: string | null
  /** Cloudinary public ID, kept for reference only — replacing or removing a
   *  photo unlinks it here but doesn't delete it from Cloudinary. */
  photoPath: string | null
  /** Retired gear stays in the DB for history but is hidden from checkout. */
  archived: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

/** Always offered in the location field, even before any item uses them. */
export const STUDIO_LOCATIONS = ['SYD', 'ORD']

export type ItemCondition = 'good' | 'worn' | 'damaged' | 'repair'

export const ITEM_CONDITIONS: { value: ItemCondition; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'worn', label: 'Worn' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'repair', label: 'In repair' },
]

/** Someone who can borrow gear. Managed list — checkout picks from these. */
export interface Person {
  id: string
  name: string
  email: string
  phone: string
  /** e.g. "Producer", "Contractor", "Editor" — free text, used for grouping. */
  role: string
  notes: string
  archived: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

/**
 * One check-out event. Supports partial returns: a loan of 6 cables can come
 * back 4 then 2. `returnedQty` climbs until it equals `qty`, at which point the
 * loan closes.
 */
export interface Loan {
  id: string
  itemId: string
  /** Denormalised so history still reads correctly if an item is renamed. */
  itemName: string
  personId: string
  personName: string
  qty: number
  returnedQty: number
  status: LoanStatus
  checkedOutAt: Timestamp | null
  dueAt: Timestamp | null
  returnedAt: Timestamp | null
  /** Who handed it over / notes taken at checkout. */
  checkoutNotes: string
  /** Condition recorded when the last units came back. */
  returnCondition: ItemCondition | null
  returnNotes: string
  returnPhotoUrl: string | null
  /** Cloudinary public ID, kept for reference only (see `Item.photoPath`). */
  returnPhotoPath: string | null
  /** Set when the loan was created by checking out a kit. Denormalised like
   *  `itemName`, so history reads correctly after a kit is renamed or deleted. */
  kitId: string | null
  kitName: string | null
  /** Shared by every loan from one kit checkout, so they can be grouped. */
  kitCheckoutId: string | null
}

export type LoanStatus = 'out' | 'returned'

/** A loan plus the derived state the UI actually renders. */
export interface LoanView extends Loan {
  outstandingQty: number
  isOverdue: boolean
  /** Negative = overdue by that many days. Null when there's no due date. */
  daysUntilDue: number | null
}

export interface NewItemInput {
  idNumber: string
  name: string
  category: string
  location: string
  modelNumber: string
  serialNumber: string
  description: string
  condition: ItemCondition
  accessories: string
  notes: string
  purchaseDate: string
  lastInspectionDate: string
  labelled: boolean | null
  fitForService: boolean | null
  totalQty: number
}

/** A blank item, so every form and importer starts from the same shape. */
export const EMPTY_ITEM: NewItemInput = {
  idNumber: '',
  name: '',
  category: '',
  location: '',
  modelNumber: '',
  serialNumber: '',
  description: '',
  condition: 'good',
  accessories: '',
  notes: '',
  purchaseDate: '',
  lastInspectionDate: '',
  labelled: null,
  fitForService: null,
  totalQty: 1,
}

export interface NewPersonInput {
  name: string
  email: string
  phone: string
  role: string
  notes: string
}

/** One borrower taking one or more items, all due back together. */
export interface BookingCheckOutInput {
  lines: KitComponent[]
  personId: string
  /** Local date string (yyyy-mm-dd) from the date input, or '' for no due date. */
  dueDate: string
  notes: string
}

/** One line of a kit: which item, and how many units of it go out. */
export interface KitComponent {
  itemId: string
  qty: number
}

/**
 * A named bundle of items that is checked out in one go, e.g. "Interview kit".
 * A kit owns no stock of its own — checking it out moves units on each item.
 */
export interface Kit {
  id: string
  name: string
  description: string
  components: KitComponent[]
  archived: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

export interface NewKitInput {
  name: string
  description: string
  components: KitComponent[]
}

export interface KitCheckOutInput {
  kitId: string
  personId: string
  /** Local date string (yyyy-mm-dd), or '' for no due date. */
  dueDate: string
  notes: string
}

export interface KitCheckInInput {
  kitCheckoutId: string
  /** The loans coming back, each returned in full, with its own condition. */
  returns: Array<{ loanId: string; condition: ItemCondition }>
  /** Shared across every item returned. */
  notes: string
  photo?: File | null
}

export interface CheckInInput {
  loanId: string
  qty: number
  condition: ItemCondition
  notes: string
  photo?: File | null
}
