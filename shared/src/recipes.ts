// Recipes: what a dish is made of, what it costs, and what a sale takes off
// the shelf.
//
// ── Why this is a pure module before anything else exists ──────────────────
// Stock arithmetic inside a component is arithmetic nothing can assert on. The
// counter till's two money bugs got through tsc, three builds and a look in a
// browser for exactly that reason (pos/app/lib/counterTotals.ts). So the numbers
// come first, here, with no imports and no Firebase, and `npm run verify:recipes`
// holds them. Screens and the server only ever apply what this module computed.
//
// ── Units: the part that goes wrong silently ───────────────────────────────
// Stock is counted in the PURCHASE unit — the gallon, the box, the kg that
// receiving and the daily count already use. Recipes are written in a RECIPE
// unit — ml, g, pieces. Each supply says how many recipe units one purchase
// unit holds. A wrong factor is not an error, it is a number a thousand times
// too big, so a missing or nonsensical factor makes the answer UNKNOWN rather
// than a guess — and a cost built on it reads "unknown", never "$0.00".
//
// Unit names arrive spelled several ways: the inventory form offers "L", "mL"
// and "pieces", the order template "liter" and "pcs". Those are the same
// units, and treating them as different would demand a conversion factor
// between a litre and a litre. normalizeUnit() is the one place they meet.
//
// ── Trim ───────────────────────────────────────────────────────────────────
// A recipe quantity is what goes into the dish. Onions trimmed to 85% usable
// need 100 g bought for 85 g used, so the purchase quantity is divided by the
// supply's yield. Yield belongs to the ingredient, set once rather than typed
// into every dish (owner's decision, 14 Sep 2026).
//
// ── Modifiers ──────────────────────────────────────────────────────────────
// Two kinds, keyed by modifier option id (owner's decision: add and replace):
//   add     — an extra shot adds 18 g of beans
//   replace — oat milk swaps the milk for oat milk, same quantity
// ADDITIONS FIRST, then replacements over everything, whatever order the
// options were tapped in. A replacement is a choice about an ingredient, so it
// governs every portion of it: an extra shot in a decaf latte is decaf, and
// extra milk in an oat latte is oat. The opposite order put caffeine in a decaf
// and dairy in an oat latte — found by a mutation the first tests missed.

export interface RecipeSupply {
  id: string
  name?: string
  /** The purchase unit stock is counted in: 'gallon', 'box', 'kg'. */
  unit: string
  /** What recipes measure it in: 'ml', 'g'. Absent means the purchase unit itself. */
  recipeUnit?: string | null
  /** Recipe units in one purchase unit. Needed whenever recipeUnit differs from unit. */
  recipeUnitsPerPurchaseUnit?: number | null
  /** Share of what is bought that ends up usable, above 0 and at most 100. Absent means 100. */
  yieldPercent?: number | null
  /** USD per purchase unit — the weighted average kept by receiving. */
  avgUnitCost?: number | null
}

export interface RecipeLine {
  supplyId: string
  /** In the supply's recipe unit, as used in the dish — after trim. */
  qty: number
}

export type OptionAdjustment =
  | { kind: 'add'; supplyId: string; qty: number }
  | { kind: 'replace'; fromSupplyId: string; toSupplyId: string }

export interface Recipe {
  lines: RecipeLine[]
  /** Keyed by modifier option id. */
  adjustments?: Record<string, OptionAdjustment[]>
}

export interface Consumption {
  supplyId: string
  /** Purchase units taken off the shelf. */
  qty: number
  /** USD per purchase unit at the time, or null when the supply has never been costed. */
  unitCostUsd: number | null
}

export interface LineConsumption {
  consumes: Consumption[]
  /** Supplies whose quantity cannot be worked out: missing, or no valid conversion or yield. */
  unknown: string[]
}

const QTY_SCALE = 1e6

/** Stock quantities to six decimals: 200 ml of a gallon is 0.052834, not 0.0528344351… */
export function roundQty(n: number): number {
  return Math.round(n * QTY_SCALE) / QTY_SCALE
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const bySupplyId = (a: { supplyId: string }, b: { supplyId: string }) =>
  a.supplyId < b.supplyId ? -1 : a.supplyId > b.supplyId ? 1 : 0

/** A supply document read as a RecipeSupply. Anything that is not a real number is absent, never 0. */
export function readRecipeSupply(id: string, data: Record<string, unknown>): RecipeSupply {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    id,
    name: String(data.name ?? id),
    unit: String(data.unit ?? ''),
    recipeUnit: typeof data.recipeUnit === 'string' && data.recipeUnit.trim() ? data.recipeUnit : null,
    recipeUnitsPerPurchaseUnit: n(data.recipeUnitsPerPurchaseUnit),
    yieldPercent: n(data.yieldPercent),
    avgUnitCost: n(data.avgUnitCost),
  }
}

