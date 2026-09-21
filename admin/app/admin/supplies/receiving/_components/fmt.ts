import type { Currency } from '@big-cms/shared/deliveries'

export function fmt(n: number, currency: Currency): string {
  // LBP has no meaningful minor unit at current magnitudes — showing
  // "9,000,000.00" is noise on a phone screen at a back door.
  return currency === 'LBP'
    ? Math.round(n).toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
