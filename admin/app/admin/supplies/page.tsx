'use client'

import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { listTemplateItems, listProviders, UNIT_LABELS, translateToArabic } from '@big-cms/shared/weeklyOrders'
import { STOCKED_BRANCHES, PRIMARY_BRANCH, branchColor, emptyStock } from '@big-cms/shared/branches'
import { SUPPLY_CATEGORY_COLOR as CAT_COLOR, type SupplyCategory as Category } from '@big-cms/shared/departments'
import { suggestedFactor, describeQty, normalizeUnit } from '@big-cms/shared/recipes'
import { ALLERGENS_EU14 } from '@big-cms/shared/foodSafety'


// The branches that hold consumable stock, from configuration. This was a
// hardcoded ['Beirut', 'Zouk', 'Broummana'] — the original café's branches —
// which meant the tabs below listed three branches that do not exist here and
// read quantity['Beirut'] for every item. Every count came back undefined, so
// the whole inventory showed as out of stock while the real quantities sat
// under keys nothing rendered.
const SUPPLY_BRANCHES = STOCKED_BRANCHES
type SupplyBranch = string

type BranchQtys = Record<SupplyBranch, number>

interface Supply {
  id: string
  name: string
  nameAr?: string
  quantity: BranchQtys
  unit: string
  threshold: number
  category: Category
  provider?: string
  // Absent on every item created before VAT moved onto the item. Undefined
  // reads as taxable, which is what the single whole-invoice rate did to
  // every line at the time.
  vatable?: boolean
  // How recipes measure this item — see the form below and shared/src/recipes.ts.
  recipeUnit?: string | null
  recipeUnitsPerPurchaseUnit?: number | null
  yieldPercent?: number | null
  // null or absent: nobody has checked it. [] : checked, contains none.
  allergens?: string[] | null
}

const CATEGORIES: Category[] = ['Kitchen', 'Bar', 'Cleaning', 'Other']
const UNITS = ['pieces', 'kg', 'g', 'L', 'mL', 'boxes', 'bottles', 'packs', 'bags', 'rolls', 'cans', 'units']


// branchColor() lives in lib/branches so all five screens that colour a branch
// agree, and so a fourth configured branch gets a colour instead of undefined.
const BRANCH_COLOR = branchColor

const EMPTY_QTY: BranchQtys = emptyStock()

function branchStatus(qty: number, threshold: number): 'ok' | 'low' | 'out' {
  if (qty <= 0) return 'out'
  if (qty < threshold) return 'low'
  return 'ok'
}


const S_COLOR  = { ok: 'var(--teal)', low: 'var(--brand-secondary)', out: 'var(--red)' }
const S_BG     = { ok: 'rgba(var(--teal-rgb),0.06)',   low: 'rgba(var(--brand-secondary-rgb),0.08)',  out: 'rgba(var(--red-rgb),0.09)'  }
const S_BORDER = { ok: 'rgba(var(--teal-rgb),0.18)',   low: 'rgba(var(--brand-secondary-rgb),0.26)',  out: 'rgba(var(--red-rgb),0.32)'  }
const S_LABEL  = { ok: 'OK', low: 'Low', out: 'Out' }

const EMPTY_FORM = {
  name: '', nameAr: '', category: 'Kitchen' as Category, unit: 'pieces', threshold: 5, provider: '', vatable: true,
  // Strings while being typed; the route turns blank into "not set".
  recipeUnit: '', recipeUnitsPerPurchaseUnit: '', yieldPercent: '',
  allergens: null as string[] | null,
}

const inp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
  color: 'var(--offwhite)', borderRadius: '4px', padding: '0.55rem 0.75rem',
  fontSize: '0.85rem', outline: 'none', width: '100%', boxSizing: 'border-box',
  fontFamily: 'var(--font-inter)',
}
const sel: React.CSSProperties = { ...inp, background: '#1c1c1c', cursor: 'pointer' }
const lbl: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase',
  color: 'rgba(var(--offwhite-rgb),0.35)', marginBottom: '0.3rem', fontFamily: 'var(--font-inter)',
}

