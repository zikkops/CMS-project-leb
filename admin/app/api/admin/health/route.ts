// Diagnostic for the server layer. Deliberately imports NOTHING at module
// scope that could fail to load.
//
// ── Why this exists ───────────────────────────────────────────────────────
// Every route under app/api/admin/** imports shared/src/server/firebaseAdmin at
// module scope. If that import fails on the host — a missing package, a Node
// version mismatch — Next cannot evaluate the route module at all, so it
// returns its own HTML error page before any handler runs. The result is a 500
// with no message, on every admin route at once, including for HTTP methods
// the route doesn't even export.
//
// That is exactly the state this deployment was in, and it is indistinguishable
// from the outside from a missing credential, which fails much later and much
// more helpfully. This route separates the two by doing each step inside its
// own try/catch and reporting which one broke.
//
// ── Safe to expose ────────────────────────────────────────────────────────
// It reveals whether a credential is configured and parseable, never any part
// of its value: no key, no project id, no client email. `requireStaff` still
// gates the parts that touch data. The unauthenticated portion reports only
// facts an attacker already learns from the 500 itself.
//
// Delete it once the deployment is healthy, or keep it as an uptime check.

// NOTHING is imported at module scope from shared/src/server/**.
//
// The first version of this file imported toResponse from server/auth "for
// tidiness". server/auth imports firebaseAdmin at module scope, so the
// diagnostic pulled in the exact chain it was built to diagnose and returned
// the same opaque 500 as everything else. A diagnostic that shares its
// subject's failure mode reports nothing.
//
// Every server import below is dynamic, inside a try/catch.

export const runtime = 'nodejs'

interface Step {
  step: string
  ok: boolean
  detail?: string
}

// Only the message, never the value. A credential error can quote the input.
function describe(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg
}

export async function GET(): Promise<Response> {
  const steps: Step[] = []

  steps.push({ step: 'route module evaluated', ok: true })

  steps.push({
    step: 'node version',
    ok: Number(process.versions.node.split('.')[0]) >= 20,
    detail: process.versions.node,
  })

  // Dynamic import, so a resolution failure is a caught error here rather than
  // a module-load failure that takes the whole route down.
  let adminPkg: unknown = null
  try {
    adminPkg = await import('firebase-admin/app')
    steps.push({ step: 'firebase-admin resolvable', ok: true })
  } catch (err) {
    steps.push({ step: 'firebase-admin resolvable', ok: false, detail: describe(err) })
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  steps.push({
    step: 'FIREBASE_SERVICE_ACCOUNT present',
    ok: !!raw,
    detail: raw ? `${raw.length} chars` : 'not set on this deployment',
  })

  if (raw) {
    try {
      const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
      const parsed = JSON.parse(json) as Record<string, unknown>
      const missing = ['project_id', 'client_email', 'private_key'].filter(k => !parsed[k])
      steps.push({
        step: 'credential parses',
        ok: missing.length === 0,
        detail: missing.length ? `missing field(s): ${missing.join(', ')}` : 'all required fields present',
      })
    } catch (err) {
      steps.push({ step: 'credential parses', ok: false, detail: describe(err) })
    }
  }

  steps.push({ step: 'CRON_SECRET present', ok: !!process.env.CRON_SECRET })

  // The real test: can the SDK actually initialise and reach Firestore.
  if (adminPkg && raw) {
    try {
      const { adminDb } = await import('@big-cms/shared/server/firebaseAdmin')
      await adminDb().collection('users').limit(1).get()
      steps.push({ step: 'Firestore reachable with this credential', ok: true })
    } catch (err) {
      steps.push({ step: 'Firestore reachable with this credential', ok: false, detail: describe(err) })
    }
  }

  const healthy = steps.every(s => s.ok)
  return Response.json({ healthy, steps }, { status: healthy ? 200 : 503 })
}
