import {
  collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, limit,
  startAfter, serverTimestamp, Timestamp, type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, auth } from './firebase'

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
  await addDoc(collection(db, 'mediaLibrary'), {
    url: item.url,
    deleteUrl: item.deleteUrl ?? null,
    fileName: item.fileName ?? null,
    uploadedBy: auth.currentUser?.email ?? null,
    uploadedAt: serverTimestamp(),
    source: 'upload',
  })
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

export async function deleteMediaItem(item: MediaItem): Promise<void> {
  if (item.deleteUrl) {
    const idToken = await auth.currentUser?.getIdToken()
    await fetch('/api/media/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ deleteUrl: item.deleteUrl }),
    })
  }
  await deleteDoc(doc(db, 'mediaLibrary', item.id))
}

// Images uploaded before this library existed were never recorded — scan
// every place an image can live and add any URL that's missing.
export async function backfillMediaLibrary(): Promise<{ added: number }> {
  const existing = await listMedia(1000)
  const known = new Set(existing.map(m => m.url))
  let added = 0

  for (const { collection: colName } of IMAGE_SOURCES) {
    const snap = await getDocs(collection(db, colName))
    for (const d of snap.docs) {
      const url = (d.data() as { image?: string }).image
      if (!url || known.has(url)) continue
      known.add(url)
      await addDoc(collection(db, 'mediaLibrary'), {
        url,
        deleteUrl: null,
        fileName: url.split('/').pop() ?? null,
        uploadedBy: null,
        uploadedAt: serverTimestamp(),
        source: 'backfill',
      })
      added++
    }
  }
  return { added }
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
