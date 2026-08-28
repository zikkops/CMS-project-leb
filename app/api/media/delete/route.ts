// imgbb's delete_url deletes the hosted file when visited — calling it from
// the browser would leak it cross-origin and may get blocked by CORS, so we
// trigger it server-side instead.
//
// Two legitimate callers: staff deleting any item from the media library
// (app/admin/media/page.tsx), and a customer cleaning up their own previous
// avatar's hosted image when they upload a new one (the profile page). A
// customer isn't staff, so they can't be waved through generally — instead
// they're only allowed to delete the exact delete-url already recorded on
// their own `users/{uid}/private/avatar.avatarDeleteUrl`, which stops any
// authenticated customer from passing an arbitrary ibb.co delete-url they
// obtained some other way (e.g. someone else's) and having it actioned.

import { verifyIdToken, isStaffToken, getOwnAvatarDeleteUrl, bearerToken } from '../../../lib/serverAuth'

export async function POST(request: Request) {
  const idToken = bearerToken(request)
  const uid = idToken ? await verifyIdToken(idToken) : null
  if (!uid) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { deleteUrl } = await request.json()
  if (typeof deleteUrl !== 'string' || !/^https:\/\/ibb\.co\//i.test(deleteUrl)) {
    return Response.json({ error: 'Invalid delete url' }, { status: 400 })
  }

  if (!(await isStaffToken(idToken, uid))) {
    const ownDeleteUrl = await getOwnAvatarDeleteUrl(idToken, uid)
    if (ownDeleteUrl !== deleteUrl) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const res = await fetch(deleteUrl)
    if (!res.ok) throw new Error(`imgbb delete failed (${res.status})`)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 }
    )
  }
}
