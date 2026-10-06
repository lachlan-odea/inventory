import { useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Field } from './ui'
import { useToast } from './Toast'
import { useStore, describeFirebaseError } from '../lib/store'
import {
  bulkCreateItems,
  bulkCreatePeople,
  bulkUpdateItems,
  bulkUpdatePeople,
} from '../lib/db'
import { parseWorkbook, type Workbook } from '../lib/import/parseFile'
import {
  autoMap,
  buildItemRows,
  buildPersonRows,
  fieldsFor,
  itemDedupeKey,
  personDedupeKey,
  type ColumnMapping,
  type ImportKind,
  type ParsedRow,
} from '../lib/import/mapping'
import { plural } from '../lib/format'
import type { NewItemInput, NewPersonInput } from '../lib/types'

type Step = 'file' | 'map' | 'review' | 'importing' | 'done'
type DuplicateStrategy = 'skip' | 'update' | 'create'
type RowAction = 'create' | 'update' | 'skip' | 'error'

interface PreparedRow {
  row: ParsedRow<NewItemInput | NewPersonInput>
  action: RowAction
  /** Set when the row matches something already in the studio. */
  existingId?: string
  reason?: string
}

interface Props {
  kind: ImportKind
  onClose: () => void
}

const PREVIEW_LIMIT = 100

