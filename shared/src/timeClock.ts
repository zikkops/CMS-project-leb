// Clocking in and out from the staff app, signed with the fingerprint
// (UPGRADE.md T3.12). Pure: the signed message, which way the next clock goes,
// and the timesheet. Asserted by verify:hub-sync (the signing) and
// verify:reports (the timesheet).
//
// A clock is the phone's key signing a message that names this hub's own
// certificate, a fresh challenge, and in or out: the same proof as signing in
// (staffKeys.ts), with its own label, so a sign-in signature is never a clock
// and a clock is never a sign-in. It is recorded on the hub, which sends it up
// with its trading, so it works with no internet.
//
// Pay and labour cost are NOT here: who may see pay rates is the owner's
// decision to make first (UPGRADE.md T3.12).

import { closedAtParts } from './salesExport'

export const TIME_ENTRIES = 'timeEntries'

export type ClockDirection = 'in' | 'out'

export function clockMessage(hubFingerprintHex: string, keyId: string, nonce: string, direction: ClockDirection): string {
  return `bigcms-hub-clock:v1\n${hubFingerprintHex}\n${keyId}\n${nonce}\n${direction}`
}

/** Which way the next clock goes: out after an in, in otherwise. */
export function nextDirection(last: { direction: string } | null | undefined): ClockDirection {
  return last?.direction === 'in' ? 'out' : 'in'
}

export interface TimeEntry {
  uid: string
  name: string
  branch: string
  direction: ClockDirection
  /** Milliseconds. */
  at: number
}

export interface Shift {
  uid: string
  name: string
  branch: string
  /** The café day the shift started on. */
  day: string
  inAt: number
  /** null while still clocked in. */
  outAt: number | null
  minutes: number | null
  /** Longer than 16 hours: a clock-out that was probably forgotten. */
  long: boolean
}

export interface PersonHours { uid: string; name: string; shifts: number; minutes: number; open: boolean }

export interface Timesheet {
  shifts: Shift[]
  people: PersonHours[]
  /** Clock-outs with no clock-in before them, shown rather than guessed at. */
  unmatched: TimeEntry[]
}

export const LONG_SHIFT_MINUTES = 16 * 60

/**
 * Pairs each person's clock-ins with the next clock-out. A clock-in with no
 * clock-out yet is an open shift; a second clock-in before any clock-out
 * closes nothing and starts again (the first is left open and flagged long if
 * it was); a clock-out with no clock-in is listed apart, never paired with a
 * guess.
 */
export function timesheet(entries: readonly TimeEntry[], opts: { timeZone: string; now: number }): Timesheet {
  const byPerson = new Map<string, TimeEntry[]>()
  for (const e of entries) {
    if (!e || (e.direction !== 'in' && e.direction !== 'out') || !Number.isFinite(e.at)) continue
    const list = byPerson.get(e.uid) ?? []
    list.push(e)
    byPerson.set(e.uid, list)
  }
  const shifts: Shift[] = []
  const unmatched: TimeEntry[] = []
  for (const list of byPerson.values()) {
    list.sort((a, b) => a.at - b.at)
    let open: TimeEntry | null = null
    const close = (inE: TimeEntry, outAt: number | null) => {
      const minutes = outAt === null ? null : Math.round((outAt - inE.at) / 60_000)
      const span = (outAt ?? opts.now) - inE.at
      shifts.push({
        uid: inE.uid, name: inE.name, branch: inE.branch, day: closedAtParts(inE.at, opts.timeZone).day,
        inAt: inE.at, outAt, minutes, long: span > LONG_SHIFT_MINUTES * 60_000,
      })
    }
    for (const e of list) {
      if (e.direction === 'in') {
        if (open) close(open, null)
        open = e
      } else if (open) {
        close(open, e.at)
        open = null
      } else {
        unmatched.push(e)
      }
    }
    if (open) close(open, null)
  }
  shifts.sort((a, b) => a.inAt - b.inAt)
  return { shifts, people: peopleOf(shifts), unmatched }
}

/**
 * Hours per person over the shifts given. The report pairs clock-ins over a
 * padded window and then keeps the shifts in its range; the people must be
 * added up from THOSE, or hours from outside the range creep in (UPGRADE.md
 * T7.11, reporting gap 17).
 */
export function peopleOf(shifts: readonly Shift[]): PersonHours[] {
  const people = new Map<string, PersonHours>()
  for (const s of shifts) {
    const p = people.get(s.uid) ?? { uid: s.uid, name: s.name, shifts: 0, minutes: 0, open: false }
    p.shifts++
    p.minutes += s.minutes ?? 0
    if (s.outAt === null) p.open = true
    p.name = s.name || p.name
    people.set(s.uid, p)
  }
  return [...people.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
}
