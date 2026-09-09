'use client'

// Printing a ticket the moment it lands on the pass.
//
// POS-only, so it lives here rather than in shared/ — see CLAUDE.md. The
// document, the transport and the configuration are all shared; deciding WHEN
// to print is a property of this screen.
//
// ── The three ways this goes wrong, and what stops each ────────────────────
//
// 1. THE BACKLOG. A listener's first snapshot is every active ticket, so a
//    screen opening at 8pm would print the whole evening in one go. The first
//    snapshot is therefore treated as history: everything in it is recorded as
//    seen and nothing from it prints. A ticket sent while no screen was open
//    never prints — the screen shows it, and that is the trade. Paper is a
//    copy of the order, not the order.
//
// 2. REPRINTING. Tickets re-render on every status change, every bump, every
//    re-connect. Ids already printed are remembered for the life of the page,
//    so a ticket prints once no matter how many times it comes back through.
//
// 3. TWO SCREENS. This is the one that is invisible until it happens. Two
//    devices showing the same station both see the same new ticket and both
//    print it, and the kitchen gets two of everything with nothing anywhere
//    saying why. So printing is OFF per device until somebody turns it on,
//    and the setting is stored on the device rather than in the account: it is
//    a fact about which machine has the printer plugged into it.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ticketSentAtMs, type Ticket } from '@big-cms/shared/tickets'
import { ticketToText } from '@big-cms/shared/ticketDoc'
import { printText } from '@big-cms/shared/printClient'
import { printerFor, type PrintingSettings } from '@big-cms/shared/printing'
import { BRAND } from '@big-cms/shared/brand'

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

/**
 * Print each newly-arrived ticket on its own station's printer.
 *
 * Note "its own": when the screen is showing All, a bar ticket and a kitchen
 * ticket go to different machines. The station on the TICKET decides, never
 * the station the screen happens to be filtered to.
 */
export function useAutoPrintTickets(
  tickets: Ticket[],
  branch: string,
  settings: PrintingSettings,
  settingsLoading: boolean,
): AutoPrintState {
  const [on, setOnState] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [printed, setPrinted] = useState(0)

  // Ids already handled. A ref rather than state: changing it must not cause a
  // render, and a render must not reset it.
  const seen = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  // Read once on mount rather than during render — localStorage does not exist
  // on the server, and reading it while rendering makes the server and client
  // produce different HTML. Same reasoning as the station picker on the KDS.
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
    // Wait for the configuration. Acting on the defaults would mean deciding
    // "no printer" before the answer arrived, and marking the current tickets
    // as history in the process — so the first real batch would be skipped.
    if (settingsLoading) return

    // The first list this screen ever sees is history, whatever it contains.
    if (!primed.current) {
      for (const t of tickets) seen.current.add(t.id)
      primed.current = true
      return
    }

    const fresh = tickets.filter(t => !seen.current.has(t.id))
    if (fresh.length === 0) return

    // Marked before printing, not after. printText() is async, and a second
    // snapshot arriving mid-print would otherwise find the same ticket unseen
    // and print it again — the duplicate this whole file exists to avoid.
    for (const t of fresh) seen.current.add(t.id)

    if (!on) return

    void (async () => {
      for (const ticket of fresh) {
        const printer = printerFor(settings, branch, ticket.station)
        if (!printer.enabled) continue

        const text = ticketToText(ticket, {
          businessName: BRAND.shortName,
          // The ticket's own send time, not now: a print that queues behind
          // another would otherwise stamp the paper with the wrong minute, and
          // the pass judges waiting time off that number.
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
  }, [tickets, branch, settings, settingsLoading, on])

  return { on, setOn, lastError, printed }
}
