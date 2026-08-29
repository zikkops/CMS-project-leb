'use client'

export const dynamic = 'force-dynamic'

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useIsMobile } from '../../lib/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '../../lib/adminAuth'
import { BRANCHES } from '../../lib/branches'
import { useBusinessSettings } from '../../lib/useBusinessSettings'
import { BRAND } from '../../lib/brand'
import {
  LBP_DENOMS, USD_DENOMS, SHIFT_LABELS,
  computeTotals, emptyReport, getEndOfDayReport, saveEndOfDayReport,
  getBranchStaff, listAllStaff, defaultEodDateStr, formatLbp, formatUsd,
  type AttendanceEntry, type EndOfDayReport, type StaffUser,
} from '../../lib/endOfDay'
import { ROLE_LABELS } from '../../lib/adminAuth'

const inp: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC',
  padding: '0.6rem 0.8rem',
  borderRadius: '2px',
  fontSize: '0.88rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
  width: '100%',
}

const numInp: React.CSSProperties = { ...inp, textAlign: 'right', width: '90px' }

// Selects need a solid dark background — rgba on a native <select> leaves the
// OS-rendered dropdown options with white text on a white background.
const selStyle: React.CSSProperties = { ...inp, backgroundColor: '#1a1a1a', cursor: 'pointer' }

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.68rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.4rem',
  fontFamily: 'var(--font-inter)',
}

const sectionHeader = (color: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: '0.6rem',
  paddingBottom: '0.6rem',
  borderBottom: `1px solid ${color}40`,
  marginBottom: '1.25rem',
})

function SectionTitle({ label, color }: { label: string; color: string }) {
  return (
    <div style={sectionHeader(color)}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color, letterSpacing: '0.12em' }}>
        {label}
      </p>
    </div>
  )
}

// ─── helpers ────────────────────────────────────────────────────────────────

function parseCash(vals: Record<string, string>): Record<string, number> {
  return Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v) || 0]))
}

function cashToStr(vals: Record<string, number>): Record<string, string> {
  return Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v === 0 ? '' : String(v)]))
}

