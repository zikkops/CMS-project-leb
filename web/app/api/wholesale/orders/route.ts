// Wholesale order submission.
//
// The write lives here rather than in the browser for two reasons: the standing
// rule from Phase 00 on is that new privileged mutations go behind a route
// handler, and the notification email can only be sent somewhere the API key
// exists — which is never the client.
//
// Prices are re-read from Firestore rather than trusted from the request, so a
// shop can't submit an order priced at $0.01 by editing what the browser sends.

import { adminAuth, adminDb } from '@big-cms/shared/server/firebaseAdmin'
import { toResponse, HttpError, bearerToken, requireSection } from '@big-cms/shared/server/auth'
import { sendEmail, emailConfigured } from '@big-cms/shared/server/email'
import { FieldValue } from 'firebase-admin/firestore'
import { INVOICE_NUMBER_PATTERN, INVOICE_IMAGE_URL_PATTERN } from '@big-cms/shared/invoiceFormat'
import { issueInvoiceNumber } from '@big-cms/shared/server/invoiceNumber'
import { BRAND } from '@big-cms/shared/brand'
import { parseRequestId, alreadyExists } from '@big-cms/shared/server/idempotency'

export const runtime = 'nodejs'

// Same fallback as shared/src/wholesale.ts, and for the same reason — see the
// note there. A personal address as the default recipient is a defect in
// anything sold to a second operator.
const ORDERS_EMAIL =
  process.env.NEXT_PUBLIC_WHOLESALE_ORDERS_EMAIL || BRAND.contact.email

interface LineInput { productId: string; quantity: number }

interface Account {
  uid: string
  email: string
  shopName: string
  contactName: string
  phone: string
}

// Wholesale accounts are not staff, so getCaller()/requireStaff() don't apply.
// The claim is checked first (free); the document is only read to fetch the
// shop's details, which we need for the order anyway.
async function requireWholesale(request: Request): Promise<Account> {
  const token = bearerToken(request)
  if (!token) throw new HttpError(401, 'Not signed in.')

  let decoded
  try {
    decoded = await adminAuth().verifyIdToken(token, true)
  } catch {
    throw new HttpError(401, 'Session expired — please sign in again.')
  }
  if (decoded.wholesale !== true) throw new HttpError(403, 'Not a wholesale account.')

  const snap = await adminDb().doc(`users/${decoded.uid}`).get()
  const data = snap.data()
  if (!snap.exists || data?.isWholesale !== true) throw new HttpError(403, 'Not a wholesale account.')
  // Belt and braces: the claim is dropped on deactivation, but a token issued
  // moments before that still carries it for up to an hour.
  if (data?.wholesaleActive === false) throw new HttpError(403, 'This wholesale account is inactive.')

  return {
    uid: decoded.uid,
    email: (data.email as string) ?? decoded.email ?? '',
    shopName: (data.shopName as string) ?? '',
    contactName: (data.contactName as string) ?? '',
    phone: (data.phone as string) ?? '',
  }
}

function parseLines(body: Record<string, unknown>): LineInput[] {
  const raw = body.items
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'The order is empty.')
  if (raw.length > 200) throw new HttpError(400, 'Too many lines in one order.')

  const lines: LineInput[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const productId = (r as { productId?: unknown }).productId
    const quantity = Number((r as { quantity?: unknown }).quantity)
    if (typeof productId !== 'string' || !productId) continue
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    lines.push({ productId, quantity: Math.floor(quantity) })
  }
  if (lines.length === 0) throw new HttpError(400, 'The order is empty.')
  return lines
}

function orderText(o: {
  id: string; shopName: string; email: string; contactName: string; phone: string
  items: Array<{ name: string; unitPrice: number; quantity: number }>
  totalUsd: number; itemCount: number; notes: string
  invoiceNumber?: string; invoiceUrl?: string
}): string {
  const lines = [
    `New wholesale order — ${o.shopName}`,
    `Reference: ${o.id.slice(0, 8).toUpperCase()}`,
    ...(o.invoiceNumber ? [`Invoice:   ${o.invoiceNumber}`] : []),
    '',
    'WHO ORDERED',
    `Name:    ${o.contactName || '—'}`,
    `Shop:    ${o.shopName}`,
    `Email:   ${o.email}`,
    `Phone:   ${o.phone || '—'}`,
    '',
    'ITEMS',
    ...o.items.map(i =>
      `${String(i.quantity).padStart(3)} x ${i.name} @ $${i.unitPrice.toFixed(2)} = $${(i.quantity * i.unitPrice).toFixed(2)}`),
    '',
    `${o.itemCount} units across ${o.items.length} titles`,
    `TOTAL: $${o.totalUsd.toFixed(2)}`,
  ]
  if (o.notes) lines.push('', `Notes: ${o.notes}`)
  if (o.invoiceUrl) lines.push('', `Invoice: ${o.invoiceUrl}`)
  lines.push('', 'Approve or reject: /admin/wholesale/orders')
  return lines.join('\n')
}

