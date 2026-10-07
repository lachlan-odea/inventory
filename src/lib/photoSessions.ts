import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { shrinkImage, uploadImage } from './cloudinary'
import { db } from './firebase'
import type { Item, PhotoSession, PhotoSessionFollow, PhotoSessionItem, PhotoUpload } from './types'

/**
 * Photo sessions: a desk user shows a QR code, someone else scans it with a
 * phone and photographs gear — no account needed on the phone. See
 * firestore.rules (photoSessions) for exactly what a session unlocks.
 */

const sessionsCol = collection(db, 'photoSessions')
const itemsCol = collection(db, 'items')

/** Long enough for a shelf-by-shelf shoot; the desk can end it sooner. */
export const SESSION_HOURS = 3

/** Matches the cap in firestore.rules — keeps the session doc well under 1 MB. */
export const MAX_SESSION_ITEMS = 2000

/** Cloudinary's free tier rejects images over 10 MB. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * Set when this copy of the app isn't reachable from a phone — typically local
 * dev, where the firewall or the wifi blocks the dev server — so the QR code
 * points at the deployed site instead. Both talk to the same Firebase project.
 */
export const publicUrl = (import.meta.env.VITE_PUBLIC_URL ?? '').trim().replace(/\/*$/, '/')

/** The URL the QR code encodes. Respects the GitHub Pages base path. */
export function captureUrl(sessionId: string): string {
  const base = publicUrl.startsWith('http') ? publicUrl : `${window.location.origin}${import.meta.env.BASE_URL}`
  return `${base}capture/${sessionId}`
}

/* -------------------------------------------------------------------- desk */

/**
 * @param follow  When set, items created in the inventory while the session is
 *                live are added to it too (see `addItemToLivePhotoSessions`).
 */
export async function createPhotoSession(
  items: Item[],
  label: string,
  createdBy: string,
  follow: PhotoSessionFollow | null = null,
): Promise<string> {
  if (items.length === 0) throw new Error('There are no items to photograph.')
  if (items.length > MAX_SESSION_ITEMS) {
    throw new Error(`A session can cover up to ${MAX_SESSION_ITEMS} items — filter the list down first.`)
  }
  const sessionItems: PhotoSessionItem[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    idNumber: i.idNumber,
    location: i.location,
    photoUrl: i.photoUrl,
  }))
  const ref = await addDoc(sessionsCol, {
    label,
    createdBy: createdBy.trim().toLowerCase(),
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + SESSION_HOURS * 3600_000),
    // Kept as a flat list too, so the rules can check membership cheaply.
    itemIds: sessionItems.map((i) => i.id),
    items: sessionItems,
    follow,
  })
  return ref.id
}

/** Mirrors the Inventory page's location filter: "syd " and "SYD" are one studio. */
function followMatches(follow: PhotoSessionFollow, item: Pick<Item, 'location' | 'category'>): boolean {
  if (follow.location && item.location.trim().toUpperCase() !== follow.location.trim().toUpperCase()) return false
  if (follow.category && item.category !== follow.category) return false
  return true
}

/**
 * Adds a just-created item to every live session that follows new items and
 * whose scope it fits, so it appears on the phone within a moment of being
 * saved at the desk. Returns how many sessions picked it up. Called from
 * `createItem`; any staff member's desk can do this, not just the one that
 * opened the session.
 */
export async function addItemToLivePhotoSessions(
  item: Pick<Item, 'id' | 'name' | 'idNumber' | 'location' | 'category' | 'photoUrl'>,
): Promise<number> {
  // A single range filter needs no composite index; `follow` is checked here.
  const live = await getDocs(query(sessionsCol, where('expiresAt', '>', Timestamp.now())))
  const targets = live.docs.filter((snap) => {
    const d = snap.data()
    const follow = (d.follow ?? null) as PhotoSessionFollow | null
    const itemIds: string[] = Array.isArray(d.itemIds) ? d.itemIds : []
    return (
      follow !== null &&
      followMatches(follow, item) &&
      !itemIds.includes(item.id) &&
      itemIds.length < MAX_SESSION_ITEMS
    )
  })
  if (targets.length === 0) return 0
  const entry: PhotoSessionItem = {
    id: item.id,
    name: item.name,
    idNumber: item.idNumber,
    location: item.location,
    photoUrl: item.photoUrl,
    // A client clock, not serverTimestamp(): Firestore doesn't allow the
    // latter inside an array, and this only orders items on the phone.
    addedAt: Date.now(),
  }
  await Promise.all(
    targets.map((snap) => updateDoc(snap.ref, { itemIds: arrayUnion(item.id), items: arrayUnion(entry) })),
  )
  return targets.length
}

