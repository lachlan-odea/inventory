import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore'
import { uploadImage } from './cloudinary'
import { db } from './firebase'
import { parseDueDate } from './format'
import { addItemToLivePhotoSessions } from './photoSessions'
import { normaliseComponents } from './kits'
import type {
  BookingCheckOutInput,
  CheckInInput,
  Item,
  ItemCondition,
  Kit,
  KitCheckInInput,
  KitCheckOutInput,
  KitComponent,
  Loan,
  NewItemInput,
  NewKitInput,
  NewPersonInput,
  Person,
} from './types'

const itemsCol = collection(db, 'items')
const peopleCol = collection(db, 'people')
const loansCol = collection(db, 'loans')
const kitsCol = collection(db, 'kits')

/* ------------------------------------------------------------------ mapping */

function mapItem(snap: QueryDocumentSnapshot<DocumentData>): Item {
  const d = snap.data()
  return {
    id: snap.id,
    idNumber: d.idNumber ?? '',
    name: d.name ?? '',
    category: d.category ?? '',
    location: d.location ?? '',
    modelNumber: d.modelNumber ?? '',
    serialNumber: d.serialNumber ?? '',
    description: d.description ?? '',
    condition: d.condition ?? 'good',
    accessories: d.accessories ?? '',
    notes: d.notes ?? '',
    purchaseDate: d.purchaseDate ?? '',
    lastInspectionDate: d.lastInspectionDate ?? '',
    labelled: d.labelled ?? null,
    fitForService: d.fitForService ?? null,
    totalQty: d.totalQty ?? 0,
    availableQty: d.availableQty ?? 0,
    photoUrl: d.photoUrl ?? null,
    photoPath: d.photoPath ?? null,
    archived: d.archived ?? false,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
  }
}

function mapPerson(snap: QueryDocumentSnapshot<DocumentData>): Person {
  const d = snap.data()
  return {
    id: snap.id,
    name: d.name ?? '',
    email: d.email ?? '',
    phone: d.phone ?? '',
    role: d.role ?? '',
    notes: d.notes ?? '',
    archived: d.archived ?? false,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
  }
}

function mapLoan(snap: QueryDocumentSnapshot<DocumentData>): Loan {
  const d = snap.data()
  return {
    id: snap.id,
    itemId: d.itemId ?? '',
    itemName: d.itemName ?? '',
    personId: d.personId ?? '',
    personName: d.personName ?? '',
    qty: d.qty ?? 0,
    returnedQty: d.returnedQty ?? 0,
    status: d.status ?? 'out',
    checkedOutAt: d.checkedOutAt ?? null,
    dueAt: d.dueAt ?? null,
    returnedAt: d.returnedAt ?? null,
    checkoutNotes: d.checkoutNotes ?? '',
    returnCondition: d.returnCondition ?? null,
    returnNotes: d.returnNotes ?? '',
    returnPhotoUrl: d.returnPhotoUrl ?? null,
    returnPhotoPath: d.returnPhotoPath ?? null,
    kitId: d.kitId ?? null,
    kitName: d.kitName ?? null,
    kitCheckoutId: d.kitCheckoutId ?? null,
  }
}

function mapKit(snap: QueryDocumentSnapshot<DocumentData>): Kit {
  const d = snap.data()
  const raw: unknown[] = Array.isArray(d.components) ? d.components : []
  return {
    id: snap.id,
    name: d.name ?? '',
    description: d.description ?? '',
    components: raw
      .map((c) => c as Partial<KitComponent>)
      .filter((c): c is KitComponent => typeof c.itemId === 'string' && typeof c.qty === 'number'),
    archived: d.archived ?? false,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
  }
}

/* -------------------------------------------------------------- subscriptions */

type Sink<T> = (rows: T[]) => void
type ErrorSink = (err: Error) => void

export function watchItems(onData: Sink<Item>, onError: ErrorSink) {
  return onSnapshot(
    query(itemsCol, orderBy('name')),
    (snap) => onData(snap.docs.map(mapItem)),
    onError,
  )
}

export function watchPeople(onData: Sink<Person>, onError: ErrorSink) {
  return onSnapshot(
    query(peopleCol, orderBy('name')),
    (snap) => onData(snap.docs.map(mapPerson)),
    onError,
  )
}

export function watchKits(onData: Sink<Kit>, onError: ErrorSink) {
  return onSnapshot(
    query(kitsCol, orderBy('name')),
    (snap) => onData(snap.docs.map(mapKit)),
    onError,
  )
}

