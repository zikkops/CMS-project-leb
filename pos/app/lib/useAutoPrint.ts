'use client'

// Printing from the KDS: tickets as they land on the pass, and the customer
// receipt as a check closes.
//
// POS-only, so it lives here rather than in shared/ — see CLAUDE.md. The
// documents, the transport and the configuration are all shared; deciding WHEN
// to print is a property of this screen.
//
// ── Why the KDS prints the receipt, not the phone that closed the check ────
// With the browser transport, "the bar's printer" means "the device at the
// bar". Printing on close from the device that pressed Close would put the
// receipt on a waiter's phone while the settings page says it goes to the bar.
// So the receipt comes out of the KDS showing the receipt station — the same
// machine, the same "Print here" switch, the same paper as its tickets.
//
// ── The ways ticket printing goes wrong, and what stops each ───────────────
//
// 1. THE BACKLOG. A listener's first snapshot is every active ticket; printing
//    it would print the whole evening. The first snapshot of each subscription
//    is history. A ticket sent while no screen was looking never prints — the
//    screen shows it, and paper is a copy of the order, not the order.
//
// 2. SWITCHING STATION. The same failure by another door, and the one the
//    first version had: Kitchen → Bar is a new subscription whose first
//    snapshot is the bar pass's whole backlog. History is per scope.
//
// 3. REPRINTING. Ids are remembered for the life of the page and marked
//    before the print — printText() is async, and a snapshot arriving
//    mid-print would otherwise print the same ticket twice.
//
// 4. TWO SCREENS. Two devices on one station would both print every ticket,
//    with nothing saying why. So printing is off per device until turned on,
//    stored on the device: it is a fact about which machine has the printer.
//
// Both decisions are pure functions in printBatch.ts, asserted in
// scripts/verify-printing.mjs — case 2 was reasoned correct inside an effect
// and was not.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ticketSentAtMs, type Ticket } from '@big-cms/shared/tickets'
import type { Station } from '@big-cms/shared/checks'
import { ticketToText } from '@big-cms/shared/ticketDoc'
import { buildReceipt, receiptToText } from '@big-cms/shared/receipt'
import { printText } from '@big-cms/shared/printClient'
import {
  printerFor, shouldPrintReceiptHere, type PrintingSettings,
} from '@big-cms/shared/printing'
import { BRAND } from '@big-cms/shared/brand'
import { nextPrintBatch, EMPTY_PRINT_STATE, type PrintBatchState } from './printBatch'
import { useAuthReady, watchClosedReceipts } from './usePos'
import { receiptOptionsFor } from './receiptOptions'

const DEVICE_KEY = 'kds.printsFromThisDevice'

/** This device's "Print here" switch. Off until somebody turns it on. */
export function usePrintsHere(): { on: boolean; setOn: (next: boolean) => void } {
  const [on, setOnState] = useState(false)

  // Read once on mount rather than during render — localStorage does not exist
  // on the server, and reading it while rendering mismatches hydration. Same
  // reasoning as the station picker on the KDS.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOnState(window.localStorage.getItem(DEVICE_KEY) === 'yes')
    } catch { /* private window, storage disabled — stays off */ }
  }, [])

  const setOn = useCallback((next: boolean) => {
    setOnState(next)
    try { window.localStorage.setItem(DEVICE_KEY, next ? 'yes' : 'no') } catch { /* not fatal */ }
  }, [])

  return { on, setOn }
}

export interface PaperState {
  /** The last failure, for the screen to show. Null when nothing has failed. */
  lastError: string | null
  /** How many this device has printed since the page opened. */
  printed: number
}

// ── Tickets ────────────────────────────────────────────────────────────────

export interface AutoPrintInput {
  /** This device's switch, from usePrintsHere(). */
  on: boolean
  tickets: Ticket[]
  ticketsLoading: boolean
  /**
   * What the ticket listener is subscribed to. Must change exactly when the
   * listener does — it is how a station switch is recognised as a new pass.
   */
  scope: string
  branch: string
  settings: PrintingSettings
  settingsLoading: boolean
}

/**
 * Print each newly-arrived ticket on its own station's printer.
 *
 * "Its own": with the screen showing All, a bar ticket and a kitchen ticket go
 * to different machines. The station on the TICKET decides.
 */
