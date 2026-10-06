// Temporary: feeds a real .xlsx through the importer pipeline.
import { readFileSync } from 'node:fs'
import { parseWorkbook } from './lib/import/parseFile'
import { ITEM_FIELDS, PERSON_FIELDS, autoMap, buildItemRows, buildPersonRows } from './lib/import/mapping'

const path = process.argv[2]!
const file = new File([readFileSync(path)], path.split(/[\\/]/).pop()!, {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})

const workbook = await parseWorkbook(file)
console.log('source:', workbook.source)
console.log('sheets:', workbook.sheets.map((s) => `${s.sheetName} (${s.rows.length} rows)`))

const gear = workbook.sheets.find((s) => s.sheetName === 'Gear list')!
console.log('\nheaders:', gear.headers)
const mapping = autoMap(gear.headers, ITEM_FIELDS)
console.log('mapping:', Object.fromEntries(
  Object.entries(mapping).map(([k, v]) => [k, v >= 0 ? gear.headers[v] : '(none)']),
))

console.log('\nrows:')
for (const row of buildItemRows(gear, mapping)) {
  const v = row.values
  console.log(
    ` ${row.rowNumber}. ${JSON.stringify({ id: v.idNumber, name: v.name, cat: v.category, loc: v.location, model: v.modelNumber, serial: v.serialNumber, cond: v.condition, qty: v.totalQty, purchased: v.purchaseDate, inspected: v.lastInspectionDate, labelled: v.labelled, fit: v.fitForService })}` +
      (row.errors.length ? `\n     ERRORS:   ${row.errors.join('; ')}` : '') +
      (row.warnings.length ? `\n     WARNINGS: ${row.warnings.join('; ')}` : ''),
  )
}

const staff = workbook.sheets.find((s) => s.sheetName === 'Staff')!
const staffMapping = autoMap(staff.headers, PERSON_FIELDS)
console.log('\nstaff rows:')
for (const row of buildPersonRows(staff, staffMapping)) {
  console.log(` ${row.rowNumber}. ${JSON.stringify(row.values)}`)
}
