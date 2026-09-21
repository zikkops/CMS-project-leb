// Inventory valuation and movement (UPGRADE.md T7.12). Pure, asserted by
// verify:recipes; the read is shared/src/server/inventoryReport.ts.
//
// Stock is counted in each supply's purchase unit and moved in place (an
// increment on `quantity.<branch>`), with no ledger. So the period is
// reconciled the way an accountant does it, the periodic method, anchored on
// the counts:
//
//   opening   the supply's last submitted count BEFORE the period
//   closing   its last submitted count IN the period
//   between   received (deliveries, on the day their stock moved)
//             + transfers in − transfers out (T3.14)
//             − used (recipe snapshots of what sold) − waste (voids and
//               refunds whose reason made the food waste)
//
//   expected closing = opening + received ± transfers − used − waste
//   variance         = counted closing − expected  (what nothing explains)
//   COGS (actual)    = opening value + purchases ± transfers − closing value
//
// Each figure is valued at its own snapshot cost: a count line's unitCostUsd,
// a delivery line's cost in USD at its own rate, a transfer's cost when it
// moved, a sale's recipe snapshot. A cost nobody knows makes the figure
// unknown, never $0. A supply not counted at both ends is not reconciled and
// says why; its purchases are still listed.

export interface CountLine { supplyId: string; name: string; unit: string; countedQty: number; unitCostUsd: number | null }
export interface CountRecord { branch: string; day: string; lines: readonly CountLine[] }

export type MoveKind = 'received' | 'transferIn' | 'transferOut' | 'used' | 'waste'
export interface StockMove { branch: string; day: string; supplyId: string; kind: MoveKind; qty: number; unitCostUsd: number | null }

export interface SupplyNow { supplyId: string; name: string; unit: string; qty: Readonly<Record<string, number>>; avgUnitCost: number | null }

export type ReconcileStatus = 'reconciled' | 'no opening count' | 'no closing count' | 'not counted'

export interface InventoryRow {
  branch: string
  supplyId: string
  name: string
  unit: string
  status: ReconcileStatus
  openingDay: string | null
  closingDay: string | null
  openingQty: number | null
  received: number
  transfersIn: number
  transfersOut: number
  used: number
  waste: number
  expectedQty: number | null
  closingQty: number | null
  varianceQty: number | null
  openingValue: number | null
  purchasesValue: number | null
  transfersValue: number | null
  usedValue: number | null
  wasteValue: number | null
  closingValue: number | null
  varianceValue: number | null
  cogs: number | null
}

export interface InventoryTotals {
  supplies: number
  reconciled: number
  /** Reconciled, but a cost somewhere in it is unknown: left out of the values below. */
  uncosted: number
  openingValue: number
  purchasesValue: number
  transfersValue: number
  closingValue: number
  cogs: number
  usedValue: number
  wasteValue: number
  varianceValue: number
  /** Everything received in the period, reconciled or not, at cost before VAT. */
  purchasesInPeriod: number
  /** Stock on hand now × the average cost now (one average across branches, gap 20). */
  valueNow: number
  valueNowUncosted: number
}

export interface InventoryReport {
  rows: InventoryRow[]
  byBranch: { branch: string; totals: InventoryTotals }[]
  total: InventoryTotals
}

const r2 = (n: number) => Math.round(n * 100) / 100
const rq = (n: number) => Math.round(n * 1e6) / 1e6

/** qty × cost, or null when the cost is unknown. */
const value = (qty: number, cost: number | null) => (cost === null ? null : r2(qty * cost))
/** A sum of values, or null when any of them is unknown. */
const sumValues = (list: readonly (number | null)[]) => (list.some(v => v === null) ? null : r2(list.reduce<number>((n, v) => n + (v as number), 0)))

/** The latest count line for a supply at a branch among the days that pass. */
function latestCount(counts: readonly CountRecord[], branch: string, supplyId: string, pass: (day: string) => boolean) {
  let best: { day: string; line: CountLine } | null = null
  for (const c of counts) {
    if (c.branch !== branch || !pass(c.day)) continue
    const line = c.lines.find(l => l.supplyId === supplyId)
    if (line && (!best || c.day >= best.day)) best = { day: c.day, line }
  }
  return best
}

