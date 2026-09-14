// Food safety — limits, temperature readings, and the daily diary.
//
// Pure: no imports, so `npm run verify:food-safety` transpiles this file alone
// and asserts against it. Pages and routes apply what this decides; nothing
// about a limit or a signature is worked out inline in a component.
//
// ── Where the structure comes from ─────────────────────────────────────────
// The Food Standards Agency's "Safer Food, Better Business for caterers"
// (UK, 2015 edition): safe methods set up once, a diary of opening and closing
// checks signed each day as supervised, and a review every four weeks.
// Contains public sector information licensed under the Open Government
// Licence v3.0. The wording here is our own; the numbers below are the pack's.
//
// ── Every number is a setting ──────────────────────────────────────────────
// The pack's temperatures are UK law and UK guidance. A café in another country
// is bound by its own rules, so UK_SFBB_LIMITS is only the default a client
// starts from (owner's decision, 14 Sep 2026) — never a constant a screen or a
// route may read directly. Read them through readLimits().
//
// ── Readings: beyond the pack, on purpose ──────────────────────────────────
// SFBB asks for a daily tick that the fridges work. We log the reading itself
// (owner's decision, 14 Sep 2026), because a number is what an inspector asks
// for and a tick is what gets ticked without looking.

// ── Limits ────────────────────────────────────────────────────────────────

export interface FoodSafetyLimits {
  /** Fridges and chilled display units are SET to this or below. */
  fridgeSetMaxC: number
  /** Chilled food must be KEPT at this or below. Above it is a breach. */
  chilledKeepMaxC: number
  /** Frozen food at this or below. Not in the pack; common guidance. */
  freezerMaxC: number
  /** Hot-held food at this or above. */
  hotHoldMinC: number
  /** Chilled food may be out of chill once, for up to this long. */
  chilledOutMaxHours: number
  /** Hot food may be out of hot holding once, for up to this long. */
  hotOutMaxHours: number
  /** Defrosted food is used within this many days. */
  defrostedUseWithinDays: number
  /** Symptom-free this long after vomiting or diarrhoea before working with food. */
  illnessExclusionHours: number
  /** A probe in iced water should read within this range. */
  probeIcedMinC: number
  probeIcedMaxC: number
  /** A probe in boiling water should read within this range. */
  probeBoilingMinC: number
  probeBoilingMaxC: number
}

export type LimitKey = keyof FoodSafetyLimits

/** The pack's values. A default to start from, never the law of the client's country. */
export const UK_SFBB_LIMITS: Readonly<FoodSafetyLimits> = {
  fridgeSetMaxC: 5,
  chilledKeepMaxC: 8,
  freezerMaxC: -18,
  hotHoldMinC: 63,
  chilledOutMaxHours: 4,
  hotOutMaxHours: 2,
  defrostedUseWithinDays: 1,
  illnessExclusionHours: 48,
  probeIcedMinC: -1,
  probeIcedMaxC: 1,
  probeBoilingMinC: 99,
  probeBoilingMaxC: 101,
}

/**
 * What a setting may be. Generous, but not so generous that a slip of the
 * keyboard — 80 for 8, a missing minus on a freezer — saves as a limit.
 */
export const LIMIT_BOUNDS: Readonly<Record<LimitKey, { min: number; max: number }>> = {
  fridgeSetMaxC: { min: 0, max: 10 },
  chilledKeepMaxC: { min: 0, max: 10 },
  freezerMaxC: { min: -30, max: -12 },
  hotHoldMinC: { min: 55, max: 80 },
  chilledOutMaxHours: { min: 0, max: 6 },
  hotOutMaxHours: { min: 0, max: 6 },
  defrostedUseWithinDays: { min: 0, max: 3 },
  illnessExclusionHours: { min: 0, max: 168 },
  probeIcedMinC: { min: -3, max: 0 },
  probeIcedMaxC: { min: 0, max: 3 },
  probeBoilingMinC: { min: 95, max: 100 },
  probeBoilingMaxC: { min: 100, max: 105 },
}

/**
 * Stored limits, read fail-safe.
 *
 * Anything missing, non-numeric or out of bounds falls back to the default,
 * the rule business settings follow. A pair that contradicts itself — a fridge
 * set point above the keep limit, a probe range upside down — falls back as a
 * pair, because keeping half of a contradiction is how "8 °C is fine" ends up
 * reading as a warning and "9 °C" as fine.
 */
