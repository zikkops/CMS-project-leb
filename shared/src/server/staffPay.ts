// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Staff pay: each person's hourly rate and tip weight, with history
// (UPGRADE.md T7.18). The rules are shared/src/staffPay.ts.
//
// `staffPay/{uid}` is server-only, with no Firestore rule, so no rules deploy.
// It is never on `users/{uid}`, which its owner can edit, and never pulled to
// a hub: pay is not the till's business. Rates are read by admins only; tip
// weights, without rates, by the people who do the tips (endOfDay).

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { STAFF_PROFILES, readFirstName } from '../staffProfiles'
import { readPayEntry, readPayHistory, withPayEntry, payOn, type PayEntry } from '../staffPay'
import { todayYmd } from '../dates'
import { BRAND } from '../brand'

export const STAFF_PAY = 'staffPay'

export interface StaffPayRow {
  uid: string
  email: string
  role: string
  firstName: string
  history: PayEntry[]
  /** What is in force today, or null before the first entry. */
  current: PayEntry | null
}

async function staffAccounts(): Promise<{ uid: string; email: string; role: string }[]> {
  const snap = await adminDb().collection('users').where('isStaff', '==', true).get()
  return snap.docs.map(d => ({ uid: d.id, email: String(d.data().email ?? ''), role: String(d.data().role ?? '') }))
}

/** Every staff member with their pay history. Admin only: it carries rates. */
export async function listStaffPay(): Promise<StaffPayRow[]> {
  const db = adminDb()
  const staff = await staffAccounts()
  if (staff.length === 0) return []
  const refs = staff.map(s => db.doc(`${STAFF_PAY}/${s.uid}`))
  const profiles = staff.map(s => db.doc(`${STAFF_PROFILES}/${s.uid}`))
  const [paySnaps, profileSnaps] = await Promise.all([db.getAll(...refs), db.getAll(...profiles)])
  const today = todayYmd(BRAND.locale.timezone)
  return staff.map((s, i) => {
    const history = readPayHistory(paySnaps[i].data()?.history)
    return { ...s, firstName: readFirstName(profileSnaps[i].data()?.firstName), history, current: payOn(history, today) }
  }).sort((a, b) => (a.firstName || a.email).localeCompare(b.firstName || b.email))
}

/** Tip weights with their dates and no rates, for the tips page (endOfDay). */
export async function listTipWeights(): Promise<{ uid: string; email: string; firstName: string; weights: { from: string; tipWeight: number }[] }[]> {
  return (await listStaffPay()).map(r => ({
    uid: r.uid, email: r.email, firstName: r.firstName,
    weights: r.history.map(e => ({ from: e.from, tipWeight: e.tipWeight })),
  }))
}

/**
 * Adds an entry taking effect from its day; one already on that day is
 * replaced. Returns what was in force that day before, for the log.
 */
export async function setStaffPay(caller: Caller, uid: string, raw: unknown): Promise<{ before: PayEntry | null; after: PayEntry; label: string }> {
  if (!uid || uid.includes('/')) throw new HttpError(400, 'Choose a staff member.')
  const clean = readPayEntry(raw)
  if (typeof clean === 'string') throw new HttpError(400, clean)
  const db = adminDb()
  const user = await db.doc(`users/${uid}`).get()
  if (!user.exists || user.data()?.isStaff !== true) throw new HttpError(404, 'That is not a staff account.')
  const entry: PayEntry = { ...clean, setBy: caller.email ?? caller.uid, setAt: new Date().toISOString() }
  const ref = db.doc(`${STAFF_PAY}/${uid}`)
  const before = await db.runTransaction(async tx => {
    const history = readPayHistory((await tx.get(ref)).data()?.history)
    const was = payOn(history, entry.from)
    tx.set(ref, { history: withPayEntry(history, entry), updatedAt: FieldValue.serverTimestamp() })
    return was
  })
  const profile = await db.doc(`${STAFF_PROFILES}/${uid}`).get()
  const label = readFirstName(profile.data()?.firstName) || String(user.data()?.email ?? uid)
  return { before, after: entry, label }
}
