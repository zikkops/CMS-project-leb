// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Reads what the receipt sequence report needs for a period (UPGRADE.md
// T7.10): every check, retail sale and wholesale order that carries a number,
// the log of numbers issued, and the blocks reserved for café hubs. The
// sequence is one counter across every branch, so records are read for EVERY
// branch, whatever the caller may see: another branch's number is not a gap.
// receiptSequence() shows the caller's branches only, and counts the rest.
//
// Each read is ranged on one Timestamp field, a month at a time (readInChunks),
// then narrowed to the café days asked for.

import { adminDb } from './firebaseAdmin'
import { readInChunks, requestedBranches, type ExportRequest } from './salesExport'
import { RECEIPT_LOG } from './invoiceNumber'
import { closedAtParts, type CutShort } from '../salesExport'
import type { ReceiptBlockRecord, ReceiptIssue, ReceiptUse } from '../receiptSequence'

export async function readReceiptSequence(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<{ uses: ReceiptUse[]; issues: ReceiptIssue[]; blocks: ReceiptBlockRecord[]; branches: string[]; cutShort: CutShort | null }> {
  const branches = requestedBranches(range, [...opts.branches])
  const inRange = (value: unknown) => {
    const { day } = closedAtParts(value, opts.timeZone)
    return day && day >= range.from && day <= range.to ? day : ''
  }
  const [checks, retail, wholesale, log] = await Promise.all([
    readInChunks('checks', 'closedAt', range, opts.timeZone),
    readInChunks('productPurchaseOrders', 'createdAt', range, opts.timeZone),
    readInChunks('wholesaleOrders', 'createdAt', range, opts.timeZone),
    readInChunks(RECEIPT_LOG, 'issuedAt', range, opts.timeZone),
  ])
  const uses: ReceiptUse[] = []
  const add = (kind: ReceiptUse['kind'], docs: { id: string; data: Record<string, unknown> }[], numberField: string, dayField: string) => {
    for (const d of docs) {
      const number = d.data[numberField]
      const day = inRange(d.data[dayField])
      if (typeof number !== 'string' || !number || !day) continue
      uses.push({ number, kind, id: d.id, branch: String(d.data.branch ?? ''), day })
    }
  }
  add('check', checks.docs, 'receiptNumber', 'closedAt')
  add('retail', retail.docs, 'invoiceNumber', 'createdAt')
  add('wholesale', wholesale.docs, 'invoiceNumber', 'createdAt')

  const issues: ReceiptIssue[] = []
  for (const d of log.docs) {
    const day = inRange(d.data.issuedAt)
    if (!day) continue
    issues.push({
      year: Number(d.data.year), sequence: Number(d.data.sequence), number: String(d.data.number ?? ''),
      purpose: String(d.data.purpose ?? ''), day,
    })
  }

  // Blocks are few (one per 500 numbers a hub uses), so read by year alone.
  const years: number[] = []
  for (let y = Number(range.from.slice(0, 4)); y <= Number(range.to.slice(0, 4)); y++) years.push(y)
  const blockSnap = await adminDb().collection('hubReceiptBlocks').where('year', 'in', years).get()
  const blocks: ReceiptBlockRecord[] = blockSnap.docs.map(d => d.data()).map(b => ({
    year: Number(b.year), first: Number(b.first), last: Number(b.last), branch: String(b.branch ?? ''), name: String(b.name ?? ''),
  }))

  const cuts = [checks.cutShort, retail.cutShort, wholesale.cutShort, log.cutShort].filter((c): c is CutShort => c !== null)
  const cutShort = cuts.length ? cuts.reduce((a, b) => (b.completeThrough < a.completeThrough ? b : a)) : null
  return { uses, issues, blocks, branches, cutShort }
}
