'use client'

import { useEffect, useRef, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import { useIsMobile } from '../../../lib/useIsMobile'
import { BRANCHES } from '../../../lib/branches'
import {
  useBranchTableLayout, saveBranchTableLayout, newTableMarker, toggleAdjacency, shapeStyle,
  pixelRectToPercent, migratePercentTablesToPixels, measureImage,
  type TableMarker,
} from '../../../lib/branchTableLayouts'
import { uploadImage, recordMediaUpload } from '../../../lib/media'

// The first pointer-event-based drag/resize UI in this codebase (confirmed
// no prior precedent) — plain Pointer Events + percent-based positioning,
// no drag library. Markers store their CENTER (x, y) so the rendered
// transform (translate(-50%, -50%)) can center each box on its anchor
// point; a resize recomputes the center from a fixed top-left corner (held
// in the drag ref) so growing/shrinking a table doesn't visually shift it.

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

interface DragState {
  id: string
  mode: 'move' | 'resize'
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  startLeft: number
  startTop: number
  // Natural-image-pixels per on-screen pixel — converts a pointer's screen
  // movement into the same natural-resolution pixel units tables are
  // stored in, since the image is rendered at `width:100%` and so is
  // usually displayed smaller (or larger) than its real resolution.
  scaleX: number
  scaleY: number
}

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
  fontSize: '0.65rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase' as const,
  color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.4rem',
  fontFamily: 'var(--font-inter)',
}

const btnStyle = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.15)',
  color: 'rgba(245,242,236,0.7)',
  padding: '0.5rem 1rem',
  borderRadius: '2px',
  fontSize: '0.72rem',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  fontFamily: 'var(--font-inter)',
  whiteSpace: 'nowrap' as const,
}

