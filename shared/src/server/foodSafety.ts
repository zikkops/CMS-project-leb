// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Food safety records: the limits and checklists, the units that get a
// temperature reading, and one diary document per branch per café day.
//
// Every judgement comes from shared/src/foodSafety.ts, asserted by
// `npm run verify:food-safety` — whether a reading may be saved, whether a day
// can be signed, who may write which day. This file stores what those decide
// and refuses what they refuse.
//
// No Firestore rule governs these collections, so no browser reads or writes
// them directly — the arrangement recipes use. Everything goes through
// /api/admin/food-safety, which is also what lets a signed day be amended but
// never overwritten.

import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'
import { BRAND } from '../brand'
import { todayYmd } from '../dates'
import { timestampMs } from '../timestamps'
import {
  readLimits, readingProblem, signingBlockers, judgeReading, dayAccess, signedLate, missedDays, addDays,
  sameEntry, changedEntries, withRetiredAnswers,
  DEFAULT_OPENING_CHECKS, DEFAULT_CLOSING_CHECKS, ALLERGENS_EU14, LIMIT_BOUNDS, LIMIT_LABELS, UK_SFBB_LIMITS, UNIT_KINDS,
  type FoodSafetyLimits, type LimitKey, type ChecklistItem, type CheckAnswer, type UnitReading,
  type DiaryUnit, type UnitKind, type DayAccess,
} from '../foodSafety'

const SETTINGS_DOC = 'appSettings/foodSafety'
const UNITS = 'foodSafetyUnits'
const DAYS = 'foodSafetyDays'

export const FOOD_SAFETY_TEXT = {
  problems: 2000,
  note: 500,
  label: 160,
  unitName: 60,
  checks: 20,
  historyDays: 62,
} as const

const YMD = /^\d{4}-\d{2}-\d{2}$/
const cafeToday = () => todayYmd(BRAND.locale.timezone)

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : ''
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function who(caller: Caller): string {
  return caller.email ?? caller.uid
}

// ── Branches ──────────────────────────────────────────────────────────────

/** The branches a caller may record for — the exports route's rule. */
export function callerBranches(caller: Caller): string[] {
  return caller.role === 'admin' || caller.branchIds.length === 0
    ? [...BRANCHES]
    : BRANCHES.filter(b => caller.branchIds.includes(b))
}

export function requireBranch(caller: Caller, raw: unknown): string {
  const branch = text(raw, 80)
  if (!branch || !BRANCHES.includes(branch)) throw new HttpError(400, 'Choose a branch.')
  if (!callerBranches(caller).includes(branch)) throw new HttpError(403, 'That branch is not one of yours.')
  return branch
}

export function requireDate(raw: unknown): string {
  const date = text(raw, 10)
  if (!YMD.test(date) || !addDays(date, 0)) throw new HttpError(400, 'The date must be a real YYYY-MM-DD day.')
  return date
}

// ── Settings ──────────────────────────────────────────────────────────────

export interface FoodSafetySettings {
  limits: FoodSafetyLimits
  /** Allergen keys this business tracks, from ALLERGENS_EU14. */
  allergens: string[]
  openingChecks: ChecklistItem[]
  closingChecks: ChecklistItem[]
}

/** A stored checklist, or the defaults when it is missing or empty — a café with no checks at all is a broken document, not a choice. */
function readChecklist(raw: unknown, fallback: readonly ChecklistItem[]): ChecklistItem[] {
  if (!Array.isArray(raw)) return [...fallback]
  const items = raw.flatMap(r => {
    const o = asRecord(r)
    const key = text(o.key, 64)
    const label = text(o.label, FOOD_SAFETY_TEXT.label)
    return key && label ? [{ key, label }] : []
  })
  return items.length > 0 ? items : [...fallback]
}

const KNOWN_ALLERGENS = new Set(ALLERGENS_EU14.map(a => a.key))

