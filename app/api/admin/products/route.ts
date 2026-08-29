// The product catalogue — what is for sale, what it costs, what is on offer.
//
// POST    create a product, or a category
// PATCH   edit a product
// DELETE  remove a product, or a category nothing is filed under
//
// `kind` picks which.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import {
  parseProductInput, parseStartingStock, createProduct, updateProduct, deleteProduct,
  createProductCategory, deleteProductCategory,
} from '@/app/lib/server/products'
import { allocateSkus } from '@/app/lib/server/sku'
import { logCreate, logUpdate, logDelete, logActivity } from '@/app/lib/server/activityLog'

export const runtime = 'nodejs'

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid request body.')
  }
}

function kindOf(raw: unknown): 'product' | 'category' {
  if (raw === 'product' || raw === 'category') return raw
  throw new HttpError(400, 'Missing or unknown kind — expected "product" or "category".')
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'products')
    const body = await readBody(request)

    if (kindOf(body.kind) === 'category') {
      const name = String(body.name ?? '').trim()
      const { id } = await createProductCategory(name)
      await logActivity(caller, 'create', 'Product Category', name)
      return Response.json({ ok: true, id })
    }

    const input = parseProductInput(body)
    // Allocated here rather than fetched by the browser and posted back. A
    // number held between two calls is one that can be dropped or reused.
    const [sku] = await allocateSkus([input.name])
    const { id } = await createProduct(input, sku, parseStartingStock(body.stock))

    await logCreate(caller, 'Product', input.name, {
      sku, price: input.price, category: input.category,
      ...(input.salePrice != null ? { salePrice: input.salePrice } : {}),
    })
    return Response.json({ ok: true, id, sku })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'products')
    const body = await readBody(request)
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) throw new HttpError(400, 'Missing id.')

    // Note what is NOT here: stock and sku. ProductInput carries neither, so
    // an edit cannot move stock backwards or rewrite a code already printed
    // on a label.
    const input = parseProductInput(body)
    const { before } = await updateProduct(id, input)
    await logUpdate(caller, 'Product', input.name, before, { ...input })
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'products')
    const url = new URL(request.url)

    if (kindOf(url.searchParams.get('kind')) === 'category') {
      // Categories are referenced by NAME, not id, so that is what identifies
      // one here.
      const { name } = await deleteProductCategory(url.searchParams.get('name') ?? '')
      await logActivity(caller, 'delete', 'Product Category', name)
      return Response.json({ ok: true })
    }

    const id = url.searchParams.get('id') ?? ''
    if (!id) throw new HttpError(400, 'Missing id.')
    const { name, before } = await deleteProduct(id)
    await logDelete(caller, 'Product', name, before)
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
