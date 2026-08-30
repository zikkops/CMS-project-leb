'use client'

import { useEffect, useState } from 'react'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES } from '@big-cms/shared/branches'
import {
  listEndOfDayReports, computeTotals, formatLbp, formatUsd,
  type EndOfDayReport,
} from '@big-cms/shared/endOfDay'

export default function EndOfDayHistoryPage() {
  const isMobile = useIsMobile()
  const { checking, role, branchIds } = useRequireRole(SECTION_ACCESS.endOfDayHistory)

  const branchOptions = role === 'admin' ? ['all', ...BRANCHES] : branchIds
  const defaultBranch = role === 'admin' ? 'all' : (branchIds[0] ?? '')

  const [branch,  setBranch]  = useState(defaultBranch)
  const [reports, setReports] = useState<EndOfDayReport[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (checking) return
    if (role !== 'admin' && branchIds.length === 1) setBranch(branchIds[0])
  }, [checking, role, branchIds])

  useEffect(() => {
    if (!branch) return
    setLoading(true)
    listEndOfDayReports(branch as string | 'all').then(data => {
      setReports(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [branch])

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/end-of-day" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
          }}>← Submit Report</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            EOD History
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)' }}>
            Past end-of-day reports
          </p>
        </div>

        {/* Branch filter */}
        <div style={{ marginBottom: '2rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {branchOptions.map(b => (
            <button
              key={b}
              onClick={() => setBranch(b)}
              style={{
                padding: '0.45rem 1rem',
                borderRadius: '2px', border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', fontFamily: 'var(--font-inter)',
                backgroundColor: branch === b ? '#C9962C' : 'rgba(255,255,255,0.05)',
                color: branch === b ? '#000' : 'rgba(245,242,236,0.5)',
                fontWeight: branch === b ? 600 : 400,
              }}
            >
              {b === 'all' ? 'All Branches' : b}
            </button>
          ))}
        </div>

        {loading && (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        )}

        {!loading && reports.length === 0 && (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            No reports yet for this branch.{' '}
            <a href="/admin/end-of-day" style={{ color: '#C9962C' }}>Submit the first one →</a>
          </div>
        )}

        {!loading && reports.length > 0 && isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {reports.map(r => {
              // Each report's OWN rate, not today's. These are historical
              // figures and must not move when the rate does.
              const t = computeTotals(
                r.cashLbp, r.cashUsd,
                r.systemLbp, r.systemUsd,
                r.expenses, r.income,
                r.exchangeRate,
              )
              const diffLbpColor = t.differenceLbp === 0 ? 'var(--teal)' : t.differenceLbp > 0 ? 'var(--red)' : '#C9962C'
              const diffUsdColor = t.differenceUsd  === 0 ? 'var(--teal)' : t.differenceUsd  > 0 ? 'var(--red)' : '#C9962C'
              return (
                <div key={r.id} style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '4px',
                  padding: '0.9rem 1.1rem',
                  display: 'flex', flexDirection: 'column', gap: '0.5rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)', fontWeight: 500 }}>
                      {r.date}
                    </span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.5)' }}>
                      {r.branch}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '1.5rem' }}>
                    <div>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginBottom: '0.2rem' }}>Diff LBP</p>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: diffLbpColor, fontWeight: 600 }}>{formatLbp(t.differenceLbp)}</p>
                    </div>
                    <div>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginBottom: '0.2rem' }}>Diff USD</p>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: diffUsdColor, fontWeight: 600 }}>{formatUsd(t.differenceUsd)}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)' }}>
                      {r.submittedByEmail}
                    </span>
                    <a
                      href={`/admin/end-of-day?branch=${encodeURIComponent(r.branch)}&date=${r.date}`}
                      style={{
                        fontSize: '0.72rem', color: '#C9962C',
                        textDecoration: 'none', fontFamily: 'var(--font-inter)',
                        whiteSpace: 'nowrap',
                      }}
                    >Edit →</a>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && reports.length > 0 && !isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '130px 110px 1fr 1fr 1fr 60px',
              gap: '0.75rem',
              padding: '0.5rem 1rem',
              fontFamily: 'var(--font-inter)', fontSize: '0.62rem',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.3)',
            }}>
              <span>Date</span>
              <span>Branch</span>
              <span>Diff LBP</span>
              <span>Diff USD</span>
              <span>Submitted by</span>
              <span />
            </div>

            {reports.map(r => {
              // Each report's OWN rate, not today's. These are historical
              // figures and must not move when the rate does.
              const t = computeTotals(
                r.cashLbp, r.cashUsd,
                r.systemLbp, r.systemUsd,
                r.expenses, r.income,
                r.exchangeRate,
              )
              const diffLbpColor = t.differenceLbp === 0 ? 'var(--teal)' : t.differenceLbp > 0 ? 'var(--red)' : '#C9962C'
              const diffUsdColor = t.differenceUsd  === 0 ? 'var(--teal)' : t.differenceUsd  > 0 ? 'var(--red)' : '#C9962C'
              return (
                <div key={r.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '130px 110px 1fr 1fr 1fr 60px',
                  gap: '0.75rem',
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '4px',
                  padding: '0.9rem 1rem',
                }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)', fontWeight: 500 }}>
                    {r.date}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.5)' }}>
                    {r.branch}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: diffLbpColor, fontWeight: 600 }}>
                    {formatLbp(t.differenceLbp)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: diffUsdColor, fontWeight: 600 }}>
                    {formatUsd(t.differenceUsd)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.35)' }}>
                    {r.submittedByEmail}
                  </span>
                  <a
                    href={`/admin/end-of-day?branch=${encodeURIComponent(r.branch)}&date=${r.date}`}
                    style={{
                      fontSize: '0.72rem', color: '#C9962C',
                      textDecoration: 'none', fontFamily: 'var(--font-inter)',
                      whiteSpace: 'nowrap',
                    }}
                  >Edit →</a>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
