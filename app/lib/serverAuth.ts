// Server-only helpers for Route Handlers. Verifies a Firebase ID token via
// the Identity Toolkit REST API, and does narrowly-scoped Firestore reads
// via the Firestore REST API — instead of the Admin SDK (this app has no
// service account / Admin SDK access — see app/api/import-image/route.ts
// for why). Every Firestore read here is performed *as the calling user*,
// by passing their own idToken as the request's Bearer auth, so it's bound
// by the exact same security rules a client-side `getDoc` from their own
// browser would be. This file grants no access the caller doesn't already
// have — it only lets a route handler check that access server-side.

// Returns the token's uid if it's a valid, currently-active Firebase user —
// null otherwise. This only proves *who* is calling, not what they're
// allowed to do — a signed-in customer's token resolves to a uid here just
// as well as a staff member's does.
export async function verifyIdToken(idToken: string): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  const uid = data.users?.[0]?.localId
  return typeof uid === 'string' ? uid : null
}

function docUrl(path: string): string {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`
}

// `idToken` is passed through as the Bearer auth on the Firestore REST call
// itself — the read happens with the caller's own permissions, not the
// server's, so it 403s exactly when their own browser-side `getDoc` would.
async function ownDocExists(idToken: string, path: string): Promise<boolean> {
  const res = await fetch(docUrl(path), { headers: { Authorization: `Bearer ${idToken}` } })
  return res.ok
}

async function getOwnDocField(idToken: string, path: string, field: string): Promise<string | null> {
  const res = await fetch(docUrl(path), { headers: { Authorization: `Bearer ${idToken}` } })
  if (!res.ok) return null
  const data = await res.json()
  return data.fields?.[field]?.stringValue ?? null
}

export async function isStaffToken(idToken: string, uid: string): Promise<boolean> {
  const res = await fetch(docUrl(`users/${uid}`), { headers: { Authorization: `Bearer ${idToken}` } })
  if (!res.ok) return false
  const data = await res.json()
  return data.fields?.isStaff?.booleanValue === true
}

// Convenience for routes that are *only* ever meant for staff (no legitimate
// customer-initiated case at all) — e.g. the bulk image-import wizard.
export async function verifyStaffToken(idToken: string): Promise<boolean> {
  const uid = await verifyIdToken(idToken)
  return !!uid && (await isStaffToken(idToken, uid))
}

export async function getOwnAvatarDeleteUrl(idToken: string, uid: string): Promise<string | null> {
  return getOwnDocField(idToken, `users/${uid}/private/avatar`, 'avatarDeleteUrl')
}

export function bearerToken(request: Request): string {
  const authHeader = request.headers.get('authorization') ?? ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
}
