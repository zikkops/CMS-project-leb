import type { Currency, computeTotals } from '@big-cms/shared/deliveries'
import { fmt } from './fmt'

// Totals. Shown live so the receiver can check against the
// paper bill before committing — the whole three-way match
// starts with the number agreeing. The server recomputes all
// of this; nothing here is trusted.
export function TotalsPanel({
  totals, vatRate, currency,
}: {
  totals: ReturnType<typeof computeTotals>
  vatRate: number
  currency: Currency
}) {
  return (
    <div style={{
      background: 'rgba(var(--overlay-rgb),0.02)', border: '1px solid rgba(var(--overlay-rgb),0.07)',
      borderRadius: '6px', padding: '1rem 1.1rem', marginBottom: '1.5rem',
      fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
    }}>
      {[
        ['Subtotal', totals.subtotal],
        // Only shown when some of the invoice is exempt. On an
        // all-taxable delivery it would just repeat the subtotal.
        ...(totals.taxableSubtotal === totals.subtotal
          ? []
          : [['Of which taxable', totals.taxableSubtotal] as [string, number]]),
        [`VAT (${(vatRate * 100).toFixed(2).replace(/.?0+$/, '')}%)`, totals.vat],
      ].map(([label, value]) => (
        <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', color: 'rgba(var(--offwhite-rgb),0.45)' }}>
          <span>{label}</span><span>{fmt(value as number, currency)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid rgba(var(--overlay-rgb),0.07)', color: 'var(--offwhite)', fontWeight: 700 }}>
        <span>Total</span><span>{fmt(totals.grand, currency)} {currency}</span>
      </div>
    </div>
  )
}
