'use client'

// Goods receiving — the confirm-and-fix form.
//
// THE DESIGN DECISION THIS PAGE EXISTS TO EXPRESS
// Most lines arrive exactly as ordered. A form that makes someone re-type
// twenty quantities at a back door, on a phone, while a driver waits, is a
// form staff abandon inside a week — and an abandoned receiving step puts you
// straight back to stock that only moves when somebody counts.
//
// So opening a delivery against a submitted weekly order pre-fills every
// received quantity with what was ordered and every unit cost with what the
// item currently costs. There is one big "Confirm all as ordered" button. The
// receiver touches only the two or three lines that were short, damaged, or
// priced differently. Everything else is one tap.
//
// Conventions here follow the rest of the admin panel deliberately (see
// CONTRIBUTING.md): inline style objects, no Tailwind, a local copy of
// useIsMobile, child components at module scope.

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import { collection, getDocs, query, orderBy } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { branchColor } from '../../../lib/branches'
import { useBusinessSettings } from '../../../lib/useBusinessSettings'
import {
  DELIVERY_BRANCHES, DELIVERY_DEPARTMENTS, DEFAULT_VAT_RATE,
  REJECT_REASON_LABELS, computeTotals, isShort, priceChange, round2,
  saveDelivery, seedLinesFromOrder, unplannedLine,
  type Currency, type DeliveryLine, type RejectReason,
} from '../../../lib/deliveries'
import {
  listProviders, listTemplateItems, listWeeklyReports,
  type OrderProvider, type OrderTemplateItem, type WeeklyOrderReport,
} from '../../../lib/weeklyOrders'

// Duplicated rather than imported from lib/useIsMobile — the established
// pattern in this codebase (CONTRIBUTING.md), not an oversight to tidy up.
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

const DEPT_COLOR: Record<string, string> = {
  Kitchen:  '#00A098',
  Bar:      '#C9962C',
  Cleaning: '#8B7CF6',
  Other:    'rgba(245,242,236,0.45)',
}

// Colours come from lib/branches so every screen agrees, and so a branch
// outside the original three gets one at all.

const inp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#F5F2EC', borderRadius: '4px', padding: '0.5rem 0.7rem',
  fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'var(--font-inter)',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.4rem', fontFamily: 'var(--font-inter)',
}

interface SupplyRow {
  id: string
  name: string
  nameAr?: string
  category: string
  unit: string
  avgUnitCost: number
  vatable?: boolean
}

