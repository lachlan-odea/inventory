import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Modal } from './Modal'
import { useToast } from './Toast'
import { useAuth } from '../lib/auth'
import { isCloudinaryConfigured } from '../lib/cloudinary'
import { formatDateTime, plural } from '../lib/format'
import {
  captureUrl,
  createPhotoSession,
  publicUrl,
  endPhotoSession,
  SESSION_HOURS,
  watchPhotoSession,
  watchSessionUploads,
} from '../lib/photoSessions'
import { describeFirebaseError } from '../lib/store'
import type { Item, PhotoSessionFollow, PhotoUpload } from '../lib/types'

interface PhoneCameraDialogProps {
  /** The items the phone will be offered. */
  items: Item[]
  /** Shown on the phone so the photographer knows what they're working through. */
  label: string
  /**
   * When set, items created in the inventory while the session is live join
   * it too — so one person can type gear in while another photographs it.
   * Omit for a fixed set, such as a single item.
   */
  follow?: PhotoSessionFollow | null
  onClose: () => void
}

/** "for SYD", "in Camera", "for SYD in Camera", or '' when it follows everything. */
function describeFollow(follow: PhotoSessionFollow): string {
  return [follow.location && `for ${follow.location}`, follow.category && `in ${follow.category}`]
    .filter(Boolean)
    .join(' ')
}

/**
 * Shows a QR code that opens the capture page on a phone. Whoever scans it can
 * photograph the given items without signing in, until the session expires or
 * is ended here. Closing the dialog leaves the session running — the person on
 * the phone may well still be working.
 */
export function PhoneCameraDialog({ items, label, follow = null, onClose }: PhoneCameraDialogProps) {
  const toast = useToast()
  const { state } = useAuth()
  const email = state.status === 'staff' ? (state.user.email ?? '') : ''

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<PhotoUpload[]>([])
  // How many items the session covers now — grows as colleagues add gear.
  const [liveCount, setLiveCount] = useState<number | null>(null)
  const [ended, setEnded] = useState(false)
  const [expiresAt] = useState(() => new Date(Date.now() + SESSION_HOURS * 3600_000))
  // StrictMode mounts effects twice in development; one session is plenty.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!isCloudinaryConfigured) {
      setError('Photo uploads are not set up yet — add the Cloudinary settings (see .env.example).')
      return
    }
    createPhotoSession(items, label, email, follow)
      .then(setSessionId)
      .catch((err) => setError(describeFirebaseError(err)))
  }, [items, label, email, follow])

  const url = sessionId ? captureUrl(sessionId) : null

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setError('Could not draw the QR code — copy the link instead.'))
  }, [url])

  useEffect(() => {
    if (!sessionId) return
    return watchSessionUploads(sessionId, setUploads, (err) => setError(describeFirebaseError(err)))
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || !follow) return
    // Only the count matters here; ending and expiry are handled above.
    return watchPhotoSession(
      sessionId,
      (session) => setLiveCount(session.items.length),
      () => undefined,
      () => undefined,
    )
  }, [sessionId, follow])

  // A dev server is rarely reachable from a phone: "localhost" is the phone
  // itself, and a LAN address is usually blocked by the firewall or the wifi.
  // Pointless to warn once VITE_PUBLIC_URL sends phones to the deployed site.
  const onDevServer = !publicUrl.startsWith('http') && import.meta.env.DEV

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied.')
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  async function end() {
    if (!sessionId) return
    try {
      await endPhotoSession(sessionId)
      setEnded(true)
      toast.success('Session ended — the QR code no longer works.')
    } catch (err) {
      toast.error(describeFirebaseError(err))
    }
  }

  const photographed = new Set(uploads.map((u) => u.itemId)).size
  const itemCount = liveCount ?? items.length
  const addedCount = Math.max(0, itemCount - items.length)

  return (
    <Modal
      title="Take photos on a phone"
      subtitle={`${label} · ${plural(itemCount, 'item')}`}
      onClose={onClose}
      footer={
        <>
          {sessionId && !ended && (
            <button type="button" className="btn btn--ghost btn--danger" onClick={end}>
              End session
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {error ? (
        <p className="form-error">{error}</p>
      ) : ended ? (
        <p className="callout">This session has ended. Open a new one to take more photos.</p>
      ) : (
        <div className="phone-session">
          <div className="phone-session__qr">
            {qr ? (
              <img src={qr} alt="QR code that opens the photo page on a phone" width={240} height={240} />
            ) : (
              <span className="spinner" aria-hidden="true" />
            )}
          </div>
          <div className="phone-session__steps">
            <ol>
              <li>Scan this with the phone's camera app.</li>
              <li>Tap an item, take the photo — it's saved to that item straight away.</li>
              <li>No sign-in needed on the phone.</li>
              {follow && (
                <li>
                  Items added to the inventory {describeFollow(follow) || 'anywhere'} while this
                  runs appear on the phone too, so someone else can keep entering gear.
                </li>
              )}
            </ol>
            {addedCount > 0 && (
              <p className="muted small">{plural(addedCount, 'item')} added since the session opened.</p>
            )}
            <p className="muted small">
              The link works until{' '}
              {expiresAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} or
              until you end the session. Anyone
              holding it can change photos for these items — and nothing else.
            </p>
            {url && <code className="phone-session__url">{url}</code>}
            <button type="button" className="btn btn--small btn--ghost" disabled={!url} onClick={copyLink}>
              Copy link
            </button>
          </div>
        </div>
      )}

      {onDevServer && !error && !ended && (
        <p className="callout callout--warn small">
          This QR code points at your dev server, which a phone usually can't reach — Windows
          Firewall and office wifi both block it. Set <code>VITE_PUBLIC_URL</code> in{' '}
          <code>.env</code> to the deployed site so phones open that instead.
        </p>
      )}

      {uploads.length > 0 && (
        <section className="phone-session__feed">
          <h3>{plural(photographed, 'item')} photographed</h3>
          <ul>
            {uploads.map((u) => (
              <li key={u.id}>
                <img className="thumb" src={u.url} alt="" width={40} height={40} />
                <span>
                  <strong>{u.itemName}</strong>
                  <span className="muted small"> · {u.createdAt ? formatDateTime(u.createdAt) : 'just now'}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  )
}