/**
 * What the recipe measurement fields mean, in words, for the hint beneath them.
 *
 * The example line is the defence against a wrong factor: a conversion that is
 * a thousand times out reads as obvious nonsense once it is written as
 * "100 g = 100 kg". The figure comes from recipes.ts, not from arithmetic here.
 */
function recipeMeasurement(form: { unit: string; recipeUnit: string; recipeUnitsPerPurchaseUnit: string; yieldPercent: string }): { needsFactor: boolean; hint: string } {
  const needsFactor = !!form.recipeUnit && normalizeUnit(form.recipeUnit) !== normalizeUnit(form.unit)
  if (!form.recipeUnit) return { needsFactor, hint: `Recipes will measure this in ${form.unit}.` }
  if (!needsFactor) return { needsFactor, hint: `${form.recipeUnit} is the same unit as ${form.unit}, so no conversion is needed.` }
  const factor = Number(form.recipeUnitsPerPurchaseUnit)
  if (form.recipeUnitsPerPurchaseUnit === '' || !Number.isFinite(factor) || factor <= 0) {
    return { needsFactor, hint: `How many ${form.recipeUnit} are in one ${form.unit}? A recipe using this item cannot be saved until this is set.` }
  }
  const y = form.yieldPercent === '' ? null : Number(form.yieldPercent)
  if (y !== null && !(Number.isFinite(y) && y > 0 && y <= 100)) {
    return { needsFactor, hint: 'Usable share must be above 0% and at most 100%.' }
  }
  const example = describeQty(100, { id: '', unit: form.unit, recipeUnit: form.recipeUnit, recipeUnitsPerPurchaseUnit: factor, yieldPercent: y })
  return { needsFactor, hint: `1 ${form.unit} = ${factor} ${form.recipeUnit}. In a recipe, ${example}.` }
}

