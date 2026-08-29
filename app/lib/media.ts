import {
  collection, getDocs, query, orderBy, limit,
  startAfter, Timestamp, type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, auth } from './firebase'
import { authedFetch, unwrap } from './apiClient'

// `accept="image/*"` on a file input is a picker-dialog hint only — it
// doesn't stop a renamed file or a drag-and-drop from being submitted as a
// non-image, and it puts no cap on size. imgbb itself is the real backstop
// against a genuinely malicious upload, but without this check a user only
// finds out something's wrong after waiting for an upload to imgbb's API
// (using the app's exposed key) to fail. Call this first in every upload
// handler, before doing anything with the file.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Image must be under 5MB.'
  return null
}

export interface UploadResult {
  url: string
  deleteUrl: string | null
  fileName: string | null
}

// Every image upload in the app goes through this — it posts to
// /api/upload-image (server-side proxy) rather than calling api.imgbb.com
// directly with a key embedded in the browser bundle. Validates the file
// first and throws with a message suitable for direct display if it's
// invalid or the upload fails, so callers can just try/catch this one call.
export async function uploadImage(file: File): Promise<UploadResult> {
  const validationError = validateImageFile(file)
  if (validationError) throw new Error(validationError)

  const idToken = await auth.currentUser?.getIdToken()
  const formData = new FormData()
  formData.append('image', file)

  const res = await fetch('/api/upload-image', {
    method: 'POST',
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
    body: formData,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Upload failed')
  return { url: data.url, deleteUrl: data.deleteUrl ?? null, fileName: data.fileName ?? null }
}

export interface MediaItem {
  id: string
  url: string
  deleteUrl: string | null
  fileName: string | null
  uploadedBy: string | null
  uploadedAt: Timestamp | null
  source?: 'upload' | 'backfill'
}

// Collections (and their image field) that may reference a hosted image —
// used both to backfill the library from images uploaded before it existed,
// and to warn before deleting an image that's still in use.
const IMAGE_SOURCES: { collection: string; label: string }[] = [
  { collection: 'products',          label: 'Product' },
  { collection: 'menuCategories', label: 'Menu Category' },
  { collection: 'events',         label: 'Event' },
]

export async function recordMediaUpload(item: {
  url: string
  deleteUrl?: string | null
  fileName?: string | null
}): Promise<void> {
  // uploadedBy comes from the verified token now. It used to be
  // auth.currentUser?.email, so the record said whoever the page claimed.
  await unwrap(await authedFetch('/api/admin/media', 'POST', {
    url: item.url,
    deleteUrl: item.deleteUrl ?? null,
    fileName: item.fileName ?? null,
  }))
}

export async function listMedia(max = 200): Promise<MediaItem[]> {
  const snap = await getDocs(
    query(collection(db, 'mediaLibrary'), orderBy('uploadedAt', 'desc'), limit(max))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as MediaItem))
}

const MEDIA_PAGE_SIZE = 50

export async function listMediaPage(cursor?: QueryDocumentSnapshot | null): Promise<{
  items: MediaItem[]
  cursor: QueryDocumentSnapshot | null
  hasMore: boolean
}> {
  const q = cursor
    ? query(collection(db, 'mediaLibrary'), orderBy('uploadedAt', 'desc'), startAfter(cursor), limit(MEDIA_PAGE_SIZE + 1))
    : query(collection(db, 'mediaLibrary'), orderBy('uploadedAt', 'desc'), limit(MEDIA_PAGE_SIZE + 1))
  const snap = await getDocs(q)
  const hasMore = snap.docs.length > MEDIA_PAGE_SIZE
  const docs = hasMore ? snap.docs.slice(0, MEDIA_PAGE_SIZE) : snap.docs
  return {
    items: docs.map(d => ({ id: d.id, ...d.data() } as MediaItem)),
    cursor: docs.length > 0 ? (docs[docs.length - 1] as QueryDocumentSnapshot) : null,
    hasMore,
  }
}

/**
 * Removes an image from the library, and from the host where it can be.
 *
 * `confirmedInUse` is the answer to the grid's warning arriving at the
 * server. Without it the route refuses while the image is still on a page and
 * says what is using it — the browser check is what tells somebody BEFORE they
 * click, and it was previously the only thing standing between a delete and a
 * broken storefront image.
 *
 * Deliberately required and deliberately not defaulted to true: every caller
 * today reaches this through MediaLibraryGrid, which lists the usages and
 * asks. A default would quietly hand that exemption to the next caller that
 * doesn't.
 *
 * The host delete runs first and its failure is not fatal: leaving a file on
 * imgbb is untidy, but refusing to clear the library record would leave a
 * broken thumbnail nobody can remove.
 */
export async function deleteMediaItem(item: MediaItem, confirmedInUse: boolean): Promise<void> {
  if (item.deleteUrl) {
    const idToken = await auth.currentUser?.getIdToken()
    await fetch('/api/media/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ deleteUrl: item.deleteUrl }),
    }).catch(() => {})
  }
  await unwrap(await authedFetch(
    `/api/admin/media?id=${encodeURIComponent(item.id)}&force=${confirmedInUse ? 'true' : 'false'}`, 'DELETE'))
}

/**
 * Adds library records for images uploaded before the library existed.
 *
 * The scan runs on the server, which also removed a silent ceiling: this used
 * to read the first 1,000 records to build its already-known set, and past
 * that it stopped recognising what it had seen and started adding duplicates
 * of images already in the library.
 */
export async function backfillMediaLibrary(): Promise<{ added: number }> {
  const r = await unwrap(await authedFetch('/api/admin/media', 'POST', { action: 'backfill' }))
  return { added: Number(r.added ?? 0) }
}

// Used to warn before deleting an image that's still referenced somewhere live.
export async function findUsages(url: string): Promise<string[]> {
  const usages: string[] = []
  for (const { collection: colName, label } of IMAGE_SOURCES) {
    const snap = await getDocs(collection(db, colName))
    for (const d of snap.docs) {
      const data = d.data() as { image?: string; name?: string; title?: string }
      if (data.image === url) {
        usages.push(`${label}: ${data.name ?? data.title ?? d.id}`)
      }
    }
  }
  return usages
}
