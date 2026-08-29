// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Branch floor plans: the table markers a customer sees on /tables and books
// against.
//
// This ran in the browser, and `branchTableLayouts` is `allow read: if true` —
// the one collection here that is world-readable, because the public table map
// renders straight off it. So whatever the editor wrote went out to every
// visitor, unvalidated.
//
// The shape is redefined here rather than imported: branchTableLayouts.ts is
// a 'use client' module. Duplicating a dozen field names is the cheap side of
// that trade — and this file has to check them one by one anyway, which an
// imported interface would not do at runtime.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'

const SHAPES = ['rect', 'round', 'hex']
const TABLE_TYPES = ['chairs', 'couch']

// A floor plan with more markers than this is a mistake, not a café.
const MAX_TABLES = 300
// Natural pixel coordinates against the uploaded image, so the ceiling is
// "no plausible image is this big" rather than a layout limit.
const MAX_PX = 20_000

export interface TableMarkerInput {
  id: string
  number: number
  capacityMin: number
  capacityMax: number
  shape: string
  tableType: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  adjacentTo: string[]
  bookable: boolean
}

export interface LayoutInput {
  branch: string
  tables: TableMarkerInput[]
  imageUrl?: string | null
  imageDeleteUrl?: string | null
  imageFileName?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
}

function num(raw: unknown, label: string, { min, max, integer = false }: {
  min: number; max: number; integer?: boolean
}): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number.`)
  if (integer && !Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number.`)
  if (n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}.`)
  return n
}

function optionalNum(raw: unknown, label: string, max: number): number | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  return num(raw, label, { min: 0, max })
}

function optionalStr(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  return String(raw).slice(0, max)
}

export function parseLayoutInput(body: Record<string, unknown>): LayoutInput {
  const branch = String(body.branch ?? '').trim()
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, 'Unknown branch.')
  }

  const raw = Array.isArray(body.tables) ? body.tables : []
  if (raw.length > MAX_TABLES) {
    throw new HttpError(400, `Too many tables (max ${MAX_TABLES}).`)
  }

  const tables: TableMarkerInput[] = raw.map((r, i) => {
    const t = (r ?? {}) as Record<string, unknown>
    const where = `Table ${i + 1}`

    const id = String(t.id ?? '').trim()
    if (!id) throw new HttpError(400, `${where} has no id.`)
    if (id.length > 100) throw new HttpError(400, `${where} has an unusable id.`)

    const capacityMin = num(t.capacityMin, `${where} minimum capacity`, { min: 1, max: 100, integer: true })
    const capacityMax = num(t.capacityMax, `${where} maximum capacity`, { min: 1, max: 100, integer: true })
    // capacityMax is the hard limit a booking is validated against, so a
    // layout where it sits below the minimum would advertise a range no
    // party can actually book.
    if (capacityMax < capacityMin) {
      throw new HttpError(400, `${where} has a maximum capacity below its minimum.`)
    }

    const shape = String(t.shape ?? '')
    if (!SHAPES.includes(shape)) throw new HttpError(400, `${where} has an unknown shape.`)
    const tableType = String(t.tableType ?? '')
    if (!TABLE_TYPES.includes(tableType)) throw new HttpError(400, `${where} has an unknown table type.`)

    const adjacentRaw = Array.isArray(t.adjacentTo) ? t.adjacentTo : []
    const adjacentTo = [...new Set(adjacentRaw.filter((a): a is string => typeof a === 'string'))]

    return {
      id,
      number: num(t.number, `${where} number`, { min: 0, max: 10_000, integer: true }),
      capacityMin,
      capacityMax,
      shape,
      tableType,
      x: num(t.x, `${where} x position`, { min: -MAX_PX, max: MAX_PX }),
      y: num(t.y, `${where} y position`, { min: -MAX_PX, max: MAX_PX }),
      width: num(t.width, `${where} width`, { min: 1, max: MAX_PX }),
      height: num(t.height, `${where} height`, { min: 1, max: MAX_PX }),
      rotation: num(t.rotation, `${where} rotation`, { min: 0, max: 359 }),
      adjacentTo,
      bookable: t.bookable !== false,
    }
  })

  const ids = new Set<string>()
  for (const t of tables) {
    if (ids.has(t.id)) throw new HttpError(400, 'Two tables share the same id.')
    ids.add(t.id)
  }

  // Adjacency has to be symmetric and has to point at tables that exist.
  // toggleAdjacency in the browser keeps it that way, but nothing enforced
  // it: a dangling id survives deleting the table it named, and a one-sided
  // link means joining A to B is offered from one table and not the other.
  for (const t of tables) {
    for (const other of t.adjacentTo) {
      if (!ids.has(other)) {
        throw new HttpError(400, `Table ${t.number} is linked to a table that is not on this plan.`)
      }
      const partner = tables.find(p => p.id === other)
      if (partner && !partner.adjacentTo.includes(t.id)) {
        throw new HttpError(400,
          `Tables ${t.number} and ${partner.number} are linked from one side only.`)
      }
    }
  }

  return {
    branch,
    tables,
    imageUrl: optionalStr(body.imageUrl, 2000),
    imageDeleteUrl: optionalStr(body.imageDeleteUrl, 2000),
    imageFileName: optionalStr(body.imageFileName, 300),
    imageWidth: optionalNum(body.imageWidth, 'Image width', MAX_PX),
    imageHeight: optionalNum(body.imageHeight, 'Image height', MAX_PX),
  }
}

export interface LayoutResult {
  branch: string
  before: number
  after: number
}

/**
 * Writes the whole layout document.
 *
 * Deliberately a full overwrite, matching the editor: it holds the complete
 * table array in local state for the session and commits once on Save Layout,
 * so there is nothing to merge against. The image fields are the exception —
 * undefined means this save isn't replacing the floor plan, so whatever is
 * stored carries over.
 */
export async function saveLayout(caller: Caller, input: LayoutInput): Promise<LayoutResult> {
  const ref = adminDb().doc(`branchTableLayouts/${input.branch}`)
  const snap = await ref.get()
  const existing = snap.exists ? (snap.data() ?? {}) : {}

  const keep = <T>(sent: T | undefined, stored: unknown, fallback: T): T =>
    sent !== undefined ? sent : (stored as T ?? fallback)

  await ref.set({
    branch: input.branch,
    imageUrl: keep(input.imageUrl, existing.imageUrl, null),
    imageDeleteUrl: keep(input.imageDeleteUrl, existing.imageDeleteUrl, null),
    imageFileName: keep(input.imageFileName, existing.imageFileName, null),
    imageWidth: keep(input.imageWidth, existing.imageWidth, null),
    imageHeight: keep(input.imageHeight, existing.imageHeight, null),
    tables: input.tables,
    updatedAt: FieldValue.serverTimestamp(),
    // From the verified token. It was a staffUid the browser passed in.
    updatedBy: caller.uid,
  })

  return {
    branch: input.branch,
    before: Array.isArray(existing.tables) ? existing.tables.length : 0,
    after: input.tables.length,
  }
}