export function inventoryRow(
  branch: string,
  supply: { supplyId: string; name: string; unit: string },
  counts: readonly CountRecord[],
  moves: readonly StockMove[],
  range: { from: string; to: string },
): InventoryRow {
  const opening = latestCount(counts, branch, supply.supplyId, d => d < range.from)
  const closing = latestCount(counts, branch, supply.supplyId, d => d >= range.from && d <= range.to)
  const status: ReconcileStatus = opening && closing ? 'reconciled' : closing ? 'no opening count' : opening ? 'no closing count' : 'not counted'
  // Between the two counts when both exist; otherwise the period itself, so
  // purchases still show.
  const after = opening?.day ?? null
  const upTo = closing?.day ?? range.to
  const within = (m: StockMove) => m.branch === branch && m.supplyId === supply.supplyId
    && (after !== null ? m.day > after : m.day >= range.from) && m.day <= upTo
  const mine = moves.filter(within)
  const qtyOf = (k: MoveKind) => rq(mine.filter(m => m.kind === k).reduce((n, m) => n + m.qty, 0))
  const valueOf = (k: MoveKind) => sumValues(mine.filter(m => m.kind === k).map(m => value(m.qty, m.unitCostUsd)))
  const received = qtyOf('received')
  const transfersIn = qtyOf('transferIn')
  const transfersOut = qtyOf('transferOut')
  const used = qtyOf('used')
  const waste = qtyOf('waste')

  const reconciled = status === 'reconciled'
  const openingQty = opening ? opening.line.countedQty : null
  const closingQty = closing ? closing.line.countedQty : null
  const expectedQty = reconciled ? rq((openingQty as number) + received + transfersIn - transfersOut - used - waste) : null
  const varianceQty = reconciled ? rq((closingQty as number) - (expectedQty as number)) : null
  const openingValue = opening ? value(opening.line.countedQty, opening.line.unitCostUsd) : null
  const closingValue = closing ? value(closing.line.countedQty, closing.line.unitCostUsd) : null
  const tIn = valueOf('transferIn')
  const tOut = valueOf('transferOut')
  const transfersValue = tIn === null || tOut === null ? null : r2(tIn - tOut)
  const purchasesValue = valueOf('received')
  const cogs = reconciled && openingValue !== null && purchasesValue !== null && transfersValue !== null && closingValue !== null
    ? r2(openingValue + purchasesValue + transfersValue - closingValue)
    : null
  const varianceCost = closing?.line.unitCostUsd ?? opening?.line.unitCostUsd ?? null
  return {
    branch, supplyId: supply.supplyId, name: supply.name, unit: supply.unit, status,
    openingDay: opening?.day ?? null, closingDay: closing?.day ?? null,
    openingQty, received, transfersIn, transfersOut, used, waste, expectedQty, closingQty, varianceQty,
    openingValue, purchasesValue, transfersValue,
    usedValue: valueOf('used'), wasteValue: valueOf('waste'),
    closingValue,
    varianceValue: varianceQty === null ? null : value(varianceQty, varianceCost),
    cogs,
  }
}

function totalsOf(rows: readonly InventoryRow[], supplies: readonly SupplyNow[], branches: readonly string[], moves: readonly StockMove[], range: { from: string; to: string }): InventoryTotals {
  const rec = rows.filter(r => r.status === 'reconciled')
  const costed = rec.filter(r => r.cogs !== null && r.usedValue !== null && r.wasteValue !== null && r.varianceValue !== null)
  const add = (pick: (r: InventoryRow) => number | null) => r2(costed.reduce((n, r) => n + (pick(r) ?? 0), 0))
  let valueNow = 0
  let valueNowUncosted = 0
  for (const s of supplies) {
    for (const b of branches) {
      const q = Number(s.qty[b] ?? 0)
      if (!q) continue
      if (s.avgUnitCost === null) valueNowUncosted++
      else valueNow += q * s.avgUnitCost
    }
  }
  const inPeriod = moves.filter(m => m.kind === 'received' && branches.includes(m.branch) && m.day >= range.from && m.day <= range.to)
  return {
    supplies: rows.length,
    reconciled: rec.length,
    uncosted: rec.length - costed.length,
    openingValue: add(r => r.openingValue),
    purchasesValue: add(r => r.purchasesValue),
    transfersValue: add(r => r.transfersValue),
    closingValue: add(r => r.closingValue),
    cogs: add(r => r.cogs),
    usedValue: add(r => r.usedValue),
    wasteValue: add(r => r.wasteValue),
    varianceValue: add(r => r.varianceValue),
    purchasesInPeriod: r2(inPeriod.reduce((n, m) => n + (m.unitCostUsd === null ? 0 : m.qty * m.unitCostUsd), 0)),
    valueNow: r2(valueNow),
    valueNowUncosted,
  }
}

export function inventoryReport(input: {
  counts: readonly CountRecord[]
  moves: readonly StockMove[]
  supplies: readonly SupplyNow[]
  branches: readonly string[]
  from: string
  to: string
}): InventoryReport {
  const range = { from: input.from, to: input.to }
  const known = new Map(input.supplies.map(s => [s.supplyId, { supplyId: s.supplyId, name: s.name, unit: s.unit }]))
  // A supply counted or moved but since deleted still has a row, named as counted.
  for (const c of input.counts) for (const l of c.lines) if (!known.has(l.supplyId)) known.set(l.supplyId, { supplyId: l.supplyId, name: l.name || l.supplyId, unit: l.unit })
  for (const m of input.moves) if (!known.has(m.supplyId)) known.set(m.supplyId, { supplyId: m.supplyId, name: m.supplyId, unit: '' })

  const rows: InventoryRow[] = []
  for (const branch of input.branches) {
    for (const s of known.values()) {
      const row = inventoryRow(branch, s, input.counts, input.moves, range)
      const touched = row.status !== 'not counted' || row.received || row.transfersIn || row.transfersOut || row.used || row.waste
      const held = Number(input.supplies.find(x => x.supplyId === s.supplyId)?.qty[branch] ?? 0) !== 0
      if (touched || held) rows.push(row)
    }
  }
  rows.sort((a, b) => (a.branch === b.branch ? a.name.localeCompare(b.name) : a.branch.localeCompare(b.branch)))
  return {
    rows,
    byBranch: input.branches.map(branch => ({ branch, totals: totalsOf(rows.filter(r => r.branch === branch), input.supplies, [branch], input.moves, range) })),
    total: totalsOf(rows, input.supplies, input.branches, input.moves, range),
  }
}
