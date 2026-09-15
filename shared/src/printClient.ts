'use client'

// Sending a laid-out document to a printer, from the browser.
//
// One function — printText() — and a switch over the transport. That switch is
// the whole seam: when the café's hardware is known, one arm of it gets an
// implementation and nothing above it changes. buildTicketDoc() and
// buildReceipt() already produce the text; printing.ts already says which
// station prints at what width. This is the last step.
//
// ── Why it lives in the browser and not on the server ─────────────────────
// A cloud host cannot reach a printer behind the café's router. Both real
// options run at the café's end: ePOS is a POST from a device on the same
// wifi, CloudPRNT is the printer collecting from a URL. Only the first is
// something this file can do, and the second is deliberately left as a stub
// that says so rather than a silent no-op.
//
// ── Why nothing here throws ───────────────────────────────────────────────
// A printer that is off, unplugged or out of paper must not stop an order
// reaching the kitchen. The screen is the source of truth; paper is a
// convenience on top of it. So every path returns a result describing what
// happened and the caller decides whether to mention it — a POS that refuses
// to send because a printer did not answer is worse than one that never
// printed.

import type { StationPrinter } from './printing'
import { printerBlockedReason } from './printing'

export interface PrintResult {
  printed: boolean
  /** Why not, in words. Null when it printed. */
  reason: string | null
}

const ok = (): PrintResult => ({ printed: true, reason: null })
const no = (reason: string): PrintResult => ({ printed: false, reason })

/**
 * Print monospaced text on this device's own printer.
 *
 * Deliberately an iframe rather than window.print(). Printing the current
 * document would need a print stylesheet that hides the whole KDS, and the
 * moment a ticket prints automatically that stylesheet is fighting a screen
 * somebody is still using. An offscreen iframe has nothing on it but the
 * ticket, so there is nothing to hide.
 *
 * The font must be monospaced and the whitespace preserved: receiptToText()
 * has already aligned every column by counting characters, and a proportional
 * font throws all of that away.
 */
function printViaBrowser(text: string, copies: number): Promise<PrintResult> {
  return new Promise(resolve => {
    if (typeof document === 'undefined') {
      resolve(no('Nothing to print from — this ran on the server.'))
      return
    }

    const frame = document.createElement('iframe')
    // Not display:none — a hidden iframe does not always get a layout, and a
    // frame with no layout prints a blank page in some browsers.
    frame.setAttribute('aria-hidden', 'true')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.opacity = '0'
    frame.style.border = 'none'
    document.body.appendChild(frame)

    const cleanup = () => {
      // After a tick: removing the frame during its own print event cancels
      // the job in some browsers.
      window.setTimeout(() => frame.remove(), 1000)
    }

    try {
      const doc = frame.contentDocument
      if (!doc) { frame.remove(); resolve(no('The browser refused a print frame.')); return }

      const body = escapeHtml(text)
      doc.open()
      doc.write(
        '<!doctype html><html><head><meta charset="utf-8"><style>' +
        '@page { margin: 3mm; }' +
        'body { margin: 0; }' +
        'pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;' +
        ' font-size: 12px; line-height: 1.25; white-space: pre; margin: 0; }' +
        '.copy { page-break-after: always; }' +
        '.copy:last-child { page-break-after: auto; }' +
        '</style></head><body>' +
        Array.from({ length: Math.max(1, copies) },
          () => `<div class="copy"><pre>${body}</pre></div>`).join('') +
        '</body></html>',
      )
      doc.close()

      const win = frame.contentWindow
      if (!win) { frame.remove(); resolve(no('The browser refused a print frame.')); return }

      win.focus()
      win.print()
      cleanup()
      // print() returns as soon as the dialog is dismissed and tells us
      // nothing about whether paper came out. "Handed to the browser" is the
      // strongest true statement available, so it is the one made.
      resolve(ok())
    } catch (err) {
      frame.remove()
      resolve(no(err instanceof Error ? err.message : 'The print failed.'))
    }
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Print already-laid-out text on a station's printer.
 *
 * @param text  output of receiptToText() / ticketToText() — already wrapped to
 *              the roll width, so this must not re-wrap or re-align anything
 * @param printer  the station's configuration from printing.ts
 */
export async function printText(text: string, printer: StationPrinter): Promise<PrintResult> {
  const blocked = printerBlockedReason(printer)
  if (blocked) return no(blocked)

  switch (printer.transport) {
    case 'browser':
      return printViaBrowser(text, printer.copies)

    // ── Not yet implemented, and saying so ────────────────────────────────
    // Both need the hardware in the room: ePOS needs the device's address and
    // its exact service path, CloudPRNT needs a queue endpoint the printer is
    // pointed at. Returning a reason rather than pretending to succeed is what
    // keeps "the ticket did not print" from looking like "the ticket did not
    // send".
    case 'epos':
      return no('ePOS is not wired up yet — needs the printer model to finish.')
    case 'cloudprnt':
      return no('CloudPRNT is not wired up yet — the printer collects from a queue that does not exist.')

    // The café hub prints to these itself (S28, server/hubPrinting.ts). A
    // screen printing too would put every ticket on the pass twice.
    case 'network':
      return no('This station prints from the counter PC (café hub), not from a screen.')

    case 'none':
    default:
      return no('No printer set up for this station.')
  }
}
