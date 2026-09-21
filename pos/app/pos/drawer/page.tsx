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
//
// ── Cash in or out that is not a sale (UPGRADE.md T3.1) ────────────────────
// A manager records a paid-out, pay-in or safe drop from "Cash in or out",
// behind the drawerMovements switch. The X reading lists each one, and the
// figure the count is judged against already includes them.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faCashRegister, faReceipt, faLock, faCircleCheck, faTriangleExclamation,
  faCircleQuestion, faMoneyBillWave, faCoins, faTimes, faRightLeft,
} from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useTillAccess } from '../../lib/useTillAccess'
import { BRAND } from '@big-cms/shared/brand'
import {
  LBP_DENOMS, USD_DENOMS, MOVEMENT_LABELS, MOVEMENT_REASONS, countedCash, movementProblem,
  type DenomCount, type DrawerMovement, type DrawerTotals, type Money2, type MovementKind,
} from '@big-cms/shared/drawer'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import {
  useOpenShift, openDrawer, readDrawer, closeDrawer, recordDrawerMovement, type ZResult,
} from '../../lib/usePos'
import { PosButton, StatusBadge, SectionLabel, PosLoading, Sheet, Chip } from '../../lib/posUi'
import { SignOutButton } from '../../lib/SignOutButton'
import { useFeature } from '../../lib/useTillSettings'
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
  backgroundColor: 'rgba(var(--overlay-rgb),0.05)', color: 'var(--offwhite)',
  border: '2px solid rgba(var(--overlay-rgb),0.16)', fontSize: '1.1rem', textAlign: 'right',
  fontFamily: 'var(--font-inter)', outline: 'none', boxSizing: 'border-box',
}
const card: React.CSSProperties = {
  backgroundColor: 'rgba(var(--overlay-rgb),0.03)', border: '1px solid rgba(var(--overlay-rgb),0.12)', borderRadius: '14px',
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

const ZERO: Money2 = { usd: 0, lbp: 0 }
const some = (m: Money2 | undefined): m is Money2 => Boolean(m && (m.usd !== 0 || m.lbp !== 0))

/** What the drawer has seen, per currency. Module scope so it never remounts. */
function Totals({ t }: { t: DrawerTotals }) {
  // Totals stored before paid-outs existed have none of the three (T3.1).
  const paidOuts = t.paidOuts ?? ZERO
  const payIns = t.payIns ?? ZERO
  const safeDrops = t.safeDrops ?? ZERO
  return (
    <div>
      <Row label="Float" value={`${usd(t.float.usd)} · ${lbp(t.float.lbp)}`} />
      <Row label="Cash taken" value={`${usd(t.cashIn.usd)} · ${lbp(t.cashIn.lbp)}`} />
      <Row label="Change given" value={`−${usd(t.change.usd)} · −${lbp(t.change.lbp)}`} />
      {(t.refunds.usd !== 0 || t.refunds.lbp !== 0) && (
        <Row label="Cash refunds" value={`−${usd(t.refunds.usd)} · −${lbp(t.refunds.lbp)}`} />
      )}
      {some(paidOuts) && <Row label="Paid out" value={`−${usd(paidOuts.usd)} · −${lbp(paidOuts.lbp)}`} />}
      {some(safeDrops) && <Row label="Taken to the safe" value={`−${usd(safeDrops.usd)} · −${lbp(safeDrops.lbp)}`} />}
      {some(payIns) && <Row label="Paid in" value={`+${usd(payIns.usd)} · +${lbp(payIns.lbp)}`} />}
      <Row label="Should be in the drawer" value={`${usd(t.expected.usd)} · ${lbp(t.expected.lbp)}`} strong />
      <div style={{ height: '1px', background: 'rgba(var(--overlay-rgb),0.1)', margin: '0.5rem 0' }} />
      <Row label={`Card (not in the drawer) · ${t.payments} payment${t.payments === 1 ? '' : 's'}`}
        value={`${usd(t.card.usd)} · ${lbp(t.card.lbp)}`} />
    </div>
  )
}

/** Each paid-out, pay-in and safe drop on the shift, newest last. */
function MovementList({ movements }: { movements: DrawerMovement[] }) {
  if (movements.length === 0) return null
  return (
    <div style={{ marginTop: '0.8rem' }}>
      <SectionLabel icon={faRightLeft}>Cash in and out</SectionLabel>
      {movements.map(m => (
        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', padding: '0.3rem 0', fontSize: '0.92rem', color: 'rgba(var(--offwhite-rgb),0.82)' }}>
          <span>
            {MOVEMENT_LABELS[m.kind] ?? m.kind} · {m.reason}{m.note ? `: ${m.note}` : ''}
            <span style={{ color: muted }}> · {(m.byEmail ?? '').split('@')[0]}</span>
          </span>
          <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            {m.kind === 'payIn' ? '+' : '−'}{[m.usd > 0 ? usd(m.usd) : '', m.lbp > 0 ? lbp(m.lbp) : ''].filter(Boolean).join(' · ')}
          </span>
        </div>
      ))}
    </div>
  )
}

const newMovementId = () => `mv-${crypto.randomUUID().replace(/-/g, '')}`

/**
 * Cash in or out that is not a sale. One id per movement, kept until it is
 * recorded, so "Record" pressed again after no answer sends the same one.
 */
function MovementSheet({ shiftId, onClose, onRecorded }: { shiftId: string; onClose: () => void; onRecorded: () => void }) {
  const [kind, setKind] = useState<MovementKind>('paidOut')
  const [reason, setReason] = useState(MOVEMENT_REASONS.paidOut[0])
  const [amountUsd, setAmountUsd] = useState('')
  const [amountLbp, setAmountLbp] = useState('')
  const [note, setNote] = useState('')
  const [id] = useState(newMovementId)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const draft = { kind, usd: Number(amountUsd || 0), lbp: Number(amountLbp || 0), reason, note }
  async function record() {
    const p = movementProblem(draft)
    if (p) { setProblem(p); return }
    setBusy(true); setProblem('')
    try {
      await recordDrawerMovement(shiftId, { id, ...draft })
      onRecorded()
    } catch (err) {
      setProblem(isNetworkFailure(err)
        ? 'No answer. Press Record again when the wifi is back: it will not be counted twice.'
        : err instanceof Error ? err.message : 'It was not recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet label="Cash in or out" onClose={onClose} backdropCloses={false} center onSubmit={() => { void record() }}>
      <SectionLabel icon={faRightLeft}>Cash in or out</SectionLabel>
      <div role="group" aria-label="What happened" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {(Object.keys(MOVEMENT_REASONS) as MovementKind[]).map(k => (
          <Chip key={k} label={MOVEMENT_LABELS[k]} active={kind === k}
            onClick={() => { setKind(k); setReason(MOVEMENT_REASONS[k][0]); setProblem('') }} />
        ))}
      </div>
      <p style={{ color: muted, fontSize: '0.88rem', margin: '0.9rem 0 0.4rem' }}>Why</p>
      <div role="group" aria-label="Why" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {MOVEMENT_REASONS[kind].map(r => (
          <Chip key={r} size="sm" label={r} active={reason === r} onClick={() => { setReason(r); setProblem('') }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginTop: '0.9rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem', color: muted }}>
          <span><FontAwesomeIcon icon={faMoneyBillWave} style={{ marginRight: '0.4rem' }} />Dollars</span>
          <input value={amountUsd} onChange={e => setAmountUsd(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal" placeholder="$0" style={{ ...input, width: '100%', minWidth: 0 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem', color: muted }}>
          <span><FontAwesomeIcon icon={faCoins} style={{ marginRight: '0.4rem' }} />Lira</span>
          <input value={amountLbp} onChange={e => setAmountLbp(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric" placeholder="0 LBP" style={{ ...input, width: '100%', minWidth: 0 }} />
        </label>
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={200}
        placeholder={reason === 'Other' ? 'What was it for? (needed)' : 'Note (optional)'}
        aria-label="Note" style={{ ...input, width: '100%', textAlign: 'left', marginTop: '0.6rem' }} />
      {problem && <p role="alert" style={{ color: 'var(--red)', fontSize: '0.92rem', marginTop: '0.6rem' }}>{problem}</p>}
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
        <PosButton icon={faTimes} label="Cancel" tone="quiet" grow={1} disabled={busy} onClick={onClose} />
        <PosButton icon={faRightLeft} type="submit" label={busy ? 'Recording…' : `Record ${MOVEMENT_LABELS[kind].toLowerCase()}`} tone="primary" size="lg" grow={2} disabled={busy} />
      </div>
    </Sheet>
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
  const { checking, blocked, role } = useTillAccess(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  // Managers and admins only, the server's rule too (UPGRADE.md T3.1).
  const movementsOn = useFeature('drawerMovements').on
  const canMove = movementsOn && (role === 'manager' || role === 'admin')
  const isMobile = useIsMobile()
  const router = useRouter()
  // Same branch choice as the till's home screen.
  const [branch] = useState(BRAND.branches[0] ?? '')
  const { shift, loading, error: liveError } = useOpenShift(branch)
  const hubOnly = useHubOnly(branch)

  const [floatUsd, setFloatUsd] = useState('')
  const [floatLbp, setFloatLbp] = useState('')
  const [x, setX] = useState<DrawerTotals | null>(null)
  const [movements, setMovements] = useState<DrawerMovement[]>([])
  const [moving, setMoving] = useState(false)
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
    try {
      const r = await readDrawer(shift.id)
      setX(r.totals)
      setMovements(r.movements ?? [])
    }
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
          <PosButton icon={faArrowLeft} label="Floor" tone="quiet" size="sm" onClick={() => router.push('/pos')} />
          <SignOutButton />
        </div>
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
            <div style={{ height: '1px', background: 'rgba(var(--overlay-rgb),0.1)', margin: '0.5rem 0' }} />
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

            {x && <div style={{ marginTop: '0.9rem' }}><Totals t={x} /><MovementList movements={movements} /></div>}
            {moving && shift.status === 'open' && (
              <MovementSheet shiftId={shift.id} onClose={() => setMoving(false)}
                onRecorded={() => { setMoving(false); void reading() }} />
            )}

            {!counting ? (
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.1rem', flexWrap: 'wrap' }}>
                <PosButton icon={faReceipt} label={busy === 'Reading…' ? 'Reading…' : 'X reading'} tone="neutral" grow={1}
                  disabled={!!busy} onClick={reading} />
                {canMove && shift.status === 'open' && (
                  <PosButton icon={faRightLeft} label="Cash in or out" tone="neutral" grow={1}
                    disabled={!!busy} onClick={() => { setMoving(true); setError('') }} />
                )}
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
