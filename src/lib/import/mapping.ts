import type { ItemCondition, NewItemInput, NewPersonInput } from '../types'
import type { SheetData } from './parseFile'

export type ImportKind = 'items' | 'people'

export interface FieldDef {
  key: string
  label: string
  required?: boolean
  hint?: string
  /** Header spellings we've seen in the wild, normalised at match time. */
  aliases: string[]
}

/**
 * Ordered to match the studio's existing inventory spreadsheet, so the mapping
 * screen reads top-to-bottom in the same order as the columns in the file.
 */
export const ITEM_FIELDS: FieldDef[] = [
  {
    key: 'idNumber',
    label: 'ID Number',
    hint: 'The studio asset ID, e.g. STUDIO 102',
    aliases: ['id number', 'id', 'asset id', 'asset tag', 'asset number', 'studio id', 'inventory number', 'inventory id', 'tag', 'sku', 'barcode', 'reference', 'ref', 'code'],
  },
  {
    key: 'name',
    label: 'Item',
    required: true,
    aliases: ['item', 'item name', 'name', 'equipment', 'equipment name', 'gear', 'asset name', 'product', 'title'],
  },
  { key: 'category', label: 'Category', aliases: ['category', 'type', 'group', 'class', 'kind', 'department'] },
  {
    key: 'location',
    label: 'Studio Location',
    aliases: ['studio location', 'location', 'studio', 'site', 'storage', 'storage location', 'shelf', 'room', 'bin', 'office', 'where', 'stored'],
  },
  { key: 'modelNumber', label: 'Model Number', aliases: ['model number', 'model', 'model no', 'model number'] },
  { key: 'serialNumber', label: 'Serial Number', aliases: ['serial number', 'serial', 'serial no', 's n', 'sn'] },
  { key: 'description', label: 'Description', aliases: ['description', 'desc', 'details', 'spec'] },
  {
    key: 'condition',
    label: 'Condition',
    hint: 'Good / Worn / Damaged / In repair — anything else imports as Good',
    aliases: ['condition', 'state', 'quality'],
  },
  {
    key: 'accessories',
    label: 'Accessories',
    aliases: ['accessories', 'accessory', 'included', 'includes', 'extras', 'kit', 'comes with'],
  },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comment', 'comments', 'remarks'] },
  {
    key: 'purchaseDate',
    label: 'Purchase date',
    hint: 'Day-first dates (02-02-2023 = 2 Feb)',
    aliases: ['purchase date', 'purchased', 'date purchased', 'purchase', 'acquired', 'date acquired', 'bought'],
  },
  {
    key: 'lastInspectionDate',
    label: 'Last inspection date',
    aliases: ['last inspection date', 'last inspection', 'inspection date', 'last inspected', 'inspected', 'last checked', 'inspection', 'last tested', 'test date'],
  },
  {
    key: 'labelled',
    label: 'Labelled',
    hint: 'Yes / No — anything unrecognised imports as "not recorded"',
    aliases: ['labelled', 'labeled', 'label', 'tagged', 'has label', 'asset labelled'],
  },
  {
    key: 'fitForService',
    label: 'Fit for Service',
    hint: 'Yes / No — items marked No are flagged before checkout',
    aliases: ['fit for service', 'fit for use', 'serviceable', 'in service', 'usable', 'safe to use', 'fit'],
  },
  {
    key: 'totalQty',
    label: 'Quantity',
    hint: "Leave unmapped if each row is one asset — they'll import as 1 each",
    aliases: ['qty', 'quantity', 'count', 'total qty', 'stock', 'units', 'on hand', 'amount'],
  },
]