export function readLimits(raw: unknown): FoodSafetyLimits {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = { ...UK_SFBB_LIMITS } as FoodSafetyLimits
  for (const key of Object.keys(UK_SFBB_LIMITS) as LimitKey[]) {
    const v = src[key]
    const { min, max } = LIMIT_BOUNDS[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) out[key] = v
  }
  const pairs: [LimitKey, LimitKey][] = [
    ['fridgeSetMaxC', 'chilledKeepMaxC'],
    ['probeIcedMinC', 'probeIcedMaxC'],
    ['probeBoilingMinC', 'probeBoilingMaxC'],
  ]
  for (const [lo, hi] of pairs) {
    if (out[lo] > out[hi]) { out[lo] = UK_SFBB_LIMITS[lo]; out[hi] = UK_SFBB_LIMITS[hi] }
  }
  return out
}

// ── Allergens ─────────────────────────────────────────────────────────────

export interface AllergenDef { key: string; label: string }

/**
 * The 14 allergens UK and EU law names (Regulation 1169/2011). Data, not a
 * type: another country names a different list, and a client's list is a
 * setting chosen from these — so an ingredient tagged under one list still
 * means something if the list changes.
 */
export const ALLERGENS_EU14: readonly AllergenDef[] = [
  { key: 'gluten', label: 'Cereals containing gluten' },
  { key: 'crustaceans', label: 'Crustaceans' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'fish', label: 'Fish' },
  { key: 'peanuts', label: 'Peanuts' },
  { key: 'soya', label: 'Soya' },
  { key: 'milk', label: 'Milk' },
  { key: 'nuts', label: 'Tree nuts' },
  { key: 'celery', label: 'Celery' },
  { key: 'mustard', label: 'Mustard' },
  { key: 'sesame', label: 'Sesame' },
  { key: 'sulphites', label: 'Sulphur dioxide and sulphites' },
  { key: 'lupin', label: 'Lupin' },
  { key: 'molluscs', label: 'Molluscs' },
]

// ── Temperature readings ──────────────────────────────────────────────────

export type UnitKind = 'fridge' | 'chilledDisplay' | 'freezer' | 'hotHold'

export const UNIT_KINDS: readonly { kind: UnitKind; label: string }[] = [
  { kind: 'fridge', label: 'Fridge' },
  { kind: 'chilledDisplay', label: 'Chilled display' },
  { kind: 'freezer', label: 'Freezer' },
  { kind: 'hotHold', label: 'Hot holding' },
]

export type ReadingStatus = 'ok' | 'warn' | 'breach'

export interface ReadingVerdict {
  status: ReadingStatus
  /** The limit the reading was judged against. */
  limitC: number
  /** One line a person can act on. */
  message: string
}

/** Readings are entered to a tenth of a degree and judged at that precision. */
const tenth = (n: number) => Math.round(n * 10) / 10

/**
 * What a reading means against the limits, or null for a number that cannot
 * be a real reading — a typo is not a breach, and not "ok" either.
 *
 * Chilled: at or below the set point is ok; above it but at or below the keep
 * limit is a warning (the unit wants adjusting); above the keep limit is a
 * breach. Freezer: above its limit is a breach. Hot holding: below its limit
 * is a breach. "Or below" and "or above" are inclusive, as the pack writes them.
 */
export function judgeReading(kind: UnitKind, tempC: number, limits: FoodSafetyLimits): ReadingVerdict | null {
  if (typeof tempC !== 'number' || !Number.isFinite(tempC) || tempC < -60 || tempC > 150) return null
  const t = tenth(tempC)
  switch (kind) {
    case 'fridge':
    case 'chilledDisplay':
      if (t > limits.chilledKeepMaxC) {
        return { status: 'breach', limitC: limits.chilledKeepMaxC, message: `Above ${limits.chilledKeepMaxC} °C — chilled food is not being kept cold enough.` }
      }
      if (t > limits.fridgeSetMaxC) {
        return { status: 'warn', limitC: limits.fridgeSetMaxC, message: `Above the ${limits.fridgeSetMaxC} °C set point — adjust the unit and check again.` }
      }
      return { status: 'ok', limitC: limits.fridgeSetMaxC, message: `At or below ${limits.fridgeSetMaxC} °C.` }
    case 'freezer':
      if (t > limits.freezerMaxC) {
        return { status: 'breach', limitC: limits.freezerMaxC, message: `Above ${limits.freezerMaxC} °C — the freezer is not holding temperature.` }
      }
      return { status: 'ok', limitC: limits.freezerMaxC, message: `At or below ${limits.freezerMaxC} °C.` }
    case 'hotHold':
      if (t < limits.hotHoldMinC) {
        return { status: 'breach', limitC: limits.hotHoldMinC, message: `Below ${limits.hotHoldMinC} °C — hot food is not being kept hot enough.` }
      }
      return { status: 'ok', limitC: limits.hotHoldMinC, message: `At or above ${limits.hotHoldMinC} °C.` }
    default:
      return null
  }
}

