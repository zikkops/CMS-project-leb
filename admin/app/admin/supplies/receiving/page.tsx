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

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { collection, getDocs, query, orderBy } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useBusinessSettings } from '@big-cms/shared/useBusinessSettings'
import { vatRateOn } from '@big-cms/shared/businessSettings'
import { todayYmd } from '@big-cms/shared/dates'
import { BRAND } from '@big-cms/shared/brand'
import { supplyCategoryColor } from '@big-cms/shared/departments'
import { useFeature } from '@big-cms/shared/useFeatures'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import {
  deliveryTempProblem, readStorageKind, readLimits,
  type FoodSafetyLimits,
} from '@big-cms/shared/foodSafety'
import {
  DELIVERY_BRANCHES, DELIVERY_DEPARTMENTS,
  computeTotals, isShort, round2,
  saveDelivery, seedLinesFromOrder, unplannedLine,
  type Currency, type DeliveryLine,
} from '@big-cms/shared/deliveries'
import {
  listProviders, listTemplateItems, listWeeklyReports,
  type OrderProvider, type OrderTemplateItem, type WeeklyOrderReport,
} from '@big-cms/shared/weeklyOrders'
import { inp, labelStyle } from './_components/styles'
import type { SupplyRow } from './_components/types'
import { LineRow } from './_components/LineRow'
import { BranchDepartmentPicker } from './_components/BranchDepartmentPicker'
import { OrderPicker } from './_components/OrderPicker'
import { InvoiceFields } from './_components/InvoiceFields'
import { LinesToolbar } from './_components/LinesToolbar'
import { TotalsPanel } from './_components/TotalsPanel'
import { SubmitBar } from './_components/SubmitBar'
import { ReceivingHeader } from './_components/ReceivingHeader'
import { EmptyLines } from './_components/EmptyLines'

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

function ReceivingInner() {
  const params = useSearchParams()
  const { checking, role, branchIds, orderDepts, user } = useRequireRole(SECTION_ACCESS.deliveries)
  // The configured VAT rate, live. The server recomputes totals with the rate
  // it is sent and stores it on the delivery, so this only decides what the
  // form shows while someone is typing.
  const { settings: businessSettings, loading: settingsLoading } = useBusinessSettings()
  // The rate in force TODAY in the café's zone, not the stored current rate:
  // on the day a scheduled change starts, deliveries switch with the tills.
  const vatRate = vatRateOn(businessSettings, todayYmd(BRAND.locale.timezone))
  const exchangeRate = businessSettings.exchangeRate

  const isMobile = useIsMobile()

  // Food safety: chilled and frozen lines take a temperature. The limits are
  // the café's own settings; a receiver who cannot read them still gets the
  // box, and the server's refusal names the problem.
  const { on: foodSafetyOn } = useFeature('foodSafety')
  const [limits, setLimits] = useState<FoodSafetyLimits | null>(null)
  useEffect(() => {
    if (checking || !foodSafetyOn) return
    authedFetch('/api/admin/food-safety?view=settings', 'GET').then(unwrap)
      .then(r => setLimits(readLimits((r.settings as { limits?: unknown } | undefined)?.limits)))
      .catch(() => setLimits(null))
  }, [checking, foodSafetyOn])

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
  const [invoiceDate,   setInvoiceDate]   = useState('')
  const [currency,      setCurrency]      = useState<Currency>('USD')
  // Seeded from the configured rate rather than a hardcoded 90000, which
  // ignored /admin/settings entirely and quietly disagreed with it.
  const [rateUsed,      setRateUsed]      = useState('')
  const [notes,         setNotes]         = useState('')
  const [lines,         setLines]         = useState<DeliveryLine[]>([])
  const [unlinkedCount, setUnlinkedCount] = useState(0)
  const [providerByTemplate, setProviderByTemplate] = useState<Map<string, string>>(new Map())

  const [saving, setSaving] = useState(false)
  const [err,     setErr]    = useState('')
  const [done,    setDone]   = useState('')
  const [warning, setWarning] = useState('')

  // Worked out while rendering, whenever what they depend on changes: a
  // single choice is chosen for you, and a link pre-fills the branch (only
  // one the user has access to) and the order.
  const optionsKey = `${branchOptions.join('|')}#${departmentOptions.join('|')}`
  const [seenOptions, setSeenOptions] = useState<string | null>(null)
  if (optionsKey !== seenOptions) {
    setSeenOptions(optionsKey)
    if (branchOptions.length === 1) setBranch(branchOptions[0])
    if (departmentOptions.length === 1) setDepartment(departmentOptions[0])
  }
  const prefillKey = checking ? null : `${params.toString()}#${branchOptions.join('|')}`
  const [seenPrefill, setSeenPrefill] = useState<string | null>(null)
  if (prefillKey !== null && prefillKey !== seenPrefill) {
    setSeenPrefill(prefillKey)
    const pb = params.get('branch')
    const po = params.get('order')
    if (pb && branchOptions.includes(pb)) setBranch(pb)
    if (po) setOrderId(po)
  }

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
          storage: readStorageKind(data.storage),
        }
      }))
      setLoadingRefs(false)
    })
  }, [])

