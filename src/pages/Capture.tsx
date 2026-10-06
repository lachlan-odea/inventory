import { useEffect, useMemo, useRef, useState } from 'react'
import { submitSessionPhoto, watchPhotoSession } from '../lib/photoSessions'
import { describeFirebaseError } from '../lib/store'
import { plural } from '../lib/format'
import type { PhotoSession, PhotoSessionItem } from '../lib/types'

type Load =
  | { status: 'loading' }
  | { status: 'ready'; session: PhotoSession }
  | { status: 'gone' }
  | { status: 'error'; message: string }

type Shot =
  | { status: 'uploading' }
  | { status: 'done'; url: string }
  | { status: 'error'; message: string }

/**
 * The page a phone opens from a photo-session QR code. Deliberately outside
 * the sign-in gate: the session ID in the URL is the only credential, and the
 * rules limit it to these items' photos.
 */
export function Capture({ sessionId }: { sessionId: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (load.status !== 'loading') return
    const timer = window.setTimeout(() => setSlow(true), 12_000)
    return () => window.clearTimeout(timer)
  }, [load.status])

  useEffect(() => {
    if (!sessionId) return setLoad({ status: 'gone' })
    return watchPhotoSession(
      sessionId,
      (session) => setLoad({ status: 'ready', session }),
      () => setLoad({ status: 'gone' }),
      (err) => setLoad({ status: 'error', message: describeFirebaseError(err) }),
    )
  }, [sessionId])

  if (load.status === 'loading') {
    return (
      <div className="setup">
        <div className="loading">
          <span className="spinner" aria-hidden="true" />
          <p>Opening photo session…</p>
          {slow && (
            <p className="muted small">
              This is taking a while. Check the phone has internet access — try switching between
              wifi and mobile data.
            </p>
          )}
        </div>
      </div>
    )
  }
  if (load.status === 'gone' || load.status === 'error') {
    return (
      <div className="setup">
        <div className="setup__card">
          <div className="setup__logo" aria-hidden="true">
            📷
          </div>
          <h1>{load.status === 'gone' ? 'This link has expired' : 'Something went wrong'}</h1>
          <p className="muted">
            {load.status === 'gone'
              ? 'The photo session has ended or the link is wrong. Ask for a new QR code from the Studio Inventory desk.'
              : load.message}
          </p>
        </div>
      </div>
    )
  }
  return <CaptureSession session={load.session} />
}

export function CaptureSession({ session }: { session: PhotoSession }) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Which item the camera was opened for; the file input is shared.
  const target = useRef<PhotoSessionItem | null>(null)
  const [shots, setShots] = useState<Record<string, Shot>>({})
  const [search, setSearch] = useState('')
  const anyMissing = session.items.some((i) => !i.photoUrl)
  const [onlyMissing, setOnlyMissing] = useState(anyMissing)

  const single = session.items.length === 1 ? session.items[0]! : null

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return session.items.filter((item) => {
      // Items photographed in this session stay put, ticked, rather than
      // vanishing from the "needs a photo" list mid-shoot.
      if (onlyMissing && item.photoUrl && !shots[item.id]) return false
      if (!q) return true
      return [item.name, item.idNumber, item.location].join(' ').toLowerCase().includes(q)
    })
  }, [session.items, search, onlyMissing, shots])

  const doneCount = Object.values(shots).filter((s) => s.status === 'done').length

  function openCamera(item: PhotoSessionItem) {
    target.current = item
    if (inputRef.current) inputRef.current.value = ''
    inputRef.current?.click()
  }

  async function handleFile(file: File | null) {
    const item = target.current
    if (!file || !item) return
    setShots((s) => ({ ...s, [item.id]: { status: 'uploading' } }))
    try {
      const url = await submitSessionPhoto(session.id, item, file)
      setShots((s) => ({ ...s, [item.id]: { status: 'done', url } }))
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      const message = code.includes('permission-denied')
        ? 'The session has ended — ask for a new QR code.'
        : describeFirebaseError(err)
      setShots((s) => ({ ...s, [item.id]: { status: 'error', message } }))
    }
  }

  return (
    <div className="capture">
      <header className="capture__head">
        <div>
          <p className="capture__kicker">📷 Studio Inventory · photo session</p>
          <h1>{single ? single.name : session.label}</h1>
          <p className="muted small">
            {single
              ? single.idNumber || 'Take a photo of this item.'
              : `${plural(session.items.length, 'item')} · ${doneCount} photographed`}
          </p>
        </div>
      </header>

      {/* No `multiple`: each photo belongs to one item. `capture` opens the
          rear camera directly instead of the file picker. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {single ? (
        <SingleItem item={single} shot={shots[single.id]} onShoot={() => openCamera(single)} />
      ) : (
        <>
          <div className="capture__tools">
            <input
              type="search"
              placeholder="Search name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {anyMissing && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={onlyMissing}
                  onChange={(e) => setOnlyMissing(e.target.checked)}
                />
                Needs a photo
              </label>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="muted pad">Nothing matches.</p>
          ) : (
            <ul className="capture__list">
              {visible.map((item) => (
                <CaptureRow key={item.id} item={item} shot={shots[item.id]} onShoot={() => openCamera(item)} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function photoFor(item: PhotoSessionItem, shot: Shot | undefined): string | null {
  return shot?.status === 'done' ? shot.url : item.photoUrl
}

function ShotStatus({ shot }: { shot: Shot | undefined }) {
  if (!shot) return null
  if (shot.status === 'uploading') return <span className="capture__status">Uploading…</span>
  if (shot.status === 'done') return <span className="capture__status is-done">✓ Saved</span>
  return <span className="capture__status is-error">{shot.message}</span>
}

function CaptureRow({ item, shot, onShoot }: { item: PhotoSessionItem; shot?: Shot; onShoot: () => void }) {
  const photo = photoFor(item, shot)
  const busy = shot?.status === 'uploading'
  return (
    <li className={`capture-row${shot?.status === 'done' ? ' is-done' : ''}`}>
      {photo ? (
        <img className="thumb" src={photo} alt="" loading="lazy" width={56} height={56} />
      ) : (
        <span className="thumb thumb--empty" style={{ width: 56, height: 56 }} aria-hidden="true">
          📦
        </span>
      )}
      <div className="capture-row__body">
        <strong>{item.name}</strong>
        <span className="muted small">{[item.idNumber, item.location].filter(Boolean).join(' · ')}</span>
        <ShotStatus shot={shot} />
      </div>
      <button
        type="button"
        className={`btn${photo ? ' btn--ghost' : ' btn--primary'}`}
        disabled={busy}
        onClick={onShoot}
        aria-label={`${photo ? 'Retake' : 'Take'} photo of ${item.name}`}
      >
        {busy ? '…' : photo ? 'Retake' : 'Photo'}
      </button>
    </li>
  )
}

function SingleItem({ item, shot, onShoot }: { item: PhotoSessionItem; shot?: Shot; onShoot: () => void }) {
  const photo = photoFor(item, shot)
  const busy = shot?.status === 'uploading'
  return (
    <div className="capture-single">
      {photo ? (
        <img className="capture-single__photo" src={photo} alt={item.name} />
      ) : (
        <div className="capture-single__photo capture-single__photo--empty" aria-hidden="true">
          📦
        </div>
      )}
      <ShotStatus shot={shot} />
      <button type="button" className="btn btn--primary capture-single__btn" disabled={busy} onClick={onShoot}>
        {busy ? 'Uploading…' : photo ? 'Retake photo' : 'Take photo'}
      </button>
    </div>
  )
}
