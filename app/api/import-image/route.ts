// Server-side proxy used by the bulk-import wizard: browsers can't reliably
// download images from arbitrary third-party domains (CORS), but a Node
// fetch has no such restriction. Downloads the source image, then re-hosts
// it on imgbb exactly like the existing manual upload flow does.

import { verifyStaffToken, bearerToken } from '../../lib/serverAuth'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
  const idToken = bearerToken(request)
  if (!idToken || !(await verifyStaffToken(idToken))) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { url } = await request.json()
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return Response.json({ error: 'Invalid image url' }, { status: 400 })
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const imgRes = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!imgRes.ok) throw new Error(`Source image fetch failed (${imgRes.status})`)
    const contentType = imgRes.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) throw new Error('URL did not return an image')

    // Checked before reading the body, so a well-behaved server reporting
    // its real size rejects without ever being downloaded. This isn't
    // airtight against a server that omits Content-Length or under-reports
    // it (chunked transfer, no length header) — that response still gets
    // fully buffered into memory before the post-download check below
    // catches it. A true cap would need to read the body as a stream and
    // abort mid-transfer; not done here since this route is staff-only
    // (see verifyStaffToken above) and the realistic threat model is a
    // compromised staff session, not an anonymous attacker.
    const contentLength = Number(imgRes.headers.get('content-length') ?? 0)
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('Source image is too large (max 10MB)')

    const buffer = Buffer.from(await imgRes.arrayBuffer())
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('Source image is too large (max 10MB)')
    const base64 = buffer.toString('base64')

    const form = new FormData()
    form.append('image', base64)
    form.append('key', process.env.IMGBB_API_KEY ?? '')

    const uploadRes = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form })
    const data = await uploadRes.json()
    if (!data?.data?.url) throw new Error('imgbb upload failed')

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
