// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The journal's reads (UPGRADE.md T7.15): the checks that closed in the period
// (a sale entry each, on its close day, refunded or not), the checks refunded
// in it (a reversing entry each, on the refund's day), the menu's categories,
// and the account codes an admin set (`appSettings/accountCodes`, server-only:
// no Firestore rule reads it, so no rules deploy).

import { adminDb } from './firebaseAdmin'
import { readClosedChecks, readRefundedChecks, type ExportRequest } from './salesExport'
import { readSettings } from './settings'
import { closedAtParts, isExportable, refundedAtParts, type CutShort } from '../salesExport'
import {
  buildJournal, readAccountCodes, refundEntry, saleEntry,
  type AccountCodes, type DatedEntry, type JournalExport,
} from '../journal'
import type { Check } from '../checks'

export const ACCOUNT_CODES_DOC = 'appSettings/accountCodes'

/** Which category each menu item is in now, by the item's id. */
export async function readMenuCategories(): Promise<Record<string, string>> {
  const db = adminDb()
  const [items, categories] = await Promise.all([db.collection('menuItems').get(), db.collection('menuCategories').get()])
  const names = new Map(categories.docs.map(d => [d.id, String(d.data().name ?? '')]))
  const out: Record<string, string> = {}
  for (const d of items.docs) {
    const name = names.get(String(d.data().categoryId ?? ''))
    if (name) out[d.id] = name
  }
  return out
}

export async function readAccountCodesDoc(): Promise<AccountCodes> {
  const snap = await adminDb().doc(ACCOUNT_CODES_DOC).get()
  return readAccountCodes(snap.exists ? snap.data() : null)
}

export async function readJournal(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[] },
): Promise<JournalExport & { branches: string[]; cutShort: CutShort | null; codes: AccountCodes }> {
  const [closed, refunded, categoryOf, codes, settings] = await Promise.all([
    readClosedChecks(range, opts),
    readRefundedChecks(range, opts),
    readMenuCategories(),
    readAccountCodesDoc(),
    readSettings(),
  ])
  const entries: DatedEntry[] = []
  for (const check of closed.checks) {
    if (!isExportable(check)) continue
    entries.push({ day: closedAtParts(check.closedAt, opts.timeZone).day, branch: check.branch, kind: 'sales', postings: saleEntry(check, categoryOf, settings.exchangeRate) })
  }
  for (const check of refunded) {
    if (!isExportable(check)) continue
    const { day } = refundedAtParts(check as Check & { refundedAt?: unknown }, opts.timeZone)
    entries.push({ day, branch: check.branch, kind: 'refunds', postings: refundEntry(check, categoryOf, settings.exchangeRate) })
  }
  return { ...buildJournal(entries, codes), branches: closed.branches, cutShort: closed.cutShort, codes }
}
