// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Talking to the image host, in one place.
//
// Both the customer site and the admin panel upload images — a customer's
// avatar and check photo, a product or menu or event picture — so both apps
// carry a /api/upload-image route. They are thin adapters over this; the
// logic, the key handling and the failure messages live here once.
//
// The key never reaches a browser. That is the whole reason these are routes
// at all rather than a direct call to the host: an API key in client JS is an
// API key anybody can lift and spend.

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export interface UploadedImage {
  url: string
  deleteUrl: string | null
  fileName: string | null
}

export class ImageHostError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function validateUpload(file: unknown): asserts file is Blob {
  if (!(file instanceof Blob)) throw new ImageHostError('No image provided', 400)
  if (!file.type.startsWith('image/')) throw new ImageHostError('File must be an image', 400)
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageHostError('Image must be under 5MB', 400)
}

/**
 * Sends a file to the image host and returns its URLs.
 *
 * Converted to base64 before forwarding — putting the raw Blob in a new
 * FormData loses the content-type header in some runtimes, and the host then
 * rejects the upload with no useful error. Base64 is always accepted.
 */
export async function uploadToHost(file: Blob): Promise<UploadedImage> {
  const buf = await file.arrayBuffer()
  const base64 = Buffer.from(buf).toString('base64')

  const upstream = new FormData()
  upstream.append('key', process.env.IMGBB_API_KEY ?? '')
  upstream.append('image', base64)

  const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: upstream })
  const data = await res.json()
  if (!data?.data?.url) {
    throw new ImageHostError(data?.error?.message ?? 'Image upload failed', 502)
  }

  return {
    url: data.data.url as string,
    deleteUrl: (data.data.delete_url as string) ?? null,
    fileName: (data.data.image?.filename as string) ?? null,
  }
}

/**
 * Removes a hosted file.
 *
 * The host deletes when its delete_url is visited, which is why this runs
 * server-side: calling it from a browser leaks the URL cross-origin and gets
 * blocked by CORS besides.
 */
export async function deleteFromHost(deleteUrl: string): Promise<void> {
  const res = await fetch(deleteUrl)
  if (!res.ok) throw new ImageHostError(`Image host delete failed (${res.status})`, 502)
}

/** The only delete URLs worth actioning. Anything else is not ours. */
export function isValidDeleteUrl(raw: unknown): raw is string {
  return typeof raw === 'string' && /^https:\/\/ibb\.co\//i.test(raw)
}