// ── Units ─────────────────────────────────────────────────────────────────

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  l: 'liter', liter: 'liter', liters: 'liter', litre: 'liter', litres: 'liter',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gram: 'g', grams: 'g',
  gallon: 'gallon', gallons: 'gallon',
  pcs: 'pcs', piece: 'pcs', pieces: 'pcs', unit: 'pcs', units: 'pcs',
}

/** One spelling per unit: "L" and "liter" are the same litre. Unknown names pass through, lower-cased. */
export function normalizeUnit(unit: string | null | undefined): string {
  const key = (unit ?? '').trim().toLowerCase()
  return UNIT_ALIASES[key] ?? key
}

/**
 * Recipe units per purchase unit, or null when it cannot be known.
 *
 * No recipe unit, or one that is the purchase unit under another spelling, is
 * a factor of 1 — eggs bought and used as pieces. A recipe unit that differs
 * with no positive factor is null, never 1: guessing 1 for "gallon → ml" is
 * the 3,785× error.
 */
export function unitFactor(supply: RecipeSupply): number | null {
  const recipeUnit = normalizeUnit(supply.recipeUnit)
  if (!recipeUnit || recipeUnit === normalizeUnit(supply.unit)) return 1
  const f = supply.recipeUnitsPerPurchaseUnit
  return typeof f === 'number' && Number.isFinite(f) && f > 0 ? f : null
}

/** Usable share as a fraction. Absent is 1; anything outside (0, 100] is null. */
export function yieldFraction(supply: RecipeSupply): number | null {
  const y = supply.yieldPercent
  if (y === null || y === undefined) return 1
  return Number.isFinite(y) && y > 0 && y <= 100 ? y / 100 : null
}

/** Purchase units needed to put `recipeQty` recipe units into a dish, or null. */
export function toPurchaseUnits(recipeQty: number, supply: RecipeSupply): number | null {
  const factor = unitFactor(supply)
  const usable = yieldFraction(supply)
  if (factor === null || usable === null) return null
  if (!Number.isFinite(recipeQty) || recipeQty < 0) return null
  return roundQty(recipeQty / usable / factor)
}

const shown = (n: number) => (Math.abs(n) >= 1 ? String(r2(n)) : String(Number(n.toPrecision(3))))

/**
 * A recipe quantity in both units — "200 ml = 0.0528 gallon".
 *
 * The recipe editor shows this beside every line. Seeing the purchase figure is
 * the cheapest defence against a wrong factor: "18 g = 18 kg" looks wrong to
 * anybody who has bought coffee.
 */
export function describeQty(recipeQty: number, supply: RecipeSupply): string {
  const recipeUnit = (supply.recipeUnit ?? '').trim() || supply.unit
  const used = `${shown(recipeQty)} ${recipeUnit}`
  const purchase = toPurchaseUnits(recipeQty, supply)
  if (purchase === null) return `${used} = ? ${supply.unit} (no conversion set)`
  if (normalizeUnit(recipeUnit) === normalizeUnit(supply.unit) && yieldFraction(supply) === 1) return used
  return `${used} = ${shown(purchase)} ${supply.unit}`
}

/**
 * Units with a fixed relationship, offered as a starting value in the editor.
 * Pack units — box, bottle, bag, jar, can — have none: a box of what, holding
 * how many, is the café's to say.
 */
export const COMMON_CONVERSIONS: readonly { unit: string; recipeUnit: string; factor: number }[] = [
  { unit: 'kg', recipeUnit: 'g', factor: 1000 },
  { unit: 'liter', recipeUnit: 'ml', factor: 1000 },
  { unit: 'gallon', recipeUnit: 'ml', factor: 3785.41 },
]

export function suggestedFactor(unit: string, recipeUnit: string): number | null {
  const u = normalizeUnit(unit)
  const r = normalizeUnit(recipeUnit)
  if (u === r) return 1
  return COMMON_CONVERSIONS.find(c => c.unit === u && c.recipeUnit === r)?.factor ?? null
}

