// The periods and branches a report can be asked for (UPGRADE.md T7.1). Pure,
// asserted by verify:export; the picker is admin/app/components/ui/ReportRange.tsx
// and the server reads the same branch list through readBranchList().
//
// Every day here is a café day, 'YYYY-MM-DD', worked out from the café's own
// "today" (todayYmd in BRAND.locale.timezone). Weeks start on Monday, the
// accounting convention (ISO 8601); quarters are calendar quarters; the fiscal
// year is the calendar year (T7.0's default).

export type QuickPeriod =
  | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth'
  | 'thisQuarter' | 'lastQuarter' | 'yearToDate' | 'lastYear'

export const QUICK_PERIODS: readonly { key: QuickPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisQuarter', label: 'This quarter' },
  { key: 'lastQuarter', label: 'Last quarter' },
  { key: 'yearToDate', label: 'Year to date' },
  { key: 'lastYear', label: 'Last year' },
]

const d = (ymd: string) => new Date(`${ymd}T12:00:00Z`)
const ymd = (t: Date) => t.toISOString().slice(0, 10)

export function addDays(day: string, n: number): string {
  return ymd(new Date(d(day).getTime() + n * 86_400_000))
}

/** The number of café days from `from` to `to`, both included. */
export function dayCount(from: string, to: string): number {
  return Math.round((d(to).getTime() - d(from).getTime()) / 86_400_000) + 1
}

function monthStart(day: string, offset = 0): string {
  const t = d(day)
  return ymd(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1, 12)))
}

/** A quick pick as a from–to pair, from the café's today. "This …" periods end today, never in the future. */
export function quickRange(key: QuickPeriod, today: string): { from: string; to: string } {
  const t = d(today)
  const monday = addDays(today, -((t.getUTCDay() + 6) % 7))
  const q = Math.floor(t.getUTCMonth() / 3)
  const year = t.getUTCFullYear()
  switch (key) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y } }
    case 'thisWeek': return { from: monday, to: today }
    case 'lastWeek': return { from: addDays(monday, -7), to: addDays(monday, -1) }
    case 'thisMonth': return { from: monthStart(today), to: today }
    case 'lastMonth': return { from: monthStart(today, -1), to: addDays(monthStart(today), -1) }
    case 'thisQuarter': return { from: ymd(new Date(Date.UTC(year, q * 3, 1, 12))), to: today }
    case 'lastQuarter': {
      const start = new Date(Date.UTC(year, q * 3 - 3, 1, 12))
      return { from: ymd(start), to: addDays(ymd(new Date(Date.UTC(year, q * 3, 1, 12))), -1) }
    }
    case 'yearToDate': return { from: `${year}-01-01`, to: today }
    case 'lastYear': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
  }
}

/** The same days a year earlier, for comparison. 29 February becomes the 28th. */
export function sameRangeLastYear(from: string, to: string): { from: string; to: string } {
  const back = (day: string) => {
    const [y, m, dd] = day.split('-').map(Number)
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate()
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`
  }
  return { from: back(from), to: back(to) }
}

/**
 * Which branches a request means: '' or 'all' is every branch the person may
 * see; otherwise a comma list, each of which must be theirs. The answer is in
 * the café's own branch order, without repeats. A branch that is not theirs is
 * the reason it is refused, never quietly dropped.
 */
export function readBranchList(raw: string | null | undefined, own: readonly string[]): string[] | string {
  const text = (raw ?? '').trim()
  if (text === '' || text === 'all') return [...own]
  const asked = [...new Set(text.split(',').map(s => s.trim()).filter(Boolean))]
  const stranger = asked.find(b => !own.includes(b))
  if (stranger) return `${stranger} is not one of your branches.`
  return own.filter(b => asked.includes(b))
}