// avgUnitCost is stored in USD, always. A delivery priced in LBP has to seed
  // its lines at the LBP equivalent, or every unit cost arrives ~90,000x too
  // small: the form showed 8.9 LBP for an $8.90 item and totalled the delivery
  // at nothing. Receiving it would have set that supply's running average to
  // about $0.0001 and destroyed the food-cost figure for it.
  const toEntry = useCallback(
    (usd: number) => (currency === 'LBP' && Number(rateUsed) > 0 ? round2(usd * Number(rateUsed)) : usd),
    [currency, rateUsed],
  )

  // Fill the rate box from configuration the first time it is known. Only
  // when untouched — someone typing the rate off the invoice in front of them
  // must not have it overwritten when the settings listener fires.
  if (!settingsLoading && rateUsed === '') setRateUsed(String(exchangeRate))

  // Flipping the currency re-prices every open line. Without this the numbers
  // silently change meaning — 8.90 entered as dollars stays "8.90" and is
  // suddenly read as 8.90 LBP.
  function changeCurrency(next: Currency) {
    if (next === currency) return
    const rate = Number(rateUsed) || exchangeRate

    // setLines() used to live INSIDE a setCurrency updater. React invokes a
    // state updater twice in development to surface exactly this, and it did:
    // every cost converted twice, so 8.90 became 71,291,225,000 rather than
    // 796,550. An updater has to be pure — the conversion is a separate call.
    if (rate > 0) {
      const factor = next === 'LBP' ? rate : 1 / rate
      setLines(ls => ls.map(l => {
        const unitCost = round2(l.unitCost * factor)
        return { ...l, unitCost, lineTotal: round2(l.qtyReceived * unitCost) }
      }))
    }
    setCurrency(next)
  }

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
        currentAvgCost: toEntry(supply?.avgUnitCost ?? 0),
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
    // unplannedLine() seeds from the stored USD average; convert it the same
    // way an ordered line is converted.
    const line = unplannedLine(s)
    setLines(prev => [...prev, { ...line, unitCost: toEntry(line.unitCost) }])
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
  const allRows = lines.map((line, index) => ({ line, index }))
  const visible = !providerId ? allRows : allRows.filter(({ line }) =>
    line.templateId === null || providerByTemplate.get(line.templateId) === providerId)

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
    // The server refuses a chilled or frozen line with no temperature. Naming
    // the line here saves a round trip; without the limits the server's answer
    // is the one shown.
    if (status === 'received' && foodSafetyOn && limits) {
      const first = visible
        .map(({ line }) => ({ line, problem: deliveryTempProblem(supplyById.get(line.supplyId)?.storage ?? null, line, limits) }))
        .find(p => p.problem)
      if (first) { setErr(`${first.line.name}: ${first.problem}`); return }
    }
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
        invoiceDate: invoiceDate || null,
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
      if (status === 'received') { setLines([]); setOrderId(''); setInvoiceNumber(''); setInvoiceDate('') }
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
        <p style={{ color: 'rgba(var(--offwhite-rgb),0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem', textAlign: 'center' }}>
          No branch assigned for receiving.
        </p>
      </div>
    )
  }

  const ready = branch && department && lines.length > 0
  const deptColor = supplyCategoryColor(department) ?? 'var(--teal)'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 6rem' : '2rem 1.5rem 6rem' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>

        <ReceivingHeader />

        <BranchDepartmentPicker
          isMobile={isMobile}
          branchOptions={branchOptions}
          branch={branch}
          onBranch={setBranch}
          departmentOptions={departmentOptions}
          department={department}
          onDepartment={setDepartment}
        />

        {!branch || !department ? (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
            Select a branch and department to begin.
          </p>
        ) : loadingRefs ? (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>Loading…</p>
        ) : (
          <>
            <OrderPicker
              orderId={orderId}
              matchingReports={matchingReports}
              onPick={loadFromOrder}
              unlinkedCount={unlinkedCount}
            />

            <InvoiceFields
              isMobile={isMobile}
              providers={providers}
              providerId={providerId}
              onProvider={setProviderId}
              onOrderByProvider={onOrderByProvider}
              hiddenCount={hiddenCount}
              invoiceNumber={invoiceNumber}
              onInvoiceNumber={setInvoiceNumber}
              invoiceDate={invoiceDate}
              onInvoiceDate={setInvoiceDate}
              currency={currency}
              onCurrency={changeCurrency}
              rateUsed={rateUsed}
              onRateUsed={setRateUsed}
            />

            {lines.length === 0 ? (
              <EmptyLines
                orderId={orderId}
                supplies={supplies}
                department={department}
                onAdd={addUnplannedLine}
              />
            ) : (
              <>
                <LinesToolbar
                  visibleCount={visible.length}
                  hiddenCount={hiddenCount}
                  exceptions={exceptions}
                  onConfirmAll={confirmAllAsOrdered}
                />

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
                      storage={supplyById.get(line.supplyId)?.storage ?? null}
                      limits={limits}
                      askTemp={foodSafetyOn}
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

                <TotalsPanel totals={totals} vatRate={vatRate} currency={currency} />

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

            <SubmitBar
              err={err}
              warning={warning}
              done={done}
              ready={ready}
              saving={saving}
              deptColor={deptColor}
              onSubmit={submit}
            />
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
