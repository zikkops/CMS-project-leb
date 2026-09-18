'use client'

// The admin frame: the sidebar, and the guide strip at the top of every page.
//
// Both read ADMIN_NAV (shared/src/adminNav.ts) — the same list the dashboard
// reads, so the sidebar and the dashboard always show the same pages
// (owner's request, 14 Sep 2026). Each section's setup pages sit under their
// own "Setup" heading, and every page opens with what its section is for and
// where that section is configured.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@big-cms/shared/firebase'
import { useAdminUser, ROLE_LABELS } from '@big-cms/shared/adminAuth'
import { ADMIN_NAV, sectionForPath, visibleNav, filterNav, type AdminNavSection, type AdminNavItem } from '@big-cms/shared/adminNav'
import { useFeatureFlags } from '@big-cms/shared/useFeatures'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBars, faChevronLeft, faChevronRight, faXmark, faRightFromBracket, faGear, faHouse,
  faGlobe, faCircleQuestion, faChevronDown, faChevronUp,
} from '@fortawesome/free-solid-svg-icons'
import { BRAND } from '@big-cms/shared/brand'
import { useClientValue } from '@big-cms/shared/useClientValue'
import { CommandPalette } from './CommandPalette'

const COLLAPSE_KEY = 'admin_sidebar_collapsed'
const GUIDE_KEY = 'admin_guide_hidden'
/** Which nav groups were left open, as { sectionKey: true }. */
const NAV_OPEN_KEY = 'admin_nav_open'
const EXPANDED_W = 268
const COLLAPSED_W = 68
const MOBILE_BAR_H = 56

/** A colour at a strength, for tints. color-mix works with a CSS variable, where appending hex alpha to one silently did not. */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

function useIsMobile(bp = 880) {
  const [v, setV] = useState(false)
  useEffect(() => {
    const fn = () => setV(window.innerWidth < bp)
    fn(); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn)
  }, [bp])
  return v
}

// Module scope — see CONTRIBUTING.md gotcha #2.
function NavLink({ item, color, active, compact }: { item: AdminNavItem; color: string; active: boolean; compact: boolean }) {
  const [hovered, setHovered] = useState(false)
  return (
    <Link
      href={item.href}
      title={compact ? `${item.label} — ${item.desc}` : item.desc}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.65rem',
        justifyContent: compact ? 'center' : 'flex-start',
        padding: compact ? '0.55rem 0' : '0.5rem 0.65rem',
        borderRadius: '6px',
        backgroundColor: active ? tint(color, 16) : hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
        color: active || hovered ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.68)',
        borderLeft: !compact ? `3px solid ${active ? color : 'transparent'}` : 'none',
        textDecoration: 'none', fontFamily: 'var(--font-inter)', fontSize: '0.86rem',
        fontWeight: active ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden',
        transition: 'background-color 0.15s ease, color 0.15s ease',
      }}
    >
      <FontAwesomeIcon icon={item.icon} style={{
        width: '1rem', flexShrink: 0, fontSize: compact ? '1rem' : '0.9rem',
        color: active || hovered ? color : tint(color, 75),
      }} />
      {!compact && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
    </Link>
  )
}

