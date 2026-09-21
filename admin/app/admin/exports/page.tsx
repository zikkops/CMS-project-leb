'use client'

// The accountant's export — Phase 05's "data export", the line every POS buyer
// reads out in the first sales call.
//
// It asks the server for a date range and shows what it got before anybody
// downloads anything. That preview is the point: an export is believed later,
// by someone who cannot check it against a drawer, so the moment to notice
// that a day is missing or a total looks wrong is here, while the person
// looking still remembers the week.
//
// No money is computed in this file. The figures come from the server, which
// builds them with shared/src/salesExport.ts — the same module a verifier
// pins to an explicit timezone, rate and VAT rate.

import { useEffect, useMemo, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { BRAND } from '@big-cms/shared/brand'
import { todayYmd } from '@big-cms/shared/dates'
import { cutShortMessage, type SalesExport } from '@big-cms/shared/salesExport'
import type { LoyaltyExport } from '@big-cms/shared/loyaltyExport'
import { downloadSalesWorkbook, downloadLoyaltyWorkbook, downloadDaysCsv } from './workbook'

/** Two ledgers, one date range: what the till took, and what the points did. */
type Report = 'sales' | 'loyalty'

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

const field: React.CSSProperties = {
  minHeight: '42px', padding: '0 0.7rem', borderRadius: '4px',
  background: 'rgba(var(--overlay-rgb),0.04)', border: '1px solid rgba(var(--overlay-rgb),0.14)',
  color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem',
  outline: 'none',
}

const button: React.CSSProperties = {
  minHeight: '42px', padding: '0 1.1rem', borderRadius: '4px', cursor: 'pointer',
  fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
  letterSpacing: '0.08em', textTransform: 'uppercase',
}

export default function SalesExportPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const isMobile = useIsMobile()

  // The café's today, not the browser's. A manager in another zone opening
  // this at midnight should still get the café's current day.
  const today = todayYmd(BRAND.locale.timezone)
  const monthStart = `${today.slice(0, 7)}-01`

  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [branch, setBranch] = useState('')
  const [report, setReport] = useState<Report>('sales')
  const [data, setData] = useState<SalesExport | null>(null)
  const [loyalty, setLoyalty] = useState<LoyaltyExport | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const totals = useMemo(() => {
    if (!data) return null
    return data.days.reduce(
      (t, d) => ({
        checks: t.checks + d.checks,
        net: Math.round((t.net + d.net) * 100) / 100,
        vat: Math.round((t.vat + d.vat) * 100) / 100,
        refunds: Math.round((t.refunds + d.refunds) * 100) / 100,
        refundedChecks: t.refundedChecks + d.refundedChecks,
        cashUsd: Math.round((t.cashUsd + d.cashUsd) * 100) / 100,
        cashLbp: t.cashLbp + d.cashLbp,
        card: Math.round((t.card + d.card) * 100) / 100,
      }),
      { checks: 0, net: 0, vat: 0, refunds: 0, refundedChecks: 0, cashUsd: 0, cashLbp: 0, card: 0 },
    )
  }, [data])

  // Points are whole numbers, so these add up exactly — no rounding, unlike
  // the money above.
  const pointTotals = useMemo(() => {
    if (!loyalty) return null
    return loyalty.days.reduce(
      (t, d) => ({
        issued: t.issued + d.issued,
        reversed: t.reversed + d.reversed,
        spent: t.spent + d.spent,
        net: t.net + d.net,
        transactions: t.transactions + d.transactions,
        redemptions: t.redemptions + d.redemptions,
      }),
      { issued: 0, reversed: 0, spent: 0, net: 0, transactions: 0, redemptions: 0 },
    )
  }, [loyalty])

  async function fetchRange() {
    setBusy('Reading…'); setError(''); setData(null); setLoyalty(null)
    try {
      const params = new URLSearchParams({ from, to, ...(branch ? { branch } : {}) })
      const result = await unwrap(await authedFetch(`/api/admin/exports/${report}?${params}`, 'GET'))
      if (report === 'sales') setData(result as unknown as SalesExport)
      else setLoyalty(result as unknown as LoyaltyExport)
    } catch (err) {
      setError(isNetworkFailure(err)
        ? 'No connection — nothing was read. Try again when you are back online.'
        : err instanceof Error ? err.message : 'Could not read that range.')
    } finally {
      setBusy('')
    }
  }

  async function toExcel() {
    setBusy('Building…'); setError('')
    try {
      if (data) await downloadSalesWorkbook(data, from, to)
      else if (loyalty) await downloadLoyaltyWorkbook(loyalty, from, to)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the workbook.')
    } finally {
      setBusy('')
    }
  }

  if (checking) return null

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1.25rem 1rem 4rem' : '2rem 2rem 5rem',
      fontFamily: 'var(--font-inter)', color: 'var(--offwhite)',
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        <p style={{
          fontSize: '0.6rem', letterSpacing: '0.25em', textTransform: 'uppercase',
          color: 'var(--teal)', marginBottom: '0.3rem',
        }}>Reports</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.9rem',
          marginBottom: '0.5rem',
        }}>Sales export</h1>
        <p style={{
          fontSize: '0.85rem', lineHeight: 1.7, color: 'rgba(var(--offwhite-rgb),0.45)',
          marginBottom: '1.5rem', maxWidth: '62ch',
        }}>
          Closed checks for a date range, as your accountant needs them: what each day took, every
          check, and how each was paid. Days are the café&apos;s, not the server&apos;s — a sale at
          01:30 belongs to the night it was made. Each check carries the VAT rate and exchange rate
          it was actually closed at, so re-running this next year gives the same figures.
        </p>

        {/* Controls, in one row above the results — the range IS the query. */}
        <div style={{
          display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end',
          paddingBottom: '1.2rem', borderBottom: '1px solid rgba(var(--overlay-rgb),0.08)',
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.64rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.4)' }}>From</span>
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={field} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.64rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.4)' }}>To</span>
            <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} style={field} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.64rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.4)' }}>Branch</span>
            <select value={branch} onChange={e => setBranch(e.target.value)} style={{ ...field, minWidth: '10rem' }}>
              <option value="">All of mine</option>
              {BRAND.branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.64rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.4)' }}>Report</span>
            <select
              value={report}
              onChange={e => { setReport(e.target.value as Report); setData(null); setLoyalty(null) }}
              style={{ ...field, minWidth: '11rem' }}
            >
              <option value="sales">Sales &amp; VAT</option>
              <option value="loyalty">Points &amp; redemptions</option>
            </select>
          </label>
          <button
            onClick={fetchRange}
            disabled={Boolean(busy)}
            style={{ ...button, border: 'none', backgroundColor: 'var(--teal)', color: '#fff' }}
          >{busy || 'Read the range'}</button>
        </div>

        {data?.cutShort && (
          <p role="alert" style={{
            color: 'var(--red)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: '1.2rem',
            background: 'rgba(var(--red-rgb),0.08)', border: '1px solid rgba(var(--red-rgb),0.25)',
            borderRadius: '4px', padding: '0.8rem 0.9rem',
          }}>{cutShortMessage(data.cutShort)}</p>
        )}

        {error && (
          <p style={{
            color: 'var(--red)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: '1.2rem',
            background: 'rgba(var(--red-rgb),0.08)', border: '1px solid rgba(var(--red-rgb),0.25)',
            borderRadius: '4px', padding: '0.8rem 0.9rem',
          }}>{error}</p>
        )}

        {data && totals && (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '132px' : '150px'}, 1fr))`,
              gap: '1px', background: 'rgba(var(--overlay-rgb),0.1)',
              border: '1px solid rgba(var(--overlay-rgb),0.1)', margin: '1.5rem 0',
            }}>
              {[
                ['Checks', String(totals.checks)],
                ['Net', usd(totals.net)],
                ['VAT included', usd(totals.vat)],
                ['Cash', `${usd(totals.cashUsd)} · ${lbp(totals.cashLbp)}`],
                ['Card', usd(totals.card)],
                ['Refunded', `${usd(totals.refunds)} · ${totals.refundedChecks}`],
              ].map(([label, value]) => (
                <div key={label} style={{ background: 'var(--black)', padding: '0.8rem 0.9rem' }}>
                  <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>{value}</p>
                  <p style={{ fontSize: '0.68rem', color: 'rgba(var(--offwhite-rgb),0.4)', marginTop: '0.15rem' }}>{label}</p>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              <button
                onClick={toExcel}
                disabled={Boolean(busy) || data.checks.length === 0}
                style={{
                  ...button, border: 'none',
                  backgroundColor: data.checks.length === 0 ? 'rgba(var(--teal-rgb),0.25)' : 'var(--teal)',
                  color: '#fff',
                }}
              >Download Excel</button>
              <button
                onClick={() => downloadDaysCsv(data, from, to)}
                disabled={data.days.length === 0}
                style={{
                  ...button, backgroundColor: 'transparent',
                  border: '1px solid rgba(var(--overlay-rgb),0.18)', color: 'rgba(var(--offwhite-rgb),0.75)',
                }}
              >Day summary as CSV</button>
              <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.35)' }}>
                {data.checks.length} checks · {data.payments.length} payments · {data.days.length} day rows
              </span>
            </div>

            {data.days.length === 0 ? (
              <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontSize: '0.9rem', padding: '2rem 0', textAlign: 'center' }}>
                No closed checks in that range.<br />
                If that is a surprise, check the branch filter before the dates.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'rgba(var(--offwhite-rgb),0.4)' }}>
                      {['Day', 'Branch', 'Checks', 'Net', 'VAT', 'Cash $', 'Cash LBP', 'Card', 'Refunded'].map(h => (
                        <th key={h} style={{
                          padding: '0.5rem 0.6rem', fontWeight: 500, fontSize: '0.68rem',
                          letterSpacing: '0.1em', textTransform: 'uppercase',
                          borderBottom: '1px solid rgba(var(--overlay-rgb),0.12)', whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {data.days.map(d => (
                      <tr key={`${d.day}-${d.branch}`}>
                        <td style={cell}>{d.day}</td>
                        <td style={cell}>{d.branch}</td>
                        <td style={cell}>{d.checks}</td>
                        <td style={cell}>{usd(d.net)}</td>
                        <td style={cell}>{usd(d.vat)}</td>
                        <td style={cell}>{usd(d.cashUsd)}</td>
                        <td style={cell}>{d.cashLbp.toLocaleString('en-US')}</td>
                        <td style={cell}>{usd(d.card)}</td>
                        <td style={{ ...cell, color: d.refunds > 0 ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.3)' }}>
                          {d.refunds > 0 ? `${usd(d.refunds)} · ${d.refundedChecks}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {loyalty && pointTotals && (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '132px' : '150px'}, 1fr))`,
              gap: '1px', background: 'rgba(var(--overlay-rgb),0.1)',
              border: '1px solid rgba(var(--overlay-rgb),0.1)', margin: '1.5rem 0',
            }}>
              {[
                ['Points issued', pointTotals.issued.toLocaleString('en-US')],
                ['Reversed', pointTotals.reversed.toLocaleString('en-US')],
                ['Spent', pointTotals.spent.toLocaleString('en-US')],
                ['Net movement', `${pointTotals.net > 0 ? '+' : ''}${pointTotals.net.toLocaleString('en-US')}`],
                ['Transactions', String(pointTotals.transactions)],
                ['Redemptions', String(pointTotals.redemptions)],
              ].map(([label, value]) => (
                <div key={label} style={{ background: 'var(--black)', padding: '0.8rem 0.9rem' }}>
                  <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>{value}</p>
                  <p style={{ fontSize: '0.68rem', color: 'rgba(var(--offwhite-rgb),0.4)', marginTop: '0.15rem' }}>{label}</p>
                </div>
              ))}
            </div>

            <p style={{
              fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.4)',
              lineHeight: 1.6, marginBottom: '1rem', maxWidth: '62ch',
            }}>
              Points are credited to <strong>every</strong> person on a transaction, not divided between
              them — so an event with five attendees at ten points each issued fifty. The per-person
              figure and the headcount are both on the Points sheet.
            </p>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              <button
                onClick={toExcel}
                disabled={Boolean(busy) || loyalty.days.length === 0}
                style={{
                  ...button, border: 'none',
                  backgroundColor: loyalty.days.length === 0 ? 'rgba(var(--teal-rgb),0.25)' : 'var(--teal)',
                  color: '#fff',
                }}
              >Download Excel</button>
              <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.35)' }}>
                {loyalty.points.length} transactions · {loyalty.redemptions.length} redemptions · {loyalty.days.length} day rows
              </span>
            </div>

            {loyalty.days.length === 0 ? (
              <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontSize: '0.9rem', padding: '2rem 0', textAlign: 'center' }}>
                No points moved in that range.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'rgba(var(--offwhite-rgb),0.4)' }}>
                      {['Day', 'Branch', 'Issued', 'Reversed', 'Spent', 'Net', 'Txns', 'Redemptions'].map(h => (
                        <th key={h} style={{
                          padding: '0.5rem 0.6rem', fontWeight: 500, fontSize: '0.68rem',
                          letterSpacing: '0.1em', textTransform: 'uppercase',
                          borderBottom: '1px solid rgba(var(--overlay-rgb),0.12)', whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {loyalty.days.map(d => (
                      <tr key={`${d.day}-${d.branch}`}>
                        <td style={cell}>{d.day}</td>
                        <td style={cell}>{d.branch}</td>
                        <td style={cell}>{d.issued.toLocaleString('en-US')}</td>
                        <td style={{ ...cell, color: d.reversed > 0 ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.3)' }}>
                          {d.reversed > 0 ? d.reversed.toLocaleString('en-US') : '—'}
                        </td>
                        <td style={cell}>{d.spent > 0 ? d.spent.toLocaleString('en-US') : '—'}</td>
                        <td style={{ ...cell, color: d.net < 0 ? 'var(--brand-secondary)' : 'var(--offwhite)' }}>
                          {d.net > 0 ? '+' : ''}{d.net.toLocaleString('en-US')}
                        </td>
                        <td style={cell}>{d.transactions}</td>
                        <td style={cell}>{d.redemptions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

const cell: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)',
  whiteSpace: 'nowrap',
}
