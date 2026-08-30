'use client'

// Wholesale order queue. Approve / reject, generate the invoice, tell the shop.
//
// Deciding an order goes through PATCH /api/wholesale/orders, which records the
// decision. No email is sent from here: shops are never mailed by this system,
// they read their status and invoice from /wholesale/orders. The only automatic
// mail is the notification to the orders inbox when an order is submitted.
//
// An order submitted before invoices existed has none, so approving still
// generates one here (a <canvas>, hence the browser) and passes the URL along.
//
// "Email Order" remains as a manual mailto: draft — for forwarding an order on
// by hand. It stamps emailedAt when the link is OPENED, which is not proof of
// delivery.

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db, auth } from '@big-cms/shared/firebase'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { generateWholesaleInvoice } from '@big-cms/shared/wholesaleInvoice'
import {
  STATUS_COLOR, WHOLESALE_ORDERS_EMAIL, WHOLESALE_ORDER_STATUSES,
  type WholesaleOrder, type WholesaleOrderStatus,
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
  return new Date(ts.seconds * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function orderAsText(o: WholesaleOrder): string {
  const lines = [
    `Wholesale order ${o.id.slice(0, 8).toUpperCase()}`,
    `Shop:    ${o.shopName}`,
    `Contact: ${o.accountEmail}`,
    `Placed:  ${fmt(o.createdAt)}`,
    '',
    ...o.items.map(i => `${String(i.quantity).padStart(3)} x ${i.name} @ $${i.unitPrice.toFixed(2)} = $${(i.quantity * i.unitPrice).toFixed(2)}`),
    '',
    `${o.itemCount} units across ${o.items.length} titles`,
    `TOTAL: $${o.totalUsd.toFixed(2)}`,
  ]
  if (o.notes) lines.push('', `Notes: ${o.notes}`)
  return lines.join('\n')
}

export default function WholesaleOrdersAdminPage() {
  const { checking, user } = useRequireRole(SECTION_ACCESS.products)
  const isMobile = useIsMobile()

  const [orders, setOrders]   = useState<WholesaleOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<WholesaleOrderStatus | 'all'>('pending')
  const [openId, setOpenId]   = useState<string | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [busyLabel, setBusyLabel] = useState('')
  const [notice, setNotice]   = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)

  async function load() {
    const snap = await getDocs(query(collection(db, 'wholesaleOrders'), orderBy('createdAt', 'desc')))
    setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WholesaleOrder))
    setLoading(false)
  }

  useEffect(() => { if (!checking) load() }, [checking])

  // Approving generates the invoice first (a <canvas>, so it has to happen
  // here in the browser), then hands the URL to the route, which records the
  // decision and emails the shop. Order matters: if the invoice fails we stop
  // before telling the shop anything, rather than emailing them an approval
  // with no invoice attached.
  async function setStatus(o: WholesaleOrder, status: WholesaleOrderStatus) {
    setBusyId(o.id)
    setNotice(null)
    try {
      let invoice: { invoiceNumber: string; invoiceUrl: string } | null = null
      if (status === 'approved' || status === 'fulfilled') {
        setBusyLabel('Generating invoice…')
        invoice = await generateWholesaleInvoice(o, user?.email ?? '')
      }

      setBusyLabel('Notifying the shop…')
      const idToken = await auth.currentUser?.getIdToken()
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ orderId: o.id, status, ...(invoice ?? {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not update the order.')

      setOrders(prev => prev.map(x => x.id === o.id
        ? { ...x, status, ...(invoice ?? {}) }
        : x))

      // No email goes out here by design — the shop reads its status and
      // invoice from /wholesale/orders. The only mail this system sends is the
      // notification to the orders inbox when an order is submitted.
      setNotice({
        kind: 'ok',
        text: `Marked ${status}${invoice ? ` — invoice ${invoice.invoiceNumber}` : ''}.`,
      })
    } catch (err) {
      setNotice({ kind: 'warn', text: err instanceof Error ? err.message : 'Something went wrong.' })
    } finally {
      setBusyId(null)
      setBusyLabel('')
    }
  }

  async function emailOrder(o: WholesaleOrder) {
    const subject = `Wholesale order ${o.id.slice(0, 8).toUpperCase()} — ${o.shopName}`
    window.location.href =
      `mailto:${encodeURIComponent(WHOLESALE_ORDERS_EMAIL)}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(orderAsText(o))}`

    // Stamped when the link is opened, not when anything is delivered — the
    // browser can't tell us whether the message was actually sent. The stamp
    // itself goes through the route; only the mailto is the browser's job.
    try {
      await unwrap(await authedFetch('/api/wholesale/orders', 'PATCH',
        { orderId: o.id, markEmailed: true }))
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, emailedAt: { seconds: Date.now() / 1000 } as WholesaleOrder['emailedAt'] } : x))
    } catch { /* the mail client still opened; the stamp is a convenience */ }
  }

  async function copyOrder(o: WholesaleOrder) {
    try { await navigator.clipboard.writeText(orderAsText(o)) } catch { /* clipboard blocked */ }
  }

  const visible = useMemo(
    () => filter === 'all' ? orders : orders.filter(o => o.status === filter),
    [orders, filter],
  )
  const pendingCount = orders.filter(o => o.status === 'pending').length

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#F5F2EC', fontFamily: 'var(--font-inter)' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>

        <a href="/admin" style={{ fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', textDecoration: 'none', display: 'block', marginBottom: '0.5rem' }}>
          ← Dashboard
        </a>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.75rem' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', marginBottom: '0.25rem' }}>Wholesale Orders</h1>
            <p style={{ fontSize: '0.82rem', color: 'rgba(245,242,236,0.35)' }}>
              {pendingCount > 0
                ? <span style={{ color: '#C9962C' }}>{pendingCount} awaiting a decision</span>
                : 'Nothing pending.'}
            </p>
          </div>
          <a href="/admin/wholesale/accounts" style={{
            background: 'transparent', color: '#9B9BD6', border: '1px solid rgba(106,106,183,0.4)',
            borderRadius: '4px', padding: '0.65rem 1.2rem', fontSize: '0.78rem',
            letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none',
          }}>Accounts</a>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
          {(['pending', ...WHOLESALE_ORDER_STATUSES.filter(s => s !== 'pending'), 'all'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s as WholesaleOrderStatus | 'all')} style={{
              background: filter === s ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: `1px solid ${filter === s ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.09)'}`,
              color: filter === s ? '#F5F2EC' : 'rgba(245,242,236,0.35)',
              borderRadius: '20px', padding: '0.4rem 1rem', fontSize: '0.72rem',
              letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
            }}>{s}</button>
          ))}
        </div>

        {notice && (
          <p style={{
            marginBottom: '1.25rem', padding: '0.8rem 1.1rem', borderRadius: '4px',
            fontSize: '0.82rem',
            background: notice.kind === 'ok' ? 'rgba(0,160,152,0.08)' : 'rgba(201,150,44,0.08)',
            border: `1px solid ${notice.kind === 'ok' ? 'rgba(0,160,152,0.3)' : 'rgba(201,150,44,0.3)'}`,
            color: notice.kind === 'ok' ? 'var(--teal)' : '#C9962C',
          }}>{notice.text}</p>
        )}

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4rem', textAlign: 'center', color: 'rgba(245,242,236,0.2)', fontSize: '0.88rem' }}>
            No {filter === 'all' ? '' : filter} orders.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {visible.map(o => {
              const open = openId === o.id
              return (
                <div key={o.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '6px', overflow: 'hidden' }}>
                  <div onClick={() => setOpenId(open ? null : o.id)} style={{
                    padding: '0.9rem 1.1rem', cursor: 'pointer', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                  }}>
                    <div>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.98rem' }}>
                        {o.shopName}
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', marginLeft: '0.6rem' }}>
                          {o.id.slice(0, 8).toUpperCase()}
                        </span>
                      </p>
                      <p style={{ fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)', marginTop: '0.15rem' }}>
                        {fmt(o.createdAt)} · {o.items.length} title{o.items.length !== 1 ? 's' : ''} · {o.itemCount} unit{o.itemCount !== 1 ? 's' : ''}
                        {o.emailedAt && <span style={{ color: 'rgba(0,160,152,0.7)' }}> · emailed</span>}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span style={{ fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, color: STATUS_COLOR[o.status] }}>
                        {o.status}
                      </span>
                      <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#9B9BD6' }}>${o.totalUsd.toFixed(2)}</span>
                      <span style={{ color: 'rgba(245,242,236,0.25)' }}>{open ? '▾' : '▸'}</span>
                    </div>
                  </div>

                  {open && (
                    <div style={{ padding: '0 1.1rem 1.1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <p style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.35)', margin: '0.75rem 0' }}>
                        {o.accountEmail}
                        {o.decidedByEmail && ` · decided by ${o.decidedByEmail} ${fmt(o.decidedAt)}`}
                      </p>

                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '380px' }}>
                          <tbody>
                            {o.items.map(i => (
                              <tr key={i.productId} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '0.45rem 0', fontSize: '0.82rem' }}>{i.name}</td>
                                <td style={{ padding: '0.45rem 0', textAlign: 'right', fontSize: '0.78rem', color: 'rgba(245,242,236,0.45)' }}>
                                  {i.quantity} × ${i.unitPrice.toFixed(2)}
                                </td>
                                <td style={{ padding: '0.45rem 0 0.45rem 1rem', textAlign: 'right', fontSize: '0.82rem', fontWeight: 600 }}>
                                  ${(i.quantity * i.unitPrice).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {o.notes && (
                        <p style={{ marginTop: '0.9rem', fontSize: '0.78rem', color: 'rgba(245,242,236,0.45)' }}>Notes: {o.notes}</p>
                      )}

                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1.1rem' }}>
                        {o.status === 'pending' && (
                          <>
                            <button onClick={() => setStatus(o, 'approved')} disabled={busyId === o.id} style={{
                              background: '#00A098', color: '#000', border: 'none', borderRadius: '4px',
                              padding: '0.6rem 1.4rem', fontSize: '0.75rem', fontWeight: 700,
                              letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                            }}>{busyId === o.id ? (busyLabel || 'Working…') : 'Approve'}</button>
                            <button onClick={() => setStatus(o, 'rejected')} disabled={busyId === o.id} style={{
                              background: 'rgba(228,51,41,0.08)', color: '#E43329',
                              border: '1px solid rgba(228,51,41,0.3)', borderRadius: '4px',
                              padding: '0.6rem 1.2rem', fontSize: '0.75rem',
                              letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                            }}>Reject</button>
                          </>
                        )}
                        {o.status === 'approved' && (
                          <button onClick={() => setStatus(o, 'fulfilled')} disabled={busyId === o.id} style={{
                            background: 'rgba(139,124,246,0.12)', color: '#8B7CF6',
                            border: '1px solid rgba(139,124,246,0.35)', borderRadius: '4px',
                            padding: '0.6rem 1.2rem', fontSize: '0.75rem',
                            letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                          }}>Mark Fulfilled</button>
                        )}
                        {o.invoiceUrl && (
                          <a href={o.invoiceUrl} target="_blank" rel="noopener noreferrer" style={{
                            background: 'rgba(0,160,152,0.1)', color: 'var(--teal)',
                            border: '1px solid rgba(0,160,152,0.35)', borderRadius: '4px',
                            padding: '0.6rem 1.2rem', fontSize: '0.75rem', textDecoration: 'none',
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                          }}>Invoice {o.invoiceNumber}</a>
                        )}
                        <button onClick={() => emailOrder(o)} style={{
                          background: 'rgba(201,150,44,0.12)', color: '#C9962C',
                          border: '1px solid rgba(201,150,44,0.35)', borderRadius: '4px',
                          padding: '0.6rem 1.2rem', fontSize: '0.75rem',
                          letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                        }}>Email Order</button>
                        <button onClick={() => copyOrder(o)} style={{
                          background: 'transparent', color: 'rgba(245,242,236,0.5)',
                          border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px',
                          padding: '0.6rem 1.2rem', fontSize: '0.75rem',
                          letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                        }}>Copy</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p style={{ marginTop: '2rem', fontSize: '0.72rem', color: 'rgba(245,242,236,0.25)', lineHeight: 1.8 }}>
          &ldquo;Email Order&rdquo; opens a prefilled message to {WHOLESALE_ORDERS_EMAIL} in your mail
          client — nothing is sent from a server, so there&apos;s no delivery guarantee. Approving does
          not deduct stock; confirm availability before you commit to a shop.
        </p>
      </div>
    </div>
  )
}
