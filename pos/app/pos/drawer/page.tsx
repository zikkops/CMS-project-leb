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
//
// ── Look (14 Sep 2026) ─────────────────────────────────────────────────────
// Controls from pos/app/lib/posUi.tsx. "Close shift" was the loudest thing on
// the screen — solid red beside a grey X reading — although it is the rarer
// and weightier of the two; it is an outline now, and only the final "Close
// with this count" is solid. A difference carries an icon as well as a colour.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faCashRegister, faReceipt, faLock, faCircleCheck, faTriangleExclamation,
  faCircleQuestion, faMoneyBillWave, faCoins, faTimes,
} from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useTillAccess } from '../../lib/useTillAccess'
import { BRAND } from '@big-cms/shared/brand'
import {
  LBP_DENOMS, USD_DENOMS, countedCash,
  type DenomCount, type DrawerTotals, type Money2,
} from '@big-cms/shared/drawer'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import {
  useOpenShift, openDrawer, readDrawer, closeDrawer, type ZResult,
} from '../../lib/usePos'
import { PosButton, StatusBadge, SectionLabel, PosLoading } from '../../lib/posUi'
import { useHubOnly, HubOnlyBanner } from '../../lib/useHubOnly'

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

const input: React.CSSProperties = {
  minHeight: '56px', padding: '0.6rem 0.9rem', borderRadius: '10px',
  backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--offwhite)',
  border: '2px solid rgba(255,255,255,0.16)', fontSize: '1.1rem', textAlign: 'right',
  fontFamily: 'var(--font-inter)', outline: 'none', boxSizing: 'border-box',
}
const card: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px',
  padding: '1.1rem 1.2rem', marginTop: '1rem',
}
const muted = 'rgba(var(--offwhite-rgb),0.6)'

function Row({ label, value, strong, colour, icon }: { label: string; value: string; strong?: boolean; colour?: string; icon?: typeof faCircleCheck }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', padding: '0.35rem 0',
      fontSize: strong ? '1.08rem' : '0.98rem', fontWeight: strong ? 700 : 400,
      color: colour ?? (strong ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.82)'),
    }}>
      <span>{icon && <FontAwesomeIcon icon={icon} style={{ marginRight: '0.45rem' }} />}{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
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
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />
      <Row label={`Card (not in the drawer) · ${t.payments} payment${t.payments === 1 ? '' : 's'}`}
        value={`${usd(t.card.usd)} · ${lbp(t.card.lbp)}`} />
    </div>
  )
}

