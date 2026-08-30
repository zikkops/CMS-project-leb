'use client'

// The floor: which tables are occupied, and a way into each check.
//
// A grid of numbered buttons rather than the graphical floor plan. The plan
// exists and the customer map renders it, but a waiter on a phone during a
// service wants a target they can hit without looking — and a scaled
// photograph of a room gives 40px targets in the corners. The adjacency graph
// on the layout still matters for joining tables; it just is not what this
// screen is for.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRAND } from '@big-cms/shared/brand'
import { useBranchTableLayout } from '@big-cms/shared/branchTableLayouts'
import { orderedTotal, type Check } from '@big-cms/shared/checks'
import { useOpenChecks, openCheck } from '../lib/usePos'

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
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

const money = (n: number) => `$${n.toFixed(2)}`

/**
 * One table.
 *
 * Module scope, like every other component in this repo: one declared inside a
 * render body is a new type on every state change, so React remounts it and
 * the transition never runs. (CONTRIBUTING.md, gotcha #2.)
 */
function TableButton({
  number, check, onOpen, isMobile,
}: {
  number: number
  check: Check | undefined
  onOpen: () => void
  isMobile: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const occupied = Boolean(check)
  const total = check ? orderedTotal(check.lines) : 0
  const unsent = check ? check.lines.filter(l => l.status === 'draft').length : 0

  return (
    <button
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // 96px minimum: a thumb on a moving floor, not a mouse.
        minHeight: isMobile ? '96px' : '110px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
        backgroundColor: occupied ? 'rgba(0,160,152,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${occupied ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: '4px', cursor: 'pointer',
        color: 'var(--offwhite)', fontFamily: 'var(--font-inter)',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'transform 0.15s ease, background-color 0.15s ease',
        padding: '0.5rem',
      }}
    >
      <span style={{
        fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.7rem',
        lineHeight: 1,
      }}>{number}</span>

      {occupied ? (
        <>
          <span style={{ fontSize: '0.8rem', color: 'var(--teal)', fontWeight: 600 }}>
            {money(total)}
          </span>
          {unsent > 0 && (
            <span style={{
              fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              color: '#C9962C',
            }}>{unsent} unsent</span>
          )}
        </>
      ) : (
        <span style={{
          fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'rgba(245,242,236,0.3)',
        }}>Free</span>
      )}
    </button>
  )
}

export default function FloorPage() {
  // Its own login and its own home: the POS is a separate deployment with no
  // /admin/login in it, and the default would 404 a waiter who is not signed in.
  const { checking } = useRequireRole(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const isMobile = useIsMobile()
  const router = useRouter()

  // One branch for now. The plan ships v1 on one section of one branch, with
  // Omega still taking payment, precisely so a waiter who cannot send an order
  // walks ten steps to the old terminal.
  const [branch] = useState(BRAND.branches[0] ?? '')

  const { layout } = useBranchTableLayout(branch)
  const { checks } = useOpenChecks(branch)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState('')

  const checkByTable = useMemo(() => {
    const m = new Map<string, Check>()
    for (const c of checks) m.set(c.tableId, c)
    return m
  }, [checks])

  const tables = useMemo(
    () => [...(layout?.tables ?? [])].sort((a, b) => a.number - b.number),
    [layout],
  )

  async function handleTable(tableId: string) {
    const existing = checkByTable.get(tableId)
    if (existing) { router.push(`/pos/check/${existing.id}`); return }

    setOpening(tableId)
    setError('')
    try {
      const id = await openCheck(branch, tableId, 2)
      router.push(`/pos/check/${id}`)
    } catch (err) {
      // Most likely someone else opened this table a second before. The
      // message from the route says exactly that, so show it rather than
      // replacing it with something vaguer.
      setError(err instanceof Error ? err.message : 'Could not open that table.')
      setOpening(null)
    }
  }

  if (checking) return null

  const totalOpen = checks.length
  const floorTotal = checks.reduce((sum, c) => sum + orderedTotal(c.lines), 0)

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 2rem 4rem',
      fontFamily: 'var(--font-inter)',
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem',
        }}>
          <div>
            <p style={{
              fontSize: '0.6rem', letterSpacing: '0.25em', textTransform: 'uppercase',
              color: 'var(--teal)', marginBottom: '0.3rem',
            }}>{branch}</p>
            <h1 style={{
              fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.9rem',
              color: 'var(--offwhite)',
            }}>Floor</h1>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'rgba(245,242,236,0.4)' }}>
            {totalOpen} open · {money(floorTotal)}
          </p>
        </div>

        {error && (
          <p style={{
            color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem',
            background: 'rgba(228,51,41,0.08)', border: '1px solid rgba(228,51,41,0.25)',
            borderRadius: '3px', padding: '0.7rem 0.9rem',
          }}>{error}</p>
        )}

        {tables.length === 0 ? (
          <p style={{ color: 'rgba(245,242,236,0.35)', fontSize: '0.88rem', lineHeight: 1.7 }}>
            No tables on this branch’s floor plan yet. Add them in the admin
            panel under Branches → Tables, and they appear here.
          </p>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '90px' : '110px'}, 1fr))`,
            gap: '0.7rem',
          }}>
            {tables.map(t => (
              <TableButton
                key={t.id}
                number={t.number}
                check={checkByTable.get(t.id)}
                onOpen={() => handleTable(t.id)}
                isMobile={isMobile}
              />
            ))}
          </div>
        )}

        {opening && (
          <p style={{
            marginTop: '1rem', fontSize: '0.78rem', color: 'rgba(245,242,236,0.35)',
          }}>Opening…</p>
        )}
      </div>
    </main>
  )
}
