// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The staff-managed loyalty catalogue: what can be redeemed and what it costs,
// and the perks each tier advertises.
//
// This is money. `coinCost` decides how many points a free burger costs, and a
// browser that can write it can also write 1. The transaction approvals and
// redemption confirmations moved server-side in Phase 00 for exactly that
// reason; the catalogue they operate on stayed behind, which left the cheaper
// half of the same decision in the browser.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { TIER_LABELS } from '../loyaltyTiers'

const MAX_COST = 1_000_000

function text(raw: unknown, label: string, { required = false, maxLen = 200 } = {}): string {
  const v = String(raw ?? '').trim()
  if (required && !v) throw new HttpError(400, `${label} is required.`)
  return v.slice(0, maxLen)
}

export interface RedemptionItemInput {
  name: string
  description: string
  coinCost: number
  isActive: boolean
}

export function parseRedemptionItem(body: Record<string, unknown>): RedemptionItemInput {
  const coinCost = Number(body.coinCost)
  // Not `> 0`: a zero-cost item is a legitimate giveaway. Negative is not, and
  // a fractional point cost has no meaning when balances are integers.
  if (!Number.isInteger(coinCost) || coinCost < 0 || coinCost > MAX_COST) {
    throw new HttpError(400, `Cost must be a whole number between 0 and ${MAX_COST.toLocaleString()}.`)
  }
  return {
    name: text(body.name, 'Name', { required: true }),
    description: text(body.description, 'Description', { maxLen: 500 }),
    coinCost,
    isActive: body.isActive !== false,
  }
}

export async function createRedemptionItem(
  input: RedemptionItemInput,
  actorUid: string,
): Promise<{ id: string }> {
  const ref = await adminDb().collection('redemptionItems').add({
    ...input,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
  })
  return { id: ref.id }
}

export async function updateRedemptionItem(
  id: string,
  input: Partial<RedemptionItemInput>,
): Promise<{ before: Record<string, unknown>; name: string }> {
  const ref = adminDb().doc(`redemptionItems/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That reward no longer exists.')

  const before = snap.data() ?? {}
  await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() })
  return { before, name: String(input.name ?? before.name ?? id) }
}

/**
 * Deletes a reward, refusing while a customer is part-way through claiming it.
 *
 * The check existed already and ran in the browser, which made it advice
 * rather than a rule — anyone calling the delete directly skipped it. Doing it
 * here means the answer is the same however the delete is reached.
 *
 * An existing redemption REQUEST keeps its own snapshot of name, description
 * and cost, so deleting the source item never rewrites history. This is only
 * about the customer standing at the counter right now.
 */
export async function deleteRedemptionItem(id: string): Promise<{ name: string; before: Record<string, unknown> }> {
  const db = adminDb()
  const ref = db.doc(`redemptionItems/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That reward no longer exists.')

  const pending = await db.collection('redemptions')
    .where('itemId', '==', id)
    .where('status', '==', 'pending')
    .limit(1)
    .get()
  if (!pending.empty) {
    throw new HttpError(409, 'Someone is part-way through claiming this reward. Confirm or reject that request first.')
  }

  const before = snap.data() ?? {}
  await ref.delete()
  return { name: String(before.name ?? id), before }
}

// ── Tier perks ────────────────────────────────────────────────────────────

export interface TierPerkInput {
  tier: string
  perk: string
}

export function parseTierPerk(body: Record<string, unknown>): TierPerkInput {
  const tier = text(body.tier, 'Tier', { required: true, maxLen: 50 })
  // Validated against the ladder rather than accepted freely: a perk filed
  // under a tier that does not exist never appears anywhere, and nothing would
  // report it — the perks page groups strictly by TIER_LABELS.
  if (!TIER_LABELS.includes(tier)) {
    throw new HttpError(400, `Unknown tier: ${tier}. Expected one of ${TIER_LABELS.join(', ')}.`)
  }
  return { tier, perk: text(body.perk, 'Perk', { required: true, maxLen: 300 }) }
}

export async function createTierPerk(input: TierPerkInput): Promise<{ id: string }> {
  const ref = await adminDb().collection('tierPerks').add({
    ...input,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function updateTierPerk(id: string, input: TierPerkInput): Promise<{ before: Record<string, unknown> }> {
  const ref = adminDb().doc(`tierPerks/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That perk no longer exists.')
  const before = snap.data() ?? {}
  await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() })
  return { before }
}

export async function deleteTierPerk(id: string): Promise<{ before: Record<string, unknown> }> {
  const ref = adminDb().doc(`tierPerks/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That perk no longer exists.')
  const before = snap.data() ?? {}
  await ref.delete()
  return { before }
}
