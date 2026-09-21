'use client'

import type { Currency } from '@big-cms/shared/deliveries'
import type { OrderProvider } from '@big-cms/shared/weeklyOrders'
import { inp, labelStyle } from './styles'

// Supplier, invoice number, currency, and the exchange rate for an LBP invoice.
export function InvoiceFields({
  isMobile, providers, providerId, onProvider, onOrderByProvider, hiddenCount,
  invoiceNumber, onInvoiceNumber, invoiceDate, onInvoiceDate, currency, onCurrency, rateUsed, onRateUsed,
}: {
  isMobile: boolean
  providers: OrderProvider[]
  providerId: string
  onProvider: (id: string) => void
  onOrderByProvider: Map<string, number>
  hiddenCount: number
  invoiceNumber: string
  onInvoiceNumber: (value: string) => void
  invoiceDate: string
  onInvoiceDate: (value: string) => void
  currency: Currency
  onCurrency: (next: Currency) => void
  rateUsed: string
  onRateUsed: (value: string) => void
}) {
  return (
    <>
      {/* Invoice + currency */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <label style={labelStyle}>Supplier</label>
          <select value={providerId} onChange={e => onProvider(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
            <option value="">— All suppliers —</option>
            {providers.map(p => {
              // How many of the loaded order's lines are this supplier's.
              // Shown in the option itself so it is obvious before
              // selecting which suppliers are actually on this order.
              const n = onOrderByProvider.get(p.id) ?? 0
              return <option key={p.id} value={p.id}>{p.name}{n > 0 ? ` (${n})` : ''}</option>
            })}
          </select>
          {hiddenCount > 0 && (
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.62rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.3rem' }}>
              Showing only this supplier&apos;s lines. Receive the rest when their van arrives.
            </p>
          )}
        </div>
        <div>
          <label style={labelStyle}>Invoice number</label>
          <input value={invoiceNumber} onChange={e => onInvoiceNumber(e.target.value)} placeholder="F-20481" style={{ ...inp, width: '100%' }} />
          <label style={{ ...labelStyle, marginTop: '0.6rem' }}>Invoice date</label>
          <input type="date" value={invoiceDate} onChange={e => onInvoiceDate(e.target.value)} style={{ ...inp, width: '100%' }} />
        </div>
        <div>
          <label style={labelStyle}>Currency</label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {(['USD', 'LBP'] as Currency[]).map(c => (
              <button key={c} onClick={() => onCurrency(c)} style={{
                flex: 1,
                background: currency === c ? 'rgba(var(--teal-rgb),0.15)' : 'transparent',
                border: `1px solid ${currency === c ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.09)'}`,
                color: currency === c ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.35)',
                borderRadius: '4px', padding: '0.5rem', fontSize: '0.78rem',
                fontWeight: currency === c ? 600 : 400, cursor: 'pointer',
                fontFamily: 'var(--font-inter)',
              }}>{c}</button>
            ))}
          </div>
        </div>
      </div>

      {/* The rate is stored ON the delivery, not read from a global at
          display time, so this invoice still reprints at the same totals
          next year. The server refuses an LBP delivery without one. */}
      {currency === 'LBP' && (
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>Exchange rate used (LBP per $1)</label>
          <input
            type="number" min="1" inputMode="numeric"
            value={rateUsed} onChange={e => onRateUsed(e.target.value)}
            style={{ ...inp, width: isMobile ? '100%' : '220px' }}
          />
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.28)', marginTop: '0.35rem' }}>
            Saved with this delivery so its totals never change if the rate moves.
          </p>
        </div>
      )}
    </>
  )
}