// ── A line on a check ─────────────────────────────────────────────────────

/** The recipe as made, after the chosen options — merged by supply, sorted. */
export function resolveLines(recipe: Recipe, optionIds: readonly string[] = []): RecipeLine[] {
  const adjustments = [...new Set(optionIds)].flatMap(id => recipe.adjustments?.[id] ?? [])

  const lines = recipe.lines.map(l => ({ ...l }))
  for (const a of adjustments) {
    if (a.kind === 'add') lines.push({ supplyId: a.supplyId, qty: a.qty })
  }
  let resolved = lines
  for (const a of adjustments) {
    if (a.kind !== 'replace') continue
    resolved = resolved.map(l => (l.supplyId === a.fromSupplyId ? { ...l, supplyId: a.toSupplyId } : l))
  }

  const merged = new Map<string, number>()
  for (const l of resolved) {
    if (!l.supplyId || !Number.isFinite(l.qty) || l.qty <= 0) continue
    merged.set(l.supplyId, (merged.get(l.supplyId) ?? 0) + l.qty)
  }
  return [...merged].map(([supplyId, qty]) => ({ supplyId, qty })).sort(bySupplyId)
}

/**
 * What `lineQty` of this dish takes off the shelf, in purchase units, with the
 * cost of each ingredient at the time.
 *
 * Snapshotted onto the check line when it is added and applied when it is
 * sent, so a void returns exactly what was taken even if the recipe has been
 * edited since.
 */
export function lineConsumption(
  recipe: Recipe,
  optionIds: readonly string[],
  lineQty: number,
  supplies: Readonly<Record<string, RecipeSupply>>,
): LineConsumption {
  if (!Number.isInteger(lineQty) || lineQty <= 0) return { consumes: [], unknown: [] }

  const consumes: Consumption[] = []
  const unknown: string[] = []
  for (const line of resolveLines(recipe, optionIds)) {
    const supply = supplies[line.supplyId]
    const each = supply ? toPurchaseUnits(line.qty, supply) : null
    if (!supply || each === null) {
      unknown.push(line.supplyId)
      continue
    }
    const cost = supply.avgUnitCost
    consumes.push({
      supplyId: line.supplyId,
      qty: roundQty(each * lineQty),
      unitCostUsd: typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : null,
    })
  }
  return { consumes, unknown: unknown.sort() }
}

export interface ConsumptionCost {
  costUsd: number | null
  /** ok: fully costed · empty: nothing to cost · incomplete: see `missing`. */
  reason: 'ok' | 'empty' | 'incomplete'
  /** Supplies that stop a cost being known — no conversion, or never received. */
  missing: string[]
}

/**
 * The cost of what was consumed — or null, never a flattering zero.
 *
 * An ingredient that has never been received has no average cost. Treating it
 * as $0 would show a dish as cheaper than it is, which is the costing version
 * of the cold menu cache that once under-priced a bill.
 */
export function consumptionCost(line: LineConsumption): ConsumptionCost {
  const missing = [...new Set([
    ...line.unknown,
    ...line.consumes.filter(c => c.unitCostUsd === null).map(c => c.supplyId),
  ])].sort()
  if (missing.length > 0) return { costUsd: null, reason: 'incomplete', missing }
  if (line.consumes.length === 0) return { costUsd: null, reason: 'empty', missing: [] }
  const total = line.consumes.reduce((s, c) => s + c.qty * (c.unitCostUsd as number), 0)
  return { costUsd: r2(total), reason: 'ok', missing: [] }
}

/**
 * Margin on the price BEFORE VAT.
 *
 * Prices include VAT (owner's decision, 11 Sep 2026). Measuring a dish's cost
 * against the VAT-inclusive price would flatter every margin by the tax rate,
 * money the café collects and hands on.
 */
export function dishMargin(
  priceUsd: number,
  costUsd: number | null,
  vatRate: number,
): { priceExVatUsd: number; marginUsd: number | null; costPercent: number | null } {
  const rate = Number.isFinite(vatRate) && vatRate >= 0 && vatRate < 1 ? vatRate : 0
  const priceExVatUsd = Number.isFinite(priceUsd) && priceUsd > 0 ? r2(priceUsd / (1 + rate)) : 0
  if (costUsd === null) return { priceExVatUsd, marginUsd: null, costPercent: null }
  return {
    priceExVatUsd,
    marginUsd: r2(priceExVatUsd - costUsd),
    costPercent: priceExVatUsd > 0 ? costUsd / priceExVatUsd : null,
  }
}

