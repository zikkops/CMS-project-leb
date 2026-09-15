// Printer configuration, server side.
//
// Writes go through here rather than from the browser, matching every other
// appSettings document. That is the standing rule from Phase 00 on — no new
// client SDK writes — and it applies here even though a printer address is not
// money: `appSettings/{id}` still carries a catch-all rule allowing an admin
// browser to write, and every document that moves behind a route is one fewer
// reason for that catch-all to exist.

import { adminDb } from './firebaseAdmin'
import { STATIONS, type Station } from '../checks'
import { RECEIPT_WIDTHS } from '../receipt'
import {
  PRINTING_DOC, PRINTING_DEFAULTS, PRINTER_DEFAULT, PRINT_TRANSPORTS,
  parsePrintingSettings, readPrinterAddress,
  type PrintingSettings, type StationPrinter, type PrintTransport,
} from '../printing'

const MAX_COPIES = 5

/**
 * Validate one station's printer from a request body.
 *
 * Rejects rather than coerces where a wrong value would be silently wrong: an
 * unknown transport is a typo somebody would spend an evening on, and a
 * silently-defaulted one prints nothing while the settings page claims it is
 * configured.
 */
function parsePrinterInput(raw: unknown, where: string): StationPrinter {
  if (raw === undefined || raw === null) return PRINTER_DEFAULT
  if (typeof raw !== 'object') throw new Error(`${where}: expected an object.`)
  const d = raw as Record<string, unknown>

  const transport = d.transport ?? PRINTER_DEFAULT.transport
  if (!PRINT_TRANSPORTS.includes(transport as PrintTransport)) {
    throw new Error(`${where}: "${String(transport)}" is not a transport.`)
  }

  const width = d.width ?? RECEIPT_WIDTHS.narrow
  if (width !== RECEIPT_WIDTHS.narrow && width !== RECEIPT_WIDTHS.wide) {
    throw new Error(`${where}: roll width must be ${RECEIPT_WIDTHS.narrow} or ${RECEIPT_WIDTHS.wide} columns.`)
  }

  const copies = d.copies === undefined ? 1 : Number(d.copies)
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    throw new Error(`${where}: copies must be a whole number from 1 to ${MAX_COPIES}.`)
  }

  const address = typeof d.address === 'string' ? d.address.trim() : ''
  if (address.length > 300) throw new Error(`${where}: that address is too long.`)

  // An ePOS printer with no address cannot print, so saying it is enabled
  // would make the settings page lie. Refuse at the point somebody can still
  // fix it rather than at the pass during service.
  if (d.enabled === true && transport === 'epos' && address === '') {
    throw new Error(`${where}: ePOS needs the printer's address on the café network.`)
  }
  // A network printer (S28) must be somewhere on the café network the hub can
  // reach: a private address, never a name or a public address.
  if (d.enabled === true && transport === 'network' && !readPrinterAddress(address)) {
    throw new Error(`${where}: a network printer needs its address on the café network, like 192.168.1.50 or 192.168.1.50:9100.`)
  }
  if (d.enabled === true && transport === 'none') {
    throw new Error(`${where}: choose how this station reaches its printer before switching it on.`)
  }

  return {
    enabled: d.enabled === true,
    transport: transport as PrintTransport,
    width,
    address,
    copies,
  }
}

export function parsePrintingInput(body: Record<string, unknown>): PrintingSettings {
  const rawBranches = body.branches
  if (rawBranches !== undefined && (typeof rawBranches !== 'object' || rawBranches === null)) {
    throw new Error('branches: expected an object keyed by branch.')
  }

  const branches: PrintingSettings['branches'] = {}
  for (const [branch, stations] of Object.entries((rawBranches ?? {}) as Record<string, unknown>)) {
    if (typeof stations !== 'object' || stations === null) {
      throw new Error(`${branch}: expected an object keyed by station.`)
    }
    const s = stations as Record<string, unknown>
    // Unknown station keys are dropped rather than rejected. The station list
    // is a property of this build; a stored document written by a newer one
    // should not make an older one refuse to save.
    branches[branch] = Object.fromEntries(
      STATIONS.map(station => [station, parsePrinterInput(s[station], `${branch} · ${station}`)]),
    ) as Record<Station, StationPrinter>
  }

  const receiptStation = body.receiptStation ?? PRINTING_DEFAULTS.receiptStation
  if (!STATIONS.includes(receiptStation as Station)) {
    throw new Error(`receiptStation: "${String(receiptStation)}" is not a station.`)
  }

  return {
    branches,
    receiptOnClose: body.receiptOnClose === true,
    receiptStation: receiptStation as Station,
  }
}

export async function readPrintingSettings(): Promise<PrintingSettings> {
  try {
    const snap = await adminDb().doc(PRINTING_DOC).get()
    return parsePrintingSettings(snap.data())
  } catch {
    // Same reasoning as the client listener: unreadable configuration means
    // every printer off, never a printer the app invents. Printing failing is
    // an inconvenience; the POS failing because printing failed is not.
    return PRINTING_DEFAULTS
  }
}

export async function writePrintingSettings(settings: PrintingSettings): Promise<void> {
  await adminDb().doc(PRINTING_DOC).set(settings, { merge: false })
}

/**
 * A one-line summary for the activity log.
 *
 * The full document is a nested object per branch per station, and a log entry
 * nobody can read is a log entry nobody reads. What matters after the fact is
 * which stations were printing, not what the addresses were.
 */
export function describePrinting(settings: PrintingSettings): string {
  const on: string[] = []
  for (const [branch, stations] of Object.entries(settings.branches)) {
    for (const station of STATIONS) {
      const p = stations[station]
      if (p?.enabled) on.push(`${branch}/${station} via ${p.transport}`)
    }
  }
  const receipt = settings.receiptOnClose
    ? `receipt on close at ${settings.receiptStation}`
    : 'no receipt on close'
  return on.length === 0 ? `nothing printing · ${receipt}` : `${on.join(', ')} · ${receipt}`
}
