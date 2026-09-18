'use client'

// The allergen chart on the till (food safety, slice 7). For the moment a
// customer says "I can't have nuts" — which is a question asked of whoever is
// holding the till, not of whoever can open the admin panel.
//
// Two ways in: search a dish, or pick what the customer is allergic to and see
// the menu in three piles — free of it, can't be sure, contains it. "Can't be
// sure" is its own pile on purpose: an unverified dish that does not list nuts
// has not been shown to be free of them (allergenVerdict(), verify:food-safety).
//
// Built on the server from recipes, without quantities or costs. Controls from
// pos/app/lib/posUi.tsx.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faTriangleExclamation, faChevronDown, faChevronUp, faWheatAwnCircleExclamation,
  faRotateLeft, faCircleCheck, faCircleQuestion, faBan, faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useTillAccess } from '../../lib/useTillAccess'
import { useFeature } from '../../lib/useTillSettings'
import { ALLERGENS_EU14 } from '@big-cms/shared/foodSafety'
import { allergenVerdict } from '@big-cms/shared/allergens'
import { PosButton, Chip, SectionLabel, StatusBadge } from '../../lib/posUi'
import { useAllergenChart, type ChartDish } from '../../lib/useAllergens'
import { AllergenAnswer, allergenName } from '../../lib/allergenView'

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

const muted = 'rgba(var(--offwhite-rgb),0.6)'