/** One currency's note-by-note count. */
function CountGrid({ denoms, counts, onChange, label, format, icon, isMobile }: {
  denoms: readonly number[]
  counts: DenomCount
  onChange: (next: DenomCount) => void
  label: string
  format: (n: number) => string
  icon: typeof faCircleCheck
  isMobile: boolean
}) {
  return (
    <div>
      <SectionLabel icon={icon}>{label}</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: '0.55rem' }}>
        {denoms.map(d => (
          <label key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--offwhite)', minWidth: '5.8rem', textAlign: 'right' }}>{format(d)} ×</span>
            <input
              value={counts[String(d)] ? String(counts[String(d)]) : ''}
              onChange={e => {
                const n = Number(e.target.value.replace(/[^0-9]/g, '') || '0')
                onChange({ ...counts, [String(d)]: n })
              }}
              inputMode="numeric"
              placeholder="0"
              style={{ ...input, width: '100%', minHeight: '52px' }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

export default function DrawerPage() {
  const { checking, blocked } = useTillAccess(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const isMobile = useIsMobile()
  const router = useRouter()
  // Same branch choice as the till's home screen.
  const [branch] = useState(BRAND.branches[0] ?? '')
  const { shift, loading, error: liveError } = useOpenShift(branch)
  const hubOnly = useHubOnly(branch)

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
  if (checking) return <PosLoading />

  const counted: Money2 = countedCash(countLbp, countUsd)
  // Short is red, exact is teal, over is the palette's third colour — over is
  // a question to answer, not a loss, so it should not share short's alarm.
  // Each carries its own icon too, so the difference is never colour alone.
  const diffColour = (n: number) => n < 0 ? 'var(--red)' : n > 0 ? 'var(--purple)' : 'var(--teal)'
  const diffIcon = (n: number) => n < 0 ? faTriangleExclamation : n > 0 ? faCircleQuestion : faCircleCheck
  const diffWord = (n: number) => n < 0 ? 'short' : n > 0 ? 'over' : 'exact'

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)', color: 'var(--offwhite)',
      fontFamily: 'var(--font-inter)', padding: isMobile ? '1.25rem 1rem 3rem' : '1.75rem 1.5rem 4rem',
    }}>
      <div style={{ maxWidth: '820px', margin: '0 auto' }}>
        {/* "Floor", as every other POS screen calls it — this said "Tables". */}
        <PosButton icon={faArrowLeft} label="Floor" tone="quiet" size="sm" onClick={() => router.push('/pos')} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.8rem', margin: '0.9rem 0 0.2rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.3rem' }}>Drawer</h1>
          <span style={{ color: muted, fontSize: '1rem' }}>{branch}</span>
        </div>

        <HubOnlyBanner hub={hubOnly} branch={branch} isMobile={isMobile} />

        {(liveError || error) && (
          <p style={{
            color: 'var(--red)', fontSize: '0.98rem', marginTop: '1rem', lineHeight: 1.6,
            background: 'rgba(var(--red-rgb),0.1)', border: '1px solid rgba(var(--red-rgb),0.35)',
            borderRadius: '8px', padding: '0.85rem 1rem',
          }}><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.5rem' }} />{error || liveError}</p>
        )}

        {z && (
          <div style={card}>
            <SectionLabel icon={faLock}>Shift closed</SectionLabel>
            <Totals t={z.totals} />
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />
            <Row label="Counted" value={`${usd(z.counted.usd)} · ${lbp(z.counted.lbp)}`} strong />
            <Row label={`Dollars — ${diffWord(z.difference.usd)}`} value={`${z.difference.usd > 0 ? '+' : ''}${usd(z.difference.usd)}`}
              colour={diffColour(z.difference.usd)} icon={diffIcon(z.difference.usd)} strong />
            <Row label={`Lira — ${diffWord(z.difference.lbp)}`} value={`${z.difference.lbp > 0 ? '+' : ''}${lbp(z.difference.lbp)}`}
              colour={diffColour(z.difference.lbp)} icon={diffIcon(z.difference.lbp)} strong />
          </div>
        )}

        {loading ? (
          <p style={{ color: muted, marginTop: '1.5rem', fontSize: '1rem' }}>Loading the drawer…</p>
        ) : !shift ? (
          <div style={card}>
            <SectionLabel icon={faCashRegister}>Open the drawer</SectionLabel>
            <p style={{ color: muted, fontSize: '0.98rem', lineHeight: 1.6, margin: '0 0 0.9rem' }}>
              Count the float going in. The till cannot take payment at {branch} until a shift is open.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.6rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem', color: muted }}>
                <span><FontAwesomeIcon icon={faMoneyBillWave} style={{ marginRight: '0.4rem' }} />Float in dollars</span>
                <input value={floatUsd} onChange={e => setFloatUsd(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal" placeholder="$0" style={input} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem', color: muted }}>
                <span><FontAwesomeIcon icon={faCoins} style={{ marginRight: '0.4rem' }} />Float in lira</span>
                <input value={floatLbp} onChange={e => setFloatLbp(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric" placeholder="0 LBP" style={input} />
              </label>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <PosButton icon={faCashRegister} label={busy === 'Opening…' ? 'Opening…' : 'Open shift'} tone="primary" size="lg" full
                disabled={!!busy} onClick={open} />
            </div>
          </div>
        ) : (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <StatusBadge icon={shift.status === 'closing' ? faLock : faCashRegister} tone={shift.status === 'closing' ? 'warn' : 'primary'}
                label={shift.status === 'closing' ? 'Closing…' : 'Shift open'} />
              <span style={{ color: muted, fontSize: '0.92rem' }}>opened by {shift.openedByEmail.split('@')[0]}</span>
            </div>
            <p style={{ color: muted, fontSize: '0.98rem', marginTop: '0.6rem' }}>
              Float {usd(shift.float.usd)} · {lbp(shift.float.lbp)}
            </p>

            {x && <div style={{ marginTop: '0.9rem' }}><Totals t={x} /></div>}

            {!counting ? (
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.1rem', flexWrap: 'wrap' }}>
                <PosButton icon={faReceipt} label={busy === 'Reading…' ? 'Reading…' : 'X reading'} tone="neutral" grow={1}
                  disabled={!!busy} onClick={reading} />
                <PosButton icon={faLock} label="Close shift" tone="danger" grow={1}
                  disabled={!!busy} onClick={() => { setCounting(true); setError('') }} />
              </div>
            ) : (
              <>
                <CountGrid label="Dollars in the drawer" denoms={USD_DENOMS} counts={countUsd} isMobile={isMobile}
                  onChange={setCountUsd} format={d => `$${d}`} icon={faMoneyBillWave} />
                <CountGrid label="Lira in the drawer" denoms={LBP_DENOMS} counts={countLbp} isMobile={isMobile}
                  onChange={setCountLbp} format={d => d.toLocaleString('en-US')} icon={faCoins} />
                <div style={{ marginTop: '0.8rem' }}>
                  <Row label="Counted" value={`${usd(counted.usd)} · ${lbp(counted.lbp)}`} strong />
                </div>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
                  style={{ ...input, width: '100%', textAlign: 'left', marginTop: '0.6rem' }} />
                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
                  <PosButton icon={faTimes} label="Back" tone="quiet" grow={1} disabled={!!busy} onClick={() => setCounting(false)} />
                  <PosButton icon={faLock} label={busy === 'Closing…' ? 'Closing…' : 'Close with this count'} tone="danger" size="lg" grow={2}
                    disabled={!!busy} onClick={close}
                    style={busy ? undefined : { background: 'var(--red)', color: '#fff', border: '2px solid var(--red)' }} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
