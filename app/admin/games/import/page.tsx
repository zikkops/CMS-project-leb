'use client'

import { useEffect, useRef, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../../../lib/firebase'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import { logCreate, logUpdate } from '../../../lib/activityLog'
import { BRANCHES, emptyStock } from '../../../lib/branches'
import { recordMediaUpload } from '../../../lib/media'
import { parseCSV } from '../../../lib/csv'
import { nextSku } from '../../../lib/sku'

type StaticFieldKey =
  | 'sku' | 'name' | 'description' | 'category' | 'price' | 'wholesalePrice'
  | 'stock' | 'image' | 'players' | 'duration' | 'age'

// Per-branch stock columns are generated from BRANCHES, so adding a branch
// there gives it an import column for free.
type FieldKey = StaticFieldKey | `stock:${string}`

const stockKey = (branch: string) => `stock:${branch}` as FieldKey

interface FieldDef { key: FieldKey; label: string; required?: boolean; guesses: string[] }

// Guesses include the exact headers "Export Full CSV" writes, so an exported
// file can be edited in a spreadsheet and imported straight back.
const FIELD_DEFS: FieldDef[] = [
  // Mapped first because it is the identity column: a row carrying a known SKU
  // updates that game even if its name changed in the spreadsheet.
  { key: 'sku',            label: 'SKU',                       guesses: ['sku', 'item sku', 'product sku', 'code'] },
  { key: 'name',           label: 'Game Name', required: true, guesses: ['name', 'product name', 'title'] },
  { key: 'description',    label: 'Description',               guesses: ['description', 'short description'] },
  { key: 'category',       label: 'Category',                  guesses: ['categories', 'category'] },
  { key: 'price',          label: 'Retail Price',              guesses: ['retail price ($)', 'retail price', 'regular price', 'price', 'sale price'] },
  { key: 'wholesalePrice', label: 'Wholesale Price',           guesses: ['wholesale price ($)', 'wholesale price', 'wholesale'] },
  ...BRANCHES.map(b => ({
    key: stockKey(b),
    label: 'Stock — ' + b,
    guesses: ['stock — ' + b.toLowerCase(), 'stock - ' + b.toLowerCase(), 'stock ' + b.toLowerCase(), b.toLowerCase()],
  })),
  { key: 'stock',          label: 'Stock (fallback)',          guesses: ['stock', 'quantity', 'in stock?'] },
  { key: 'image',          label: 'Image URL',                 guesses: ['images', 'image', 'image url'] },
  { key: 'players',        label: 'Players',                   guesses: ['players', 'number of players'] },
  { key: 'duration',       label: 'Duration',                  guesses: ['duration', 'play time', 'playing time'] },
  { key: 'age',            label: 'Min Age',                   guesses: ['min age', 'minimum age', 'age'] },
]

// Only used when no per-branch column is mapped — keeps the single-stock-column
// WooCommerce exports working exactly as before.

const IMPORT_BRANCH = BRANCHES[0]
const FALLBACK_CATEGORY = 'Uncategorized'

function guessMapping(headers: string[]): Record<FieldKey, string> {
  const lower = headers.map(h => h.toLowerCase().trim())
  const mapping = {} as Record<FieldKey, string>
  // A column can only be claimed once. FIELD_DEFS lists the per-branch stock
  // columns before the generic 'stock' fallback, so "Stock — Beirut" is taken
  // by Beirut rather than being swallowed by the fallback's 'stock' substring
  // guess. Exact matches for every field are tried before any fuzzy match, so
  // an exactly-named column is never stolen by an earlier field's substring.
  const used = new Set<string>()
  const claim = (idx: number) => { used.add(headers[idx]); return headers[idx] }

  for (const pass of ['exact', 'fuzzy'] as const) {
    for (const def of FIELD_DEFS) {
      if (mapping[def.key]) continue
      for (const g of def.guesses) {
        const idx = lower.findIndex((h, i) =>
          !used.has(headers[i]) && (pass === 'exact' ? h === g : h.includes(g)))
        if (idx !== -1) { mapping[def.key] = claim(idx); break }
      }
    }
  }
  for (const def of FIELD_DEFS) mapping[def.key] = mapping[def.key] ?? ''
  return mapping
}

function parsePrice(raw: string): number {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Blank wholesale cell means "no wholesale price", which is null on the game
// doc — distinct from 0, which would read as free. Matches how Manage Products
// stores it.
function parseOptionalPrice(raw: string): number | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const n = parseFloat(trimmed.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseQty(raw: string): number {
  const n = parseInt(raw.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

function normalizeCategory(raw: string): string {
  const first = raw.split(',')[0] ?? ''
  const segments = first.split('>')
  const last = segments[segments.length - 1]?.trim() ?? ''
  return last || FALLBACK_CATEGORY
}

interface Results {
  created: number
  updated: number
  unchanged: number
  skippedNoName: number
  // Rows naming a SKU no game owns. Not created and not silently renumbered:
  // a typo'd SKU that quietly became a new game would be worse than a skip.
  skippedUnknownSku: string[]
  imageFailures: number
  categoriesCreated: string[]
}

interface ExistingGame {
  id: string
  stock: Record<string, number>
  sku?: string
  name: string
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isMobile
}

export default function ImportGamesPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.games)
  const isMobile = useIsMobile()
  const fileRef = useRef<HTMLInputElement>(null)

  // Keyed by lowercased name -> doc id + current stock, so a repeat import can
  // update the existing doc instead of skipping the row.
  const [existingGames, setExistingGames]     = useState<Map<string, ExistingGame>>(new Map())
  const [existingCategories, setExistingCategories] = useState<Set<string>>(new Set())
  const [loadingExisting, setLoadingExisting] = useState(true)

  const [fileName, setFileName] = useState('')
  const [headers, setHeaders]   = useState<string[]>([])
  const [rows, setRows]         = useState<Record<string, string>[]>([])
  const [mapping, setMapping]   = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>)
  const [parseError, setParseError] = useState('')

  const [importing, setImporting] = useState(false)
  const [progress, setProgress]   = useState({ done: 0, total: 0 })
  const [results, setResults]     = useState<Results | null>(null)

  useEffect(() => {
    async function load() {
      const [gamesSnap, catSnap] = await Promise.all([
        getDocs(collection(db, 'games')),
        getDocs(collection(db, 'gameCategories')),
      ])
      setExistingGames(new Map(gamesSnap.docs.map(d => {
        const data = d.data() as { name?: string; stock?: Record<string, number> | number; sku?: string }
        const stock = typeof data.stock === 'number'
          ? { ...emptyStock(), [BRANCHES[0]]: data.stock }
          : { ...emptyStock(), ...(data.stock ?? {}) }
        const name = String(data.name ?? '')
        return [name.toLowerCase(), { id: d.id, stock, sku: data.sku, name }] as const
      })))
      setExistingCategories(new Set(catSnap.docs.map(d => String((d.data() as any).name ?? ''))))
      setLoadingExisting(false)
    }
    load()
  }, [])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')
    setResults(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { headers: h, rows: r } = parseCSV(String(reader.result ?? ''))
        if (h.length === 0 || r.length === 0) {
          setParseError('No rows found in this file.')
          return
        }
        setHeaders(h)
        setRows(r)
        setMapping(guessMapping(h))
      } catch {
        setParseError('Could not parse this CSV file.')
      }
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!mapping.name || rows.length === 0) return
    setImporting(true)
    setProgress({ done: 0, total: rows.length })

    const idToken = await auth.currentUser?.getIdToken()
    const games = new Map(existingGames)
    const categories = new Set(existingCategories)
    const categoriesCreated: string[] = []
    const skippedUnknownSku: string[] = []
    let created = 0, updated = 0, unchanged = 0, skippedNoName = 0, imageFailures = 0

    // Second index over the same games, keyed by SKU. Rebuilt from `games` on
    // each lookup would be O(n) per row; built once here and kept in step as
    // rows are created below.
    const bySku = new Map<string, ExistingGame>()
    for (const g of games.values()) {
      if (g.sku) bySku.set(g.sku.toLowerCase(), g)
    }

    // A cell only counts if the column is mapped AND non-empty — that's what
    // makes a blank cell mean "leave this field alone" rather than "clear it".
    const cell = (row: Record<string, string>, col: string | undefined) => {
      if (!col) return null
      const v = (row[col] ?? '').trim()
      return v === '' ? null : v
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const name = (mapping.name ? row[mapping.name] : '').trim()

      if (!name) {
        skippedNoName++
        setProgress({ done: i + 1, total: rows.length })
        continue
      }

      // SKU wins over name when present. That is the whole point of exporting
      // it: the spreadsheet can rename a game and the import still knows which
      // document it means, instead of creating a duplicate under the new name.
      const rowSku = (mapping.sku ? row[mapping.sku] : '').trim()
      let existing: ExistingGame | undefined
      if (rowSku) {
        existing = bySku.get(rowSku.toLowerCase())
        if (!existing) {
          skippedUnknownSku.push(`${rowSku} (${name})`)
          setProgress({ done: i + 1, total: rows.length })
          continue
        }
      } else {
        existing = games.get(name.toLowerCase())
      }

      if (existing) {
        const patch: Record<string, unknown> = {}

        // Only when matched by SKU — a name match cannot have a name change,
        // and `sku` is never patched, so an import can't reassign one.
        if (rowSku && name !== existing.name) patch.name = name

        const desc = cell(row, mapping.description)
        if (desc !== null) patch.description = desc
        const players = cell(row, mapping.players)
        if (players !== null) patch.players = players
        const duration = cell(row, mapping.duration)
        if (duration !== null) patch.duration = duration
        const age = cell(row, mapping.age)
        if (age !== null) patch.age = age

        const priceCell = cell(row, mapping.price)
        if (priceCell !== null) patch.price = parsePrice(priceCell)
        const wholesaleCell = cell(row, mapping.wholesalePrice)
        if (wholesaleCell !== null) patch.wholesalePrice = parseOptionalPrice(wholesaleCell)

        // Merge onto the stock the game already has, so a CSV carrying only
        // Beirut's column can't zero out Zouk, Broummana and Faten.
        const stockPatch: Record<string, number> = {}
        for (const b of BRANCHES) {
          const v = cell(row, mapping[stockKey(b)])
          if (v !== null) stockPatch[b] = parseQty(v)
        }
        if (Object.keys(stockPatch).length === 0) {
          const fallbackCell = cell(row, mapping.stock)
          if (fallbackCell !== null) stockPatch[IMPORT_BRANCH] = parseQty(fallbackCell)
        }
        if (Object.keys(stockPatch).length > 0) {
          patch.stock = { ...existing.stock, ...stockPatch }
        }

        const newCategory = cell(row, mapping.category)
        if (newCategory !== null) {
          const normalized = normalizeCategory(newCategory)
          patch.category = normalized
          if (!categories.has(normalized)) {
            await addDoc(collection(db, 'gameCategories'), { name: normalized, createdAt: serverTimestamp() })
            categories.add(normalized)
            categoriesCreated.push(normalized)
          }
        }

        if (Object.keys(patch).length === 0) {
          unchanged++
        } else {
          await updateDoc(doc(db, 'games', existing.id), { ...patch, updatedAt: serverTimestamp() })
          await logUpdate('Game', name, {}, patch)
          if (patch.stock) {
            games.set(name.toLowerCase(), { ...existing, stock: patch.stock as Record<string, number>, name })
          }
          updated++
        }
        setProgress({ done: i + 1, total: rows.length })
        continue
      }

      const category = normalizeCategory(mapping.category ? row[mapping.category] : '')
      if (!categories.has(category)) {
        await addDoc(collection(db, 'gameCategories'), { name: category, createdAt: serverTimestamp() })
        categories.add(category)
        categoriesCreated.push(category)
      }

      // Per-branch columns win; the single fallback column only applies when
      // none of them are mapped.
      const stock = emptyStock()
      const mappedBranches = BRANCHES.filter(b => mapping[stockKey(b)])
      if (mappedBranches.length > 0) {
        for (const b of mappedBranches) stock[b] = parseQty(row[mapping[stockKey(b)]])
      } else if (mapping.stock) {
        stock[IMPORT_BRANCH] = parseQty(row[mapping.stock])
      }

      let image = ''
      const firstImageUrl = (mapping.image ? row[mapping.image] : '').split(',')[0]?.trim()
      if (firstImageUrl) {
        try {
          const res = await fetch('/api/import-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ url: firstImageUrl }),
          })
          const data = await res.json()
          if (res.ok && data.url) {
            image = data.url
            await recordMediaUpload({ url: data.url, deleteUrl: data.deleteUrl, fileName: data.fileName ?? name })
          } else {
            imageFailures++
          }
        } catch {
          imageFailures++
        }
      }

      const gameData = {
        name,
        category,
        description: mapping.description ? row[mapping.description] : '',
        players:     mapping.players ? row[mapping.players] : '',
        duration:    mapping.duration ? row[mapping.duration] : '',
        age:         mapping.age ? row[mapping.age] : '',
        price:       parsePrice(mapping.price ? row[mapping.price] : ''),
        wholesalePrice: mapping.wholesalePrice ? parseOptionalPrice(row[mapping.wholesalePrice]) : null,
        stock,
        image,
      }

      // One allocation per created row rather than a block up front: the loop
      // only decides create-vs-update as it goes, so a pre-allocated block
      // would have to guess how many it needs and burn the remainder.
      const sku = await nextSku(name)

      const ref = await addDoc(collection(db, 'games'), {
        ...gameData,
        sku,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      await logCreate('Game', name, { ...gameData, sku })

      const createdGame: ExistingGame = { id: ref.id, stock, sku, name }
      games.set(name.toLowerCase(), createdGame)
      bySku.set(sku.toLowerCase(), createdGame)
      created++
      setProgress({ done: i + 1, total: rows.length })
    }

    setResults({ created, updated, unchanged, skippedNoName, skippedUnknownSku, imageFailures, categoriesCreated })
    setExistingGames(games)
    setExistingCategories(categories)
    setImporting(false)
  }

  // Drives the preview's fallback hint: with no per-branch column mapped, all
  // stock lands on the first branch, which is worth showing before importing.
  const anyBranchMapped = BRANCHES.some(b => mapping[stockKey(b)])

  const inputStyle = {
    width: '100%',
    backgroundColor: '#1a1a1a',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#F5F2EC',
    padding: '0.6rem 0.8rem',
    borderRadius: '2px',
    fontSize: '0.82rem',
    outline: 'none',
    fontFamily: 'var(--font-inter)',
  }

  const labelStyle = {
    display: 'block',
    fontSize: '0.68rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase' as const,
    color: 'rgba(245,242,236,0.35)',
    marginBottom: '0.5rem',
    fontFamily: 'var(--font-inter)',
  }

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/games" style={{
            fontSize: '0.7rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)',
            textDecoration: 'none',
            fontFamily: 'var(--font-inter)',
            marginBottom: '0.5rem',
            display: 'block',
          }}>← Back to the Product Catalogue</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
            Bulk Import from WooCommerce
          </h1>
          <p style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '0.8rem',
            color: 'rgba(245,242,236,0.35)',
            marginTop: '0.5rem',
            lineHeight: 1.6,
          }}>
            Upload a CSV — a WooCommerce export, or an Export Full CSV from this panel edited in a spreadsheet. Games that already exist (matched by name) are updated; blank cells are left as they are.
            Imported stock is assigned to the <strong style={{ color: 'var(--teal)' }}>{IMPORT_BRANCH}</strong> branch —
            redistribute across branches afterward in the Product Catalogue. Images are downloaded and re-hosted automatically.
          </p>
        </div>

        {/* Upload */}
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '4px',
          padding: '1.5rem',
          marginBottom: '2rem',
        }}>
          <label style={labelStyle}>CSV File</label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            disabled={importing}
            style={{ ...inputStyle, cursor: 'pointer' }}
          />
          {fileName && (
            <p style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)' }}>
              {fileName} — {rows.length} row{rows.length === 1 ? '' : 's'} found
            </p>
          )}
          {parseError && (
            <p style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: 'var(--red)', fontFamily: 'var(--font-inter)' }}>
              {parseError}
            </p>
          )}
        </div>

        {/* Mapping */}
        {headers.length > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '4px',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}>
            <p style={{
              fontSize: '0.68rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              fontFamily: 'var(--font-inter)',
              marginBottom: '1.2rem',
            }}>Map Columns</p>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
              {FIELD_DEFS.map(def => (
                <div key={def.key}>
                  <label style={labelStyle}>{def.label}{def.required ? ' *' : ''}</label>
                  <select
                    value={mapping[def.key] ?? ''}
                    onChange={e => setMapping(m => ({ ...m, [def.key]: e.target.value }))}
                    disabled={importing}
                    style={{ ...inputStyle, color: '#F5F2EC', backgroundColor: '#1a1a1a' }}
                  >
                    <option value="">— none —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {def.key === 'stock' && anyBranchMapped && (
                    <p style={{ marginTop: '0.3rem', fontSize: '0.68rem', color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>
                      Ignored — per-branch columns are mapped above.
                    </p>
                  )}
                  {def.key === 'stock' && !anyBranchMapped && mapping.stock && (
                    <p style={{ marginTop: '0.3rem', fontSize: '0.68rem', color: 'rgba(201,150,44,0.9)', fontFamily: 'var(--font-inter)' }}>
                      All stock will go to {IMPORT_BRANCH}.
                    </p>
                  )}
                </div>
              ))}
            </div>

            {!mapping.name && (
              <p style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'var(--red)', fontFamily: 'var(--font-inter)' }}>
                Map a column for Game Name to continue.
              </p>
            )}
          </div>
        )}

        {/* Preview */}
        {rows.length > 0 && mapping.name && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '4px',
            padding: '1.5rem',
            marginBottom: '2rem',
            overflowX: 'auto',
          }}>
            <p style={{
              fontSize: '0.68rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              fontFamily: 'var(--font-inter)',
              marginBottom: '1.2rem',
            }}>Preview (first 5 rows)</p>

            <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', fontFamily: 'var(--font-inter)', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Name', 'Category', 'Retail', 'Wholesale', ...BRANCHES, 'Image'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.8rem', color: 'rgba(245,242,236,0.3)', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '0.5rem 0.8rem', color: 'var(--offwhite)' }}>{row[mapping.name] || '—'}</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: 'rgba(245,242,236,0.5)' }}>
                      {mapping.category ? normalizeCategory(row[mapping.category]) : '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.8rem', color: 'rgba(245,242,236,0.5)' }}>
                      {mapping.price ? `${parsePrice(row[mapping.price])}` : '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.8rem', color: 'rgba(245,242,236,0.5)' }}>
                      {(() => {
                        if (!mapping.wholesalePrice) return '—'
                        const w = parseOptionalPrice(row[mapping.wholesalePrice])
                        return w == null ? '—' : `${w}`
                      })()}
                    </td>
                    {BRANCHES.map(b => {
                      const col = mapping[stockKey(b)]
                      const fallback = !anyBranchMapped && b === IMPORT_BRANCH && mapping.stock
                      return (
                        <td key={b} style={{ padding: '0.5rem 0.8rem', color: fallback ? 'rgba(201,150,44,0.9)' : 'rgba(245,242,236,0.5)' }}>
                          {col ? parseQty(row[col]) : fallback ? parseQty(row[mapping.stock]) : '—'}
                        </td>
                      )
                    })}
                    <td style={{ padding: '0.5rem 0.8rem', color: 'rgba(245,242,236,0.5)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {mapping.image ? (row[mapping.image].split(',')[0]?.trim() || '—') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Import action */}
        {rows.length > 0 && mapping.name && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '4px',
            padding: '1.5rem',
          }}>
            <button
              onClick={handleImport}
              disabled={importing || loadingExisting}
              style={{
                backgroundColor: 'var(--purple)',
                color: '#fff',
                padding: '0.8rem 1.5rem',
                border: 'none',
                borderRadius: '2px',
                fontSize: '0.78rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: importing || loadingExisting ? 'not-allowed' : 'pointer',
                opacity: importing || loadingExisting ? 0.6 : 1,
                fontFamily: 'var(--font-inter)',
              }}
            >
              {importing ? `Importing… ${progress.done}/${progress.total}` : `Import ${rows.length} Rows`}
            </button>

            {results && (
              <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--teal)' }}>
                  ✓ {results.created} game{results.created === 1 ? '' : 's'} imported
                </p>
                {results.updated > 0 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: '#C9962C' }}>
                    ✎ {results.updated} existing game{results.updated === 1 ? '' : 's'} updated
                  </p>
                )}
                {results.unchanged > 0 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.5)' }}>
                    {results.unchanged} already present, no mapped values to change
                  </p>
                )}
                {results.skippedNoName > 0 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.5)' }}>
                    {results.skippedNoName} skipped (no name)
                  </p>
                )}
                {results.skippedUnknownSku.length > 0 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--red)' }}>
                    {results.skippedUnknownSku.length} row{results.skippedUnknownSku.length === 1 ? '' : 's'} skipped — the SKU matches no existing game, so nothing was created or renamed:{' '}
                    {results.skippedUnknownSku.slice(0, 8).join(', ')}
                    {results.skippedUnknownSku.length > 8 ? `, and ${results.skippedUnknownSku.length - 8} more` : ''}.
                    {' '}Clear the SKU cell to import these as new games.
                  </p>
                )}
                {results.imageFailures > 0 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--red)' }}>
                    {results.imageFailures} image{results.imageFailures === 1 ? '' : 's'} failed to download — left blank, edit those games to add one manually
                  </p>
                )}
                {results.categoriesCreated.length > 0 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.5)' }}>
                    New categories created: {results.categoriesCreated.join(', ')}
                  </p>
                )}
                <a href="/admin/games" style={{
                  marginTop: '0.6rem',
                  fontSize: '0.78rem',
                  color: 'var(--purple)',
                  fontFamily: 'var(--font-inter)',
                  textDecoration: 'none',
                }}>→ View the Product Catalogue</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