export function ImportDialog({ kind, onClose }: Props) {
  const toast = useToast()
  const { items, people } = useStore()
  const fileInput = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('file')
  const [workbook, setWorkbook] = useState<Workbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState({ created: 0, updated: 0, skipped: 0, failed: 0 })

  const fields = fieldsFor(kind)
  const noun = kind === 'items' ? 'item' : 'person'
  const nounPlural = kind === 'items' ? 'items' : 'people'
  const sheet = workbook?.sheets[sheetIndex] ?? null

  /* --------------------------------------------------------------- step: file */

  async function handleFile(file: File | null) {
    if (!file) return
    setError(null)
    try {
      const parsed = await parseWorkbook(file)
      // Land on the sheet with the most rows — in a workbook with a notes tab
      // and a data tab, that's almost always the one they meant.
      const best = parsed.sheets.reduce(
        (bestIndex, s, i, all) => (s.rows.length > all[bestIndex]!.rows.length ? i : bestIndex),
        0,
      )
      if (parsed.sheets[best]!.rows.length === 0) {
        throw new Error('That file has headers but no data rows.')
      }
      setWorkbook(parsed)
      selectSheet(parsed, best)
      setStep('map')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function selectSheet(parsed: Workbook, index: number) {
    setSheetIndex(index)
    setMapping(autoMap(parsed.sheets[index]!.headers, fields))
  }

  function downloadTemplate() {
    const header = fields.map((f) => f.label)
    const example =
      kind === 'items'
        ? [
            'STUDIO 102',
            'Sony A6500',
            'Camera',
            'SYD',
            'SONY ILCE-6500',
            '4498703',
            'Black',
            'Good',
            'Shoulder Strap',
            '',
            '',
            '02-02-2023',
            'Yes',
            'Yes',
            '1',
          ]
        : ['Ada Lovelace', 'ada@example.com', '0400 000 000', 'Producer', '']
    const csv = [header, example]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `studio-stock-${nounPlural}-template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* -------------------------------------------------------- parsing + matching */

  const parsedRows = useMemo(() => {
    if (!sheet) return []
    return kind === 'items' ? buildItemRows(sheet, mapping) : buildPersonRows(sheet, mapping)
  }, [sheet, mapping, kind])

  const prepared = useMemo<PreparedRow[]>(() => {
    const existing = new Map<string, string>()
    if (kind === 'items') {
      for (const item of items) existing.set(itemDedupeKey(item), item.id)
    } else {
      for (const person of people) existing.set(personDedupeKey(person), person.id)
    }

    const seenInFile = new Set<string>()

    return parsedRows.map((row) => {
      if (row.errors.length > 0) return { row, action: 'error' as const }

      const key =
        kind === 'items'
          ? itemDedupeKey(row.values as NewItemInput)
          : personDedupeKey(row.values as NewPersonInput)

      const existingId = existing.get(key)
      if (existingId) {
        if (strategy === 'skip') {
          return { row, action: 'skip' as const, existingId, reason: `Already in the studio` }
        }
        if (strategy === 'update') return { row, action: 'update' as const, existingId }
        return { row, action: 'create' as const, reason: 'Duplicate — importing anyway' }
      }

      if (seenInFile.has(key)) {
        if (strategy === 'create') {
          return { row, action: 'create' as const, reason: 'Repeated in this file' }
        }
        return { row, action: 'skip' as const, reason: 'Repeated earlier in this file' }
      }
      seenInFile.add(key)
      return { row, action: 'create' as const }
    })
  }, [parsedRows, items, people, kind, strategy])

  const counts = useMemo(
    () => ({
      create: prepared.filter((p) => p.action === 'create').length,
      update: prepared.filter((p) => p.action === 'update').length,
      skip: prepared.filter((p) => p.action === 'skip').length,
      error: prepared.filter((p) => p.action === 'error').length,
      warning: prepared.filter((p) => p.action !== 'error' && p.row.warnings.length > 0).length,
    }),
    [prepared],
  )

  const missingRequired = fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0)

  /* ------------------------------------------------------------ step: importing */

  async function runImport() {
    setStep('importing')
    setError(null)

    const toCreate = prepared.filter((p) => p.action === 'create').map((p) => p.row.values)
    const toUpdate = prepared
      .filter((p) => p.action === 'update')
      .map((p) => ({ id: p.existingId!, input: p.row.values }))

    const total = toCreate.length + toUpdate.length
    setProgress({ done: 0, total })

    let created = 0
    let updated = 0
    let failed = 0

    try {
      if (toCreate.length > 0) {
        const track = (done: number) => setProgress({ done, total })
        created =
          kind === 'items'
            ? await bulkCreateItems(toCreate as NewItemInput[], track)
            : await bulkCreatePeople(toCreate as NewPersonInput[], track)
      }

      if (toUpdate.length > 0) {
        const track = (done: number) => setProgress({ done: created + done, total })
        updated =
          kind === 'items'
            ? await bulkUpdateItems(
                toUpdate as Array<{ id: string; input: NewItemInput }>,
                track,
              )
            : await bulkUpdatePeople(
                toUpdate as Array<{ id: string; input: NewPersonInput }>,
                track,
              )
      }
    } catch (err) {
      // Batches already committed stay committed — say so rather than implying
      // the whole import rolled back.
      failed = total - created - updated
      setError(
        `${describeFirebaseError(err)} ${
          created + updated > 0
            ? `${created + updated} rows were already saved before this happened.`
            : ''
        }`,
      )
    }

    setResult({ created, updated, skipped: counts.skip + counts.error, failed })
    setStep('done')
    if (failed === 0) {
      toast.success(
        `Imported ${plural(created + updated, noun, nounPlural)} from ${workbook?.source ?? 'file'}.`,
      )
    }
  }

  /* ---------------------------------------------------------------------- view */

  const title =
    kind === 'items' ? 'Import inventory from a spreadsheet' : 'Import people from a spreadsheet'

  return (
    <Modal
      title={title}
      subtitle={
        workbook && sheet
          ? [
              workbook.source,
              workbook.sheets.length > 1 ? sheet.sheetName : null,
              plural(sheet.rows.length, 'row'),
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      onClose={onClose}
      wide
      footer={<Footer />}
    >
      {step === 'file' && (
        <div className="import-drop">
          <p>
            Pick an <strong>.xlsx</strong> or <strong>.csv</strong> file. The first row should be
            your column headings — you'll match them up to the right fields next, so the column
            order doesn't matter.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xlsm,.csv,.txt,text/csv"
            className="visually-hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <div className="btn-row">
            <button className="btn btn--primary" onClick={() => fileInput.current?.click()}>
              Choose file
            </button>
            <button className="btn btn--ghost" onClick={downloadTemplate}>
              Download a template
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}

      {step === 'map' && sheet && workbook && (
        <div className="form">
          {workbook.sheets.length > 1 && (
            <Field label="Sheet" hint={`This workbook has ${workbook.sheets.length} sheets`}>
              <select
                value={sheetIndex}
                onChange={(e) => selectSheet(workbook, Number(e.target.value))}
              >
                {workbook.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.sheetName} — {plural(s.rows.length, 'row')}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="muted">
            We guessed these from your column headings — change anything that looks wrong.
          </p>
          <table className="table map-table">
            <thead>
              <tr>
                <th>Studio Stock field</th>
                <th>Spreadsheet column</th>
                <th>First row</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => {
                const column = mapping[field.key] ?? -1
                const sample = column >= 0 ? (sheet.rows[0]?.[column] ?? '') : ''
                return (
                  <tr key={field.key}>
                    <td>
                      <strong>{field.label}</strong>
                      {field.required && <span className="field__required"> *</span>}
                      {field.hint && <p className="muted small">{field.hint}</p>}
                    </td>
                    <td>
                      <select
                        value={column}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [field.key]: Number(e.target.value) }))
                        }
                      >
                        <option value={-1}>— don't import —</option>
                        {sheet.headers.map((header, i) => (
                          <option key={i} value={i}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="muted">{sample || <span className="muted">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {missingRequired.length > 0 && (
            <p className="form-error">
              Map a column to {missingRequired.map((f) => f.label).join(' and ')} to continue.
            </p>
          )}
        </div>
      )}

      {step === 'review' && (
        <div className="form">
          <div className="import-summary">
            <span className="badge badge--in">{counts.create} to add</span>
            {counts.update > 0 && (
              <span className="badge badge--partial">{counts.update} to update</span>
            )}
            {counts.skip > 0 && <span className="badge badge--muted">{counts.skip} skipped</span>}
            {counts.error > 0 && (
              <span className="badge badge--overdue">{counts.error} can't be imported</span>
            )}
            {counts.warning > 0 && (
              <span className="badge badge--due-soon">{counts.warning} with warnings</span>
            )}
          </div>

          <Field
            label={`When a ${noun} is already in the studio`}
            hint={
              kind === 'items'
                ? 'Matched on ID Number, then Serial Number, then name.'
                : 'Matched on email when there is one, otherwise on name.'
            }
          >
            <div className="chip-row">
              {(
                [
                  ['skip', 'Skip it'],
                  ['update', 'Update it'],
                  ['create', 'Add anyway'],
                ] as Array<[DuplicateStrategy, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`chip${strategy === value ? ' chip--on chip--good' : ''}`}
                  onClick={() => setStrategy(value)}
                  aria-pressed={strategy === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <div className="table-wrap import-preview">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Action</th>
                  {kind === 'items' && <th>ID Number</th>}
                  <th>{kind === 'items' ? 'Item' : 'Name'}</th>
                  {kind === 'items' && <th>Qty</th>}
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {prepared.slice(0, PREVIEW_LIMIT).map((p) => (
                  <tr key={p.row.rowNumber} className={p.action === 'error' ? 'is-overdue' : undefined}>
                    <td className="muted">{p.row.rowNumber}</td>
                    <td>
                      <ActionBadge action={p.action} />
                    </td>
                    {kind === 'items' && (
                      <td className="muted">{(p.row.values as NewItemInput).idNumber || '—'}</td>
                    )}
                    <td>{p.row.values.name || <span className="muted">(blank)</span>}</td>
                    {kind === 'items' && <td>{(p.row.values as NewItemInput).totalQty}</td>}
                    <td className="muted small">
                      {[...p.row.errors, ...p.row.warnings, p.reason].filter(Boolean).join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prepared.length > PREVIEW_LIMIT && (
            <p className="muted small">
              Showing the first {PREVIEW_LIMIT} of {prepared.length} rows. All of them will be
              imported.
            </p>
          )}
        </div>
      )}

      {step === 'importing' && (
        <div className="import-progress">
          <span className="spinner" aria-hidden="true" />
          <p>
            Importing {progress.done} of {progress.total}…
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
          >
            <span
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="import-done">
          <p className="import-done__icon" aria-hidden="true">
            {result.failed > 0 ? '⚠️' : '🎉'}
          </p>
          <h3>
            {result.failed > 0 ? 'Import finished with problems' : 'Import complete'}
          </h3>
          <ul className="import-result">
            <li>
              <strong>{result.created}</strong> added
            </li>
            {result.updated > 0 && (
              <li>
                <strong>{result.updated}</strong> updated
              </li>
            )}
            {result.skipped > 0 && (
              <li>
                <strong>{result.skipped}</strong> skipped
              </li>
            )}
            {result.failed > 0 && (
              <li className="text-bad">
                <strong>{result.failed}</strong> failed
              </li>
            )}
          </ul>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </Modal>
  )

  function Footer() {
    if (step === 'file') {
      return (
        <button className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
      )
    }
    if (step === 'map') {
      return (
        <>
          <button className="btn btn--ghost" onClick={() => setStep('file')}>
            Back
          </button>
          <button
            className="btn btn--primary"
            disabled={missingRequired.length > 0}
            onClick={() => setStep('review')}
          >
            Preview import
          </button>
        </>
      )
    }
    if (step === 'review') {
      return (
        <>
          <button className="btn btn--ghost" onClick={() => setStep('map')}>
            Back
          </button>
          <button
            className="btn btn--primary"
            disabled={counts.create + counts.update === 0}
            onClick={runImport}
          >
            Import {plural(counts.create + counts.update, noun, nounPlural)}
          </button>
        </>
      )
    }
    if (step === 'importing') return <span className="muted">Please keep this window open…</span>
    return (
      <button className="btn btn--primary" onClick={onClose}>
        Done
      </button>
    )
  }
}

function ActionBadge({ action }: { action: RowAction }) {
  if (action === 'create') return <span className="badge badge--in">Add</span>
  if (action === 'update') return <span className="badge badge--partial">Update</span>
  if (action === 'skip') return <span className="badge badge--muted">Skip</span>
  return <span className="badge badge--overdue">Error</span>
}
