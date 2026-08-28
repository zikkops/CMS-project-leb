'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useCustomerUser, signOutCustomer } from '../../lib/customerAuth'
import { useIsStaff } from '../../lib/adminAuth'
import { usePendingInvites, acceptInvite, declineInvite, type ParticipantInvite } from '../../lib/participantInvites'
import { useIncomingRequests, acceptFriendRequest, declineFriendRequest, type FriendRequest } from '../../lib/friends'
import { useMyNotifications, markNotificationRead, type StatusNotification } from '../../lib/notifications'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faBell } from '@fortawesome/free-solid-svg-icons'
import { BRAND } from '../../lib/brand'

const INVITE_TYPE_LABELS: Record<ParticipantInvite['reservationType'], string> = {
  event: 'Event',
}

const RESERVATION_TYPE_LABELS: Record<StatusNotification['reservationType'], string> = {
  event: 'Event',
  table: 'Table Reservation',
}

const LINKS = [
  { href: '/about',   label: 'About Us' },
  { href: '/shop',    label: 'Shop' },
  { href: '/menu',    label: 'Menu' },
  { href: '/events',  label: 'Events' },
  { href: '/loyalty', label: 'Loyalty' },
]

export default function Navbar() {
  const [scrolled, setScrolled]       = useState(false)
  const [open, setOpen]               = useState(false)
  const [isMobile, setIsMobile]       = useState(false)
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const [btnHovered, setBtnHovered]   = useState(false)
  const [authHovered, setAuthHovered] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [hoveredMenuItem, setHoveredMenuItem] = useState<'profile' | 'logout' | null>(null)
  const [contactMenuOpen, setContactMenuOpen] = useState(false)
  const [hoveredContactItem, setHoveredContactItem] = useState<'reserve' | 'contact' | null>(null)
  const pathname                      = usePathname()
  const router                        = useRouter()
  const { user: customerUser, loading: customerLoading } = useCustomerUser()
  const [customerName, setCustomerName] = useState<string | null>(null)
  const isStaff = useIsStaff()
  const { invites: pendingInvites } = usePendingInvites(customerUser?.uid ?? null)
  const friendRequests = useIncomingRequests(customerUser?.uid ?? null)
  const statusNotifications = useMyNotifications(customerUser?.uid ?? null)
  const totalNotifCount = pendingInvites.length + friendRequests.length + statusNotifications.length
  const [notifOpen, setNotifOpen] = useState(false)
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null)
  const [friendBusyId, setFriendBusyId] = useState<string | null>(null)

  async function handleInviteAccept(invite: ParticipantInvite) {
    setInviteBusyId(invite.id)
    try { await acceptInvite(invite) } finally { setInviteBusyId(null) }
  }

  async function handleInviteDecline(invite: ParticipantInvite) {
    setInviteBusyId(invite.id)
    try { await declineInvite(invite) } finally { setInviteBusyId(null) }
  }

  async function handleFriendAccept(req: FriendRequest) {
    setFriendBusyId(req.id)
    try { await acceptFriendRequest(req.id) } finally { setFriendBusyId(null) }
  }

  async function handleFriendDecline(req: FriendRequest) {
    setFriendBusyId(req.id)
    try { await declineFriendRequest(req.id) } finally { setFriendBusyId(null) }
  }

  async function handleDismissNotif(n: StatusNotification) {
    await markNotificationRead(n.id)
  }

  useEffect(() => {
    if (!customerUser) { setCustomerName(null); return }
    const unsub = onSnapshot(doc(db, 'users', customerUser.uid), snap => {
      const data = snap.data() as { displayName?: string; username?: string } | undefined
      setCustomerName(data?.username || data?.displayName || customerUser.displayName || 'Adventurer')
    }, err => console.error('[Navbar] users/{uid} listener failed:', err))
    return unsub
  }, [customerUser])

  async function handleLogout() {
    await signOutCustomer()
    router.push('/')
  }

  function menuItemStyle(active: boolean, danger?: boolean) {
    return {
      display: 'block',
      width: '100%',
      textAlign: 'left' as const,
      padding: '0.75rem 1.1rem',
      fontSize: '0.74rem',
      letterSpacing: '0.05em',
      textTransform: 'uppercase' as const,
      fontFamily: 'var(--font-inter)',
      color: active ? (danger ? 'var(--red)' : 'var(--teal)') : 'rgba(245,242,236,0.7)',
      backgroundColor: active ? 'rgba(255,255,255,0.04)' : 'transparent',
      textDecoration: 'none',
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    }
  }

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])

  useEffect(() => { setOpen(false) }, [pathname])

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  const logoWidth  = isMobile ? 70  : scrolled ? 80  : 110
  const logoHeight = isMobile ? 47  : scrolled ? 54  : 74

  return (
    <>
      <nav style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        zIndex: 50,
        display: isMobile ? 'flex' : 'grid',
        gridTemplateColumns: isMobile ? undefined : '1fr auto 1fr',
        alignItems: 'center',
        justifyContent: isMobile ? 'space-between' : undefined,
        padding: isMobile ? '0.8rem 1.2rem' : scrolled ? '0.6rem 2rem' : '1rem 2rem',
        backgroundColor: scrolled || open ? 'rgba(5,5,5,0.95)' : 'transparent',
        backdropFilter: scrolled || open ? 'blur(20px)' : 'none',
        WebkitBackdropFilter: scrolled || open ? 'blur(20px)' : 'none',
        borderBottom: scrolled || open ? '1px solid rgba(255,255,255,0.06)' : 'none',
        transition: 'all 0.3s ease',
      }}>

        {/* Logo */}
        <Link href="/" style={{ flexShrink: 0, zIndex: 51, justifySelf: isMobile ? undefined : 'start' }}>
          <Image
            src={BRAND.logoUrl}
            alt={BRAND.name}
            width={logoWidth}
            height={logoHeight}
            priority
            style={{ transition: 'all 0.3s ease' }}
          />
        </Link>

        {/* Desktop Nav — middle/right sit in their own grid columns (see
            gridTemplateColumns above) so the links are dead-centered on the
            full nav width, regardless of how wide the logo or right-hand
            button group are. */}
        {!isMobile && (
          <>
            <ul style={{
              display: 'flex',
              gap: '2.5rem',
              listStyle: 'none',
              margin: 0,
              padding: 0,
              justifySelf: 'center',
            }}>
              {LINKS.map(({ href, label }) => {
                const active = isActive(href)
                const lit    = hoveredLink === href || active
                return (
                  <li key={href}>
                    <Link href={href}
                      onMouseEnter={() => setHoveredLink(href)}
                      onMouseLeave={() => setHoveredLink(null)}
                      style={{
                        color: lit ? '#fff' : 'rgba(245,242,236,0.55)',
                        textDecoration: 'none',
                        fontSize: '0.75rem',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        fontFamily: 'var(--font-inter)',
                        position: 'relative',
                        paddingBottom: '4px',
                        transition: 'color 0.2s ease',
                      }}>
                      {label}
                      <span style={{
                        position: 'absolute',
                        bottom: 0, left: 0,
                        width: lit ? '100%' : '0%',
                        height: '1px',
                        backgroundColor: 'var(--teal)',
                        transition: 'width 0.25s ease',
                        display: 'block',
                      }} />
                    </Link>
                  </li>
                )
              })}
            </ul>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifySelf: 'end' }}>
              {!customerLoading && customerUser && (
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => setNotifOpen(true)}
                  onMouseLeave={() => setNotifOpen(false)}
                >
                  <button aria-label="Notifications" style={{
                    position: 'relative',
                    background: 'transparent',
                    border: '1px solid rgba(245,242,236,0.25)',
                    color: 'rgba(245,242,236,0.8)',
                    width: '38px', height: '38px',
                    borderRadius: '2px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0,
                  }}>
                    <FontAwesomeIcon icon={faBell} style={{ width: '14px' }} />
                    {totalNotifCount > 0 && (
                      <span style={{
                        position: 'absolute', top: '-4px', right: '-4px',
                        backgroundColor: 'var(--red)', color: '#fff',
                        fontSize: '0.6rem', fontFamily: 'var(--font-inter)',
                        minWidth: '16px', height: '16px', borderRadius: '8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                      }}>{totalNotifCount}</span>
                    )}
                  </button>

                  <div style={{
                    position: 'absolute', top: '100%', right: 0, paddingTop: '0.5rem', zIndex: 60,
                    opacity: notifOpen ? 1 : 0, visibility: notifOpen ? 'visible' : 'hidden',
                    transition: 'opacity 0.18s ease',
                  }}>
                    <div style={{
                      width: '310px', maxHeight: '420px', overflowY: 'auto',
                      backgroundColor: 'rgba(8,8,8,0.98)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '2px', boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                    }}>
                      {totalNotifCount === 0 ? (
                        <p style={{ padding: '1rem', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)' }}>
                          No notifications
                        </p>
                      ) : (
                        <>
                          {/* Friend requests */}
                          {friendRequests.map(req => {
                            const busy = friendBusyId === req.id
                            return (
                              <div key={req.id} style={{ padding: '0.8rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#C9962C', marginBottom: '0.3rem' }}>
                                  Friend Request
                                </p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                                  {req.fromAvatar ? (
                                    <img src={req.fromAvatar} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                                  ) : (
                                    <span style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#1a1a1a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'rgba(245,242,236,0.5)', flexShrink: 0 }}>
                                      {req.fromName.charAt(0).toUpperCase()}
                                    </span>
                                  )}
                                  <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.83rem', color: 'var(--offwhite)' }}>
                                    {req.fromName}
                                  </p>
                                </div>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                  <button onClick={() => handleFriendAccept(req)} disabled={busy} style={{
                                    flex: 1, backgroundColor: '#C9962C', color: '#fff', border: 'none',
                                    padding: '0.4rem', borderRadius: '2px', fontSize: '0.68rem', letterSpacing: '0.04em',
                                    textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                                    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
                                  }}>Accept</button>
                                  <button onClick={() => handleFriendDecline(req)} disabled={busy} style={{
                                    flex: 1, background: 'transparent', color: 'var(--red)', border: '1px solid rgba(228,51,41,0.3)',
                                    padding: '0.4rem', borderRadius: '2px', fontSize: '0.68rem', letterSpacing: '0.04em',
                                    textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                                    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
                                  }}>Decline</button>
                                </div>
                              </div>
                            )
                          })}

                          {/* Participant invites */}
                          {pendingInvites.map(invite => {
                            const busy = inviteBusyId === invite.id
                            return (
                              <div key={invite.id} style={{ padding: '0.8rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.2rem' }}>
                                  {INVITE_TYPE_LABELS[invite.reservationType]} Invite
                                </p>
                                <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>
                                  {invite.reservationLabel}
                                </p>
                                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.45)', marginTop: '0.15rem', marginBottom: '0.6rem' }}>
                                  {invite.reservationDate} · by {invite.inviterName}
                                </p>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                  <button onClick={() => handleInviteAccept(invite)} disabled={busy} style={{
                                    flex: 1, backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
                                    padding: '0.4rem', borderRadius: '2px', fontSize: '0.68rem', letterSpacing: '0.04em',
                                    textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                                    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
                                  }}>Accept</button>
                                  <button onClick={() => handleInviteDecline(invite)} disabled={busy} style={{
                                    flex: 1, background: 'transparent', color: 'var(--red)', border: '1px solid rgba(228,51,41,0.3)',
                                    padding: '0.4rem', borderRadius: '2px', fontSize: '0.68rem', letterSpacing: '0.04em',
                                    textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                                    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
                                  }}>Decline</button>
                                </div>
                              </div>
                            )
                          })}

                          {/* Reservation status updates */}
                          {statusNotifications.map(n => {
                            const approved = n.type === 'reservation_approved'
                            return (
                              <div key={n.id} style={{ padding: '0.8rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: approved ? '#2ECC71' : 'var(--red)', marginBottom: '0.2rem' }}>
                                    {approved ? '✓ Approved' : '✕ Rejected'} · {RESERVATION_TYPE_LABELS[n.reservationType]}
                                  </p>
                                  <button onClick={() => handleDismissNotif(n)} title="Dismiss" style={{
                                    background: 'transparent', border: 'none', color: 'rgba(245,242,236,0.3)',
                                    fontSize: '0.8rem', cursor: 'pointer', padding: '0 0 0 0.5rem', lineHeight: 1,
                                  }}>✕</button>
                                </div>
                                <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>
                                  {n.label}
                                </p>
                                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.45)', marginTop: '0.15rem' }}>
                                  {n.dateLabel}
                                </p>
                                {!approved && n.rejectionReason && (
                                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(228,51,41,0.7)', marginTop: '0.2rem' }}>
                                    "{n.rejectionReason}"
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {!customerLoading && (
                customerUser ? (
                  <div
                    style={{ position: 'relative' }}
                    onMouseEnter={() => setProfileMenuOpen(true)}
                    onMouseLeave={() => { setProfileMenuOpen(false); setHoveredMenuItem(null) }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      border: '1px solid rgba(245,242,236,0.25)',
                      color: 'rgba(245,242,236,0.8)',
                      padding: '0.58rem 1.2rem',
                      borderRadius: '2px',
                      fontSize: '0.75rem',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontFamily: 'var(--font-inter)',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>
                      Welcome, {customerName ?? '…'}
                      <FontAwesomeIcon icon={faChevronDown} style={{
                        width: '9px',
                        transform: profileMenuOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s ease',
                      }} />
                    </div>

                    {/* Dropdown — wrapper starts flush against the trigger's
                        bottom edge with paddingTop (not marginTop) so there's
                        no real gap in the hoverable area between them. */}
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      paddingTop: '0.5rem',
                      zIndex: 60,
                      opacity: profileMenuOpen ? 1 : 0,
                      visibility: profileMenuOpen ? 'visible' : 'hidden',
                      transition: 'opacity 0.18s ease',
                    }}>
                      <div style={{
                        minWidth: '170px',
                        backgroundColor: 'rgba(8,8,8,0.98)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '2px',
                        overflow: 'hidden',
                        boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                      }}>
                        <Link href="/customer/profile"
                          onMouseEnter={() => setHoveredMenuItem('profile')}
                          onMouseLeave={() => setHoveredMenuItem(null)}
                          style={{ ...menuItemStyle(hoveredMenuItem === 'profile'), borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          See Profile
                        </Link>
                        <button
                          onClick={handleLogout}
                          onMouseEnter={() => setHoveredMenuItem('logout')}
                          onMouseLeave={() => setHoveredMenuItem(null)}
                          style={menuItemStyle(hoveredMenuItem === 'logout', true)}>
                          Logout
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Link href="/customer/login"
                    onMouseEnter={() => setAuthHovered(true)}
                    onMouseLeave={() => setAuthHovered(false)}
                    style={{
                      backgroundColor: 'transparent',
                      border: `1px solid ${authHovered ? 'var(--teal)' : 'rgba(245,242,236,0.25)'}`,
                      color: authHovered ? 'var(--teal)' : 'rgba(245,242,236,0.7)',
                      padding: '0.58rem 1.3rem',
                      borderRadius: '2px',
                      fontSize: '0.75rem',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      textDecoration: 'none',
                      fontFamily: 'var(--font-inter)',
                      transition: 'all 0.2s ease',
                      flexShrink: 0,
                    }}>
                    Login
                  </Link>
                )
              )}

              {isStaff ? (
                <Link href="/admin"
                  onMouseEnter={() => setBtnHovered(true)}
                  onMouseLeave={() => setBtnHovered(false)}
                  style={{
                    position: 'relative', overflow: 'hidden',
                    backgroundColor: btnHovered ? 'rgba(0,160,152,0.15)' : 'var(--teal)',
                    color: '#fff', padding: '0.6rem 1.5rem', borderRadius: '2px',
                    fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase',
                    textDecoration: 'none', fontFamily: 'var(--font-inter)',
                    border: '1px solid var(--teal)', backdropFilter: btnHovered ? 'blur(10px)' : 'none',
                    transition: 'all 0.3s ease', display: 'inline-block', flexShrink: 0,
                  }}>
                  CMS
                </Link>
              ) : (
                <div
                  style={{ position: 'relative', flexShrink: 0 }}
                  onMouseEnter={() => setContactMenuOpen(true)}
                  onMouseLeave={() => { setContactMenuOpen(false); setHoveredContactItem(null) }}
                >
                  <button style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    backgroundColor: 'var(--teal)', color: '#fff',
                    padding: '0.6rem 1.5rem', borderRadius: '2px',
                    fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase',
                    fontFamily: 'var(--font-inter)', border: '1px solid var(--teal)', cursor: 'pointer',
                  }}>
                    Contact Us
                    <FontAwesomeIcon icon={faChevronDown} style={{
                      width: '9px',
                      transform: contactMenuOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s ease',
                    }} />
                  </button>

                  <div style={{
                    position: 'absolute', top: '100%', right: 0, paddingTop: '0.5rem', zIndex: 60,
                    opacity: contactMenuOpen ? 1 : 0, visibility: contactMenuOpen ? 'visible' : 'hidden',
                    transition: 'opacity 0.18s ease',
                  }}>
                    <div style={{
                      minWidth: '180px', backgroundColor: 'rgba(8,8,8,0.98)',
                      border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px',
                      overflow: 'hidden', boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                    }}>
                      <Link href="/tables"
                        onMouseEnter={() => setHoveredContactItem('reserve')}
                        onMouseLeave={() => setHoveredContactItem(null)}
                        style={{ ...menuItemStyle(hoveredContactItem === 'reserve'), borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        Reserve a Table
                      </Link>
                      <Link href="/#branches-section"
                        onMouseEnter={() => setHoveredContactItem('contact')}
                        onMouseLeave={() => setHoveredContactItem(null)}
                        style={menuItemStyle(hoveredContactItem === 'contact')}>
                        Contact Us
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Mobile Hamburger */}
        {isMobile && (
          <button
            onClick={() => setOpen(!open)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              padding: '4px',
              zIndex: 51,
            }}>
            <span style={{
              display: 'block', width: '24px', height: '2px',
              backgroundColor: 'var(--offwhite)',
              transition: 'all 0.3s ease',
              transform: open ? 'rotate(45deg) translate(5px, 5px)' : 'none',
            }} />
            <span style={{
              display: 'block', width: '24px', height: '2px',
              backgroundColor: 'var(--offwhite)',
              transition: 'all 0.3s ease',
              opacity: open ? 0 : 1,
            }} />
            <span style={{
              display: 'block', width: '24px', height: '2px',
              backgroundColor: 'var(--offwhite)',
              transition: 'all 0.3s ease',
              transform: open ? 'rotate(-45deg) translate(5px, -5px)' : 'none',
            }} />
          </button>
        )}
      </nav>

      {/* Mobile Menu Overlay */}
      {isMobile && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(5,5,5,0.98)',
          zIndex: 49,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2.5rem',
          transition: 'opacity 0.3s ease, transform 0.3s ease',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0)' : 'translateY(-10px)',
          pointerEvents: open ? 'auto' : 'none',
        }}>
          {LINKS.map(({ href, label }) => {
            const active = isActive(href)
            return (
              <Link key={href} href={href}
                onClick={() => setOpen(false)}
                style={{
                  fontFamily: 'var(--font-cinzel)',
                  fontSize: '1.5rem',
                  color: active ? 'var(--teal)' : 'var(--offwhite)',
                  textDecoration: 'none',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  transition: 'color 0.2s',
                }}>
                {label}
              </Link>
            )
          })}

          {!customerLoading && (
            customerUser ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                {totalNotifCount > 0 && (
                  <Link href="/customer/profile" onClick={() => setOpen(false)} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    backgroundColor: 'rgba(228,51,41,0.12)', border: '1px solid rgba(228,51,41,0.3)',
                    color: 'var(--red)', padding: '0.5rem 1rem', borderRadius: '20px',
                    fontSize: '0.78rem', fontFamily: 'var(--font-inter)', textDecoration: 'none',
                  }}>
                    <FontAwesomeIcon icon={faBell} style={{ width: '12px' }} />
                    {totalNotifCount} notification{totalNotifCount === 1 ? '' : 's'}
                  </Link>
                )}
                <p style={{
                  fontFamily: 'var(--font-cinzel)',
                  fontSize: '1.1rem',
                  color: 'var(--teal)',
                  letterSpacing: '0.05em',
                  textAlign: 'center',
                }}>
                  Welcome, {customerName ?? '…'}
                </p>
                <Link href="/customer/profile"
                  onClick={() => setOpen(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(245,242,236,0.3)',
                    color: 'var(--offwhite)',
                    padding: '0.8rem 2.5rem',
                    borderRadius: '2px',
                    fontSize: '0.85rem',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    textDecoration: 'none',
                    fontFamily: 'var(--font-inter)',
                  }}>
                  See Profile
                </Link>
                <button
                  onClick={() => { setOpen(false); handleLogout() }}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(228,51,41,0.4)',
                    color: 'var(--red)',
                    padding: '0.8rem 2.5rem',
                    borderRadius: '2px',
                    fontSize: '0.85rem',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    fontFamily: 'var(--font-inter)',
                    cursor: 'pointer',
                  }}>
                  Logout
                </button>
              </div>
            ) : (
              <Link href="/customer/login"
                onClick={() => setOpen(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(245,242,236,0.3)',
                  color: 'var(--offwhite)',
                  padding: '0.8rem 2.5rem',
                  borderRadius: '2px',
                  fontSize: '0.85rem',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-inter)',
                }}>
                Login
              </Link>
            )
          )}

          {isStaff ? (
            <Link href="/admin" onClick={() => setOpen(false)} style={{
              marginTop: '1rem', backgroundColor: 'var(--teal)', color: '#fff',
              padding: '0.9rem 3rem', borderRadius: '2px', fontSize: '0.85rem',
              letterSpacing: '0.15em', textTransform: 'uppercase', textDecoration: 'none', fontFamily: 'var(--font-inter)',
            }}>CMS</Link>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', alignItems: 'center', marginTop: '1rem' }}>
              <Link href="/tables" onClick={() => setOpen(false)} style={{
                backgroundColor: 'var(--teal)', color: '#fff',
                padding: '0.9rem 3rem', borderRadius: '2px', fontSize: '0.85rem',
                letterSpacing: '0.15em', textTransform: 'uppercase', textDecoration: 'none', fontFamily: 'var(--font-inter)',
              }}>Reserve a Table</Link>
              <Link href="/#branches-section" onClick={() => setOpen(false)} style={{
                background: 'transparent', border: '1px solid rgba(0,160,152,0.4)', color: 'var(--teal)',
                padding: '0.9rem 3rem', borderRadius: '2px', fontSize: '0.85rem',
                letterSpacing: '0.15em', textTransform: 'uppercase', textDecoration: 'none', fontFamily: 'var(--font-inter)',
              }}>Contact Us</Link>
            </div>
          )}
        </div>
      )}
    </>
  )
}