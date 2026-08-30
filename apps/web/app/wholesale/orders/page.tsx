'use client'

// A wholesale account's own order history. The Firestore rule requires the
// accountUid filter that listMyWholesaleOrders() applies, so this can only
// ever return this shop's own orders.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Navbar from '../../components/layout/Navbar'
import Footer from '../../components/layout/Footer'
import {
  useWholesaleAccount, listMyWholesaleOrders, STATUS_COLOR,
  type WholesaleOrder,
} from '@big-cms/shared/wholesale'

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

function fmt(ts: { seconds: number } | null): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function WholesaleOrdersPage() {
  const { account, loading: authLoading } = useWholesaleAccount()
  const isMobile = useIsMobile()
  const [orders, setOrders]   = useState<WholesaleOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId]   = useState<string | null>(null)

  useEffect(() => {
    if (!account) { setLoading(false); return }
    listMyWholesaleOrders(account.uid)
      .then(o => { setOrders(o); setLoading(false) })
      .catch(() => setLoading(false))
  }, [account])

  if (authLoading) return null

  if (!account) {
    return (
      <>
        <Navbar />
        <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', paddingTop: '5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Link href="/wholesale/login" style={{ color: 'var(--teal)', fontFamily: 'var(--font-inter)' }}>Sign in to see your orders →</Link>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', paddingTop: '5rem' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto', padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2rem 6rem' }}>

          <Link href="/wholesale" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', textDecoration: 'none', display: 'block', marginBottom: '0.6rem' }}>
            ← Catalogue
          </Link>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.6rem' : '2rem', color: 'var(--offwhite)', marginBottom: '2rem' }}>
            Your Orders
          </h1>

          {loading ? (
            <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
          ) : orders.length === 0 ? (
            <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4rem', textAlign: 'center', color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem' }}>
              No orders yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {orders.map(o => {
                const open = openId === o.id
                return (
                  <div key={o.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '6px', overflow: 'hidden' }}>
                    <div
                      onClick={() => setOpenId(open ? null : o.id)}
                      style={{ padding: '0.9rem 1.1rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
                    >
                      <div>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--offwhite)' }}>
                          {o.id.slice(0, 8).toUpperCase()}
                          <span style={{ color: 'rgba(245,242,236,0.3)', marginLeft: '0.6rem', fontSize: '0.78rem' }}>{fmt(o.createdAt)}</span>
                        </p>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)' }}>
                          {o.items.length} title{o.items.length !== 1 ? 's' : ''} · {o.itemCount} unit{o.itemCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{
                          fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.1em',
                          textTransform: 'uppercase', fontWeight: 700,
                          color: STATUS_COLOR[o.status] ?? 'rgba(245,242,236,0.4)',
                        }}>{o.status}</span>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', fontWeight: 700, color: '#9B9BD6' }}>
                          ${o.totalUsd.toFixed(2)}
                        </span>
                        {o.invoiceUrl && (
                          <a
                            href={o.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            title={`Invoice ${o.invoiceNumber ?? ''}`}
                            style={{
                              fontFamily: 'var(--font-inter)', fontSize: '0.68rem',
                              letterSpacing: '0.06em', textTransform: 'uppercase',
                              color: 'var(--teal)', textDecoration: 'none',
                              border: '1px solid rgba(0,160,152,0.35)', borderRadius: '3px',
                              padding: '0.3rem 0.7rem', whiteSpace: 'nowrap',
                            }}
                          >Invoice</a>
                        )}
                        <span style={{ color: 'rgba(245,242,236,0.25)' }}>{open ? '▾' : '▸'}</span>
                      </div>
                    </div>

                    {open && (
                      <div style={{ padding: '0 1.1rem 1.1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.75rem' }}>
                          <tbody>
                            {o.items.map(i => (
                              <tr key={i.productId} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '0.45rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--offwhite)' }}>{i.name}</td>
                                <td style={{ padding: '0.45rem 0', textAlign: 'right', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.45)' }}>
                                  {i.quantity} × ${i.unitPrice.toFixed(2)}
                                </td>
                                <td style={{ padding: '0.45rem 0 0.45rem 1rem', textAlign: 'right', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--offwhite)' }}>
                                  ${(i.quantity * i.unitPrice).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {o.invoiceNumber && (
                          <p style={{ marginTop: '0.9rem', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.45)' }}>
                            Invoice{' '}
                            <span style={{ color: 'var(--offwhite)' }}>{o.invoiceNumber}</span>
                            {o.invoiceUrl && (
                              <>
                                {' · '}
                                <a href={o.invoiceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)' }}>
                                  download
                                </a>
                              </>
                            )}
                          </p>
                        )}
                        {o.notes && (
                          <p style={{ marginTop: '0.9rem', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)' }}>
                            Notes: {o.notes}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
