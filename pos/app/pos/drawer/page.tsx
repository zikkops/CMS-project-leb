'use client'

// The branch cash drawer — Phase 04, slice 4.
//
// Open a shift with a float, take an X reading whenever, close it with a
// note-by-note count. Anyone on the till may do all three (owner's decision,
// 11 Sep 2026); the server logs who did.
//
// Every figure shown comes from the server's shiftTotals() — the X reading
// and the Z close are the same sum, so what the screen said at four o'clock
// is what the close is judged against. The count is compared per currency
// and never netted: a $20 shortfall stays a $20 shortfall however many lira
// are over.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRAND } from '@big-cms/shared/brand'
import {
  LBP_DENOMS, USD_DENOMS, countedCash,
  type DenomCount, type DrawerTotals, type Money2,
} from '@big-cms/shared/drawer'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import {
  useOpenShift, openDrawer, readDrawer, closeDrawer, type ZResult,
} from '../../lib/usePos'

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

const usd = (n: number) => `$${n.toFixed(2)}`
const lbp = (n: number) => `${Math.round(n).toLocaleString('en-US')} LBP`

const tap: React.CSSProperties = {
  minHeight: '48px', padding: '0.7rem 1rem', borderRadius: '6px',
  fontFamily: 'var(--font-inter)', fontSize: '0.9rem', cursor: 'pointer',
}
const input: React.CSSProperties = {
  ...tap, backgroundColor: '#0a0a0a', color: 'var(--offwhite)', cursor: 'text',
  border: '1px solid rgba(255,255,255,0.14)', fontSize: '1rem', textAlign: 'right',
}
const card: React.CSSProperties = {
  backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
  padding: '1.1rem 1rem', marginTop: '1rem',
}
const muted = 'rgba(var(--offwhite-rgb),0.45)'

function Row({ label, value, strong, colour }: { label: string; value: string; strong?: boolean; colour?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0',
      fontSize: strong ? '1rem' : '0.88rem', fontWeight: strong ? 600 : 400,
      color: colour ?? (strong ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.75)'),
    }}>
      <span>{label}</span><span>{value}</span>
    </div>
  )
}

/** What the drawer has seen, per currency. Module scope so it never remounts. */
function Totals({ t }: { t: DrawerTotals }) {
  return (
    <div>
      <Row label="Float" value={`${usd(t.float.usd)} · ${lbp(t.float.lbp)}`} />
      <Row label="Cash taken" value={`${usd(t.cashIn.usd)} · ${lbp(t.cashIn.lbp)}`} />
      <Row label="Change given" value={`−${usd(t.change.usd)} · −${lbp(t.change.lbp)}`} />
      {(t.refunds.usd !== 0 || t.refunds.lbp !== 0) && (
        <Row label="Cash refunds" value={`−${usd(t.refunds.usd)} · −${lbp(t.refunds.lbp)}`} />
      )}
      <Row label="Should be in the drawer" value={`${usd(t.expected.usd)} · ${lbp(t.expected.lbp)}`} strong />
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '0.5rem 0' }} />
      <Row label={`Card (not in the drawer) · ${t.payments} payment${t.payments === 1 ? '' : 's'}`}
        value={`${usd(t.card.usd)} · ${lbp(t.card.lbp)}`} />
    </div>
  )
}