export async function readFoodSafetySettings(): Promise<FoodSafetySettings> {
  const d = (await adminDb().doc(SETTINGS_DOC).get()).data() ?? {}
  const allergens = Array.isArray(d.allergens)
    ? (d.allergens as unknown[]).filter((k): k is string => typeof k === 'string' && KNOWN_ALLERGENS.has(k))
    : []
  return {
    limits: readLimits(d.limits),
    allergens: allergens.length > 0 ? allergens : ALLERGENS_EU14.map(a => a.key),
    openingChecks: readChecklist(d.openingChecks, DEFAULT_OPENING_CHECKS),
    closingChecks: readChecklist(d.closingChecks, DEFAULT_CLOSING_CHECKS),
  }
}

function parseChecklistInput(raw: unknown, label: string): ChecklistItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, `${label} checks need at least one item.`)
  if (raw.length > FOOD_SAFETY_TEXT.checks) {
    throw new HttpError(400, `${label} checks can have at most ${FOOD_SAFETY_TEXT.checks} items.`)
  }
  const seen = new Set<string>()
  return raw.map((r, i) => {
    const o = asRecord(r)
    const itemLabel = text(o.label, FOOD_SAFETY_TEXT.label)
    if (!itemLabel) throw new HttpError(400, `${label} check ${i + 1} has no wording.`)
    // A key is what a day's answer points at. An existing check keeps its key,
    // so rewording it does not orphan the answers already given; a new check
    // is given one here rather than trusting the browser to invent one.
    let key = text(o.key, 64)
    if (!/^[a-z0-9-]{1,64}$/.test(key) || seen.has(key)) key = `c-${randomUUID().slice(0, 8)}`
    seen.add(key)
    return { key, label: itemLabel }
  })
}

/**
 * Settings as sent from the form. Unlike readLimits(), a value out of bounds is
 * REFUSED rather than replaced: quietly saving the default in place of what
 * somebody typed would leave them believing their local rule is in force.
 */
export function parseSettingsInput(body: Record<string, unknown>): FoodSafetySettings {
  const raw = asRecord(body.limits)
  const limits = { ...UK_SFBB_LIMITS } as FoodSafetyLimits
  for (const key of Object.keys(UK_SFBB_LIMITS) as LimitKey[]) {
    const v = raw[key]
    const { min, max } = LIMIT_BOUNDS[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      throw new HttpError(400, `${LIMIT_LABELS[key]} must be between ${min} and ${max}.`)
    }
    limits[key] = v
  }
  if (limits.fridgeSetMaxC > limits.chilledKeepMaxC) {
    throw new HttpError(400, 'The fridge set point cannot be above the temperature chilled food must be kept at.')
  }

  const allergens = Array.isArray(body.allergens)
    ? [...new Set((body.allergens as unknown[]).filter((k): k is string => typeof k === 'string' && KNOWN_ALLERGENS.has(k)))]
    : []
  if (allergens.length === 0) throw new HttpError(400, 'Choose at least one allergen to track.')

  return {
    limits,
    allergens,
    openingChecks: parseChecklistInput(body.openingChecks, 'Opening'),
    closingChecks: parseChecklistInput(body.closingChecks, 'Closing'),
  }
}

export async function writeFoodSafetySettings(caller: Caller, input: FoodSafetySettings): Promise<void> {
  await adminDb().doc(SETTINGS_DOC).set({
    ...input,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
    updatedByEmail: caller.email ?? '',
  })
}

// ── Units ─────────────────────────────────────────────────────────────────

export interface StoredUnit extends DiaryUnit {
  branch: string
  /** A unit is retired, never deleted: old days still name it. */
  active: boolean
}

const KIND_ORDER = new Map(UNIT_KINDS.map((k, i) => [k.kind, i]))

