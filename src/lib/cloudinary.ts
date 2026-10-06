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
