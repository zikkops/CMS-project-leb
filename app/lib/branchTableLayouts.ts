'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp, type Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { logUpdate } from './activityLog'

// One floor-plan layout per branch — doc id is the branch name itself
// (see app/lib/branches.ts), so "does this branch have a layout yet" is a
// plain getDoc/onSnapshot, no query needed. The whole `tables` array is
// always read and written together (the map view needs every table at
// once; the admin editor saves a whole drag/resize/adjacency session in
// one write), so it's embedded here rather than a separate collection —
// this schema has no subcollections anywhere (see ARCHITECTURE.md).
export interface TableMarker {
  id: string             // client-generated (crypto.randomUUID()) — adjacency links and
                          // reservations reference this, not the array index
  number: number
  capacityMin: number     // a table is shown as a range (e.g. "4-6") rather than one
  capacityMax: number     // fixed number — capacityMax is the hard limit used for booking
                          // validation; capacityMin is purely informational
  shape: 'rect' | 'round' | 'hex'
  tableType: 'chairs' | 'couch'   // 'chairs': a normal table with plastic chairs;
                                  // 'couch': an outdoor couch/sectional table that opens in the middle
  x: number               // center position, in pixels relative to the floor-plan image's
  y: number               // *natural* (original upload) resolution — not percent, and not
                          // relative to however large the image happens to be rendered.
                          // Converted to percent-of-container at render time (see
                          // pixelRectToPercent below), which is what actually keeps
                          // positioning responsive across screen sizes — the stored
                          // numbers themselves are real, fixed pixel measurements matching
                          // the source photo, which is what makes them meaningful to type
                          // directly into the admin editor's Size fields.
  width: number           // pixels, same natural-resolution basis as x/y
  height: number          // pixels, same natural-resolution basis as x/y
  rotation: number        // degrees, 0-359
  adjacentTo: string[]    // other TableMarker.id values this one can be joined with —
                          // kept symmetric on every edit, see toggleAdjacency below
  bookable: boolean       // false for a numbered-but-not-really-bookable spot (e.g. a table
                          // already owned by the separate D&D reservation system)
}

// "4-6", or just "4" when min and max are equal — shared formatting so the
// admin editor, the customer map's hover tooltip, and the reservation
// modal all describe a table's capacity identically.
export function capacityLabel(table: { capacityMin: number; capacityMax: number }): string {
  return table.capacityMin === table.capacityMax ? `${table.capacityMax}` : `${table.capacityMin}-${table.capacityMax}`
}

export const TABLE_TYPE_LABELS: Record<TableMarker['tableType'], string> = {
  chairs: 'Table with chairs',
  couch: 'Couch table',
}

