import { useEffect, useRef, useState } from 'react'

interface PhotoPickerProps {
  /** Existing photo to show when nothing new has been picked. */
  currentUrl?: string | null
  onChange: (file: File | null) => void
  onRemoveExisting?: () => void
  label?: string
}

const MAX_BYTES = 8 * 1024 * 1024

/**
 * File input with a live preview. `capture` isn't set, so phones offer both the
 * camera and the gallery — studio photos often come from either.
 */
export function PhotoPicker({ currentUrl, onChange, onRemoveExisting, label = 'Photo' }: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Object URLs leak unless revoked when the preview changes or unmounts.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function handleFile(file: File | null) {
    setError(null)
    if (preview) URL.revokeObjectURL(preview)

    if (!file) {
      setPreview(null)
      onChange(null)
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.')
      setPreview(null)
      onChange(null)
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Images need to be under 8 MB.')
      setPreview(null)
      onChange(null)
      return
    }
    setPreview(URL.createObjectURL(file))
    onChange(file)
  }

  const shown = preview ?? currentUrl ?? null

  return (
    <div className="photo-picker">
      <span className="field__label">{label}</span>
      <div className="photo-picker__row">
        {shown ? (
          <img className="photo-picker__preview" src={shown} alt="Selected" />
        ) : (
          <div className="photo-picker__preview photo-picker__preview--empty" aria-hidden="true">
            📷
          </div>
        )}
        <div className="photo-picker__actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <button type="button" className="btn btn--ghost" onClick={() => inputRef.current?.click()}>
            {shown ? 'Change' : 'Add photo'}
          </button>
          {preview && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = ''
                handleFile(null)
              }}
            >
              Undo
            </button>
          )}
          {!preview && currentUrl && onRemoveExisting && (
            <button type="button" className="btn btn--ghost btn--danger" onClick={onRemoveExisting}>
              Remove
            </button>
          )}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