function toUnit(id: string, d: Record<string, unknown>): StoredUnit | null {
  const kind = String(d.kind ?? '') as UnitKind
  if (!KIND_ORDER.has(kind)) return null
  return { id, name: String(d.name ?? id), kind, branch: String(d.branch ?? ''), active: d.active !== false }
}

/** Single-field equality, so no composite index. */
export async function listUnits(branch: string): Promise<StoredUnit[]> {
  const snap = await adminDb().collection(UNITS).where('branch', '==', branch).get()
  return snap.docs
    .map(d => toUnit(d.id, d.data()))
    .filter((u): u is StoredUnit => u !== null)
    .sort((a, b) => (KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)!) || a.name.localeCompare(b.name))
}

export function parseUnitInput(caller: Caller, body: Record<string, unknown>): { id: string | null; branch: string; name: string; kind: UnitKind; active: boolean } {
  const id = text(body.id, 128) || null
  if (id && id.includes('/')) throw new HttpError(400, 'Invalid unit.')
  const name = text(body.name, FOOD_SAFETY_TEXT.unitName)
  if (!name) throw new HttpError(400, 'Give the unit a name, e.g. "Walk-in fridge".')
  const kind = String(body.kind ?? '') as UnitKind
  if (!KIND_ORDER.has(kind)) throw new HttpError(400, 'Choose what kind of unit it is.')
  return { id, branch: requireBranch(caller, body.branch), name, kind, active: body.active !== false }
}

export async function saveUnit(input: ReturnType<typeof parseUnitInput>): Promise<{ id: string; created: boolean }> {
  const db = adminDb()
  if (input.id) {
    const ref = db.doc(`${UNITS}/${input.id}`)
    const snap = await ref.get()
    if (!snap.exists) throw new HttpError(404, 'That unit no longer exists.')
    // A unit does not move branch: its readings belong to where it stands.
    if (snap.data()?.branch !== input.branch) throw new HttpError(400, 'A unit cannot move to another branch. Add a new one there.')
    await ref.update({ name: input.name, kind: input.kind, active: input.active, updatedAt: FieldValue.serverTimestamp() })
    return { id: input.id, created: false }
  }
  const ref = db.collection(UNITS).doc()
  await ref.set({
    branch: input.branch, name: input.name, kind: input.kind, active: true,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id, created: true }
}

// ── The diary ─────────────────────────────────────────────────────────────

interface Stamped { by: string; at: string }
export type StoredAnswer = CheckAnswer & Stamped
export type StoredReading = UnitReading & Stamped

export interface DayInput {
  branch: string
  date: string
  opening: CheckAnswer[]
  closing: CheckAnswer[]
  readings: UnitReading[]
  problems: string
  /** Required to change a signed day. */
  amendReason: string
}

function parseAnswers(raw: unknown): CheckAnswer[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, FOOD_SAFETY_TEXT.checks).flatMap(r => {
    const o = asRecord(r)
    const key = text(o.key, 64)
    if (!key || typeof o.done !== 'boolean') return []
    const note = text(o.note, FOOD_SAFETY_TEXT.note)
    return [{ key, done: o.done, ...(note ? { note } : {}) }]
  })
}

function parseReadings(raw: unknown): Omit<UnitReading, 'kind'>[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 100).flatMap(r => {
    const o = asRecord(r)
    const unitId = text(o.unitId, 128)
    if (!unitId) return []
    const note = text(o.note, FOOD_SAFETY_TEXT.note)
    const outOfUse = o.outOfUse === true
    // A number, or nothing. "7" as text is refused rather than guessed at, the
    // same stance the limits take.
    if (o.tempC !== undefined && o.tempC !== null && typeof o.tempC !== 'number') {
      throw new HttpError(400, 'A reading must be a number.')
    }
    const tempC = typeof o.tempC === 'number' && !outOfUse ? o.tempC : undefined
    return [{ unitId, ...(tempC !== undefined ? { tempC } : {}), ...(note ? { note } : {}), ...(outOfUse ? { outOfUse } : {}) }]
  })
}