// ── Waste ─────────────────────────────────────────────────────────────────

/**
 * The parts of a check that waste is read from.
 *
 * voidLine() stamps `voidWasteUsd` on a line, and refundCheck() stamps
 * `refundWasteUsd` on the check, ONLY when the reason made ingredients waste.
 * So the three states of either field mean three different things:
 *   a number   — wasted, and this is what the ingredients cost
 *   null       — wasted, but an ingredient had no cost
 *   absent     — nothing was wasted: a never-made void, or a dish with no recipe
 */
export interface WasteSource {
  status: string
  lines: readonly { status: string; voidReasonKey?: string | null; voidWasteUsd?: number | null }[]
  refundReasonKey?: string | null
  refundWasteUsd?: number | null
}

export interface WasteSummary {
  /** Costed waste in USD. */
  wasteUsd: number
  /** Waste as a share of the sales set against it. null when there were no sales. */
  percentOfSales: number | null
  /** Per void reason, costliest first. */
  byReason: { reasonKey: string; usd: number; count: number }[]
  /** Voids and refunds recorded as waste, costed or not. */
  events: number
  /** Recorded as waste, but an ingredient had no cost: left out of wasteUsd, never counted as $0. */
  uncosted: number
}

/**
 * What was thrown away over a set of checks.
 *
 * A refunded check's earlier voids are counted from their lines and the refund
 * from the check, and the two never overlap: reversalPlan() leaves voided lines
 * out of a refund's waste.
 */
export function wasteSummary(checks: readonly WasteSource[], salesExVatUsd: number): WasteSummary {
  const byKey = new Map<string, { usd: number; count: number }>()
  let total = 0
  let events = 0
  let uncosted = 0

  const record = (reasonKey: string | null | undefined, usd: number | null | undefined) => {
    if (usd === undefined) return
    events++
    const key = reasonKey || 'other'
    const row = byKey.get(key) ?? { usd: 0, count: 0 }
    row.count++
    if (usd === null || !Number.isFinite(usd)) uncosted++
    else { row.usd += usd; total += usd }
    byKey.set(key, row)
  }

  for (const check of checks) {
    for (const line of check.lines) {
      if (line.status === 'void') record(line.voidReasonKey, line.voidWasteUsd)
    }
    if (check.status === 'refunded') record(check.refundReasonKey, check.refundWasteUsd)
  }

  return {
    wasteUsd: r2(total),
    percentOfSales: Number.isFinite(salesExVatUsd) && salesExVatUsd > 0 ? total / salesExVatUsd : null,
    byReason: [...byKey.entries()]
      .map(([reasonKey, row]) => ({ reasonKey, usd: r2(row.usd), count: row.count }))
      .sort((a, b) => b.usd - a.usd || b.count - a.count || (a.reasonKey < b.reasonKey ? -1 : 1)),
    events,
    uncosted,
  }
}

// ── What a dish should sell for ───────────────────────────────────────────

/**
 * The target margin for a dish, by the station its section sends it to.
 *
 * Bar is drinks; Kitchen and Sweets are food — the same split the staff
 * discount makes in staffRateFor(). A station nobody mapped gets no target
 * rather than a guess, so no price is suggested for it.
 */
export function targetMarginFor(
  station: string | null | undefined,
  margins: { food: number; drink: number },
): number | null {
  if (station === 'Bar') return margins.drink
  if (station === 'Kitchen' || station === 'Sweets') return margins.food
  return null
}

/** Menu prices move in quarters. A suggestion is rounded UP to one of these. */
export const PRICE_STEP_USD = 0.25

export interface SuggestedPrice {
  /** What the dish has to sell for before VAT to make the target margin. */
  exVatUsd: number
  /** The same with VAT on top: prices include VAT. */
  withVatUsd: number
  /** Rounded UP to the price step, so rounding can only add margin, never take it. */
  roundedUsd: number
}

/**
 * The price that makes `targetMargin` on the recipe cost.
 *
 * The margin is on the price BEFORE VAT, the same basis as dishMargin(), so a
 * dish priced at its suggestion shows exactly the target margin (or a little
 * more, from rounding up) on the Recipes page. Dividing cost by the
 * VAT-inclusive price instead would suggest a price that falls short of the
 * target by the tax rate on every dish.
 *
 * null when there is nothing honest to suggest: no cost, a cost of zero, or a
 * target of 100% or more — a margin that no price can reach.
 */
