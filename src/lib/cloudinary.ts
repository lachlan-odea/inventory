const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

export const isCloudinaryConfigured = Boolean(cloudName && uploadPreset)

export interface UploadedPhoto {
  url: string
  /** Kept for reference. Deleting it needs a signed request (an API secret),
   *  which can't live in client code, so replaced/removed photos are simply
   *  unlinked, not deleted from Cloudinary. Free tier storage covers this. */
  publicId: string
}

/**
 * Scales a photo down to `maxEdge` px on its long side and re-encodes it as
 * JPEG. Phone cameras shoot 12+ MP; that's slow to send over studio wifi and
 * far bigger than an inventory thumbnail needs. Falls back to the original
 * whenever the browser can't decode it (e.g. HEIC on older Safari) — Cloudinary
 * accepts those as they are.
 */
export async function shrinkImage(file: File, maxEdge = 2000, quality = 0.85): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/**
 * Unsigned upload straight from the browser — no backend needed. Requires an
 * unsigned upload preset configured in the Cloudinary console (Settings →
 * Upload → Upload presets → add preset → Signing mode: Unsigned).
 */
export async function uploadImage(file: File, folder: string): Promise<UploadedPhoto> {
  if (!isCloudinaryConfigured) {
    throw new Error('Cloudinary is not configured — see .env.example.')
  }

  const body = new FormData()
  body.append('file', file)
  body.append('upload_preset', uploadPreset)
  body.append('folder', folder)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body,
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error?.message ?? 'Photo upload failed.')
  }

  const data = await res.json()
  return { url: data.secure_url as string, publicId: data.public_id as string }
}
