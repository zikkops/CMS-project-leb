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
  return getAuth(adminApp())
}

export function adminDb(): Firestore {
  return getFirestore(adminApp())
}

// True when the server layer is configured. Useful for a route that should
// degrade rather than 500 — and for the health check in docs/server-setup.md.
export function isAdminConfigured(): boolean {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT
}