export function useAutoPrintTickets(input: AutoPrintInput): PaperState {
  const { on, tickets, ticketsLoading, scope, branch, settings, settingsLoading } = input

  const [lastError, setLastError] = useState<string | null>(null)
  const [printed, setPrinted] = useState(0)

  // A ref: advancing it must not render, and a render must not reset it.
  const batch = useRef<PrintBatchState>(EMPTY_PRINT_STATE)

  useEffect(() => {
    const { state, print } = nextPrintBatch(batch.current, {
      scope,
      ids: tickets.map(t => t.id),
      ticketsLoading,
      settingsLoading,
      on,
    })
    // Advanced before any printing starts — see case 3 above.
    batch.current = state
    if (print.length === 0) return

    const byId = new Map(tickets.map(t => [t.id, t]))

    void (async () => {
      for (const id of print) {
        const ticket = byId.get(id)
        if (!ticket) continue
        const printer = printerFor(settings, branch, ticket.station)
        // A network printer is printed to by the café hub itself (S28).
        if (!printer.enabled || printer.transport === 'network') continue

        const text = ticketToText(ticket, {
          businessName: BRAND.shortName,
          // The ticket's own send time, not now: a print queued behind another
          // would otherwise stamp the wrong minute, and the pass judges waiting
          // time off that number.
          sentAt: ticketSentAtMs(ticket, Date.now()),
          sentBy: ticket.sentByEmail.split('@')[0] || ticket.sentBy,
          timeZone: BRAND.locale.timezone,
          locale: BRAND.locale.locale,
        }, printer.width)

        const result = await printText(text, printer)
        if (result.printed) {
          setPrinted(n => n + 1)
        } else {
          // Shown, never thrown. A printer out of paper must not take the
          // screen down with it — the ticket is already on the pass.
          setLastError(`${ticket.station}: ${result.reason ?? 'did not print'}`)
        }
      }
    })()
  }, [tickets, ticketsLoading, scope, branch, settings, settingsLoading, on])

  return { lastError, printed }
}

// ── Receipts on close ──────────────────────────────────────────────────────

export interface AutoPrintReceiptsInput {
  /** This device's switch, from usePrintsHere(). */
  on: boolean
  branch: string
  /** The station this KDS is filtered to, or null for All. */
  screenStation: Station | null
  settings: PrintingSettings
  settingsLoading: boolean
  /** The live business setting. A receipt is not printed on a guessed rate. */
  exchangeRate: number
  rateLoading: boolean
}

/**
 * Print the customer receipt when a check closes — if this is the screen that
 * does that. See the header for why it is this screen and not the till.
 */
export function useAutoPrintReceipts(input: AutoPrintReceiptsInput): PaperState & { active: boolean } {
  const { on, branch, screenStation, settings, settingsLoading, exchangeRate, rateLoading } = input

  const [lastError, setLastError] = useState<string | null>(null)
  const [printed, setPrinted] = useState(0)
  const { ready, signedIn } = useAuthReady()

  const active = on && ready && signedIn && !settingsLoading && !rateLoading && branch !== ''
    && shouldPrintReceiptHere(settings, branch, screenStation)

  // The latest configuration, read at print time. Kept out of the subscribe
  // effect's dependencies because the settings object is rebuilt on every
  // snapshot, and resubscribing on each one would re-take the watermark for
  // nothing and open a gap in which a closing could be missed.
  const latest = useRef({ settings, exchangeRate })
  useEffect(() => { latest.current = { settings, exchangeRate } }, [settings, exchangeRate])

  useEffect(() => {
    if (!active) return
    return watchClosedReceipts(
      branch,
      checks => {
        void (async () => {
          for (const check of checks) {
            const { settings: s, exchangeRate: rate } = latest.current
            const printer = printerFor(s, branch, s.receiptStation)
            let text: string
            try {
              text = receiptToText(buildReceipt(check, receiptOptionsFor(rate)), printer.width)
            } catch (err) {
              // buildReceipt refuses a check with no receipt number rather than
              // half-printing one. Say so; do not guess.
              setLastError(`Receipt: ${err instanceof Error ? err.message : 'could not be built'}`)
              continue
            }
            const result = await printText(text, printer)
            if (result.printed) setPrinted(n => n + 1)
            else setLastError(`Receipt: ${result.reason ?? 'did not print'}`)
          }
        })()
      },
      message => setLastError(`Receipts: ${message}`),
    )
  }, [active, branch])

  return { lastError, printed, active }
}
