// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The media library: a record of every hosted image, so staff can reuse one
// rather than re-uploading it, and so nothing is deleted out from under a page
// that still shows it.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'

/**
 * Collections that may reference a hosted image, and the field it lives in.
 *
 * Kept in step with IMAGE_SOURCES in app/lib/media.ts, which drives the
 * browser-side warning. Both lists exist because both jobs are real: the
 * browser needs to warn BEFORE the click, and the server needs to enforce
 * AFTER it. If a collection gains an image field, add it here too or a delete
 * will stop noticing it.
 */
const IMAGE_SOURCES: { collection: string; label: string }[] = [
  { collection: 'products', label: 'Product' },
  { collection: 'menuCategories', label: 'Menu Category' },
  { collection: 'events', label: 'Event' },
]

export async function recordUpload(
  item: { url: string; deleteUrl: string | null; fileName: string | null },
  uploadedBy: string,
): Promise<{ id: string }> {
  const url = String(item.url ?? '').trim()
  if (!url) throw new HttpError(400, 'Missing image URL.')

  const ref = await adminDb().collection('mediaLibrary').add({
    url: url.slice(0, 2000),
    deleteUrl: item.deleteUrl ? String(item.deleteUrl).slice(0, 2000) : null,
    fileName: item.fileName ? String(item.fileName).slice(0, 300) : null,
    // From the verified token, not the browser. It used to be
    // auth.currentUser?.email, so the record said whoever the page claimed.
    uploadedBy,
    uploadedAt: FieldValue.serverTimestamp(),
    source: 'upload',
  })
  return { id: ref.id }
}

/** Everywhere a URL is still referenced, described for a human. */
export async function findUsages(url: string): Promise<string[]> {
  const db = adminDb()
  const usages: string[] = []
  for (const { collection, label } of IMAGE_SOURCES) {
    const snap = await db.collection(collection).where('image', '==', url).get()
    snap.docs.forEach(d => {
      const data = d.data()
      usages.push(`${label}: ${data.name ?? data.title ?? d.id}`)
    })
  }
  return usages
}

/**
 * Deletes a library record, refusing while the image is still on a page.
 *
 * The browser already warns — the grid lists what uses the image and asks
 * before calling this. That warning is good and stays, but it was the only
 * thing standing between a delete and a broken image on the storefront:
 * anything calling the delete directly skipped it entirely.
 *
 * `force` is how the informed answer gets through. Someone who has been shown
 * the list and said yes anyway is making a real choice, and the server should
 * not second-guess it — it should just refuse to act on a choice nobody made.
 */
export async function deleteMediaRecord(
  id: string,
  force: boolean,
): Promise<{ url: string; usages: string[] }> {
  const ref = adminDb().doc(`mediaLibrary/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That image is no longer in the library.')

  const url = String(snap.data()?.url ?? '')
  const usages = url ? await findUsages(url) : []

  if (usages.length > 0 && !force) {
    throw new HttpError(409,
      `That image is still used by ${usages.length} item${usages.length === 1 ? '' : 's'} — ${usages.slice(0, 3).join(', ')}${usages.length > 3 ? `, and ${usages.length - 3} more` : ''}. Deleting it will leave ${usages.length === 1 ? 'it' : 'them'} with a broken image.`)
  }

  await ref.delete()
  return { url, usages }
}

/**
 * Adds library records for images uploaded before the library existed.
 *
 * The browser version read the first 1,000 records to build its
 * already-known set. Past that it would stop recognising what it had seen and
 * start adding duplicates of images already in the library — a silent ceiling,
 * and the kind that gets worse the longer it goes unnoticed. This reads the
 * whole collection.
 */
export async function backfillMedia(): Promise<{ added: number; scanned: number }> {
  const db = adminDb()

  const existing = await db.collection('mediaLibrary').select('url').get()
  const known = new Set(existing.docs.map(d => String(d.data().url ?? '')))

  let added = 0
  let scanned = 0

  for (const { collection } of IMAGE_SOURCES) {
    const snap = await db.collection(collection).select('image').get()
    for (const d of snap.docs) {
      scanned++
      const url = String(d.data().image ?? '')
      if (!url || known.has(url)) continue
      known.add(url)
      await db.collection('mediaLibrary').add({
        url,
        deleteUrl: null,
        fileName: url.split('/').pop() ?? null,
        uploadedBy: null,
        uploadedAt: FieldValue.serverTimestamp(),
        source: 'backfill',
      })
      added++
    }
  }

  return { added, scanned }
}