// Shared between the admin editor and the customer-facing map so a
// hexagonal table looks identical (and is identically clickable, since
// clip-path also reshapes the hit-test area) in both places. CSS has no
// native hexagon — a flat-top/pointed-sides hexagon needs clip-path,
// border-radius alone only gives rect/round.
export function shapeStyle(shape: TableMarker['shape']): { borderRadius?: string; clipPath?: string } {
  if (shape === 'round') return { borderRadius: '50%' }
  if (shape === 'hex') return { clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' }
  return { borderRadius: '3px' }
}

export interface BranchTableLayout {
  branch: string
  imageUrl: string | null
  imageDeleteUrl: string | null
  imageFileName: string | null
  imageWidth: number | null   // natural (original) pixel dimensions of the floor-plan image,
  imageHeight: number | null  // captured on upload — this is what every table's x/y/width/
                              // height is measured against, and what lets rendering convert
                              // those pixel values back into responsive percent positioning.
  tables: TableMarker[]
  updatedAt: Timestamp | null
  updatedBy: string | null
}

function emptyLayout(branch: string): BranchTableLayout {
  return {
    branch, imageUrl: null, imageDeleteUrl: null, imageFileName: null,
    imageWidth: null, imageHeight: null, tables: [], updatedAt: null, updatedBy: null,
  }
}

// Converts a table's stored pixel rect into percent-of-container CSS values
// — the actual mechanism that keeps positioning responsive despite being
// stored in fixed pixels. Falls back to treating the stored numbers as
// *already* being percent (the original scheme, before sizes were switched
// to pixels) when a layout's imageWidth/imageHeight isn't known yet — this
// is what lets an already-saved layout keep rendering correctly, unchanged,
// right up until an admin re-opens and re-saves it in the editor (which is
// the one place that performs the actual percent -> pixel conversion).
export function pixelRectToPercent(
  table: { x: number; y: number; width: number; height: number },
  imageWidth: number | null,
  imageHeight: number | null
): { leftPct: number; topPct: number; widthPct: number; heightPct: number } {
  if (!imageWidth || !imageHeight) {
    return { leftPct: table.x, topPct: table.y, widthPct: table.width, heightPct: table.height }
  }
  return {
    leftPct: (table.x / imageWidth) * 100,
    topPct: (table.y / imageHeight) * 100,
    widthPct: (table.width / imageWidth) * 100,
    heightPct: (table.height / imageHeight) * 100,
  }
}

// One-time conversion for a layout saved under the old percent-based
// scheme (detected by the absence of imageWidth/imageHeight) — multiplies
// every table's 0-100 percent values by the now-known natural image size
// to produce real pixel measurements. Exact and safe: the image itself
// hasn't changed, so "8% of width" and "0.08 * naturalWidth px" describe
// the identical physical position/size.
export function migratePercentTablesToPixels(tables: TableMarker[], imageWidth: number, imageHeight: number): TableMarker[] {
  return tables.map(t => ({
    ...t,
    x: (t.x / 100) * imageWidth,
    y: (t.y / 100) * imageHeight,
    width: (t.width / 100) * imageWidth,
    height: (t.height / 100) * imageHeight,
  }))
}

// Reads the real pixel dimensions of an uploaded image — needed once per
// upload (to stamp imageWidth/imageHeight) and once per legacy-layout load
// (to perform the percent -> pixel migration above).
export function measureImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not load image to measure its dimensions.'))
    img.src = url
  })
}

// Backfills fields that didn't exist when a layout was first saved (this
// schema has grown a few times: a single `capacity` number became
// capacityMin/capacityMax, and tableType was added after that) — without
// this, a table saved under an older shape would load with those fields
// `undefined`, which then feeds straight into a controlled <input
// value={...}>, React warns "changing a controlled input to uncontrolled",
// and the field silently stops being editable.
function normalizeTable(raw: Partial<TableMarker> & { capacity?: number }): TableMarker {
  const fallbackCapacity = raw.capacity ?? 4
  return {
    id: raw.id ?? crypto.randomUUID(),
    number: raw.number ?? 0,
    capacityMin: raw.capacityMin ?? fallbackCapacity,
    capacityMax: raw.capacityMax ?? fallbackCapacity,
    shape: raw.shape ?? 'rect',
    tableType: raw.tableType ?? 'chairs',
    x: raw.x ?? 50, y: raw.y ?? 50, width: raw.width ?? 8, height: raw.height ?? 8,
    rotation: raw.rotation ?? 0,
    adjacentTo: raw.adjacentTo ?? [],
    bookable: raw.bookable ?? true,
  }
}

// Live per-branch layout. Falls back to an empty, image-less layout if the
// branch has never been set up yet, rather than null — both the admin
// editor (an upload prompt) and the customer map page (a "coming soon"
// message) need a real object to render against immediately.
export function useBranchTableLayout(branch: string | null) {
  const [layout, setLayout] = useState<BranchTableLayout | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!branch) { setLayout(null); setLoading(false); return }
    setLoading(true)
    const unsub = onSnapshot(doc(db, 'branchTableLayouts', branch), snap => {
      if (!snap.exists()) { setLayout(emptyLayout(branch)); setLoading(false); return }
      const data = snap.data() as BranchTableLayout
      setLayout({ ...data, tables: (data.tables ?? []).map(normalizeTable) })
      setLoading(false)
    }, err => console.error('[useBranchTableLayout] listener failed:', err))
    return unsub
  }, [branch])

  return { layout, loading }
}

