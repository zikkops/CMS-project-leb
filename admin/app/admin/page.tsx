'use client'

// The admin dashboard: every page this person can open, grouped by section.
//
// It reads ADMIN_NAV (shared/src/adminNav.ts), the same list the sidebar
// reads, so the two always show the same pages — they used to be declared
// twice and had drifted apart (owner's request, 14 Sep 2026). Each section
// says what it is for, and splits its pages into daily use and setup.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signOut } from 'firebase/auth'
import { auth } from '@big-cms/shared/firebase'
import { useRequireRole, hasSectionAccess, ALL_ROLES, SECTION_ACCESS, ROLE_LABELS } from '@big-cms/shared/adminAuth'
import { useFeatureFlags } from '@big-cms/shared/useFeatures'
import { featureForSection, isFeatureOn } from '@big-cms/shared/features'
import { ADMIN_NAV, type AdminNavItem, type BadgeKey } from '@big-cms/shared/adminNav'
import { usePendingTransactions } from '@big-cms/shared/loyalty'
import { usePendingRedemptions } from '@big-cms/shared/redemptions'
import { usePendingEventReservations } from '@big-cms/shared/eventReservations'
import { usePendingTableReservations } from '@big-cms/shared/tableReservations'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faThumbtack, faGear, faXmark, faBolt, type IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { BRAND } from '@big-cms/shared/brand'

// Events can be set to the literal branch "All Branches" in Manage Events —
// always include it alongside a manager's real branchIds so those events
// aren't missed in their badge count.
const ALL_BRANCHES_LABEL = 'All Branches'

/** A colour at a strength. color-mix works with a CSS variable, where appending hex alpha to one silently did not. */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

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

type Card = AdminNavItem & { color: string; count?: number }

