// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Loyalty member codes — Phase 04, slice 5. See shared/src/memberCode.ts for
// what a code is and why it is not the uid.
//
// Two collections, both with no Firestore rule, so no browser can read or
// write either:
//
//   memberCodes/{code}       → { uid }    what the till looks a scan up in
//   memberCodeOwners/{uid}   → { code }   so a customer always gets the same one
//
// Not a field on users/{uid}: the owner may edit their own profile document
// except for a list of protected fields, and a code there could be set to
// someone else's.

import { randomInt } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { newMemberCode, normalizeMemberCode } from '../memberCode'
import { getTier } from '../loyaltyTiers'

const CODES = 'memberCodes'
const OWNERS = 'memberCodeOwners'

/**
 * The customer's code, made the first time they ask for it.
 *
 * In a transaction, so two tabs asking at once get one code, not two. A new
 * code that happens to be taken already is simply drawn again — at ~50 bits
 * that is a formality, but a formality that costs nothing to honour.
 */
export async function memberCodeFor(uid: string): Promise<string> {
  const db = adminDb()
  const ownerRef = db.doc(`${OWNERS}/${uid}`)
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = newMemberCode(n => randomInt(n))
    const got = await db.runTransaction(async tx => {
      const owner = await tx.get(ownerRef)
      const existing = owner.data()?.code
      if (typeof existing === 'string' && existing) return existing
      const codeRef = db.doc(`${CODES}/${candidate}`)
      if ((await tx.get(codeRef)).exists) return null
      tx.create(codeRef, { uid, createdAt: FieldValue.serverTimestamp() })
      tx.set(ownerRef, { code: candidate, createdAt: FieldValue.serverTimestamp() })
      return candidate
    })
    if (got) return got
  }
  throw new HttpError(503, 'Could not issue a member code just now. Please try again.')
}

export interface Member {
  uid: string
  /** Username or display name — what the waiter says back to the customer. */
  name: string
  tier: string
  points: number
}

/**
 * Who a scanned or typed code belongs to.
 *
 * Refuses a staff account — staff never collect on their own or anyone's
 * checks, the same line the rules already draw on loyalty transactions — and
 * a wholesale account, which is a shop, not a customer.
 */
export async function resolveMemberCode(raw: unknown): Promise<Member> {
  const code = normalizeMemberCode(raw)
  if (!code) throw new HttpError(400, 'That is not a member code — it should look like ABCD-EFGH-JK.')
  const db = adminDb()
  const snap = await db.doc(`${CODES}/${code}`).get()
  const uid = snap.data()?.uid
  if (!snap.exists || typeof uid !== 'string') throw new HttpError(404, 'No customer has that member code.')

  const user = await db.doc(`users/${uid}`).get()
  if (!user.exists) throw new HttpError(404, 'That member code belongs to an account that no longer exists.')
  const d = user.data() ?? {}
  if (d.isStaff === true) throw new HttpError(403, 'Staff accounts do not collect points.')
  if (d.isWholesale === true) throw new HttpError(403, 'A wholesale account does not collect points.')

  return {
    uid,
    name: String(d.username || d.displayName || 'Customer').slice(0, 60),
    tier: getTier(Number(d.pointsEarned ?? 0)).tier,
    points: Number(d.points ?? 0),
  }
}
