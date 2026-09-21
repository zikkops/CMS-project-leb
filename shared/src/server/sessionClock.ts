// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Signing in clocks you in, signing out clocks you out (UPGRADE.md T6.6,
// owner's answer 21 Sep 2026). The decision is sessionClockAction() in
// timeClock.ts; this writes the timeEntries the staff app's clock writes
// (hubClock.ts), so the timesheet sees one kind of entry whichever way it came.
//
// Here rather than in hubClock.ts because hubSession.ts calls it, and hubClock
// already depends on hubSession through hubKeySignIn.

import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { TIME_ENTRIES, sessionClockAction, type ClockDirection } from '../timeClock'
import { timestampMs } from '../timestamps'

/** The person's last clock entry at this hub, or null. */
export async function lastClockEntry(db: Firestore, uid: string): Promise<{ direction: string; at: number } | null> {
  const snap = await db.collection(TIME_ENTRIES).where('uid', '==', uid).get()
  let last: { direction: string; at: number } | null = null
  for (const d of snap.docs) {
    const at = timestampMs(d.data().at, 0)
    if (!last || at > last.at) last = { direction: String(d.data().direction), at }
  }
  return last
}

/**
 * Clocks the session's person in (a session started) or out (a session
 * ended), when sessionClockAction() says so. Never throws: a clock that could
 * not be written must not stop anyone signing in or out, and the timesheet
 * then shows the gap as it is.
 */
export async function clockForSession(
  event: 'start' | 'end',
  session: { uid: string; scope?: string | null; device?: string },
  { db = adminDb(), now = Date.now(), otherLiveSessions = 0 }: { db?: Firestore; now?: number; otherLiveSessions?: number } = {},
): Promise<ClockDirection | null> {
  try {
    const kitchenScreen = session.scope === 'kds' || session.uid.startsWith('screen:')
    if (kitchenScreen) return null
    const last = await lastClockEntry(db, session.uid)
    const direction = sessionClockAction(event, { kitchenScreen, lastDirection: last?.direction ?? null, otherLiveSessions })
    if (!direction) return null
    const branch = (await db.doc('hubMeta/device').get()).data()?.branch
    if (typeof branch !== 'string' || !branch) return null
    const staff = (await db.doc(`users/${session.uid}`).get()).data() ?? {}
    await db.collection(TIME_ENTRIES).add({
      uid: session.uid, name: typeof staff.firstName === 'string' ? staff.firstName : '', branch, direction,
      at: Timestamp.fromMillis(now), deviceName: session.device ?? '', via: event === 'start' ? 'sign-in' : 'sign-out',
    })
    return direction
  } catch (err) {
    console.error('[hub] a sign-in clock was not written:', err)
    return null
  }
}