export interface ProbeVerdict {
  iced: boolean
  boiling: boolean
  /** Both readings in range. Otherwise the probe is recalibrated or replaced. */
  passed: boolean
}

/** A probe checked in iced water and in boiling water. null when either reading is not a number. */
export function judgeProbe(icedC: number, boilingC: number, limits: FoodSafetyLimits): ProbeVerdict | null {
  if (![icedC, boilingC].every(n => typeof n === 'number' && Number.isFinite(n))) return null
  const i = tenth(icedC)
  const b = tenth(boilingC)
  const iced = i >= limits.probeIcedMinC && i <= limits.probeIcedMaxC
  const boiling = b >= limits.probeBoilingMinC && b <= limits.probeBoilingMaxC
  return { iced, boiling, passed: iced && boiling }
}

// ── The daily diary ───────────────────────────────────────────────────────

export interface ChecklistItem { key: string; label: string }

/** Defaults a branch starts from and edits. Our wording, after the pack's opening checks. */
export const DEFAULT_OPENING_CHECKS: readonly ChecklistItem[] = [
  { key: 'cold-units', label: 'Fridges, chilled displays and freezers are working, and their readings are logged' },
  { key: 'equipment', label: 'Ovens and other equipment are working' },
  { key: 'staff-fit', label: 'Staff are fit for work and in clean work clothes' },
  { key: 'prep-clean', label: 'Preparation areas are clean, and disinfected where food touches them' },
  { key: 'supplies', label: 'Handwashing and cleaning supplies are stocked' },
]

/** Our wording, after the pack's closing checks. */
export const DEFAULT_CLOSING_CHECKS: readonly ChecklistItem[] = [
  { key: 'no-food-out', label: 'No food has been left out' },
  { key: 'use-by', label: 'Food past its use-by date has been thrown away' },
  { key: 'cloths', label: 'Dirty cloths are out for washing and clean ones are in place' },
  { key: 'waste', label: 'Waste is out and bins have fresh bags' },
]

/**
 * One check, answered.
 *
 * A check is DONE, or NOT DONE WITH A NOTE saying what happened. There is no
 * third state for signing: an unanswered check blocks the signature. And a
 * check cannot be forced to "done" to get a signature — "not done, and here is
 * why" signs just as well — because a diary that can only be signed by ticking
 * everything is a diary that gets ticked.
 */
export interface CheckAnswer { key: string; done: boolean; note?: string }

export interface UnitReading {
  unitId: string
  kind: UnitKind
  /** Absent when the unit is out of use today. */
  tempC?: number
  /** Required when out of use, and when the reading is a breach. */
  note?: string
  outOfUse?: boolean
}

export interface DiaryUnit { id: string; name: string; kind: UnitKind }

export interface DiaryDay {
  opening: readonly CheckAnswer[]
  closing: readonly CheckAnswer[]
  readings: readonly UnitReading[]
}

const hasText = (s: string | undefined) => typeof s === 'string' && s.trim().length > 0

/** Whether a reading can be saved as it stands, and if not, why. */
export function readingProblem(reading: UnitReading, limits: FoodSafetyLimits): string | null {
  if (reading.outOfUse) return hasText(reading.note) ? null : 'Say why the unit is out of use.'
  if (reading.tempC === undefined) return 'Enter a reading, or mark the unit out of use.'
  const verdict = judgeReading(reading.kind, reading.tempC, limits)
  if (!verdict) return 'That is not a temperature this unit could read.'
  if (verdict.status === 'breach' && !hasText(reading.note)) {
    return `${verdict.message} Record what was done about it.`
  }
  return null
}

/**
 * Everything that stops a manager signing the day, in the order a person would
 * fix it. Empty means the day can be signed.
 */
