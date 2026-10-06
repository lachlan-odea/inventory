/**
 * Unit checks for the pure logic — spreadsheet parsing, column auto-mapping,
 * row validation and date maths. Imported by __smoke.tsx so `npm run smoke`
 * runs everything in one go.
 */
import { cellToString, parseCsv, toSheetData } from './lib/import/parseFile'
import {
  ITEM_FIELDS,
  PERSON_FIELDS,
  autoMap,
  buildItemRows,
  buildPersonRows,
  isNotRecorded,
  itemDedupeKey,
  parseBoolean,
  parseCondition,
  parseDateCell,
  parseQuantity,
  personDedupeKey,
} from './lib/import/mapping'
import { daysFromToday, parseDueDate, toDateInputValue, toLoanView } from './lib/format'
import type { SheetData } from './lib/import/parseFile'
import type { Loan } from './lib/types'

let failures = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

function equal(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(name, a === b, `got ${a}, wanted ${b}`)
}

export function runLogicTests(): number {
  console.log('\nCSV parsing')

  equal(
    'plain rows',
    parseCsv('name,qty\nFX3,2\nTripod,1'),
    [
      ['name', 'qty'],
      ['FX3', '2'],
      ['Tripod', '1'],
    ],
  )

  equal(
    'quoted field containing a comma',
    parseCsv('name,notes\n"Sony FX3","Body, cage, no lens"'),
    [
      ['name', 'notes'],
      ['Sony FX3', 'Body, cage, no lens'],
    ],
  )

  equal(
    'escaped quotes and embedded newline',
    parseCsv('name,notes\n"Mic","He said ""hello""\nnext line"'),
    [
      ['name', 'notes'],
      ['Mic', 'He said "hello"\nnext line'],
    ],
  )

  equal('CRLF line endings', parseCsv('a,b\r\n1,2\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ])

  equal('UTF-8 BOM is stripped', parseCsv('﻿name,qty\nFX3,2')[0], ['name', 'qty'])

  equal(
    'semicolon delimiter (European Excel export)',
    parseCsv('name;qty;location\nFX3;2;Shelf B2'),
    [
      ['name', 'qty', 'location'],
      ['FX3', '2', 'Shelf B2'],
    ],
  )

  equal('tab delimiter', parseCsv('name\tqty\nFX3\t2'), [
    ['name', 'qty'],
    ['FX3', '2'],
  ])

  // A field whose value contains the delimiter must not change the sniff result.
  equal(
    'delimiter sniffing ignores quoted commas',
    parseCsv('name;notes\n"FX3";"a, b, c, d, e"'),
    [
      ['name', 'notes'],
      ['FX3', 'a, b, c, d, e'],
    ],
  )

  console.log('\nSheet shaping')

  // Real exports often carry a title and a blank line above the real header.
  const withTitle = toSheetData(
    [
      ['Studio gear list — updated March', '', ''],
      ['', '', ''],
      ['Name', 'Qty', 'Location'],
      ['FX3', '2', 'Shelf B2'],
      ['', '', ''],
      ['Tripod', '1', ''],
    ],
    'Gear',
  )
  equal('sheet name is carried through', withTitle.sheetName, 'Gear')
  equal('title row is skipped', withTitle.headers, ['Name', 'Qty', 'Location'])
  equal('blank rows are dropped', withTitle.rows.length, 2)
  equal('rows keep their cells', withTitle.rows[0], ['FX3', '2', 'Shelf B2'])

  // Rows longer than the header must not be truncated away silently, and short
  // rows must be padded so column indexes stay aligned.
  const ragged = toSheetData(
    [
      ['Name', 'Qty'],
      ['FX3'],
      ['Tripod', '1', 'extra'],
    ],
    'ragged.csv',
  )
  equal('width grows to the widest row', ragged.headers.length, 3)
  equal('unnamed column gets a placeholder', ragged.headers[2], 'Column 3')
  equal('short rows are padded', ragged.rows[0], ['FX3', '', ''])
  equal('long rows are kept whole', ragged.rows[1], ['Tripod', '1', 'extra'])

  check(
    'an empty sheet is rejected',
    (() => {
      try {
        toSheetData([['', '']], 'empty.csv')
        return false
      } catch {
        return true
      }
    })(),
  )

  console.log('\nCell conversion')

  equal('numbers', cellToString(12), '12')
  equal('dates become yyyy-mm-dd', cellToString(new Date(Date.UTC(2026, 2, 14))), '2026-03-14')
  equal('booleans', cellToString(true), 'yes')
  equal('null', cellToString(null), '')
  equal('strings are trimmed', cellToString('  FX3  '), 'FX3')

  console.log('\nColumn auto-mapping — the studio\'s own inventory sheet')

  // These are the exact headers from the studio's existing spreadsheet. Every
  // one of them must land on the right field with no manual remapping.
  const studioHeaders = [
    'ID Number',
    'Item',
    'Category',
    'Studio Location',
    'Model Number',
    'Serial Number',
    'Description',
    'Condition',
    'Accessories',
    'Notes',
    'Purchase date',
    'Last inspection date',
    'Labelled',
    'Fit for Service',
  ]
  const studioMap = autoMap(studioHeaders, ITEM_FIELDS)
  const expectedStudioMap: Record<string, number> = {
    idNumber: 0,
    name: 1,
    category: 2,
    location: 3,
    modelNumber: 4,
    serialNumber: 5,
    description: 6,
    condition: 7,
    accessories: 8,
    notes: 9,
    purchaseDate: 10,
    lastInspectionDate: 11,
    labelled: 12,
    fitForService: 13,
  }
  for (const [field, column] of Object.entries(expectedStudioMap)) {
    equal(`${field} -> "${studioHeaders[column]}"`, studioMap[field], column)
  }
  equal('quantity is left unmapped (the sheet has no such column)', studioMap['totalQty'], -1)

  console.log('\nColumn auto-mapping — other spellings')

  const messyHeaders = [
    'Asset Tag',
    'Equipment Name',
    'Type',
    'QTY on hand',
    'Storage Location',
    'Condition',
    'Comments',
  ]
  const itemMap = autoMap(messyHeaders, ITEM_FIELDS)
  equal('name -> "Equipment Name"', itemMap['name'], 1)
  equal('idNumber -> "Asset Tag"', itemMap['idNumber'], 0)
  equal('category -> "Type"', itemMap['category'], 2)
  equal('totalQty -> "QTY on hand"', itemMap['totalQty'], 3)
  equal('location -> "Storage Location"', itemMap['location'], 4)
  equal('condition -> "Condition"', itemMap['condition'], 5)
  equal('notes -> "Comments"', itemMap['notes'], 6)

  // The three "... Number" columns must not collide with each other.
  const numbers = autoMap(['Serial Number', 'ID Number', 'Model Number'], ITEM_FIELDS)
  equal('serialNumber picks its own column', numbers['serialNumber'], 0)
  equal('idNumber picks its own column', numbers['idNumber'], 1)
  equal('modelNumber picks its own column', numbers['modelNumber'], 2)

  // "Category Name" must not steal the name field from "Item".
  const ambiguous = autoMap(['Category Name', 'Item'], ITEM_FIELDS)
  equal('exact "Item" beats "Category Name" for the name field', ambiguous['name'], 1)
  equal('"Category Name" takes the category field', ambiguous['category'], 0)

  const peopleMap = autoMap(['Full Name', 'E-mail', 'Mobile', 'Job Title'], PERSON_FIELDS)
  equal('person name', peopleMap['name'], 0)
  equal('person email', peopleMap['email'], 1)
  equal('person phone', peopleMap['phone'], 2)
  equal('person role', peopleMap['role'], 3)

  equal('unmatched headers map to nothing', autoMap(['Xyzzy'], ITEM_FIELDS)['name'], -1)

  console.log('\nQuantity and condition parsing')

  equal('plain integer', parseQuantity('12'), 12)
  equal('thousands separator', parseQuantity('1,200'), 1200)
  equal('trailing unit word', parseQuantity('12 units'), 12)
  equal('decimal truncates', parseQuantity('3.7'), 3)
  equal('non-numeric', parseQuantity('lots'), null)
  equal('negative is preserved for the caller to reject', parseQuantity('-2'), -2)

  equal('condition "Brand New"', parseCondition('Brand New'), 'good')
  equal('condition "well used"', parseCondition('well used'), 'worn')
  equal('condition "BROKEN"', parseCondition('BROKEN'), 'damaged')
  equal('condition "in for service"', parseCondition('in for service'), 'repair')
  equal('condition unknown', parseCondition('sparkly'), null)
  equal('condition blank', parseCondition(''), null)

  console.log('\nDate parsing')

  equal('day-first "02-02-2023"', parseDateCell('02-02-2023'), '2023-02-02')
  equal('day-first "14-03-2026" (day > 12)', parseDateCell('14-03-2026'), '2026-03-14')
  equal('ambiguous "05-07-2023" reads day-first', parseDateCell('05-07-2023'), '2023-07-05')
  equal('month-first is detected when day > 12', parseDateCell('03-14-2026'), '2026-03-14')
  equal('slashes', parseDateCell('2/2/2023'), '2023-02-02')
  equal('ISO passes through', parseDateCell('2023-02-02'), '2023-02-02')
  equal('a real Excel date cell (ISO with time)', parseDateCell('2023-02-02T00:00:00.000Z'), '2023-02-02')
  equal('two-digit year', parseDateCell('02-02-23'), '2023-02-02')
  equal('written month', parseDateCell('2 Feb 2023'), '2023-02-02')
  equal('impossible day is rejected', parseDateCell('31-02-2023'), '')
  equal('gibberish is rejected', parseDateCell('sometime'), '')
  equal('blank', parseDateCell(''), '')

  console.log('\nYes/no parsing')

  equal('Yes', parseBoolean('Yes'), true)
  equal('Y', parseBoolean('Y'), true)
  equal('TRUE', parseBoolean('TRUE'), true)
  equal('x (ticked cell)', parseBoolean('x'), true)
  equal('No', parseBoolean('No'), false)
  equal('N', parseBoolean('N'), false)
  equal('Pending', parseBoolean('Pending'), false)
  equal('unreadable', parseBoolean('maybe'), null)
  equal('N/A counts as not recorded', isNotRecorded('N/A'), true)
  equal('blank counts as not recorded', isNotRecorded(''), true)
  equal('a real value is not "not recorded"', isNotRecorded('Yes'), false)

  console.log('\nRow building')

  // Modelled on the studio's sheet, with the messiness real files have.
  const sheet: SheetData = {
    sheetName: 'Items',
    headers: [
      'ID Number',
      'Item',
      'Category',
      'Studio Location',
      'Model Number',
      'Serial Number',
      'Condition',
      'Accessories',
      'Last inspection date',
      'Labelled',
      'Fit for Service',
    ],
    rows: [
      ['STUDIO 102', 'Sony A6500', 'Camera', 'SYD', 'SONY ILCE-6500', '4498703', 'Good', 'Shoulder Strap', '02-02-2023', 'Yes', 'Yes'],
      ['STUDIO 103', 'XLR cable', 'Audio', 'SYD', '', '', 'well used', '', '', '', ''],
      ['STUDIO 104', '', 'Camera', 'SYD', '', '', 'Good', '', '', '', ''],
      ['STUDIO 105', 'Canon 5D Mk III', 'Camera', 'MEL', 'Canon DS126321', '115025000340', 'sparkly', '', 'sometime', 'N/A', 'No'],
    ],
  }
  const mapping = autoMap(sheet.headers, ITEM_FIELDS)
  const rows = buildItemRows(sheet, mapping)

  equal('row count', rows.length, 4)
  equal('clean row has no problems', [rows[0]!.errors, rows[0]!.warnings], [[], []])
  equal('id number', rows[0]!.values.idNumber, 'STUDIO 102')
  equal('model number', rows[0]!.values.modelNumber, 'SONY ILCE-6500')
  equal('serial number', rows[0]!.values.serialNumber, '4498703')
  equal('accessories', rows[0]!.values.accessories, 'Shoulder Strap')
  equal('location', rows[0]!.values.location, 'SYD')
  equal('inspection date', rows[0]!.values.lastInspectionDate, '2023-02-02')
  equal('labelled', rows[0]!.values.labelled, true)
  equal('fit for service', rows[0]!.values.fitForService, true)
  equal('quantity defaults to 1 with no column', rows[0]!.values.totalQty, 1)
  equal('no warning when quantity has no column', rows[0]!.warnings, [])

  equal('blank yes/no imports as not recorded', rows[1]!.values.labelled, null)
  equal('blank date imports blank', rows[1]!.values.lastInspectionDate, '')
  equal('missing item name is an error', rows[2]!.errors, ['No item name'])
  equal('"No" is read as false', rows[3]!.values.fitForService, false)
  equal('N/A does not warn', rows[3]!.warnings.some((w) => w.includes('Labelled')), false)
  check(
    'unreadable date warns',
    rows[3]!.warnings.some((w) => w.includes('sometime')) &&
      rows[3]!.values.lastInspectionDate === '',
  )

  equal('"well used" maps to worn', rows[1]!.values.condition, 'worn')
  check(
    'unknown condition warns and defaults to good',
    rows[3]!.warnings.some((w) => w.includes('sparkly')) && rows[3]!.values.condition === 'good',
  )

  // A sheet that does have a quantity column still gets the old treatment.
  const qtySheet: SheetData = {
    sheetName: 'Consumables',
    headers: ['Item', 'Qty'],
    rows: [
      ['XLR cable 5m', '12'],
      ['Gaffer tape', 'twelve'],
      ['Sandbag', ''],
      ['Broken thing', '-1'],
    ],
  }
  const qtyRows = buildItemRows(qtySheet, autoMap(qtySheet.headers, ITEM_FIELDS))
  equal('quantity is read when mapped', qtyRows[0]!.values.totalQty, 12)
  check(
    'unreadable qty warns but imports as 1',
    qtyRows[1]!.warnings.length === 1 && qtyRows[1]!.values.totalQty === 1,
  )
  equal('unreadable qty is not an error', qtyRows[1]!.errors, [])
  check(
    'blank qty warns and defaults to 1',
    qtyRows[2]!.warnings.some((w) => w.includes('blank')) && qtyRows[2]!.values.totalQty === 1,
  )
  check('negative qty is an error', qtyRows[3]!.errors.length === 1)

  const peopleSheet: SheetData = {
    sheetName: 'Staff',
    headers: ['Full Name', 'E-mail'],
    rows: [
      ['Ada Lovelace', 'ada@example.com'],
      ['Grace Hopper', 'not-an-email'],
      ['', 'nobody@example.com'],
    ],
  }
  const peopleRows = buildPersonRows(peopleSheet, autoMap(peopleSheet.headers, PERSON_FIELDS))
  equal('valid person is clean', [peopleRows[0]!.errors, peopleRows[0]!.warnings], [[], []])
  check('bad email warns only', peopleRows[1]!.errors.length === 0 && peopleRows[1]!.warnings.length === 1)
  equal('person without a name errors', peopleRows[2]!.errors, ['No name'])

  console.log('\nDuplicate keys')

  equal(
    'ID Number wins',
    itemDedupeKey({ name: 'Sony A6500', idNumber: 'STUDIO 102', serialNumber: '4498703' }),
    'id:studio 102',
  )
  equal(
    'serial number is the fallback',
    itemDedupeKey({ name: 'Sony A6500', idNumber: '', serialNumber: '4498703' }),
    'serial:4498703',
  )
  equal(
    'name is the last resort',
    itemDedupeKey({ name: 'Sony A6500', idNumber: '', serialNumber: '' }),
    'name:sony a6500',
  )
  equal(
    'matching ignores case and padding',
    itemDedupeKey({ name: 'x', idNumber: '  studio 102 ', serialNumber: '' }),
    'id:studio 102',
  )
  equal(
    'email wins for people',
    personDedupeKey({ name: 'Ada', email: 'Ada@Example.com' }),
    'email:ada@example.com',
  )

  console.log('\nDates and loan views')

  const today = new Date()
  equal('today is zero days away', daysFromToday(today), 0)
  const due = parseDueDate(toDateInputValue(today))
  check('a due date parses to end of day', due !== null && due.getHours() === 23)
  equal('blank due date is null', parseDueDate(''), null)

  const partial: Loan = {
    id: 'x',
    itemId: 'i',
    itemName: 'Cable',
    personId: 'p',
    personName: 'Ada',
    qty: 6,
    returnedQty: 2,
    status: 'out',
    checkedOutAt: null,
    dueAt: null,
    returnedAt: null,
    checkoutNotes: '',
    returnCondition: null,
    returnNotes: '',
    returnPhotoUrl: null,
    returnPhotoPath: null,
  }
  equal('outstanding = qty - returned', toLoanView(partial).outstandingQty, 4)
  equal('no due date is never overdue', toLoanView(partial).isOverdue, false)
  equal(
    'over-returned loans clamp at zero',
    toLoanView({ ...partial, returnedQty: 9 }).outstandingQty,
    0,
  )

  return failures
}