// Issues the next invoice number for a wholesale account.
//
// This exists because the counter document is admin-only in the Firestore
// rules, so a shop's browser cannot run the transaction itself — it got a 403
// and the invoice silently never appeared. The Admin SDK bypasses rules, so the
// number is minted here and the browser only draws with it.
export async function GET(request: Request): Promise<Response> {
  try {
    await requireWholesale(request)

    const { invoiceNumber } = await issueInvoiceNumber()
    return Response.json({ invoiceNumber })
  } catch (err) {
    return toResponse(err)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const account = await requireWholesale(request)

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Request body must be JSON.')
    }

    const lines = parseLines(body)
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : ''

    // The invoice is drawn in the browser (canvas) and uploaded before this
    // call, so it arrives as a number plus a URL. Both are validated rather
    // than trusted: the number must match the OB- format, and the URL must be
    // an imgbb link, so neither can be used to smuggle arbitrary text or a
    // link to somewhere else into an email that goes out under our name.
    const rawNumber = typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim() : ''
    const rawUrl = typeof body.invoiceUrl === 'string' ? body.invoiceUrl.trim() : ''
    const invoiceNumber = INVOICE_NUMBER_PATTERN.test(rawNumber) ? rawNumber : ''
    const invoiceUrl = INVOICE_IMAGE_URL_PATTERN.test(rawUrl) ? rawUrl : ''

    // Re-price server-side. Whatever the browser claimed the price was is
    // ignored entirely.
    const db = adminDb()
    const refs = lines.map(l => db.doc(`products/${l.productId}`))
    const snaps = await db.getAll(...refs)

    const items = []
    for (let i = 0; i < lines.length; i++) {
      const snap = snaps[i]
      if (!snap.exists) throw new HttpError(400, 'One of those products no longer exists.')
      const data = snap.data() ?? {}
      const unitPrice = Number(data.wholesalePrice)
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new HttpError(400, `"${data.name ?? 'A product'}" is not available at wholesale.`)
      }
      items.push({
        productId: lines[i].productId,
        name: (data.name as string) ?? '',
        unitPrice,
        quantity: lines[i].quantity,
      })
    }

    const totalUsd = Math.round(items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) * 100) / 100
    const itemCount = items.reduce((s, i) => s + i.quantity, 0)

    // The browser's request id becomes the order's id, so a Place Order resent
    // after a lost reply lands on the order it already made instead of making
    // a second — and mailing the orders inbox a second time.
    const requestId = parseRequestId(body)
    const orders = db.collection('wholesaleOrders')
    const ref = requestId ? orders.doc(requestId) : orders.doc()
    const order = {
      accountUid:     account.uid,
      accountEmail:   account.email,
      shopName:       account.shopName,
      contactName:    account.contactName,
      phone:          account.phone,
      items, totalUsd, itemCount, notes,
      ...(invoiceNumber ? { invoiceNumber } : {}),
      ...(invoiceUrl ? { invoiceUrl, invoicedAt: FieldValue.serverTimestamp() } : {}),
      status:         'pending',
      createdAt:      FieldValue.serverTimestamp(),
      decidedBy:      '',
      decidedByEmail: '',
      decidedAt:      null,
      emailedAt:      null,
    }

    try {
      await ref.create(order)
    } catch (err) {
      if (!requestId || !alreadyExists(err)) throw err
      const prev = (await ref.get()).data() ?? {}
      // Ids are random, so a match from another shop is not a retry; it is
      // someone replaying a key they should not have.
      if (prev.accountUid !== account.uid) throw new HttpError(409, 'That request id is already in use.')
      // What was stored, not what this request says — and no second email.
      // `emailed` can read false while the first request is still sending.
      return Response.json({
        id: ref.id,
        totalUsd: Number(prev.totalUsd ?? 0),
        itemCount: Number(prev.itemCount ?? 0),
        emailed: prev.emailedAt != null,
        emailConfigured: emailConfigured(),
        duplicate: true,
      })
    }

    // The order is saved. From here every failure is a notification failure,
    // never an order failure — the shop is told their order went through
    // regardless, because it did.
    const email = await sendEmail({
      to: ORDERS_EMAIL,
      subject: `New wholesale order — ${account.shopName} — ${totalUsd.toFixed(2)}`,
      text: orderText({ id: ref.id, ...account, items, totalUsd, itemCount, notes, invoiceNumber, invoiceUrl }),
      // Replying goes straight to the shop that ordered.
      replyTo: account.email,
      ...(invoiceUrl ? {
        attachments: [{ path: invoiceUrl, filename: `${invoiceNumber || 'invoice'}.png` }],
      } : {}),
    })

    if (email.sent) {
      await ref.update({ emailedAt: FieldValue.serverTimestamp() }).catch(() => {})
    } else {
      // Recorded on the order so the admin page can show that the notification
      // didn't go out, rather than it failing silently.
      await ref.update({ emailError: email.reason ?? 'unknown' }).catch(() => {})
      console.error('[wholesale] order saved but email not sent:', email.reason)
    }

    return Response.json({
      id: ref.id,
      totalUsd,
      itemCount,
      emailed: email.sent,
      emailConfigured: emailConfigured(),
    }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