export function signingBlockers(
  day: DiaryDay,
  checklists: { opening: readonly ChecklistItem[]; closing: readonly ChecklistItem[] },
  units: readonly DiaryUnit[],
  limits: FoodSafetyLimits,
): string[] {
  const blockers: string[] = []

  const answerList = (label: string, items: readonly ChecklistItem[], answers: readonly CheckAnswer[]) => {
    const byKey = new Map(answers.map(a => [a.key, a]))
    for (const item of items) {
      const a = byKey.get(item.key)
      if (!a) blockers.push(`${label}: "${item.label}" has not been answered.`)
      else if (!a.done && !hasText(a.note)) blockers.push(`${label}: "${item.label}" was not done — say what happened.`)
    }
  }
  answerList('Opening', checklists.opening, day.opening)

  const readingByUnit = new Map(day.readings.map(r => [r.unitId, r]))
  for (const unit of units) {
    const r = readingByUnit.get(unit.id)
    if (!r) { blockers.push(`${unit.name}: no reading today.`); continue }
    const problem = readingProblem({ ...r, kind: unit.kind }, limits)
    if (problem) blockers.push(`${unit.name}: ${problem}`)
  }

  answerList('Closing', checklists.closing, day.closing)
  return blockers
}

/** 'YYYY-MM-DD' days from `from` to `to` inclusive with no signed diary. Calendar arithmetic only — no clock, no zone. */
export function missedDays(from: string, to: string, signedDays: readonly string[]): string[] {
  const YMD = /^\d{4}-\d{2}-\d{2}$/
  if (!YMD.test(from) || !YMD.test(to) || from > to) return []
  const signed = new Set(signedDays)
  const out: string[] = []
  let ms = Date.parse(`${from}T12:00:00Z`)
  const end = Date.parse(`${to}T12:00:00Z`)
  for (let i = 0; ms <= end && i < 400; i++, ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10)
    if (!signed.has(day)) out.push(day)
  }
  return out
}

/** Names a person reads, for every limit — the settings form and every refusal use these. */
export const LIMIT_LABELS: Readonly<Record<LimitKey, string>> = {
  fridgeSetMaxC: 'Fridge set point (°C, at or below)',
  chilledKeepMaxC: 'Chilled food kept at (°C, at or below)',
  freezerMaxC: 'Freezer (°C, at or below)',
  hotHoldMinC: 'Hot holding (°C, at or above)',
  chilledOutMaxHours: 'Chilled food out of the fridge, once (hours)',
  hotOutMaxHours: 'Hot food out of hot holding, once (hours)',
  defrostedUseWithinDays: 'Defrosted food used within (days)',
  illnessExclusionHours: 'Symptom-free before returning to work (hours)',
  probeIcedMinC: 'Probe in iced water, lowest (°C)',
  probeIcedMaxC: 'Probe in iced water, highest (°C)',
  probeBoilingMinC: 'Probe in boiling water, lowest (°C)',
  probeBoilingMaxC: 'Probe in boiling water, highest (°C)',
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A 'YYYY-MM-DD' moved by whole days, or '' for anything that is not a real date. Calendar arithmetic only. */
export function addDays(ymd: string, days: number): string {
  if (!DAY.test(ymd) || !Number.isInteger(days)) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return ''
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

export type DayAccess = 'edit' | 'amend' | 'read'

/** How far back a manager may fill in a day nobody recorded. Beyond this it is history. */
export const REVIEWER_BACKFILL_DAYS = 7

/**
 * What a person may do with one diary day.
 *
 * - Nobody writes a day that has not happened.
 * - Staff write today and yesterday: a closing check done after midnight
 *   belongs to the night before, and a café day does not end at 00:00.
 * - A manager may also fill in an unsigned day up to a week back — and the
 *   signature then shows it was signed late (signedLate()), never as if on time.
 * - A signed day is never overwritten. A manager amends it with a reason, and
 *   the day keeps what it said before; staff can only read it.
 */
export function dayAccess(date: string, today: string, who: { reviewer: boolean; signed: boolean }): DayAccess {
  if (!DAY.test(date) || !DAY.test(today) || date > today) return 'read'
  if (who.signed) return who.reviewer ? 'amend' : 'read'
  if (date >= addDays(today, -1)) return 'edit'
  if (who.reviewer && date >= addDays(today, -REVIEWER_BACKFILL_DAYS)) return 'edit'
  return 'read'
}

/** Signed after the day that followed it: the night's closing checks can sign the next morning, not later. */
export function signedLate(date: string, signedOn: string): boolean {
  const next = addDays(date, 1)
  return Boolean(next) && DAY.test(signedOn) && signedOn > next
}
