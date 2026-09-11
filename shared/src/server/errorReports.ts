// Writing an error report down. Phase 05 groundwork, 12 Sep 2026.
//
// What a report may contain is decided in shared/src/errorReport.ts, which is
// pure and asserted by `npm run verify:errors`. This file is the part that
// touches Firestore, and everything in it exists because of one fact:
//
//   /api/errors takes an UNAUTHENTICATED POST.
//
// It has to. A customer whose page breaks on the public site is signed out,
// and that is the error most worth hearing about. So every field arriving here
// is hostile until proven otherwise, and three things are never taken from the
// caller: which app it was (the route knows), the document id (a caller that
// picks the id picks which report to overwrite), and the count.
//
// ── What bounds the cost ───────────────────────────────────────────────────
// One document per distinct fault, keyed by fingerprint, so a render loop
// increments a counter instead of writing a document per frame. The browser
// also holds back (shouldReport()), but a browser is exactly what an attacker
// is not obliged to use — so the day's supply of NEW fingerprints is capped
// here as well. Past the cap, faults already known still count; unknown ones
// are dropped rather than allowed to write without limit.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { buildReport, MAX_BODY_BYTES, type AppName } from '../errorReport'

/**
 * New distinct faults recorded in one day, across all three apps.
 *
 * A real outage produces a handful of fingerprints seen thousands of times,
 * not thousands of fingerprints — so this is generous for the honest case and
 * still a ceiling for the dishonest one.
 */
export const MAX_NEW_PER_DAY = 500

const BUDGET_DOC = 'appSettings/errorBudget'

/**
 * Reads the body without trusting its size.
 *
 * request.json() on an unbounded body is the part that has to be refused
 * before it is parsed, not after.
 */
export async function readErrorBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'That error report is too large.')
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid error report.')
  }
}

export interface RecordedError {
  fingerprint: string
  /** How many times this fault has now been seen. 0 when it was dropped. */
  count: number
  /** False when the day's supply of new fingerprints is spent. */
  stored: boolean
}

/**
 * Records one occurrence.
 *
 * `app` comes from the route, never from the body: each app has its own
 * /api/errors, and which one was called is a fact rather than a claim.
 *
 * The transaction is what makes firstSeenAt mean what it says — a merge would
 * rewrite it on every occurrence, and "first seen" that tracks the latest
 * occurrence is worse than not recording it, because it looks correct.
 */
export async function recordError(
  app: AppName,
  body: Record<string, unknown>,
  today: string,
): Promise<RecordedError> {
  const report = buildReport({
    app,
    message: typeof body.message === 'string' ? body.message : '',
    stack: typeof body.stack === 'string' ? body.stack : '',
    digest: typeof body.digest === 'string' ? body.digest : '',
    path: typeof body.path === 'string' ? body.path : '',
    at: typeof body.at === 'string' ? body.at : '',
  })

  const db = adminDb()
  const ref = db.doc(`errorReports/${report.fingerprint}`)
  const budgetRef = db.doc(BUDGET_DOC)

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)

    if (snap.exists) {
      const seen = Number(snap.data()?.count ?? 0) + 1
      tx.update(ref, {
        count: FieldValue.increment(1),
        lastSeenAt: FieldValue.serverTimestamp(),
        // The newest occurrence replaces the sample: a stack from five minutes
        // ago is more use than one from the first time it ever happened.
        message: report.message,
        stack: report.stack,
        digest: report.digest,
        path: report.path,
        lastAt: report.at,
      })
      return { fingerprint: report.fingerprint, count: seen, stored: true }
    }

    const budgetSnap = await tx.get(budgetRef)
    const budget = budgetSnap.data() ?? {}
    const usedToday = budget.day === today ? Number(budget.newFingerprints ?? 0) : 0
    if (usedToday >= MAX_NEW_PER_DAY) {
      // Deliberately not an error to the caller. A browser cannot fix this and
      // an attacker should not learn where the ceiling is.
      return { fingerprint: report.fingerprint, count: 0, stored: false }
    }

    tx.set(budgetRef, { day: today, newFingerprints: usedToday + 1 }, { merge: true })
    tx.set(ref, {
      app: report.app,
      message: report.message,
      stack: report.stack,
      digest: report.digest,
      path: report.path,
      count: 1,
      firstSeenAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      firstAt: report.at,
      lastAt: report.at,
    })
    return { fingerprint: report.fingerprint, count: 1, stored: true }
  })
}
