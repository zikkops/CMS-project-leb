// The accountant's journal (UPGRADE.md T7.15). Pure, asserted by
// verify:export; the read is shared/src/server/journal.ts and the page
// /admin/reports/journal. A plain CSV (owner's decision, T7.0), one line per
// account per journal, in dollars and in lira.
//
// One journal per café day and branch for its sales, and one for the refunds
// given that day, since a refund is a reversing entry on its own date (T7.4):
//
//   Dr Cash USD, Cash LBP     what the drawer kept: handed over less change, per currency
//   Dr Card clearing          card taken, with the tip on top
//   Dr Discounts              staff meals, item and check discounts (contra-revenue)
//   Cr Sales, by category     each line's price before any discount, without VAT
//   Cr Service charge         without VAT
//   Cr VAT output             the VAT inside the bill, goods and service
//   Cr Tips payable           card tips, owed to staff
//   Dr/Cr Rounding            what paying in whole notes and lira left over
//   Dr Till receipts not itemised   a check closed without payments recorded
//                                   (the `payments` switch off): the bill, so
//                                   the journal still balances and says why
//
// A refund reverses the sale's lines exactly, except the tip, which stays with
// the staff it was given to (gap 27). Every check balances to the cent in
// dollars and to the pound in lira, each on its own (a rounding line per
// currency), so every journal balances. Amounts are worked in whole cents and
// whole lira; lira at each check's own rate, and lira cash at what was counted.

import { checkTotals, grossLineTotal, type Check } from './checks'
import { refundOf } from './drawer'
import { vatIncluded } from './money'

export type AccountKey = 'cashUsd' | 'cashLbp' | 'card' | 'unitemised' | 'vat' | 'tips' | 'sales' | 'service' | 'discounts' | 'rounding'

export interface Account { code: string; name: string }

export interface AccountCodes {
  accounts: Record<AccountKey, Account>
  /** A code per menu category; one not listed posts to the sales account, named for its category. */
  categories: Record<string, string>
}

export const ACCOUNT_LABELS: Record<AccountKey, string> = {
  cashUsd: 'Cash in dollars', cashLbp: 'Cash in lira', card: 'Card clearing', unitemised: 'Till receipts not itemised',
  vat: 'VAT output', tips: 'Tips payable', sales: 'Sales', service: 'Service charge', discounts: 'Discounts', rounding: 'Rounding',
}

/** A common small-business layout. OWNER TO CONFIRM against the accountant's chart. */
export const DEFAULT_ACCOUNT_CODES: AccountCodes = {
  accounts: {
    cashUsd: { code: '1010', name: 'Cash on hand USD' },
    cashLbp: { code: '1011', name: 'Cash on hand LBP' },
    card: { code: '1020', name: 'Card clearing' },
    unitemised: { code: '1090', name: 'Till receipts not itemised' },
    vat: { code: '2210', name: 'VAT output' },
    tips: { code: '2220', name: 'Tips payable' },
    sales: { code: '4000', name: 'Sales' },
    service: { code: '4100', name: 'Service charge' },
    discounts: { code: '4900', name: 'Discounts' },
    rounding: { code: '6990', name: 'Rounding' },
  },
  categories: {},
}

const CODE = /^[A-Za-z0-9.\-]{1,20}$/

/** Stored codes, cleaned: a missing or malformed one falls back to the default, never to nothing. */
export function readAccountCodes(raw: unknown): AccountCodes {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const a = (r.accounts && typeof r.accounts === 'object' ? r.accounts : {}) as Record<string, unknown>
  const accounts = { ...DEFAULT_ACCOUNT_CODES.accounts }
  for (const key of Object.keys(accounts) as AccountKey[]) {
    const v = (a[key] ?? {}) as Record<string, unknown>
    const code = typeof v.code === 'string' && CODE.test(v.code.trim()) ? v.code.trim() : accounts[key].code
    const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 60) : accounts[key].name
    accounts[key] = { code, name }
  }
  const categories: Record<string, string> = {}
  const c = (r.categories && typeof r.categories === 'object' ? r.categories : {}) as Record<string, unknown>
  for (const [cat, code] of Object.entries(c)) {
    if (typeof code === 'string' && CODE.test(code.trim()) && cat.trim()) categories[cat.trim().slice(0, 60)] = code.trim()
  }
  return { accounts, categories }
}