/** One dish. Module scope — CONTRIBUTING.md gotcha #2. */
function DishRow({ dish, open, onToggle, isMobile }: {
  dish: ChartDish
  open: boolean
  onToggle: () => void
  isMobile: boolean
}) {
  return (
    <div style={{
      borderRadius: '12px', marginBottom: '0.5rem',
      background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.1)',
    }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{
        all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%', minHeight: '68px',
        padding: '0.8rem 1rem', display: 'grid', alignItems: 'center', gap: '0.5rem 1rem',
        gridTemplateColumns: isMobile ? '1fr auto' : 'minmax(12rem, 16rem) 1fr auto',
        WebkitTapHighlightColor: 'transparent',
      }}>
        <span>
          <span style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '1.08rem', fontWeight: 600, color: 'var(--offwhite)' }}>{dish.name}</span>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: muted }}>
            {dish.category}{dish.available ? '' : ' · not on sale'}
          </span>
        </span>
        {!isMobile && <AllergenAnswer size="md" verified={dish.verified} contains={dish.contains} others={dish.others} />}
        <FontAwesomeIcon icon={open ? faChevronUp : faChevronDown} style={{ color: muted, fontSize: '1.05rem' }} />
        {isMobile && (
          <span style={{ gridColumn: '1 / -1' }}>
            <AllergenAnswer size="md" verified={dish.verified} contains={dish.contains} others={dish.others} />
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding: '0 1rem 1rem', fontFamily: 'var(--font-inter)', fontSize: '0.95rem', lineHeight: 1.55 }}>
          {dish.reasons.map(r => (
            <p key={r} style={{ color: 'var(--red)', marginBottom: '0.3rem' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.45rem' }} />{r}
            </p>
          ))}
          {dish.others.length > 0 && (
            <p style={{ color: muted, marginBottom: '0.3rem' }}>
              {dish.others.map(allergenName).join(', ')} {dish.others.length === 1 ? 'is' : 'are'} not on this café&apos;s tracked list, and still in it.
            </p>
          )}
          {dish.options.length > 0 && (
            <>
              <SectionLabel>Options that change it</SectionLabel>
              {dish.options.map(o => (
                <p key={o.optionId} style={{ color: 'var(--offwhite)', marginBottom: '0.3rem' }}>
                  <strong>{o.name}</strong> <span style={{ color: muted }}>({o.group})</span>
                  {o.adds.length > 0 && <span style={{ color: 'var(--brand-secondary)' }}> — adds {o.adds.map(allergenName).join(', ')}</span>}
                  {o.removes.length > 0 && <span style={{ color: muted }}> — takes out {o.removes.map(allergenName).join(', ')}</span>}
                  {!o.verified && <span style={{ color: 'var(--red)' }}> — not verified</span>}
                </p>
              ))}
              <p style={{ color: muted, fontSize: '0.85rem' }}>
                Each line is that option on its own. Two options together can differ — the order screen checks the whole choice.
              </p>
            </>
          )}
          {dish.verified && dish.confirmedByEmail && (
            <p style={{ color: muted, fontSize: '0.85rem', marginTop: '0.4rem' }}>Recipe confirmed complete by {dish.confirmedByEmail}.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function PosAllergensPage() {
  const { checking, blocked } = useTillAccess(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const { on: moduleOn, loading: flagsLoading } = useFeature('foodSafety')
  const isMobile = useIsMobile()
  const router = useRouter()

  const chart = useAllergenChart(!checking && !blocked && moduleOn)
  const [search, setSearch] = useState('')
  const [allergy, setAllergy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = chart.dishes ?? []
    return q ? all.filter(d => d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)) : all
  }, [chart.dishes, search])

  const piles = useMemo(() => {
    if (!allergy) return null
    const out = { free: [] as ChartDish[], unknown: [] as ChartDish[], contains: [] as ChartDish[] }
    for (const d of shown) out[allergenVerdict(d, allergy)].push(d)
    return out
  }, [shown, allergy])

  if (blocked) {
    return (
      <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', fontFamily: 'var(--font-inter)' }}>
        <p style={{ fontSize: '1.05rem', color: muted, textAlign: 'center', maxWidth: '32rem', lineHeight: 1.7 }}>
          {blocked === 'feature' ? 'Point of Sale is switched off.' : 'You do not have till access. Ask an admin to give you the Point of Sale section under Manage Users.'}
        </p>
      </main>
    )
  }
  if (checking || flagsLoading) return null

  const rows = (list: ChartDish[]) => list.map(d => (
    <DishRow key={d.menuItemId} dish={d} isMobile={isMobile}
      open={open === d.menuItemId} onToggle={() => setOpen(open === d.menuItemId ? null : d.menuItemId)} />
  ))
  const unverified = (chart.dishes ?? []).filter(d => !d.verified).length

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)', fontFamily: 'var(--font-inter)',
      padding: isMobile ? '1.25rem 1rem 4rem' : '1.75rem 2rem 4rem',
    }}>
      <div style={{ maxWidth: '980px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <PosButton icon={faArrowLeft} label="Floor" tone="quiet" size="sm" onClick={() => router.push('/pos')} />
          {chart.dishes && unverified > 0 && (
            <StatusBadge tone="danger" icon={faTriangleExclamation} label={`${unverified} of ${chart.dishes.length} not verified`} />
          )}
        </div>

        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.3rem', color: 'var(--offwhite)', lineHeight: 1.1, marginBottom: '0.8rem' }}>
          <FontAwesomeIcon icon={faWheatAwnCircleExclamation} style={{ marginRight: '0.6rem', color: 'var(--brand-secondary)' }} />
          Allergens
        </h1>

        {!moduleOn ? (
          <p style={{ fontSize: '1.05rem', color: muted, lineHeight: 1.7 }}>
            Food safety is switched off, so there is no allergen chart. A superadmin can switch it on in the admin panel under Settings → Modules.
          </p>
        ) : (
          <>
            <p style={{
              fontSize: '1rem', lineHeight: 1.6, color: 'var(--offwhite)', marginBottom: '1.2rem',
              background: 'rgba(var(--red-rgb),0.1)', border: '1px solid rgba(var(--red-rgb),0.4)', borderRadius: '10px', padding: '0.8rem 1rem',
            }}>
              <FontAwesomeIcon icon={faTriangleExclamation} style={{ color: 'var(--red)', marginRight: '0.5rem' }} />
              <strong style={{ color: 'var(--red)' }}>Not verified</strong> means there may be more in the dish than is listed.
              Never tell a customer a dish is free of something unless this says so — when in doubt, ask the kitchen.
            </p>

            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search a dish or category"
              aria-label="Search a dish or category"
              style={{
                width: '100%', boxSizing: 'border-box', minHeight: '56px', padding: '0 1rem',
                fontFamily: 'var(--font-inter)', fontSize: '1.05rem', color: 'var(--offwhite)',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '10px', outline: 'none',
              }}
            />

            <SectionLabel right={allergy ? <PosButton icon={faXmark} label="Clear" size="sm" tone="quiet" onClick={() => setAllergy(null)} /> : undefined}>
              The customer can&apos;t have
            </SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '1.2rem' }}>
              {ALLERGENS_EU14.map(a => (
                <Chip key={a.key} label={a.label} size="sm" colour="var(--brand-secondary)"
                  active={allergy === a.key} onClick={() => setAllergy(allergy === a.key ? null : a.key)} />
              ))}
            </div>

            {chart.error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <p style={{ color: 'var(--red)', fontSize: '1rem' }}>
                  <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.45rem' }} />{chart.error}
                </p>
                <PosButton icon={faRotateLeft} label="Try again" size="sm" onClick={chart.retry} />
              </div>
            )}
            {chart.loading && <p style={{ color: muted, fontSize: '1rem' }}>Loading the chart…</p>}

            {chart.dishes && !piles && rows(shown)}
            {chart.dishes && shown.length === 0 && (
              <p style={{ color: muted, fontSize: '1rem' }}>{search ? 'No dish matches that.' : 'There is nothing on the menu yet.'}</p>
            )}

            {piles && allergy && (
              <>
                <SectionLabel icon={faCircleCheck} right={<span style={{ color: muted, fontSize: '0.9rem' }}>{piles.free.length}</span>}>
                  No {allergenName(allergy).toLowerCase()} — as it comes, verified
                </SectionLabel>
                {piles.free.length === 0 && <p style={{ color: muted, fontSize: '0.95rem' }}>None verified yet.</p>}
                {rows(piles.free)}

                <SectionLabel icon={faCircleQuestion} colour="var(--red)" right={<span style={{ color: muted, fontSize: '0.9rem' }}>{piles.unknown.length}</span>}>
                  Can&apos;t be sure — not verified
                </SectionLabel>
                {rows(piles.unknown)}

                <SectionLabel icon={faBan} colour="var(--brand-secondary)" right={<span style={{ color: muted, fontSize: '0.9rem' }}>{piles.contains.length}</span>}>
                  Contains {allergenName(allergy).toLowerCase()}
                </SectionLabel>
                {rows(piles.contains)}
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
