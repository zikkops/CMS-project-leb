// Seeing where you are signed in, and ending it from anywhere (UPGRADE.md
// T6.5). Pure, asserted by verify:hub-sync; the hub's side is
// server/hubSession.ts (listHubSessions, endHubSessionById) and the route
// /api/hub/sessions; the cloud's is server/hubDevices.ts.
//
// A session is listed by the hash of its token, never the token. You may end
// your own sessions; a manager or an admin may end anybody's at their hub, for
// instance somebody who went home still signed in on the counter PC.

const ENDERS = ['manager', 'admin'] as const

/** Whether this caller may end a session belonging to `sessionUid`. */
export function canEndSession(caller: { uid: string; role?: string | null; superadmin?: boolean }, sessionUid: string): boolean {
  if (caller.superadmin) return true
  if (caller.uid && caller.uid === sessionUid) return true
  return ENDERS.includes((caller.role ?? '') as typeof ENDERS[number])
}

/** Whether this caller sees every session at the hub, or only their own. */
export const seesEverySession = (caller: { role?: string | null; superadmin?: boolean }): boolean =>
  Boolean(caller.superadmin) || ENDERS.includes((caller.role ?? '') as typeof ENDERS[number])

export const isSessionId = (raw: unknown): raw is string => typeof raw === 'string' && /^[0-9a-f]{64}$/.test(raw)

/** A session as a hub reports it up to the cloud (T6.5): labels and times only. */
export interface ReportedSession { id: string; uid: string; name: string; email: string; device: string; kitchenScreen: boolean; startedAt: number; lastActiveAt: number; expiresAt: number }

export const MAX_REPORTED_SESSIONS = 200

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)

/** What a hub sent, cleaned: anything malformed is left out, never guessed. */
export function readSessionReport(raw: unknown): ReportedSession[] {
  if (!Array.isArray(raw)) return []
  const out: ReportedSession[] = []
  for (const r of raw.slice(0, MAX_REPORTED_SESSIONS)) {
    const s = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    if (!isSessionId(s.id)) continue
    out.push({
      id: s.id, uid: text(s.uid, 128), name: text(s.name, 40), email: text(s.email, 120), device: text(s.device, 60) || 'Till',
      kitchenScreen: s.kitchenScreen === true, startedAt: time(s.startedAt), lastActiveAt: time(s.lastActiveAt), expiresAt: time(s.expiresAt),
    })
  }
  return out
}

/**
 * The end requests still to send the hub: those an admin made for sessions the
 * hub still reports as live. One the hub no longer reports has ended, so the
 * request is done and dropped.
 */
export function pendingEnds(requested: readonly string[], live: readonly ReportedSession[]): string[] {
  const liveIds = new Set(live.map(s => s.id))
  return [...new Set(requested.filter(id => isSessionId(id) && liveIds.has(id)))]
}
