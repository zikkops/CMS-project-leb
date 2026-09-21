'use client'

export const dynamic = 'force-dynamic'

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES } from '@big-cms/shared/branches'
import { useBusinessSettings } from '@big-cms/shared/useBusinessSettings'
import { useFeature } from '@big-cms/shared/useFeatures'
import {
  LBP_DENOMS, USD_DENOMS,
  computeTotals, emptyReport, getEndOfDayReport, saveEndOfDayReport, getPosSystem,
  getBranchStaff, listAllStaff, defaultEodDateStr, formatLbp, formatUsd,
  type AttendanceEntry, type EndOfDayReport, type StaffUser,
} from '@big-cms/shared/endOfDay'
import { startLoad } from '@big-cms/shared/startLoad'
import { inp, selStyle, labelStyle } from './_components/styles'
import { parseCash, cashToStr } from './_components/cash'
import { SectionTitle, SumCell, DiffBlock, HintBox } from './_components/parts'
import { LineItemList } from './_components/LineItemList'
import { CashCountSection } from './_components/CashCountSection'
import { PosSystemSection, type PosState } from './_components/PosSystemSection'
import { TipsSection } from './_components/TipsSection'
import { AttendanceSection } from './_components/AttendanceSection'

function EndOfDayInner() {
  const params = useSearchParams()
  const isMobile = useIsMobile()
  const { checking, role, branchIds, user } = useRequireRole(SECTION_ACCESS.endOfDay)
  // Live, so changing the rate at /admin/settings reaches a form already open
  // at a till. A report stores the rate it was submitted with regardless.
  const { settings: { exchangeRate, tipsDeductionRate } } = useBusinessSettings()
  // Phase 04: once the till takes money, the "system" figure is the POS's own
  // — the day's drawer shifts (daySystem() in drawer.ts) — not a number typed
  // from the old till. Off, this form is exactly what it was.
  const { on: fromPos } = useFeature('payments')
  const [posState, setPosState] = useState<PosState | null>(null)

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

  // Once the role is known: a manager with one branch gets it chosen, and a
  // link from history pre-fills its branch and date. Only a branch the user
  // actually has access to. Worked out while rendering, and again whenever
  // the address changes.
  const paramKey = checking ? null : params.toString()
  const [seenParams, setSeenParams] = useState<string | null>(null)
  if (paramKey !== null && paramKey !== seenParams) {
    if (seenParams === null && role !== 'admin' && branchIds.length === 1) setBranch(branchIds[0])
    setSeenParams(paramKey)
    const pb = params.get('branch')
    const pd = params.get('date')
    if (pb && (role === 'admin' || branchIds.includes(pb))) setBranch(pb)
    if (pd) setDate(pd)
  }

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
    startLoad(() => {
      if (cancelled) return
      setLoading(true)
      return Promise.all([
        getEndOfDayReport(branch, date),
        getBranchStaff(branch),
      ]).then(([report, staffDoc]) => {
        if (cancelled) return
        const rosterNames = staffDoc?.staff ?? []
        resetForm(report, rosterNames)
        setLoading(false)
      }).catch(() => { if (!cancelled) setLoading(false) })
    })
    return () => { cancelled = true }
  }, [branch, date, resetForm])

  // The POS figure for this branch and day. Keyed, so a stale answer for the
  // branch just switched away from is never shown against the new one.
  const posKey = `${branch}|${date}`
  useEffect(() => {
    if (!fromPos || !branch || !date) return
    let cancelled = false
    getPosSystem(branch, date)
      .then(data => { if (!cancelled) setPosState({ key: posKey, data, err: '' }) })
      .catch(e => {
        if (!cancelled) setPosState({ key: posKey, data: null, err: e instanceof Error ? e.message : 'Could not read the POS figure.' })
      })
    return () => { cancelled = true }
  }, [fromPos, branch, date, posKey])
  const posNow = fromPos && posState?.key === posKey ? posState : null

  // System USD is derived from LBP at the configured rate — editable at
  // /admin/settings, and live, so a rate change reaches an open form.
  //
  // With the POS on, the figure is DERIVED from its answer rather than copied
  // into the field: the saved report and the POS figure load in parallel, and
  // whichever arrived second would otherwise overwrite the other.
  const systemLbpNum = fromPos
    ? posNow?.data?.systemLbp ?? 0
    : Number(systemLbp) || 0
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

  const diffLbpColor  = totals.differenceLbp === 0 ? 'var(--teal)' : totals.differenceLbp > 0 ? 'var(--red)' : 'var(--brand-secondary)'
  const diffUsdColor  = totals.differenceUsd  === 0 ? 'var(--teal)' : totals.differenceUsd  > 0 ? 'var(--red)' : 'var(--brand-secondary)'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '0.5rem' }}>
            <a href="/admin/end-of-day/history" style={{
              fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
            }}>← EOD History</a>
            {(role === 'admin' || role === 'manager') && (
              <a href="/admin/end-of-day/log" style={{
                fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'rgba(var(--offwhite-rgb),0.2)', textDecoration: 'none',
                fontFamily: 'var(--font-inter)',
              }}>View Log</a>
            )}
          </div>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            End of Day Report
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
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
            <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)', marginBottom: '2rem' }}>
              Loading…
            </p>
          )}

          {!loading && branch && date && (<>

            {/* ── Summary ──────────────────────────────────────────────────── */}
            <div style={{
              background: 'rgba(var(--overlay-rgb),0.02)',
              border: '1px solid rgba(var(--overlay-rgb),0.07)',
              borderRadius: '6px',
              padding: '1.25rem 1.5rem',
              marginBottom: '2.5rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
            }}>
              <SumCell label="Counted LBP"    value={formatLbp(totals.totalCashLbp)} color="var(--teal)" />
              <SumCell label="Counted USD"    value={formatUsd(totals.totalCashUsd)} color="var(--teal)" />
              <SumCell label="Grand Total LBP" value={formatLbp(totals.grandTotalLbp)} color="rgba(var(--offwhite-rgb),0.7)" />
              <SumCell label="Grand Total USD" value={formatUsd(totals.grandTotalUsd)} color="rgba(var(--offwhite-rgb),0.7)" />
              <SumCell label="Difference LBP"  value={formatLbp(totals.differenceLbp)} color={diffLbpColor} />
              <SumCell label="Difference USD"  value={formatUsd(totals.differenceUsd)} color={diffUsdColor} />
            </div>

            {/* ── Cash Count ───────────────────────────────────────────────── */}
            <CashCountSection
              isMobile={isMobile}
              cashLbp={cashLbp}
              cashUsd={cashUsd}
              setCashLbp={setCashLbp}
              setCashUsd={setCashUsd}
              totals={totals}
              exchangeRate={exchangeRate}
            />

            {/* ── The POS system's own figure ──────────────────────────────── */}
            <PosSystemSection
              fromPos={fromPos}
              posNow={posNow}
              systemLbp={systemLbp}
              setSystemLbp={setSystemLbp}
              systemUsdDerived={systemUsdDerived}
            />

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
                'Any retail sale or any other sale recorded',
                'Any money added to the cash from anyone that is not a receipt',
              ]} />
            </div>

            {/* ── Tips ────────────────────────────────────────────────────── */}
            <TipsSection
              tipsUsd={tipsUsd}
              setTipsUsd={setTipsUsd}
              tipsDeductionRate={tipsDeductionRate}
              fromPos={fromPos}
              posNow={posNow}
            />

            {/* ── Difference ───────────────────────────────────────────────── */}
            <div style={{
              marginBottom: '2.5rem',
              background: 'rgba(var(--overlay-rgb),0.02)',
              border: '1px solid rgba(var(--overlay-rgb),0.07)',
              borderRadius: '6px',
              padding: '1.25rem 1.5rem',
            }}>
              <SectionTitle label="DIFFERENCE" color={diffLbpColor} />
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem' }}>
                <DiffBlock label="Difference LBP" value={formatLbp(totals.differenceLbp)} color={diffLbpColor} />
                <DiffBlock label="Difference USD"  value={formatUsd(totals.differenceUsd)}  color={diffUsdColor} />
              </div>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.25)', marginTop: '0.85rem' }}>
                Difference = Grand Total + Expenses − Income − System
              </p>
            </div>

            {/* ── Attendance ───────────────────────────────────────────────── */}
            <AttendanceSection
              attendance={attendance}
              setAttendance={setAttendance}
              staffList={staffList}
              staffListErr={staffListErr}
            />

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
                    fontSize: '0.78rem', color: 'var(--brand-secondary)',
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
                fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.35)',
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
