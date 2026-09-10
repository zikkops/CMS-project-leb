// What a receipt is printed with, in one place.
//
// Two things print a receipt now: the receipt page, when somebody taps
// Receipt on a closed check, and the KDS, when a check closes and the café has
// receipt-on-close switched on. If each built its own options they would drift
// — a footer changed in one, an address in the other — and the reprint a
// customer asks for would no longer match the receipt they were handed.

import { BRAND } from '@big-cms/shared/brand'
import type { ReceiptOptions } from '@big-cms/shared/receipt'

/**
 * @param exchangeRate the LIVE business setting, not the build-time default.
 *   When Phase 04 records a payment, the rate it settled at belongs on the
 *   check, and this becomes a read from the check instead.
 */
export function receiptOptionsFor(exchangeRate: number): ReceiptOptions {
  return {
    businessName: BRAND.name,
    address: BRAND.contact.address,
    phone: BRAND.contact.phone,
    currency: BRAND.locale.currency,
    secondaryCurrency: BRAND.locale.secondaryCurrency,
    exchangeRate,
    footer: 'Thank you',
  }
}
