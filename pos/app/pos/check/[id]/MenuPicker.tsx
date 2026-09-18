'use client'

// The order screen's menu: category tiles, item tiles and the options sheet for
// a dish. Moved out of page.tsx unchanged (UPGRADE.md T2.13), which had grown to
// 1,400 lines holding the menu, the check, the options and every sheet.
// Module-scope components only (CONTRIBUTING.md gotcha #2).

import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faPlus, faSliders, faXmark, faUtensils, faBagShopping, faCheck,
  faTriangleExclamation, faWheatAwnCircleExclamation, faBan, type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { categoryImage } from '@big-cms/shared/menuCategoryImages'
import { validateSelection, selectionLabel, type ModifierGroup } from '@big-cms/shared/modifiers'
import { type PosMenuItem, type PosProduct } from '../../../lib/usePos'
import { PosButton, SectionLabel, kindColour, Sheet } from '../../../lib/posUi'
import { readDishAllergens, type ChartDish, type DishAnswer } from '../../../lib/useAllergens'
import { AllergenAnswer } from '../../../lib/allergenView'

const money = (n: number) => `$${n.toFixed(2)}`
const sheetTitle: React.CSSProperties = {
  fontFamily: 'var(--font-cinzel)', fontSize: '1.35rem', color: 'var(--offwhite)',
}