export function suggestedPrice(
  costUsd: number | null,
  targetMargin: number,
  vatRate: number,
  stepUsd: number = PRICE_STEP_USD,
): SuggestedPrice | null {
  if (costUsd === null || !Number.isFinite(costUsd) || costUsd <= 0) return null
  if (!Number.isFinite(targetMargin) || targetMargin < 0 || targetMargin >= 1) return null
  const rate = Number.isFinite(vatRate) && vatRate >= 0 && vatRate < 1 ? vatRate : 0
  const stepCents = Number.isFinite(stepUsd) && stepUsd > 0 ? Math.max(1, Math.round(stepUsd * 100)) : 1

  const exVat = costUsd / (1 - targetMargin)
  const withVat = exVat * (1 + rate)
  // Settle float noise to a hundredth of a cent before rounding up, so a price
  // that is exactly on a step is not pushed to the next: a 20¢ drink at 80%
  // comes out as 1.0000000000000002, which would otherwise suggest $1.25.
  const cents = Math.round(withVat * 10_000) / 100
  return {
    exVatUsd: r2(exVat),
    withVatUsd: r2(withVat),
    roundedUsd: (Math.ceil(cents / stepCents) * stepCents) / 100,
  }
}

// ── Sending, voiding, refunding ───────────────────────────────────────────

/**
 * One stock move per supply for a whole Send.
 *
 * Summed, not one per line: a busy check listing milk on twelve lines is one
 * increment on milk, which keeps a Send transaction far from Firestore's
 * write limit.
 */
export function stockMoves(lines: readonly (readonly Consumption[])[]): { supplyId: string; qty: number }[] {
  const total = new Map<string, number>()
  for (const line of lines) {
    for (const c of line) total.set(c.supplyId, (total.get(c.supplyId) ?? 0) + c.qty)
  }
  return [...total].map(([supplyId, qty]) => ({ supplyId, qty: roundQty(qty) })).sort(bySupplyId)
}

/**
 * A per-serving snapshot scaled to a whole line.
 *
 * A check line stores what ONE serving takes, resolved when the line is added,
 * like its price — and the quantity multiplies it wherever stock moves: Send,
 * a void, a refund. Nothing changes a line's quantity after it is added today,
 * but a snapshot that already carried the quantity would be silently wrong the
 * day something does. The cost per purchase unit is carried, not multiplied.
 */
export function scaleConsumption(perServing: readonly Consumption[], quantity: number): Consumption[] {
  if (!Number.isInteger(quantity) || quantity <= 0) return []
  return perServing.map(c => ({ ...c, qty: roundQty(c.qty * quantity) }))
}

export interface ReasonFlags {
  /** The item was never made and its ingredients are still usable. */
  returnsToStock: boolean
  /** The item was made, or ruined, and lost. */
  isWaste: boolean
}

export type IngredientOutcome = 'nothing-taken' | 'return' | 'waste' | 'kept'

/**
 * What happens to a line's ingredients when it is voided or refunded.
 *
 * Refunds follow their cause exactly as voids do (owner's decision, 14 Sep
 * 2026): a customer who changed their mind before anything was cooked gives
 * the ingredients back; a dish already made is waste.
 *
 *   never sent                 → nothing was taken
 *   not made (returnsToStock)  → back on the shelf
 *   made and lost (isWaste)    → waste, valued at what it cost
 *   otherwise                  → consumed, and not waste
 *
 * A reason claiming both — returned AND wasted — resolves to waste. Returning
 * ingredients that may not exist invents stock; recording waste that didn't
 * happen is only a pessimistic report.
 */
export function ingredientOutcome(wasSent: boolean, reason: ReasonFlags): IngredientOutcome {
  if (!wasSent) return 'nothing-taken'
  if (reason.isWaste) return 'waste'
  if (reason.returnsToStock) return 'return'
  return 'kept'
}

// ── Check lines ───────────────────────────────────────────────────────────
// The till never works out what comes off or back onto the shelf inline. It
// asks these, and applies the answer. A void or a refund deciding stock inside
// a transaction is exactly the shape of code nothing can assert on.

