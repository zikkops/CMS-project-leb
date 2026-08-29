// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Events, and the list of event types they are filed under.
//
// An event is the one piece of content customers book against, so deleting
// one is not like deleting a menu item — there may be people holding a spot.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { BRANCHES } from '../branches'

const MAX_PRICE = 10_000
const MAX_PARTY = 200
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

/** Not a branch — the "runs everywhere" option the picker offers alongside. */
export const ALL_BRANCHES = 'All Branches'

function text(raw: unknown, label: string, { required = false, maxLen = 200 } = {}): string {
  const v = String(raw ?? '').trim()
  if (required && !v) throw new HttpError(400, `${label} is required.`)
  return v.slice(0, maxLen)
}

export interface EventInput {
  title: string
  type: string
  branch: string
  date: string
  timeStart: string
  timeEnd: string
  description: string
  price: number
  minPlayers: number
  maxPlayers: number
  registrationLink: string
  image: string
  contactNumber: string
}

export function parseEventInput(body: Record<string, unknown>): EventInput {
  const branch = text(body.branch, 'Branch', { required: true, maxLen: 100 })
  if (branch !== ALL_BRANCHES && !(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch}. Expected one of ${[...BRANCHES, ALL_BRANCHES].join(', ')}.`)
  }

  const date = text(body.date, 'Date', { required: true, maxLen: 10 })
  if (!DATE.test(date)) throw new HttpError(400, 'Date must be YYYY-MM-DD.')

  for (const [v, label] of [[body.timeStart, 'Start time'], [body.timeEnd, 'End time']] as const) {
    const t = text(v, label, { maxLen: 5 })
    if (t && !TIME.test(t)) throw new HttpError(400, `${label} must be HH:MM.`)
  }

  const price = Number(body.price ?? 0)
  if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
    throw new HttpError(400, `Price must be a number between 0 and ${MAX_PRICE.toLocaleString()}.`)
  }

  const minPlayers = Number(body.minPlayers ?? 1)
  const maxPlayers = Number(body.maxPlayers ?? 1)
  for (const [n, label] of [[minPlayers, 'Minimum party size'], [maxPlayers, 'Maximum party size']] as const) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARTY) {
      throw new HttpError(400, `${label} must be a whole number between 1 and ${MAX_PARTY}.`)
    }
  }
  // A maximum below the minimum makes the event unbookable: the booking form
  // checks `partySize < min || partySize > max`, so every party size fails and
  // nothing explains why.
  if (maxPlayers < minPlayers) {
    throw new HttpError(400, 'The maximum party size cannot be below the minimum — nobody could book it.')
  }

  return {
    title: text(body.title, 'Title', { required: true }),
    type: text(body.type, 'Type', { maxLen: 100 }),
    branch,
    date,
    timeStart: text(body.timeStart, 'Start time', { maxLen: 5 }),
    timeEnd: text(body.timeEnd, 'End time', { maxLen: 5 }),
    description: text(body.description, 'Description', { maxLen: 4000 }),
    price: Math.round(price * 100) / 100,
    minPlayers,
    maxPlayers,
    registrationLink: text(body.registrationLink, 'Registration link', { maxLen: 2000 }),
    image: text(body.image, 'Image', { maxLen: 2000 }),
    contactNumber: text(body.contactNumber, 'Contact number', { maxLen: 40 }),
  }
}

export async function createEvent(input: EventInput): Promise<{ id: string }> {
  const ref = await adminDb().collection('events').add({
    ...input,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function updateEvent(id: string, input: EventInput): Promise<{ before: Record<string, unknown> }> {
  const ref = adminDb().doc(`events/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That event no longer exists.')
  await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() })
  return { before: snap.data() ?? {} }
}

/**
 * Deletes an event, refusing while anyone still holds a spot.
 *
 * An event is the one piece of content a customer books against. Deleting one
 * with live reservations leaves people holding a booking for something that
 * does not exist — their profile lists it, staff see it in the approvals
 * queue, and nothing anywhere says the event is gone.
 *
 * Cancelled and rejected bookings do not block: those people already know
 * they are not coming.
 */
export async function deleteEvent(id: string): Promise<{ title: string; before: Record<string, unknown> }> {
  const db = adminDb()
  const ref = db.doc(`events/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That event no longer exists.')

  const booked = await db.collection('eventReservations')
    .where('eventId', '==', id)
    .where('status', 'in', ['pending', 'approved'])
    .get()

  if (!booked.empty) {
    const pending = booked.docs.filter(d => d.data().status === 'pending').length
    const detail = pending > 0 && pending < booked.size
      ? ` (${pending} still awaiting a decision)`
      : ''
    throw new HttpError(409,
      `${booked.size} booking${booked.size === 1 ? '' : 's'}${detail} still ${booked.size === 1 ? 'holds' : 'hold'} a spot at this event. Reject ${booked.size === 1 ? 'it' : 'them'} first so the customer${booked.size === 1 ? '' : 's'} know${booked.size === 1 ? 's' : ''}.`)
  }

  const before = snap.data() ?? {}
  await ref.delete()
  return { title: String(before.title ?? id), before }
}

// ── Event types ───────────────────────────────────────────────────────────

export async function createEventType(name: string): Promise<{ id: string }> {
  const clean = text(name, 'Type name', { required: true, maxLen: 100 })
  const db = adminDb()
  const existing = await db.collection('eventTypes').where('name', '==', clean).limit(1).get()
  if (!existing.empty) throw new HttpError(409, `There is already a type called "${clean}".`)
  const ref = await db.collection('eventTypes').add({ name: clean, createdAt: FieldValue.serverTimestamp() })
  return { id: ref.id }
}

/**
 * Deletes a type, refusing while events are still filed under it.
 *
 * An event stores its type as a NAME, not an id, so deleting the type left
 * events pointing at a label no longer in the list — they drop out of the
 * type filter rather than erroring. Same silent disappearance as the menu,
 * the order template and the product catalogue.
 */
export async function deleteEventType(id: string): Promise<{ name: string }> {
  const db = adminDb()
  const ref = db.doc(`eventTypes/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That type no longer exists.')

  const name = String(snap.data()?.name ?? '')
  const used = await db.collection('events').where('type', '==', name).get()
  if (!used.empty) {
    const titles = used.docs.slice(0, 3).map(d => String(d.data().title ?? d.id))
    const more = used.size > 3 ? `, and ${used.size - 3} more` : ''
    throw new HttpError(409,
      `${used.size} event${used.size === 1 ? ' is' : 's are'} filed under "${name}" — ${titles.join(', ')}${more}. Change ${used.size === 1 ? 'it' : 'them'} first.`)
  }

  await ref.delete()
  return { name }
}
