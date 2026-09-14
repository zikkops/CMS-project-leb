'use client'

// Recipes & costing — admins only (owner's decision, 14 Sep 2026).
//
// What each dish is made of, what it costs to make, and what that leaves
// against the price. This page never moves stock: entering and costing recipes
// is safe to do for weeks before the `recipes` switch lets a sale take
// ingredients off the shelf.
//
// Every figure comes from shared/src/recipes.ts, which verify:recipes asserts.
// The page arranges and edits; it does no arithmetic of its own. The counter
// till's money bugs came from exactly that — figures worked out inline in a
// component, where nothing could check them.
//
// A cost that cannot be known says so. An ingredient never received has no
// average cost, one measured in another unit with no conversion has no
// quantity, and either makes the dish "cost unknown", naming the ingredient —
// never a cheap-looking $0.00.

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole } from '@big-cms/shared/adminAuth'
import type { Role } from '@big-cms/shared/roles'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { useBusinessSettings } from '@big-cms/shared/useBusinessSettings'
import { vatRateOn } from '@big-cms/shared/businessSettings'
import { todayYmd } from '@big-cms/shared/dates'
import { BRAND } from '@big-cms/shared/brand'
import { formatUsd } from '@big-cms/shared/money'
import { stationForSection } from '@big-cms/shared/checks'
import {
  lineConsumption, consumptionCost, dishMargin, describeQty, recipeProblems, suggestedPrice, targetMarginFor,
  type Recipe, type OptionAdjustment, type RecipeSupply, type ConsumptionCost,
} from '@big-cms/shared/recipes'

const ADMIN_ONLY: Role[] = ['admin']

interface MenuItemDoc {
  id: string
  name: string
  price: number
  categoryId: string
  order: number
  modifierGroupIds: string[]
}
interface CategoryDoc { id: string; name: string; order: number; section: string }
interface GroupDoc { id: string; name: string; options: { id: string; name: string }[] }

// The editor works in strings, because an input being typed into is not a
// number yet. They become a Recipe only when costed or saved.
interface DraftLine { supplyId: string; qty: string }
interface DraftAdjustment {
  kind: 'none' | 'add' | 'replace'
  supplyId: string
  qty: string
  fromSupplyId: string
  toSupplyId: string
}
interface Draft { lines: DraftLine[]; adjustments: Record<string, DraftAdjustment> }

const NO_ADJUSTMENT: DraftAdjustment = { kind: 'none', supplyId: '', qty: '', fromSupplyId: '', toSupplyId: '' }

function toDraft(recipe: Recipe | undefined): Draft {
  const adjustments: Record<string, DraftAdjustment> = {}
  for (const [optionId, list] of Object.entries(recipe?.adjustments ?? {})) {
    const a = list[0]
    if (!a) continue
    adjustments[optionId] = a.kind === 'add'
      ? { ...NO_ADJUSTMENT, kind: 'add', supplyId: a.supplyId, qty: String(a.qty) }
      : { ...NO_ADJUSTMENT, kind: 'replace', fromSupplyId: a.fromSupplyId, toSupplyId: a.toSupplyId }
  }
  return {
    lines: (recipe?.lines ?? []).map(l => ({ supplyId: l.supplyId, qty: String(l.qty) })),
    adjustments,
  }
}

function toRecipe(draft: Draft): Recipe {
  const adjustments: Record<string, OptionAdjustment[]> = {}
  for (const [optionId, a] of Object.entries(draft.adjustments)) {
    if (a.kind === 'add') adjustments[optionId] = [{ kind: 'add', supplyId: a.supplyId, qty: Number(a.qty) }]
    if (a.kind === 'replace') adjustments[optionId] = [{ kind: 'replace', fromSupplyId: a.fromSupplyId, toSupplyId: a.toSupplyId }]
  }
  return { lines: draft.lines.map(l => ({ supplyId: l.supplyId, qty: Number(l.qty) })), adjustments }
}

function costOf(recipe: Recipe, supplies: Record<string, RecipeSupply>, optionIds: string[] = []): ConsumptionCost {
  return consumptionCost(lineConsumption(recipe, optionIds, 1, supplies))
}