/** An admin's codes, or the reason they are refused: a code the accountant cannot import is not saved quietly. */
export function accountCodesProblem(raw: unknown): string | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!r) return 'Send the account codes.'
  const a = (r.accounts && typeof r.accounts === 'object' ? r.accounts : {}) as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_ACCOUNT_CODES.accounts) as AccountKey[]) {
    const v = (a[key] ?? {}) as Record<string, unknown>
    if (typeof v.code !== 'string' || !CODE.test(v.code.trim())) return `${ACCOUNT_LABELS[key]}: a code is 1 to 20 letters, digits, dots or dashes.`
  }
  const c = (r.categories && typeof r.categories === 'object' ? r.categories : {}) as Record<string, unknown>
  for (const [cat, code] of Object.entries(c)) {
    if (code === '' || code === null) continue
    if (typeof code !== 'string' || !CODE.test(code.trim())) return `${cat}: a code is 1 to 20 letters, digits, dots or dashes.`
  }
  return null
}

/** One posting: + is a debit, − a credit, in cents and in whole lira. */
export interface Posting { key: AccountKey; category?: string; cents: number; lbp: number; tip?: boolean }

const OFF_MENU = 'No longer on the menu'

/**
 * A closed check's sale entry. Sales are split by the category of each line
 * NOW (the categories are the menu's), a retail product under "Retail".
 */
export function saleEntry(check: Check, categoryOf: Readonly<Record<string, string>>, fallbackRate: number): Posting[] {
  const t = checkTotals(check)
  const rate = check.billRate ?? fallbackRate
  const vr = typeof check.vatRate === 'number' ? check.vatRate : null
  const c = (usd: number) => Math.round(usd * 100)
  const toLbp = (cents: number) => Math.round((cents / 100) * rate)
  const B = c(t.net)
  const V = vr === null ? 0 : c(vatIncluded(t.net, vr))
  const serviceVat = vr === null ? 0 : c(vatIncluded(t.service, vr))
  const Sx = c(t.service) - serviceVat
  const Gx = B - V - Sx
  const out: Posting[] = []

  // Sales at each line's price before any discount, without VAT, by category.
  const byCat = new Map<string, number>()
  for (const line of check.lines ?? []) {
    const g = grossLineTotal(line)
    if (!g) continue
    const cat = line.source === 'product' ? 'Retail' : (categoryOf[line.refId] ?? OFF_MENU)
    byCat.set(cat, (byCat.get(cat) ?? 0) + (vr === null ? c(g) : Math.round(c(g) / (1 + vr))))
  }
  let D = [...byCat.values()].reduce((n, x) => n + x, 0) - Gx
  const discounted = t.discount + t.itemDiscounts + t.checkDiscount > 0
  if (!discounted && D !== 0 && byCat.size > 0) {
    // No discount on the check: what is left is VAT rounding line by line, not a discount.
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0][0]
    byCat.set(top, (byCat.get(top) as number) - D)
    D = 0
  }
  for (const [category, cents] of byCat) if (cents) out.push({ key: 'sales', category, cents: -cents, lbp: -toLbp(cents) })
  if (D) out.push({ key: 'discounts', cents: D, lbp: toLbp(D) })
  if (Sx) out.push({ key: 'service', cents: -Sx, lbp: -toLbp(Sx) })
  if (V) out.push({ key: 'vat', cents: -V, lbp: -toLbp(V) })

  // What was taken, per tender and currency, net of change.
  const payments = check.payments ?? []
  if (payments.length === 0) {
    out.push({ key: 'unitemised', cents: B, lbp: toLbp(B) })
  } else {
    const kept = refundOf(payments)
    const tips = c(payments.reduce((n, p) => n + (p.tender === 'card' ? Number(p.tipUsd) || 0 : 0), 0))
    if (kept.cash.usd) out.push({ key: 'cashUsd', cents: c(kept.cash.usd), lbp: toLbp(c(kept.cash.usd)) })
    if (kept.cash.lbp) out.push({ key: 'cashLbp', cents: Math.round((kept.cash.lbp / rate) * 100), lbp: kept.cash.lbp })
    const cardCents = c(kept.card.usd) + Math.round((kept.card.lbp / rate) * 100)
    if (cardCents) out.push({ key: 'card', cents: cardCents, lbp: toLbp(c(kept.card.usd)) + kept.card.lbp })
    if (tips) {
      out.push({ key: 'card', cents: tips, lbp: toLbp(tips), tip: true })
      out.push({ key: 'tips', cents: -tips, lbp: -toLbp(tips), tip: true })
    }
  }
  // Each currency balances on its own.
  const cents = out.reduce((n, p) => n + p.cents, 0)
  const lbp = out.reduce((n, p) => n + p.lbp, 0)
  if (cents || lbp) out.push({ key: 'rounding', cents: -cents, lbp: -lbp })
  return out
}