/** Everything currently checked out. Small by nature — sorted client-side. */
export function watchOpenLoans(onData: Sink<Loan>, onError: ErrorSink) {
  return onSnapshot(
    query(loansCol, where('status', '==', 'out')),
    (snap) => onData(snap.docs.map(mapLoan)),
    onError,
  )
}

/** Recent activity across everything, newest first. */
export function watchLoanHistory(onData: Sink<Loan>, onError: ErrorSink, max = 300) {
  return onSnapshot(
    query(loansCol, orderBy('checkedOutAt', 'desc'), limit(max)),
    (snap) => onData(snap.docs.map(mapLoan)),
    onError,
  )
}

/* --------------------------------------------------------------------- items */

export async function createItem(input: NewItemInput, photo?: File | null): Promise<string> {
  const qty = Math.max(0, Math.floor(input.totalQty))
  const docRef = await addDoc(itemsCol, {
    ...input,
    totalQty: qty,
    availableQty: qty,
    photoUrl: null,
    photoPath: null,
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  if (photo) await setItemPhoto(docRef.id, photo)
  // Someone may be photographing gear on a phone right now; offer them this
  // item too. The item is saved either way — this is best effort.
  try {
    await addItemToLivePhotoSessions({ ...input, id: docRef.id, photoUrl: null })
  } catch (err) {
    console.warn('Could not add the new item to live photo sessions', err)
  }
  return docRef.id
}

/**
 * Edits an item's details. Changing `totalQty` shifts `availableQty` by the same
 * delta inside a transaction, so units that are currently on loan stay accounted
 * for (buying 3 more cables raises available by 3, it doesn't reset it).
 */
export async function updateItem(itemId: string, input: NewItemInput): Promise<void> {
  const itemRef = doc(itemsCol, itemId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(itemRef)
    if (!snap.exists()) throw new Error('That item no longer exists.')
    const current = snap.data()
    const oldTotal: number = current.totalQty ?? 0
    const oldAvailable: number = current.availableQty ?? 0
    const onLoan = oldTotal - oldAvailable
    const newTotal = Math.max(0, Math.floor(input.totalQty))

    if (newTotal < onLoan) {
      throw new Error(
        `Can't set the total below ${onLoan} — that many units are checked out. Check them in first.`,
      )
    }

    tx.update(itemRef, {
      ...input,
      totalQty: newTotal,
      availableQty: newTotal - onLoan,
      updatedAt: serverTimestamp(),
    })
  })
}

export async function setItemArchived(itemId: string, archived: boolean): Promise<void> {
  await updateDoc(doc(itemsCol, itemId), { archived, updatedAt: serverTimestamp() })
}

/**
 * Uploads a new photo. The one it replaces is left on Cloudinary — deleting it
 * needs a signed request, which needs an API secret that can't live in client
 * code — but is unlinked here so the UI stops showing it.
 */
export async function setItemPhoto(itemId: string, photo: File): Promise<void> {
  const uploaded = await uploadImage(photo, `items/${itemId}`)
  await updateDoc(doc(itemsCol, itemId), {
    photoUrl: uploaded.url,
    photoPath: uploaded.publicId,
    updatedAt: serverTimestamp(),
  })
}

export async function removeItemPhoto(itemId: string): Promise<void> {
  await updateDoc(doc(itemsCol, itemId), {
    photoUrl: null,
    photoPath: null,
    updatedAt: serverTimestamp(),
  })
}

/** Hard delete. Only offered for items that have never been loaned. */
export async function deleteItem(itemId: string): Promise<void> {
  await deleteDoc(doc(itemsCol, itemId))
}

/* -------------------------------------------------------------------- people */

export async function createPerson(input: NewPersonInput): Promise<string> {
  const docRef = await addDoc(peopleCol, {
    ...input,
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return docRef.id
}

export async function updatePerson(personId: string, input: NewPersonInput): Promise<void> {
  await updateDoc(doc(peopleCol, personId), { ...input, updatedAt: serverTimestamp() })
}

export async function setPersonArchived(personId: string, archived: boolean): Promise<void> {
  await updateDoc(doc(peopleCol, personId), { archived, updatedAt: serverTimestamp() })
}

export async function deletePerson(personId: string): Promise<void> {
  await deleteDoc(doc(peopleCol, personId))
}

/* ---------------------------------------------------------------------- kits */

export async function createKit(input: NewKitInput): Promise<string> {
  const docRef = await addDoc(kitsCol, {
    ...input,
    components: normaliseComponents(input.components),
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return docRef.id
}

export async function updateKit(kitId: string, input: NewKitInput): Promise<void> {
  await updateDoc(doc(kitsCol, kitId), {
    ...input,
    components: normaliseComponents(input.components),
    updatedAt: serverTimestamp(),
  })
}

export async function setKitArchived(kitId: string, archived: boolean): Promise<void> {
  await updateDoc(doc(kitsCol, kitId), { archived, updatedAt: serverTimestamp() })
}

/** Safe at any time: kits own no stock, and loans carry the kit name with them. */
export async function deleteKit(kitId: string): Promise<void> {
  await deleteDoc(doc(kitsCol, kitId))
}

/* --------------------------------------------------------------- check in/out */

/** Each line costs two writes; Firestore caps a transaction at 500. */
export const MAX_BOOKING_LINES = 200

interface LoanStamp {
  personId: string
  personName: string
  due: Date | null
  notes: string
  kitId: string | null
  kitName: string | null
  kitCheckoutId: string | null
}

/**
 * Reads every item, checks each line can go out, then decrements stock and
 * writes one loan per line. All-or-nothing: if any line is short, nothing is
 * written and the error lists every shortfall so they can be fixed in one pass.
 * Callers must finish their own reads first — Firestore needs reads before writes.
 */
async function stageCheckout(
  tx: Transaction,
  lines: KitComponent[],
  stamp: LoanStamp,
  failurePrefix: string,
): Promise<void> {
  const itemRefs = lines.map((l) => doc(itemsCol, l.itemId))
  const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)))

  const problems: string[] = []
  lines.forEach((l, i) => {
    const snap = itemSnaps[i]!
    if (!snap.exists()) {
      problems.push('an item has been deleted from the inventory')
      return
    }
    const item = snap.data()
    const available: number = item.availableQty ?? 0
    if (item.archived) problems.push(`"${item.name}" is archived`)
    else if (available < l.qty) {
      problems.push(
        available === 0
          ? `"${item.name}" is fully checked out`
          : `only ${available} of ${l.qty} "${item.name}" available`,
      )
    }
  })
  if (problems.length) throw new Error(`${failurePrefix}: ${problems.join('; ')}.`)

  lines.forEach((l, i) => {
    const item = itemSnaps[i]!.data()!
    tx.update(itemRefs[i]!, {
      availableQty: (item.availableQty ?? 0) - l.qty,
      updatedAt: serverTimestamp(),
    })
    tx.set(doc(loansCol), {
      itemId: l.itemId,
      itemName: item.name ?? '',
      personId: stamp.personId,
      personName: stamp.personName,
      qty: l.qty,
      returnedQty: 0,
      status: 'out',
      checkedOutAt: serverTimestamp(),
      dueAt: stamp.due ? Timestamp.fromDate(stamp.due) : null,
      returnedAt: null,
      checkoutNotes: stamp.notes,
      returnCondition: null,
      returnNotes: '',
      returnPhotoUrl: null,
      returnPhotoPath: null,
      kitId: stamp.kitId,
      kitName: stamp.kitName,
      kitCheckoutId: stamp.kitCheckoutId,
    })
  })
}

/**
 * Checks out one or more items to a person in a single booking. Each item gets
 * its own loan, so check-in and partial returns work per item as before.
 */
export async function checkOutBooking(input: BookingCheckOutInput): Promise<number> {
  const lines = normaliseComponents(input.lines)
  if (lines.length === 0) throw new Error('Add at least one item to the booking.')
  if (lines.length > MAX_BOOKING_LINES) {
    throw new Error(`A booking can hold up to ${MAX_BOOKING_LINES} items — split it in two.`)
  }
  const personRef = doc(peopleCol, input.personId)

  await runTransaction(db, async (tx) => {
    const personSnap = await tx.get(personRef)
    if (!personSnap.exists()) throw new Error('That person is no longer in the list.')
    await stageCheckout(
      tx,
      lines,
      {
        personId: input.personId,
        personName: personSnap.data().name ?? '',
        due: parseDueDate(input.dueDate),
        notes: input.notes,
        kitId: null,
        kitName: null,
        kitCheckoutId: null,
      },
      "Can't check out",
    )
  })

  return lines.length
}

/**
 * Checks out every item in a kit at once, whole or not at all. Each loan is
 * tagged with the kit so the Kits page knows it's out.
 */
export async function checkOutKit(input: KitCheckOutInput): Promise<number> {
  const kitRef = doc(kitsCol, input.kitId)
  const personRef = doc(peopleCol, input.personId)
  let loanCount = 0

  await runTransaction(db, async (tx) => {
    const [kitSnap, personSnap] = await Promise.all([tx.get(kitRef), tx.get(personRef)])
    if (!kitSnap.exists()) throw new Error('That kit no longer exists.')
    if (!personSnap.exists()) throw new Error('That person is no longer in the list.')

    const kit = kitSnap.data()
    const components = normaliseComponents(Array.isArray(kit.components) ? kit.components : [])
    if (components.length === 0) throw new Error(`"${kit.name}" has no items in it yet.`)

    await stageCheckout(
      tx,
      components,
      {
        personId: input.personId,
        personName: personSnap.data().name ?? '',
        due: parseDueDate(input.dueDate),
        notes: input.notes,
        kitId: input.kitId,
        kitName: kit.name ?? '',
        kitCheckoutId: doc(loansCol).id,
      },
      `"${kit.name}" can't go out`,
    )
    loanCount = components.length
  })

  return loanCount
}

/**
 * Returns some or all of a loan's units. Partial returns keep the loan open with
 * a higher `returnedQty`; the final return closes it and stamps the condition.
 * The item's condition is updated too, so the inventory reflects the latest word.
 */
export async function checkIn(input: CheckInInput): Promise<void> {
  const loanRef = doc(loansCol, input.loanId)

  // Upload before the transaction — transactions must stay free of side effects
  // that can't be retried, and a retry would orphan the uploaded file.
  let photoUrl: string | null = null
  let photoPath: string | null = null
  if (input.photo) {
    const uploaded = await uploadImage(input.photo, `returns/${input.loanId}`)
    photoUrl = uploaded.url
    photoPath = uploaded.publicId
  }

  await runTransaction(db, async (tx) => {
    const loanSnap = await tx.get(loanRef)
    if (!loanSnap.exists()) throw new Error('That loan record no longer exists.')

    const loan = loanSnap.data()
    if (loan.status === 'returned') throw new Error('That loan has already been returned in full.')

    const outstanding: number = (loan.qty ?? 0) - (loan.returnedQty ?? 0)
    const qty = Math.max(1, Math.floor(input.qty))
    if (qty > outstanding) {
      throw new Error(`Only ${outstanding} unit${outstanding === 1 ? '' : 's'} still out on this loan.`)
    }

    const itemRef = doc(itemsCol, loan.itemId)
    const itemSnap = await tx.get(itemRef)
    const nowFullyReturned = qty === outstanding

    tx.update(loanRef, {
      returnedQty: (loan.returnedQty ?? 0) + qty,
      status: nowFullyReturned ? 'returned' : 'out',
      returnedAt: nowFullyReturned ? serverTimestamp() : null,
      returnCondition: input.condition,
      returnNotes: input.notes,
      ...(photoUrl ? { returnPhotoUrl: photoUrl, returnPhotoPath: photoPath } : {}),
    })

    // The item may have been deleted out from under an open loan; closing the
    // loan still has to work, we just have no stock counter to put units back on.
    if (itemSnap.exists()) {
      const item = itemSnap.data()
      const total: number = item.totalQty ?? 0
      tx.update(itemRef, {
        availableQty: Math.min(total, (item.availableQty ?? 0) + qty),
        condition: input.condition,
        updatedAt: serverTimestamp(),
      })
    }
  })
}

/**
 * Checks a kit back in in one go: every listed loan is returned in full, in a
 * single transaction, so the shelf counts never show half a kit back. Loans
 * left off the list stay out and can be returned later, individually or as a
 * kit.
 */
export async function checkInKit(input: KitCheckInInput): Promise<number> {
  if (input.returns.length === 0) throw new Error('Pick at least one item that has come back.')

  // Upload outside the transaction, for the same reason as checkIn().
  let photoUrl: string | null = null
  let photoPath: string | null = null
  if (input.photo) {
    const uploaded = await uploadImage(input.photo, `returns/${input.kitCheckoutId}`)
    photoUrl = uploaded.url
    photoPath = uploaded.publicId
  }

  await runTransaction(db, async (tx) => {
    // Firestore transactions need every read done before the first write.
    const loanRefs = input.returns.map((r) => doc(loansCol, r.loanId))
    const loanSnaps = await Promise.all(loanRefs.map((ref) => tx.get(ref)))

    const loans = loanSnaps.map((snap) => {
      if (!snap.exists()) throw new Error('One of the loans in this kit no longer exists.')
      const loan = snap.data()
      if (loan.status === 'returned') {
        throw new Error(`"${loan.itemName}" has already been checked in — refresh and try again.`)
      }
      return loan
    })

    const itemIds = [...new Set(loans.map((l) => l.itemId as string))]
    const itemSnaps = new Map(
      await Promise.all(
        itemIds.map(async (id) => [id, await tx.get(doc(itemsCol, id))] as const),
      ),
    )

    // Units going back on each item's shelf, and the condition to record.
    const restock = new Map<string, { qty: number; condition: ItemCondition }>()

    input.returns.forEach((r, i) => {
      const loan = loans[i]!
      const outstanding: number = (loan.qty ?? 0) - (loan.returnedQty ?? 0)
      tx.update(loanRefs[i]!, {
        returnedQty: loan.qty ?? 0,
        status: 'returned',
        returnedAt: serverTimestamp(),
        returnCondition: r.condition,
        returnNotes: input.notes,
        ...(photoUrl ? { returnPhotoUrl: photoUrl, returnPhotoPath: photoPath } : {}),
      })
      const prev = restock.get(loan.itemId)
      restock.set(loan.itemId, { qty: (prev?.qty ?? 0) + outstanding, condition: r.condition })
    })

    for (const [itemId, { qty, condition }] of restock) {
      const snap = itemSnaps.get(itemId)
      // As with checkIn(): a deleted item can't block closing its loan.
      if (!snap?.exists()) continue
      const item = snap.data()
      tx.update(snap.ref, {
        availableQty: Math.min(item.totalQty ?? 0, (item.availableQty ?? 0) + qty),
        condition,
        updatedAt: serverTimestamp(),
      })
    }
  })

  return input.returns.length
}

/** Pushes an open loan's due date out. */
export async function extendLoan(loanId: string, dueDate: string): Promise<void> {
  const due = parseDueDate(dueDate)
  await updateDoc(doc(loansCol, loanId), { dueAt: due ? Timestamp.fromDate(due) : null })
}

/* ---------------------------------------------------------------- bulk import */

/** Firestore caps a batch at 500 writes; leave headroom. */
const BATCH_SIZE = 400

type Progress = (done: number, total: number) => void

export async function bulkCreateItems(inputs: NewItemInput[], onProgress?: Progress): Promise<number> {
  return writeInBatches(inputs, onProgress, (batch, input) => {
    const qty = Math.max(0, Math.floor(input.totalQty))
    batch.set(doc(itemsCol), {
      ...input,
      totalQty: qty,
      availableQty: qty,
      photoUrl: null,
      photoPath: null,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
}

export async function bulkCreatePeople(
  inputs: NewPersonInput[],
  onProgress?: Progress,
): Promise<number> {
  return writeInBatches(inputs, onProgress, (batch, input) => {
    batch.set(doc(peopleCol), {
      ...input,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
}

/**
 * Updates existing items from an import. Goes through the same transaction as a
 * manual edit rather than a batch, because changing totalQty has to preserve the
 * units that are currently on loan — that needs a read of the current stock.
 */
export async function bulkUpdateItems(
  updates: Array<{ id: string; input: NewItemInput }>,
  onProgress?: Progress,
): Promise<number> {
  return runWithConcurrency(updates, 8, onProgress, (u) => updateItem(u.id, u.input))
}

export async function bulkUpdatePeople(
  updates: Array<{ id: string; input: NewPersonInput }>,
  onProgress?: Progress,
): Promise<number> {
  return writeInBatches(updates, onProgress, (batch, u) => {
    batch.update(doc(peopleCol, u.id), { ...u.input, updatedAt: serverTimestamp() })
  })
}

async function writeInBatches<T>(
  rows: T[],
  onProgress: Progress | undefined,
  apply: (batch: WriteBatch, row: T) => void,
): Promise<number> {
  let done = 0
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const chunk = rows.slice(start, start + BATCH_SIZE)
    const batch = writeBatch(db)
    chunk.forEach((row) => apply(batch, row))
    await batch.commit()
    done += chunk.length
    onProgress?.(done, rows.length)
  }
  return done
}

/** Runs `task` over every row, at most `limit` in flight at a time. */
async function runWithConcurrency<T>(
  rows: T[],
  limit: number,
  onProgress: Progress | undefined,
  task: (row: T) => Promise<unknown>,
): Promise<number> {
  let next = 0
  let done = 0
  const workers = Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (next < rows.length) {
      const row = rows[next++]!
      await task(row)
      done++
      onProgress?.(done, rows.length)
    }
  })
  await Promise.all(workers)
  return done
}