function toSupply(id: string, x: Record<string, unknown>): RecipeSupply {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    id,
    name: String(x.name ?? id),
    unit: String(x.unit ?? ''),
    recipeUnit: typeof x.recipeUnit === 'string' && x.recipeUnit.trim() ? x.recipeUnit : null,
    recipeUnitsPerPurchaseUnit: n(x.recipeUnitsPerPurchaseUnit),
    yieldPercent: n(x.yieldPercent),
    avgUnitCost: n(x.avgUnitCost),
  }
}

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
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

const inp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
  color: 'var(--offwhite)', borderRadius: '4px', padding: '0.5rem 0.65rem',
  fontSize: '0.82rem', outline: 'none', width: '100%', boxSizing: 'border-box',
  fontFamily: 'var(--font-inter)',
}
const sel: React.CSSProperties = { ...inp, background: '#1c1c1c', cursor: 'pointer' }
const lbl: React.CSSProperties = {
  display: 'block', fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase',
  color: 'rgba(var(--offwhite-rgb),0.4)', marginBottom: '0.3rem', fontFamily: 'var(--font-inter)',
}
const muted: React.CSSProperties = { fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.4)', fontFamily: 'var(--font-inter)' }
const optionStyle: React.CSSProperties = { background: '#1c1c1c', color: 'var(--offwhite)' }

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/** Cost, margin and cost share for one dish — or why there are none. Module scope: see CONTRIBUTING gotcha #2. */
function CostSummary({ price, cost, vatRate, target, supplies, align = 'left' }: {
  price: number
  cost: ConsumptionCost | null
  vatRate: number
  /** The target margin for this dish's station, or null for a section with none. */
  target: number | null
  supplies: Record<string, RecipeSupply>
  align?: 'left' | 'right'
}) {
  if (!cost) return <span style={{ ...muted, textAlign: align }}>No recipe</span>
  if (cost.reason === 'empty') return <span style={{ ...muted, textAlign: align }}>No ingredients yet</span>
  if (cost.costUsd === null) {
    const names = cost.missing.map(id => supplies[id]?.name ?? id).join(', ')
    return (
      <span style={{ fontSize: '0.72rem', color: 'var(--brand-secondary)', fontFamily: 'var(--font-inter)', textAlign: align }}>
        Cost unknown — {names}
      </span>
    )
  }
  const m = dishMargin(price, cost.costUsd, vatRate)
  const s = target === null ? null : suggestedPrice(cost.costUsd, target, vatRate)
  // Below the target only when the price is under what the margin needs, not
  // under the rounded-up figure: $4.52 makes 70% even if the suggestion reads $4.75.
  const below = s !== null && price < s.withVatUsd
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', fontFamily: 'var(--font-inter)' }}>
      <span style={{ fontSize: '0.82rem', color: 'var(--offwhite)' }}>
        {formatUsd(cost.costUsd)} to make
        {m.costPercent !== null && <span style={{ color: 'rgba(var(--offwhite-rgb),0.5)' }}> · {pct(m.costPercent)}</span>}
      </span>
      {m.marginUsd !== null && (
        <span style={{ fontSize: '0.7rem', color: m.marginUsd >= 0 ? 'var(--teal)' : 'var(--red)' }}>
          {formatUsd(m.marginUsd)} margin on {formatUsd(m.priceExVatUsd)} before VAT
        </span>
      )}
      {s && target !== null && (
        <span style={{ fontSize: '0.7rem', color: below ? 'var(--brand-secondary)' : 'rgba(var(--offwhite-rgb),0.45)' }}>
          Suggested {formatUsd(s.roundedUsd)} for a {pct(target)} margin{below ? ' — priced below it' : ''}
        </span>
      )}
    </span>
  )
}

function SupplySelect({ value, onChange, supplies, only, placeholder }: {
  value: string
  onChange: (id: string) => void
  supplies: RecipeSupply[]
  only?: string[]
  placeholder: string
}) {
  const list = only ? supplies.filter(s => only.includes(s.id)) : supplies
  return (
    <select style={sel} value={value} onChange={e => onChange(e.target.value)}>
      <option value="" style={optionStyle}>{placeholder}</option>
      {list.map(s => (
        <option key={s.id} value={s.id} style={optionStyle}>
          {s.name} ({s.recipeUnit || s.unit})
        </option>
      ))}
    </select>
  )
}

