// The receipt sequence report (UPGRADE.md T7.10): the audit trail that proves
// no sale went missing. Pure, asserted by verify:export; the read is
// shared/src/server/receiptSequence.ts.
//
// One counter numbers every receipt, retail sale and wholesale invoice, across every
// branch, restarting each café year (invoiceNumber.ts). So a sequence is
// judged whole, never per branch: a number used at another branch is not a gap.
// What another branch did is counted, never shown in detail.
//
// For each year seen in the period, every sequence from the lowest to the
// highest is one of:
//   used              a check or a retail sale at a branch the caller reads
//   used elsewhere    a check or a retail sale at another branch
//   wholesale         a wholesale order's invoice
//   issued, no record the log says it was issued and nothing carries it: a
//                     close that failed after its number, or an invoice drawn
//                     and never saved. Normal in accounting, and listed.
//   gap in hub block  reserved by a café hub (receiptBlocks.ts) and not come
//                     back: expected, since a hub skips what it never used,
//                     and named with the block
//   gap before the log never seen, and older than the first logged number of
//                     that year, so nothing can say whether it was issued
//   gap               never seen, and inside the logged span: must not happen
// and any sequence carried by more than one record is a DUPLICATE, which must
// be none.

export interface ReceiptUse {
  number: string
  kind: 'check' | 'retail' | 'wholesale'
  id: string
  branch: string
  day: string
}

export interface ReceiptIssue { year: number; sequence: number; number: string; purpose: string; day: string }

export interface ReceiptBlockRecord { year: number; first: number; last: number; branch: string; name: string }

export type SequenceStatus =
  | 'used' | 'used elsewhere' | 'wholesale' | 'issued, no record'
  | 'gap in hub block' | 'gap before the log' | 'gap'

export const SEQUENCE_STATUS_LABELS: Record<SequenceStatus, string> = {
  'used': 'On a check or retail sale',
  'used elsewhere': 'At another branch',
  'wholesale': 'On a wholesale invoice',
  'issued, no record': 'Issued, nothing carries it',
  'gap in hub block': 'Skipped in a hub block',
  'gap before the log': 'Not seen, before the log began',
  'gap': 'Missing',
}

export interface SequenceRow {
  year: number
  sequence: number
  status: SequenceStatus
  /** What carries it: check, retail or wholesale; blank for a gap. */
  kind: string
  /** Blank for a gap and for another branch's check. */
  number: string
  branch: string
  day: string
  id: string
  note: string
}

export interface SequenceGap { year: number; from: number; to: number; count: number; status: SequenceStatus; note: string }

export interface SequenceYear {
  year: number
  first: number
  last: number
  used: number
  usedElsewhere: number
  wholesale: number
  noRecord: number
  inHubBlocks: number
  beforeLog: number
  missing: number
  duplicates: number
}

export interface ReceiptSequenceReport {
  years: SequenceYear[]
  rows: SequenceRow[]
  gaps: SequenceGap[]
  duplicates: { year: number; sequence: number; uses: { number: string; kind: string; id: string; branch: string; day: string }[] }[]
  /** Receipt numbers not in the format, so not placed in any sequence. */
  unreadable: { number: string; kind: string; id: string }[]
  /** Rows were not listed past this many in a year; the counts are still whole. */
  rowsCutAt: number | null
}

/** The most rows a year lists; the counts and gaps are never cut. */
export const MAX_SEQUENCE_ROWS = 50_000

/**
 * The year and sequence a receipt number carries: `<prefix>-Q<n>-<MM><YYYY>-<seq>`
 * (formatInvoiceNumber()). The prefix may hold dashes, so it is read from the end.
 */
export function parseReceiptNumber(number: string): { year: number; sequence: number } | null {
  const m = /-Q[1-4]-(\d{2})(\d{4})-(\d+)$/.exec(String(number ?? '').trim())
  if (!m) return null
  const month = Number(m[1])
  const sequence = Number(m[3])
  if (month < 1 || month > 12 || !Number.isSafeInteger(sequence) || sequence < 1) return null
  return { year: Number(m[2]), sequence }
}

