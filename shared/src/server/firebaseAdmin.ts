// ─────────────────────────────────────────────────────────────────────────────
// SERVER ONLY. Nothing in `shared/src/server/**` may ever be imported from a file
// that carries 'use client', or from any module a client component imports.
// This file reads a service-account private key; if it were ever pulled into a
// browser bundle, that key ships to every visitor.
//
// The rule to remember: `shared/src/server/*` is reachable from `app/api/**`
// route handlers and from `scripts/**` only.
//
// See ARCHITECTURE.md § The Server Layer for why this exists and what it
// unlocked (server-issued sequences, server-computed totals, custom claims,
// real cron, true account deletion).
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { openHubStore, type HubStore, type SqlDatabase } from './hubStore'

// A build-time-ish tripwire. Next.js will usually fail the build first if this
// module ends up in a client bundle, but an explicit throw makes the cause
// obvious instead of surfacing as a cryptic missing-Node-builtin error.
if (typeof window !== 'undefined') {
  throw new Error(
    'shared/src/server/firebaseAdmin.ts was imported from the browser. ' +
    'Server-layer modules must only be imported from app/api/** or scripts/**.'
  )
}

interface ServiceAccountJson {
  project_id?: string
  client_email?: string
  private_key?: string
}

// The credential is stored as ONE env var holding the whole service-account
// JSON, base64-encoded. Base64 rather than raw JSON because the private key is
// a multi-line PEM: pasting it raw into a hosting provider's env-var UI is the
// single most common way this setup breaks (newlines get eaten, or escaped
// twice, and you get an opaque "Invalid PEM formatted message"). Raw JSON is
// still accepted for local convenience — see the `startsWith('{')` branch.
function readServiceAccount(): Required<ServiceAccountJson> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT

  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. Generate a service account key in the ' +
      'Firebase Console (Project settings → Service accounts → Generate new private key), ' +
      'base64-encode the whole JSON file, and set it as FIREBASE_SERVICE_ACCOUNT. ' +
      'See docs/server-setup.md.'
    )
  }

  let parsed: ServiceAccountJson
  try {
    const json = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8')
    parsed = JSON.parse(json) as ServiceAccountJson
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT could not be parsed. It must be the service-account ' +
      'JSON file, either base64-encoded (recommended) or pasted raw.'
    )
  }

  const { project_id, client_email, private_key } = parsed
  if (!project_id || !client_email || !private_key) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT parsed, but is missing project_id, client_email, or ' +
      'private_key. Make sure you copied the whole downloaded JSON file, not a fragment.'
    )
  }

  // Belt and braces: if the JSON was pasted raw and the platform escaped the
  // newlines, turn the literal two-character \n sequences back into newlines.
  // Harmless when the key is already correct (no literal \n to match).
  return {
    project_id,
    client_email,
    private_key: private_key.replace(/\\n/g, '\n'),
  }
}

// Serverless functions are re-used across invocations, so initializeApp() must
// not run twice in the same process — hence the getApps() check, mirroring the
// same pattern shared/src/firebase.ts already uses for the client SDK.
const ADMIN_APP_NAME = 'cms-admin'

function adminApp(): App {
  const existing = getApps().find(a => a.name === ADMIN_APP_NAME)
  if (existing) return getApp(ADMIN_APP_NAME)

  const sa = readServiceAccount()
  return initializeApp(
    {
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      }),
      projectId: sa.project_id,
    },
    ADMIN_APP_NAME
  )
}

// Lazy accessors rather than module-level `export const auth = getAuth(app)`.
// A module-level call would throw at import time on any deploy where the env
// var is missing — including during `next build`, which imports route modules
// to collect their config. Calling these inside a handler means a missing
// credential fails that one request with a clear message, not the whole build.
export function adminAuth(): Auth {
  if (hubDbPath()) {
    // Fails closed: getCaller() turns this into "not signed in". The hub never
    // holds the Admin key, and sign-in there is the staff member's phone
    // (POS software, stage 5), never a Firebase token checked with that key.
    throw new Error('Firebase sign-in is not used on the café hub.')
  }
  return getAuth(adminApp())
}

export function adminDb(): Firestore {
  return hubDb() ?? getFirestore(adminApp())
}

// ── The café hub (POS software, stage 3) ─────────────────────────────────
// On a hub, BIG_CMS_HUB_DB names the SQLite file, and the same server code
// reads and writes it instead of Firestore — see hubStore.ts. The store is
// Firestore-shaped, not a Firestore, hence the cast: verify:hub runs the real
// checks, tickets and drawer code over it to hold that shape to account.

export function hubDbPath(): string | null {
  return process.env.BIG_CMS_HUB_DB || null
}

interface HubHandle { path: string; store: HubStore }

function hubDb(): Firestore | null {
  const path = hubDbPath()
  if (!path) return null
  // On globalThis rather than in a module variable: a dev server can load this
  // module more than once, and two handles on one SQLite file would each
  // believe their own commit was the only one.
  const g = globalThis as { __bigCmsHub?: HubHandle }
  if (!g.__bigCmsHub || g.__bigCmsHub.path !== path) {
    // Looked up at run time, so an online deploy on an older Node never loads it.
    const load = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule
    const sqlite = load?.('node:sqlite') as { DatabaseSync: new (file: string) => SqlDatabase } | undefined
    if (!sqlite) throw new Error('The café hub needs Node 22.13 or later, for node:sqlite.')
    g.__bigCmsHub = { path, store: openHubStore(new sqlite.DatabaseSync(path)) }
  }
  return g.__bigCmsHub.store as unknown as Firestore
}

/**
 * Checks a Firebase sign-in on a café hub, with Google's public keys only.
 *
 * An app with a project id and no credential: verifyIdToken needs nothing
 * more, so the Admin key never goes on the PC. It cannot check revocation (that
 * needs the key), which is why a hub session is short enough to end tonight —
 * see shared/src/server/hubSession.ts.
 */
export function hubTokenVerifier(): Auth {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set.')
  const name = 'cms-hub-verify'
  const existing = getApps().find(a => a.name === name)
  return getAuth(existing ?? initializeApp({ projectId }, name))
}

// True when the server layer is configured. Useful for a route that should
// degrade rather than 500 — and for the health check in docs/server-setup.md.
export function isAdminConfigured(): boolean {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT
}