export function parseDayInput(caller: Caller, body: Record<string, unknown>): DayInput {
  return {
    branch: requireBranch(caller, body.branch),
    date: requireDate(body.date),
    opening: parseAnswers(body.opening),
    closing: parseAnswers(body.closing),
    readings: parseReadings(body.readings) as UnitReading[],
    problems: text(body.problems, FOOD_SAFETY_TEXT.problems),
    amendReason: text(body.amendReason, FOOD_SAFETY_TEXT.note),
  }
}

function dayRef(branch: string, date: string) {
  return adminDb().doc(`${DAYS}/${branch}_${date}`)
}

/**
 * Who answered what. An entry unchanged from what is stored keeps its original
 * name and time; a new or changed one takes the caller's. So the day shows who
 * actually took the 07:00 fridge reading, not whoever last pressed Save.
 */
function stamp<T extends object>(next: T[], prev: (T & Stamped)[], keyOf: (x: T) => string, caller: Caller, now: string): (T & Stamped)[] {
  const before = new Map(prev.map(p => [keyOf(p), p]))
  return next.map(item => {
    const old = before.get(keyOf(item))
    // Compared without the stamps and without field order. Firestore does not
    // promise to hand a map's fields back in the order they were written, and
    // comparing JSON as written can re-stamp an untouched answer to whoever
    // saved last.
    if (old && sameEntry(old, item)) return { ...item, by: old.by, at: old.at }
    return { ...item, by: who(caller), at: now }
  })
}

export async function saveDay(caller: Caller, input: DayInput, reviewer: boolean): Promise<{ access: DayAccess; amended: boolean }> {
  const db = adminDb()
  // Read outside the transaction: settings and units change rarely, and a
  // transaction that read them would retry on every unrelated unit edit.
  const [settings, units] = await Promise.all([readFoodSafetySettings(), listUnits(input.branch)])
  const unitById = new Map(units.map(u => [u.id, u]))

  // Only readings actually taken are stored; a unit not yet read is simply absent.
  const readings: UnitReading[] = []
  for (const r of input.readings) {
    const unit = unitById.get(r.unitId)
    if (!unit) throw new HttpError(400, 'A reading names a unit this branch does not have.')
    if (r.tempC === undefined && !r.outOfUse) continue
    const withKind: UnitReading = { ...r, kind: unit.kind }
    const problem = readingProblem(withKind, settings.limits)
    if (problem) throw new HttpError(400, `${unit.name}: ${problem}`)
    readings.push(withKind)
  }
  const openingKeys = new Set(settings.openingChecks.map(c => c.key))
  const closingKeys = new Set(settings.closingChecks.map(c => c.key))

  return db.runTransaction(async tx => {
    const ref = dayRef(input.branch, input.date)
    const [snap] = await tx.getAll(ref)
    const stored = snap.exists ? (snap.data() ?? {}) : null
    const signed = Boolean(stored?.signedAt)
    const access = dayAccess(input.date, cafeToday(), { reviewer, signed })

    if (access === 'read') {
      throw new HttpError(403, signed
        ? 'This day has been signed. A manager can amend it, with a reason.'
        : 'This day can no longer be changed.')
    }
    if (access === 'amend' && !input.amendReason) {
      throw new HttpError(400, 'A signed day is amended, not overwritten — say why it is being changed.')
    }

    const now = new Date().toISOString()
    const prevOpening = (stored?.opening ?? []) as StoredAnswer[]
    const prevClosing = (stored?.closing ?? []) as StoredAnswer[]
    const prevReadings = (stored?.readings ?? []) as StoredReading[]
    // Today's checks come from the browser; answers to checks since removed
    // from the list are kept from what is stored (withRetiredAnswers).
    const opening = withRetiredAnswers(input.opening, prevOpening, openingKeys)
    const closing = withRetiredAnswers(input.closing, prevClosing, closingKeys)

    const doc: Record<string, unknown> = {
      branch: input.branch,
      date: input.date,
      opening: stamp(opening, prevOpening, a => a.key, caller, now),
      closing: stamp(closing, prevClosing, a => a.key, caller, now),
      readings: stamp(readings, prevReadings, r => r.unitId, caller, now),
      problems: input.problems,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByEmail: who(caller),
    }
    if (access === 'edit' && stored) {
      // An unsigned day keeps its corrections too: each entry this save
      // changes or removes, as it stood and with who entered it. Additions are
      // not corrections, so the ordinary run of saves through a day adds nothing.
      const oldProblems = typeof stored.problems === 'string' ? stored.problems : ''
      const before = {
        opening: changedEntries(prevOpening, opening, a => a.key),
        closing: changedEntries(prevClosing, closing, a => a.key),
        readings: changedEntries(prevReadings, readings, r => r.unitId),
        ...(oldProblems && oldProblems !== input.problems ? { problems: oldProblems } : {}),
      }
      if (before.opening.length + before.closing.length + before.readings.length > 0 || 'problems' in before) {
        doc.edits = FieldValue.arrayUnion({ by: who(caller), at: now, before })
      }
    }
    if (access === 'amend') {
      // What the day said before, kept whole. An inspector reading an amended
      // day must be able to see what was written on the day itself.
      doc.amendments = FieldValue.arrayUnion({
        by: who(caller), at: now, reason: input.amendReason,
        before: { opening: prevOpening, closing: prevClosing, readings: prevReadings, problems: stored?.problems ?? '' },
      })
    }
    tx.set(ref, doc, { merge: true })
    return { access, amended: access === 'amend' }
  })
}