export default function BranchTablesPage() {
  const { checking, user } = useRequireRole(SECTION_ACCESS.branchTables)
  const isMobile = useIsMobile(900)

  const [branch, setBranch] = useState<string>(BRANCHES[0])
  const { layout, loading } = useBranchTableLayout(branch)

  const [editTables, setEditTables] = useState<TableMarker[]>([])
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageDeleteUrl, setImageDeleteUrl] = useState<string | null>(null)
  const [imageFileName, setImageFileName] = useState<string | null>(null)
  const [imageWidth, setImageWidth] = useState<number | null>(null)
  const [imageHeight, setImageHeight] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adjacencyMode, setAdjacencyMode] = useState(false)
  const [adjacencyAnchorId, setAdjacencyAnchorId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [migrating, setMigrating] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  // Local state is the source of truth during an edit session — only
  // re-synced from Firestore when the branch itself changes (not on every
  // remote update, which would otherwise include the admin's own just-saved
  // write echoing back through the live listener and clobbering anything
  // edited in the brief window before that echo arrives).
  useEffect(() => {
    if (!layout) return
    setImageUrl(layout.imageUrl)
    setImageDeleteUrl(layout.imageDeleteUrl)
    setImageFileName(layout.imageFileName)
    setSelectedId(null)
    setAdjacencyAnchorId(null)

    if (!layout.imageUrl) {
      setEditTables(layout.tables)
      setImageWidth(null)
      setImageHeight(null)
      setDirty(false)
      return
    }

    if (layout.imageWidth && layout.imageHeight) {
      // Already on the pixel-based scheme — nothing to convert.
      setEditTables(layout.tables)
      setImageWidth(layout.imageWidth)
      setImageHeight(layout.imageHeight)
      setDirty(false)
      return
    }

    // Saved before tables switched from percent to pixel sizing — measure
    // the real image once, convert every table's stored 0-100 values into
    // real pixels matching that size, and flag the result as unsaved so
    // staff can confirm it with the normal Save Layout button (rather than
    // writing on their behalf the moment a layout happens to load).
    setMigrating(true)
    measureImage(layout.imageUrl).then(({ width, height }) => {
      setEditTables(migratePercentTablesToPixels(layout.tables, width, height))
      setImageWidth(width)
      setImageHeight(height)
      setDirty(layout.tables.length > 0)
    }).catch(err => {
      console.error('[BranchTablesPage] failed to measure existing floor plan for px migration:', err)
      setEditTables(layout.tables)
    }).finally(() => setMigrating(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout?.branch])

  if (checking) return null

  const selected = editTables.find(t => t.id === selectedId) ?? null

  function handleBranchSwitch(next: string) {
    if (next === branch) return
    if (dirty && !confirm('Discard unsaved changes to this branch\'s table layout?')) return
    setBranch(next)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { url, deleteUrl, fileName } = await uploadImage(file)
      const { width, height } = await measureImage(url)
      await recordMediaUpload({ url, deleteUrl, fileName })
      // The previous image (if any) is intentionally left in the shared
      // Media Library rather than auto-deleted here — replacing a floor
      // plan is rare, and staff can clean up an unused image from the
      // existing Media Library page same as any other stale upload.
      setImageUrl(url)
      setImageDeleteUrl(deleteUrl)
      setImageFileName(fileName)
      setImageWidth(width)
      setImageHeight(height)
      setDirty(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleSave() {
    if (!user) return
    setSaving(true)
    try {
      await saveBranchTableLayout(
        { branch, tables: editTables, imageUrl, imageDeleteUrl, imageFileName, imageWidth, imageHeight, staffUid: user.uid },
        layout
      )
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  function handleAddTable() {
    if (!imageWidth || !imageHeight) return
    const table = newTableMarker(editTables, imageWidth, imageHeight)
    setEditTables(prev => [...prev, table])
    setSelectedId(table.id)
    setDirty(true)
  }

  function handleDeleteTable(id: string) {
    setEditTables(prev => prev.filter(t => t.id !== id).map(t => ({ ...t, adjacentTo: t.adjacentTo.filter(a => a !== id) })))
    setSelectedId(null)
    setDirty(true)
  }

  function updateSelected(patch: Partial<TableMarker>) {
    if (!selectedId) return
    setEditTables(prev => prev.map(t => (t.id === selectedId ? { ...t, ...patch } : t)))
    setDirty(true)
  }

  function handleMarkerClick(table: TableMarker) {
    if (!adjacencyMode) return
    if (!adjacencyAnchorId) { setAdjacencyAnchorId(table.id); return }
    if (adjacencyAnchorId === table.id) { setAdjacencyAnchorId(null); return }
    setEditTables(prev => toggleAdjacency(prev, adjacencyAnchorId, table.id))
    setDirty(true)
  }

  function beginDrag(e: React.PointerEvent, table: TableMarker, mode: 'move' | 'resize') {
    if (adjacencyMode || !imageWidth || !imageHeight) return
    e.stopPropagation()
    const rect = containerRef.current!.getBoundingClientRect()
    dragRef.current = {
      id: table.id, mode,
      startClientX: e.clientX, startClientY: e.clientY,
      startX: table.x, startY: table.y,
      startWidth: table.width, startHeight: table.height,
      startLeft: table.x - table.width / 2, startTop: table.y - table.height / 2,
      scaleX: imageWidth / rect.width, scaleY: imageHeight / rect.height,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSelectedId(table.id)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag || !imageWidth || !imageHeight) return
    const deltaX = (e.clientX - drag.startClientX) * drag.scaleX
    const deltaY = (e.clientY - drag.startClientY) * drag.scaleY
    if (drag.mode === 'move') {
      const x = clamp(drag.startX + deltaX, 0, imageWidth)
      const y = clamp(drag.startY + deltaY, 0, imageHeight)
      setEditTables(prev => prev.map(t => (t.id === drag.id ? { ...t, x, y } : t)))
    } else {
      const width = clamp(drag.startWidth + deltaX, 5, imageWidth * 0.6)
      const height = clamp(drag.startHeight + deltaY, 5, imageHeight * 0.6)
      const x = drag.startLeft + width / 2
      const y = drag.startTop + height / 2
      setEditTables(prev => prev.map(t => (t.id === drag.id ? { ...t, width, height, x, y } : t)))
    }
    setDirty(true)
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (dragRef.current) (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  // Deduped so each symmetric A<->B link is only drawn once.
  const adjacencyLines = editTables.flatMap(t =>
    t.adjacentTo
      .filter(id => id > t.id)
      .map(id => editTables.find(o => o.id === id))
      .filter((o): o is TableMarker => !!o)
      .map(o => ({ from: t, to: o }))
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1300px', margin: '0 auto' }}>
        <a href="/admin" style={{
          fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'rgba(245,242,236,0.3)', textDecoration: 'none', fontFamily: 'var(--font-inter)',
          marginBottom: '0.5rem', display: 'block',
        }}>← Back to Dashboard</a>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)', marginBottom: '0.4rem' }}>
          Table Map Editor
        </h1>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', marginBottom: '1.5rem' }}>
          Upload a floor plan and place table markers for each branch
        </p>

        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {BRANCHES.map(b => (
            <button key={b} onClick={() => handleBranchSwitch(b)} style={{
              backgroundColor: branch === b ? 'var(--teal)' : 'transparent',
              border: `1px solid ${branch === b ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
              color: branch === b ? '#fff' : 'rgba(245,242,236,0.6)',
              padding: '0.6rem 1.2rem', borderRadius: '2px', fontSize: '0.78rem',
              cursor: 'pointer', fontFamily: 'var(--font-inter)',
            }}>{b}</button>
          ))}
        </div>

        {loading || migrating ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>
            {migrating ? 'Converting this branch\'s saved layout to the newer pixel-based sizing…' : 'Loading…'}
          </p>
        ) : !imageUrl ? (
          <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px', padding: '3rem', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.4)', marginBottom: '1.2rem' }}>
              No floor plan uploaded yet for {branch}.
            </p>
            <label style={{ ...btnStyle, display: 'inline-block', cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? 'Uploading…' : 'Upload Floor Plan'}
              <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} style={{ display: 'none' }} />
            </label>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ ...btnStyle, display: 'inline-block', cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
                  {uploading ? 'Uploading…' : 'Replace Floor Plan'}
                  <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} style={{ display: 'none' }} />
                </label>
                <button onClick={handleAddTable} style={btnStyle}>+ Add Table</button>
                <button
                  onClick={() => { setAdjacencyMode(m => !m); setAdjacencyAnchorId(null); setSelectedId(null) }}
                  style={{
                    ...btnStyle,
                    backgroundColor: adjacencyMode ? 'var(--purple)' : 'transparent',
                    borderColor: adjacencyMode ? 'var(--purple)' : 'rgba(255,255,255,0.15)',
                    color: adjacencyMode ? '#fff' : 'rgba(245,242,236,0.7)',
                  }}
                >{adjacencyMode ? 'Adjacency Mode: On' : 'Adjacency Mode: Off'}</button>
                <button onClick={handleSave} disabled={!dirty || saving} style={{
                  ...btnStyle,
                  backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
                  opacity: !dirty || saving ? 0.5 : 1, cursor: !dirty || saving ? 'not-allowed' : 'pointer',
                  marginLeft: 'auto',
                }}>{saving ? 'Saving…' : 'Save Layout'}</button>
              </div>
              {adjacencyMode && (
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'var(--purple)', marginBottom: '0.8rem' }}>
                  Click a table, then click another to toggle whether they can be joined for a bigger party. Click the same table again to deselect.
                </p>
              )}

              <div
                ref={containerRef}
                style={{ position: 'relative', width: '100%', userSelect: 'none', touchAction: 'none', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <img src={imageUrl} alt={`${branch} floor plan`} style={{ display: 'block', width: '100%', pointerEvents: 'none' }} />

                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {adjacencyLines.map(({ from, to }) => {
                    const a = pixelRectToPercent(from, imageWidth, imageHeight)
                    const b = pixelRectToPercent(to, imageWidth, imageHeight)
                    return (
                      <line key={`${from.id}-${to.id}`} x1={a.leftPct} y1={a.topPct} x2={b.leftPct} y2={b.topPct}
                        stroke="rgba(155,99,201,0.5)" strokeWidth={0.3} />
                    )
                  })}
                </svg>

                {editTables.map(table => {
                  const isAnchor = adjacencyAnchorId === table.id
                  const isSelected = selectedId === table.id && !adjacencyMode
                  const { leftPct, topPct, widthPct, heightPct } = pixelRectToPercent(table, imageWidth, imageHeight)
                  return (
                    <div
                      key={table.id}
                      onPointerDown={e => beginDrag(e, table, 'move')}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onClick={() => handleMarkerClick(table)}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`, top: `${topPct}%`,
                        width: `${widthPct}%`, height: `${heightPct}%`,
                        transform: `translate(-50%, -50%) rotate(${table.rotation}deg)`,
                        backgroundColor: table.bookable ? 'rgba(0,160,152,0.55)' : 'rgba(20,20,20,0.4)',
                        border: `2px solid ${isAnchor ? 'var(--purple)' : isSelected ? 'var(--teal)' : 'rgba(20,20,20,0.55)'}`,
                        ...shapeStyle(table.shape),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: adjacencyMode ? 'pointer' : 'grab',
                        color: '#fff', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', fontWeight: 600,
                      }}
                    >
                      <span style={{ transform: `rotate(${-table.rotation}deg)`, display: 'inline-block' }}>{table.number}</span>
                      {isSelected && (
                        <div
                          onPointerDown={e => beginDrag(e, table, 'resize')}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerUp}
                          style={{
                            position: 'absolute', right: '-5px', bottom: '-5px',
                            width: '10px', height: '10px', borderRadius: '50%',
                            backgroundColor: 'var(--teal)', border: '1px solid #fff', cursor: 'nwse-resize',
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Inline editor panel for the selected marker */}
            <div>
              {selected && !adjacencyMode ? (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', padding: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                  <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'var(--offwhite)' }}>Table {selected.number}</p>
                  <div>
                    <label style={labelStyle}>Number</label>
                    <input type="number" value={selected.number} onChange={e => updateSelected({ number: Number(e.target.value) })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Capacity Range</label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input type="number" min={1} value={selected.capacityMin}
                        onChange={e => {
                          const min = Number(e.target.value)
                          updateSelected({ capacityMin: min, capacityMax: Math.max(min, selected.capacityMax) })
                        }} style={inputStyle} />
                      <span style={{ color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.8rem' }}>to</span>
                      <input type="number" min={selected.capacityMin} value={selected.capacityMax}
                        onChange={e => updateSelected({ capacityMax: Math.max(selected.capacityMin, Number(e.target.value)) })} style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Shape</label>
                    <select value={selected.shape} onChange={e => updateSelected({ shape: e.target.value as TableMarker['shape'] })} style={{ ...inputStyle, backgroundColor: '#1a1a1a' }}>
                      <option value="rect">Rectangular</option>
                      <option value="round">Round</option>
                      <option value="hex">Hexagonal</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Table Type</label>
                    <select value={selected.tableType} onChange={e => updateSelected({ tableType: e.target.value as TableMarker['tableType'] })} style={{ ...inputStyle, backgroundColor: '#1a1a1a' }}>
                      <option value="chairs">Table with chairs</option>
                      <option value="couch">Couch table</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Size (pixels, matching the uploaded photo)</label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input type="number" min={5} max={Math.round((imageWidth ?? 1000) * 0.6)} step={1} value={Math.round(selected.width)}
                        onChange={e => updateSelected({ width: Math.min((imageWidth ?? 1000) * 0.6, Math.max(5, Number(e.target.value))) })} style={inputStyle} />
                      <span style={{ color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.8rem' }}>×</span>
                      <input type="number" min={5} max={Math.round((imageHeight ?? 1000) * 0.6)} step={1} value={Math.round(selected.height)}
                        onChange={e => updateSelected({ height: Math.min((imageHeight ?? 1000) * 0.6, Math.max(5, Number(e.target.value))) })} style={inputStyle} />
                    </div>
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem' }}>
                      Width × height in real pixels, matching the uploaded floor-plan photo's own resolution ({imageWidth ?? '?'}×{imageHeight ?? '?'}) — useful for setting an exact size precisely, e.g. on a hexagonal table, rather than only dragging the resize handle.
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Rotation — {selected.rotation}°</label>
                    <input
                      type="range" min={0} max={359} step={1}
                      value={selected.rotation}
                      onChange={e => updateSelected({ rotation: Number(e.target.value) })}
                      style={{ width: '100%', marginBottom: '0.6rem' }}
                    />
                    <button
                      onClick={() => updateSelected({ rotation: (selected.rotation + 90) % 360 })}
                      style={{ ...btnStyle, width: '100%' }}
                    >↻ Rotate 90°</button>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.6)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.bookable} onChange={e => updateSelected({ bookable: e.target.checked })} />
                    Bookable by customers
                  </label>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.3)' }}>
                    Adjacent to: {selected.adjacentTo.length === 0 ? 'none' : selected.adjacentTo.map(id => editTables.find(t => t.id === id)?.number ?? '?').join(', ')}
                  </p>
                  <button onClick={() => handleDeleteTable(selected.id)} style={{ ...btnStyle, border: '1px solid rgba(228,51,41,0.3)', color: 'var(--red)' }}>
                    Delete Table
                  </button>
                </div>
              ) : (
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.25)' }}>
                  {adjacencyMode ? 'Click two tables to link them.' : 'Select a table to edit it.'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
