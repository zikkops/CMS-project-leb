// The media library.
//
// POST    record an uploaded image, or run the backfill
// DELETE  remove a record, refusing while the image is still on a page
//
// Any staff account, matching the navigation: media is granted to ALL_ROLES
// because every content screen has a picture on it, and there is deliberately
// no SECTION_ACCESS key for it to be revoked through.

import { requireStaff, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { recordUpload, deleteMediaRecord, backfillMedia } from '@big-cms/shared/server/media'
import { logActivity, logDelete } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireStaff(request)

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    if (body.action === 'backfill') {
      const result = await backfillMedia()
      await logActivity(caller, 'create', 'Media Library',
        `Backfill — ${result.added} image${result.added === 1 ? '' : 's'} added from ${result.scanned} record(s) scanned`)
      return Response.json({ ok: true, ...result })
    }

    // Deliberately not logged. An upload is already visible as the change it
    // was made for — a new product, a menu photo — and an entry per image
    // would bury those.
    const { id } = await recordUpload({
      url: String(body.url ?? ''),
      deleteUrl: body.deleteUrl ? String(body.deleteUrl) : null,
      fileName: body.fileName ? String(body.fileName) : null,
    }, caller.email ?? '')

    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireStaff(request)
    const url = new URL(request.url)
    const id = url.searchParams.get('id') ?? ''
    if (!id) throw new HttpError(400, 'Missing image id.')

    // The browser shows what uses the image and asks first. `force` is that
    // answer arriving — without it the server refuses and says what is in the
    // way, so a delete reached any other route cannot skip the warning.
    const force = url.searchParams.get('force') === 'true'
    const result = await deleteMediaRecord(id, force)

    await logDelete(caller, 'Media Library', result.url.split('/').pop() ?? id, {
      url: result.url,
      ...(result.usages.length > 0 ? { deletedWhileInUseBy: result.usages } : {}),
    })
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
