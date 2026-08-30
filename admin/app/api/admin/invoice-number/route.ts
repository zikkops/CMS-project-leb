// Issues an invoice number to staff.
//
// The wholesale route already had one of these, but gated to wholesale
// ACCOUNTS — so a staff member regenerating a wholesale invoice from
// /admin/wholesale/orders could not use it and fell through to the browser
// counter, which the rules deny. The invoice failed with a permission error
// on any order that did not already carry a number.
//
// GET rather than POST because that is what the wholesale twin does and the
// browser calls them the same way. Worth knowing that this is NOT a safe GET:
// every call burns a sequence number. Nothing should retry it blindly, and
// nothing should prefetch it.

import { requireStaff, toResponse } from '@big-cms/shared/server/auth'
import { issueInvoiceNumber } from '@big-cms/shared/server/invoiceNumber'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff(request)
    const { invoiceNumber } = await issueInvoiceNumber()
    return Response.json({ ok: true, invoiceNumber })
  } catch (err) {
    return toResponse(err)
  }
}
