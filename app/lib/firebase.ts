import { initializeApp, getApps } from 'firebase/app'
import {
  getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

export const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

/**
 * Firestore, with offline persistence actually switched on.
 *
 * ── Why this is not a small change ─────────────────────────────────────────
 * Offline is the single property that decided Firestore over Postgres. The
 * project notes are explicit about it: Postgres is the better database for a
 * POS in nearly every dimension — relational check/line/payment modelling,
 * real reporting, real constraints — and loses only on offline, which is a
 * requirement for a café POS in Lebanon rather than a nice-to-have.
 *
 * This file was a bare `getFirestore(app)`. On Firebase JS SDK 12 that is
 * MEMORY CACHE ONLY: nothing survives a reload, let alone a dropped
 * connection. The reason the database was chosen had never been turned on,
 * and Phase 03 is about to build a POS on top of that premise.
 *
 * ── What it does and does not give you ─────────────────────────────────────
 * Cached reads and queued writes. A waiter's phone that loses wifi keeps
 * showing the menu and the open check, and the writes land when it returns.
 *
 * It does NOT solve two terminals both issuing receipt #1041 — that needs
 * block-reserved numbers and belongs to Phase 04. Do not read this as
 * "offline is done".
 *
 * ── The two guards ─────────────────────────────────────────────────────────
 * Server side there is no IndexedDB, and no benefit either: a Node process
 * that lives for one request has nothing to cache for. Thirty-nine modules
 * import this and Next evaluates client components during rendering, so the
 * branch is load-bearing rather than defensive.
 *
 * The catch covers a second initialise on fast refresh, and a browser that
 * refuses IndexedDB — a private window, storage disabled by policy. Falling
 * back to the memory cache keeps the app working online; what is lost is the
 * offline cache, not the app.
 *
 * persistentMultipleTabManager, not the single-tab one: a phone with the
 * order screen open in two tabs would otherwise have the second fail to
 * acquire the lease and lose persistence silently.
 */
function createDb(): Firestore {
  if (typeof window === 'undefined') return getFirestore(app)

  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch {
    return getFirestore(app)
  }
}

export const db   = createDb()
export const auth = getAuth(app)
