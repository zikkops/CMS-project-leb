// Generic image-upload proxy — keeps the imgbb API key entirely server-side.
// Every upload point in the app (customer avatar, check photo, admin
// game/menu/event/D&D images) goes through this instead of calling
// api.imgbb.com directly from the browser with a key embedded in the JS
// bundle. Any signed-in user (customer or staff) may use this — both
// legitimately upload images — so it checks for a valid token, not staff.

import { verifyIdToken, bearerToken } from '../../lib/serverAuth'

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  const idToken = bearerToken(request)
  const uid = idToken ? await verifyIdToken(idToken) : null
  if (!uid) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const incoming = await request.formData()
  const file = incoming.get('image')
  if (!(file instanceof Blob)) {
    return Response.json({ error: 'No image provided' }, { status: 400 })
  }
  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'File must be an image' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: 'Image must be under 5MB' }, { status: 400 })
  }

  try {
    // Convert to base64 before forwarding — sending the raw Blob in a new
    // FormData loses the content-type header in some runtimes, causing imgbb
    // to silently reject the upload. Base64 is always accepted.
    const buf = await file.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')

    const upstream = new FormData()
    upstream.append('key', process.env.IMGBB_API_KEY ?? '')
    upstream.append('image', base64)

    const uploadRes = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: upstream })
    const data = await uploadRes.json()
    if (!data?.data?.url) throw new Error(data?.error?.message ?? 'imgbb upload failed')

    return Response.json({
      url: data.data.url as string,
      deleteUrl: (data.data.delete_url as string) ?? null,
      fileName: (data.data.image?.filename as string) ?? null,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 }
    )
  }
}
