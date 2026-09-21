// Menus by time of day and happy-hour prices (UPGRADE.md T5.12).
//
// A menu item may carry `hours` (when it is served at all: breakfast until
// 11:30) and `priceRules` (a different price in a window: cocktails at $5 from
// 17:00 to 19:00 on weekdays). Both are judged in the café's zone, from the
// café's clock, on the server when the line is added. The till shows the same
// answer from the same functions, but the server's is the one that is charged.
//
// A window whose end is before its start runs past midnight: 22:00–02:00 on
// Friday covers Friday night into Saturday morning, and the small hours belong
// to the night they started, as the café's day does.
//
// Pure, no imports, so verify:checks asserts it.

export interface TimeWindow {
  /** 0 Sunday … 6 Saturday. Empty never matches. */
  days: number[]
  /** 'HH:MM', 24-hour. */
  from: string
  to: string
}

export interface PriceRule extends TimeWindow {
  price: number
  /** What the till and the receipt call it: "Happy hour". */
  label: string
}

/** The café's wall clock at an instant: the fields zonedParts() in dates.ts gives. */
export interface WallClock { year: number; month: number; day: number; hour: number; minute: number }

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const minutes = (hhmm: string): number => {
  const m = HHMM.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN
}

function weekday(c: WallClock): number {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay()
}

/** Whether this wall-clock time falls in the window. */
export function inWindow(w: TimeWindow, c: WallClock): boolean {
  const from = minutes(w.from)
  const to = minutes(w.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false
  const now = c.hour * 60 + c.minute
  const day = weekday(c)
  if (from < to) return w.days.includes(day) && now >= from && now < to
  // Past midnight: the evening part on a listed day, or the small hours of
  // the day after one.
  return (w.days.includes(day) && now >= from) || (w.days.includes((day + 6) % 7) && now < to)
}

/** The price at this time: the first rule whose window it is in, else the item's own. */
export function priceAt(base: number, rules: readonly PriceRule[] | null | undefined, c: WallClock): { price: number; rule: string | null } {
  const rule = (rules ?? []).find(r => inWindow(r, c))
  return rule ? { price: rule.price, rule: rule.label } : { price: base, rule: null }
}

/** Whether an item is served at this time. No hours: always. */
export function servedAt(hours: TimeWindow | null | undefined, c: WallClock): boolean {
  return !hours || inWindow(hours, c)
}

/** "Mon, Tue, Fri 17:00–19:00" or "every day 07:00–11:30", to read inside a sentence. */
export function describeWindow(w: TimeWindow): string {
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = [...new Set(w.days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  const every = days.length === 7
  return `${every ? 'every day' : days.map(d => NAMES[d]).join(', ')} ${w.from}–${w.to}`
}

// ── Reading what an admin sent, or what is stored ─────────────────────────

function readWindow(raw: unknown, what: string): TimeWindow | string {
  if (!raw || typeof raw !== 'object') return `${what}: not a time window.`
  const r = raw as Record<string, unknown>
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort() : []
  if (days.length === 0) return `${what}: choose at least one day.`
  const from = String(r.from ?? '')
  const to = String(r.to ?? '')
  if (!HHMM.test(from) || !HHMM.test(to)) return `${what}: times are HH:MM, 24-hour.`
  if (from === to) return `${what}: the start and the end are the same time.`
  return { days, from, to }
}

export const MAX_PRICE_RULES = 6

/** An admin's price rules, cleaned, or the reason they are refused. */
export function readPriceRules(raw: unknown): PriceRule[] | string {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return 'Price rules are a list.'
  if (raw.length > MAX_PRICE_RULES) return `At most ${MAX_PRICE_RULES} price rules on one item.`
  const out: PriceRule[] = []
  for (const [i, r] of raw.entries()) {
    const w = readWindow(r, `Price rule ${i + 1}`)
    if (typeof w === 'string') return w
    const price = Number((r as Record<string, unknown>).price)
    if (!Number.isFinite(price) || price < 0 || price > 100_000) return `Price rule ${i + 1}: the price is not a price.`
    const label = String((r as Record<string, unknown>).label ?? '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'Happy hour'
    out.push({ ...w, price: Math.round(price * 100) / 100, label })
  }
  return out
}

/** An admin's serving hours, cleaned; null for "always"; or the reason they are refused. */
export function readHours(raw: unknown): TimeWindow | null | string {
  if (raw === undefined || raw === null || raw === '') return null
  return readWindow(raw, 'Serving hours')
}

/** Stored rules as the till and the server use them: anything malformed is left out, never guessed. */
export function storedPriceRules(raw: unknown): PriceRule[] {
  if (!Array.isArray(raw)) return []
  return raw.map(r => readPriceRules([r])).filter((r): r is PriceRule[] => Array.isArray(r)).map(r => r[0])
}

/**
 * Stored hours. Malformed reads as always served: a dish hidden by a broken
 * setting cannot be sold at all, while one served outside its hours is the
 * smaller mistake, and the admin page shows the hours as unset.
 */
export function storedHours(raw: unknown): TimeWindow | null {
  const h = readHours(raw)
  return typeof h === 'string' ? null : h
}