export default function AdminPage() {
  const router  = useRouter()
  const { checking, role, branchIds, sectionGrants, user } = useRequireRole(ALL_ROLES)
  const { flags, loading: featuresLoading } = useFeatureFlags()
  const isMobile = useIsMobile()

  // Memoized — usePendingTransactions/usePendingRedemptions re-subscribe
  // whenever this array's reference changes, so it must stay stable across
  // renders where the underlying filter hasn't actually changed. Badge counts
  // just need the combined total across all of a manager's branches, so no
  // per-branch narrowing is needed here (unlike the approvals/redemptions
  // queue pages, which let a multi-branch manager pick one branch at a time).
  const loyaltyBranchFilter = useMemo(
    () => checking ? null : role === 'admin' ? 'all' : branchIds,
    [checking, role, branchIds]
  )
  const effectiveLoyaltyFilter = role && SECTION_ACCESS.loyalty.includes(role) ? loyaltyBranchFilter : null
  const { transactions: pendingLoyalty } = usePendingTransactions(effectiveLoyaltyFilter)
  const { redemptions: pendingRedemptions } = usePendingRedemptions(effectiveLoyaltyFilter)

  // Admins/social see every pending event reservation; managers see their
  // own branches plus anything set to "All Branches".
  const eventReservationFilter = useMemo(() => {
    if (checking || !role || !SECTION_ACCESS.events.includes(role)) return null
    if (role === 'admin' || role === 'social') return 'all'
    return [...branchIds, ALL_BRANCHES_LABEL]
  }, [checking, role, branchIds])
  const { reservations: pendingEventReservations } = usePendingEventReservations(eventReservationFilter)

  // Admins see every pending table reservation; managers see their own
  // branches only (no "All Branches" literal here — unlike events, a table
  // reservation always belongs to exactly one real branch).
  const tableReservationFilter = useMemo(() => {
    if (checking || !role || !SECTION_ACCESS.tableReservations.includes(role)) return null
    return role === 'admin' ? 'all' : branchIds
  }, [checking, role, branchIds])
  const { reservations: pendingTableReservations } = usePendingTableReservations(tableReservationFilter)

  // Nothing fires on dashboard load any more.
  //
  // This effect used to run three things in the browser: the annual points
  // reset, and two one-shot data migrations. All three set a "done" flag or
  // advanced a date BEFORE doing their work, so a tab closed midway left the
  // job marked finished and half-applied, with nothing to retry it.
  //
  // The reset is a scheduled server job (Vercel Cron → /api/admin/loyalty/
  // reset). The migrations are scripts/harden-customer-fields.mjs. Opening a
  // dashboard is a read, and now only a read.

  async function handleSignOut() {
    await signOut(auth)
    router.replace('/admin/login')
  }

  // Pins are read once per signed-in user. There is no user while the page is
  // rendered on the server, so this never reads localStorage there.
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([])
  const [pinsReadFor, setPinsReadFor] = useState<string | null>(null)
  if (user?.uid && pinsReadFor !== user.uid) {
    setPinsReadFor(user.uid)
    try {
      const saved = localStorage.getItem(`quickaccess-${user.uid}`)
      setPinnedHrefs(saved ? JSON.parse(saved) : [])
    } catch { /* unreadable or private mode: nothing pinned */ }
  }

  function togglePin(href: string) {
    setPinnedHrefs(prev => {
      const next = prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href]
      try { if (user?.uid) localStorage.setItem(`quickaccess-${user.uid}`, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }

  const counts: Record<BadgeKey, number> = {
    loyaltyApprovals: pendingLoyalty.length,
    redemptions: pendingRedemptions.length,
    eventReservations: pendingEventReservations.length,
    tableReservations: pendingTableReservations.length,
  }

  const sections = ADMIN_NAV
    .map(section => ({
      ...section,
      cards: section.items
        .filter(({ access }) => {
          const key = Object.entries(SECTION_ACCESS).find(([, v]) => v === access)?.[0]
          if (!hasSectionAccess(role, access, sectionGrants, key)) return false
          // Fails open while the flags load, matching the sidebar: a card that
          // briefly appears is better than the whole dashboard flickering empty.
          if (featuresLoading || !key) return true
          const feature = featureForSection(key)
          return feature ? isFeatureOn(feature, flags) : true
        })
        .map(item => ({ ...item, color: section.color, count: item.badge ? counts[item.badge] : undefined }) as Card),
    }))
    .filter(section => section.cards.length > 0)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--teal)', fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem' }}>Loading…</p>
      </div>
    )
  }

  const allCards = sections.flatMap(s => s.cards)
  const attention = allCards.filter(c => (c.count ?? 0) > 0)
  const pinned = pinnedHrefs.map(h => allCards.find(c => c.href === h)).filter(Boolean) as Card[]

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0d0d0d', fontFamily: 'var(--font-inter)' }}>

      {/* Top bar */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', padding: isMobile ? '1rem 1.25rem' : '1rem 2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color: 'var(--offwhite)', letterSpacing: '0.05em' }}>{BRAND.shortName}</span>
          <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.45)', marginRight: '0.25rem' }}>{user?.email}</span>
          <Link href="/" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(var(--offwhite-rgb),0.75)', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', textDecoration: 'none' }}>
            View Site
          </Link>
          <button onClick={handleSignOut} style={{ background: 'rgba(var(--red-rgb),0.1)', border: '1px solid rgba(var(--red-rgb),0.35)', color: 'var(--red)', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '1240px', margin: '0 auto', padding: isMobile ? '1.5rem 1.25rem 4rem' : '2.5rem 2.5rem 5rem' }}>

        {/* Greeting */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.1rem', color: 'var(--offwhite)', marginBottom: '0.35rem' }}>
            {greeting}
          </h1>
          <p style={{ fontSize: '0.92rem', color: 'rgba(var(--offwhite-rgb),0.55)' }}>
            {role ? ROLE_LABELS[role] : ''} — {allCards.length} pages in {sections.length} sections. The same pages are in the sidebar;
            each section says what it is for, and its <FontAwesomeIcon icon={faGear} style={{ fontSize: '0.8em' }} /> Setup pages are kept apart from daily use.
          </p>
        </div>

        {/* Needs Attention */}
        {attention.length > 0 && (
          <div style={{ marginBottom: '2rem', background: 'rgba(var(--red-rgb),0.07)', border: '1px solid rgba(var(--red-rgb),0.25)', borderRadius: '12px', padding: '1.1rem 1.3rem' }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--red)', fontWeight: 700, marginBottom: '0.9rem' }}>
              <FontAwesomeIcon icon={faBolt} /> Needs attention
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${Math.min(attention.length, 3)}, 1fr)`, gap: '0.7rem' }}>
              {attention.map(card => (
                <Link key={card.href} href={card.href} style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', background: 'rgba(var(--red-rgb),0.06)', border: '1px solid rgba(var(--red-rgb),0.2)', borderRadius: '10px', padding: '0.85rem 1rem', textDecoration: 'none' }}>
                  <IconBlock icon={card.icon} color={card.color} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--offwhite)' }}>{card.label}</p>
                    <p style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)' }}>{card.count} waiting</p>
                  </div>
                  <CountBadge count={card.count ?? 0} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Quick Access */}
        <div style={{ marginBottom: '2.25rem' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)', fontWeight: 700, marginBottom: '0.8rem' }}>
            <FontAwesomeIcon icon={faThumbtack} /> Quick access
          </p>
          {pinned.length === 0 ? (
            <p style={{ fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.45)', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: '10px', padding: '1rem 1.25rem' }}>
              Pin the pages you use most with the <FontAwesomeIcon icon={faThumbtack} style={{ margin: '0 0.25rem' }} /> on any card below.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '0.6rem' }}>
              {pinned.map(card => (
                <div key={card.href} style={{ position: 'relative' }}>
                  <Link href={card.href} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', background: tint(card.color, 8), border: `1px solid ${tint(card.color, 30)}`, borderRadius: '10px', padding: '0.75rem 2.2rem 0.75rem 0.9rem', textDecoration: 'none', minHeight: '56px' }}>
                    <IconBlock icon={card.icon} color={card.color} size={32} />
                    <span style={{ fontSize: '0.88rem', color: 'var(--offwhite)', fontWeight: 600, lineHeight: 1.3 }}>{card.label}</span>
                    {(card.count ?? 0) > 0 && <span style={{ marginLeft: 'auto' }}><CountBadge count={card.count ?? 0} small /></span>}
                  </Link>
                  <button onClick={() => togglePin(card.href)} title="Unpin" aria-label={`Unpin ${card.label}`} style={{ position: 'absolute', top: '50%', right: '0.5rem', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(var(--offwhite-rgb),0.45)', fontSize: '0.8rem', padding: '0.35rem' }}>
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {sections.map(section => {
            const use = section.cards.filter(c => c.kind === 'use')
            const setup = section.cards.filter(c => c.kind === 'setup')
            return (
              <section key={section.key}>
                {/* What the section is FOR, before what is in it. */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.9rem', marginBottom: '0.9rem',
                  padding: '0.9rem 1.1rem', background: tint(section.color, 8),
                  border: `1px solid ${tint(section.color, 28)}`, borderLeft: `4px solid ${section.color}`, borderRadius: '10px',
                }}>
                  <IconBlock icon={section.icon} color={section.color} size={42} />
                  <div>
                    <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.15rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>{section.title}</h2>
                    <p style={{ fontSize: '0.9rem', color: 'rgba(var(--offwhite-rgb),0.7)', lineHeight: 1.5 }}>{section.purpose}</p>
                  </div>
                </div>

                {use.length > 0 && (
                  <>
                    {setup.length > 0 && <GroupLabel>Daily use</GroupLabel>}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '0.6rem' }}>
                      {use.map(card => (
                        <DashboardCard key={card.href} card={card} pinned={pinnedHrefs.includes(card.href)} onTogglePin={() => togglePin(card.href)} />
                      ))}
                    </div>
                  </>
                )}

                {setup.length > 0 && (
                  <>
                    <GroupLabel icon={faGear}>Setup — configure {section.title.toLowerCase()}</GroupLabel>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '0.6rem' }}>
                      {setup.map(card => (
                        <DashboardCard key={card.href} card={card} setup pinned={pinnedHrefs.includes(card.href)} onTogglePin={() => togglePin(card.href)} />
                      ))}
                    </div>
                  </>
                )}
              </section>
            )
          })}
        </div>

      </div>
    </div>
  )
}

// ── Module scope — see CONTRIBUTING.md gotcha #2 ──────────────────────────

function IconBlock({ icon, color, size }: { icon: IconDefinition; color: string; size: number }) {
  return (
    <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: '9px', background: tint(color, 20), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <FontAwesomeIcon icon={icon} style={{ color, fontSize: `${Math.round(size * 0.42)}px` }} />
    </div>
  )
}

function CountBadge({ count, small }: { count: number; small?: boolean }) {
  return (
    <span style={{ background: 'var(--red)', color: '#fff', borderRadius: '999px', minWidth: small ? '22px' : '28px', height: small ? '22px' : '28px', padding: '0 0.45rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: small ? '0.75rem' : '0.85rem', fontWeight: 700, flexShrink: 0 }}>
      {count}
    </span>
  )
}

function GroupLabel({ children, icon }: { children: React.ReactNode; icon?: IconDefinition }) {
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)', fontWeight: 700, margin: '0.9rem 0 0.5rem 0.2rem' }}>
      {icon && <FontAwesomeIcon icon={icon} />}{children}
    </p>
  )
}

function DashboardCard({ card, setup, pinned, onTogglePin }: {
  card: Card
  setup?: boolean
  pinned: boolean
  onTogglePin: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const { color } = card
  return (
    <Link
      href={card.href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: '0.8rem',
        background: hovered ? tint(color, 12) : setup ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.035)',
        border: `1px ${setup ? 'dashed' : 'solid'} ${hovered ? tint(color, 55) : 'rgba(255,255,255,0.12)'}`,
        borderRadius: '10px', padding: '0.9rem 2.4rem 0.9rem 1rem', minHeight: '72px',
        textDecoration: 'none', transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      <IconBlock icon={card.icon} color={color} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--offwhite)', marginBottom: '0.2rem', lineHeight: 1.25 }}>{card.label}</h3>
        <p style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.4 }}>{card.desc}</p>
      </div>
      {(card.count ?? 0) > 0 && <CountBadge count={card.count ?? 0} />}
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); onTogglePin() }}
        title={pinned ? 'Remove from Quick Access' : 'Pin to Quick Access'}
        aria-label={pinned ? `Unpin ${card.label}` : `Pin ${card.label}`}
        style={{
          position: 'absolute', top: '0.5rem', right: '0.55rem',
          background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem',
          color: pinned ? color : hovered ? 'rgba(var(--offwhite-rgb),0.5)' : 'rgba(var(--offwhite-rgb),0.2)',
          fontSize: '0.8rem', lineHeight: 1,
          transform: pinned ? 'rotate(-45deg)' : 'none', transition: 'color 0.15s, transform 0.15s',
        }}
      >
        <FontAwesomeIcon icon={faThumbtack} />
      </button>
    </Link>
  )
}
