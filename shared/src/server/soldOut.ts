// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Marking a dish sold out ("86") at one branch for the rest of the café day,
// from the till (UPGRADE.md T3.5). The rules are shared/src/soldOut.ts; this
// writes `menuItems/{id}.soldOut.<branch>`. On a café hub it runs against the
// hub's own database, where the field survives every pull (keepLocal), so it
// works with no internet.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { BRANCHES } from '../branches'
import { BRAND } from '../brand'
import { readSoldOut, soldOutDay } from '../soldOut'

export async function setSoldOut(
  menuItemId: string,
  branch: string,
  soldOut: boolean,
): Promise<{ name: string; changed: boolean; day: string }> {
  if (!(BRANCHES as readonly string[]).includes(branch) || branch.includes('.')) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }
  if (!menuItemId || menuItemId.includes('/')) throw new HttpError(400, 'Missing menu item.')
  const day = soldOutDay(BRAND.locale.timezone)
  const db = adminDb()
  const ref = db.doc(`menuItems/${menuItemId}`)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That dish is no longer on the menu.')
    const data = snap.data() ?? {}
    const name = String(data.name ?? 'That dish')
    const now = readSoldOut(data.soldOut)[branch] === day
    if (now === soldOut) return { name, changed: false, day }
    tx.update(ref, { [`soldOut.${branch}`]: soldOut ? day : FieldValue.delete() })
    return { name, changed: true, day }
  })
}
