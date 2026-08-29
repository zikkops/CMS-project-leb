'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useRequireRole, hasSectionAccess, ALL_ROLES, SECTION_ACCESS, ROLE_LABELS, type Role } from '../lib/adminAuth'
import { useFeatureFlags } from '../lib/useFeatures'
import { featureForSection, isFeatureOn } from '../lib/features'
import { usePendingTransactions } from '../lib/loyalty'
import { usePendingRedemptions } from '../lib/redemptions'
import { usePendingEventReservations } from '../lib/eventReservations'
import { usePendingTableReservations } from '../lib/tableReservations'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCashRegister, faReceipt, faDice, faUtensils, faCalendar, faCalendarCheck,
  faCalendarDay, faUsers, faUser, faClock, faMap,
  faClipboard, faThumbsUp, faGift, faTag, faTrophy, faUserShield,
  faFile, faPaperPlane, faTruck, faList, faImage, faScroll, faHandshake, faStore,
  faClockRotateLeft, faChair, faThumbtack, faGear, faXmark, faMoneyBill,
  faClipboardCheck,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { BRAND } from '../lib/brand'

// Events can be set to the literal branch "All Branches" in Manage Events —
// always include it alongside a manager's real branchIds so those events
// aren't missed in their badge count.
const ALL_BRANCHES_LABEL = 'All Branches'

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

  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([])
  useEffect(() => {
    if (!user?.uid) return
    const saved = localStorage.getItem(`quickaccess-${user.uid}`)
    if (saved) try { setPinnedHrefs(JSON.parse(saved)) } catch {}
  }, [user?.uid])

  function togglePin(href: string) {
    setPinnedHrefs(prev => {
      const next = prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href]
      if (user?.uid) localStorage.setItem(`quickaccess-${user.uid}`, JSON.stringify(next))
      return next
    })
  }

  // Every card within a section shares that section's color — the color is
  // the grouping signal, not a per-card decoration, so it's set once here
  // rather than picked individually for each card.
  const sections = [
    {
      title: 'Game Sales',
      color: 'var(--teal)',
      cards: [
        { label: 'Record a Sale',    icon: faCashRegister, daily: true,  desc: 'Process a game purchase, deduct stock, and generate an invoice', href: '/admin/games/purchase', access: SECTION_ACCESS.gamePurchases },
        { label: 'Sales & Invoices', icon: faReceipt,      daily: false, desc: 'View past sales, download invoices, and process refunds',       href: '/admin/games/invoices', access: SECTION_ACCESS.gamePurchases },
      ],
    },
    {
      title: 'Content Management',
      color: 'var(--teal)',
      cards: [
        { label: 'Event Reservations', icon: faCalendarCheck, daily: true,  desc: 'Approve or reject pending event spot requests',        href: '/admin/events/reservations', access: SECTION_ACCESS.events, badge: pendingEventReservations.length },
        { label: 'Manage Games',       icon: faDice,          daily: false, desc: 'Add, edit or remove games from the shop',              href: '/admin/games',               access: SECTION_ACCESS.games },
        { label: 'Manage Menu',        icon: faUtensils,      daily: false, desc: 'Update food and drink items',                           href: '/admin/menu',                access: SECTION_ACCESS.menu },
        { label: 'Manage Events',      icon: faCalendar,      daily: false, desc: 'Create and manage events',                             href: '/admin/events',              access: SECTION_ACCESS.events },
      ],
    },
    {
      title: 'Table Bookings',
      color: 'var(--navy)',
      cards: [
        { label: "Today's Schedule",   icon: faCalendarDay, daily: true,  desc: 'All approved reservations for today — tables and events'      , href: '/admin/schedule',            access: SECTION_ACCESS.tableReservations },
        { label: 'Table Reservations', icon: faChair,       daily: true,  desc: 'Approve or reject pending table booking requests',               href: '/admin/tables/reservations', access: SECTION_ACCESS.tableReservations, badge: pendingTableReservations.length },
        { label: 'Table Map Editor',   icon: faMap,         daily: false, desc: 'Upload floor plans and place table markers for each branch',     href: '/admin/branches/tables',     access: SECTION_ACCESS.branchTables },
      ],
    },
    {
      title: 'Loyalty Submissions',
      color: 'var(--navy)',
      cards: [
        { label: 'Event Attendance',       icon: faClipboard, daily: true, desc: 'Log event attendees to send them for manager approval',   href: '/admin/loyalty/events', access: SECTION_ACCESS.loyaltyEvents },
      ],
    },
    {
      title: 'Loyalty Approvals',
      color: 'var(--navy)',
      cards: [
        { label: 'Loyalty Approvals',   icon: faThumbsUp, daily: true, desc: 'Approve or reject pending point submissions',  href: '/admin/loyalty/approvals',   access: SECTION_ACCESS.loyalty, badge: pendingLoyalty.length },
        { label: 'Redemption Requests', icon: faGift,     daily: true, desc: 'Confirm or reject pending Point redemption requests', href: '/admin/loyalty/redemptions', access: SECTION_ACCESS.loyalty, badge: pendingRedemptions.length },
      ],
    },
    {
      title: 'Loyalty Catalog',
      color: 'var(--navy)',
      cards: [
        { label: 'Redemption Items', icon: faTag,    daily: false, desc: 'Add, edit or deactivate items customers can redeem with Points',        href: '/admin/loyalty/redemption-items', access: SECTION_ACCESS.loyalty },
        { label: 'Tier Perks',       icon: faTrophy, daily: false, desc: 'Edit the perks customers unlock at each tier, shown on the Loyalty page', href: '/admin/loyalty/perks',            access: SECTION_ACCESS.loyalty },
      ],
    },
    {
      title: 'Customer Accounts',
      color: 'var(--navy)',
      cards: [
        { label: 'Manage Customers', icon: faUser,            daily: false, desc: 'Edit points, resend password resets, delete accounts, and set the annual points reset date', href: '/admin/loyalty/customers', access: ['admin'] as Role[] },
        { label: 'Loyalty Activity', icon: faClockRotateLeft, daily: false, desc: 'Submissions, approvals, rejections, and redemption item changes',                                     href: '/admin/loyalty/activity',  access: SECTION_ACCESS.loyalty },
      ],
    },
    {
      title: 'Weekly Orders',
      color: 'var(--teal)',
      cards: [
        { label: 'End of Week Order', icon: faPaperPlane, daily: true,  desc: "Fill in quantities and submit this week's stock order",             href: '/admin/weekly-orders/submit',    access: SECTION_ACCESS.weeklyOrdersSubmit },
        { label: 'Order Reports',    icon: faFile,       daily: true,  desc: 'View all end-of-week order reports submitted by staff',             href: '/admin/weekly-orders',           access: SECTION_ACCESS.weeklyOrders },
        { label: 'Manage Providers', icon: faTruck,      daily: false, desc: 'Add suppliers with per-branch phone numbers for WhatsApp ordering', href: '/admin/weekly-orders/providers', access: ['admin'] as Role[] },
        { label: 'Edit Template',    icon: faList,       daily: false, desc: 'Manage orderable items, pack sizes, Arabic names, and units',      href: '/admin/weekly-orders/template',  access: ['admin'] as Role[] },
      ],
    },
    {
      title: 'Wholesale',
      color: '#6A6AB7',
      cards: [
        { label: 'Wholesale Orders',   icon: faHandshake, daily: true,  desc: 'Approve or reject trade orders from shops, then email them on', href: '/admin/wholesale/orders',   access: SECTION_ACCESS.games },
        { label: 'Wholesale Accounts', icon: faStore,     daily: false, desc: 'Create and deactivate the shop logins that can see trade pricing', href: '/admin/wholesale/accounts', access: ['admin'] as Role[] },
      ],
    },
    {
      title: 'Inventory Management',
      color: '#6A9E5A',
      cards: [
        { label: 'Inventory Management', icon: faClipboard, daily: true, desc: 'Track consumable stock levels across Kitchen, Bar, and Cleaning — color alerts when items run low', href: '/admin/supplies', access: SECTION_ACCESS.supplies },
        { label: 'Daily Inventory Count', icon: faClipboardCheck, daily: true, desc: 'Count today\'s stock at your branch and submit — updates live inventory levels', href: '/admin/supplies/daily', access: SECTION_ACCESS.dailyInventory },
        { label: 'Daily Inventory History', icon: faClockRotateLeft, daily: true, desc: 'Review every submitted and in-progress count by branch and department', href: '/admin/supplies/daily/history', access: SECTION_ACCESS.dailyInventoryHistory },
      ],
    },
    {
      title: 'End of Day',
      color: '#C9962C',
      cards: [
        { label: 'Submit EOD Report', icon: faMoneyBill,       daily: true,  desc: 'Fill in cash count, expenses, income, and attendance for the end of shift', href: '/admin/end-of-day',          access: SECTION_ACCESS.endOfDay },
        { label: 'EOD History',       icon: faClockRotateLeft, daily: true,  desc: 'Browse past end-of-day reports by branch',                                   href: '/admin/end-of-day/history',  access: SECTION_ACCESS.endOfDayHistory },
        { label: 'Daily Summary',     icon: faReceipt,         daily: true,  desc: 'View daily totals and add tips — mobile-friendly for screenshots',           href: '/admin/end-of-day/summary',  access: SECTION_ACCESS.endOfDayHistory },
        { label: 'Staff Roster',      icon: faUsers,           daily: false, desc: 'Configure the default staff list per branch for EOD attendance tracking',    href: '/admin/end-of-day/staff',    access: ['admin'] as Role[] },
      ],
    },
    {
      title: 'Administration',
      color: 'var(--red)',
      cards: [
        { label: 'Media Library', icon: faImage,      daily: false, desc: 'View and delete previously uploaded images',          href: '/admin/media', access: ALL_ROLES },
        { label: 'Manage Users',  icon: faUserShield, daily: false, desc: 'Create accounts and set access levels',               href: '/admin/users', access: ['admin'] as Role[] },
        { label: 'Activity Log',  icon: faScroll,     daily: false, desc: 'See who created, edited, or deleted what, and when', href: '/admin/logs',  access: ['admin'] as Role[] },
      ],
    },
  ]
    .map(section => ({
      ...section,
      cards: section.cards.filter(({ access }) => {
        const key = Object.entries(SECTION_ACCESS).find(([, v]) => v === access)?.[0]
        if (!hasSectionAccess(role, access, sectionGrants, key)) return false
        // The dashboard is a THIRD surface. adminNav.ts already warns that its
        // card list is declared independently of the sidebar's — so wiring the
        // sidebar to the feature flags left the cards behind, and switching a
        // module off hid its nav entry while leaving a card that bounced you
        // straight back to this page.
        //
        // Fails open while the flags load, matching the sidebar: a card that
        // briefly appears is better than the whole dashboard flickering empty.
        if (featuresLoading || !key) return true
        const feature = featureForSection(key)
        return feature ? isFeatureOn(feature, flags) : true
      }),
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0d0d0d', fontFamily: 'var(--font-inter)' }}>

      {/* Top bar */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', padding: isMobile ? '1rem 1.25rem' : '1rem 2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color: 'var(--offwhite)', letterSpacing: '0.05em' }}>{BRAND.shortName}</span>
          <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)' }} />
          <span style={{ fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)', letterSpacing: '0.05em' }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.68rem', color: 'rgba(245,242,236,0.3)', marginRight: '0.25rem' }}>{user?.email}</span>
          <Link href="/" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(245,242,236,0.55)', padding: '0.45rem 1rem', borderRadius: '6px', fontSize: '0.72rem', letterSpacing: '0.05em', textDecoration: 'none' }}>
            View Site
          </Link>
          <button onClick={handleSignOut} style={{ background: 'rgba(228,51,41,0.08)', border: '1px solid rgba(228,51,41,0.2)', color: 'rgba(228,51,41,0.7)', padding: '0.45rem 1rem', borderRadius: '6px', fontSize: '0.72rem', letterSpacing: '0.05em', cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '1.5rem 1.25rem 4rem' : '2.5rem 2.5rem 5rem' }}>

        {/* Greeting */}
        <div style={{ marginBottom: '2.5rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.6rem' : '2rem', color: 'var(--offwhite)', marginBottom: '0.3rem' }}>
            {greeting}
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'rgba(245,242,236,0.3)' }}>
            {role ? ROLE_LABELS[role] : ''} dashboard — {sections.reduce((n, s) => n + s.cards.length, 0)} tools available
          </p>
        </div>

        {/* Needs Attention */}
        {(() => {
          const attention = sections.flatMap(s =>
            s.cards.filter(c => c.badge && c.badge > 0).map(c => ({ ...c, color: s.color }))
          )
          if (attention.length === 0) return null
          return (
            <div style={{ marginBottom: '2.5rem', background: 'rgba(228,51,41,0.06)', border: '1px solid rgba(228,51,41,0.2)', borderRadius: '10px', padding: '1.25rem 1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--red)', flexShrink: 0 }} />
                <p style={{ fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--red)', fontWeight: 600 }}>
                  Needs Attention
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${Math.min(attention.length, 3)}, 1fr)`, gap: '0.75rem' }}>
                {attention.map(card => (
                  <a key={card.label} href={card.href} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(228,51,41,0.06)', border: '1px solid rgba(228,51,41,0.18)', borderRadius: '8px', padding: '0.9rem 1.1rem', textDecoration: 'none' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: `${card.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <FontAwesomeIcon icon={card.icon} style={{ color: card.color, fontSize: '0.95rem' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.88rem', color: 'var(--offwhite)', marginBottom: '0.1rem' }}>{card.label}</p>
                      <p style={{ fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)' }}>{card.badge} pending</p>
                    </div>
                    <span style={{ background: 'var(--red)', color: '#fff', borderRadius: '999px', minWidth: '26px', height: '26px', padding: '0 0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700, flexShrink: 0 }}>{card.badge}</span>
                  </a>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Quick Access */}
        {(() => {
          const allCards = sections.flatMap(s => s.cards.map(c => ({ ...c, color: s.color })))
          const pinned = pinnedHrefs.map(h => allCards.find(c => c.href === h)).filter(Boolean) as typeof allCards
          return (
            <div style={{ marginBottom: '2.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
                <FontAwesomeIcon icon={faThumbtack} style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.3)' }} />
                <p style={{ fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', fontWeight: 600 }}>Quick Access</p>
                <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.05)' }} />
              </div>
              {pinned.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'rgba(245,242,236,0.18)', fontStyle: 'italic', border: '1px dashed rgba(255,255,255,0.06)', borderRadius: '8px', padding: '1.25rem 1.5rem' }}>
                  Pin any card below with the <FontAwesomeIcon icon={faThumbtack} style={{ margin: '0 0.3rem', fontSize: '0.7rem' }} /> icon to add it here.
                </p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '0.6rem' }}>
                  {pinned.map(card => (
                    <div key={card.href} style={{ position: 'relative' }}>
                      <a href={card.href} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: `${card.color}0e`, border: `1px solid ${card.color}30`, borderRadius: '8px', padding: '0.75rem 1rem', textDecoration: 'none', paddingRight: '2rem' }}>
                        <div style={{ width: '30px', height: '30px', borderRadius: '6px', background: `${card.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <FontAwesomeIcon icon={card.icon} style={{ color: card.color, fontSize: '0.8rem' }} />
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--offwhite)', fontWeight: 500, lineHeight: 1.3 }}>{card.label}</span>
                        {card.badge != null && card.badge > 0 && (
                          <span style={{ marginLeft: 'auto', background: 'var(--red)', color: '#fff', borderRadius: '999px', minWidth: '18px', height: '18px', padding: '0 0.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>{card.badge}</span>
                        )}
                      </a>
                      <button onClick={() => togglePin(card.href)} title="Unpin" style={{ position: 'absolute', top: '0.35rem', right: '0.4rem', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(245,242,236,0.2)', fontSize: '0.65rem', padding: '0.2rem' }}>
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
          {sections.map(section => {
            const dailyCards  = section.cards.filter(c => c.daily)
            const configCards = section.cards.filter(c => !c.daily)
            return (
              <div key={section.title}>
                {/* Section header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', padding: '0.55rem 1rem', background: `${section.color}0d`, border: `1px solid ${section.color}22`, borderRadius: '8px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: section.color, flexShrink: 0 }} />
                  <p style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: section.color, fontWeight: 600 }}>{section.title}</p>
                </div>

                {dailyCards.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '0.6rem', marginBottom: configCards.length > 0 ? '0.5rem' : 0 }}>
                    {dailyCards.map(card => (
                      <DashboardCard key={card.label} {...card} color={section.color} pinned={pinnedHrefs.includes(card.href)} onTogglePin={() => togglePin(card.href)} />
                    ))}
                  </div>
                )}

                {configCards.length > 0 && (
                  <>
                    {dailyCards.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.6rem 0' }}>
                        <FontAwesomeIcon icon={faGear} style={{ fontSize: '0.55rem', color: 'rgba(245,242,236,0.15)' }} />
                        <span style={{ fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.15)' }}>Configure</span>
                        <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.04)' }} />
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '0.6rem' }}>
                      {configCards.map(card => (
                        <DashboardCard key={card.label} {...card} color={section.color} pinned={pinnedHrefs.includes(card.href)} onTogglePin={() => togglePin(card.href)} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}

function DashboardCard({ label, desc, href, color, badge, icon, daily, pinned, onTogglePin }: {
  label: string
  desc: string
  href: string
  color: string
  badge?: number
  icon: IconDefinition
  daily: boolean
  pinned: boolean
  onTogglePin: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <a
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        background: hovered ? `${color}14` : 'rgba(255,255,255,0.025)',
        border: `1px solid ${hovered ? `${color}45` : 'rgba(255,255,255,0.07)'}`,
        borderRadius: '8px',
        padding: '0.85rem 1rem',
        textDecoration: 'none',
        transition: 'all 0.18s ease',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? `0 4px 16px ${color}15` : 'none',
        opacity: daily ? 1 : hovered ? 1 : 0.6,
        paddingRight: '2.2rem',
      }}
    >
      {/* Icon block */}
      <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: hovered ? `${color}28` : `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.18s' }}>
        <FontAwesomeIcon icon={icon} style={{ color, fontSize: '0.9rem', width: '0.9rem' }} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.82rem', color: 'var(--offwhite)', marginBottom: '0.15rem', lineHeight: 1.2 }}>{label}</h2>
        <p style={{ fontSize: '0.68rem', color: 'rgba(245,242,236,0.35)', lineHeight: 1.4 }}>{desc}</p>
      </div>

      {/* Badge */}
      {!!badge && badge > 0 && (
        <span style={{ background: 'var(--red)', color: '#fff', borderRadius: '999px', minWidth: '22px', height: '22px', padding: '0 0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0, border: '2px solid #0d0d0d' }}>
          {badge}
        </span>
      )}

      {/* Pin */}
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); onTogglePin() }}
        title={pinned ? 'Remove from Quick Access' : 'Pin to Quick Access'}
        style={{
          position: 'absolute', top: '0.6rem', right: '0.7rem',
          background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem',
          color: pinned ? color : hovered ? 'rgba(245,242,236,0.2)' : 'transparent',
          fontSize: '0.7rem', lineHeight: 1,
          transform: pinned ? 'rotate(-45deg)' : 'none',
          transition: 'color 0.15s, transform 0.15s',
        }}
      >
        <FontAwesomeIcon icon={faThumbtack} />
      </button>
    </a>
  )
}
