// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The /api/upload-image and /api/media/delete handlers, written once.
//
// Both apps expose these paths because both genuinely upload images: a
// customer's avatar and check photo on the public site, product and menu and
// event pictures in the admin panel. Each app's route file is a two-line
// re-export of what is here, so the auth checks and the failure messages
// cannot drift apart between the two.

import { verifyIdToken, isStaffToken, getOwnAvatarDeleteUrl, bearerToken } from '../serverAuth'
import {
  validateUpload, uploadToHost, deleteFromHost, isValidDeleteUrl, ImageHostError,
} from './imageHosting'

/**
 * POST /api/upload-image
 *
 * Any signed-in user, customer or staff — both legitimately upload images, so
 * this checks for a valid token rather than for staff.
 */
export async function handleUploadImage(request: Request): Promise<Response> {
  const idToken = bearerToken(request)
  const uid = idToken ? await verifyIdToken(idToken) : null
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const incoming = await request.formData()
    const file = incoming.get('image')
    validateUpload(file)
    return Response.json(await uploadToHost(file))
  } catch (err) {
    if (err instanceof ImageHostError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    )
  }
}

/**
 * POST /api/media/delete
 *
 * Two legitimate callers, and the second is why this is not simply staff-only:
 * a customer replacing their avatar cleans up the old hosted file. They are
 * allowed to delete exactly the delete-url recorded on their own private
 * avatar document and nothing else — otherwise any signed-in customer could
 * pass an arbitrary delete-url they obtained some other way, including
 * somebody else's, and have it actioned.
 */
export async function handleMediaDelete(request: Request): Promise<Response> {
  const idToken = bearerToken(request)
  const uid = idToken ? await verifyIdToken(idToken) : null
  if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { deleteUrl } = await request.json().catch(() => ({ deleteUrl: null }))
  if (!isValidDeleteUrl(deleteUrl)) {
    return Response.json({ error: 'Invalid delete url' }, { status: 400 })
  }

  if (!(await isStaffToken(idToken, uid))) {
    const own = await getOwnAvatarDeleteUrl(idToken, uid)
    if (own !== deleteUrl) return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await deleteFromHost(deleteUrl)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: err instanceof ImageHostError ? err.status : 502 },
    )
  }
}
