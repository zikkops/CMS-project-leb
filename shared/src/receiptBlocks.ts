// Receipt numbers for a café hub — POS software, stage 4.
//
// Owner's decision (S9, 14 Sep 2026): the cloud hands a hub receipt numbers in
// blocks of 500, and the hub asks for the next block while it is online, once
// fewer than 100 are left.
//
// ── Why blocks ─────────────────────────────────────────────────────────────
// A receipt number is the one thing two tills must never share, and a hub has
// to close checks with no internet. So the cloud reserves a run of numbers off
// the very counter it issues its own from (appSettings/invoiceCounter), in one
// transaction: the cloud's next close starts after the block, and the hub
// numbers its closes from inside it. Numbers a hub never uses are skipped.
// That leaves gaps, which accounting accepts; a duplicate it does not.
//
// ── A block belongs to one café year ───────────────────────────────────────
// The sequence restarts every year (invoicePeriod), and the number printed
// carries the month and year it was issued in. A block from last year used in
// January would print numbers the cloud will issue again later this year, so
// a hub never numbers a receipt from another year's block. Offline across New
// Year, it refuses to close until it can fetch this year's first block.
//
// Pure, and asserted by verify:hub-sync.

export const RECEIPT_BLOCK_SIZE = 500
export const RECEIPT_REFILL_AT = 100

export interface ReceiptBlock {
  year: number
  first: number
  last: number
  /** The next sequence to issue; last + 1 once used up. */
  next: number
}

const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/**
 * A block reserved off the shared counter, and what the counter becomes.
 *
 * The same reading of the counter as issueInvoiceNumber(): a counter for
 * another year starts again at 1, and `nextNumber` is the last number given
 * out. So the cloud's next close after this is `last + 1`.
 */
export function reserveBlock(
  counter: { year?: unknown; nextNumber?: unknown } | undefined,
  year: number,
  size = RECEIPT_BLOCK_SIZE,
): { block: ReceiptBlock; counter: { year: number; nextNumber: number } } {
  const base = counter && counter.year === year && whole(counter.nextNumber) && counter.nextNumber > 0 ? counter.nextNumber : 0
  const first = base + 1
  const last = base + size
  return { block: { year, first, last, next: first }, counter: { year, nextNumber: last } }
}

/** The blocks a hub holds, read defensively: anything malformed is not a block, and so issues nothing. */
export function readBlocks(raw: unknown): ReceiptBlock[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((b): b is ReceiptBlock => Boolean(b) && typeof b === 'object'
      && whole((b as ReceiptBlock).year) && whole((b as ReceiptBlock).first) && whole((b as ReceiptBlock).last)
      && whole((b as ReceiptBlock).next)
      && (b as ReceiptBlock).first >= 1 && (b as ReceiptBlock).first <= (b as ReceiptBlock).last
      && (b as ReceiptBlock).next >= (b as ReceiptBlock).first && (b as ReceiptBlock).next <= (b as ReceiptBlock).last + 1)
    .map(b => ({ year: b.year, first: b.first, last: b.last, next: b.next }))
}

/** How many numbers are left to close checks with this year. */
export function receiptsLeft(blocks: readonly ReceiptBlock[], year: number): number {
  return blocks.filter(b => b.year === year).reduce((n, b) => n + Math.max(0, b.last - b.next + 1), 0)
}

/** Whether the hub should ask the cloud for another block while it can. */
export function needsReceipts(blocks: readonly ReceiptBlock[], year: number): boolean {
  return receiptsLeft(blocks, year) < RECEIPT_REFILL_AT
}

export type TakeResult =
  | { ok: true; sequence: number; blocks: ReceiptBlock[] }
  | { ok: false; reason: string }

/**
 * The next receipt number, from the oldest block of this year with any left.
 *
 * The blocks returned keep this year's, used-up ones included, and drop other
 * years'. Keeping a used-up block is what lets the next refusal say "used all
 * its numbers" rather than "has none for this year yet", which would send
 * somebody looking for a problem with New Year. addBlock() drops it once a
 * new block arrives.
 */
export function takeReceipt(blocks: readonly ReceiptBlock[], year: number): TakeResult {
  const usable = blocks.filter(b => b.year === year && b.next <= b.last).sort((a, b) => a.first - b.first)
  if (usable.length === 0) {
    return {
      ok: false,
      reason: blocks.some(b => b.year === year)
        ? 'This hub has used all its receipt numbers. It gets more as soon as it is online; until then checks stay open.'
        : 'This hub has no receipt numbers for this year yet. It gets them as soon as it is online; until then checks stay open.',
    }
  }
  const [current] = usable
  const kept = blocks
    .filter(b => b.year === year)
    .map(b => (b.first === current.first ? { ...b, next: b.next + 1 } : { ...b }))
    .sort((a, b) => a.first - b.first)
  return { ok: true, sequence: current.next, blocks: kept }
}

/** A new block added to what the hub holds. Blocks from other years, and used-up ones, are dropped. */
export function addBlock(blocks: readonly ReceiptBlock[], block: ReceiptBlock): ReceiptBlock[] {
  return [...blocks.filter(b => b.year === block.year && b.next <= b.last), block].sort((a, b) => a.first - b.first)
}