/** A check line as far as ingredients are concerned. */
export interface ConsumingLine {
  status?: string
  quantity: number
  consumesPerServing?: readonly Consumption[] | null
  consumesUnknown?: readonly string[] | null
}

/**
 * What one check line took off the shelf: its per-serving snapshot times its
 * quantity. No snapshot — merchandise, a dish with no recipe, or a line added
 * while the `recipes` switch was off — took nothing.
 */
export function lineTaken(line: ConsumingLine): Consumption[] {
  if (!line.consumesPerServing || line.consumesPerServing.length === 0) return []
  return scaleConsumption(line.consumesPerServing, line.quantity)
}

/** One stock move per supply for the lines a Send fires. */
export function sendMoves(lines: readonly ConsumingLine[]): { supplyId: string; qty: number }[] {
  return stockMoves(lines.map(lineTaken))
}

export interface ReversalPlan {
  /** What happened to the ingredients, or null when no line carried any. */
  outcome: IngredientOutcome | null
  /** Stock to put back, one move per supply. Empty unless the outcome is 'return'. */
  returns: { supplyId: string; qty: number }[]
  /** What was wasted: 0 when nothing was, null when a wasted line cannot be costed. */
  wasteUsd: number | null
}

/**
 * What a void or a refund does to ingredients.
 *
 * A void passes its one line; a refund passes every line on the check. Lines
 * already voided are skipped — whatever they did to stock happened when they
 * were voided. Waste is valued from each line's own snapshot, and a wasted line
 * that cannot be costed makes the whole figure unknown rather than smaller.
 */
export function reversalPlan(lines: readonly ConsumingLine[], wasSent: boolean, reason: ReasonFlags): ReversalPlan {
  const carrying = lines
    .filter(l => l.status !== 'void')
    .map(l => ({ line: l, consumes: lineTaken(l) }))
    .filter(t => t.consumes.length > 0 || (t.line.consumesUnknown?.length ?? 0) > 0)
  if (carrying.length === 0) return { outcome: null, returns: [], wasteUsd: 0 }

  const outcome = ingredientOutcome(wasSent, reason)
  if (outcome === 'return') return { outcome, returns: stockMoves(carrying.map(t => t.consumes)), wasteUsd: 0 }
  if (outcome !== 'waste') return { outcome, returns: [], wasteUsd: 0 }

  let total = 0
  for (const t of carrying) {
    const cost = consumptionCost({ consumes: t.consumes, unknown: [...(t.line.consumesUnknown ?? [])] })
    if (cost.costUsd === null) return { outcome, returns: [], wasteUsd: null }
    total += cost.costUsd
  }
  return { outcome, returns: [], wasteUsd: r2(total) }
}

// ── Theoretical food cost ─────────────────────────────────────────────────

/** One menu line sold on a closed check, with its share of what the check charged. */
export interface SoldLine extends ConsumingLine {
  /** This line's share of the bill, VAT included, every discount already applied. */
  salesUsd: number
  /** The VAT rate the check closed at, or null for a check that recorded none. */
  vatRate: number | null
  /** 'product' is merchandise off the shelf — not food, so not in food cost. */
  source?: string
}

export interface TheoreticalFoodCost {
  /** Sales before VAT of every menu line counted. */
  salesExVatUsd: number
  /** Sales before VAT of the lines whose recipes could be fully costed. */
  costedSalesExVatUsd: number
  /** What those lines' ingredients cost, from each line's own snapshot. */
  costUsd: number
  /** Food cost over the sales that can be costed. null when none can. */
  costPercent: number | null
  /** Share of sales the percentage covers. null when there were no sales. */
  coverage: number | null
  linesCosted: number
  /** Has a recipe, but an ingredient has no cost or no conversion. */
  linesUncosted: number
  /** Sold with no snapshot: no recipe, or added while ingredient deduction was off. */
  linesWithoutRecipe: number
  /** On checks that recorded no VAT rate: counted at full price, no VAT extracted. */
  linesWithoutVatRate: number
}

/**
 * What the recipes say the food sold should have cost, against what it sold for
 * before VAT — the POS checks' own sales (owner's decision, 14 Sep 2026), the
 * only sales a recipe cost is known for.
 *
 * The percentage is taken ONLY over lines that can be fully costed, and
 * `coverage` says how much of sales that is. Dividing a partial cost by all of
 * sales would print a flattering food cost for every dish nobody wrote a recipe
 * for: the figure would improve by leaving recipes out.
 *
 * VAT is extracted at each check's own rate. A check that recorded none
 * contributes its full price and is counted — the sales export's rule: never a
 * guess at today's rate.
 */