export async function signDay(caller: Caller, branch: string, date: string): Promise<void> {
  const db = adminDb()
  const today = cafeToday()
  if (date > today) throw new HttpError(400, 'A day cannot be signed before it has happened.')
  const [settings, units] = await Promise.all([readFoodSafetySettings(), listUnits(branch)])
  const active = units.filter(u => u.active)

  await db.runTransaction(async tx => {
    const ref = dayRef(branch, date)
    const [snap] = await tx.getAll(ref)
    if (!snap.exists) throw new HttpError(409, 'Nothing has been recorded for this day yet.')
    const d = snap.data() ?? {}
    if (d.signedAt) throw new HttpError(409, 'This day is already signed.')

    const blockers = signingBlockers(
      { opening: d.opening ?? [], closing: d.closing ?? [], readings: d.readings ?? [] },
      { opening: settings.openingChecks, closing: settings.closingChecks },
      active,
      settings.limits,
    )
    if (blockers.length > 0) throw new HttpError(409, `This day cannot be signed yet:\n${blockers.join('\n')}`)

    tx.update(ref, {
      signedAt: FieldValue.serverTimestamp(),
      signedOn: today,
      signedBy: caller.uid,
      signedByEmail: who(caller),
      // What the day was judged against, kept with it. A limit or checklist
      // changed next month must not re-judge a day already signed — the same
      // reason a check keeps the VAT rate it closed at.
      atSigning: {
        limits: settings.limits,
        openingChecks: settings.openingChecks,
        closingChecks: settings.closingChecks,
        units: active.map(u => ({ id: u.id, name: u.name, kind: u.kind })),
      },
    })
  })
}

export interface DayView {
  branch: string
  date: string
  today: string
  access: DayAccess
  day: Record<string, unknown> | null
  units: StoredUnit[]
  limits: FoodSafetyLimits
  openingChecks: ChecklistItem[]
  closingChecks: ChecklistItem[]
  blockers: string[]
  signedLate: boolean
}

