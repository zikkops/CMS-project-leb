// Printer configuration, and the seam every transport will meet.
//
// The make and model are not decided, and this is written so that they do not
// have to be. Everything a print needs EXCEPT the last step — how bytes reach
// a device — is settled here, so choosing the hardware becomes one
// implementation rather than a redesign.
//
// ── Why the transport cannot just be "the server sends it" ─────────────────
// The obvious design, and the one the phase plan wrote down, is a route
// handler opening a socket to a printer on the café's LAN. That does not work
// from a cloud host: the printer sits behind the café's router, has no public
// address, and nothing outside can reach in. This is not a limitation to work
// around later; it is the fact that decides the two remaining options, and
// both of them run at the café's end rather than ours:
//
//   BROWSER PUSH   (Epson ePOS-Print)  a device on the café wifi POSTs to the
//                                      printer's own HTTP endpoint
//   PRINTER PULL   (Star CloudPRNT)    the printer polls a URL of ours and
//                                      collects whatever is waiting
//
// They differ in who initiates, which is why `transport` below is the only
// thing that changes between them. Everything above it — which station prints
// what, at what width, in which language — is identical either way, and is
// what this file settles.
//
// ── Fail-safe, and why it matters more here than elsewhere ────────────────
// A printer that is off, unplugged or out of paper must never stop an order
// reaching the kitchen. The screen is the source of truth and paper is a
// convenience on top of it; a POS that refuses to send because a printer did
// not answer is worse than one that never printed at all. So every failure in
// this path is reported and swallowed, never thrown into the send.

import { STATIONS, type Station } from './checks'
import { RECEIPT_WIDTHS, type ReceiptWidth } from './receipt'

export const PRINTING_DOC = 'appSettings/printing'

/**
 * How bytes reach a device.
 *
 * 'none' is the honest default and the state every café starts in: nothing is
 * wired up, and the app says so rather than silently dropping jobs.
 *
 * 'browser' is not a placeholder for the other two — it is a real answer for a
 * station that already has a screen. The device showing the KDS prints to
 * whatever printer it is attached to, which needs no thermal hardware, no
 * network configuration and no decision. It is enough to pilot on.
 */
export type PrintTransport = 'none' | 'browser' | 'epos' | 'cloudprnt'

export const PRINT_TRANSPORTS: PrintTransport[] = ['none', 'browser', 'epos', 'cloudprnt']

export const TRANSPORT_LABEL: Record<PrintTransport, string> = {
  none:      'Not set up',
  browser:   'This device’s printer',
  epos:      'Epson ePOS-Print (over the café wifi)',
  cloudprnt: 'Star CloudPRNT (printer collects)',
}

/** What a station prints, and how. */
export interface StationPrinter {
  /** Off means this station does not print at all. The screen still works. */
  enabled: boolean
  transport: PrintTransport
  /**
   * Columns on the roll. 58mm paper is 32 and 80mm is 42 — the two the
   * document layer already lays out for.
   */
  width: ReceiptWidth
  /**
   * Where to reach the printer. Meaning depends on the transport:
   *   epos       the device's own address, e.g. http://192.168.1.50/cgi-bin/epos/service.cgi
   *   cloudprnt  ignored — the printer is given OUR url, not the other way round
   *   browser    ignored
   * Empty until somebody has the hardware in front of them.
   */
  address: string
  /** Copies. Two is common where a pass and a line cook both need one. */
  copies: number
}

export interface PrintingSettings {
  /**
   * Per station, per branch. A branch id maps to its stations; a branch with
   * no entry has no printers, which is the correct answer for a branch that
   * has not been set up rather than an error.
   */
  branches: Record<string, Record<Station, StationPrinter>>
  /**
   * Print the customer receipt when a check closes.
   *
   * Off during the pilot: the old till is still taking payment, so it is the
   * one issuing receipts, and two receipts for one table is worse than none.
   */
  receiptOnClose: boolean
  /** Which station's printer the receipt goes to, when the above is on. */
  receiptStation: Station
}

export const PRINTER_DEFAULT: StationPrinter = {
  enabled: false,
  transport: 'none',
  width: RECEIPT_WIDTHS.narrow,
  address: '',
  copies: 1,
}

export const PRINTING_DEFAULTS: PrintingSettings = {
  branches: {},
  receiptOnClose: false,
  receiptStation: 'Bar',
}

const MAX_COPIES = 5

function readPrinter(raw: unknown): StationPrinter {
  const d = (raw ?? {}) as Record<string, unknown>
  const transport = PRINT_TRANSPORTS.includes(d.transport as PrintTransport)
    ? d.transport as PrintTransport
    : PRINTER_DEFAULT.transport

  const width = d.width === RECEIPT_WIDTHS.wide ? RECEIPT_WIDTHS.wide : RECEIPT_WIDTHS.narrow

  const copies = Number(d.copies)
  return {
    // A printer with no transport is not enabled however the flag reads. This
    // is the difference between "somebody ticked the box" and "there is
    // something to print to", and only the second one should make the app try.
    enabled: d.enabled === true && transport !== 'none',
    transport,
    width,
    address: typeof d.address === 'string' ? d.address.trim().slice(0, 300) : '',
    copies: Number.isInteger(copies) && copies >= 1 && copies <= MAX_COPIES ? copies : 1,
  }
}

/**
 * Read the stored document, with every field defaulted.
 *
 * Same rule as businessSettings.parseSettings: a missing or malformed document
 * gives the defaults rather than throwing. Nothing about printing should be
 * able to take the POS down.
 */
export function parsePrintingSettings(
  data: Record<string, unknown> | undefined,
): PrintingSettings {
  const d = data ?? {}
  const rawBranches = (d.branches ?? {}) as Record<string, unknown>

  const branches: PrintingSettings['branches'] = {}
  for (const [branch, stations] of Object.entries(rawBranches)) {
    const s = (stations ?? {}) as Record<string, unknown>
    branches[branch] = Object.fromEntries(
      STATIONS.map(station => [station, readPrinter(s[station])]),
    ) as Record<Station, StationPrinter>
  }

  const receiptStation = STATIONS.includes(d.receiptStation as Station)
    ? d.receiptStation as Station
    : PRINTING_DEFAULTS.receiptStation

  return {
    branches,
    receiptOnClose: d.receiptOnClose === true,
    receiptStation,
  }
}

/** The printer for a station at a branch, or the disabled default. */
export function printerFor(
  settings: PrintingSettings,
  branch: string,
  station: Station,
): StationPrinter {
  return settings.branches[branch]?.[station] ?? PRINTER_DEFAULT
}

/** Every station at a branch that would actually print something. */
export function activeStations(settings: PrintingSettings, branch: string): Station[] {
  return STATIONS.filter(s => printerFor(settings, branch, s).enabled)
}

/**
 * Why a printer will not print, in words for the person configuring it.
 *
 * Returns null when it is ready. Written as a reason rather than a boolean
 * because "it is not working" is the least useful thing a settings page can
 * say, and every one of these has a different fix.
 */
export function printerBlockedReason(printer: StationPrinter): string | null {
  if (printer.transport === 'none') return 'No transport chosen — pick how this station reaches its printer.'
  if (!printer.enabled) return 'Switched off for this station.'
  if (printer.transport === 'epos' && printer.address === '') {
    return 'ePOS needs the printer’s address on the café network.'
  }
  return null
}
