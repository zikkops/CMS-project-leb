'use client'

// Food cost report — Phase 01's last piece.
//
// The plan calls this "the first number that makes the platform useful for
// deciding rather than recording", and until now nothing computed it: the cost
// side did not exist before receiving, and the sales side was sitting in the
// end-of-day report with nothing reading it.
//
// Food cost % = cost of goods received ÷ what the till rang up, over the same
// period, for the same branch.
//
// Two things this page is deliberately careful about:
//
//   Both sides are converted at the rate stored on the DOCUMENT — each
//   delivery's own rateUsed, each report's own exchangeRate — never the rate
//   configured today. A past period that silently re-values when somebody
//   edits settings is worse than no report at all, because it is wrong without
//   looking wrong.
//
//   Both queries are bounded by date, not by row count. A limit would truncate
//   the period quietly and the ratio would come out flattering.

import { useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import {
  listDeliveriesBetween, costOfGoodsUsd, foodCostPercent, isShort,
  DELIVERY_BRANCHES, DELIVERY_DEPARTMENTS, CURRENCY_LABELS,
  type Delivery,
} from '@big-cms/shared/deliveries'
import {
  listEndOfDayReportsBetween, netSalesUsd, formatUsd, todayDateStr,
  type EndOfDayReport,
} from '@big-cms/shared/endOfDay'

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

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.4rem', fontFamily: 'var(--font-inter)',
}

/** 'YYYY-MM-DD' n days before today, in local time. */
function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatPercent(ratio: number): string {
  return (ratio * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}

function formatDeliveredAt(d: Delivery): string {
  if (!d.deliveredAt) return '—'
  const date = d.deliveredAt.toDate()
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function Stat({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '6px',
      padding: '1.1rem 1.25rem',
    }}>
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.5rem',
      }}>{label}</p>
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '1.5rem', fontWeight: 600,
        color: color ?? 'var(--offwhite)', lineHeight: 1.1,
      }}>{value}</p>
      {sub && (
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.7rem',
          color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem',
        }}>{sub}</p>
      )}
    </div>
  )
}

