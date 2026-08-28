// SKU allocation. One global sequence, issued server-side.
//
// Server-side for the same reason invoice numbers are: the counter lives in
// appSettings, which the rules gate to admins only, but a `gamer` may create
// games. A client-side transaction would therefore work for an admin and 403
// for exactly the people who add most of the catalogue. It also honours the
// Phase 00 standing rule — new privileged mutations go behind a route handler.
//
// POST { name, count? } -> { skus: string[] }
//
// The sequence is allocated in one transaction even when several are asked
// for, so a CSV import of 200 games takes 200 consecutive numbers rather than
// interleaving with whoever is adding a game by hand at the same moment.
//
// Gaps are possible and accepted: a number is spent when it is issued, and the
// create that follows may still fail. Same contract as invoice numbering.

import { requireSection, toResponse, HttpError } from '@/app/lib/server/auth'
import { adminDb } from '@/app/lib/server/firebaseAdmin'
import { formatSku } from '@/app/lib/skuFormat'

export const runtime = 'nodejs'

const MAX_BATCH = 500

export async function POST(request: Request) {
  try {
    await requireSection(request, 'games')

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    // `name` only supplies the three letters. It is not stored here and not
    // trusted for anything else.
    const names: string[] = Array.isArray(body.names)
      ? body.names.map(n => String(n ?? ''))
      : [String(body.name ?? '')]

    if (names.length === 0) throw new HttpError(400, 'No name supplied.')
    if (names.length > MAX_BATCH) {
      throw new HttpError(400, `Too many SKUs requested at once (max ${MAX_BATCH}).`)
    }

    const db = adminDb()
    const counterRef = db.doc('appSettings/skuCounter')

    // Reserve the whole block up front. `first` is the first sequence in it.
    let first = 1
    await db.runTransaction(async tx => {
      const snap = await tx.get(counterRef)
      const current = (snap.data()?.nextNumber as number | undefined) ?? 0
      first = current + 1
      tx.set(counterRef, { nextNumber: current + names.length }, { merge: true })
    })

    const skus = names.map((name, i) => formatSku(name, first + i))
    return Response.json({ skus })
  } catch (err) {
    return toResponse(err)
  }
}
