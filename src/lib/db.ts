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
  type WriteBatch,
} from 'firebase/firestore'
import { uploadImage } from './cloudinary'
import { db } from './firebase'
import { parseDueDate } from './format'
import type {
  CheckInInput,
  CheckOutInput,
  Item,
  Loan,
  NewItemInput,
  NewPersonInput,
  Person,
} from './types'

const itemsCol = collection(db, 'items')
const peopleCol = collection(db, 'people')
const loansCol = collection(db, 'loans')

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

/* --------------------------------------------------------------- check in/out */

/**
 * Checks units out to a person. The availability check and the decrement happen
 * in one transaction, so two people scanning the last unit at the same time
 * can't both win.
 */
export async function checkOut(input: CheckOutInput): Promise<string> {
  const itemRef = doc(itemsCol, input.itemId)
  const personRef = doc(peopleCol, input.personId)
  const loanRef = doc(loansCol)
  const qty = Math.max(1, Math.floor(input.qty))
  const due = parseDueDate(input.dueDate)

  await runTransaction(db, async (tx) => {
    const [itemSnap, personSnap] = await Promise.all([tx.get(itemRef), tx.get(personRef)])
    if (!itemSnap.exists()) throw new Error('That item no longer exists.')
    if (!personSnap.exists()) throw new Error('That person is no longer in the list.')

    const item = itemSnap.data()
    const available: number = item.availableQty ?? 0
    if (available < qty) {
      throw new Error(
        available === 0
          ? `"${item.name}" is fully checked out.`
          : `Only ${available} of "${item.name}" ${available === 1 ? 'is' : 'are'} available.`,
      )
    }

    tx.update(itemRef, { availableQty: available - qty, updatedAt: serverTimestamp() })
    tx.set(loanRef, {
      itemId: input.itemId,
      itemName: item.name ?? '',
      personId: input.personId,
      personName: personSnap.data().name ?? '',
      qty,
      returnedQty: 0,
      status: 'out',
      checkedOutAt: serverTimestamp(),
      dueAt: due ? Timestamp.fromDate(due) : null,
      returnedAt: null,
      checkoutNotes: input.notes,
      returnCondition: null,
      returnNotes: '',
      returnPhotoUrl: null,
      returnPhotoPath: null,
    })
  })

  return loanRef.id
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

