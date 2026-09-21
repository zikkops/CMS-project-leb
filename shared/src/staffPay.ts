// Each person's hourly rate and tip weight (UPGRADE.md T7.18). Pure, asserted
// by verify:tips; the server is shared/src/server/staffPay.ts and the page is
// /admin/staff/pay.
//
// Every change takes effect from a date and the old values are kept, so last
// month's labour cost and tips are worked out with last month's rate and
// weight: the VAT rule again. A period already paid never changes because a
// rate changed today.
//
// A missing or nonsensical rate is "not set", never $0: the labour report says
// so rather than showing free labour. A missing weight is 1.0; a weight of 0
// takes the person out of the tips on purpose.

export type PayCurrency = 'USD' | 'LBP'

export interface PayEntry {
  /** The café day this takes effect, 'YYYY-MM-DD'. */
  from: string
  /** Per hour, in `currency`; null for not set. */
  hourlyRate: number | null
  currency: PayCurrency
  /** How much one shift of theirs counts in the tips split. */
  tipWeight: number
  setBy?: string
  setAt?: string
}

export const DEFAULT_TIP_WEIGHT = 1
export const MAX_TIP_WEIGHT = 5
const YMD = /^\d{4}-\d{2}-\d{2}$/

function validDay(s: unknown): s is string {
  if (typeof s !== 'string' || !YMD.test(s)) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** An admin's entry, cleaned, or the reason it is refused. Never quietly a default. */
export function readPayEntry(raw: unknown): Omit<PayEntry, 'setBy' | 'setAt'> | string {
  if (!raw || typeof raw !== 'object') return 'Send the pay details.'
  const r = raw as Record<string, unknown>
  if (!validDay(r.from)) return 'Choose the day this takes effect.'
  const currency = r.currency === 'LBP' ? 'LBP' : r.currency === 'USD' || r.currency === undefined ? 'USD' : null
  if (!currency) return 'The currency is USD or LBP.'
  let hourlyRate: number | null = null
  if (r.hourlyRate !== null && r.hourlyRate !== undefined && r.hourlyRate !== '') {
    const n = Number(r.hourlyRate)
    const max = currency === 'LBP' ? 100_000_000 : 10_000
    if (!Number.isFinite(n) || n < 0 || n > max) return 'The hourly rate is not a rate.'
    hourlyRate = currency === 'LBP' ? Math.round(n) : Math.round(n * 100) / 100
  }
  const w = r.tipWeight === undefined || r.tipWeight === '' ? DEFAULT_TIP_WEIGHT : Number(r.tipWeight)
  if (!Number.isFinite(w) || w < 0 || w > MAX_TIP_WEIGHT) return `The tip weight is between 0 and ${MAX_TIP_WEIGHT}.`
  return { from: r.from, hourlyRate, currency, tipWeight: Math.round(w * 100) / 100 }
}

/** Stored history, cleaned and in date order: anything malformed is left out, never guessed. */
export function readPayHistory(raw: unknown): PayEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PayEntry[] = []
  for (const e of raw) {
    const clean = readPayEntry(e)
    if (typeof clean === 'string') continue
    const r = e as Record<string, unknown>
    out.push({
      ...clean,
      ...(typeof r.setBy === 'string' ? { setBy: r.setBy } : {}),
      ...(typeof r.setAt === 'string' ? { setAt: r.setAt } : {}),
    })
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}

/** The history with this entry added; one taking effect the same day replaces the old one. */
export function withPayEntry(history: readonly PayEntry[], entry: PayEntry): PayEntry[] {
  return [...history.filter(e => e.from !== entry.from), entry].sort((a, b) => a.from.localeCompare(b.from))
}

/** What was in force on this café day, or null before the first entry. */
export function payOn(history: readonly PayEntry[], day: string): PayEntry | null {
  let found: PayEntry | null = null
  for (const e of [...history].sort((a, b) => a.from.localeCompare(b.from))) {
    if (e.from <= day) found = e
  }
  return found
}

export function tipWeightOn(history: readonly PayEntry[], day: string): number {
  return payOn(history, day)?.tipWeight ?? DEFAULT_TIP_WEIGHT
}

/** The hourly rate on this day, or null for not set (never 0 by default). */
export function hourlyRateOn(history: readonly PayEntry[], day: string): { rate: number; currency: PayCurrency } | null {
  const e = payOn(history, day)
  return e && e.hourlyRate !== null ? { rate: e.hourlyRate, currency: e.currency } : null
}

/**
 * Which staff member an End of Day attendance name means: the email or the
 * first name, ignoring case, and only when exactly one person matches. A guest
 * or an ambiguous first name matches nobody, and then counts at weight 1.0.
 */
export function matchStaffName(
  name: string,
  staff: readonly { uid: string; email: string; firstName: string }[],
): string | null {
  const n = name.trim().toLowerCase()
  if (!n) return null
  const byEmail = staff.filter(s => s.email.toLowerCase() === n)
  if (byEmail.length === 1) return byEmail[0].uid
  const byName = staff.filter(s => s.firstName.trim().toLowerCase() === n)
  return byName.length === 1 ? byName[0].uid : null
}