/** One currency's note-by-note count. */
function CountGrid({ denoms, counts, onChange, label, format }: {
  denoms: readonly number[]
  counts: DenomCount
  onChange: (next: DenomCount) => void
  label: string
  format: (n: number) => string
}) {
  return (
    <div style={{ marginTop: '0.9rem' }}>
      <div style={{ fontSize: '0.75rem', color: muted, marginBottom: '0.4rem' }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
        {denoms.map(d => (
          <label key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: muted, minWidth: '5.5rem', textAlign: 'right' }}>{format(d)} ×</span>
            <input
              value={counts[String(d)] ? String(counts[String(d)]) : ''}
              onChange={e => {
                const n = Number(e.target.value.replace(/[^0-9]/g, '') || '0')
                onChange({ ...counts, [String(d)]: n })
              }}
              inputMode="numeric"
              placeholder="0"
              style={{ ...input, width: '100%', minHeight: '40px', padding: '0.4rem 0.6rem' }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

export default function DrawerPage() {
  const { checking, blocked } = useRequireRole(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const isMobile = useIsMobile()
  // Same branch choice as the till's home screen.
  const [branch] = useState(BRAND.branches[0] ?? '')
  const { shift, loading, error: liveError } = useOpenShift(branch)

  const [floatUsd, setFloatUsd] = useState('')
  const [floatLbp, setFloatLbp] = useState('')
  const [x, setX] = useState<DrawerTotals | null>(null)
  const [counting, setCounting] = useState(false)
  const [countUsd, setCountUsd] = useState<DenomCount>({})
  const [countLbp, setCountLbp] = useState<DenomCount>({})
  const [note, setNote] = useState('')
  const [z, setZ] = useState<ZResult | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const say = (err: unknown, fallback: string) => setError(isNetworkFailure(err)
    ? 'No connection — the drawer screen will show the real state as soon as the wifi is back. Check it before trying again.'
    : err instanceof Error ? err.message : fallback)

  async function open() {
    setBusy('Opening…'); setError(''); setZ(null)
    try {
      await openDrawer(branch, { usd: Number(floatUsd || 0), lbp: Number(floatLbp || 0) })
      setFloatUsd(''); setFloatLbp('')
    } catch (err) { say(err, 'Could not open the drawer.') }
    finally { setBusy('') }
  }

  async function reading() {
    if (!shift) return
    setBusy('Reading…'); setError('')
    try { setX((await readDrawer(shift.id)).totals) }
    catch (err) { say(err, 'Could not read the drawer.') }
    finally { setBusy('') }
  }

  async function close() {
    if (!shift) return
    setBusy('Closing…'); setError('')
    try {
      setZ(await closeDrawer(shift.id, countLbp, countUsd, note))
      setCounting(false); setX(null); setCountLbp({}); setCountUsd({}); setNote('')
    } catch (err) { say(err, 'Could not close the drawer.') }
    finally { setBusy('') }
  }

  if (blocked) return null
  if (checking) return null

  const counted: Money2 = countedCash(countLbp, countUsd)
  const diffColour = (n: number) => n < 0 ? 'var(--red)' : n > 0 ? '#C9962C' : 'var(--teal)'

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)', color: 'var(--offwhite)',
      fontFamily: 'var(--font-inter)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <Link href="/pos" style={{ color: muted, fontSize: '0.85rem', textDecoration: 'none' }}>← Tables</Link>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', margin: '0.6rem 0 0.2rem' }}>Drawer</h1>
        <div style={{ color: muted, fontSize: '0.85rem' }}>{branch}</div>

        {(liveError || error) && (
          <p style={{ color: 'var(--red)', fontSize: '0.85rem', marginTop: '1rem', lineHeight: 1.6 }}>
            {error || liveError}
          </p>
        )}

        {z && (
          <div style={card}>
            <div style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', marginBottom: '0.6rem' }}>Shift closed</div>
            <Totals t={z.totals} />
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '0.5rem 0' }} />
            <Row label="Counted" value={`${usd(z.counted.usd)} · ${lbp(z.counted.lbp)}`} strong />
            <Row label="Difference USD" value={`${z.difference.usd > 0 ? '+' : ''}${usd(z.difference.usd)}`}
              colour={diffColour(z.difference.usd)} strong />
            <Row label="Difference LBP" value={`${z.difference.lbp > 0 ? '+' : ''}${lbp(z.difference.lbp)}`}
              colour={diffColour(z.difference.lbp)} strong />
          </div>
        )}

        {loading ? (
          <p style={{ color: muted, marginTop: '1.5rem' }}>Loading the drawer…</p>
        ) : !shift ? (
          <div style={card}>
            <div style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem' }}>Open the drawer</div>
            <p style={{ color: muted, fontSize: '0.82rem', lineHeight: 1.6, margin: '0.4rem 0 0.8rem' }}>
              Count the float going in. The till cannot take payment at {branch} until a shift is open.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input value={floatUsd} onChange={e => setFloatUsd(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal" placeholder="Float $" style={{ ...input, flex: 1 }} />
              <input value={floatLbp} onChange={e => setFloatLbp(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric" placeholder="Float LBP" style={{ ...input, flex: 1 }} />
            </div>
            <button onClick={open} disabled={!!busy} style={{
              ...tap, width: '100%', marginTop: '0.8rem', border: 'none', backgroundColor: 'var(--teal)',
              color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{busy || 'Open shift'}</button>
          </div>
        ) : (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem' }}>
                {shift.status === 'closing' ? 'Closing…' : 'Shift open'}
              </div>
              <div style={{ color: muted, fontSize: '0.78rem' }}>by {shift.openedByEmail.split('@')[0]}</div>
            </div>
            <div style={{ color: muted, fontSize: '0.82rem', marginTop: '0.3rem' }}>
              Float {usd(shift.float.usd)} · {lbp(shift.float.lbp)}
            </div>

            {x && <div style={{ marginTop: '0.9rem' }}><Totals t={x} /></div>}

            {!counting ? (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button onClick={reading} disabled={!!busy} style={{
                  ...tap, flex: 1, backgroundColor: 'transparent', color: 'rgba(var(--offwhite-rgb),0.8)',
                  border: '1px solid rgba(255,255,255,0.14)',
                }}>{busy === 'Reading…' ? busy : 'X reading'}</button>
                <button onClick={() => { setCounting(true); setError('') }} disabled={!!busy} style={{
                  ...tap, flex: 1, border: 'none', backgroundColor: 'var(--red)', color: '#fff',
                }}>Close shift</button>
              </div>
            ) : (
              <>
                <CountGrid label="Dollars in the drawer" denoms={USD_DENOMS} counts={countUsd}
                  onChange={setCountUsd} format={d => `$${d}`} />
                <CountGrid label="Lira in the drawer" denoms={LBP_DENOMS} counts={countLbp}
                  onChange={setCountLbp} format={d => d.toLocaleString('en-US')} />
                <Row label="Counted" value={`${usd(counted.usd)} · ${lbp(counted.lbp)}`} strong />
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
                  style={{ ...input, width: '100%', textAlign: 'left', marginTop: '0.6rem' }} />
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
                  <button onClick={() => setCounting(false)} disabled={!!busy} style={{
                    ...tap, flex: 1, backgroundColor: 'transparent', color: muted,
                    border: '1px solid rgba(255,255,255,0.14)',
                  }}>Back</button>
                  <button onClick={close} disabled={!!busy} style={{
                    ...tap, flex: 2, border: 'none', backgroundColor: 'var(--red)', color: '#fff',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                  }}>{busy === 'Closing…' ? busy : 'Close with this count'}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