function Note({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const color = tone === 'warn' ? '#C9962C' : 'rgba(245,242,236,0.35)'
  return (
    <p style={{
      fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color,
      marginTop: '0.5rem', lineHeight: 1.5,
    }}>{children}</p>
  )
}

export default function FoodCostReportPage() {
  const isMobile = useIsMobile()
  const { checking, role, branchIds } = useRequireRole(SECTION_ACCESS.deliveriesReport)

  // Only stocked branches receive deliveries or count stock, so a report on
  // any other branch could only ever be empty.
  const branchOptions = useMemo(() => (
    role === 'admin'
      ? [...DELIVERY_BRANCHES]
      : DELIVERY_BRANCHES.filter(b => branchIds.includes(b))
  ), [role, branchIds])

  const [branch, setBranch] = useState<string>('')
  const [from,   setFrom]   = useState(daysAgoStr(7))
  const [to,     setTo]     = useState(todayDateStr())

  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [reports,    setReports]    = useState<EndOfDayReport[]>([])
  const [loading,    setLoading]    = useState(false)
  const [err,        setErr]        = useState('')

  useEffect(() => {
    if (checking) return
    if (branch) return
    // 'all' is admin-only on purpose. A manager scoped to two branches picking
    // it would issue a query across every branch, including ones they are not
    // supposed to see — the listener would be scoped by nothing at all.
    setBranch(role === 'admin' ? 'all' : (branchOptions[0] ?? ''))
  }, [checking, branch, branchOptions, role])

  useEffect(() => {
    if (checking || !branch || !from || !to) return
    if (from > to) return

    let cancelled = false
    setLoading(true)
    setErr('')

    // End of the last day, not its midnight — otherwise everything received on
    // the closing date falls outside the range and the period reads light.
    const fromDate = new Date(`${from}T00:00:00`)
    const toDate   = new Date(`${to}T23:59:59.999`)

    Promise.all([
      listDeliveriesBetween(branch, fromDate, toDate),
      listEndOfDayReportsBetween(branch, from, to),
    ])
      .then(([d, r]) => {
        if (cancelled) return
        setDeliveries(d)
        setReports(r)
      })
      .catch(() => {
        if (cancelled) return
        // A permission-denied read renders as an empty list unless it is
        // caught and said out loud — that exact bug shipped on the POS floor
        // this month.
        setErr('Could not load the report. If this persists, your account may not have access to delivery costs.')
        setDeliveries([])
        setReports([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [checking, branch, from, to])

  const stats = useMemo(() => {
    const cogs  = costOfGoodsUsd(deliveries)
    const sales = reports.reduce((sum, r) => sum + netSalesUsd(r), 0)

    const counted = deliveries.filter(d => d.status !== 'draft')
    const drafts  = deliveries.length - counted.length

    // 0 ÷ real sales is 0, and "0.0%" reads as a measurement when it is
    // actually the absence of one — a period with nothing received has no food
    // cost, it has no data. foodCostPercent() only guards the other side (no
    // sales), so the empty-cost case has to be caught here or the page prints a
    // confident zero over an empty table.
    const missing =
      counted.length === 0 ? 'no deliveries' :
      !sales             ? 'no sales' :
      null
    const fcp = missing ? null : foodCostPercent(cogs, sales)
    const shortLines = counted.reduce(
      (n, d) => n + d.lines.filter(isShort).length, 0,
    )

    const byDept = DELIVERY_DEPARTMENTS
      .map(dept => ({
        dept,
        cogs: costOfGoodsUsd(deliveries.filter(d => d.department === dept)),
      }))
      .filter(row => row.cogs > 0)

    return { cogs, sales, fcp, missing, counted, drafts, shortLines, byDept }
  }, [deliveries, reports])

  if (checking) return null

  const rangeInvalid = from > to

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '2rem 1rem 4rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/supplies/receiving" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
          }}>← Receive a Delivery</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            Food Cost Report
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)' }}>
            What stock cost, against what the till rang up
          </p>
        </div>

        {/* Filters */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr',
          gap: '1rem', marginBottom: '1.5rem',
        }}>
          <div>
            <label style={labelStyle}>Branch</label>
            {branchOptions.length === 1 ? (
              <div style={inp}>{branch}</div>
            ) : (
              <select value={branch} onChange={e => setBranch(e.target.value)} style={selStyle}>
                {role === 'admin' && <option value="all">All branches</option>}
                {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
          <div>
            <label style={labelStyle}>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} />
          </div>
        </div>

        {rangeInvalid && (
          <Note tone="warn">The start date is after the end date.</Note>
        )}

        {err && (
          <p style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--red)',
            padding: '1rem 0',
          }}>{err}</p>
        )}

        {loading && (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', textAlign: 'center', padding: '2rem 0' }}>
            Loading…
          </p>
        )}

        {!loading && !err && !rangeInvalid && (<>

          {/* The three numbers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: '1rem', marginBottom: '1.5rem',
          }}>
            <Stat
              label="Food cost"
              value={stats.fcp === null ? '—' : formatPercent(stats.fcp)}
              sub={
                stats.missing === 'no deliveries' ? 'Nothing received in this range'
                  : stats.missing === 'no sales' ? 'No till sales recorded'
                  : 'Cost of goods ÷ sales'
              }
              color={
                stats.fcp === null ? 'rgba(245,242,236,0.3)'
                  : stats.fcp <= 0.35 ? 'var(--teal)'
                  : stats.fcp <= 0.45 ? '#C9962C'
                  : 'var(--red)'
              }
            />
            <Stat
              label="Cost of goods"
              value={formatUsd(stats.cogs)}
              sub={`${stats.counted.length} ${stats.counted.length === 1 ? 'delivery' : 'deliveries'}`}
              color="var(--purple)"
            />
            <Stat
              label="Till sales"
              value={formatUsd(stats.sales)}
              sub={`${reports.length} end-of-day ${reports.length === 1 ? 'report' : 'reports'}`}
              color="var(--teal)"
            />
          </div>

          {/* What the numbers are not telling you */}
          {stats.missing === 'no sales' && (
            <Note tone="warn">
              No food cost percentage: there are no end-of-day reports in this range,
              or the ones there are recorded no till figures. The cost side above is
              still correct on its own.
            </Note>
          )}
          {stats.missing === 'no deliveries' && (
            <Note tone="warn">
              No food cost percentage: nothing was received in this range, so there is
              no cost to divide. That is not the same as a food cost of zero — the
              sales figure above is real, the cost side simply has no data.
            </Note>
          )}
          {stats.drafts > 0 && (
            <Note tone="warn">
              {stats.drafts} {stats.drafts === 1 ? 'delivery is' : 'deliveries are'} still
              a draft and {stats.drafts === 1 ? 'is' : 'are'} not counted here — a draft
              has not moved stock or been confirmed as arrived.
            </Note>
          )}
          {stats.shortLines > 0 && (
            <Note tone="warn">
              {stats.shortLines} {stats.shortLines === 1 ? 'line' : 'lines'} arrived short
              of what was ordered. Worth checking the invoice was credited.
            </Note>
          )}

          {/* By department */}
          {stats.byDept.length > 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              overflow: 'hidden',
              margin: '1.5rem 0',
            }}>
              <div style={{
                padding: '0.85rem 1.25rem',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}>
                <span style={{
                  fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
                }}>Cost by department</span>
              </div>
              {stats.byDept.map(row => (
                <div key={row.dept} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '0.75rem 1.25rem',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.6)' }}>
                    {row.dept}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--offwhite)' }}>
                    {formatUsd(row.cogs)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* The deliveries behind the number */}
          {deliveries.length === 0 ? (
            <div style={{
              border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
              padding: '2.5rem', textAlign: 'center',
              color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
            }}>
              No deliveries received in this range.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse',
                fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
                minWidth: '620px',
              }}>
                <thead>
                  <tr>
                    {['Date', 'Supplier', 'Dept', 'Invoice', 'Status', 'Invoice total', 'USD'].map(h => (
                      <th key={h} style={{
                        textAlign: h === 'Invoice total' || h === 'USD' ? 'right' : 'left',
                        padding: '0.6rem 0.75rem',
                        fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase',
                        color: 'rgba(245,242,236,0.35)', fontWeight: 400,
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map(d => {
                    const grand = d.totals?.grand ?? 0
                    // Each delivery at its OWN stored rate — the same rule the
                    // total above follows. A draft shows its figure greyed
                    // rather than hidden: it is real, it just is not counted.
                    const usd = d.currency === 'USD'
                      ? grand
                      : (d.rateUsed ? grand / d.rateUsed : null)
                    const dim = d.status === 'draft'
                    const cellColor = dim ? 'rgba(245,242,236,0.3)' : 'rgba(245,242,236,0.75)'
                    const cell: React.CSSProperties = {
                      padding: '0.65rem 0.75rem',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      color: cellColor,
                    }
                    return (
                      <tr key={d.id}>
                        <td style={cell}>{formatDeliveredAt(d)}</td>
                        <td style={cell}>
                          {/* An empty providerName means nobody was named on the
                              invoice — NOT that the delivery was unplanned.
                              "Unplanned" has a specific meaning here (no weekly
                              order behind it, orderReportId null) and putting
                              that word in the supplier column made every
                              no-supplier delivery look unplanned. */}
                          {d.providerName || <span style={{ color: 'rgba(245,242,236,0.25)' }}>No supplier</span>}
                          {d.orderReportId === null && (
                            <span style={{
                              marginLeft: '0.45rem', fontSize: '0.68rem',
                              color: 'rgba(245,242,236,0.3)',
                            }}>unplanned</span>
                          )}
                        </td>
                        <td style={cell}>{d.department}</td>
                        <td style={cell}>{d.invoiceNumber || '—'}</td>
                        <td style={{
                          ...cell,
                          color: d.status === 'received' ? 'var(--teal)'
                            : d.status === 'disputed' ? 'var(--red)'
                            : 'rgba(245,242,236,0.3)',
                        }}>{d.status}</td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {grand.toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
                          <span style={{ color: 'rgba(245,242,236,0.3)', fontSize: '0.72rem' }}>
                            {CURRENCY_LABELS[d.currency]}
                          </span>
                        </td>
                        <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }}>
                          {usd === null
                            ? <span style={{ color: 'var(--red)' }} title="No exchange rate stored on this delivery">—</span>
                            : formatUsd(usd)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.7rem',
            color: 'rgba(245,242,236,0.22)', marginTop: '1.5rem', lineHeight: 1.6,
          }}>
            Every figure is converted at the rate stored on its own document — each
            delivery&rsquo;s rate at receipt, each report&rsquo;s rate at close — so this
            period reads the same next year as it does today.
          </p>

        </>)}

      </div>
    </div>
  )
}