export function ModifierSheet({
  item, groups, onCancel, onAdd, allergens,
}: {
  item: PosMenuItem
  groups: ModifierGroup[]
  onCancel: () => void
  /** With the unit price the options come to, so an unsent line shows it (UPGRADE.md T2.11). */
  onAdd: (optionIds: string[], label: string, unitPrice: number) => void
  /** Show what the dish contains as chosen — asked of the server on every change. */
  allergens: boolean
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({})

  function toggle(group: ModifierGroup, optionId: string) {
    setChosen(prev => {
      const current = prev[group.id] ?? []
      const has = current.includes(optionId)
      // A max of one behaves like a radio: tapping another replaces it rather
      // than failing validation afterwards and making the waiter work it out.
      if (!has && group.maxSelections === 1) return { ...prev, [group.id]: [optionId] }
      return {
        ...prev,
        [group.id]: has ? current.filter(id => id !== optionId) : [...current, optionId],
      }
    })
  }

  // The same rule the server enforces, so Add is greyed for exactly the
  // reasons a request would be refused.
  const problem = groups
    .map(g => validateSelection(g, chosen[g.id] ?? []))
    .find(Boolean) ?? null

  const allIds = groups.flatMap(g => chosen[g.id] ?? [])
  const label = groups
    .flatMap(g => (chosen[g.id] ?? []).map(id => g.options.find(o => o.id === id)?.name ?? ''))
    .filter(Boolean).join(', ')
  const extra = groups.reduce((sum, g) =>
    sum + (chosen[g.id] ?? []).reduce((s, id) =>
      s + (g.options.find(o => o.id === id)?.priceDelta ?? 0), 0), 0)

  // Asked of the server for the WHOLE choice, each time it changes. Options do
  // not add up: oat milk takes milk out, extra cream adds nothing on its own,
  // and together the drink still has milk in it. So the chart's per-option
  // lines are never combined on this screen.
  const selectionKey = [...allIds].sort().join('|')
  const [answer, setAnswer] = useState<{ key: string; dish: DishAnswer | null; error: string } | null>(null)
  useEffect(() => {
    if (!allergens) return
    let live = true
    readDishAllergens(item.id, selectionKey ? selectionKey.split('|') : [])
      .then(dish => { if (live) setAnswer({ key: selectionKey, dish, error: '' }) })
      .catch(e => { if (live) setAnswer({ key: selectionKey, dish: null, error: e instanceof Error ? e.message : 'Could not check allergens.' }) })
    return () => { live = false }
  }, [allergens, item.id, selectionKey])
  // An answer for a choice that has since changed is never shown, not even for a moment.
  const current = answer && answer.key === selectionKey ? answer : null

  return (
    <Sheet label="Options" onClose={onCancel} backdropCloses={false}>
      <h2 style={{ ...sheetTitle, marginBottom: '0.2rem' }}>{item.name}</h2>
      <p style={{ fontSize: '0.9rem', color: 'rgba(var(--offwhite-rgb),0.5)', marginBottom: '0.6rem' }}>{money(item.price)}</p>

      {allergens && (
        <div style={{
          margin: '0.2rem 0 0.4rem', padding: '0.75rem 0.9rem', borderRadius: '10px',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)',
        }}>
          <p style={{
            display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.5rem',
            fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)',
          }}>
            <FontAwesomeIcon icon={faWheatAwnCircleExclamation} />
            {allIds.length > 0 ? 'Allergens with these options' : 'Allergens'}
          </p>
          {current?.dish ? (
            <>
              <AllergenAnswer size="md" verified={current.dish.verified} contains={current.dish.contains} others={current.dish.others} />
              {current.dish.reasons.map(r => (
                <p key={r} style={{ fontSize: '0.88rem', color: 'var(--red)', marginTop: '0.4rem', lineHeight: 1.45 }}>{r}</p>
              ))}
            </>
          ) : current?.error ? (
            <p style={{ fontSize: '0.92rem', color: 'var(--red)', lineHeight: 1.5 }}>
              <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />
              {current.error} Ask the kitchen — do not guess.
            </p>
          ) : (
            <p style={{ fontSize: '0.92rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>Checking…</p>
          )}
        </div>
      )}

      {groups.map(g => (
        <div key={g.id}>
          <SectionLabel icon={faSliders}>{g.name} · {selectionLabel(g)}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
            {g.options.map(o => {
              const on = (chosen[g.id] ?? []).includes(o.id)
              return (
                <button key={o.id} type="button" onClick={() => toggle(g, o.id)} aria-pressed={on} style={{
                  minHeight: '60px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                  padding: '0.6rem 0.9rem', fontFamily: 'var(--font-inter)', fontSize: '1rem',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem',
                  backgroundColor: on ? 'rgba(var(--teal-rgb),0.22)' : 'rgba(255,255,255,0.04)',
                  border: `2px solid ${on ? 'var(--teal)' : 'rgba(255,255,255,0.14)'}`,
                  color: 'var(--offwhite)', fontWeight: on ? 700 : 500,
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                    {on && <FontAwesomeIcon icon={faCheck} style={{ color: 'var(--teal)' }} />}
                    {o.name}
                  </span>
                  {o.priceDelta > 0 && (
                    <span style={{ color: 'rgba(var(--offwhite-rgb),0.6)', fontSize: '0.9rem' }}>+{money(o.priceDelta)}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {problem && (
        <p style={{ color: 'var(--brand-secondary)', fontSize: '0.92rem', margin: '1rem 0 0' }}>
          <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />{problem}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
        <PosButton icon={faXmark} label="Cancel" tone="quiet" grow={1} onClick={onCancel} />
        <PosButton icon={faPlus} label={`Add ${money(item.price + extra)}`} tone="primary" size="lg" grow={2}
          disabled={Boolean(problem)} onClick={() => onAdd(allIds, label, item.price + extra)} />
      </div>
    </Sheet>
  )
}

/**
 * A category as a big picture tile, the menu's first screen.
 *
 * Module scope, like every component here (CONTRIBUTING.md gotcha #2).
 */
function CategoryTile({ name, image, colour, count, icon, onClick }: {
  name: string
  image: string
  colour: string
  count: number
  icon?: IconDefinition
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} style={{
      position: 'relative', minHeight: '150px', borderRadius: '14px', overflow: 'hidden', cursor: 'pointer',
      padding: 0, border: `2px solid ${colour}`, background: `color-mix(in srgb, ${colour} 18%, #111)`,
      display: 'flex', alignItems: 'flex-end', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
    }}>
      {image
        ? <TileImage src={image} fallback={icon ? <FontAwesomeIcon icon={icon} style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '2.2rem', color: colour }} /> : null} />
        : icon && <FontAwesomeIcon icon={icon} style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '2.2rem', color: colour }} />}
      <span style={{
        position: 'relative', width: '100%', padding: '2rem 0.9rem 0.8rem',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.88))',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '0.5rem',
      }}>
        <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.35rem', color: '#fff', lineHeight: 1.1 }}>{name}</span>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap' }}>
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </span>
    </button>
  )
}

/**
 * A tile's picture, or its fallback when the picture cannot load. Pictures live
 * on the internet (imgbb, the media library), so on a café hub with the line
 * down every one of them fails, and a broken-image box on every tile reads as a
 * broken till (UPGRADE.md T1.6). Module scope.
 */
function TileImage({ src, fallback }: { src: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === src) return <>{fallback}</>
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(src)}
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
}

/** A dish's first letter, where its picture would be. Module scope. */
function TileLetter({ name, colour }: { name: string; colour: string }) {
  return (
    <span style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-cinzel)', fontSize: '2.4rem', color: colour,
    }}>{name.slice(0, 1)}</span>
  )
}

/** One thing to tap, with its picture, or its first letter when it has none. Module scope. */
function ItemTile({ name, image, colour, locked, onClick, children, soldOut = false, marking = false }: {
  name: string
  image: string
  colour: string
  locked: boolean
  onClick: () => void
  children: React.ReactNode
  /** Sold out at this branch today (T3.5): greyed and not tappable, unless a manager is marking. */
  soldOut?: boolean
  marking?: boolean
}) {
  const off = marking ? false : locked || soldOut
  return (
    <button type="button" onClick={() => !off && onClick()} disabled={off}
      aria-label={soldOut ? `${name}, sold out today${marking ? ': tap to put it back on' : ''}` : marking ? `${name}: tap to mark sold out` : undefined}
      style={{
      borderRadius: '12px', overflow: 'hidden', cursor: off ? 'not-allowed' : 'pointer', textAlign: 'left', padding: 0,
      backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)',
      // Longhands only: a shorthand beside borderTop that changes between renders is a React styling bug.
      borderWidth: marking ? '4px 2px 2px' : '4px 1px 1px', borderStyle: marking ? 'solid dashed dashed' : 'solid',
      borderColor: `${soldOut ? 'var(--red)' : colour} ${marking ? 'var(--red)' : 'rgba(255,255,255,0.12)'} ${marking ? 'var(--red)' : 'rgba(255,255,255,0.12)'}`,
      display: 'flex', flexDirection: 'column', opacity: off ? 0.45 : 1, WebkitTapHighlightColor: 'transparent',
      position: 'relative',
    }}>
      {soldOut && (
        <span style={{
          position: 'absolute', top: '0.5rem', left: '0.5rem', zIndex: 1, background: 'var(--red)', color: '#fff',
          fontSize: '0.75rem', fontWeight: 700, borderRadius: '999px', padding: '0.2rem 0.6rem',
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        }}><FontAwesomeIcon icon={faBan} /> Sold out today</span>
      )}
      <span style={{
        position: 'relative', display: 'block', width: '100%', aspectRatio: '4 / 3',
        background: `color-mix(in srgb, ${colour} 16%, #151515)`,
      }}>
        {image
          ? <TileImage src={image} fallback={<TileLetter name={name} colour={colour} />} />
          : <TileLetter name={name} colour={colour} />}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', padding: '0.6rem 0.75rem 0.7rem' }}>
        <span style={{ fontSize: '1.02rem', fontWeight: 600, lineHeight: 1.25 }}>{name}</span>
        {children}
      </span>
    </button>
  )
}

/**
 * The menu as screens (owner's request, 14 Sep 2026). First the categories as
 * big picture tiles; tapping one opens a screen of that category's items, with
 * a way back. Seats and courses left ordering in the same request, so a line is
 * for the table. The same picker in the sheet on a phone and open beside the
 * check on a wide screen.
 */
export function MenuPicker({
  categories, counts, activeCategory, onCategory,
  items, products, hasOptions, onPick, onProduct, locked, columns,
  allergenMap, allergenControl, allergenNote,
  isSoldOut = () => false, marking = false, onMark,
}: {
  categories: { id: string; name: string; image: string }[]
  /** Available items per category, for the tiles. */
  counts: Map<string, number>
  /** '' is the category screen; a category id, or 'retail', is its items. */
  activeCategory: string
  onCategory: (id: string) => void
  items: PosMenuItem[]
  products: PosProduct[]
  hasOptions: (item: PosMenuItem) => boolean
  onPick: (item: PosMenuItem) => void
  onProduct: (p: PosProduct) => void
  locked: boolean
  columns: number
  /** Present only while allergens are shown and the chart has loaded. */
  allergenMap: Map<string, ChartDish> | null
  allergenControl: React.ReactNode
  allergenNote: React.ReactNode
  /** Sold out at this check's branch today (UPGRADE.md T3.5). */
  isSoldOut?: (item: PosMenuItem) => boolean
  /** A manager marking dishes: a tap marks the dish sold out, or back on, instead of adding it. */
  marking?: boolean
  onMark?: (item: PosMenuItem) => void
}) {
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '0.7rem' }
  const empty = (text: string) => (
    <p style={{ color: 'rgba(var(--offwhite-rgb),0.45)', fontSize: '0.95rem', gridColumn: '1 / -1' }}>{text}</p>
  )

  if (!activeCategory) {
    return (
      <div>
        <SectionLabel icon={faUtensils} right={allergenControl}>Menu</SectionLabel>
        {allergenNote}
        <div style={grid}>
          {categories.map((c, i) => (
            <CategoryTile key={c.id} name={c.name} image={categoryImage(c.name, c.image)} colour={kindColour(i)}
              count={counts.get(c.id) ?? 0} onClick={() => onCategory(c.id)} />
          ))}
          {/* The differentiator, one tile along from the coffee. */}
          <CategoryTile name="Retail" image="" icon={faBagShopping} colour="var(--brand-secondary)"
            count={products.length} onClick={() => onCategory('retail')} />
        </div>
      </div>
    )
  }

  const retail = activeCategory === 'retail'
  const index = categories.findIndex(c => c.id === activeCategory)
  const colour = retail ? 'var(--brand-secondary)' : kindColour(Math.max(index, 0))
  const title = retail ? 'Retail' : (categories[index]?.name ?? '')

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap',
        margin: '0.9rem 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          <PosButton icon={faArrowLeft} label="Categories" tone="neutral" size="sm" onClick={() => onCategory('')} />
          <h3 style={{
            fontFamily: 'var(--font-cinzel)', fontSize: '1.5rem', color: 'var(--offwhite)', lineHeight: 1.1,
            borderLeft: `5px solid ${colour}`, paddingLeft: '0.6rem',
          }}>{title}</h3>
        </div>
        {allergenControl}
      </div>
      {allergenNote}

      {retail ? (
        <div style={grid}>
          {products.map(p => (
            <ItemTile key={p.id} name={p.name} image={p.image} colour={colour} locked={locked} onClick={() => onProduct(p)}>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1rem', fontWeight: 700 }}>
                  {money(p.price)}{p.onSale && <span style={{ color: 'var(--brand-secondary)', fontSize: '0.8rem', marginLeft: '0.35rem' }}>on sale</span>}
                </span>
                {/* Shown, never enforced. A till must not refuse a sale
                    because a count is stale — the customer is holding the
                    thing. Negative is a discrepancy to reconcile, not a
                    reason to turn somebody away. */}
                <span style={{ fontSize: '0.8rem', color: p.stock > 0 ? 'rgba(var(--offwhite-rgb),0.55)' : 'var(--red)' }}>
                  {p.stock} in stock
                </span>
              </span>
            </ItemTile>
          ))}
          {products.length === 0 && empty('Nothing in the retail catalogue yet.')}
        </div>
      ) : (
        <div style={grid}>
          {items.map(i => (
            <ItemTile key={i.id} name={i.name} image={i.image} colour={colour} locked={locked}
              soldOut={isSoldOut(i)} marking={marking && Boolean(onMark)}
              onClick={() => (marking && onMark ? onMark(i) : onPick(i))}>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '1rem', fontWeight: 700 }}>{money(i.price)}</span>
                {hasOptions(i) && (
                  <span style={{ fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.6)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <FontAwesomeIcon icon={faSliders} /> options
                  </span>
                )}
              </span>
              {/* A dish missing from the chart reads as not verified, never as clean. */}
              {allergenMap && (
                <AllergenAnswer
                  verified={allergenMap.get(i.id)?.verified ?? false}
                  contains={allergenMap.get(i.id)?.contains ?? []}
                  others={allergenMap.get(i.id)?.others ?? []}
                />
              )}
            </ItemTile>
          ))}
          {items.length === 0 && empty('Nothing available in this category.')}
        </div>
      )}
    </div>
  )
}