export function receiptSequence(
  uses: readonly ReceiptUse[],
  issues: readonly ReceiptIssue[],
  blocks: readonly ReceiptBlockRecord[],
  opts: { branches: readonly string[] },
): ReceiptSequenceReport {
  const mine = new Set(opts.branches)
  const byKey = new Map<string, ReceiptUse[]>()
  const unreadable: ReceiptSequenceReport['unreadable'] = []
  const key = (y: number, s: number) => `${y}:${s}`
  for (const u of uses) {
    const p = parseReceiptNumber(u.number)
    if (!p) { unreadable.push({ number: u.number, kind: u.kind, id: u.id }); continue }
    byKey.set(key(p.year, p.sequence), [...(byKey.get(key(p.year, p.sequence)) ?? []), u])
  }
  const issued = new Map<string, ReceiptIssue>()
  for (const i of issues) if (Number.isSafeInteger(i.year) && Number.isSafeInteger(i.sequence)) issued.set(key(i.year, i.sequence), i)

  const years = new Map<number, { first: number; last: number }>()
  const seen = (y: number, s: number) => {
    const r = years.get(y)
    years.set(y, r ? { first: Math.min(r.first, s), last: Math.max(r.last, s) } : { first: s, last: s })
  }
  for (const k of [...byKey.keys(), ...issued.keys()]) { const [y, s] = k.split(':').map(Number); seen(y, s) }

  const rows: SequenceRow[] = []
  const gaps: SequenceGap[] = []
  const duplicates: ReceiptSequenceReport['duplicates'] = []
  const outYears: SequenceYear[] = []
  let rowsCutAt: number | null = null

  for (const [year, span] of [...years.entries()].sort((a, b) => a[0] - b[0])) {
    // Reduced, not spread: a year can log more numbers than a call takes arguments.
    const logFloor = issues.reduce((m, i) => (i.year === year && i.sequence < m ? i.sequence : m), Infinity)
    const yearBlocks = blocks.filter(b => b.year === year)
    const y: SequenceYear = { year, first: span.first, last: span.last, used: 0, usedElsewhere: 0, wholesale: 0, noRecord: 0, inHubBlocks: 0, beforeLog: 0, missing: 0, duplicates: 0 }
    let listed = 0
    let open: SequenceGap | null = null
    const closeGap = () => { if (open) { gaps.push(open); open = null } }

    for (let seq = span.first; seq <= span.last; seq++) {
      const found = byKey.get(key(year, seq)) ?? []
      const log = issued.get(key(year, seq))
      let row: SequenceRow
      if (found.length > 0) {
        closeGap()
        if (found.length > 1) {
          y.duplicates++
          duplicates.push({ year, sequence: seq, uses: found.map(u => ({ number: u.number, kind: u.kind, id: u.id, branch: u.branch, day: u.day })) })
        }
        const u = found[0]
        const status: SequenceStatus = u.kind === 'wholesale' ? 'wholesale' : mine.has(u.branch) ? 'used' : 'used elsewhere'
        if (status === 'wholesale') y.wholesale++
        else if (status === 'used') y.used++
        else y.usedElsewhere++
        const hidden = status === 'used elsewhere'
        row = {
          year, sequence: seq, status, kind: u.kind, number: hidden ? '' : u.number, branch: u.branch, day: hidden ? '' : u.day, id: hidden ? '' : u.id,
          note: found.length > 1 ? `DUPLICATE: carried by ${found.length} records` : '',
        }
      } else if (log) {
        closeGap()
        y.noRecord++
        row = { year, sequence: seq, status: 'issued, no record', kind: '', number: log.number, branch: '', day: log.day, id: '', note: `issued for ${log.purpose}` }
      } else {
        const block = yearBlocks.find(b => seq >= b.first && seq <= b.last)
        const status: SequenceStatus = block ? 'gap in hub block' : seq < logFloor ? 'gap before the log' : 'gap'
        const note = block ? `${block.name || 'hub'} at ${block.branch}, block ${block.first}–${block.last}` : ''
        if (status === 'gap in hub block') y.inHubBlocks++
        else if (status === 'gap before the log') y.beforeLog++
        else y.missing++
        if (open && open.status === status && open.note === note && open.to === seq - 1) { open.to = seq; open.count++ }
        else { closeGap(); open = { year, from: seq, to: seq, count: 1, status, note } }
        row = { year, sequence: seq, status, kind: '', number: '', branch: block?.branch ?? '', day: '', id: '', note }
      }
      if (listed < MAX_SEQUENCE_ROWS) { rows.push(row); listed++ } else rowsCutAt = MAX_SEQUENCE_ROWS
    }
    closeGap()
    outYears.push(y)
  }

  return { years: outYears, rows, gaps, duplicates, unreadable, rowsCutAt }
}
