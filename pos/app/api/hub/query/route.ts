// One of the till's live queries, answered by the café hub — POS software,
// stage 3.
//
// GET /api/hub/query?q=<a PosQuery as JSON>  →  { docs: [{ id, data }], seq }
//
// `data` is tagged as a backup line is (encodeHubValue), so a Timestamp reaches
// the till as one. `seq` is where the change log stood BEFORE the query ran: a
// watch that later hears of a write past it asks again, rather than trusting an
// answer that might have been read just before that write.
//
// The query arrives as untrusted JSON, so it goes through parsePosQuery() and
// must be scoped, as verify:backend holds every query the till makes to.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { encodeHubValue } from '@big-cms/shared/server/hubStore'
import { runHubPlan } from '@big-cms/shared/server/hubWatch'
import { isScoped, parsePosQuery, planQuery } from '../../../lib/backend/queries'
import { requireHubReader } from '../access'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const store = await requireHubReader(request)

    let raw: unknown
    try {
      raw = JSON.parse(new URL(request.url).searchParams.get('q') ?? '')
    } catch {
      throw new HttpError(400, 'Unknown query.')
    }
    const query = parsePosQuery(raw)
    if (!query) throw new HttpError(400, 'Unknown query.')
    const plan = planQuery(query)
    if (!isScoped(plan)) throw new HttpError(400, 'That query is not limited to a branch.')

    const seq = store.lastSeq()
    const docs = await runHubPlan(store, plan)
    return Response.json(
      { docs: docs.map(d => ({ id: d.id, data: encodeHubValue(d.data) })), seq },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toResponse(err)
  }
}
