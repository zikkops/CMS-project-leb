'use client'

import {
  collection, doc, getDocs, runTransaction,
  serverTimestamp, query, orderBy, limit, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { logActivity } from './activityLog'
import { uploadImage } from './media'
import { authedFetch, unwrap } from './apiClient'
import { BRANCHES, normalizeStock } from './branches'
import { BRAND } from './brand'

export interface PurchaseItem {
  gameId: string
  gameName: string
  quantity: number
  unitPrice: number
  priceType: 'retail' | 'wholesale'
  subtotal: number
  // Copied onto the order at checkout, not looked up when the invoice is
  // drawn: an issued invoice is a record and must keep rendering the same way
  // even if the game is later renamed or removed. Optional — orders placed
  // before SKUs existed have none, and simply show no SKU line.
  sku?: string
}

export interface GamePurchaseOrder {
  id: string
  invoiceNumber: string
  customerName: string
  items: PurchaseItem[]
  total: number
  branch: string
  status: 'completed' | 'refunded'
  invoiceUrl: string | null
  processedBy: string
  processedByEmail: string
  createdAt: Timestamp | null
  refundedAt: Timestamp | null
  refundedBy: string | null
  refundNote: string | null
}

// nextInvoiceNumber() was here and nothing called it — a pass-through to
// nextFormattedInvoiceNumber() left behind when counter sales moved to
// /api/admin/purchases, which issues its number inside the same transaction as
// the stock movement.
//
// Invoices issued before the format change keep their INV-2026-0001 numbers,
// which is correct: an issued invoice number is a record, not a computed
// value.

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 0 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

export function drawInvoiceCanvas(
  invoiceNumber: string,
  customerName: string,
  branch: string,
  items: PurchaseItem[],
  total: number,
  processedByEmail: string,
  createdAt: Date,
  status: 'completed' | 'refunded',
): HTMLCanvasElement {
  const W = 794
  const PAD = 48
  // Two lines per item — name, then SKU beneath it. ITEMS_H and therefore the
  // canvas height are derived from this, so the taller row grows the invoice
  // rather than overflowing the footer.
  const ROW_H = 42
  const HEADER_H = 100
  const TABLE_HDR_H = 38
  const ITEMS_H = items.length * ROW_H
  const H = HEADER_H + 180 + TABLE_HDR_H + ITEMS_H + 100 + 60

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // ── Header bar ──────────────────────────────────────────────────────────
  ctx.fillStyle = '#150d2e'
  ctx.fillRect(0, 0, W, HEADER_H)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 20px Georgia, serif'
  ctx.textAlign = 'left'
  ctx.fillText(BRAND.name.toUpperCase(), PAD, 44)
  ctx.font = '11px Arial, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText(BRAND.tagline, PAD, 64)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 30px Arial, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('INVOICE', W - PAD, 60)
  ctx.textAlign = 'left'

  // ── Meta block ──────────────────────────────────────────────────────────
  let y = HEADER_H + 32
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 13px Arial, sans-serif'
  ctx.fillText(`Invoice: ${invoiceNumber}`, PAD, y)
  ctx.textAlign = 'right'
  ctx.fillStyle = status === 'refunded' ? '#cc2200' : '#006e6a'
  ctx.font = 'bold 13px Arial, sans-serif'
  ctx.fillText(status === 'refunded' ? '● REFUNDED' : '● COMPLETED', W - PAD, y)
  ctx.textAlign = 'left'

  y += 26
  ctx.fillStyle = '#555555'
  ctx.font = '12px Arial, sans-serif'
  ctx.fillText(`Date: ${createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, PAD, y)
  ctx.textAlign = 'right'
  ctx.fillText(`Branch: ${branch}`, W - PAD, y)
  ctx.textAlign = 'left'

  y += 28
  ctx.fillStyle = '#888888'
  ctx.font = '11px Arial, sans-serif'
  ctx.fillText('BILL TO', PAD, y)
  y += 20
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 16px Arial, sans-serif'
  ctx.fillText(customerName, PAD, y)
  y += 22
  ctx.fillStyle = '#999999'
  ctx.font = '11px Arial, sans-serif'
  ctx.fillText(`Processed by: ${processedByEmail}`, PAD, y)

  // ── Divider ─────────────────────────────────────────────────────────────
  y += 24
  ctx.strokeStyle = '#e0e0e0'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke()
  y += 16

  // ── Table header ────────────────────────────────────────────────────────
  const C_QTY   = W - PAD - 200
  const C_PRICE = W - PAD - 110
  const C_TOTAL = W - PAD

  ctx.fillStyle = '#f3f3f3'
  ctx.fillRect(PAD, y, W - PAD * 2, TABLE_HDR_H)
  ctx.fillStyle = '#444444'
  ctx.font = 'bold 10px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('ITEM', PAD + 10, y + 24)
  ctx.textAlign = 'right'
  ctx.fillText('QTY', C_QTY, y + 24)
  ctx.fillText('UNIT PRICE', C_PRICE, y + 24)
  ctx.fillText('SUBTOTAL', C_TOTAL, y + 24)
  y += TABLE_HDR_H

  // ── Items ───────────────────────────────────────────────────────────────
  ctx.font = '13px Arial, sans-serif'
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (i % 2 === 1) {
      ctx.fillStyle = '#fafafa'
      ctx.fillRect(PAD, y, W - PAD * 2, ROW_H)
    }
    ctx.textAlign = 'left'
    ctx.fillStyle = '#222222'
    ctx.fillText(truncate(ctx, item.gameName, C_QTY - PAD - 30), PAD + 10, y + 18)
    if (item.sku) {
      ctx.font = '10px Arial, sans-serif'
      ctx.fillStyle = '#777777'
      ctx.fillText(item.sku, PAD + 10, y + 32)
      ctx.font = '13px Arial, sans-serif'
    }
    ctx.textAlign = 'right'
    ctx.fillStyle = '#555555'
    ctx.fillText(String(item.quantity), C_QTY, y + 18)
    ctx.fillText(`$${item.unitPrice.toFixed(2)}`, C_PRICE, y + 18)
    ctx.fillStyle = '#222222'
    ctx.font = '13px Arial, sans-serif'
    ctx.fillText(`$${item.subtotal.toFixed(2)}`, C_TOTAL, y + 18)
    y += ROW_H
  }

  // ── Total row ────────────────────────────────────────────────────────────
  y += 16
  ctx.strokeStyle = '#cccccc'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(C_QTY - 20, y); ctx.lineTo(W - PAD, y); ctx.stroke()
  y += 24
  ctx.fillStyle = '#150d2e'
  ctx.fillRect(C_QTY - 30, y - 24, W - PAD - (C_QTY - 30), 36)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 15px Arial, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`TOTAL:  $${total.toFixed(2)}`, W - PAD - 8, y - 4)
  ctx.textAlign = 'left'

  // ── Footer ───────────────────────────────────────────────────────────────
  const FOOTER_Y = H - 60
  ctx.fillStyle = '#f0f0f0'
  ctx.fillRect(0, FOOTER_Y, W, 60)
  ctx.fillStyle = '#888888'
  ctx.font = '11px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`Thank you for your business — ${BRAND.name}`, W / 2, FOOTER_Y + 24)
  ctx.fillText('This invoice was generated automatically. Please retain for your records.', W / 2, FOOTER_Y + 44)
  ctx.textAlign = 'left'

  return canvas
}

async function uploadInvoiceImage(
  invoiceNumber: string,
  customerName: string,
  branch: string,
  items: PurchaseItem[],
  total: number,
  processedByEmail: string,
  status: 'completed' | 'refunded' = 'completed',
): Promise<string> {
  const canvas = drawInvoiceCanvas(
    invoiceNumber, customerName, branch, items, total,
    processedByEmail, new Date(), status,
  )
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => (b ? res(b) : rej(new Error('canvas toBlob failed'))), 'image/png'),
  )
  const file = new File([blob], `invoice-${invoiceNumber}.png`, { type: 'image/png' })
  const { url } = await uploadImage(file)
  return url
}

// Recording a sale and refunding one both run SERVER-SIDE (Phase 00 standing
// rule). See app/lib/server/purchases.ts.
//
// The old client versions used a real runTransaction and were careful about
// stock. What they could not be careful about was PRICE: the browser read the
// game's price from its own copy of the document, multiplied by the quantity,
// and sent unitPrice/subtotal/total along with the order. Firestore stored
// what it was given, so a tampered client could record a $200 product as a
// one-cent sale and the books would agree with it forever.
//
// The request now carries only what was bought — gameId, quantity, price list.
// Every figure is recomputed on the server from the stored product, and the
// invoice number is issued inside the same transaction as the sale so a
// failure on stock does not burn a number.
export async function createPurchaseOrder(input: {
  customerName: string
  branch: string
  items: PurchaseItem[]
  processedBy: string
  processedByEmail: string
}): Promise<{ orderId: string; invoiceUrl: string | null }> {
  // Only the identifying fields are sent. `items` still carries prices in the
  // caller's shape because the cart UI needs them to render a running total,
  // but they are dropped here rather than transmitted — the server would
  // ignore them, and sending them would imply otherwise.
  const res = await authedFetch('/api/admin/purchases', 'POST', {
    customerName: input.customerName,
    branch: input.branch,
    lines: input.items.map(it => ({
      gameId: it.gameId,
      quantity: it.quantity,
      priceType: it.priceType,
    })),
  })
  const order = await unwrap(res) as unknown as {
    orderId: string
    invoiceNumber: string
    total: number
    items: PurchaseItem[]
  }

  // The invoice image is still drawn here: it needs a canvas, which has no
  // server equivalent short of running a headless browser. It is rendered from
  // the figures the SERVER returned, not from the cart's own arithmetic —
  // otherwise the picture could disagree with the record it depicts.
  //
  // Non-fatal, exactly as before: the sale is already committed, and
  // regenerateOrderInvoice() exists for a retry.
  let invoiceUrl: string | null = null
  try {
    invoiceUrl = await uploadInvoiceImage(
      order.invoiceNumber, input.customerName, input.branch,
      order.items, order.total, input.processedByEmail,
    )
    await authedFetch('/api/admin/purchases', 'PATCH', {
      orderId: order.orderId, action: 'invoice-url', invoiceUrl,
    })
  } catch {
    // Left null; the order stands without its picture.
  }

  return { orderId: order.orderId, invoiceUrl }
}

// Re-renders and re-uploads the invoice image for an existing order — useful
// if the initial upload failed right after the order was recorded.
export async function regenerateOrderInvoice(order: GamePurchaseOrder): Promise<string> {
  const url = await uploadInvoiceImage(
    order.invoiceNumber, order.customerName, order.branch,
    order.items, order.total, order.processedByEmail,
    order.status,
  )
  await authedFetch('/api/admin/purchases', 'PATCH', {
    orderId: order.id, action: 'invoice-url', invoiceUrl: url,
  })
  return url
}

export async function refundOrder(
  orderId: string,
  refundNote: string,
  _processedByEmail: string,
): Promise<void> {
  // _processedByEmail is ignored — the server records the actor from the
  // verified token. Kept in the signature so the call site is unchanged.
  const res = await authedFetch('/api/admin/purchases', 'PATCH', {
    orderId, action: 'refund', refundNote,
  })
  await unwrap(res)
}

// Atomically moves copies of one or more games from one branch to another in a
// single Firestore transaction — all reads happen first, all stock is validated,
// then all writes are applied together so a failure on any one game rolls back
// everything. Throws 'insufficient-stock:<gameName>' if any game doesn't have
// enough stock at fromBranch.
export async function transferGameStock(
  items: { gameId: string; gameName: string; quantity: number }[],
  fromBranch: string,
  toBranch: string,
): Promise<void> {
  const refs = items.map(item => doc(db, 'games', item.gameId))
  await runTransaction(db, async tx => {
    const snaps = await Promise.all(refs.map(ref => tx.get(ref)))
    for (let i = 0; i < items.length; i++) {
      if (!snaps[i].exists()) throw new Error(`game-not-found:${items[i].gameId}`)
      const stock = normalizeStock(snaps[i].data()!.stock)
      if ((stock[fromBranch] ?? 0) < items[i].quantity)
        throw new Error(`insufficient-stock:${items[i].gameName}`)
    }
    for (let i = 0; i < items.length; i++) {
      const stock = normalizeStock(snaps[i].data()!.stock)
      stock[fromBranch] = (stock[fromBranch] ?? 0) - items[i].quantity
      stock[toBranch]   = (stock[toBranch]   ?? 0) + items[i].quantity
      tx.update(refs[i], { stock, updatedAt: serverTimestamp() })
    }
  })
  await logActivity(
    'update', 'Stock Transfer',
    `${fromBranch} → ${toBranch}: ${items.map(i => `${i.gameName} ×${i.quantity}`).join(', ')}`,
  )
}

export async function listPurchaseOrders(max = 200): Promise<GamePurchaseOrder[]> {
  const snap = await getDocs(
    query(collection(db, 'gamePurchaseOrders'), orderBy('createdAt', 'desc'), limit(max)),
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as GamePurchaseOrder))
}

// Exports the game library as a CSV file directly from the browser.
// includeWholesale controls whether the wholesalePrice column appears.
export function exportGamesCSV(
  games: Array<{
    name: string
    category: string
    price: number
    wholesalePrice?: number | null
    stock?: Record<string, number> | number
    sku?: string
  }>,
  includeWholesale: boolean,
): void {
  // SKU leads because it is the identity column on the way back in: the
  // importer matches on it, so a round-trip can rename a game without the
  // import mistaking it for a new one.
  const headers = [
    'SKU', 'Name', 'Category', 'Retail Price ($)',
    ...(includeWholesale ? ['Wholesale Price ($)'] : []),
    ...BRANCHES.map(b => `Stock — ${b}`),
    'Total Stock',
  ]
  const rows = games.map(g => {
    const stockMap: Record<string, number> =
      typeof g.stock === 'number'
        ? Object.fromEntries(BRANCHES.map((b, i) => [b, i === 0 ? (g.stock as number) : 0]))
        : { ...(g.stock ?? {}) }
    const total = BRANCHES.reduce((s, b) => s + (stockMap[b] ?? 0), 0)
    return [
      `"${(g.sku ?? '').replace(/"/g, '""')}"`,
      `"${g.name.replace(/"/g, '""')}"`,
      `"${(g.category ?? '').replace(/"/g, '""')}"`,
      g.price > 0 ? g.price.toFixed(2) : '',
      ...(includeWholesale ? [g.wholesalePrice != null ? (g.wholesalePrice as number).toFixed(2) : ''] : []),
      ...BRANCHES.map(b => stockMap[b] ?? 0),
      total,
    ]
  })
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = includeWholesale ? 'game-library-full.csv' : 'game-library-retail.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