export async function readDay(branch: string, date: string, reviewer: boolean): Promise<DayView> {
  const [snap, settings, units] = await Promise.all([
    dayRef(branch, date).get(),
    readFoodSafetySettings(),
    listUnits(branch),
  ])
  const d = snap.exists ? (snap.data() ?? {}) : null
  const signed = Boolean(d?.signedAt)
  const at = asRecord(d?.atSigning)
  // A signed day is shown as it was judged; an open one against today's settings.
  const limits = signed ? readLimits(at.limits) : settings.limits
  const openingChecks = signed && Array.isArray(at.openingChecks) ? readChecklist(at.openingChecks, settings.openingChecks) : settings.openingChecks
  const closingChecks = signed && Array.isArray(at.closingChecks) ? readChecklist(at.closingChecks, settings.closingChecks) : settings.closingChecks
  const active = units.filter(u => u.active)

  return {
    branch,
    date,
    today: cafeToday(),
    access: dayAccess(date, cafeToday(), { reviewer, signed }),
    day: d ? {
      ...d,
      updatedAt: timestampMs(d.updatedAt, 0) || null,
      signedAt: timestampMs(d.signedAt, 0) || null,
    } : null,
    units,
    limits,
    openingChecks,
    closingChecks,
    blockers: signed ? [] : signingBlockers(
      { opening: d?.opening ?? [], closing: d?.closing ?? [], readings: d?.readings ?? [] },
      { opening: openingChecks, closing: closingChecks },
      active,
      limits,
    ),
    signedLate: signed && typeof d?.signedOn === 'string' ? signedLate(date, d.signedOn) : false,
  }
}

export interface DaySummary {
  date: string
  recorded: boolean
  signed: boolean
  signedByEmail: string | null
  signedLate: boolean
  breaches: number
  notDone: number
  amendments: number
  problems: string
}

/**
 * A range of days for one branch. Read by document id — one getAll over the
 * dates — rather than a branch-and-date query, which would need a composite
 * index and gain nothing over a range this short.
 */
export async function readHistory(branch: string, from: string, to: string): Promise<{ days: DaySummary[]; missed: string[] }> {
  if (from > to) throw new HttpError(400, 'The first date is after the last one.')
  const dates: string[] = []
  for (let d = from; d && d <= to; d = addDays(d, 1)) {
    dates.push(d)
    if (dates.length > FOOD_SAFETY_TEXT.historyDays) {
      throw new HttpError(400, `Look at ${FOOD_SAFETY_TEXT.historyDays} days or fewer at a time.`)
    }
  }
  const db = adminDb()
  const [snaps, settings] = await Promise.all([
    db.getAll(...dates.map(d => dayRef(branch, d))),
    readFoodSafetySettings(),
  ])

  const days: DaySummary[] = snaps.map((snap, i) => {
    const d = snap.exists ? (snap.data() ?? {}) : null
    const signed = Boolean(d?.signedAt)
    const limits = signed ? readLimits(asRecord(d?.atSigning).limits) : settings.limits
    const readings = (d?.readings ?? []) as StoredReading[]
    const answers = [...((d?.opening ?? []) as StoredAnswer[]), ...((d?.closing ?? []) as StoredAnswer[])]
    return {
      date: dates[i],
      recorded: Boolean(d),
      signed,
      signedByEmail: signed ? String(d?.signedByEmail ?? '') : null,
      signedLate: signed && typeof d?.signedOn === 'string' ? signedLate(dates[i], d.signedOn) : false,
      breaches: readings.filter(r => r.tempC !== undefined && judgeReading(r.kind, r.tempC, limits)?.status === 'breach').length,
      notDone: answers.filter(a => !a.done).length,
      amendments: Array.isArray(d?.amendments) ? d.amendments.length : 0,
      problems: typeof d?.problems === 'string' ? d.problems : '',
    }
  })

  // Today is not missed yet — it is still being run.
  const lastClosed = addDays(cafeToday(), -1)
  const missed = missedDays(from, to < lastClosed ? to : lastClosed, days.filter(d => d.signed).map(d => d.date))
  return { days, missed }
}