export default function SuppliesPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.supplies)
  const [supplies, setSupplies]     = useState<Supply[]>([])
  const [loading, setLoading]       = useState(true)
  const [modal, setModal]           = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing]       = useState<Supply | null>(null)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [formQty, setFormQty]       = useState<BranchQtys>(EMPTY_QTY)
  const [saving, setSaving]         = useState(false)
  const [translating, setTranslating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [seeding, setSeeding]       = useState(false)

  const [branch, setBranch]   = useState<SupplyBranch>(PRIMARY_BRANCH)
  const [search, setSearch]   = useState('')
  const [groupBy, setGroupBy] = useState<'category' | 'provider'>('category')

  // Inline threshold edit
  const [thrEditId, setThrEditId] = useState<string | null>(null)
  const [thrVal, setThrVal]       = useState('')

  async function load() {
    const snap = await getDocs(collection(db, 'supplies'))
    setSupplies(
      snap.docs.map(d => {
        const data = d.data() as Omit<Supply, 'id'>
        // Legacy single-number quantity: fold it into the flagship branch
        // rather than naming three branches that may not exist.
        const qty = typeof data.quantity === 'number'
          ? { ...EMPTY_QTY, [PRIMARY_BRANCH]: data.quantity }
          : (data.quantity ?? EMPTY_QTY)
        return { ...data, id: d.id, quantity: qty }
      }).sort((a, b) => a.name.localeCompare(b.name))
    )
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() { setForm(EMPTY_FORM); setFormQty(EMPTY_QTY); setEditing(null); setModal('add') }
  function openEdit(s: Supply) {
    setForm({
      name: s.name, nameAr: s.nameAr ?? '', category: s.category, unit: s.unit, threshold: s.threshold, provider: s.provider ?? '', vatable: s.vatable !== false,
      recipeUnit: s.recipeUnit ?? '',
      recipeUnitsPerPurchaseUnit: s.recipeUnitsPerPurchaseUnit != null ? String(s.recipeUnitsPerPurchaseUnit) : '',
      yieldPercent: s.yieldPercent != null ? String(s.yieldPercent) : '',
      allergens: Array.isArray(s.allergens) ? s.allergens : null,
    })
    setFormQty({ ...EMPTY_QTY, ...s.quantity })
    setEditing(s); setModal('edit')
  }

  async function autoTranslate() {
    setTranslating(true)
    try {
      const ar = await translateToArabic(form.name)
      setForm(f => ({ ...f, nameAr: ar }))
    } catch { /* leave field as-is on failure — user can type it manually */ }
    finally { setTranslating(false) }
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    const data = {
      name: form.name, nameAr: form.nameAr.trim() || null, category: form.category, unit: form.unit, threshold: form.threshold,
      provider: form.provider.trim() || null, vatable: form.vatable, updatedAt: serverTimestamp(),
      // Sent on every save, blank included. The route replaces the whole item,
      // so a form that left these out would quietly wipe a conversion somebody
      // set — and every recipe using it would stop being costable.
      recipeUnit: form.recipeUnit || null,
      recipeUnitsPerPurchaseUnit: form.recipeUnit ? form.recipeUnitsPerPurchaseUnit : '',
      yieldPercent: form.yieldPercent,
      // Sent every time for the same reason: the route replaces the whole item,
      // and leaving this out would turn a checked item back into an unchecked one.
      allergens: form.allergens,
    }
    // Quantity is deliberately not sent on an edit — it is only ever set by
    // a submitted Daily Inventory Count or a received delivery, and the route
    // enforces that rather than relying on this call omitting the field.
    if (editing) {
      await unwrap(await authedFetch('/api/admin/inventory', 'PATCH', { id: editing.id, ...data }))
    } else {
      await unwrap(await authedFetch('/api/admin/inventory', 'POST', { ...data, quantity: formQty }))
    }
    setSaving(false); setModal(null); load()
  }

  async function deleteItem(id: string) {
    setDeletingId(id)
    try {
      // The route refuses if an order template item still points at this
      // supply. Deleting one that is linked leaves deliveries of that item
      // moving no stock, silently — nothing checked that before.
      await unwrap(await authedFetch('/api/admin/inventory?id=' + encodeURIComponent(id), 'DELETE'))
      setSupplies(prev => prev.filter(s => s.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete that item.')
    } finally {
      setDeletingId(null)
    }
  }

  async function commitThrEdit(s: Supply) {
    const v = parseInt(thrVal)
    if (!isNaN(v) && v >= 1 && v !== s.threshold) {
      setSupplies(prev => prev.map(x => x.id === s.id ? { ...x, threshold: v } : x))
      await unwrap(await authedFetch('/api/admin/inventory', 'PATCH', { action: 'threshold', id: s.id, threshold: v }))
    }
    setThrEditId(null); setThrVal('')
  }

  // Imports items that don't exist yet, and — for items that already do —
  // backfills the Arabic name from the matching Weekly Orders template item
  // whenever the supply doesn't already have one of its own. Never
  // overwrites an Arabic name someone already set here by hand.
  // Runs SERVER-SIDE. The client version hardcoded
  // { Beirut: 0, Zouk: 0, Broummana: 0 } — the original cafe's branches — so
  // in any other deployment it created stock keys for branches that do not
  // exist and none for the ones that do. It also matched template to supply on
  // a lowercased name and never wrote supplyId, which is the fragile linkage
  // Phase 01 exists to replace. The route uses the configured BRANCHES and
  // writes the durable link.
  async function seedFromTemplates() {
    setSeeding(true)
    try {
      const r = await unwrap(await authedFetch('/api/admin/inventory', 'POST', { action: 'seed-from-templates' }))
      alert(`Seeded from the order template — ${r.created} created, ${r.linked} linked.`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not seed from templates.')
    } finally {
      setSeeding(false); load()
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q
      ? supplies.filter(s => s.name.toLowerCase().includes(q) || s.provider?.toLowerCase().includes(q))
      : supplies
  }, [supplies, search])

  const alertCount = supplies.filter(s => branchStatus(s.quantity[branch] ?? 0, s.threshold) !== 'ok').length

  const groups = useMemo(() => {
    if (groupBy === 'category') {
      return CATEGORIES
        .map(cat => ({ key: cat, color: CAT_COLOR[cat], items: visible.filter(s => s.category === cat) }))
        .filter(g => g.items.length > 0)
    }
    const map = new Map<string, Supply[]>()
    for (const s of visible) {
      const key = s.provider?.trim() || 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    const keys = [...map.keys()].sort((a, b) => {
      if (a === 'Unknown') return 1
      if (b === 'Unknown') return -1
      return a.localeCompare(b)
    })
    return keys.map(key => ({ key, color: 'rgba(var(--offwhite-rgb),0.45)', items: map.get(key)! }))
  }, [visible, groupBy])

  if (checking || loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '3rem 2rem' }}>

        <a href="/admin" style={{ fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none', marginBottom: '0.5rem', display: 'block' }}>
          ← Dashboard
        </a>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', marginBottom: '0.25rem' }}>Inventory Management</h1>
            <p style={{ fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.35)' }}>
              {supplies.length} items tracked
              {alertCount > 0 && <span style={{ color: 'var(--red)', marginLeft: '0.5rem' }}>• {alertCount} need attention in {branch}</span>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <a href="/admin/supplies/daily" style={{ background: 'transparent', color: '#6A9E5A', border: '1px solid rgba(106,158,90,0.35)', borderRadius: '4px', padding: '0.65rem 1.2rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Daily Inventory Count
            </a>
            <button onClick={seedFromTemplates} disabled={seeding} title="Adds new items from Weekly Orders and fills in Arabic names for existing items that don't have one yet" style={{ background: 'transparent', color: 'rgba(var(--offwhite-rgb),0.5)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', padding: '0.65rem 1.2rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: seeding ? 'not-allowed' : 'pointer', opacity: seeding ? 0.5 : 1 }}>
              {seeding ? 'Syncing…' : 'Import & Sync from Weekly Orders'}
            </button>
            <button onClick={openAdd} style={{ background: 'var(--teal)', color: '#000', border: 'none', borderRadius: '4px', padding: '0.65rem 1.4rem', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}>
              + Add Item
            </button>
          </div>
        </div>

        {/* Branch tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {SUPPLY_BRANCHES.map(b => (
            <button key={b} onClick={() => setBranch(b)} style={{
              background: branch === b ? `${BRANCH_COLOR(b)}18` : 'transparent',
              border: `1px solid ${branch === b ? BRANCH_COLOR(b) : 'rgba(255,255,255,0.09)'}`,
              color: branch === b ? BRANCH_COLOR(b) : 'rgba(var(--offwhite-rgb),0.35)',
              borderRadius: '6px', padding: '0.5rem 1.25rem',
              fontSize: '0.78rem', fontWeight: branch === b ? 600 : 400,
              letterSpacing: '0.06em', cursor: 'pointer',
            }}>{b}</button>
          ))}
        </div>

        {/* Search + group toggle */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items or provider…"
            style={{ ...inp, flex: 1, minWidth: '180px', padding: '0.6rem 0.9rem' }} />
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '6px', overflow: 'hidden' }}>
            {(['category', 'provider'] as const).map(g => (
              <button key={g} onClick={() => setGroupBy(g)} style={{
                background: groupBy === g ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: groupBy === g ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.35)',
                border: 'none', padding: '0.6rem 1.1rem', fontSize: '0.72rem',
                letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
              }}>
                {g === 'category' ? 'By Category' : 'By Provider'}
              </button>
            ))}
          </div>
        </div>

        {/* Groups */}
        {visible.length === 0 ? (
          <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4rem', textAlign: 'center', color: 'rgba(var(--offwhite-rgb),0.2)', fontSize: '0.88rem' }}>
            {search ? 'No items match your search.' : 'No items yet. Click "+ Add Item" or import from Weekly Orders.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {groups.map(group => (
              <div key={group.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: group.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: group.color, fontWeight: 600 }}>{group.key}</span>
                  <span style={{ fontSize: '0.65rem', color: 'rgba(var(--offwhite-rgb),0.25)' }}>({group.items.length})</span>
                  <span style={{ flex: 1, height: '1px', background: `${group.color}25` }} />
                  {(() => {
                    const n = group.items.filter(s => branchStatus(s.quantity[branch] ?? 0, s.threshold) !== 'ok').length
                    return n > 0 ? <span style={{ background: 'var(--red)', color: '#fff', borderRadius: '3px', padding: '0.05rem 0.4rem', fontSize: '0.6rem', fontWeight: 700 }}>{n} low</span> : null
                  })()}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.6rem' }}>
                  {group.items.map(s => {
                    const qty = s.quantity[branch] ?? 0
                    const st  = branchStatus(qty, s.threshold)
                    return (
                      <div key={s.id} style={{ background: S_BG[st], border: `1px solid ${S_BORDER[st]}`, borderRadius: '8px', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

                        {/* Name + badge */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.85rem', lineHeight: 1.3 }}>{s.name}</p>
                            {s.nameAr && (
                              <p dir="rtl" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--brand-secondary-rgb),0.8)', marginTop: '0.15rem' }}>{s.nameAr}</p>
                            )}
                            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                              {groupBy !== 'category' && <span style={{ fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: CAT_COLOR[s.category] }}>{s.category}</span>}
                              {groupBy !== 'provider' && s.provider && <span style={{ fontSize: '0.6rem', color: 'rgba(var(--offwhite-rgb),0.28)' }}>{s.provider}</span>}
                            </div>
                          </div>
                          <span style={{ background: `${S_COLOR[st]}20`, color: S_COLOR[st], border: `1px solid ${S_COLOR[st]}40`, borderRadius: '3px', padding: '0.1rem 0.45rem', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {S_LABEL[st]}
                          </span>
                        </div>

                        {/* Quantity row — read-only; counted and set via Daily Inventory Count */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
                          <span>
                            <span style={{ fontSize: '1.3rem', fontWeight: 700, color: S_COLOR[st], letterSpacing: '-0.02em' }}>{qty}</span>
                            <span style={{ fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.4)', marginLeft: '0.2rem' }}>{s.unit}</span>
                          </span>

                          {/* Threshold inline edit */}
                          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{ fontSize: '0.6rem', color: 'rgba(var(--offwhite-rgb),0.25)' }}>min</span>
                            {thrEditId === s.id ? (
                              <input type="number" value={thrVal} min={1} autoFocus
                                onChange={e => setThrVal(e.target.value)}
                                onBlur={() => commitThrEdit(s)}
                                onKeyDown={e => { if (e.key === 'Enter') commitThrEdit(s); if (e.key === 'Escape') { setThrEditId(null); setThrVal('') } }}
                                style={{ ...inp, width: '48px', fontSize: '0.78rem', padding: '0.15rem 0.25rem', textAlign: 'center', color: S_COLOR[st] }}
                              />
                            ) : (
                              <button onClick={() => { setThrEditId(s.id); setThrVal(String(s.threshold)) }} title="Click to change minimum" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0.25rem', borderRadius: '3px' }}>
                                <span style={{ fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.35)', fontWeight: 600 }}>{s.threshold}</span>
                                <span style={{ fontSize: '0.55rem', color: 'rgba(var(--offwhite-rgb),0.18)', marginLeft: '0.15rem' }}>✎</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.1rem' }}>
                          <button onClick={() => openEdit(s)} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(var(--offwhite-rgb),0.5)', borderRadius: '4px', padding: '0.28rem', fontSize: '0.68rem', cursor: 'pointer' }}>Edit</button>
                          <button onClick={() => deleteItem(s.id)} disabled={deletingId === s.id} style={{ background: 'rgba(var(--red-rgb),0.08)', border: '1px solid rgba(var(--red-rgb),0.2)', color: 'var(--red)', borderRadius: '4px', padding: '0.28rem 0.5rem', fontSize: '0.68rem', cursor: 'pointer', opacity: deletingId === s.id ? 0.5 : 1 }}>
                            {deletingId === s.id ? '…' : '✕'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div onClick={e => { if (e.target === e.currentTarget) setModal(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
          <div style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '2rem', width: '100%', maxWidth: '460px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', marginBottom: '1.5rem' }}>
              {modal === 'add' ? 'Add Item' : 'Edit Item'}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={lbl}>Item Name</label>
                <input style={inp} value={form.name} placeholder="e.g. Bread" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Arabic Name</label>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input
                    style={{ ...inp, textAlign: 'right' }} dir="rtl" placeholder="عربي"
                    value={form.nameAr} onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))}
                  />
                  <button
                    type="button" onClick={autoTranslate} disabled={translating || !form.name.trim()} title="Auto-translate from Item Name"
                    style={{
                      background: 'rgba(var(--brand-secondary-rgb),0.12)', border: '1px solid rgba(var(--brand-secondary-rgb),0.3)',
                      color: 'var(--brand-secondary)', padding: '0.55rem 0.7rem', borderRadius: '4px', fontSize: '0.8rem',
                      cursor: translating || !form.name.trim() ? 'not-allowed' : 'pointer', flexShrink: 0,
                    }}
                  >{translating ? '…' : '🌐'}</button>
                </div>
              </div>
              <div>
                <label style={lbl}>Provider / Supplier</label>
                <input style={inp} value={form.provider} placeholder="e.g. Metro, Spinneys" onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={lbl}>Category</label>
                  <select style={sel} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as Category }))}>
                    {CATEGORIES.map(c => <option key={c} value={c} style={{ background: '#1c1c1c', color: 'var(--offwhite)' }}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Unit</label>
                  <select style={sel} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u} style={{ background: '#1c1c1c', color: 'var(--offwhite)' }}>{u}</option>)}
                  </select>
                </div>
              </div>

              {/* How recipes measure this item (Sep 2026). Stock stays counted in the
                  unit above — receiving and the daily count use it. A recipe can
                  measure in something smaller, and the conversion turns 200 ml
                  into a fraction of a gallon. Blank means recipes use the unit
                  above. */}
              {(() => {
                const m = recipeMeasurement(form)
                const units = form.recipeUnit && !UNITS.includes(form.recipeUnit) ? [...UNITS, form.recipeUnit] : UNITS
                return (
                  <div>
                    <label style={lbl}>Recipes measure it in</label>
                    <div style={{ display: 'grid', gridTemplateColumns: m.needsFactor ? '1fr 1fr' : '1fr', gap: '0.75rem' }}>
                      <select style={sel} value={form.recipeUnit} onChange={e => {
                        const next = e.target.value
                        setForm(f => ({
                          ...f,
                          recipeUnit: next,
                          // Offer the known factor (kg to g is 1000) only when none is set;
                          // never overwrite one somebody typed.
                          recipeUnitsPerPurchaseUnit: f.recipeUnitsPerPurchaseUnit
                            || (next ? String(suggestedFactor(f.unit, next) ?? '') : ''),
                        }))
                      }}>
                        <option value="" style={{ background: '#1c1c1c', color: 'var(--offwhite)' }}>Same as the unit above</option>
                        {units.map(u => <option key={u} value={u} style={{ background: '#1c1c1c', color: 'var(--offwhite)' }}>{u}</option>)}
                      </select>
                      {m.needsFactor && (
                        <input style={inp} type="number" min={0} step="any"
                          placeholder={`${form.recipeUnit} in one ${form.unit}`}
                          value={form.recipeUnitsPerPurchaseUnit}
                          onChange={e => setForm(f => ({ ...f, recipeUnitsPerPurchaseUnit: e.target.value }))} />
                      )}
                    </div>
                    <p style={{ fontSize: '0.62rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.25rem' }}>{m.hint}</p>
                  </div>
                )
              })()}

              <div>
                <label style={lbl}>Usable Share After Trim (%)</label>
                <input style={inp} type="number" min={1} max={100} step="any" placeholder="100"
                  value={form.yieldPercent} onChange={e => setForm(f => ({ ...f, yieldPercent: e.target.value }))} />
                <p style={{ fontSize: '0.62rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.25rem' }}>
                  Onions trimmed to 85% usable: enter 85, and recipes buy enough to allow for it. Blank means all of it is used.
                </p>
              </div>

              <div>
                <label style={lbl}>Allergens</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  {([['unchecked', 'Not checked yet'], ['checked', 'Checked']] as const).map(([value, label]) => {
                    const active = value === 'checked' ? form.allergens !== null : form.allergens === null
                    return (
                      <button key={value} type="button"
                        onClick={() => setForm(f => ({ ...f, allergens: value === 'checked' ? (f.allergens ?? []) : null }))}
                        style={{ ...inp, width: 'auto', cursor: 'pointer', background: active ? 'rgba(var(--teal-rgb),0.2)' : 'transparent', borderColor: active ? 'var(--teal)' : 'rgba(255,255,255,0.12)' }}>
                        {label}
                      </button>
                    )
                  })}
                </div>
                {form.allergens !== null && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem 0.8rem' }}>
                    {ALLERGENS_EU14.map(a => (
                      <label key={a.key} style={{ fontSize: '0.75rem', color: 'var(--offwhite)', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <input type="checkbox" checked={form.allergens?.includes(a.key) ?? false}
                          onChange={e => setForm(f => ({
                            ...f,
                            allergens: e.target.checked ? [...(f.allergens ?? []), a.key] : (f.allergens ?? []).filter(k => k !== a.key),
                          }))} />
                        {a.label}
                      </label>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: '0.62rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.25rem' }}>
                  {form.allergens === null
                    ? 'Every dish using an unchecked item shows as "not verified" on the allergen chart. Check the label.'
                    : form.allergens.length === 0
                      ? 'Checked, and contains none of these. Read the label, including "may contain".'
                      : 'From the label, including "may contain" warnings.'}
                </p>
              </div>

              {/* Per-branch initial quantities — add-only; existing items' quantities
                  only change via a submitted Daily Inventory Count. */}
              {modal === 'add' && (
                <div>
                  <label style={{ ...lbl, marginBottom: '0.5rem' }}>Starting Quantities</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {SUPPLY_BRANCHES.map(branch => (
                      <div key={branch} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ width: '80px', fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: BRANCH_COLOR(branch) }}>{branch}</span>
                        <input type="number" min={0} value={formQty[branch]} onChange={e => setFormQty(q => ({ ...q, [branch]: Number(e.target.value) }))}
                          style={{ ...inp, width: '90px' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* VAT belongs on the item, not on the delivery. Raw food is
                  zero-rated here and chemicals and paper goods are not, so the
                  answer is a property of what the thing IS. Receiving seeds
                  each line from this and still lets the line override it. */}
              <div>
                <label style={lbl}>VAT</label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, vatable: !f.vatable }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%',
                    background: form.vatable ? 'rgba(var(--teal-rgb),0.1)' : 'transparent',
                    border: `1px solid ${form.vatable ? 'rgba(var(--teal-rgb),0.4)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: '4px', padding: '0.6rem 0.7rem', cursor: 'pointer',
                    color: form.vatable ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.4)',
                    fontFamily: 'var(--font-inter)', fontSize: '0.8rem', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: '15px', height: '15px', flexShrink: 0, borderRadius: '3px',
                    border: `1px solid ${form.vatable ? 'var(--teal)' : 'rgba(255,255,255,0.2)'}`,
                    background: form.vatable ? 'var(--teal)' : 'transparent',
                    color: '#000', fontSize: '0.65rem', lineHeight: '15px', textAlign: 'center',
                  }}>{form.vatable ? '✓' : ''}</span>
                  {/* One stable label saying what TICKING it means. It used
                      to describe the current state instead — an unticked box
                      reading "Zero-rated — no VAT", which leaves you guessing
                      whether ticking it makes the item zero-rated or taxable.
                      The state is the tick; the label is the question. */}
                  VAT applies to this item
                </button>
                <p style={{ fontSize: '0.62rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.25rem' }}>
                  {form.vatable ? 'Taxed at the configured rate.' : 'Zero-rated.'} Used as the default when receiving; each delivery can override it.
                </p>
              </div>

              <div>
                <label style={lbl}>Minimum (Alert Threshold)</label>
                <input style={inp} type="number" min={1} value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: Number(e.target.value) }))} />
                <p style={{ fontSize: '0.62rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.25rem' }}>Applies to each branch — turns orange/red below this</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.75rem' }}>
              <button onClick={save} disabled={saving || !form.name.trim()} style={{ flex: 1, background: 'var(--teal)', color: '#000', border: 'none', borderRadius: '4px', padding: '0.7rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : modal === 'add' ? 'Add Item' : 'Save Changes'}
              </button>
              <button onClick={() => setModal(null)} style={{ background: 'transparent', color: 'rgba(var(--offwhite-rgb),0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '0.7rem 1rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
