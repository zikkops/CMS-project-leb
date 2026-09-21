// The kitchen ticket as paper.
//
// receipt.ts builds the document a CUSTOMER is handed. This builds the one a
// COOK reads, and they are not the same document with different fields — they
// have opposite priorities. A receipt exists so a figure can be checked, which
// is why receiptToText() will wrap a long name rather than let a price fall off
// the line. A ticket has no figures at all: it exists so somebody standing at a
// pass, mid-service, under noise, can tell in about a second what to make and
// for which table.
//
// So the quantity leads every line, modifiers sit indented under the item in
// words rather than codes, and the table number is the largest thing on the
// paper after the station.
//
// ── Why this can be built before the printer is chosen ─────────────────────
// It produces rows, and receiptToText() lays rows out at a roll width. Both
// candidate transports — Epson ePOS-Print from the browser, Star CloudPRNT
// polling out — take exactly that text. Whichever the café turns out to have
// consumes this rather than laying a ticket out a second time, which is the
// same bet receipt.ts already makes.
//
// The row model is shared and named ReceiptRow for its first user rather than
// for the concept. It is a paper row; a ticket is paper too.

import type { ReceiptRow } from './receipt'
import { RECEIPT_WIDTHS, receiptToText } from './receipt'
import type { Ticket, TicketLine } from './tickets'

export interface TicketDocOptions {
  /** Shown small at the foot, so a ticket found on the floor is identifiable. */
  businessName?: string
  /**
   * When the ticket was sent, as an ISO string or ms. The pass judges waiting
   * time from paper when a screen is not in front of it.
   */
  sentAt: string | number
  /** Who sent it. A question about a ticket has to reach somebody. */
  sentBy: string
  /** Defaults to Asia/Beirut via the caller; the doc only formats what it gets. */
  timeZone?: string
  locale?: string
  /** A copy asked for again (UPGRADE.md T3.6): says so at the top, so nobody cooks it twice. */
  reprint?: boolean
}

function clockTime(at: string | number, locale: string, timeZone?: string): string {
  const d = typeof at === 'number' ? new Date(at) : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).format(d)
}

/**
 * A line as it prints.
 *
 * Voided lines are kept rather than dropped, because the cook may already be
 * making one. `tickets.ts` says the same about the screen: "Struck off after
 * the ticket was sent. Shown, not removed." Paper cannot strike through, so
 * the word does the work and it goes in FRONT of the name — a cook scanning
 * the left edge sees VOID before reading the item, which is the only order
 * that helps.
 */
function lineRows(line: TicketLine): ReceiptRow[] {
  const rows: ReceiptRow[] = []
  const qty = String(line.quantity)

  rows.push({
    kind: 'left',
    text: line.voided ? `VOID  ${qty}  ${line.name}` : `${qty}  ${line.name}`,
  })

  // Everything below the item is indented, so the eye can separate "what" from
  // "how" without reading either.
  if (line.modifiers) rows.push({ kind: 'left', text: `      ${line.modifiers}` })
  if (line.note) rows.push({ kind: 'left', text: `      ${line.note}` })

  const where: string[] = []
  if (line.seat !== null) where.push(`seat ${line.seat}`)
  if (line.course !== null) where.push(`course ${line.course}`)
  if (where.length > 0) rows.push({ kind: 'left', text: `      ${where.join(' · ')}` })

  return rows
}

/**
 * The ticket, as rows.
 *
 * Unlike buildReceipt() this refuses nothing. A receipt without a number is
 * not a receipt, so that one throws — but a ticket with no lines is still a
 * ticket worth printing, because "everything on round 2 was voided" is
 * information the pass needs. It prints and says so.
 */
export function buildTicketDoc(ticket: Ticket, opts: TicketDocOptions): ReceiptRow[] {
  const locale = opts.locale ?? 'en-US'
  const rows: ReceiptRow[] = []

  rows.push({ kind: 'center', text: ticket.station.toUpperCase(), strong: true })
  // "TABLE 12", or "TAKEAWAY: RANA" (UPGRADE.md T5.5); an older ticket has no label.
  rows.push({ kind: 'center', text: (ticket.orderLabel ?? `Table ${ticket.tableNumber}`).toUpperCase(), strong: true })
  if (opts.reprint) rows.push({ kind: 'center', text: '** REPRINT, NOT A NEW ORDER **', strong: true })

  // Round 1 is the first send and needs no label. Anything after it does: a
  // second ticket for the same table is an ADDITION, and a cook who reads it
  // as a duplicate makes the food twice.
  if (ticket.round > 1) {
    rows.push({ kind: 'center', text: `ROUND ${ticket.round}` , strong: true })
  }

  const time = clockTime(opts.sentAt, locale, opts.timeZone)
  if (time) rows.push({ kind: 'center', text: time })

  rows.push({ kind: 'rule' })

  const live = ticket.lines.filter(l => !l.voided)
  if (live.length === 0 && ticket.lines.length > 0) {
    rows.push({ kind: 'center', text: 'ALL ITEMS VOIDED', strong: true })
    rows.push({ kind: 'blank' })
  }
  for (const line of ticket.lines) {
    rows.push(...lineRows(line))
  }
  if (ticket.lines.length === 0) {
    rows.push({ kind: 'center', text: 'NO ITEMS' })
  }

  rows.push({ kind: 'rule' })
  rows.push({ kind: 'left', text: opts.sentBy })
  if (opts.businessName) {
    rows.push({ kind: 'blank' })
    rows.push({ kind: 'center', text: opts.businessName })
  }

  return rows
}

/** The ticket as text at a roll width. Same layout engine as the receipt. */
export function ticketToText(
  ticket: Ticket,
  opts: TicketDocOptions,
  width: number = RECEIPT_WIDTHS.narrow,
): string {
  return receiptToText(buildTicketDoc(ticket, opts), width)
}