/** Ends a session now. The phone's page notices and stops offering uploads. */
export async function endPhotoSession(sessionId: string): Promise<void> {
  await updateDoc(doc(sessionsCol, sessionId), { expiresAt: serverTimestamp() })
}

function mapUpload(snap: QueryDocumentSnapshot<DocumentData>): PhotoUpload {
  const d = snap.data()
  return {
    id: snap.id,
    itemId: d.itemId ?? '',
    itemName: d.itemName ?? '',
    url: d.url ?? '',
    createdAt: d.createdAt ?? null,
  }
}

/** Photos taken in a session, newest first. */
export function watchSessionUploads(
  sessionId: string,
  onData: (rows: PhotoUpload[]) => void,
  onError: (err: Error) => void,
) {
  return onSnapshot(
    query(collection(sessionsCol, sessionId, 'uploads'), orderBy('createdAt', 'desc'), limit(200)),
    (snap) => onData(snap.docs.map(mapUpload)),
    onError,
  )
}

/* ------------------------------------------------------------------- phone */

/**
 * Live view of a session — the phone's page, and the desk dialog's item count.
 * Items added to the inventory mid-session arrive here too. Once it expires or
 * is ended the rules deny the read, which arrives here as `onGone`; a link
 * that never existed does the same.
 */
export function watchPhotoSession(
  sessionId: string,
  onData: (session: PhotoSession) => void,
  onGone: () => void,
  onError: (err: Error) => void,
) {
  return onSnapshot(
    doc(sessionsCol, sessionId),
    (snap) => {
      const d = snap.data()
      // An empty answer from the local cache only means "not connected yet";
      // wait for the server before calling the link dead.
      if (!d && snap.metadata.fromCache) return
      if (!d) return onGone()
      const expiresAt: Timestamp | null = d.expiresAt ?? null
      // The rules are evaluated per read, so a live listener can outlast the
      // expiry by a little; check locally too.
      if (expiresAt && expiresAt.toMillis() <= Date.now()) return onGone()
      onData({
        id: snap.id,
        label: d.label ?? '',
        createdBy: d.createdBy ?? '',
        createdAt: d.createdAt ?? null,
        expiresAt,
        items: Array.isArray(d.items) ? (d.items as PhotoSessionItem[]) : [],
        follow: (d.follow ?? null) as PhotoSessionFollow | null,
      })
    },
    (err) => {
      if ((err as { code?: string }).code === 'permission-denied') onGone()
      else onError(err)
    },
  )
}

/**
 * Uploads a photo taken on the phone and sets it as the item's photo. The item
 * update and the upload log go in one batch, so the desk never sees a photo in
 * the feed that didn't actually land on the item (or vice versa).
 */
export async function submitSessionPhoto(
  sessionId: string,
  item: PhotoSessionItem,
  photo: File,
): Promise<string> {
  if (!photo.type.startsWith('image/')) throw new Error('That file is not an image.')
  const file = await shrinkImage(photo)
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That photo is over 10 MB — try again at a lower resolution.')

  const uploaded = await uploadImage(file, `items/${item.id}`)

  const batch = writeBatch(db)
  batch.update(doc(itemsCol, item.id), {
    photoUrl: uploaded.url,
    photoPath: uploaded.publicId,
    // The rules look this session up to authorise a write from a phone with
    // no account. Left on the item afterwards; it unlocks nothing once expired.
    photoSessionId: sessionId,
    updatedAt: serverTimestamp(),
  })
  batch.set(doc(collection(sessionsCol, sessionId, 'uploads')), {
    itemId: item.id,
    itemName: item.name,
    url: uploaded.url,
    publicId: uploaded.publicId,
    createdAt: serverTimestamp(),
  })
  await batch.commit()
  return uploaded.url
}