export const PERSON_FIELDS: FieldDef[] = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    aliases: ['name', 'full name', 'person', 'borrower', 'staff', 'staff name', 'employee', 'user', 'contact'],
  },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address', 'mail'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'telephone', 'phone number', 'contact number', 'cell'] },
  { key: 'role', label: 'Role', aliases: ['role', 'title', 'job title', 'position', 'department', 'team', 'job'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comment', 'comments', 'remarks'] },
]

export function fieldsFor(kind: ImportKind): FieldDef[] {
  return kind === 'items' ? ITEM_FIELDS : PERSON_FIELDS
}

/** Field key -> column index in the sheet, or -1 for "don't import". */
export type ColumnMapping = Record<string, number>

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Guesses which spreadsheet column feeds which field. Scores every
 * field/column pair, then assigns greedily from the best match down so one
 * column can't be claimed twice — otherwise "Item name" and "Category name"
 * both grab whichever column they see first.
 */
export function autoMap(headers: string[], fields: FieldDef[]): ColumnMapping {
  const scored: Array<{ field: string; column: number; score: number }> = []

  headers.forEach((header, column) => {
    const h = normalise(header)
    if (!h) return
    for (const field of fields) {
      let best = 0
      for (const alias of field.aliases) {
        const a = normalise(alias)
        if (h === a) best = Math.max(best, 100)
        else if (h.startsWith(`${a} `) || h.endsWith(` ${a}`)) best = Math.max(best, 70)
        else if (h.split(' ').includes(a)) best = Math.max(best, 60)
        else if (a.length >= 4 && h.includes(a)) best = Math.max(best, 40)
      }
      if (best > 0) scored.push({ field: field.key, column, score: best })
    }
  })

  scored.sort((a, b) => b.score - a.score)

  const mapping: ColumnMapping = Object.fromEntries(fields.map((f) => [f.key, -1]))
  const takenColumns = new Set<number>()
  for (const candidate of scored) {
    if (mapping[candidate.field] !== -1 || takenColumns.has(candidate.column)) continue
    mapping[candidate.field] = candidate.column
    takenColumns.add(candidate.column)
  }
  return mapping
}

export interface ParsedRow<T> {
  /** 1-based row number as it appears in the spreadsheet body. */
  rowNumber: number
  values: T
  /** Blocking — the row is not imported. */
  errors: string[]
  /** Non-blocking — the row imports with a substituted value. */
  warnings: string[]
}

export function buildItemRows(sheet: SheetData, mapping: ColumnMapping): ParsedRow<NewItemInput>[] {
  return sheet.rows.map((row, index) => {
    const get = (field: string) => cell(row, mapping[field])
    const errors: string[] = []
    const warnings: string[] = []

    const name = get('name')
    if (!name) errors.push('No item name')

    const rawQty = get('totalQty')
    let totalQty = 1
    if (rawQty) {
      const parsed = parseQuantity(rawQty)
      if (parsed === null) {
        warnings.push(`Couldn't read quantity "${rawQty}" — importing as 1`)
      } else if (parsed < 0) {
        errors.push(`Negative quantity "${rawQty}"`)
      } else {
        totalQty = parsed
      }
    } else if ((mapping['totalQty'] ?? -1) >= 0) {
      warnings.push('Quantity blank — importing as 1')
    }

    const rawCondition = get('condition')
    const condition = parseCondition(rawCondition)
    if (rawCondition && condition === null) {
      warnings.push(`Unrecognised condition "${rawCondition}" — importing as Good`)
    }

    const readDate = (field: string, label: string) => {
      const raw = get(field)
      if (isNotRecorded(raw)) return ''
      const parsed = parseDateCell(raw)
      if (!parsed) {
        warnings.push(`Couldn't read ${label} "${raw}" — leaving it blank`)
        return ''
      }
      return parsed
    }

    const readBool = (field: string, label: string) => {
      const raw = get(field)
      if (isNotRecorded(raw)) return null
      const parsed = parseBoolean(raw)
      if (parsed === null) warnings.push(`Unrecognised ${label} "${raw}" — leaving it unset`)
      return parsed
    }

    return {
      rowNumber: index + 1,
      errors,
      warnings,
      values: {
        idNumber: get('idNumber'),
        name,
        category: get('category'),
        location: get('location'),
        modelNumber: get('modelNumber'),
        serialNumber: get('serialNumber'),
        description: get('description'),
        condition: condition ?? 'good',
        accessories: get('accessories'),
        notes: get('notes'),
        purchaseDate: readDate('purchaseDate', 'purchase date'),
        lastInspectionDate: readDate('lastInspectionDate', 'inspection date'),
        labelled: readBool('labelled', 'Labelled value'),
        fitForService: readBool('fitForService', 'Fit for Service value'),
        totalQty,
      },
    }
  })
}

export function buildPersonRows(sheet: SheetData, mapping: ColumnMapping): ParsedRow<NewPersonInput>[] {
  return sheet.rows.map((row, index) => {
    const get = (field: string) => cell(row, mapping[field])
    const errors: string[] = []
    const warnings: string[] = []

    const name = get('name')
    if (!name) errors.push('No name')

    const email = get('email')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      warnings.push(`"${email}" doesn't look like an email address`)
    }

    return {
      rowNumber: index + 1,
      errors,
      warnings,
      values: { name, email, phone: get('phone'), role: get('role'), notes: get('notes') },
    }
  })
}

