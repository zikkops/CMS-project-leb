'use client'

import { useEffect, useState } from 'react'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'
import BranchTableMap from '../components/tables/BranchTableMap'
import TableReservationModal from '../components/tables/TableReservationModal'
import { useIsMobile } from '../lib/useIsMobile'
import { BRANCHES } from '../lib/branches'
import { useBranchTableLayout, adjacentSelectableIds, type TableMarker } from '../lib/branchTableLayouts'

export default function TablesPage() {
  const isMobile = useIsMobile()
  const [branch, setBranch] = useState<string>(BRANCHES[0])
  const { layout, loading } = useBranchTableLayout(branch)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [reserving, setReserving] = useState(false)

  // The selection banner becomes a fixed bar pinned below the Navbar (so
  // it stays visible while scrolling a tall floor plan), which means it no
  // longer pushes the map down on its own — a spacer of the banner's own
  // live-measured height takes its place in normal flow instead, so the
  // map doesn't jump up underneath it. ResizeObserver (not a one-off
  // measurement) keeps this correct if the banner's text wraps
  // differently as the table selection/capacity text changes.
  const [bannerEl, setBannerEl] = useState<HTMLDivElement | null>(null)
  const [bannerHeight, setBannerHeight] = useState(0)
  useEffect(() => {
    if (!bannerEl) { setBannerHeight(0); return }
    const observer = new ResizeObserver(([entry]) => setBannerHeight(entry.contentRect.height))
    observer.observe(bannerEl)
    return () => observer.disconnect()
  }, [bannerEl])

  const bookableTables = (layout?.tables ?? []).filter(t => t.bookable)
  const selectedTables = bookableTables.filter(t => selectedIds.includes(t.id))
  // capacityMax is the hard limit a booking is validated against;
  // capacityMin is shown alongside it purely as a "recommended for" guide.
  const capacityMin = selectedTables.reduce((sum, t) => sum + t.capacityMin, 0)
  const capacityMax = selectedTables.reduce((sum, t) => sum + t.capacityMax, 0)

  // Selection rules: first click picks any bookable table; once 1+ are
  // selected, only tables adjacent to an already-selected one are
  // selectable (so a 3+-table join only needs each addition to touch one
  // existing neighbor, matching how real joined tables work). Clicking an
  // already-selected table always clears the whole selection rather than
  // trying to compute whether removing it would split the remaining
  // selection into disconnected pieces — simpler and safer than
  // graph-connectivity-preserving partial-clear logic.
  const adjacentIds = selectedTables.length > 0 ? adjacentSelectableIds(selectedTables) : new Set<string>()
  const clickableIds = new Set<string>(
    selectedIds.length === 0 ? bookableTables.map(t => t.id) : [...selectedIds, ...adjacentIds]
  )

  function handleToggleTable(table: TableMarker) {
    if (selectedIds.includes(table.id)) { setSelectedIds([]); return }
    setSelectedIds(prev => [...prev, table.id])
  }

  function handleBranchSwitch(next: string) {
    setBranch(next)
    setSelectedIds([])
  }

  return (
    <>
      <Navbar />
      <main>
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: isMobile ? '8rem 1.25rem 3rem' : '9rem 3rem 5rem' }}>
          <p style={{
            fontSize: '0.7rem', letterSpacing: '0.3em', textTransform: 'uppercase',
            color: 'var(--teal)', marginBottom: '1rem', fontFamily: 'var(--font-inter)',
          }}>Reserve a Table</p>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.9rem' : '2.6rem', color: 'var(--offwhite)', marginBottom: '0.9rem' }}>
            Pick a Branch &amp; a Table
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.4)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Party too big for one table?{' '}
            <span style={{ color: 'rgba(245,242,236,0.6)' }}>Select a table, then tap any highlighted neighbour to link them together.</span>
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
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

          {loading ? (
            <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
          ) : !layout?.imageUrl ? (
            <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px', padding: '3rem', textAlign: 'center' }}>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.4)' }}>
                The floor plan for {branch} isn't ready yet — check back soon.
              </p>
            </div>
          ) : (
            <>
              {selectedIds.length === 0 ? (
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.45)', marginBottom: '1rem' }}>
                  Tap a table to select it.
                </p>
              ) : (
                <>
                  {/* Spacer — holds the banner's own live-measured height so
                      fixing it to the viewport doesn't make the map jump up
                      to fill the gap it left behind. */}
                  <div style={{ height: bannerHeight, marginBottom: bannerHeight > 0 ? '1.2rem' : 0 }} />
                  <div
                    ref={setBannerEl}
                    style={{
                      position: 'fixed', top: isMobile ? '64px' : '72px', left: 0, right: 0, zIndex: 40,
                      display: 'flex', justifyContent: 'center',
                      backgroundColor: '#0d1f1e', borderBottom: '1px solid rgba(0,160,152,0.4)',
                      boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
                    }}
                  >
                    <div style={{
                      width: '100%', maxWidth: '1000px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      flexWrap: 'wrap', gap: '0.8rem',
                      padding: isMobile ? '1rem 1.25rem' : '1rem 3rem',
                    }}>
                      <div>
                        <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>
                          Table{selectedTables.length > 1 ? 's' : ''} {selectedTables.map(t => t.number).join(', ')} — seats {capacityMin === capacityMax ? capacityMax : `${capacityMin}-${capacityMax}`}
                        </p>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.5)', marginTop: '0.3rem' }}>
                          {adjacentIds.size > 0
                            ? 'Bigger party? Tap a highlighted adjacent table to combine it with this one. Tap your selection again to start over.'
                            : 'Tap your selection again to start over.'}
                        </p>
                      </div>
                      <button onClick={() => setReserving(true)} style={{
                        backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
                        padding: '0.7rem 1.5rem', borderRadius: '2px', fontSize: '0.75rem',
                        letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'var(--font-inter)',
                        flexShrink: 0,
                      }}>Confirm</button>
                    </div>
                  </div>
                </>
              )}

              <BranchTableMap
                imageUrl={layout.imageUrl}
                imageWidth={layout.imageWidth}
                imageHeight={layout.imageHeight}
                tables={bookableTables}
                selectedIds={selectedIds}
                clickableIds={clickableIds}
                onToggle={handleToggleTable}
              />
            </>
          )}
        </div>
      </main>
      <Footer />

      {reserving && (
        <TableReservationModal
          branch={branch}
          tableIds={selectedTables.map(t => t.id)}
          tableNumbers={selectedTables.map(t => t.number)}
          capacityMin={capacityMin}
          capacityMax={capacityMax}
          onClose={() => setReserving(false)}
          onBack={() => setReserving(false)}
        />
      )}
    </>
  )
}
