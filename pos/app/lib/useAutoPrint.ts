'use client'

// Printing a ticket the moment it lands on the pass.
//
// POS-only, so it lives here rather than in shared/ — see CLAUDE.md. The
// document, the transport and the configuration are all shared; deciding WHEN
// to print is a property of this screen.
//
// ── The ways this goes wrong, and what stops each ──────────────────────────
//
// 1. THE BACKLOG. A listener's first snapshot is every active ticket, so a
//    screen opening at 8pm would print the whole evening in one go. The first
//    snapshot of each SUBSCRIPTION is therefore history: recorded, not
//    printed. A ticket sent while no screen was looking never prints — the
//    screen shows it, and that is the trade. Paper is a copy of the order.
//
// 2. SWITCHING STATION. The same failure by another door, and the one the
//    first version of this file had: changing the KDS from Kitchen to Bar is a
//    new subscription, and its first snapshot is the bar pass's whole backlog.
//    Treating only the FIRST EVER snapshot as history printed every ticket on
//    the bar pass at once. History is now per scope.
//
// 3. REPRINTING. Tickets re-render on every status change and reconnect. Ids
//    are remembered for the life of the page and marked before the print, not
//    after — printText() is async, and a snapshot arriving mid-print would
//    otherwise find the same ticket unseen and print it twice.
//
// 4. TWO SCREENS. Two devices on one station both see the new ticket and both
//    print it, and nothing anywhere says why. So printing is OFF per device
//    until somebody turns it on, stored on the device rather than the account:
//    it is a fact about which machine has a printer plugged into it.
//
// The decision itself is nextPrintBatch() in printBatch.ts — pure, and
// asserted in scripts/verify-printing.mjs, because case 2 was reasoned
// correct inside an effect and was not.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ticketSentAtMs, type Ticket } from '@big-cms/shared/tickets'
import { ticketToText } from '@big-cms/shared/ticketDoc'
import { printText } from '@big-cms/shared/printClient'
import { printerFor, type PrintingSettings } from '@big-cms/shared/printing'
import { BRAND } from '@big-cms/shared/brand'
import { nextPrintBatch, EMPTY_PRINT_STATE, type PrintBatchState } from './printBatch'

const DEVICE_KEY = 'kds.printsFromThisDevice'

export interface AutoPrintState {
  /** Whether this device prints. Off until somebody says otherwise. */
  on: boolean
  setOn: (next: boolean) => void
  /** The last failure, for the screen to show. Null when nothing has failed. */
  lastError: string | null
  /** How many tickets this device has printed since the page opened. */
  printed: number
}

export interface AutoPrintInput {
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
export function useAutoPrintTickets(input: AutoPrintInput): AutoPrintState {
  const { tickets, ticketsLoading, scope, branch, settings, settingsLoading } = input

  const [on, setOnState] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [printed, setPrinted] = useState(0)

  // A ref: advancing it must not render, and a render must not reset it.
  const batch = useRef<PrintBatchState>(EMPTY_PRINT_STATE)

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
        if (!printer.enabled) continue

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

  return { on, setOn, lastError, printed }
}
