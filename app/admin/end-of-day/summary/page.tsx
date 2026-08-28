'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useIsMobile } from '../../../lib/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import { BRANCHES } from '../../../lib/branches'
import {
  getEndOfDayReport, updateEodTips, computeTotals, formatLbp, formatUsd, defaultEodDateStr,
  type EndOfDayReport,
} from '../../../lib/endOfDay'

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

const selStyle: React.CSSProperties = { ...inp, backgroundColor: '#1a1a1a', cursor: 'pointer' }

function Row({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '0.85rem 1.25rem',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.45)', letterSpacing: '0.04em' }}>
        {label}
        {sub && <span style={{ display: 'block', fontSize: '0.68rem', color: 'rgba(245,242,236,0.25)', marginTop: '0.2rem' }}>{sub}</span>}
      </span>
      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.95rem', fontWeight: 600, color: color ?? 'var(--offwhite)', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

function EndOfDaySummaryInner() {
  const params = useSearchParams()
  const isMobile = useIsMobile()
  const { checking, role, branchIds, user } = useRequireRole(SECTION_ACCESS.endOfDayHistory)

  const branchOptions = role === 'admin' ? [...BRANCHES] : branchIds

  const [branch,  setBranch]  = useState('')
  const [date,    setDate]    = useState(defaultEodDateStr())
  const [report,  setReport]  = useState<EndOfDayReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [tips,    setTips]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [err,     setErr]     = useState('')

  useEffect(() => {
    if (checking) return
    if (role !== 'admin' && branchIds.length === 1) setBranch(branchIds[0])
  }, [checking, role, branchIds])

  // Pre-fill from URL params (e.g. coming from the EOD submit page)
  useEffect(() => {
    if (checking) return
    const pb = params.get('branch')
    const pd = params.get('date')
    if (pb && (role === 'admin' || branchIds.includes(pb))) setBranch(pb)
    if (pd) setDate(pd)
  }, [params, checking, role, branchIds])

  useEffect(() => {
    if (!branch || !date) return
    let cancelled = false
    setLoading(true)
    setSaved(false)
    getEndOfDayReport(branch, date).then(r => {
      if (cancelled) return
      setReport(r)
      setTips(r?.tipsUsd ? String(r.tipsUsd) : '')
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [branch, date])

  async function handleSaveTips(e: React.FormEvent) {
    e.preventDefault()
    if (!branch || !date || !user) return
    setSaving(true); setErr('')
    try {
      await updateEodTips(branch, date, Number(tips) || 0)
      setReport(prev => prev ? { ...prev, tipsUsd: Number(tips) || 0 } : prev)
      setSaved(true)
    } catch {
      setErr('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  const totals = report
    ? computeTotals(report.cashLbp, report.cashUsd, report.systemLbp, report.systemUsd, report.expenses, report.income)
    : null

  const diffLbpColor = !totals ? 'var(--offwhite)'
    : totals.differenceLbp === 0 ? 'var(--teal)'
    : totals.differenceLbp > 0 ? 'var(--red)' : '#C9962C'
  const diffUsdColor = !totals ? 'var(--offwhite)'
    : totals.differenceUsd === 0 ? 'var(--teal)'
    : totals.differenceUsd > 0 ? 'var(--red)' : '#C9962C'

  const tipsNum = Number(tips) || (report?.tipsUsd ?? 0)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '2rem 1rem 4rem' }}>
      <div style={{ maxWidth: '520px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/end-of-day/history" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
          }}>← EOD History</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            Daily Summary
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)' }}>
            End-of-day totals for screenshotting
          </p>
        </div>

        {/* Branch + Date */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label style={{
              display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
              marginBottom: '0.4rem', fontFamily: 'var(--font-inter)',
            }}>Branch</label>
            {branchOptions.length === 1 ? (
              <div style={{ ...inp }}>{branch}</div>
            ) : (
              <select value={branch} onChange={e => setBranch(e.target.value)} style={selStyle}>
                <option value="">— Select —</option>
                {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
          <div>
            <label style={{
              display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
              marginBottom: '0.4rem', fontFamily: 'var(--font-inter)',
            }}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
          </div>
        </div>

        {loading && (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', textAlign: 'center', padding: '2rem 0' }}>
            Loading…
          </p>
        )}

        {!loading && branch && date && !report && (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '2.5rem', textAlign: 'center',
            color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            No report submitted for {branch} on {date}.
          </div>
        )}

        {!loading && report && (<>

          {/* Tips entry */}
          <form onSubmit={handleSaveTips} style={{ marginBottom: '1.5rem' }}>
            <label style={{
              display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em',
              textTransform: 'uppercase', color: '#C9962C',
              marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
            }}>Tips (USD)</label>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 }}>
                <span style={{ color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.9rem', flexShrink: 0 }}>$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={tips}
                  onChange={e => { setTips(e.target.value); setSaved(false) }}
                  placeholder="0.00"
                  style={{ ...inp, textAlign: 'right' }}
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                style={{
                  backgroundColor: '#C9962C', color: '#000', border: 'none',
                  padding: '0.65rem 1.25rem', borderRadius: '2px',
                  fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-inter)', fontWeight: 600,
                  opacity: saving ? 0.6 : 1, flexShrink: 0,
                }}
              >{saving ? 'Saving…' : 'Save'}</button>
            </div>
            {saved && (
              <p style={{ color: 'var(--teal)', fontSize: '0.78rem', marginTop: '0.5rem', fontFamily: 'var(--font-inter)' }}>
                ✓ Tips saved.
              </p>
            )}
            {err && (
              <p style={{ color: 'var(--red)', fontSize: '0.78rem', marginTop: '0.5rem', fontFamily: 'var(--font-inter)' }}>
                {err}
              </p>
            )}
          </form>

          {/* Screenshot card */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            overflow: 'hidden',
          }}>
            {/* Card header */}
            <div style={{
              background: 'rgba(201,150,44,0.08)',
              borderBottom: '1px solid rgba(201,150,44,0.2)',
              padding: '1rem 1.25rem',
            }}>
              <p style={{
                fontFamily: 'var(--font-cinzel)', fontSize: '0.85rem',
                color: '#C9962C', letterSpacing: '0.15em', textTransform: 'uppercase',
                marginBottom: '0.2rem',
              }}>
                Onboard — Daily Summary
              </p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)' }}>
                {report.branch} · {report.date}
              </p>
            </div>

            {/* System / Omega */}
            <Row
              label="System (Omega)"
              sub={`LBP: ${formatLbp(report.systemLbp)}`}
              value={formatUsd(report.systemUsd)}
              color="var(--purple)"
            />

            {/* Expenses */}
            <Row
              label="Expenses"
              value={formatUsd(totals!.totalExpensesUsd)}
              color="var(--red)"
            />

            {/* Tips */}
            <Row
              label="Tips"
              value={formatUsd(tipsNum)}
              color="#C9962C"
            />

            {/* Difference */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              borderTop: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div style={{ padding: '0.6rem 1.25rem 0.2rem' }}>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)' }}>
                  Difference (Omega)
                </span>
              </div>
              <Row
                label="LBP"
                value={formatLbp(totals!.differenceLbp)}
                color={diffLbpColor}
              />
              <Row
                label="USD"
                value={formatUsd(totals!.differenceUsd)}
                color={diffUsdColor}
              />
            </div>

            {/* Footer */}
            <div style={{
              padding: '0.6rem 1.25rem',
              borderTop: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', color: 'rgba(245,242,236,0.2)' }}>
                Submitted by {report.submittedByEmail}
              </span>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', color: 'rgba(245,242,236,0.2)' }}>
                Rate: 90,000 LBP = $1
              </span>
            </div>
          </div>

        </>)}

      </div>
    </div>
  )
}

export default function EndOfDaySummaryPage() {
  return (
    <Suspense fallback={null}>
      <EndOfDaySummaryInner />
    </Suspense>
  )
}
