'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import {
  type GamePurchaseOrder,
  listPurchaseOrders,
  refundOrder,
  regenerateOrderInvoice,
} from '../../../lib/gamePurchases'

function useIsMobile(bp = 768) {
  const [v, setV] = useState(false)
  useEffect(() => {
    const fn = () => setV(window.innerWidth < bp)
    fn(); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn)
  }, [bp])
  return v
}

function fmtDate(ts: { seconds: number } | null): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtDateTime(ts: { seconds: number } | null): string {
  if (!ts) return '—'
  const d = new Date(ts.seconds * 1000)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function InvoicesPage() {
  const { checking, user } = useRequireRole(SECTION_ACCESS.gamePurchases)
  const isMobile = useIsMobile()

  const [orders, setOrders] = useState<GamePurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'completed' | 'refunded'>('all')

  // Refund state
  const [refunding, setRefunding] = useState<string | null>(null)
  const [refundNote, setRefundNote] = useState('')
  const [refundWorking, setRefundWorking] = useState(false)
  const [refundError, setRefundError] = useState('')

  // Regenerate invoice state
  const [regenerating, setRegenerating] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const data = await listPurchaseOrders()
    setOrders(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const visible = useMemo(() =>
    filter === 'all' ? orders : orders.filter(o => o.status === filter),
    [orders, filter],
  )

  async function handleRefund(orderId: string) {
    if (!user) return
    setRefundWorking(true)
    setRefundError('')
    try {
      await refundOrder(orderId, refundNote, user.email ?? '')
      setRefunding(null)
      setRefundNote('')
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setRefundError(msg === 'already-refunded' ? 'This order has already been refunded.' : 'Refund failed — please try again.')
    } finally {
      setRefundWorking(false)
    }
  }

  async function handleRegenerate(order: GamePurchaseOrder) {
    setRegenerating(order.id)
    try {
      await regenerateOrderInvoice(order)
      await load()
    } catch {
      alert('Invoice regeneration failed. Please try again.')
    } finally {
      setRegenerating(null)
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)',
    color: '#F5F2EC', padding: '0.65rem 0.8rem', borderRadius: '2px',
    fontSize: '0.85rem', outline: 'none', fontFamily: 'var(--font-inter)',
    resize: 'vertical' as const,
  }

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin" style={{
            fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            fontFamily: 'var(--font-inter)', marginBottom: '0.5rem', display: 'block',
          }}>← Back to Dashboard</a>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Game Sales &amp; Invoices
            </h1>
            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
              <a href="/admin/games/purchase" style={{
                backgroundColor: 'var(--teal)', color: '#fff', textDecoration: 'none',
                padding: '0.65rem 1.4rem', borderRadius: '2px', fontSize: '0.75rem',
                letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
              }}>+ Record a Sale</a>
              <button onClick={load} style={{
                backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(245,242,236,0.5)', padding: '0.65rem 1.2rem', borderRadius: '2px',
                fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                cursor: 'pointer', fontFamily: 'var(--font-inter)',
              }}>Refresh</button>
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {(['all', 'completed', 'refunded'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              backgroundColor: filter === f ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: `1px solid ${filter === f ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
              color: filter === f ? 'var(--offwhite)' : 'rgba(245,242,236,0.4)',
              padding: '0.45rem 1rem', borderRadius: '2px', fontSize: '0.72rem',
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>
              {f === 'all' ? `All (${orders.length})` : f === 'completed'
                ? `Completed (${orders.filter(o => o.status === 'completed').length})`
                : `Refunded (${orders.filter(o => o.status === 'refunded').length})`}
            </button>
          ))}
        </div>

        {/* Orders */}
        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            {filter === 'all' ? 'No sales recorded yet.' : `No ${filter} orders.`}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {visible.map(order => {
              const isRefundOpen = refunding === order.id
              return (
                <div key={order.id} style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '4px', overflow: 'hidden',
                }}>
                  {/* Card body */}
                  <div style={{ padding: isMobile ? '1rem' : '1.25rem 1.5rem' }}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap',
                      marginBottom: '0.8rem',
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                          <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'var(--offwhite)' }}>
                            {order.invoiceNumber}
                          </span>
                          <span style={{
                            fontSize: '0.65rem', padding: '0.2rem 0.6rem', borderRadius: '2px',
                            backgroundColor: order.status === 'refunded' ? 'rgba(228,51,41,0.15)' : 'rgba(0,160,152,0.15)',
                            color: order.status === 'refunded' ? 'var(--red)' : 'var(--teal)',
                            fontFamily: 'var(--font-inter)', letterSpacing: '0.1em', textTransform: 'uppercase',
                          }}>
                            {order.status}
                          </span>
                        </div>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)' }}>
                          {fmtDateTime(order.createdAt as any)} · {order.branch}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color: 'var(--teal)' }}>
                          ${order.total.toFixed(2)}
                        </p>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)' }}>
                          by {order.processedByEmail}
                        </p>
                      </div>
                    </div>

                    {/* Customer */}
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
                      {order.customerName}
                    </p>

                    {/* Items */}
                    <div style={{ marginBottom: '0.75rem' }}>
                      {order.items.map((item, i) => (
                        <p key={i} style={{
                          fontFamily: 'var(--font-inter)', fontSize: '0.75rem',
                          color: 'rgba(245,242,236,0.45)',
                        }}>
                          {item.gameName} × {item.quantity} @ ${item.unitPrice.toFixed(2)}
                          {item.priceType === 'wholesale' && (
                            <span style={{ color: 'rgba(245,242,236,0.3)', marginLeft: '0.3rem' }}>(wholesale)</span>
                          )}
                        </p>
                      ))}
                    </div>

                    {/* Refund note */}
                    {order.status === 'refunded' && (
                      <div style={{
                        padding: '0.5rem 0.8rem', borderRadius: '2px',
                        backgroundColor: 'rgba(228,51,41,0.08)', marginBottom: '0.75rem',
                      }}>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(228,51,41,0.8)' }}>
                          Refunded {fmtDate(order.refundedAt as any)} by {order.refundedBy}
                          {order.refundNote && ` — "${order.refundNote}"`}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                      {order.invoiceUrl ? (
                        <a
                          href={order.invoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            backgroundColor: 'transparent', border: '1px solid rgba(0,160,152,0.4)',
                            color: 'var(--teal)', textDecoration: 'none',
                            padding: '0.45rem 1rem', borderRadius: '2px', fontSize: '0.7rem',
                            letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                          }}
                        >View Invoice ↗</a>
                      ) : (
                        <button
                          onClick={() => handleRegenerate(order)}
                          disabled={regenerating === order.id}
                          style={{
                            backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                            color: 'rgba(245,242,236,0.5)', padding: '0.45rem 1rem', borderRadius: '2px',
                            fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                            cursor: regenerating === order.id ? 'not-allowed' : 'pointer',
                            fontFamily: 'var(--font-inter)',
                          }}
                        >
                          {regenerating === order.id ? 'Generating…' : 'Generate Invoice'}
                        </button>
                      )}

                      {order.status === 'completed' && (
                        <button
                          onClick={() => {
                            if (isRefundOpen) { setRefunding(null); setRefundNote('') }
                            else { setRefunding(order.id); setRefundError('') }
                          }}
                          style={{
                            backgroundColor: isRefundOpen ? 'rgba(228,51,41,0.15)' : 'transparent',
                            border: '1px solid rgba(228,51,41,0.4)',
                            color: 'var(--red)', padding: '0.45rem 1rem', borderRadius: '2px',
                            fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                            cursor: 'pointer', fontFamily: 'var(--font-inter)',
                          }}
                        >
                          {isRefundOpen ? 'Cancel' : 'Refund'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Refund panel */}
                  {isRefundOpen && (
                    <div style={{
                      borderTop: '1px solid rgba(228,51,41,0.2)',
                      padding: isMobile ? '1rem' : '1.25rem 1.5rem',
                      backgroundColor: 'rgba(228,51,41,0.04)',
                    }}>
                      <p style={{
                        fontFamily: 'var(--font-inter)', fontSize: '0.72rem',
                        color: 'rgba(228,51,41,0.8)', marginBottom: '0.75rem',
                      }}>
                        This will reverse the sale and restore stock for all {order.items.length} item(s) to {order.branch}.
                      </p>
                      <textarea
                        rows={2}
                        placeholder="Reason for refund (optional)"
                        value={refundNote}
                        onChange={e => setRefundNote(e.target.value)}
                        style={{
                          ...inp,
                          marginBottom: '0.75rem',
                          border: '1px solid rgba(228,51,41,0.3)',
                        }}
                      />
                      {refundError && (
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'var(--red)', marginBottom: '0.6rem' }}>
                          {refundError}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button
                          onClick={() => handleRefund(order.id)}
                          disabled={refundWorking}
                          style={{
                            backgroundColor: 'var(--red)', color: '#fff', border: 'none',
                            padding: '0.6rem 1.4rem', borderRadius: '2px', fontSize: '0.75rem',
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                            cursor: refundWorking ? 'not-allowed' : 'pointer',
                            fontFamily: 'var(--font-inter)', opacity: refundWorking ? 0.6 : 1,
                          }}
                        >
                          {refundWorking ? 'Processing…' : 'Confirm Refund'}
                        </button>
                        <button
                          onClick={() => { setRefunding(null); setRefundNote('') }}
                          style={{
                            backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                            color: 'rgba(245,242,236,0.5)', padding: '0.6rem 1.2rem', borderRadius: '2px',
                            fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                            cursor: 'pointer', fontFamily: 'var(--font-inter)',
                          }}
                        >Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