export function theoreticalFoodCost(lines: readonly SoldLine[]): TheoreticalFoodCost {
  let salesExVat = 0
  let costedSales = 0
  let cost = 0
  let linesCosted = 0
  let linesUncosted = 0
  let linesWithoutRecipe = 0
  let linesWithoutVatRate = 0

  for (const l of lines) {
    if (l.status === 'void' || l.source === 'product' || !Number.isFinite(l.salesUsd)) continue
    const rate = l.vatRate
    const hasRate = typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < 1
    if (!hasRate) linesWithoutVatRate++
    const exVat = hasRate ? l.salesUsd / (1 + rate) : l.salesUsd
    salesExVat += exVat

    const c = consumptionCost({ consumes: lineTaken(l), unknown: [...(l.consumesUnknown ?? [])] })
    if (c.reason === 'ok') {
      linesCosted++
      costedSales += exVat
      cost += c.costUsd as number
    } else if (c.reason === 'incomplete') {
      linesUncosted++
    } else {
      linesWithoutRecipe++
    }
  }

  return {
    salesExVatUsd: r2(salesExVat),
    costedSalesExVatUsd: r2(costedSales),
    costUsd: r2(cost),
    costPercent: costedSales > 0 ? cost / costedSales : null,
    coverage: salesExVat > 0 ? costedSales / salesExVat : null,
    linesCosted,
    linesUncosted,
    linesWithoutRecipe,
    linesWithoutVatRate,
  }
}

/** A check line as the combo fold reads it. */
export interface FoldableLine extends ConsumingLine {
  id: string
  refId?: string
  comboOf?: string
}

/**
 * Each combo's parts folded into the combo line, for costing (UPGRADE.md T7.8,
 * reporting gap 18). A combo is written as one line carrying the whole price
 * and a $0 line per part, and each part snapshots its own recipe. Costed as
 * they stand, a part's ingredients are set against $0 of sales while the combo
 * line carries the sales and no recipe, so food cost reads HIGHER than the
 * truth. Here the combo line takes, per serving of the combo, what all its
 * parts took, and the parts are dropped.
 *
 * A part with no snapshot beside parts that have one makes the combo
 * incomplete (its menu id is named as unknown), never costed on the parts it
 * could cost: that would print a flattering margin. With no snapshot on any
 * part, the combo has no recipe, as a dish without one. Voided lines stay as
 * they are; a combo is voided whole. A part whose combo line is not in the
 * list is left alone.
 */
export function foldComboParts<L extends FoldableLine>(lines: readonly L[]): L[] {
  const partsOf = new Map<string, L[]>()
  const ids = new Set(lines.map(l => l.id))
  for (const l of lines) {
    if (l.comboOf && ids.has(l.comboOf) && l.status !== 'void') {
      partsOf.set(l.comboOf, [...(partsOf.get(l.comboOf) ?? []), l])
    }
  }
  const out: L[] = []
  for (const l of lines) {
    if (l.comboOf && ids.has(l.comboOf) && l.status !== 'void') continue
    const parts = partsOf.get(l.id)
    if (!parts || l.status === 'void') { out.push(l); continue }
    const servings = l.quantity > 0 ? l.quantity : 1
    const per = new Map<string, Consumption>()
    const add = (c: Consumption, times: number) => {
      const had = per.get(c.supplyId)
      per.set(c.supplyId, {
        supplyId: c.supplyId,
        qty: roundQty((had?.qty ?? 0) + c.qty * times),
        // One unknown cost leaves the supply uncosted.
        unitCostUsd: had && had.unitCostUsd === null ? null : c.unitCostUsd,
      })
    }
    const unknown = new Set(l.consumesUnknown ?? [])
    for (const c of l.consumesPerServing ?? []) add(c, 1)
    const withSnapshot = parts.filter(p => (p.consumesPerServing?.length ?? 0) > 0 || (p.consumesUnknown?.length ?? 0) > 0)
    for (const p of parts) {
      for (const c of p.consumesPerServing ?? []) add(c, p.quantity / servings)
      for (const u of p.consumesUnknown ?? []) unknown.add(u)
      if (withSnapshot.length > 0 && !withSnapshot.includes(p)) unknown.add(p.refId || p.id)
    }
    const consumes = [...per.values()].sort(bySupplyId)
    out.push({
      ...l,
      consumesPerServing: consumes.length > 0 ? consumes : l.consumesPerServing,
      consumesUnknown: unknown.size > 0 ? [...unknown].sort() : l.consumesUnknown,
    })
  }
  return out
}

