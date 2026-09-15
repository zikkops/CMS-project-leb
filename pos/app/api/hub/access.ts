// Who may read the café hub's live data — shared by /api/hub/changes and
// /api/hub/query (POS software, stage 3). Not a route: no route.ts here.

import { requireStaff, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { adminDb, hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import type { HubStore } from '@big-cms/shared/server/hubStore'
import { SECTION_ACCESS, hasSectionAccess } from '@big-cms/shared/roles'

/** The hub's store, for a staff member who works the floor or the pass. 404 when this server is not a hub. */
export async function requireHubReader(request: Request): Promise<{ store: HubStore; caller: Caller }> {
  if (!hubDbPath()) throw new HttpError(404, 'Not found.')
  const caller = await requireStaff(request)
  // The floor and the kitchen display both read, so either section will do.
  // No grants: the hub holds no staff records yet (stage 4), so the role decides.
  const allowed = hasSectionAccess(caller.role, SECTION_ACCESS.pos, [], 'pos', [])
    || hasSectionAccess(caller.role, SECTION_ACCESS.kds, [], 'kds', [])
  if (!allowed) throw new HttpError(403, 'You do not have permission to do that.')
  return { store: adminDb() as unknown as HubStore, caller }
}