// Always overwrites the whole doc (not a partial merge) — the editor holds
// the complete, current `tables` array in local state for the whole
// editing session and only commits once, on "Save Layout" (see
// app/admin/branches/tables/page.tsx), so there's nothing to merge against.
// Image fields fall back to whatever was already saved when the caller
// isn't replacing the floor plan in this same save.
export async function saveBranchTableLayout(
  input: {
    branch: string
    tables: TableMarker[]
    imageUrl?: string | null
    imageDeleteUrl?: string | null
    imageFileName?: string | null
    imageWidth?: number | null
    imageHeight?: number | null
    staffUid: string
  },
  before: BranchTableLayout | null
): Promise<void> {
  await setDoc(doc(db, 'branchTableLayouts', input.branch), {
    branch: input.branch,
    imageUrl: input.imageUrl !== undefined ? input.imageUrl : (before?.imageUrl ?? null),
    imageDeleteUrl: input.imageDeleteUrl !== undefined ? input.imageDeleteUrl : (before?.imageDeleteUrl ?? null),
    imageFileName: input.imageFileName !== undefined ? input.imageFileName : (before?.imageFileName ?? null),
    imageWidth: input.imageWidth !== undefined ? input.imageWidth : (before?.imageWidth ?? null),
    imageHeight: input.imageHeight !== undefined ? input.imageHeight : (before?.imageHeight ?? null),
    tables: input.tables,
    updatedAt: serverTimestamp(),
    updatedBy: input.staffUid,
  })

  await logUpdate('Branch Table Layout', input.branch, { tableCount: before?.tables.length ?? 0 }, { tableCount: input.tables.length })
}

export function newTableMarker(existing: TableMarker[], imageWidth: number, imageHeight: number): TableMarker {
  const nextNumber = existing.length === 0 ? 1 : Math.max(...existing.map(t => t.number)) + 1
  return {
    id: crypto.randomUUID(),
    number: nextNumber,
    capacityMin: 4,
    capacityMax: 4,
    shape: 'rect',
    tableType: 'chairs',
    // Centered, sized to ~8% of the image either way — same starting
    // point as before, just expressed in pixels now.
    x: imageWidth / 2, y: imageHeight / 2,
    width: imageWidth * 0.08, height: imageHeight * 0.08,
    rotation: 0,
    adjacentTo: [],
    bookable: true,
  }
}

// Symmetric by construction — toggling A<->B always updates both tables'
// adjacentTo in the same call, so there's never an asymmetric "A links to
// B but not back" state to reconcile elsewhere.
export function toggleAdjacency(tables: TableMarker[], idA: string, idB: string): TableMarker[] {
  const alreadyLinked = tables.find(t => t.id === idA)?.adjacentTo.includes(idB) ?? false
  return tables.map(t => {
    if (t.id === idA) return { ...t, adjacentTo: alreadyLinked ? t.adjacentTo.filter(id => id !== idB) : [...t.adjacentTo, idB] }
    if (t.id === idB) return { ...t, adjacentTo: alreadyLinked ? t.adjacentTo.filter(id => id !== idA) : [...t.adjacentTo, idA] }
    return t
  })
}

// Every table reachable via an adjacency link to *any* already-selected
// table, not every selected table — so a chain of 3+ joined tables only
// needs each new addition to touch one existing neighbor, matching how a
// real row of joined tables works (each table only touches its immediate
// neighbor, not every other table in the row).
export function adjacentSelectableIds(selected: TableMarker[]): Set<string> {
  const selectedIds = new Set(selected.map(t => t.id))
  const selectable = new Set<string>()
  selected.forEach(t => t.adjacentTo.forEach(id => { if (!selectedIds.has(id)) selectable.add(id) }))
  return selectable
}
