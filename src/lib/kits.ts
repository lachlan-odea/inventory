import type { Item, Kit, KitComponent, LoanView } from './types'

/** Everything still out from one kit checkout — one person, one handover. */
export interface KitCheckout {
  kitCheckoutId: string
  kitId: string
  kitName: string
  personName: string
  /** Open loans only, one per item still (partly) out. */
  loans: LoanView[]
  isOverdue: boolean
}

/**
 * Groups open loans back into the kit checkouts that created them. Items
 * already returned individually simply drop out of their group; a group with
 * nothing left out disappears.
 */
export function groupKitCheckouts(openLoans: LoanView[]): KitCheckout[] {
  const groups = new Map<string, KitCheckout>()
  for (const loan of openLoans) {
    if (!loan.kitCheckoutId || !loan.kitId || loan.status !== 'out') continue
    let group = groups.get(loan.kitCheckoutId)
    if (!group) {
      group = {
        kitCheckoutId: loan.kitCheckoutId,
        kitId: loan.kitId,
        kitName: loan.kitName ?? '',
        personName: loan.personName,
        loans: [],
        isOverdue: false,
      }
      groups.set(loan.kitCheckoutId, group)
    }
    group.loans.push(loan)
    group.isOverdue ||= loan.isOverdue
  }
  return [...groups.values()]
}

/**
 * Tidies a kit's item list before it's saved: drops blank rows, floors
 * quantities, and merges duplicate items into one line so a checkout never
 * reads or decrements the same item twice.
 */
export function normaliseComponents(components: KitComponent[]): KitComponent[] {
  const merged = new Map<string, number>()
  for (const c of components) {
    if (!c.itemId) continue
    const qty = Math.floor(c.qty)
    if (!(qty >= 1)) continue
    merged.set(c.itemId, (merged.get(c.itemId) ?? 0) + qty)
  }
  return [...merged].map(([itemId, qty]) => ({ itemId, qty }))
}

export interface KitLine {
  itemId: string
  /** The item, or null if it has since been deleted. */
  item: Item | null
  needed: number
  available: number
  /** Why this line would stop the kit going out, or null if it's fine. */
  problem: string | null
}

export interface KitStatus {
  lines: KitLine[]
  /** Every line can go out right now. */
  ready: boolean
  /** Lines that would block a checkout. */
  blocked: KitLine[]
  totalUnits: number
}

/** Can this kit go out right now, and if not, what's holding it up. */
export function kitStatus(kit: Kit, itemsById: Map<string, Item>): KitStatus {
  const lines = kit.components.map<KitLine>((c) => {
    const item = itemsById.get(c.itemId) ?? null
    const available = item?.availableQty ?? 0
    let problem: string | null = null
    if (!item) problem = 'No longer in the inventory'
    else if (item.archived) problem = 'Archived'
    else if (available === 0) problem = 'All out'
    else if (available < c.qty) problem = `Only ${available} available`
    return { itemId: c.itemId, item, needed: c.qty, available, problem }
  })
  const blocked = lines.filter((l) => l.problem)
  return {
    lines,
    ready: lines.length > 0 && blocked.length === 0,
    blocked,
    totalUnits: lines.reduce((sum, l) => sum + l.needed, 0),
  }
}