/** What this section is for, what this page does, and where the section is set up. */
function GuideStrip({ section, item, setupItems, hidden, onToggle, isMobile }: {
  section: AdminNavSection
  item: AdminNavItem
  setupItems: AdminNavItem[]
  hidden: boolean
  onToggle: () => void
  isMobile: boolean
}) {
  const others = setupItems.filter(s => s.href !== item.href)
  if (hidden) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: isMobile ? '0.4rem 1rem 0' : '0.5rem 2rem 0' }}>
        <button type="button" onClick={onToggle} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer',
          background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '999px',
          color: 'rgba(var(--offwhite-rgb),0.55)', fontFamily: 'var(--font-inter)', fontSize: '0.75rem',
          padding: '0.3rem 0.75rem',
        }}>
          <FontAwesomeIcon icon={faCircleQuestion} style={{ color: section.color }} />
          About {section.title}
          <FontAwesomeIcon icon={faChevronDown} />
        </button>
      </div>
    )
  }
  return (
    <div style={{
      margin: isMobile ? '0.75rem 1rem 0' : '1rem 2rem 0',
      padding: isMobile ? '0.85rem 0.95rem' : '0.95rem 1.2rem',
      borderRadius: '10px', fontFamily: 'var(--font-inter)',
      background: tint(section.color, 8), border: `1px solid ${tint(section.color, 30)}`,
      borderLeft: `4px solid ${section.color}`,
      display: 'flex', gap: '0.9rem', alignItems: 'flex-start', flexWrap: isMobile ? 'wrap' : 'nowrap',
    }}>
      <div style={{
        width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
        background: tint(section.color, 20), display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <FontAwesomeIcon icon={section.icon} style={{ color: section.color, fontSize: '1.05rem' }} />
      </div>

      <div style={{ flex: '1 1 18rem', minWidth: 0 }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: section.color, marginBottom: '0.15rem' }}>
          {section.title}
          <span style={{ color: 'rgba(var(--offwhite-rgb),0.45)', fontWeight: 600 }}>
            {' · '}{item.kind === 'setup' ? 'Setup' : 'Daily use'}
          </span>
        </p>
        <p style={{ fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.85)', lineHeight: 1.5 }}>{section.purpose}</p>
        <p style={{ fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.6)', lineHeight: 1.5, marginTop: '0.2rem' }}>
          <strong style={{ color: 'var(--offwhite)', fontWeight: 600 }}>This page:</strong> {item.desc}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'flex-start' : 'flex-end', gap: '0.45rem', flex: isMobile ? '1 1 100%' : '0 1 auto' }}>
        {others.length > 0 && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.5)' }}>
              <FontAwesomeIcon icon={faGear} /> Set up {section.title}
            </span>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
              {others.map(s => (
                <Link key={s.href} href={s.href} title={s.desc} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap',
                  padding: '0.35rem 0.7rem', borderRadius: '999px', textDecoration: 'none',
                  fontSize: '0.8rem', color: 'var(--offwhite)',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)',
                }}>
                  <FontAwesomeIcon icon={s.icon} style={{ color: section.color }} />{s.label}
                </Link>
              ))}
            </div>
          </>
        )}
        <button type="button" onClick={onToggle} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer',
          background: 'transparent', border: 'none', color: 'rgba(var(--offwhite-rgb),0.45)',
          fontFamily: 'var(--font-inter)', fontSize: '0.75rem', padding: '0.15rem 0',
        }}>
          Hide <FontAwesomeIcon icon={faChevronUp} />
        </button>
      </div>
    </div>
  )
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isMobile = useIsMobile()
  const { user, role, loading, sectionGrants, sectionRevocations } = useAdminUser()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [signOutHovered, setSignOutHovered] = useState(false)

  // The persisted preferences are the browser's: read through useClientValue,
  // so the server-rendered and first-client-rendered markup agree (reading
  // localStorage during the first render would be a hydration mismatch). A
  // click this session overrides what was remembered.
  const hydrated = useClientValue(() => true, false)
  const storedCollapsed = useClientValue(() => remembered(COLLAPSE_KEY), false)
  const storedGuideHidden = useClientValue(() => remembered(GUIDE_KEY), false)
  const [collapsedChoice, setCollapsedChoice] = useState<boolean | null>(null)
  const [guideChoice, setGuideChoice] = useState<boolean | null>(null)
  const collapsed = collapsedChoice ?? storedCollapsed
  const guideHidden = guideChoice ?? storedGuideHidden

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsedChoice(next)
    try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* private mode */ }
  }

  function toggleGuide() {
    const next = !guideHidden
    setGuideChoice(next)
    try { window.localStorage.setItem(GUIDE_KEY, next ? '1' : '0') } catch { /* private mode */ }
  }

  // The mobile menu closes when the page changes.
  const [menuPath, setMenuPath] = useState(pathname)
  if (menuPath !== pathname) {
    setMenuPath(pathname)
    setMobileOpen(false)
  }

  async function handleSignOut() {
    await signOut(auth)
    router.replace('/admin/login')
  }

  const allNavHrefs = ADMIN_NAV.flatMap(s => s.items.map(i => i.href))

  function isActive(href: string) {
    if (pathname === href) return true
    // Prefix-match only when no nav item exactly matches the current path,
    // so /admin/events doesn't steal the highlight from /admin/events/reservations.
    const hasExactMatch = allNavHrefs.includes(pathname)
    return !hasExactMatch && pathname.startsWith(href + '/')
  }

  const { flags, loading: featuresLoading } = useFeatureFlags()

  // Enforcement layer 1 — cosmetic, and the registry's first actual reader.
  // A link to a switched-off module is a dead end; hiding it is politeness,
  // not security. useRequireFeature() catches direct URL entry, and the rules
  // are what actually stop anything.
  //
  // Which feature owns a nav item is resolved through SECTION_ACCESS by
  // reference equality — every item passes SECTION_ACCESS.xxx directly, so the
  // array object is the same one. Same trick useRequireRole() uses to find its
  // section key.
  // Resolve once role/loading is known — before then, render no nav items
  // rather than briefly flashing the full unfiltered list. The same answer as
  // the dashboard's: visibleNav() in adminNav.ts.
  const visibleSections = (loading || !user) ? [] : visibleNav(
    { role, sectionGrants, sectionRevocations },
    featuresLoading ? null : flags,
  )

  const compact = collapsed && !isMobile

  // Ten sections and 54 pages, all open, made a very long sidebar (UPGRADE.md
  // T2.14). Groups fold now: the section of the page being shown opens by
  // itself, every other one as it was last left in this browser, and a filter
  // at the top searches every page's name and description.
  const [navFilter, setNavFilter] = useState('')
  const storedOpen = useClientValue(() => { try { return window.localStorage.getItem(NAV_OPEN_KEY) ?? '' } catch { return '' } }, '')
  const [openChoice, setOpenChoice] = useState<Record<string, boolean> | null>(null)
  const openState: Record<string, boolean> = openChoice ?? (() => { try { return JSON.parse(storedOpen || '{}') as Record<string, boolean> } catch { return {} } })()
  const currentSection = pathname ? sectionForPath(pathname)?.section.key ?? null : null
  function toggleSection(key: string, open: boolean) {
    const next = { ...openState, [key]: !open }
    setOpenChoice(next)
    try { window.localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }
  const filtering = navFilter.trim() !== ''

  // Ctrl+K / ⌘K opens the page finder from anywhere (UPGRADE.md T2.15).
  const [palette, setPalette] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(open => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const shownSections = filterNav(visibleSections, navFilter)
  const sidebarWidth = collapsed ? COLLAPSED_W : EXPANDED_W

  // The guide for the page being shown — not on the dashboard, which is the
  // guide to everything already.
  const here = pathname === '/admin' || !user ? null : sectionForPath(pathname)
  const hereSection = here ? visibleSections.find(s => s.key === here.section.key) : undefined

  const navContent = (
    <>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: compact ? 'center' : 'space-between',
        padding: compact ? '1.1rem 0' : '1.05rem 1rem 1.05rem 1.25rem',
        borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0,
      }}>
        {!compact && (
          <Link href="/admin" style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.55rem',
            fontFamily: 'var(--font-cinzel)', fontSize: '1.05rem', color: 'var(--offwhite)',
            textDecoration: 'none', letterSpacing: '0.02em',
          }}><FontAwesomeIcon icon={faHouse} style={{ color: 'var(--teal)', fontSize: '0.9rem' }} />{BRAND.shortName} CMS</Link>
        )}
        {isMobile ? (
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu" style={{
            background: 'transparent', border: 'none', color: 'rgba(var(--offwhite-rgb),0.6)',
            cursor: 'pointer', padding: '0.4rem', fontSize: '1.1rem',
          }}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        ) : (
          <button onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(var(--offwhite-rgb),0.65)', cursor: 'pointer', width: '30px', height: '30px',
            borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', flexShrink: 0,
          }}>
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
          </button>
        )}
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: compact ? '0.75rem 0.45rem' : '0.75rem 0.7rem' }}>
        {!compact && (
          <input
            type="search"
            value={navFilter}
            onChange={e => setNavFilter(e.target.value)}
            placeholder="Find a page…  (Ctrl+K)"
            aria-label="Find a page"
            style={{
              width: '100%', boxSizing: 'border-box', minHeight: '38px', marginBottom: '0.8rem',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px',
              padding: '0.45rem 0.7rem', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', outline: 'none',
            }}
          />
        )}
        {filtering && shownSections.length === 0 && (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.45)', padding: '0 0.55rem 0.8rem' }}>
            No page matches.
          </p>
        )}

        {/* The dashboard first, always — the one link every role has. */}
        <div style={{ marginBottom: '0.9rem' }}>
          <NavLink
            item={{ label: 'Dashboard', href: '/admin', access: [], icon: faHouse, desc: 'Everything you can open, grouped by section.', kind: 'use' }}
            color="var(--teal)" active={pathname === '/admin'} compact={compact}
          />
        </div>

        {shownSections.map(section => {
          const use = section.items.filter(i => i.kind === 'use')
          const setup = section.items.filter(i => i.kind === 'setup')
          // Open while filtering, when it holds this page, or as last left.
          const open = compact || filtering || section.key === currentSection || openState[section.key] === true
          return (
            <div key={section.key} style={{ marginBottom: '1.05rem' }}>
              {compact ? (
                <div title={`${section.title} — ${section.purpose}`} style={{ display: 'flex', justifyContent: 'center', margin: '0.2rem 0 0.35rem' }}>
                  <span style={{ width: '26px', height: '3px', borderRadius: '2px', background: section.color }} />
                </div>
              ) : (
                <button type="button" title={section.purpose} aria-expanded={open}
                  onClick={() => toggleSection(section.key, open)}
                  disabled={filtering || section.key === currentSection}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.3rem 0.55rem',
                    marginBottom: '0.35rem', background: 'none', border: 'none', cursor: filtering || section.key === currentSection ? 'default' : 'pointer', textAlign: 'left',
                  }}>
                  <FontAwesomeIcon icon={section.icon} style={{ color: section.color, fontSize: '0.75rem', width: '0.9rem' }} />
                  <span style={{
                    flex: 1, fontSize: '0.7rem', letterSpacing: '0.12em', textTransform: 'uppercase',
                    color: section.color, fontFamily: 'var(--font-inter)', fontWeight: 700,
                  }}>{section.title}</span>
                  {!filtering && section.key !== currentSection && (
                    <span aria-hidden style={{ color: 'rgba(var(--offwhite-rgb),0.4)', fontSize: '0.7rem' }}>{open ? '▾' : '▸'}</span>
                  )}
                </button>
              )}

              {open && (<>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                {use.map(item => (
                  <NavLink key={item.href} item={item} color={section.color} active={isActive(item.href)} compact={compact} />
                ))}
              </div>

              {setup.length > 0 && (
                <>
                  {!compact && (
                    <p style={{
                      display: 'flex', alignItems: 'center', gap: '0.35rem',
                      fontSize: '0.64rem', letterSpacing: '0.12em', textTransform: 'uppercase',
                      color: 'rgba(var(--offwhite-rgb),0.4)', fontFamily: 'var(--font-inter)', fontWeight: 600,
                      padding: '0.4rem 0.65rem 0.15rem 1.9rem',
                    }}>
                      <FontAwesomeIcon icon={faGear} style={{ fontSize: '0.6rem' }} /> Setup
                    </p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                    {setup.map(item => (
                      <NavLink key={item.href} item={item} color={section.color} active={isActive(item.href)} compact={compact} />
                    ))}
                  </div>
                </>
              )}
              </>)}
            </div>
          )
        })}
      </nav>

      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: compact ? '0.9rem 0.45rem' : '0.9rem 1rem', flexShrink: 0,
      }}>
        {!compact && user && (
          <p style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.45)',
            marginBottom: '0.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {user.email} · {role ? ROLE_LABELS[role] : ''}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', gap: '0.5rem' }}>
          <Link href="/" title="View Site" style={{
            flex: compact ? undefined : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
            border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(var(--offwhite-rgb),0.7)',
            padding: '0.55rem', borderRadius: '6px', fontSize: '0.78rem', textDecoration: 'none',
            fontFamily: 'var(--font-inter)',
          }}>
            <FontAwesomeIcon icon={faGlobe} />{!compact && 'View Site'}
          </Link>
          <button onClick={handleSignOut} title="Sign Out"
            onMouseEnter={() => setSignOutHovered(true)} onMouseLeave={() => setSignOutHovered(false)}
            style={{
              flex: compact ? undefined : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
              border: `1px solid ${signOutHovered ? 'var(--red)' : 'rgba(var(--red-rgb),0.35)'}`,
              color: signOutHovered ? '#fff' : 'var(--red)',
              backgroundColor: signOutHovered ? 'var(--red)' : 'transparent',
              padding: '0.55rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer',
              fontFamily: 'var(--font-inter)', transition: 'all 0.15s ease',
            }}>
            <FontAwesomeIcon icon={faRightFromBracket} />{!compact && 'Sign Out'}
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)' }}>
      {palette && visibleSections.length > 0 && (
        <CommandPalette sections={visibleSections} onClose={() => setPalette(false)}
          onGo={href => { setPalette(false); router.push(href) }} />
      )}

      {/* Desktop sidebar */}
      {!isMobile && (
        <aside style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: `${sidebarWidth}px`,
          backgroundColor: '#0a0a0a',
          borderRight: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column',
          zIndex: 40,
          transition: hydrated ? 'width 0.2s ease' : 'none',
          visibility: hydrated ? 'visible' : 'hidden',
        }}>
          {navContent}
        </aside>
      )}

      {/* Mobile top bar */}
      {isMobile && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: `${MOBILE_BAR_H}px`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 1.2rem',
          backgroundColor: 'rgba(5,5,5,0.97)', borderBottom: '1px solid rgba(255,255,255,0.07)',
          zIndex: 50,
        }}>
          <Link href="/admin" style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'var(--offwhite)', textDecoration: 'none' }}>
            {BRAND.shortName} CMS
          </Link>
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu" style={{
            background: 'transparent', border: 'none', color: 'var(--offwhite)', cursor: 'pointer', fontSize: '1.2rem', padding: '0.4rem',
          }}>
            <FontAwesomeIcon icon={faBars} />
          </button>
        </div>
      )}

      {/* Mobile drawer overlay */}
      {isMobile && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60,
          backgroundColor: 'rgba(0,0,0,0.6)',
          opacity: mobileOpen ? 1 : 0,
          visibility: mobileOpen ? 'visible' : 'hidden',
          transition: 'opacity 0.2s ease',
        }} onClick={() => setMobileOpen(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 0, left: 0, bottom: 0, width: '82vw', maxWidth: '320px',
              backgroundColor: '#0a0a0a', borderRight: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', flexDirection: 'column',
              transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform 0.25s ease',
            }}
          >
            {navContent}
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{
        marginLeft: isMobile ? 0 : `${sidebarWidth}px`,
        paddingTop: isMobile ? `${MOBILE_BAR_H}px` : 0,
        transition: hydrated && !isMobile ? 'margin-left 0.2s ease' : 'none',
      }}>
        {here && hereSection && hydrated && (
          <GuideStrip
            section={here.section}
            item={here.item}
            setupItems={hereSection.items.filter(i => i.kind === 'setup')}
            hidden={guideHidden}
            onToggle={toggleGuide}
            isMobile={isMobile}
          />
        )}
        {children}
      </div>
    </div>
  )
}

/** Whether a preference was remembered as on ("1"). Private mode reads as off. */
function remembered(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1' } catch { return false }
}