function EndOfDayInner() {
  const params = useSearchParams()
  const isMobile = useIsMobile()
  const { checking, role, branchIds, user } = useRequireRole(SECTION_ACCESS.endOfDay)
  // Live, so changing the rate at /admin/settings reaches a form already open
  // at a till. A report stores the rate it was submitted with regardless.
  const { settings: { exchangeRate } } = useBusinessSettings()

  const branchOptions = role === 'admin' ? [...BRANCHES] : branchIds

  const [branch, setBranch] = useState('')
  const [date,   setDate]   = useState(defaultEodDateStr())

  const [cashLbp,    setCashLbp]    = useState<Record<string, string>>({})
  const [cashUsd,    setCashUsd]    = useState<Record<string, string>>({})
  const [systemLbp,  setSystemLbp]  = useState('')
  const [tipsUsd,    setTipsUsd]    = useState('')
  const [expenses,   setExpenses]   = useState<{ name: string; amountUsd: string }[]>([])
  const [income,     setIncome]     = useState<{ name: string; amountUsd: string }[]>([])
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([])
  const [notes,      setNotes]      = useState('')
  const [staffList, setStaffList] = useState<StaffUser[]>([])

  const [existingId, setExistingId] = useState<string | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [err,        setErr]        = useState('')

  const [staffListErr, setStaffListErr] = useState(false)

  // Load all staff accounts once for the search combobox
  useEffect(() => {
    listAllStaff()
      .then(list => setStaffList(list))
      .catch(() => setStaffListErr(true))
  }, [])

  // Pre-select branch for non-admin with one branch
  useEffect(() => {
    if (checking) return
    if (role !== 'admin' && branchIds.length === 1) setBranch(branchIds[0])
  }, [checking, role, branchIds])

  // Pre-fill from URL params if navigating from history.
  // Only allow setting a branch the user actually has access to.
  useEffect(() => {
    if (checking) return
    const pb = params.get('branch')
    const pd = params.get('date')
    if (pb && (role === 'admin' || branchIds.includes(pb))) setBranch(pb)
    if (pd) setDate(pd)
  }, [params, checking, role, branchIds])

  const resetForm = useCallback((report: EndOfDayReport | null, rosterNames: string[]) => {
    if (report) {
      setCashLbp(cashToStr(report.cashLbp))
      setCashUsd(cashToStr(report.cashUsd))
      setSystemLbp(report.systemLbp ? String(report.systemLbp) : '')
      setTipsUsd(report.tipsUsd ? String(report.tipsUsd) : '')
      setExpenses(report.expenses.map(e => ({ name: e.name, amountUsd: e.amountUsd ? String(e.amountUsd) : '' })))
      setIncome(report.income.map(e => ({ name: e.name, amountUsd: e.amountUsd ? String(e.amountUsd) : '' })))
      setAttendance(report.attendance)
      setNotes(report.notes ?? '')
      setExistingId(report.id)
    } else {
      setCashLbp(Object.fromEntries(LBP_DENOMS.map(d => [String(d), ''])))
      setCashUsd(Object.fromEntries(USD_DENOMS.map(d => [String(d), ''])))
      setSystemLbp('')
      setTipsUsd('')
      setExpenses([])
      setIncome([])
      setAttendance(rosterNames.map(name => ({ name, shift: 'none', isGuest: false })))
      setNotes('')
      setExistingId(null)
    }
    setSaved(false)
    setErr('')
  }, [])

  // Load report + roster when branch or date changes
  useEffect(() => {
    if (!branch || !date) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      getEndOfDayReport(branch, date),
      getBranchStaff(branch),
    ]).then(([report, staffDoc]) => {
      if (cancelled) return
      const rosterNames = staffDoc?.staff ?? []
      resetForm(report, rosterNames)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [branch, date, resetForm])

  // System USD is derived from LBP at the configured rate — editable at
  // /admin/settings, and live, so a rate change reaches an open form.
  const systemLbpNum = Number(systemLbp) || 0
  const systemUsdDerived = systemLbpNum / exchangeRate

  // ── computed totals (live) ───────────────────────────────────────────────
  const totals = useMemo(() => computeTotals(
    parseCash(cashLbp),
    parseCash(cashUsd),
    systemLbpNum,
    systemUsdDerived,
    expenses.map(e => ({ name: e.name, amountUsd: Number(e.amountUsd) || 0 })),
    income.map(e => ({ name: e.name, amountUsd: Number(e.amountUsd) || 0 })),
    exchangeRate,
  ), [cashLbp, cashUsd, systemLbpNum, systemUsdDerived, expenses, income, exchangeRate])

  // ── expense / income helpers ─────────────────────────────────────────────
  function addLine(setter: typeof setExpenses) {
    setter(prev => [...prev, { name: '', amountUsd: '' }])
  }
  function removeLine(setter: typeof setExpenses, idx: number) {
    setter(prev => prev.filter((_, i) => i !== idx))
  }
  function updateLine(setter: typeof setExpenses, idx: number, field: 'name' | 'amountUsd', val: string) {
    setter(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e))
  }

  // ── attendance helpers ───────────────────────────────────────────────────
  function setShift(idx: number, shift: AttendanceEntry['shift']) {
    setAttendance(prev => prev.map((a, i) => i === idx ? { ...a, shift } : a))
  }
  function removeAttendee(idx: number) {
    setAttendance(prev => prev.filter((_, i) => i !== idx))
  }

  // ── submit ───────────────────────────────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!branch) { setErr('Please select a branch.'); return }
    if (!date)   { setErr('Please select a date.'); return }
    if (!user)   { setErr('Not signed in.'); return }

    setSaving(true); setErr('')
    try {
      const report = emptyReport(branch, date, user.uid, user.email ?? '', exchangeRate)
      report.cashLbp    = parseCash(cashLbp)
      report.cashUsd    = parseCash(cashUsd)
      report.systemLbp  = systemLbpNum
      report.systemUsd  = systemUsdDerived
      report.tipsUsd    = Number(tipsUsd) || 0
      report.expenses   = expenses.filter(e => e.name.trim()).map(e => ({ name: e.name.trim(), amountUsd: Number(e.amountUsd) || 0 }))
      report.income     = income.filter(e => e.name.trim()).map(e => ({ name: e.name.trim(), amountUsd: Number(e.amountUsd) || 0 }))
      report.attendance = attendance
      report.notes      = notes.trim()
      if (existingId) {
        report.submittedBy      = user.uid
        report.submittedByEmail = user.email ?? ''
      }
      // One call. The route writes the report and its endOfDayLogs entry
      // together, so the two can no longer disagree.
      const { id } = await saveEndOfDayReport(report)
      setExistingId(id)
      setSaved(true)
    } catch {
      setErr('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  const diffLbpColor  = totals.differenceLbp === 0 ? 'var(--teal)' : totals.differenceLbp > 0 ? 'var(--red)' : '#C9962C'
  const diffUsdColor  = totals.differenceUsd  === 0 ? 'var(--teal)' : totals.differenceUsd  > 0 ? 'var(--red)' : '#C9962C'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '0.5rem' }}>
            <a href="/admin/end-of-day/history" style={{
              fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
            }}>← EOD History</a>
            {(role === 'admin' || role === 'manager') && (
              <a href="/admin/end-of-day/log" style={{
                fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'rgba(245,242,236,0.2)', textDecoration: 'none',
                fontFamily: 'var(--font-inter)',
              }}>View Log</a>
            )}
          </div>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            End of Day Report
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)' }}>
            {existingId ? 'Editing saved report' : 'New report'} · Submitting as {user?.email}
          </p>
        </div>

        <form onSubmit={handleSave}>

          {/* Branch + Date */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
            <div>
              <label style={labelStyle}>Branch</label>
              {branchOptions.length === 1 ? (
                <div style={{ ...inp, display: 'inline-block', width: 'auto' }}>{branch}</div>
              ) : (
                <select value={branch} onChange={e => setBranch(e.target.value)} style={selStyle}>
                  <option value="">— Select Branch —</option>
                  {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
            </div>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
            </div>
          </div>

          {loading && (
            <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', marginBottom: '2rem' }}>
              Loading…
            </p>
          )}

          {!loading && branch && date && (<>

            {/* ── Summary ──────────────────────────────────────────────────── */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '6px',
              padding: '1.25rem 1.5rem',
              marginBottom: '2.5rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
            }}>
              <SumCell label="Counted LBP"    value={formatLbp(totals.totalCashLbp)} color="var(--teal)" />
              <SumCell label="Counted USD"    value={formatUsd(totals.totalCashUsd)} color="var(--teal)" />
              <SumCell label="Grand Total LBP" value={formatLbp(totals.grandTotalLbp)} color="rgba(245,242,236,0.7)" />
              <SumCell label="Grand Total USD" value={formatUsd(totals.grandTotalUsd)} color="rgba(245,242,236,0.7)" />
              <SumCell label="Difference LBP"  value={formatLbp(totals.differenceLbp)} color={diffLbpColor} />
              <SumCell label="Difference USD"  value={formatUsd(totals.differenceUsd)} color={diffUsdColor} />
            </div>

            {/* ── Cash Count ───────────────────────────────────────────────── */}
            <div style={{ marginBottom: '2.5rem' }}>
              <SectionTitle label="CASH COUNT" color="var(--teal)" />
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem' }}>

                {/* LBP */}
                <div>
                  <p style={{ ...labelStyle, color: 'var(--teal)', marginBottom: '0.75rem' }}>Lebanese Pound (LBP)</p>
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '4px', overflow: 'hidden' }}>
                    {LBP_DENOMS.map((denom, i) => (
                      <div key={denom} style={{
                        display: 'grid', gridTemplateColumns: '1fr auto',
                        alignItems: 'center', gap: '0.75rem',
                        padding: '0.65rem 1rem',
                        borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.7)' }}>
                          {denom.toLocaleString()}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <input
                            type="number" min="0" step="1"
                            value={cashLbp[String(denom)] ?? ''}
                            onChange={e => setCashLbp(prev => ({ ...prev, [String(denom)]: e.target.value }))}
                            placeholder="0"
                            style={{ ...numInp, width: '80px' }}
                          />
                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', minWidth: '28px' }}>pcs</span>
                        </div>
                      </div>
                    ))}
                    <div style={{
                      padding: '0.65rem 1rem',
                      borderTop: '1px solid rgba(255,255,255,0.08)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', letterSpacing: '0.05em' }}>TOTAL</span>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--teal)', fontWeight: 600 }}>
                        {totals.totalCashLbp.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* USD */}
                <div>
                  <p style={{ ...labelStyle, color: '#C9962C', marginBottom: '0.75rem' }}>US Dollar (USD)</p>
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '4px', overflow: 'hidden' }}>
                    {USD_DENOMS.map((denom, i) => (
                      <div key={denom} style={{
                        display: 'grid', gridTemplateColumns: '1fr auto',
                        alignItems: 'center', gap: '0.75rem',
                        padding: '0.65rem 1rem',
                        borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.7)' }}>
                          ${denom}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <input
                            type="number" min="0" step="1"
                            value={cashUsd[String(denom)] ?? ''}
                            onChange={e => setCashUsd(prev => ({ ...prev, [String(denom)]: e.target.value }))}
                            placeholder="0"
                            style={{ ...numInp, width: '80px' }}
                          />
                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', minWidth: '28px' }}>pcs</span>
                        </div>
                      </div>
                    ))}
                    <div style={{
                      padding: '0.65rem 1rem',
                      borderTop: '1px solid rgba(255,255,255,0.08)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', letterSpacing: '0.05em' }}>TOTAL</span>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: '#C9962C', fontWeight: 600 }}>
                        ${totals.totalCashUsd.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Grand total row */}
              <div style={{
                marginTop: '1rem',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '4px',
                padding: '0.9rem 1.25rem',
                display: 'flex', justifyContent: 'space-around', gap: '1rem', flexWrap: 'wrap',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.3rem' }}>Grand Total LBP</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', color: 'var(--offwhite)', fontWeight: 600 }}>{formatLbp(totals.grandTotalLbp)}</p>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.3rem' }}>Grand Total USD</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', color: 'var(--offwhite)', fontWeight: 600 }}>{formatUsd(totals.grandTotalUsd)}</p>
                </div>
                <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)', alignSelf: 'center' }}>
                  Rate: {exchangeRate.toLocaleString('en-US')} {BRAND.locale.secondaryCurrency} = 1 {BRAND.locale.currency}
                </div>
              </div>
            </div>

            {/* ── The POS system's own figure ──────────────────────────────── */}
            {/* Was labelled "SYSTEM (OMEGA)" — Omega being the incumbent POS
                this platform replaces. A product should not name a competitor
                in a section header of its own admin panel. */}
            <div style={{ marginBottom: '2.5rem' }}>
              <SectionTitle label="POS SYSTEM" color="var(--purple)" />
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 280px' }}>
                  <label style={labelStyle}>System LBP</label>
                  <input
                    type="number" min="0" step="1"
                    value={systemLbp}
                    onChange={e => setSystemLbp(e.target.value)}
                    placeholder="0"
                    style={inp}
                  />
                </div>
                <div style={{ paddingBottom: '0.6rem' }}>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', marginBottom: '0.25rem', letterSpacing: '0.05em' }}>
                    Auto-converted
                  </p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', color: 'var(--purple)', fontWeight: 600 }}>
                    {formatUsd(systemUsdDerived)}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Expenses ─────────────────────────────────────────────────── */}
            <div style={{ marginBottom: '2.5rem' }}>
              <SectionTitle label="EXPENSES" color="var(--red)" />
              <LineItemList
                items={expenses}
                addLine={() => addLine(setExpenses)}
                removeLine={i => removeLine(setExpenses, i)}
                updateLine={(i, f, v) => updateLine(setExpenses, i, f, v)}
                totalUsd={totals.totalExpensesUsd}
                color="var(--red)"
              />
              <HintBox color="var(--red)" hints={[
                'Any receipts paid from the cash',
                'Any unpaid bills (Totters, Wish, or receipts for Elie)',
                'Any money removed from the current cash for any reason',
              ]} />
            </div>

            {/* ── Income ───────────────────────────────────────────────────── */}
            <div style={{ marginBottom: '2.5rem' }}>
              <SectionTitle label="INCOME" color="var(--teal)" />
              <LineItemList
                items={income}
                addLine={() => addLine(setIncome)}
                removeLine={i => removeLine(setIncome, i)}
                updateLine={(i, f, v) => updateLine(setIncome, i, f, v)}
                totalUsd={totals.totalIncomeUsd}
                color="var(--teal)"
              />
              <HintBox color="var(--teal)" hints={[
                'Any boardgame sale or any sale recorded',
                'Any money added to the cash from anyone that is not a receipt',
              ]} />
            </div>

            {/* ── Tips ────────────────────────────────────────────────────── */}
            <div style={{ marginBottom: '2.5rem' }}>
              <SectionTitle label="TIPS" color="#C9962C" />
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 220px' }}>
                  <label style={labelStyle}>Tips collected (USD)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-inter)', fontSize: '0.9rem', flexShrink: 0 }}>$</span>
                    <input
                      type="number" min="0" step="0.01"
                      value={tipsUsd}
                      onChange={e => setTipsUsd(e.target.value)}
                      placeholder="0.00"
                      style={{ ...inp, textAlign: 'right' }}
                    />
                  </div>
                </div>
                {Number(tipsUsd) > 0 && (
                  <div style={{ paddingBottom: '0.6rem' }}>
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.35)', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>
                      After 11% deduction
                    </p>
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', color: '#C9962C', fontWeight: 600 }}>
                      {formatUsd(Number(tipsUsd) * 0.89)}
                    </p>
                  </div>
                )}
              </div>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.2)', marginTop: '0.5rem' }}>
                Used in the tips calculator to distribute among staff by shift
              </p>
            </div>

            {/* ── Difference ───────────────────────────────────────────────── */}
            <div style={{
              marginBottom: '2.5rem',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '6px',
              padding: '1.25rem 1.5rem',
            }}>
              <SectionTitle label="DIFFERENCE" color={diffLbpColor} />
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem' }}>
                <DiffBlock label="Difference LBP" value={formatLbp(totals.differenceLbp)} color={diffLbpColor} />
                <DiffBlock label="Difference USD"  value={formatUsd(totals.differenceUsd)}  color={diffUsdColor} />
              </div>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.25)', marginTop: '0.85rem' }}>
                Difference = Grand Total + Expenses − Income − System
              </p>
            </div>

            {/* ── Attendance ───────────────────────────────────────────────── */}
            <div style={{ marginBottom: '2.5rem' }}>
              <SectionTitle label="ATTENDANCE" color="rgba(245,242,236,0.6)" />

              {attendance.length === 0 && (
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.25)', marginBottom: '1rem' }}>
                  No staff roster set.{' '}
                  <a href="/admin/end-of-day/staff" style={{ color: 'var(--teal)', textDecoration: 'none' }}>Set up the roster →</a>
                </p>
              )}

              {attendance.length > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' }}>
                  {attendance.map((entry, idx) => {
                    const present = entry.shift !== 'none'
                    return (
                      <div key={`${entry.name}-${idx}`} style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.75rem 1rem',
                        borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}>
                        {/* Present checkbox */}
                        <button
                          type="button"
                          onClick={() => setShift(idx, present ? 'none' : 'pm')}
                          title={present ? 'Mark absent' : 'Mark present'}
                          style={{
                            width: 22, height: 22, flexShrink: 0,
                            borderRadius: '3px',
                            border: `2px solid ${present ? 'var(--teal)' : 'rgba(255,255,255,0.2)'}`,
                            backgroundColor: present ? 'var(--teal)' : 'transparent',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {present && <span style={{ color: '#fff', fontSize: '0.7rem', lineHeight: 1, fontWeight: 700 }}>✓</span>}
                        </button>

                        {/* Name */}
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{
                            fontFamily: 'var(--font-inter)', fontSize: '0.88rem',
                            color: present ? 'var(--offwhite)' : 'rgba(245,242,236,0.35)',
                            transition: 'color 0.15s',
                          }}>
                            {entry.name}
                          </span>
                          {entry.isGuest && (
                            <span style={{
                              fontSize: '0.6rem', letterSpacing: '0.08em',
                              background: 'rgba(201,150,44,0.15)', color: '#C9962C',
                              border: '1px solid rgba(201,150,44,0.3)',
                              borderRadius: '3px', padding: '0.15rem 0.4rem',
                              fontFamily: 'var(--font-inter)', textTransform: 'uppercase',
                            }}>Guest</span>
                          )}
                        </div>

                        {/* Shift selector — only visible when present */}
                        <div style={{ display: 'flex', gap: '0.35rem', opacity: present ? 1 : 0.25, pointerEvents: present ? 'auto' : 'none' }}>
                          {(['am', 'pm', 'double'] as const).map(s => (
                            <button
                              key={s} type="button"
                              onClick={() => setShift(idx, s)}
                              style={{
                                padding: '0.3rem 0.65rem',
                                borderRadius: '2px', border: 'none', cursor: 'pointer',
                                fontSize: '0.72rem', fontFamily: 'var(--font-inter)', fontWeight: 600,
                                backgroundColor: entry.shift === s ? 'var(--teal)' : 'rgba(255,255,255,0.06)',
                                color: entry.shift === s ? '#fff' : 'rgba(245,242,236,0.4)',
                              }}
                            >
                              {SHIFT_LABELS[s]}
                            </button>
                          ))}
                        </div>

                        {/* Remove guest */}
                        {entry.isGuest ? (
                          <button
                            type="button"
                            onClick={() => removeAttendee(idx)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(245,242,236,0.25)', fontSize: '1rem', padding: '0.2rem 0.4rem', flexShrink: 0 }}
                          >×</button>
                        ) : <span style={{ width: 24, flexShrink: 0 }} />}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add guest — search existing accounts or type a name */}
              <div>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginBottom: '0.5rem' }}>
                  Add guest / cross-branch staff
                </p>
                <StaffSearchCombobox
                  staffList={staffList}
                  staffListErr={staffListErr}
                  attendance={attendance}
                  onSelect={name => {
                    setAttendance(prev => [...prev, { name, shift: 'none', isGuest: true }])
                  }}
                  inp={inp}
                />
              </div>
            </div>

            {/* ── Notes ────────────────────────────────────────────────────── */}
            <div style={{ marginBottom: '2rem' }}>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Any additional notes…"
                style={{ ...inp, resize: 'vertical' }}
              />
            </div>

            {/* ── Submit ───────────────────────────────────────────────────── */}
            {err && (
              <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>
                {err}
              </p>
            )}
            {saved && (
              <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                <p style={{ color: 'var(--teal)', fontSize: '0.82rem', fontFamily: 'var(--font-inter)' }}>
                  ✓ Report saved successfully.
                </p>
                <a
                  href={`/admin/end-of-day/summary?branch=${encodeURIComponent(branch)}&date=${date}`}
                  style={{
                    fontSize: '0.78rem', color: '#C9962C',
                    textDecoration: 'none', fontFamily: 'var(--font-inter)',
                  }}
                >View summary →</a>
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button
                type="submit"
                disabled={saving}
                style={{
                  backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
                  padding: '0.85rem 2rem', borderRadius: '2px',
                  fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-inter)', opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : existingId ? 'Update Report' : 'Save Report'}
              </button>
              <a href="/admin/end-of-day/history" style={{
                fontSize: '0.75rem', color: 'rgba(245,242,236,0.35)',
                textDecoration: 'none', fontFamily: 'var(--font-inter)',
              }}>View all reports →</a>
            </div>

          </>)}

        </form>
      </div>
    </div>
  )
}

export default function EndOfDayPage() {
  return (
    <Suspense fallback={null}>
      <EndOfDayInner />
    </Suspense>
  )
}

// ─── Staff search combobox ───────────────────────────────────────────────────

function StaffSearchCombobox({
  staffList, staffListErr, attendance, onSelect, inp,
}: {
  staffList:    StaffUser[]
  staffListErr: boolean
  attendance:   AttendanceEntry[]
  onSelect:     (name: string) => void
  inp:          React.CSSProperties
}) {
  const [searchText, setSearchText] = useState('')
  const [freeText,   setFreeText]   = useState('')

  const alreadyAdded = new Set(attendance.map(a => a.name))

  const matches = searchText.trim().length >= 1
    ? staffList.filter(s =>
        s.email.toLowerCase().includes(searchText.toLowerCase()) &&
        !alreadyAdded.has(s.email)
      ).slice(0, 8)
    : []

  const showResults = searchText.trim().length >= 1

  function addFreeText() {
    const name = freeText.trim()
    if (!name || alreadyAdded.has(name)) return
    onSelect(name)
    setFreeText('')
  }

  const hintText = staffListErr
    ? 'Could not load staff accounts'
    : staffList.length === 0
      ? 'Loading staff accounts…'
      : `${staffList.length} staff account${staffList.length !== 1 ? 's' : ''} · type to search`

  const hintColor = staffListErr ? 'var(--red)' : 'rgba(245,242,236,0.25)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>

      {/* Account search */}
      <div>
        <input
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Search by email…"
          autoComplete="off"
          style={inp}
        />
        {/* Hint / count */}
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: hintColor, marginTop: '0.3rem' }}>
          {hintText}
        </p>

        {/* Results list — inline (no absolute positioning) */}
        {showResults && (
          <div style={{
            marginTop: '0.4rem',
            backgroundColor: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            {matches.length === 0 ? (
              <p style={{ padding: '0.65rem 1rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.3)' }}>
                No matching accounts found
              </p>
            ) : matches.map(s => (
              <button
                key={s.uid}
                type="button"
                onClick={() => { onSelect(s.email); setSearchText('') }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '0.7rem 1rem', textAlign: 'left',
                  background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  cursor: 'pointer', gap: '0.75rem',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: '#F5F2EC' }}>
                  {s.email}
                </span>
                <span style={{
                  fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.08em',
                  color: 'rgba(245,242,236,0.35)', textTransform: 'uppercase', flexShrink: 0,
                }}>
                  {s.role ? (ROLE_LABELS as Record<string, string>)[s.role] ?? s.role : ''}
                  {s.branchIds.length > 0 ? ` · ${s.branchIds.join(', ')}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Free-form fallback for staff without accounts */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Or type a name (no account yet)…"
          value={freeText}
          onChange={e => setFreeText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFreeText() } }}
          style={{ ...inp, fontSize: '0.82rem' }}
        />
        <button
          type="button" onClick={addFreeText}
          style={{
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(245,242,236,0.5)',
            padding: '0.6rem 0.9rem',
            borderRadius: '2px', fontSize: '0.75rem',
            cursor: 'pointer', fontFamily: 'var(--font-inter)',
            whiteSpace: 'nowrap',
          }}
        >+ Add</button>
      </div>
    </div>
  )
}

// ─── sub-components ─────────────────────────────────────────────────────────

function SumCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginBottom: '0.25rem' }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.95rem', fontWeight: 600, color }}>{value}</p>
    </div>
  )
}

function DiffBlock({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      textAlign: 'center',
      background: `${color}12`,
      border: `1px solid ${color}30`,
      borderRadius: '4px',
      padding: '1rem',
    }}>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.4)', marginBottom: '0.4rem' }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', color, fontWeight: 700 }}>{value}</p>
    </div>
  )
}

function HintBox({ hints, color }: { hints: string[]; color: string }) {
  return (
    <div style={{
      marginTop: '0.75rem',
      padding: '0.75rem 1rem',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderLeft: `3px solid ${color}50`,
      borderRadius: '2px',
    }}>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginBottom: '0.45rem' }}>
        What to include
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {hints.map((h, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: color, flexShrink: 0, marginTop: '0.35em' }} />
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.45)' }}>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LineItemList({
  items,
  addLine,
  removeLine,
  updateLine,
  totalUsd,
  color,
}: {
  items: { name: string; amountUsd: string }[]
  addLine: () => void
  removeLine: (i: number) => void
  updateLine: (i: number, f: 'name' | 'amountUsd', v: string) => void
  totalUsd: number
  color: string
}) {
  const isMobile = useIsMobile()
  const inp2: React.CSSProperties = {
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#F5F2EC',
    padding: '0.55rem 0.75rem',
    borderRadius: '2px',
    fontSize: '0.85rem',
    outline: 'none',
    fontFamily: 'var(--font-inter)',
  }

  return (
    <div>
      {items.length > 0 && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden', marginBottom: '0.75rem' }}>
          {items.map((item, idx) => (
            <div key={idx} style={{
              display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto',
              gap: '0.6rem', alignItems: 'center',
              padding: '0.65rem 1rem',
              borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <input
                type="text"
                placeholder="Description"
                value={item.name}
                onChange={e => updateLine(idx, 'name', e.target.value)}
                style={{ ...inp2, width: '100%' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', width: isMobile ? '100%' : '110px', flex: isMobile ? 1 : 'initial' }}>
                  <span style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>$</span>
                  <input
                    type="number" min="0" step="0.01"
                    placeholder="0.00"
                    value={item.amountUsd}
                    onChange={e => updateLine(idx, 'amountUsd', e.target.value)}
                    style={{ ...inp2, textAlign: 'right', width: '100%' }}
                  />
                </div>
                <button
                  type="button" onClick={() => removeLine(idx)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(245,242,236,0.25)', fontSize: '1rem', padding: '0.2rem 0.4rem', flexShrink: 0 }}
                >×</button>
              </div>
            </div>
          ))}
          <div style={{
            padding: '0.65rem 1rem',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center',
          }}>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', letterSpacing: '0.05em' }}>TOTAL USD</span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color, fontWeight: 600 }}>{formatUsd(totalUsd)}</span>
          </div>
        </div>
      )}
      <button
        type="button" onClick={addLine}
        style={{
          backgroundColor: 'transparent',
          border: `1px dashed ${color}50`,
          color: color,
          padding: '0.5rem 1rem',
          borderRadius: '2px', fontSize: '0.75rem',
          cursor: 'pointer', fontFamily: 'var(--font-inter)',
        }}
      >+ Add line</button>
    </div>
  )
}
