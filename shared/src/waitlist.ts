// The waitlist beside reservations (UPGRADE.md T3.13): a walk-in party waiting
// for a table. Pure, asserted by verify:reports.
//
// A name (what the host calls out), how many, what they were told, and a
// note: no phone number, because nothing here texts anyone, and a number kept
// for nothing is a number to lose. The list is one café day long: yesterday's
// queue is not today's.

export const WAITLIST = 'waitlist'

export type WaitStatus = 'waiting' | 'seated' | 'left'

export interface WaitEntry {
  id: string
  branch: string
  /** The café day it was added on. */
  day: string
  name: string
  partySize: number
  note: string
  /** What the party was told, in minutes; null when nothing was quoted. */
  quotedMinutes: number | null
  status: WaitStatus
  /** Milliseconds. */
  addedAt: number
  doneAt: number | null
}

export interface WaitInput { name: string; partySize: number; note: string; quotedMinutes: number | null }

/** A new entry as typed, or why it is not one. */
export function readWaitInput(raw: Record<string, unknown>): WaitInput | string {
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : ''
  if (!name) return 'Say whose name to call.'
  if (name.length > 60) return 'Keep the name short: what the host calls out.'
  const partySize = Number(raw.partySize)
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) return 'How many, from 1 to 50.'
  const q = raw.quotedMinutes === '' || raw.quotedMinutes === null || raw.quotedMinutes === undefined ? null : Number(raw.quotedMinutes)
  if (q !== null && (!Number.isInteger(q) || q < 0 || q > 240)) return 'A quoted wait is whole minutes, up to 4 hours.'
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 120) : ''
  return { name, partySize, note, quotedMinutes: q }
}

/** Minutes waited so far, or until seated or gone. */
export function waitedMinutes(e: Pick<WaitEntry, 'addedAt' | 'doneAt'>, now: number): number {
  return Math.max(0, Math.floor(((e.doneAt ?? now) - e.addedAt) / 60_000))
}

/** Past what they were told. */
export function overQuote(e: Pick<WaitEntry, 'addedAt' | 'doneAt' | 'quotedMinutes' | 'status'>, now: number): boolean {
  return e.status === 'waiting' && e.quotedMinutes !== null && waitedMinutes(e, now) > e.quotedMinutes
}

export interface WaitView {
  /** Waiting, first come first, with their place in the queue. */
  waiting: (WaitEntry & { place: number })[]
  /** Seated or gone today, most recent first. */
  done: WaitEntry[]
  /** How long the parties seated today waited, on average, in minutes; null before anyone is seated. */
  averageWait: number | null
}

export function waitView(entries: readonly WaitEntry[], day: string): WaitView {
  const today = entries.filter(e => e.day === day)
  const waiting = today.filter(e => e.status === 'waiting').sort((a, b) => a.addedAt - b.addedAt).map((e, i) => ({ ...e, place: i + 1 }))
  const done = today.filter(e => e.status !== 'waiting').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
  const seated = today.filter(e => e.status === 'seated' && e.doneAt !== null)
  const averageWait = seated.length ? Math.round(seated.reduce((s, e) => s + waitedMinutes(e, e.doneAt ?? e.addedAt), 0) / seated.length) : null
  return { waiting, done, averageWait }
}
