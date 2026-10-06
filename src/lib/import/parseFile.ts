export interface SheetData {
  /** Worksheet name, or the file name for a CSV. */
  sheetName: string
  /** Header row, trimmed. Blank headers become "Column N". */
  headers: string[]
  /** Body rows, padded to the header length. */
  rows: string[][]
}

export interface Workbook {
  /** File name, shown back to the user. */
  source: string
  /** Every sheet that held usable data. Never empty. */
  sheets: SheetData[]
}

/** Reads .xlsx or .csv into a uniform header + rows shape, one entry per sheet. */
export async function parseWorkbook(file: File): Promise<Workbook> {
  const lower = file.name.toLowerCase()

  if (lower.endsWith('.csv') || lower.endsWith('.txt') || file.type === 'text/csv') {
    return { source: file.name, sheets: [toSheetData(parseCsv(await file.text()), file.name)] }
  }
  if (lower.endsWith('.xls')) {
    throw new Error(
      'The old .xls format is not supported. Open it in Excel and use Save As → .xlsx (or .csv).',
    )
  }
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xlsm')) {
    throw new Error('Choose an .xlsx or .csv file.')
  }

  // Loaded on demand — the xlsx reader is a sizeable chunk that most sessions
  // never need, and keeping it out of the top-level graph lets the CSV path and
  // the render tests run without it.
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const workbook = await readXlsxFile(file)

  const sheets: SheetData[] = []
  const problems: string[] = []
  for (const sheet of workbook) {
    try {
      sheets.push(toSheetData(sheet.data.map((row) => row.map(cellToString)), sheet.sheet))
    } catch (err) {
      // A workbook full of notes tabs is normal — only complain if nothing works.
      problems.push(`"${sheet.sheet}": ${(err as Error).message}`)
    }
  }

  if (sheets.length === 0) {
    throw new Error(
      problems.length > 0
        ? `No sheet in that file had a usable table. ${problems.join(' ')}`
        : 'That file has no sheets.',
    )
  }

  return { source: file.name, sheets }
}

/** xlsx cells come back typed — dates and numbers need sane text forms. */
export function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return cell.toISOString().slice(0, 10)
  if (typeof cell === 'number') return String(cell)
  if (typeof cell === 'boolean') return cell ? 'yes' : 'no'
  return String(cell).trim()
}

export function toSheetData(grid: string[][], sheetName: string): SheetData {
  // Spreadsheets often start with a title row or blank rows above the real
  // header. Take the first row that has at least two non-empty cells.
  const headerIndex = grid.findIndex((row) => row.filter((c) => c.trim()).length >= 2)
  if (headerIndex === -1) {
    throw new Error('No usable header row found — it looks empty.')
  }

  const rawHeaders = grid[headerIndex]!
  const width = Math.max(rawHeaders.length, ...grid.slice(headerIndex + 1).map((r) => r.length), 0)
  const headers = Array.from({ length: width }, (_, i) => {
    const value = (rawHeaders[i] ?? '').trim()
    return value || `Column ${i + 1}`
  })

  const rows = grid
    .slice(headerIndex + 1)
    .map((row) => Array.from({ length: width }, (_, i) => (row[i] ?? '').trim()))
    .filter((row) => row.some((cell) => cell !== ''))

  return { sheetName, headers, rows }
}

/**
 * RFC-4180-ish CSV parser: handles quoted fields, embedded commas and newlines,
 * doubled quotes, CRLF, and a UTF-8 BOM. Also sniffs the delimiter, because
 * Excel exports semicolons in some locales.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '')
  const delimiter = sniffDelimiter(input)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\r') {
      // swallow; the \n that follows ends the row
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.map((r) => r.map((c) => c.trim()))
}

/** Picks whichever candidate appears most often outside quotes on the first line. */
function sniffDelimiter(text: string): string {
  const newline = text.indexOf('\n')
  const firstLine = newline === -1 ? text : text.slice(0, newline)
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    const count = countOutsideQuotes(firstLine, candidate)
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

function countOutsideQuotes(line: string, char: string): number {
  let count = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '"') inQuotes = !inQuotes
    else if (c === char && !inQuotes) count++
  }
  return count
}
