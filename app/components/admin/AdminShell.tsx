'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { useAdminUser, hasSectionAccess, ROLE_LABELS } from '../../lib/adminAuth'
import { ADMIN_NAV } from '../../lib/adminNav'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBars, faChevronLeft, faChevronRight, faXmark, faRightFromBracket } from '@fortawesome/free-solid-svg-icons'
import { BRAND } from '../../lib/brand'

const COLLAPSE_KEY = 'admin_sidebar_collapsed'
const EXPANDED_W = 252
const COLLAPSED_W = 64
const MOBILE_BAR_H = 56

function useIsMobile(bp = 880) {
  const [v, setV] = useState(false)
  useEffect(() => {
    const fn = () => setV(window.innerWidth < bp)
    fn(); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn)
  }, [bp])
  return v
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isMobile = useIsMobile()
  const { user, role, loading } = useAdminUser()

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Hover tracking — inline styles can't express :hover, so every interactive
  // element in this sidebar is lit via onMouseEnter/onMouseLeave state,
  // matching the pattern Navbar.tsx already uses for its own nav links.
  const [hoveredHref, setHoveredHref] = useState<string | null>(null)
  const [logoHovered, setLogoHovered] = useState(false)
  const [toggleHovered, setToggleHovered] = useState(false)
  const [viewSiteHovered, setViewSiteHovered] = useState(false)
  const [signOutHovered, setSignOutHovered] = useState(false)

  // Read the persisted collapse preference after mount only — reading
  // localStorage during the initial render would make the server-rendered
  // and first-client-rendered markup disagree (hydration mismatch).
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY)
    if (stored === '1') setCollapsed(true)
    setHydrated(true)
  }, [])

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  useEffect(() => { setMobileOpen(false) }, [pathname])

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

  // Resolve once role/loading is known — before then, render no nav items
  // rather than briefly flashing the full unfiltered list.
  const visibleSections = (loading || !user) ? [] : ADMIN_NAV
    .map(section => ({ ...section, items: section.items.filter(it => hasSectionAccess(role, it.access)) }))
    .filter(section => section.items.length > 0)

  const sidebarWidth = collapsed ? COLLAPSED_W : EXPANDED_W

  const navContent = (
    <>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed && !isMobile ? 'center' : 'space-between',
        padding: collapsed && !isMobile ? '1.1rem 0' : '1.1rem 1.1rem 1.1rem 1.4rem',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        {(!collapsed || isMobile) && (
          <Link
            href="/admin"
            onMouseEnter={() => setLogoHovered(true)}
            onMouseLeave={() => setLogoHovered(false)}
            style={{
              fontFamily: 'var(--font-cinzel)', fontSize: '1.05rem',
              color: logoHovered ? 'var(--teal)' : 'var(--offwhite)',
              textDecoration: 'none', letterSpacing: '0.02em',
              transition: 'color 0.18s ease',
            }}>{BRAND.shortName} CMS</Link>
        )}
        {isMobile ? (
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu" style={{
            background: 'transparent', border: 'none', color: 'rgba(245,242,236,0.5)',
            cursor: 'pointer', padding: '0.3rem', fontSize: '1rem',
          }}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        ) : (
          <button
            onClick={toggleCollapsed}
            onMouseEnter={() => setToggleHovered(true)}
            onMouseLeave={() => setToggleHovered(false)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              background: toggleHovered ? 'rgba(0,160,152,0.18)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${toggleHovered ? 'rgba(0,160,152,0.4)' : 'rgba(255,255,255,0.08)'}`,
              color: toggleHovered ? 'var(--teal)' : 'rgba(245,242,236,0.55)',
              cursor: 'pointer', width: '26px', height: '26px',
              borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', flexShrink: 0,
              transform: toggleHovered ? 'scale(1.08)' : 'scale(1)',
              transition: 'all 0.18s ease',
            }}>
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
          </button>
        )}
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: collapsed && !isMobile ? '0.75rem 0.4rem' : '0.75rem 0.75rem' }}>
        {visibleSections.map(section => (
          <div key={section.title} style={{ marginBottom: '1.1rem' }}>
            {(!collapsed || isMobile) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: section.color, flexShrink: 0 }} />
                <p style={{
                  fontSize: '0.62rem', letterSpacing: '0.15em', textTransform: 'uppercase',
                  color: section.color, fontFamily: 'var(--font-inter)', fontWeight: 600,
                }}>{section.title}</p>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.4rem' }} title={section.title}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: section.color }} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {section.items.map(item => {
                const active = isActive(item.href)
                const hovered = hoveredHref === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    onMouseEnter={() => setHoveredHref(item.href)}
                    onMouseLeave={() => setHoveredHref(null)}
                    style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
                      padding: collapsed && !isMobile ? '0.5rem 0' : '0.55rem 0.6rem',
                      borderRadius: '3px',
                      backgroundColor: active ? 'rgba(255,255,255,0.06)' : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
                      color: active || hovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.5)',
                      borderLeft: active && (!collapsed || isMobile) ? `2px solid ${section.color}` : '2px solid transparent',
                      textDecoration: 'none',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.78rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      transform: hovered && (!collapsed || isMobile) ? 'translateX(3px)' : 'translateX(0)',
                      transition: 'background-color 0.18s ease, color 0.18s ease, transform 0.18s ease',
                    }}
                  >
                    {collapsed && !isMobile ? (
                      <span style={{
                        width: '28px', height: '28px', borderRadius: '50%',
                        backgroundColor: active ? section.color : hovered ? `${section.color}55` : 'rgba(255,255,255,0.06)',
                        color: active || hovered ? '#fff' : 'rgba(245,242,236,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.7rem', fontFamily: 'var(--font-cinzel)', flexShrink: 0,
                        transform: hovered ? 'scale(1.14)' : 'scale(1)',
                        boxShadow: hovered ? `0 0 0 3px ${section.color}25` : 'none',
                        transition: 'all 0.18s ease',
                      }}>{item.label.charAt(0)}</span>
                    ) : (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: collapsed && !isMobile ? '0.9rem 0.4rem' : '0.9rem 1rem',
        flexShrink: 0,
      }}>
        {(!collapsed || isMobile) && user && (
          <p style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.3)',
            marginBottom: '0.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {user.email} · {role ? ROLE_LABELS[role] : ''}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: collapsed && !isMobile ? 'column' : 'row', gap: '0.5rem' }}>
          <Link
            href="/"
            title="View Site"
            onMouseEnter={() => setViewSiteHovered(true)}
            onMouseLeave={() => setViewSiteHovered(false)}
            style={{
              flex: collapsed && !isMobile ? undefined : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${viewSiteHovered ? 'rgba(0,160,152,0.4)' : 'rgba(255,255,255,0.1)'}`,
              color: viewSiteHovered ? 'var(--teal)' : 'rgba(245,242,236,0.5)',
              backgroundColor: viewSiteHovered ? 'rgba(0,160,152,0.08)' : 'transparent',
              padding: '0.5rem', borderRadius: '2px', fontSize: '0.68rem',
              letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none',
              fontFamily: 'var(--font-inter)', transition: 'all 0.18s ease',
            }}>{collapsed && !isMobile ? '🏠' : 'View Site'}</Link>
          <button
            onClick={handleSignOut}
            title="Sign Out"
            onMouseEnter={() => setSignOutHovered(true)}
            onMouseLeave={() => setSignOutHovered(false)}
            style={{
              flex: collapsed && !isMobile ? undefined : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
              border: `1px solid ${signOutHovered ? 'rgba(228,51,41,0.6)' : 'rgba(228,51,41,0.25)'}`,
              color: signOutHovered ? '#fff' : 'var(--red)',
              backgroundColor: signOutHovered ? 'var(--red)' : 'transparent',
              padding: '0.5rem', borderRadius: '2px', fontSize: '0.68rem',
              letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
              fontFamily: 'var(--font-inter)', transition: 'all 0.18s ease',
            }}>
            <FontAwesomeIcon icon={faRightFromBracket} style={{ fontSize: '0.7rem' }} />
            {(!collapsed || isMobile) && 'Sign Out'}
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)' }}>

      {/* Desktop sidebar */}
      {!isMobile && (
        <aside style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: `${sidebarWidth}px`,
          backgroundColor: '#0a0a0a',
          borderRight: '1px solid rgba(255,255,255,0.06)',
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
          backgroundColor: 'rgba(5,5,5,0.97)', borderBottom: '1px solid rgba(255,255,255,0.06)',
          zIndex: 50,
        }}>
          <Link href="/admin" style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'var(--offwhite)', textDecoration: 'none' }}>
            {BRAND.shortName} CMS
          </Link>
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu" style={{
            background: 'transparent', border: 'none', color: 'var(--offwhite)', cursor: 'pointer', fontSize: '1.1rem', padding: '0.3rem',
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
              position: 'absolute', top: 0, left: 0, bottom: 0, width: '78vw', maxWidth: '300px',
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
        {children}
      </div>
    </div>
  )
}