function cell(row: string[], column: number | undefined): string {
  if (column === undefined || column < 0) return ''
  return (row[column] ?? '').trim()
}

/** Tolerates "12", "12 units", "1,200", "3.0" — anything else is unreadable. */
export function parseQuantity(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (!cleaned) return null
  const value = Number(cleaned[0])
  if (!Number.isFinite(value)) return null
  return Math.trunc(value)
}

const CONDITION_WORDS: Record<string, ItemCondition> = {
  good: 'good',
  ok: 'good',
  okay: 'good',
  fine: 'good',
  new: 'good',
  excellent: 'good',
  working: 'good',
  worn: 'worn',
  used: 'worn',
  fair: 'worn',
  aging: 'worn',
  tired: 'worn',
  damaged: 'damaged',
  broken: 'damaged',
  faulty: 'damaged',
  cracked: 'damaged',
  dead: 'damaged',
  repair: 'repair',
  repairs: 'repair',
  servicing: 'repair',
  service: 'repair',
  workshop: 'repair',
}

export function parseCondition(raw: string): ItemCondition | null {
  if (!raw) return null
  const words = normalise(raw).split(' ')
  for (const word of words) {
    const match = CONDITION_WORDS[word]
    if (match) return match
  }
  return null
}

/**
 * Reads the date formats that turn up in exported spreadsheets and returns
 * yyyy-mm-dd. Ambiguous numeric dates are read **day-first** (02-02-2023 is
 * 2 February), matching Australian convention — the one case that can't be
 * detected from the value alone.
 */
export function parseDateCell(raw: string): string {
  const value = raw.trim()
  if (!value) return ''

  // Already ISO (this is what a real Excel date cell converts to).
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (iso) return isoOrEmpty(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  // d/m/y or d-m-y, with 2- or 4-digit years.
  const dmy = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/)
  if (dmy) {
    let day = Number(dmy[1])
    let month = Number(dmy[2])
    // If the first number can't be a day, the file is month-first after all.
    if (day > 12 && month <= 12) {
      // day-first confirmed, nothing to do
    } else if (month > 12 && day <= 12) {
      ;[day, month] = [month, day]
    }
    const year = Number(dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3])
    return isoOrEmpty(year, month, day)
  }

  // "2 Feb 2023" / "February 2, 2023" and similar — let the platform try.
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return isoOrEmpty(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
  }

  return ''
}

function isoOrEmpty(year: number, month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  if (year < 1900 || year > 2200) return ''
  // Reject impossible days like 31 February.
  const probe = new Date(year, month - 1, day)
  if (probe.getMonth() !== month - 1 || probe.getDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const TRUE_WORDS = new Set(['yes', 'y', 'true', 'ok', 'done', 'complete', 'completed', 'pass', 'passed', '1', 'x', 'labelled', 'labeled', 'fit'])
const FALSE_WORDS = new Set(['no', 'n', 'false', 'not', 'none', 'fail', 'failed', 'pending', 'todo', '0', 'unfit'])

const NOT_RECORDED = new Set(['n a', 'na', 'tbc', 'tba', 'unknown', 'unsure', '-'])

/** Yes/no columns in the wild: "Yes", "Y", "TRUE", "x", "N/A". */
export function parseBoolean(raw: string): boolean | null {
  const value = normalise(raw)
  if (!value) return null
  if (TRUE_WORDS.has(value)) return true
  if (FALSE_WORDS.has(value)) return false
  const first = value.split(' ')[0]!
  if (TRUE_WORDS.has(first)) return true
  if (FALSE_WORDS.has(first)) return false
  return null
}

/** True for values that deliberately say "we don't know" — no warning needed. */
export function isNotRecorded(raw: string): boolean {
  const value = normalise(raw)
  return value === '' || NOT_RECORDED.has(value)
}

/**
 * Key used to spot the same record twice: the studio's own asset ID first,
 * then the manufacturer serial, then the name.
 */
export function itemDedupeKey(item: { name: string; idNumber: string; serialNumber: string }): string {
  if (item.idNumber.trim()) return `id:${item.idNumber.trim().toLowerCase()}`
  if (item.serialNumber.trim()) return `serial:${item.serialNumber.trim().toLowerCase()}`
  return `name:${item.name.trim().toLowerCase()}`
}

export function personDedupeKey(person: { name: string; email: string }): string {
  return person.email.trim()
    ? `email:${person.email.trim().toLowerCase()}`
    : `name:${person.name.trim().toLowerCase()}`
}