// ── The daily count ───────────────────────────────────────────────────────

/**
 * Counted against expected, in quantity and money.
 *
 * `expectedQty` is the stock figure the system held just before the count
 * overwrote it. Without that snapshot there is nothing to compare, so a count
 * with no expected figure has no variance rather than an invented one.
 */
export function countVariance(
  expectedQty: number | null | undefined,
  countedQty: number,
  avgUnitCost: number | null | undefined,
): { varianceQty: number | null; varianceUsd: number | null } {
  if (typeof expectedQty !== 'number' || !Number.isFinite(expectedQty) || !Number.isFinite(countedQty)) {
    return { varianceQty: null, varianceUsd: null }
  }
  const varianceQty = roundQty(countedQty - expectedQty)
  const cost = typeof avgUnitCost === 'number' && Number.isFinite(avgUnitCost) && avgUnitCost > 0 ? avgUnitCost : null
  return { varianceQty, varianceUsd: cost === null ? null : r2(varianceQty * cost) }
}

// ── Saving a recipe ───────────────────────────────────────────────────────

/**
 * Everything wrong with a recipe, in words an admin can act on. Empty means
 * it may be saved.
 *
 * The server calls this before writing, so the rules cannot be skipped by
 * crafting a request; the editor calls it too, so they are seen before Save.
 */
export function recipeProblems(recipe: Recipe, supplies?: Readonly<Record<string, RecipeSupply>>): string[] {
  const problems: string[] = []
  const label = (id: string) => supplies?.[id]?.name ?? id

  if (!Array.isArray(recipe.lines) || recipe.lines.length === 0) {
    problems.push('A recipe needs at least one ingredient.')
  }
  const used = new Set<string>()
  for (const [i, l] of (recipe.lines ?? []).entries()) {
    if (!l.supplyId) { problems.push(`Ingredient ${i + 1} has no item chosen.`); continue }
    used.add(l.supplyId)
    if (!Number.isFinite(l.qty) || l.qty <= 0) {
      problems.push(`${label(l.supplyId)} needs a quantity above zero.`)
    }
  }

  for (const [optionId, list] of Object.entries(recipe.adjustments ?? {})) {
    for (const a of list) {
      if (a.kind === 'add') {
        if (!a.supplyId) problems.push(`An added ingredient for option ${optionId} has no item chosen.`)
        else if (!Number.isFinite(a.qty) || a.qty <= 0) {
          problems.push(`Adding ${label(a.supplyId)} needs a quantity above zero.`)
        }
      } else if (a.kind === 'replace') {
        if (!a.fromSupplyId || !a.toSupplyId) {
          problems.push(`A replacement for option ${optionId} is missing an item.`)
        } else if (a.fromSupplyId === a.toSupplyId) {
          problems.push(`${label(a.fromSupplyId)} cannot replace itself.`)
        } else if (!used.has(a.fromSupplyId)) {
          problems.push(`${label(a.toSupplyId)} replaces ${label(a.fromSupplyId)}, which this recipe does not use.`)
        }
      } else {
        problems.push(`Option ${optionId} has an adjustment of an unknown kind.`)
      }
    }
  }

  if (supplies) {
    const referenced = new Set<string>([
      ...(recipe.lines ?? []).map(l => l.supplyId),
      ...Object.values(recipe.adjustments ?? {}).flat().flatMap(a =>
        a.kind === 'add' ? [a.supplyId] : a.kind === 'replace' ? [a.toSupplyId] : []),
    ].filter(Boolean))
    for (const id of [...referenced].sort()) {
      const s = supplies[id]
      if (!s) { problems.push(`An ingredient is no longer in the supplies list (${id}).`); continue }
      if (unitFactor(s) === null) {
        problems.push(`${label(id)} is measured in ${s.recipeUnit} but has no conversion to ${s.unit}.`)
      }
      if (yieldFraction(s) === null) {
        problems.push(`${label(id)} has a usable share outside 1–100%.`)
      }
    }
  }
  return problems
}
