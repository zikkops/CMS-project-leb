'use client'

// The staff allergen chart — what to tell a customer who asks.
//
// For anyone doing food safety checks (the floor), because they are the ones
// asked. Built on the server from recipes and sent without quantities or costs
// (shared/src/server/allergens.ts).
//
// The page's one job is not to mislead: a dish that is not verified says so in
// red, with why, and lists what is known as "at least" — never a clean row.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { ALLERGENS_EU14 } from '@big-cms/shared/foodSafety'

interface ChartOption { optionId: string; name: string; group: string; adds: string[]; removes: string[]; verified: boolean }
interface ChartDish {
  menuItemId: string
  name: string
  category: string
  available: boolean
  verified: boolean
  contains: string[]
  others: string[]
  reasons: string[]
  options: ChartOption[]
  confirmedByEmail: string | null
}

const LABEL = new Map(ALLERGENS_EU14.map(a => [a.key, a.label]))
const names = (keys: string[]) => keys.map(k => LABEL.get(k) ?? k).join(', ')

const inp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
  color: 'var(--offwhite)', borderRadius: '4px', padding: '0.55rem 0.75rem',
  fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-inter)', width: '100%',
}
const small: React.CSSProperties = { fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.5)', lineHeight: 1.5 }

function Chip({ text, tone }: { text: string; tone: 'red' | 'amber' | 'muted' }) {
  const color = tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--brand-secondary)' : 'rgba(var(--offwhite-rgb),0.6)'
  return (
    <span style={{
      fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color, border: `1px solid ${color}`,
      borderRadius: '999px', padding: '0.1rem 0.55rem', whiteSpace: 'nowrap',
    }}>{text}</span>
  )
}

export default function AllergenChartPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.foodSafety)
  const isMobile = useIsMobile()
  const [dishes, setDishes] = useState<ChartDish[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    if (checking) return
    authedFetch('/api/admin/food-safety?view=allergens', 'GET').then(unwrap)
      .then(r => setDishes((r.dishes as ChartDish[]) ?? []))
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load the allergen chart.'))
      .finally(() => setLoading(false))
  }, [checking])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? dishes.filter(d => d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)) : dishes
  }, [dishes, search])

  if (checking) return null
  const unverified = dishes.filter(d => d.verified === false).length

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '2rem 1rem 4rem' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>
        <Link href="/admin/food-safety" style={{ ...small, textDecoration: 'none', display: 'block', marginBottom: '0.5rem' }}>← Food safety diary</Link>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '0.4rem' }}>Allergen Chart</h1>
        <p style={{ ...small, marginBottom: '1.2rem', maxWidth: '62ch' }}>
          If a dish is <strong style={{ color: 'var(--red)' }}>not verified</strong>, do not tell a customer it is free of
          anything — it may contain more than is listed. Ask the kitchen, and when in doubt, say you cannot be sure.
          Never guess.
        </p>

        <input style={{ ...inp, marginBottom: '1rem' }} placeholder="Search a dish or category" value={search} onChange={e => setSearch(e.target.value)} />

        {error && <p style={{ ...small, color: 'var(--red)' }}>{error}</p>}
        {loading && <p style={small}>Loading…</p>}
        {!loading && !error && unverified > 0 && (
          <p style={{ ...small, color: 'var(--brand-secondary)', marginBottom: '0.8rem' }}>
            {unverified} of {dishes.length} {dishes.length === 1 ? 'dish is' : 'dishes are'} not verified yet.
          </p>
        )}

        {shown.map(d => (
          <div key={d.menuItemId} style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0.8rem 0.2rem' }}>
            <button type="button" onClick={() => setOpen(open === d.menuItemId ? null : d.menuItemId)} style={{
              all: 'unset', cursor: 'pointer', width: '100%',
              display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '14rem 1fr', gap: '0.4rem 1rem', alignItems: 'center',
            }}>
              <span>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.92rem', color: 'var(--offwhite)' }}>{d.name}</span>
                <span style={small}>{d.category ? ` · ${d.category}` : ''}{d.available ? '' : ' · not on sale'}</span>
              </span>
              <span style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {!d.verified && <Chip text="Not verified" tone="red" />}
                {[...d.contains, ...d.others].map(k => <Chip key={k} text={LABEL.get(k) ?? k} tone="amber" />)}
                {d.verified && d.contains.length === 0 && d.others.length === 0 && <span style={small}>None of the listed allergens</span>}
                {!d.verified && (d.contains.length > 0 || d.others.length > 0) && <span style={small}>at least</span>}
              </span>
            </button>

            {open === d.menuItemId && (
              <div style={{ marginTop: '0.6rem', paddingLeft: isMobile ? 0 : '15rem' }}>
                {d.reasons.map(r => <p key={r} style={{ ...small, color: 'var(--red)' }}>{r}</p>)}
                {d.others.length > 0 && (
                  <p style={small}>Also contains {names(d.others)}, which is not on this café&apos;s tracked list.</p>
                )}
                {d.options.map(o => (
                  <p key={o.optionId} style={small}>
                    <span style={{ color: 'var(--offwhite)' }}>{o.group}: {o.name}</span>
                    {o.adds.length > 0 && ` — adds ${names(o.adds)}`}
                    {o.removes.length > 0 && ` — takes out ${names(o.removes)}`}
                    {!o.verified && <span style={{ color: 'var(--red)' }}> — not verified</span>}
                  </p>
                ))}
                {d.confirmedByEmail && <p style={small}>Recipe confirmed complete by {d.confirmedByEmail}.</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