function fmt(n: number, currency: Currency): string {
  // LBP has no meaningful minor unit at current magnitudes — showing
  // "9,000,000.00" is noise on a phone screen at a back door.
  return currency === 'LBP'
    ? Math.round(n).toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── One receiving line ─────────────────────────────────────────────────────
// Module scope, not nested in the page component. A component declared inside
// another component's render body gets a new function identity every render,
// so React unmounts and remounts it on every keystroke — which kills
// transitions and, here, would drop focus out of the input mid-typing.
// (CONTRIBUTING.md, gotcha #2.)
function LineRow({
  line, index, currency, rate, isMobile, lastCost, onChange,
}: {
  line: DeliveryLine
  index: number
  currency: Currency
  /** LBP per USD, or 0 when the delivery is priced in USD. */
  rate: number
  isMobile: boolean
  /** The running average, always in USD — see `lastCostLocal` below. */
  lastCost: number
  onChange: (index: number, patch: Partial<DeliveryLine>) => void
}) {
  const [showReject, setShowReject] = useState(line.qtyRejected > 0)

  const short = isShort(line)

  // avgUnitCost is stored in USD; line.unitCost is in the delivery's currency.
  // Comparing them directly made every LBP delivery read as a ~9,000,000%
  // price rise and flagged every single line as an exception — which is the
  // fastest way to teach someone to ignore the warning colour entirely.
  const lbp = currency === 'LBP' && rate > 0
  const lastCostLocal = lbp ? lastCost * rate : lastCost
  const usdEquivalent = lbp ? round2(line.unitCost / rate) : null

  const drift = priceChange(lastCostLocal, line.unitCost)
  const priceUp = drift !== null && drift > 0.02
  const touched = short || line.qtyRejected > 0 || priceUp

  // Quiet by default, loud only when something needs attention. The whole
  // point is that a receiver's eye lands on the exceptions.
  const accent = short ? 'var(--red)' : priceUp ? '#C9962C' : 'rgba(0,160,152,0.2)'

  return (
    <div style={{
      background: touched ? 'rgba(201,150,44,0.04)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${touched ? accent : 'rgba(255,255,255,0.07)'}`,
      borderRadius: '6px', padding: '0.8rem 0.9rem',
      display: 'flex', flexDirection: 'column', gap: '0.6rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.82rem', color: 'var(--offwhite)', lineHeight: 1.3 }}>
            {line.name}
          </p>
          {line.nameAr && (
            <p dir="rtl" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(201,150,44,0.8)', marginTop: '0.1rem' }}>
              {line.nameAr}
            </p>
          )}
        </div>
        {line.qtyOrdered > 0 && (
          <span style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.06em',
            color: 'rgba(245,242,236,0.3)', whiteSpace: 'nowrap',
          }}>
            ordered {line.qtyOrdered} {line.unit}
          </span>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr auto',
        gap: '0.5rem', alignItems: 'end',
      }}>
        <div>
          <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Received</label>
          <input
            type="number" min="0" step="any" inputMode="decimal"
            value={line.qtyReceived}
            onChange={e => onChange(index, { qtyReceived: Number(e.target.value) })}
            style={{ ...inp, width: '100%', textAlign: 'center', fontWeight: 600, color: short ? 'var(--red)' : 'var(--teal)' }}
          />
        </div>
        <div>
          <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>
            Unit cost {currency === 'LBP' ? '(LBP)' : '($)'}
          </label>
          <input
            type="number" min="0" step="any" inputMode="decimal"
            value={line.unitCost}
            onChange={e => onChange(index, { unitCost: Number(e.target.value) })}
            style={{ ...inp, width: '100%', textAlign: 'center', fontWeight: 600, color: priceUp ? '#C9962C' : '#F5F2EC' }}
          />
          {/* Costs are entered in whatever the invoice is written in, but
              everything downstream — the running average, food cost — is USD.
              Showing the conversion as you type is what makes an LBP invoice
              checkable against the item's usual price without a calculator. */}
          {usdEquivalent !== null && (
            <p style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.62rem', textAlign: 'center',
              color: 'rgba(245,242,236,0.3)', marginTop: '0.25rem',
            }}>
              ≈ ${usdEquivalent.toFixed(2)}
            </p>
          )}
        </div>
        <div style={{
          textAlign: isMobile ? 'left' : 'right', gridColumn: isMobile ? '1 / -1' : undefined,
          display: 'flex', flexDirection: isMobile ? 'row' : 'column',
          alignItems: isMobile ? 'center' : 'flex-end', gap: '0.5rem',
        }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.55)', fontWeight: 600 }}>
            {fmt(round2(line.qtyReceived * line.unitCost), currency)}
          </span>
          {/* Seeded from the item, overridable here: the same product arrives
              taxed from one supplier and untaxed from another, and the person
              holding the invoice is the only one who knows which. */}
          <button
            type="button"
            onClick={() => onChange(index, { vatable: line.vatable === false })}
            title={line.vatable === false ? 'No VAT on this line' : 'VAT applies to this line'}
            style={{
              background: line.vatable === false ? 'transparent' : 'rgba(0,160,152,0.1)',
              border: `1px solid ${line.vatable === false ? 'rgba(255,255,255,0.1)' : 'rgba(0,160,152,0.35)'}`,
              color: line.vatable === false ? 'rgba(245,242,236,0.3)' : 'var(--teal)',
              borderRadius: '3px', padding: '0.2rem 0.45rem', cursor: 'pointer',
              fontFamily: 'var(--font-inter)', fontSize: '0.6rem', letterSpacing: '0.06em',
              fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >{line.vatable === false ? 'NO VAT' : 'VAT'}</button>
        </div>
      </div>

      {(short || priceUp) && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {short && (
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', fontWeight: 700, color: 'var(--red)' }}>
              short {line.qtyOrdered - line.qtyReceived} {line.unit}
            </span>
          )}
          {/* Supplier price drift, surfaced at the moment it happens rather
              than in a report nobody opens. "This provider raised olive oil
              22% in six weeks" is a renegotiation, and it starts here. */}
          {priceUp && drift !== null && (
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', fontWeight: 700, color: '#C9962C' }}>
              price up {(drift * 100).toFixed(0)}% vs {fmt(lastCostLocal, currency)}
            </span>
          )}
        </div>
      )}

      {!showReject ? (
        <button
          onClick={() => setShowReject(true)}
          style={{
            background: 'none', border: 'none', padding: 0, textAlign: 'left',
            color: 'rgba(245,242,236,0.28)', fontFamily: 'var(--font-inter)',
            fontSize: '0.68rem', cursor: 'pointer',
          }}
        >+ reject damaged / expired</button>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '0.5rem', alignItems: 'end' }}>
          <div>
            <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Rejected</label>
            <input
              type="number" min="0" step="any" inputMode="decimal"
              value={line.qtyRejected}
              onChange={e => onChange(index, { qtyRejected: Number(e.target.value) })}
              style={{ ...inp, width: '100%', textAlign: 'center', color: 'var(--red)', fontWeight: 600 }}
            />
          </div>
          <div>
            <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Reason</label>
            {/* The route refuses a rejection with no reason. "Why did we
                reject three crates" is the entire value of recording it. */}
            <select
              value={line.rejectReason ?? ''}
              onChange={e => onChange(index, { rejectReason: (e.target.value || null) as RejectReason | null })}
              style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}
            >
              <option value="">— Select —</option>
              {Object.entries(REJECT_REASON_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

function ReceivingInner() {
  const params = useSearchParams()
  const { checking, role, branchIds, orderDepts, user } = useRequireRole(SECTION_ACCESS.deliveries)
  // The configured VAT rate, live. The server recomputes totals with the rate
  // it is sent and stores it on the delivery, so this only decides what the
  // form shows while someone is typing.
  const { settings: { vatRate } } = useBusinessSettings()
  const isMobile = useIsMobile()

  const branchOptions = useMemo(
    () => role === 'admin'
      ? [...DELIVERY_BRANCHES]
      : branchIds.filter(b => (DELIVERY_BRANCHES as readonly string[]).includes(b)),
    [role, branchIds],
  )

  // Same role→department scoping the daily count and weekly order forms use,
  // so a barista receiving a bar delivery sees exactly what they'd count.
  const departmentOptions = useMemo(() => {
    const base = orderDepts.filter(d => (DELIVERY_DEPARTMENTS as readonly string[]).includes(d))
    const withOther = (role === 'admin' || role === 'manager') && !base.includes('Other')
      ? [...base, 'Other'] : base
    return withOther.length > 0 ? withOther : [...DELIVERY_DEPARTMENTS]
  }, [orderDepts, role])

  const [branch,     setBranch]     = useState('')
  const [department, setDepartment] = useState('')

  const [providers, setProviders] = useState<OrderProvider[]>([])
  const [templates, setTemplates] = useState<OrderTemplateItem[]>([])
  const [supplies,  setSupplies]  = useState<SupplyRow[]>([])
  const [reports,   setReports]   = useState<WeeklyOrderReport[]>([])
  const [loadingRefs, setLoadingRefs] = useState(true)

  const [orderId,       setOrderId]       = useState('')
  const [providerId,    setProviderId]    = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [currency,      setCurrency]      = useState<Currency>('USD')
  const [rateUsed,      setRateUsed]      = useState('90000')
  const [notes,         setNotes]         = useState('')
  const [lines,         setLines]         = useState<DeliveryLine[]>([])
  const [unlinkedCount, setUnlinkedCount] = useState(0)
  const [providerByTemplate, setProviderByTemplate] = useState<Map<string, string>>(new Map())

  const [saving, setSaving] = useState(false)
  const [err,     setErr]    = useState('')
  const [done,    setDone]   = useState('')
  const [warning, setWarning] = useState('')

  useEffect(() => { if (branchOptions.length === 1) setBranch(branchOptions[0]) }, [branchOptions])
  useEffect(() => { if (departmentOptions.length === 1) setDepartment(departmentOptions[0]) }, [departmentOptions])

  useEffect(() => {
    if (checking) return
    const pb = params.get('branch')
    const po = params.get('order')
    if (pb && branchOptions.includes(pb)) setBranch(pb)
    if (po) setOrderId(po)
  }, [params, checking, branchOptions])

  useEffect(() => {
    Promise.all([
      listProviders(),
      listTemplateItems(),
      listWeeklyReports(),
      getDocs(query(collection(db, 'supplies'), orderBy('name'))),
    ]).then(([p, t, r, snap]) => {
      setProviders(p)
      setTemplates(t)
      setReports(r)
      setSupplies(snap.docs.map(d => {
        const data = d.data()
        return {
          id: d.id,
          name: (data.name as string) ?? '',
          nameAr: (data.nameAr as string | undefined) || undefined,
          category: (data.category as string) ?? 'Other',
          unit: (data.unit as string) ?? 'pcs',
          // Undefined until this supply has been received at least once —
          // Phase 01 is what starts populating it.
          avgUnitCost: Number(data.avgUnitCost ?? 0),
        }
      }))
      setLoadingRefs(false)
    })
  }, [])

  const supplyById = useMemo(() => new Map(supplies.map(s => [s.id, s])), [supplies])

  const matchingReports = useMemo(
    () => reports.filter(r => r.branch === branch && (!r.department || r.department === department)),
    [reports, branch, department],
  )

  // ── Seeding ──────────────────────────────────────────────────────────────
  // Pre-fill from the chosen weekly order. Every received quantity starts at
  // what was ordered; every cost starts at what the item currently costs. The
  // receiver corrects the exceptions and nothing else.
  function loadFromOrder(id: string) {
    setOrderId(id)
    setErr(''); setDone(''); setWarning('')

    if (!id) { setLines([]); setUnlinkedCount(0); setProviderByTemplate(new Map()); return }

    const report = reports.find(r => r.id === id)
    if (!report) return

    const templateById = new Map(templates.map(t => [t.id, t]))
    const seedSources = report.items.map(item => {
      const t = templateById.get(item.templateId)
      const supplyId = t?.supplyId ?? null
      const supply = supplyId ? supplyById.get(supplyId) : undefined
      return {
        templateId: item.templateId,
        supplyId: supply ? supplyId : null,
        name: item.name,
        nameAr: t?.nameAr ?? null,
        unit: supply?.unit ?? item.unit,
        quantity: item.quantity,
        currentAvgCost: supply?.avgUnitCost ?? 0,
        vatable: supply?.vatable !== false,
      }
    })

    const seeded = seedLinesFromOrder(seedSources)
    setLines(seeded)
    // seedLinesFromOrder drops anything with no supplyId — an ordered item
    // that isn't stocked can move no stock, and silently "receiving" it would
    // look successful and do nothing. Surface the count instead.
    setUnlinkedCount(seedSources.length - seeded.length)

    // A weekly order is placed across several suppliers at once, but they
    // arrive one van at a time. Keep the template -> supplier map so picking a
    // supplier can narrow the sheet to the delivery actually at the door.
    setProviderByTemplate(new Map(
      report.items.filter(i => i.providerId).map(i => [i.templateId, i.providerId as string])
    ))
    // Only pre-select when the whole order is one supplier's. Defaulting to
    // the first line's supplier on a mixed order would silently hide the rest.
    const ids = new Set(report.items.map(i => i.providerId).filter(Boolean))
    setProviderId(ids.size === 1 ? [...ids][0] as string : '')
  }

  function patchLine(index: number, patch: Partial<DeliveryLine>) {
    setLines(prev => prev.map((l, i) => {
      if (i !== index) return l
      const next = { ...l, ...patch }
      // Keep lineTotal consistent with the quantity and cost it came from.
      // The server recomputes it and never trusts what's sent, but a stale
      // value travelling in the payload is the kind of thing that gets
      // believed later by someone reading a stored document.
      return { ...next, lineTotal: round2(next.qtyReceived * next.unitCost) }
    }))
  }

  // The one-tap path. Everything is already pre-filled as ordered, so this
  // only has to undo any edits made so far — which is exactly what a receiver
  // wants after realising they were correcting the wrong line.
  function confirmAllAsOrdered() {
    const onScreen = new Set(visible.map(v => v.index))
    setLines(prev => prev.map((l, i) => (
      // Skip anything filtered out by the supplier selector, and skip
      // unplanned lines entirely — those were ordered in no quantity, so
      // "as ordered" would reset whatever the receiver just counted to zero.
      !onScreen.has(i) || l.templateId === null ? l : {
        ...l,
        qtyReceived: l.qtyOrdered,
        lineTotal: round2(l.qtyOrdered * l.unitCost),
        qtyRejected: 0,
        rejectReason: null,
      }
    )))
  }

  function addUnplannedLine(supplyId: string) {
    const s = supplyById.get(supplyId)
    if (!s || lines.some(l => l.supplyId === supplyId)) return
    setLines(prev => [...prev, unplannedLine(s)])
  }

  // Picking a supplier narrows the sheet to that supplier's lines — and the
  // delivery that gets posted is exactly what is on screen. That is the point:
  // one van, one invoice, one delivery document. The rest of the order stays
  // outstanding and is received again when the next van shows up;
  // fulfilmentByTemplateId already sums split shipments back against the order.
  //
  // Unplanned lines carry no template and so belong to no supplier on the
  // order. They stay visible whoever is selected, because they are being added
  // for the van standing at the door right now.
  const visible = useMemo(() => {
    const rows = lines.map((line, index) => ({ line, index }))
    if (!providerId) return rows
    return rows.filter(({ line }) =>
      line.templateId === null || providerByTemplate.get(line.templateId) === providerId)
  }, [lines, providerId, providerByTemplate])

  const hiddenCount = lines.length - visible.length

  const onOrderByProvider = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of lines) {
      const pid = l.templateId ? providerByTemplate.get(l.templateId) : undefined
      if (pid) counts.set(pid, (counts.get(pid) ?? 0) + 1)
    }
    return counts
  }, [lines, providerByTemplate])

  const totals = useMemo(
    () => computeTotals(visible.map(v => v.line), vatRate),
    [visible, vatRate],
  )

  const exceptions = visible.filter(v => isShort(v.line) || v.line.qtyRejected > 0).length

  async function submit(status: 'draft' | 'received') {
    if (!user || visible.length === 0) return
    setSaving(true); setErr(''); setDone(''); setWarning('')
    try {
      const provider = providers.find(p => p.id === providerId)
      const result = await saveDelivery({
        branch,
        department,
        providerId: providerId || null,
        providerName: provider?.name ?? '',
        orderReportId: orderId || null,
        invoiceNumber,
        currency,
        rateUsed: currency === 'LBP' ? Number(rateUsed) : 0,
        // The rate the totals on screen were computed with. The server stores
        // it on the delivery, so the invoice reprints at the rate the person
        // receiving actually agreed to, whatever the setting says later.
        vatRate,
        status,
        notes,
        // What is on screen, not what is in state. With a supplier selected
        // the two differ, and posting the hidden lines would record stock that
        // never arrived.
        lines: visible.map(v => v.line),
      })
      if (result.warning) setWarning(result.warning)
      setDone(status === 'draft'
        ? 'Draft saved — nothing has moved yet.'
        : `Delivery received — stock updated for ${branch}.`)
      if (status === 'received') { setLines([]); setOrderId(''); setInvoiceNumber('') }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the delivery.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  if (branchOptions.length === 0) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <p style={{ color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem', textAlign: 'center' }}>
          No branch assigned for receiving.
        </p>
      </div>
    )
  }

  const ready = branch && department && lines.length > 0
  const deptColor = DEPT_COLOR[department] ?? 'var(--teal)'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 6rem' : '2rem 1.5rem 6rem' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>

        <div style={{ marginBottom: '1.75rem' }}>
          <a href="/admin/supplies" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            marginBottom: '0.5rem', display: 'block', fontFamily: 'var(--font-inter)',
          }}>← Inventory Management</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            Receive a Delivery
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.3)' }}>
            Pick the weekly order this delivery is against — everything comes pre-filled as ordered.
            Only change the lines that were short, damaged, or priced differently.
          </p>
        </div>

        {/* Branch + Department */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={labelStyle}>Branch</label>
            {branchOptions.length === 1 ? (
              <div style={{ ...inp, display: 'inline-block', color: branchColor(branch), fontWeight: 600 }}>{branch}</div>
            ) : (
              <select value={branch} onChange={e => setBranch(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
                <option value="">— Select Branch —</option>
                {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <select value={department} onChange={e => setDepartment(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
              <option value="">— Select Department —</option>
              {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {!branch || !department ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
            Select a branch and department to begin.
          </p>
        ) : loadingRefs ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>Loading…</p>
        ) : (
          <>
            {/* Source order */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Against which weekly order?</label>
              <select value={orderId} onChange={e => loadFromOrder(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
                <option value="">— Unplanned delivery (no order) —</option>
                {matchingReports.map(r => (
                  <option key={r.id} value={r.id}>{r.weekLabel}{r.department ? ` · ${r.department}` : ''}</option>
                ))}
              </select>
            </div>

            {unlinkedCount > 0 && (
              <div style={{
                background: 'rgba(201,150,44,0.08)', border: '1px solid rgba(201,150,44,0.22)',
                borderRadius: '4px', padding: '0.85rem 1.1rem', marginBottom: '1.25rem',
                fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: '#C9962C', lineHeight: 1.5,
              }}>
                {unlinkedCount} ordered item{unlinkedCount === 1 ? '' : 's'} on this order {unlinkedCount === 1 ? 'is' : 'are'} not
                linked to a stocked supply, so {unlinkedCount === 1 ? 'it is' : 'they are'} not shown here — receiving
                {unlinkedCount === 1 ? ' it' : ' them'} would move no stock. Run <code>npm run link:supplies</code>, or add
                {unlinkedCount === 1 ? ' it' : ' them'} in Inventory Management.
              </div>
            )}

            {/* Invoice + currency */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={labelStyle}>Supplier</label>
                <select value={providerId} onChange={e => setProviderId(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
                  <option value="">— All suppliers —</option>
                  {providers.map(p => {
                    // How many of the loaded order's lines are this supplier's.
                    // Shown in the option itself so it is obvious before
                    // selecting which suppliers are actually on this order.
                    const n = onOrderByProvider.get(p.id) ?? 0
                    return <option key={p.id} value={p.id}>{p.name}{n > 0 ? ` (${n})` : ''}</option>
                  })}
                </select>
                {hiddenCount > 0 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.62rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.3rem' }}>
                    Showing only this supplier&apos;s lines. Receive the rest when their van arrives.
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Invoice number</label>
                <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="F-20481" style={{ ...inp, width: '100%' }} />
              </div>
              <div>
                <label style={labelStyle}>Currency</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {(['USD', 'LBP'] as Currency[]).map(c => (
                    <button key={c} onClick={() => setCurrency(c)} style={{
                      flex: 1,
                      background: currency === c ? 'rgba(0,160,152,0.15)' : 'transparent',
                      border: `1px solid ${currency === c ? 'var(--teal)' : 'rgba(255,255,255,0.09)'}`,
                      color: currency === c ? 'var(--teal)' : 'rgba(245,242,236,0.35)',
                      borderRadius: '4px', padding: '0.5rem', fontSize: '0.78rem',
                      fontWeight: currency === c ? 600 : 400, cursor: 'pointer',
                      fontFamily: 'var(--font-inter)',
                    }}>{c}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* The rate is stored ON the delivery, not read from a global at
                display time, so this invoice still reprints at the same totals
                next year. The server refuses an LBP delivery without one. */}
            {currency === 'LBP' && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={labelStyle}>Exchange rate used (LBP per $1)</label>
                <input
                  type="number" min="1" inputMode="numeric"
                  value={rateUsed} onChange={e => setRateUsed(e.target.value)}
                  style={{ ...inp, width: isMobile ? '100%' : '220px' }}
                />
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.28)', marginTop: '0.35rem' }}>
                  Saved with this delivery so its totals never change if the rate moves.
                </p>
              </div>
            )}

            {lines.length === 0 ? (
              <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px', padding: '2.5rem 1.5rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                <p style={{ color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  {orderId ? 'No stocked items on this order.' : 'Pick a weekly order above, or add items for an unplanned delivery.'}
                </p>
                <select
                  value=""
                  onChange={e => addUnplannedLine(e.target.value)}
                  style={{ ...inp, background: '#1a1a1a', cursor: 'pointer', minWidth: '240px' }}
                >
                  <option value="">+ Add an item…</option>
                  {supplies.filter(s => s.category === department).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                {/* Confirm-and-fix: the one-tap path */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem',
                }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)' }}>
                    {visible.length} line{visible.length === 1 ? '' : 's'}
                    {hiddenCount > 0 && (
                      <span style={{ color: 'rgba(245,242,236,0.28)' }}>
                        {' '}· {hiddenCount} on this order from another supplier
                      </span>
                    )}
                    {exceptions > 0 && (
                      <span style={{ color: '#C9962C', fontWeight: 700 }}> · {exceptions} exception{exceptions === 1 ? '' : 's'}</span>
                    )}
                  </span>
                  <button onClick={confirmAllAsOrdered} style={{
                    background: 'rgba(0,160,152,0.12)', border: '1px solid var(--teal)',
                    color: 'var(--teal)', padding: '0.55rem 1.25rem', borderRadius: '4px',
                    fontSize: '0.74rem', letterSpacing: '0.06em', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'var(--font-inter)',
                  }}>Confirm all as ordered</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.6rem', marginBottom: '1.5rem' }}>
                  {visible.map(({ line, index }) => (
                    <LineRow
                      key={line.supplyId}
                      line={line}
                      index={index}
                      currency={currency}
                      rate={currency === 'LBP' ? Number(rateUsed) || 0 : 0}
                      isMobile={isMobile}
                      lastCost={supplyById.get(line.supplyId)?.avgUnitCost ?? 0}
                      onChange={patchLine}
                    />
                  ))}
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <select value="" onChange={e => addUnplannedLine(e.target.value)} style={{ ...inp, background: '#1a1a1a', cursor: 'pointer', minWidth: '240px' }}>
                    <option value="">+ Add an item not on the order…</option>
                    {supplies.filter(s => s.category === department && !lines.some(l => l.supplyId === s.id)).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Totals. Shown live so the receiver can check against the
                    paper bill before committing — the whole three-way match
                    starts with the number agreeing. The server recomputes all
                    of this; nothing here is trusted. */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '6px', padding: '1rem 1.1rem', marginBottom: '1.5rem',
                  fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
                }}>
                  {[
                    ['Subtotal', totals.subtotal],
                    // Only shown when some of the invoice is exempt. On an
                    // all-taxable delivery it would just repeat the subtotal.
                    ...(totals.taxableSubtotal === totals.subtotal
                      ? []
                      : [['Of which taxable', totals.taxableSubtotal] as [string, number]]),
                    [`VAT (${(vatRate * 100).toFixed(2).replace(/.?0+$/, '')}%)`, totals.vat],
                  ].map(([label, value]) => (
                    <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', color: 'rgba(245,242,236,0.45)' }}>
                      <span>{label}</span><span>{fmt(value as number, currency)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', color: 'var(--offwhite)', fontWeight: 700 }}>
                    <span>Total</span><span>{fmt(totals.grand, currency)} {currency}</span>
                  </div>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={labelStyle}>Notes</label>
                  <textarea
                    value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                    placeholder="Anything worth remembering about this delivery…"
                    style={{ ...inp, width: '100%', resize: 'vertical', fontFamily: 'var(--font-inter)' }}
                  />
                </div>
              </>
            )}

            {err && <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>{err}</p>}
            {warning && (
              <div style={{
                background: 'rgba(201,150,44,0.08)', border: '1px solid rgba(201,150,44,0.22)',
                borderRadius: '4px', padding: '0.85rem 1.1rem', marginBottom: '1rem',
                fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: '#C9962C', lineHeight: 1.5,
              }}>{warning}</div>
            )}
            {done && <p style={{ color: 'var(--teal)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>✓ {done}</p>}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={() => submit('draft')}
                disabled={!ready || saving}
                style={{
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                  color: 'rgba(245,242,236,0.6)', padding: '0.75rem 1.5rem', borderRadius: '2px',
                  fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                  cursor: ready && !saving ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-inter)', opacity: saving ? 0.6 : 1,
                }}
              >{saving ? 'Saving…' : 'Save Draft'}</button>

              <button
                onClick={() => submit('received')}
                disabled={!ready || saving}
                title={!ready ? 'Add at least one line first' : undefined}
                style={{
                  background: ready ? deptColor : 'rgba(255,255,255,0.08)',
                  color: ready ? '#000' : 'rgba(245,242,236,0.3)', border: 'none',
                  padding: '0.75rem 2rem', borderRadius: '2px',
                  fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
                  cursor: ready && !saving ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-inter)', opacity: saving ? 0.6 : 1,
                }}
              >{saving ? 'Saving…' : 'Receive Delivery'}</button>

              {/* A draft moves nothing. Said plainly, because a receiver
                  walking away mid-entry at a back door is the normal case,
                  not the edge case. */}
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.28)' }}>
                A draft moves no stock. Receiving does, and can&apos;t be edited afterwards.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function ReceivingPage() {
  // useSearchParams needs a Suspense boundary in the App Router — same pattern
  // as the daily inventory page next door.
  return (
    <Suspense fallback={null}>
      <ReceivingInner />
    </Suspense>
  )
}