function RecipeEditor({
  item, groups, supplies, supplyList, draft, onChange, vatRate, target,
  saving, error, hasSaved, onSave, onDelete, onClose, isMobile,
}: {
  item: MenuItemDoc
  groups: GroupDoc[]
  supplies: Record<string, RecipeSupply>
  supplyList: RecipeSupply[]
  draft: Draft
  onChange: (next: Draft) => void
  vatRate: number
  target: number | null
  saving: boolean
  error: string
  hasSaved: boolean
  onSave: () => void
  onDelete: () => void
  onClose: () => void
  isMobile: boolean
}) {
  const recipe = toRecipe(draft)
  const problems = recipeProblems(recipe, supplies)
  const base = costOf(recipe, supplies)
  const usedSupplyIds = [...new Set(draft.lines.map(l => l.supplyId).filter(Boolean))]

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    onChange({ ...draft, lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const setAdjustment = (optionId: string, patch: Partial<DraftAdjustment>) =>
    onChange({
      ...draft,
      adjustments: { ...draft.adjustments, [optionId]: { ...(draft.adjustments[optionId] ?? NO_ADJUSTMENT), ...patch } },
    })

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '0.5rem' : '2rem',
    }}>
      <div style={{
        background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
        width: '100%', maxWidth: '760px', maxHeight: '92vh', overflowY: 'auto',
        padding: isMobile ? '1.25rem' : '2rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)' }}>{item.name}</h2>
            <p style={muted}>Sells for {formatUsd(item.price)}, VAT included</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(var(--offwhite-rgb),0.4)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        </div>

        {/* ── Ingredients ─────────────────────────────────────────────── */}
        <p style={{ ...lbl, marginBottom: '0.6rem' }}>Ingredients — as used in one serving, after trim</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {draft.lines.length === 0 && <p style={muted}>No ingredients yet.</p>}
          {draft.lines.map((line, i) => {
            const supply = supplies[line.supplyId]
            const n = Number(line.qty)
            const both = supply && line.qty !== '' && Number.isFinite(n) && n > 0 ? describeQty(n, supply) : ''
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 140px auto', gap: '0.5rem', alignItems: 'start' }}>
                <SupplySelect value={line.supplyId} onChange={id => setLine(i, { supplyId: id })}
                  supplies={supplyList} placeholder="Choose an ingredient" />
                <div>
                  <input style={inp} type="number" min={0} step="any" value={line.qty}
                    placeholder={supply ? (supply.recipeUnit || supply.unit) : 'Quantity'}
                    onChange={e => setLine(i, { qty: e.target.value })} />
                  {both && <p style={{ ...muted, marginTop: '0.2rem' }}>{both}</p>}
                </div>
                <button type="button" onClick={() => onChange({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}
                  style={{ background: 'transparent', border: '1px solid rgba(var(--red-rgb),0.3)', color: 'var(--red)', borderRadius: '4px', padding: '0.45rem 0.7rem', cursor: 'pointer', fontSize: '0.75rem' }}>
                  Remove
                </button>
              </div>
            )
          })}
          <button type="button" onClick={() => onChange({ ...draft, lines: [...draft.lines, { supplyId: '', qty: '' }] })}
            style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid rgba(var(--teal-rgb),0.4)', color: 'var(--teal)', borderRadius: '4px', padding: '0.45rem 0.9rem', cursor: 'pointer', fontSize: '0.75rem' }}>
            + Add ingredient
          </button>
        </div>

        {/* ── Options ─────────────────────────────────────────────────── */}
        {groups.length > 0 && (
          <div style={{ marginTop: '1.75rem' }}>
            <p style={{ ...lbl, marginBottom: '0.3rem' }}>Options</p>
            <p style={{ ...muted, marginBottom: '0.8rem' }}>
              An option can add an ingredient or replace one. Additions count first, so a replacement covers
              every portion — an extra shot in a decaf is decaf.
            </p>
            {groups.map(group => (
              <div key={group.id} style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.78rem', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', marginBottom: '0.4rem' }}>{group.name}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {group.options.map(option => {
                    const a = draft.adjustments[option.id] ?? NO_ADJUSTMENT
                    const withOption = costOf(recipe, supplies, [option.id])
                    const delta = a.kind !== 'none' && base.costUsd !== null && withOption.costUsd !== null
                      ? withOption.costUsd - base.costUsd
                      : null
                    return (
                      <div key={option.id} style={{
                        display: 'grid', gap: '0.5rem', alignItems: 'start',
                        gridTemplateColumns: isMobile ? '1fr' : '140px 120px 1fr',
                        padding: '0.5rem', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px',
                      }}>
                        <span style={{ fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.75)', fontFamily: 'var(--font-inter)', paddingTop: '0.45rem' }}>
                          {option.name}
                        </span>
                        <select style={sel} value={a.kind} onChange={e => setAdjustment(option.id, { kind: e.target.value as DraftAdjustment['kind'] })}>
                          <option value="none" style={optionStyle}>No change</option>
                          <option value="add" style={optionStyle}>Adds</option>
                          <option value="replace" style={optionStyle}>Replaces</option>
                        </select>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {a.kind === 'add' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '0.4rem' }}>
                              <SupplySelect value={a.supplyId} onChange={id => setAdjustment(option.id, { supplyId: id })}
                                supplies={supplyList} placeholder="Ingredient" />
                              <input style={inp} type="number" min={0} step="any" value={a.qty}
                                placeholder={supplies[a.supplyId] ? (supplies[a.supplyId].recipeUnit || supplies[a.supplyId].unit) : 'Qty'}
                                onChange={e => setAdjustment(option.id, { qty: e.target.value })} />
                            </div>
                          )}
                          {a.kind === 'replace' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                              <SupplySelect value={a.fromSupplyId} onChange={id => setAdjustment(option.id, { fromSupplyId: id })}
                                supplies={supplyList} only={usedSupplyIds} placeholder="This ingredient…" />
                              <SupplySelect value={a.toSupplyId} onChange={id => setAdjustment(option.id, { toSupplyId: id })}
                                supplies={supplyList} placeholder="…with this" />
                            </div>
                          )}
                          {delta !== null && (
                            <span style={muted}>
                              {delta === 0 ? 'Costs the same' : `${delta > 0 ? '+' : '−'}${formatUsd(Math.abs(delta))} to make`}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Cost and what stops a save ──────────────────────────────── */}
        <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px' }}>
          <p style={{ ...lbl, marginBottom: '0.4rem' }}>As written, without options</p>
          <CostSummary price={item.price} cost={base} vatRate={vatRate} target={target} supplies={supplies} />
        </div>

        {problems.length > 0 && (
          <ul style={{ marginTop: '1rem', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {problems.map(p => (
              <li key={p} style={{ fontSize: '0.75rem', color: 'var(--brand-secondary)', fontFamily: 'var(--font-inter)' }}>{p}</li>
            ))}
          </ul>
        )}
        {error && <p style={{ marginTop: '0.8rem', fontSize: '0.78rem', color: 'var(--red)', fontFamily: 'var(--font-inter)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
          <button onClick={onSave} disabled={saving || problems.length > 0} style={{
            flex: 1, minWidth: '140px', background: 'var(--teal)', color: '#000', border: 'none', borderRadius: '4px',
            padding: '0.7rem', fontSize: '0.85rem', fontWeight: 700,
            cursor: saving || problems.length > 0 ? 'not-allowed' : 'pointer',
            opacity: saving || problems.length > 0 ? 0.5 : 1,
          }}>
            {saving ? 'Saving…' : 'Save recipe'}
          </button>
          {hasSaved && (
            <button onClick={onDelete} disabled={saving} style={{
              background: 'transparent', color: 'var(--red)', border: '1px solid rgba(var(--red-rgb),0.35)',
              borderRadius: '4px', padding: '0.7rem 1rem', fontSize: '0.85rem', cursor: 'pointer',
            }}>
              Delete recipe
            </button>
          )}
          <button onClick={onClose} style={{
            background: 'transparent', color: 'rgba(var(--offwhite-rgb),0.5)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '4px', padding: '0.7rem 1rem', fontSize: '0.85rem', cursor: 'pointer',
          }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RecipesPage() {
  const { checking } = useRequireRole(ADMIN_ONLY)
  const isMobile = useIsMobile()
  // Today's rate in the café's zone, read the way receiving reads it — so a
  // scheduled VAT change moves every margin at midnight together.
  const { settings } = useBusinessSettings()
  const vatRate = vatRateOn(settings, todayYmd(BRAND.locale.timezone))

  const [items, setItems]           = useState<MenuItemDoc[]>([])
  const [categories, setCategories] = useState<CategoryDoc[]>([])
  const [groups, setGroups]         = useState<Record<string, GroupDoc>>({})
  const [supplies, setSupplies]     = useState<Record<string, RecipeSupply>>({})
  const [recipes, setRecipes]       = useState<Record<string, Recipe>>({})
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState('')
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [draft, setDraft]           = useState<Draft>({ lines: [], adjustments: {} })
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState('')

  useEffect(() => {
    if (checking) return
    let alive = true
    void (async () => {
      try {
        const [itemSnap, categorySnap, groupSnap, supplySnap, recipeData] = await Promise.all([
          getDocs(collection(db, 'menuItems')),
          getDocs(collection(db, 'menuCategories')),
          getDocs(collection(db, 'modifierGroups')),
          getDocs(collection(db, 'supplies')),
          authedFetch('/api/admin/recipes', 'GET').then(res => unwrap(res)),
        ])
        if (!alive) return

        setItems(itemSnap.docs.map(d => {
          const x = d.data() as Record<string, unknown>
          return {
            id: d.id,
            name: String(x.name ?? ''),
            price: Number(x.price ?? 0),
            categoryId: String(x.categoryId ?? ''),
            order: Number(x.order ?? 0),
            modifierGroupIds: Array.isArray(x.modifierGroupIds) ? (x.modifierGroupIds as unknown[]).map(String) : [],
          }
        }))
        setCategories(categorySnap.docs.map(d => {
          const x = d.data() as Record<string, unknown>
          return { id: d.id, name: String(x.name ?? ''), order: Number(x.order ?? 0), section: String(x.section ?? '') }
        }))
        setGroups(Object.fromEntries(groupSnap.docs.map(d => {
          const x = d.data() as Record<string, unknown>
          const options = Array.isArray(x.options) ? (x.options as { id?: unknown; name?: unknown }[]) : []
          return [d.id, {
            id: d.id,
            name: String(x.name ?? ''),
            options: options.filter(o => typeof o.id === 'string').map(o => ({ id: String(o.id), name: String(o.name ?? '') })),
          }]
        })))
        setSupplies(Object.fromEntries(supplySnap.docs.map(d => [d.id, toSupply(d.id, d.data() as Record<string, unknown>)])))
        const list = ((recipeData as { recipes?: (Recipe & { menuItemId: string })[] }).recipes ?? [])
        setRecipes(Object.fromEntries(list.map(r => [r.menuItemId, { lines: r.lines, adjustments: r.adjustments }])))
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : 'Could not load recipes.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [checking])

  const supplyList = useMemo(
    () => Object.values(supplies).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [supplies],
  )

  const sections = useMemo(() => {
    const byCategory = new Map<string, MenuItemDoc[]>()
    for (const item of items) {
      const list = byCategory.get(item.categoryId) ?? []
      list.push(item)
      byCategory.set(item.categoryId, list)
    }
    const known = [...categories].sort((a, b) => a.order - b.order)
      .filter(c => byCategory.has(c.id))
      .map(c => ({ id: c.id, name: c.name, items: byCategory.get(c.id)! }))
    const orphans = items.filter(i => !categories.some(c => c.id === i.categoryId))
    const all = orphans.length ? [...known, { id: '', name: 'Uncategorised', items: orphans }] : known
    return all.map(s => ({ ...s, items: [...s.items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)) }))
  }, [items, categories])

  // Food or drink by the station the dish's section sends it to — the split
  // the staff discount already makes — so coffee is held to the drinks margin.
  const targetOf = (item: MenuItemDoc) => targetMarginFor(
    stationForSection(categories.find(c => c.id === item.categoryId)?.section),
    { food: settings.targetMarginFood, drink: settings.targetMarginDrink },
  )

  const costed = items.filter(i => {
    const r = recipes[i.id]
    return r ? costOf(r, supplies).costUsd !== null : false
  }).length
  const withRecipe = items.filter(i => recipes[i.id]).length

  const editingItem = editingId ? items.find(i => i.id === editingId) ?? null : null

  function openEditor(item: MenuItemDoc) {
    setEditingId(item.id)
    setDraft(toDraft(recipes[item.id]))
    setSaveError('')
  }

  async function save() {
    if (!editingId) return
    setSaving(true)
    setSaveError('')
    try {
      const recipe = toRecipe(draft)
      await unwrap(await authedFetch('/api/admin/recipes', 'PUT', { menuItemId: editingId, ...recipe }))
      setRecipes(r => ({ ...r, [editingId]: recipe }))
      setEditingId(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the recipe.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editingId || !confirm('Delete this recipe? The menu item itself is not affected.')) return
    setSaving(true)
    setSaveError('')
    try {
      await unwrap(await authedFetch(`/api/admin/recipes?menuItemId=${encodeURIComponent(editingId)}`, 'DELETE'))
      setRecipes(r => {
        const next = { ...r }
        delete next[editingId]
        return next
      })
      setEditingId(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not delete the recipe.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  return (
    <div style={{ padding: isMobile ? '1.25rem' : '2rem 2.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.9rem', color: 'var(--offwhite)' }}>
        Recipes & Costing
      </h1>
      <p style={{ ...muted, fontSize: '0.8rem', marginTop: '0.4rem', maxWidth: '680px', lineHeight: 1.6 }}>
        What each dish is made of and what it costs to make, from the average price paid for each ingredient.
        Margin is on the price before VAT. Nothing here changes stock.
      </p>

      {!loading && !loadError && (
        <p style={{ ...muted, marginTop: '0.8rem' }}>
          {withRecipe} of {items.length} items have a recipe · {costed} fully costed
        </p>
      )}

      {loading && <p style={{ ...muted, marginTop: '2rem' }}>Loading…</p>}
      {loadError && <p style={{ marginTop: '2rem', fontSize: '0.85rem', color: 'var(--red)', fontFamily: 'var(--font-inter)' }}>{loadError}</p>}

      {!loading && !loadError && sections.map(section => (
        <div key={section.id || 'uncategorised'} style={{ marginTop: '2rem' }}>
          <p style={{ ...lbl, marginBottom: '0.6rem' }}>{section.name}</p>
          <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: '6px', overflow: 'hidden' }}>
            {section.items.map((item, i) => {
              const recipe = recipes[item.id]
              return (
                <div key={item.id} style={{
                  display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '0.5rem' : '1rem',
                  alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between',
                  padding: '0.8rem 1rem', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '0.88rem', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)' }}>{item.name}</p>
                    <p style={muted}>{formatUsd(item.price)}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
                    <CostSummary price={item.price} cost={recipe ? costOf(recipe, supplies) : null}
                      vatRate={vatRate} target={targetOf(item)} supplies={supplies} align={isMobile ? 'left' : 'right'} />
                    <button onClick={() => openEditor(item)} style={{
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--offwhite)',
                      borderRadius: '4px', padding: '0.45rem 0.9rem', fontSize: '0.75rem', cursor: 'pointer', flexShrink: 0,
                    }}>
                      {recipe ? 'Edit recipe' : 'Add recipe'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {editingItem && (
        <RecipeEditor
          item={editingItem}
          groups={editingItem.modifierGroupIds.map(id => groups[id]).filter((g): g is GroupDoc => Boolean(g))}
          supplies={supplies}
          supplyList={supplyList}
          draft={draft}
          onChange={setDraft}
          vatRate={vatRate}
          target={targetOf(editingItem)}
          saving={saving}
          error={saveError}
          hasSaved={Boolean(recipes[editingItem.id])}
          onSave={save}
          onDelete={remove}
          onClose={() => setEditingId(null)}
          isMobile={isMobile}
        />
      )}
    </div>
  )
}