/** The refund's reversing entry: the sale's, every sign turned, the tip left with the staff. */
export function refundEntry(check: Check, categoryOf: Readonly<Record<string, string>>, fallbackRate: number): Posting[] {
  const sale = saleEntry(check, categoryOf, fallbackRate).filter(p => !p.tip)
  return sale.map(p => ({ ...p, cents: -p.cents, lbp: -p.lbp }))
}

export interface JournalLine {
  day: string
  journal: string
  branch: string
  code: string
  account: string
  description: string
  debitUsd: number
  creditUsd: number
  debitLbp: number
  creditLbp: number
  source: string
}

export interface Journal {
  journal: string
  day: string
  branch: string
  kind: 'sales' | 'refunds'
  checks: number
  debitUsd: number
  creditUsd: number
  debitLbp: number
  creditLbp: number
  balanced: boolean
}

export interface JournalExport { lines: JournalLine[]; journals: Journal[]; balanced: boolean }

/** A dated check's entry, ready to post: its day, branch and kind. */
export interface DatedEntry { day: string; branch: string; kind: 'sales' | 'refunds'; postings: Posting[] }

export function journalNumber(day: string, branch: string, kind: 'sales' | 'refunds'): string {
  return `J-${day.replace(/-/g, '')}-${branch.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'X'}-${kind === 'sales' ? 'S' : 'R'}`
}

/** The entries added up per journal and account, as the CSV's lines. */
export function buildJournal(entries: readonly DatedEntry[], codes: AccountCodes): JournalExport {
  const groups = new Map<string, { day: string; branch: string; kind: 'sales' | 'refunds'; checks: number; by: Map<string, { code: string; account: string; cents: number; lbp: number }> }>()
  for (const e of entries) {
    const j = journalNumber(e.day, e.branch, e.kind)
    const g = groups.get(j) ?? { day: e.day, branch: e.branch, kind: e.kind, checks: 0, by: new Map() }
    g.checks++
    for (const p of e.postings) {
      const base = codes.accounts[p.key]
      const code = p.key === 'sales' && p.category && codes.categories[p.category] ? codes.categories[p.category] : base.code
      const account = p.key === 'sales' && p.category ? `${base.name}: ${p.category}` : base.name
      const k = `${code}|${account}`
      const row = g.by.get(k) ?? { code, account, cents: 0, lbp: 0 }
      row.cents += p.cents
      row.lbp += p.lbp
      g.by.set(k, row)
    }
    groups.set(j, g)
  }
  const lines: JournalLine[] = []
  const journals: Journal[] = []
  for (const [journal, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const description = `${g.kind === 'sales' ? 'Sales' : 'Refunds given'} ${g.day} ${g.branch}`
    let dUsd = 0, cUsd = 0, dLbp = 0, cLbp = 0
    for (const row of [...g.by.values()].sort((a, b) => a.code.localeCompare(b.code) || a.account.localeCompare(b.account))) {
      if (!row.cents && !row.lbp) continue
      const line: JournalLine = {
        day: g.day, journal, branch: g.branch, code: row.code, account: row.account, description,
        debitUsd: row.cents > 0 ? row.cents / 100 : 0, creditUsd: row.cents < 0 ? -row.cents / 100 : 0,
        debitLbp: row.lbp > 0 ? row.lbp : 0, creditLbp: row.lbp < 0 ? -row.lbp : 0,
        source: 'POS',
      }
      dUsd += Math.max(row.cents, 0); cUsd += Math.max(-row.cents, 0); dLbp += Math.max(row.lbp, 0); cLbp += Math.max(-row.lbp, 0)
      lines.push(line)
    }
    journals.push({
      journal, day: g.day, branch: g.branch, kind: g.kind, checks: g.checks,
      debitUsd: dUsd / 100, creditUsd: cUsd / 100, debitLbp: dLbp, creditLbp: cLbp, balanced: dUsd === cUsd && dLbp === cLbp,
    })
  }
  return { lines, journals, balanced: journals.every(j => j.balanced) }
}

export const JOURNAL_COLUMNS: readonly [keyof JournalLine, string][] = [
  ['day', 'Date'], ['journal', 'Journal'], ['branch', 'Branch'], ['code', 'Account code'], ['account', 'Account name'],
  ['description', 'Description'], ['debitUsd', 'Debit USD'], ['creditUsd', 'Credit USD'], ['debitLbp', 'Debit LBP'],
  ['creditLbp', 'Credit LBP'], ['source', 'Source'],
]
