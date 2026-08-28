'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  doc, onSnapshot, updateDoc,
  collection, query, where, orderBy, limit, type Timestamp,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useCustomerUser, signOutCustomer, resendVerificationEmail, refreshEmailVerified } from '../../../lib/customerAuth'
import { useIsMobile } from '../../../lib/useIsMobile'
import { useUserRedemptions, cancelRedemption, type Redemption } from '../../../lib/redemptions'
import { cancelTransaction } from '../../../lib/loyalty'
import { useUserEventReservations } from '../../../lib/eventReservations'
import { useUserTableReservations } from '../../../lib/tableReservations'
import { usePendingInvites, acceptInvite, declineInvite, type ParticipantInvite } from '../../../lib/participantInvites'
import Skeleton from '../../../components/Skeleton'
import { getTier, tierColor as colorForTier } from '../../../lib/loyaltyTiers'
import { useTierPerks, TIER_ORDER } from '../../../lib/tierPerks'
import { resolveBranchName } from '../../../lib/branches'
import { PLACEHOLDER_AVATARS } from '../../../lib/placeholderAssets'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faPen, faReceipt, faCalendarDay, type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'

interface CustomerProfile {
  username: string
  displayName: string
  email: string
  avatarUrl: string
  themeId: string
  pointsEarned: number
  level: number
  levelTitle: string
  points: number
  badges: string[]
}

interface Transaction {
  id: string
  type: 'check' | 'event'
  userId: string[]
  pointsAmount: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  submittedBy: string
  approvedBy?: string
  checkPhotoUrl?: string
  checkNumber?: string
  branchId: string
  createdAt: Timestamp | null
}

const TYPE_INFO: Record<Transaction['type'], { label: string; icon: IconDefinition }> = {
  check: { label: 'Check',        icon: faReceipt },
  event: { label: 'Event',        icon: faCalendarDay },
}

// Legacy 'dnd' transactions predate the D&D modules' removal and still read
// back out of Firestore. See the same fallback in the admin approvals queue.
const UNKNOWN_TYPE = { label: 'Attendance', icon: faCalendarDay }

const STATUS_COLORS: Record<Transaction['status'], string> = {
  pending:   '#E5A33D',
  approved:  '#2ECC71',
  rejected:  'var(--red)',
  cancelled: 'rgba(245,242,236,0.35)',
}

const REDEMPTION_STATUS_COLORS: Record<Redemption['status'], string> = {
  pending:   '#E5A33D',
  redeemed:  '#2ECC71',
  rejected:  'var(--red)',
  cancelled: 'rgba(245,242,236,0.35)',
}

// Shared by the Events and Tables tabs. Was keyed off the D&D Reservation
// type, which is gone; both remaining reservation kinds use the same three
// statuses, so the union is spelled out here rather than borrowed from one of
// them arbitrarily.
const RESERVATION_STATUS_COLORS: Record<'pending' | 'approved' | 'rejected', string> = {
  pending:  '#E5A33D',
  approved: '#2ECC71',
  rejected: 'var(--red)',
}

function formatSessionDateTime(ts: Timestamp): string {
  return ts.toDate().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Theme {
  id: string
  label: string
  background: string
  accent: string
}

const THEMES: Theme[] = [
  // Was id 'dungeon'. Renamed with the D&D modules — accounts still storing
  // the old id fall through to DEFAULT_THEME, which is this same entry, so
  // nobody's saved theme visibly changes.
  { id: 'midnight',    label: 'Midnight',   background: '#1a1a2e', accent: '#16213e' },
  { id: 'forest',      label: 'Forest',     background: '#0F6E56', accent: '#1D9E75' },
  { id: 'arcane',      label: 'Arcane',     background: '#3C3489', accent: '#7F77DD' },
  { id: 'ember',       label: 'Ember',      background: '#854F0B', accent: '#EF9F27' },
  { id: 'siege',       label: 'Siege',      background: '#993C1D', accent: '#D85A30' },
  { id: 'ocean',       label: 'Ocean',      background: '#185FA5', accent: '#378ADD' },
  { id: 'ash',         label: 'Ash',        background: '#444441', accent: '#888780' },
  { id: 'blood-moon',  label: 'Blood Moon', background: '#4B1528', accent: '#D4537E' },
]

const DEFAULT_THEME = THEMES[0]

const PREMADE_AVATARS = PLACEHOLDER_AVATARS





function TransactionCard({
  tx, theme, isMobile, showStatus, showCheckDetails, showSplit, onImageClick, onCancel, cancelling,
}: {
  tx: Transaction
  theme: Theme
  isMobile: boolean
  showStatus?: boolean
  showCheckDetails?: boolean
  showSplit?: boolean
  onImageClick: (url: string) => void
  onCancel?: () => void
  cancelling?: boolean
}) {
  const info = TYPE_INFO[tx.type] ?? UNKNOWN_TYPE
  const [photoHovered, setPhotoHovered] = useState(false)
  const [cancelHovered, setCancelHovered] = useState(false)
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: isMobile ? '0.8rem' : '1rem',
      padding: isMobile ? '1rem' : '1.2rem',
      backgroundColor: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '4px',
      width: '100%',
    }}>
      <div style={{
        width: '40px', height: '40px',
        borderRadius: '50%',
        backgroundColor: `${theme.accent}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <FontAwesomeIcon icon={info.icon} style={{ width: '16px', color: theme.accent }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>{info.label}</p>
          {showStatus && (
            <span style={{
              fontSize: '0.62rem',
              padding: '0.2rem 0.6rem',
              borderRadius: '2px',
              backgroundColor: `${STATUS_COLORS[tx.status]}25`,
              color: STATUS_COLORS[tx.status],
              fontFamily: 'var(--font-inter)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>{tx.status}</span>
          )}
        </div>

        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)', marginTop: '0.3rem' }}>
          {resolveBranchName(tx.branchId)} · {formatDate(tx.createdAt)}
        </p>

        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--teal)' }}>+{tx.pointsAmount} points</span>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: theme.accent }}>+{tx.pointsAmount} Points</span>
        </div>

        {showSplit && tx.userId.length > 1 && (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', marginTop: '0.4rem' }}>
            Split with {tx.userId.length - 1} other{tx.userId.length - 1 === 1 ? '' : 's'}
          </p>
        )}

        {showCheckDetails && tx.type === 'check' && (tx.checkPhotoUrl || tx.checkNumber) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.6rem' }}>
            {tx.checkPhotoUrl && (
              <button
                onClick={() => onImageClick(tx.checkPhotoUrl!)}
                onMouseEnter={() => setPhotoHovered(true)}
                onMouseLeave={() => setPhotoHovered(false)}
                style={{
                  width: isMobile ? '60px' : '50px',
                  height: isMobile ? '60px' : '50px',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  border: `1px solid ${photoHovered ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  padding: 0,
                  cursor: 'pointer',
                  flexShrink: 0,
                  transform: photoHovered ? 'scale(1.05)' : 'scale(1)',
                  transition: 'all 0.2s ease',
                }}
              >
                <img src={tx.checkPhotoUrl} alt="Check" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            )}
            {tx.checkNumber && (
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.5)' }}>
                Check #{tx.checkNumber}
              </span>
            )}
          </div>
        )}

        {onCancel && tx.status === 'pending' && (
          <button onClick={onCancel} disabled={cancelling}
            onMouseEnter={() => setCancelHovered(true)}
            onMouseLeave={() => setCancelHovered(false)}
            style={{
              marginTop: '0.7rem',
              background: cancelHovered ? 'rgba(228,51,41,0.1)' : 'transparent',
              border: `1px solid ${cancelHovered ? 'var(--red)' : 'rgba(255,255,255,0.1)'}`,
              color: cancelHovered ? 'var(--red)' : 'rgba(245,242,236,0.5)',
              padding: '0.5rem 1rem',
              borderRadius: '2px',
              fontSize: '0.7rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: cancelling ? 'not-allowed' : 'pointer',
              opacity: cancelling ? 0.6 : 1,
              fontFamily: 'var(--font-inter)',
              transition: 'all 0.2s ease',
            }}>{cancelling ? 'Cancelling…' : 'Cancel'}</button>
        )}
      </div>
    </div>
  )
}

// Matches the hover treatment used by the home page's hero/nav buttons —
// background lightens to a translucent tint of `color` with a blur, plus a
// diagonal shine sweeps across. `color` must be a literal hex value (not a
// CSS var()) since the tint/glow below append alpha digits onto it directly.
function ActionButton({ href, label, color, variant = 'solid' }: {
  href: string
  label: string
  color: string
  variant?: 'solid' | 'outline'
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        flex: 1,
        display: 'block',
        textAlign: 'center',
        backgroundColor: hovered ? `${color}15` : (variant === 'solid' ? color : 'transparent'),
        color: variant === 'solid' || hovered ? '#fff' : 'rgba(245,242,236,0.7)',
        border: `1px solid ${hovered ? color : (variant === 'solid' ? color : 'rgba(255,255,255,0.1)')}`,
        padding: '0.9rem',
        borderRadius: '4px',
        fontSize: '0.8rem',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        fontFamily: 'var(--font-inter)',
        backdropFilter: hovered ? 'blur(10px)' : 'none',
        boxShadow: hovered ? `0 0 20px ${color}50, inset 0 0 20px ${color}15` : 'none',
        transition: 'all 0.3s ease',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 0,
        left: hovered ? '120%' : '-60%',
        width: '40%',
        height: '100%',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
        transform: 'skewX(-20deg)',
        transition: 'left 0.5s ease',
        pointerEvents: 'none',
      }} />
      {label}
    </Link>
  )
}

export default function CustomerProfilePage() {
  const router = useRouter()
  const isMobile = useIsMobile()
  const { user } = useCustomerUser()
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  // Lives in users/{uid}/private/contact, not the main profile doc — phone
  // number and the imgbb delete-hash aren't safe to expose to the broad
  // "any signed-in customer can read another user's doc" rule that friend
  // search and the leaderboard rely on (see firestore.rules).
  const [avatarHovered, setAvatarHovered] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  // Local copy rather than reading `user.emailVerified` directly — the
  // cached Auth object only refreshes on a real sign-in event, not when the
  // customer clicks the verification link in another tab, so refreshing
  // this needs an explicit reload() (see handleRefreshVerified below).
  const [emailVerified, setEmailVerified] = useState(true)
  const [resendingVerification, setResendingVerification] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)
  const [checkingVerified, setCheckingVerified] = useState(false)

  useEffect(() => {
    if (user) setEmailVerified(user.emailVerified)
  }, [user])

  async function handleResendVerification() {
    setResendingVerification(true)
    try {
      await resendVerificationEmail()
      setVerificationSent(true)
      setTimeout(() => setVerificationSent(false), 4000)
    } finally {
      setResendingVerification(false)
    }
  }

  async function handleCheckVerified() {
    setCheckingVerified(true)
    try {
      setEmailVerified(await refreshEmailVerified())
    } finally {
      setCheckingVerified(false)
    }
  }

  const [publicFeed, setPublicFeed]   = useState<Transaction[]>([])
  const [fullHistory, setFullHistory] = useState<Transaction[]>([])
  const [pending, setPending]         = useState<Transaction[]>([])
  const [loadingPublicFeed, setLoadingPublicFeed] = useState(true)
  const [privateTab, setPrivateTab]   = useState<'history' | 'pending' | 'redemptions' | 'events' | 'tables'>('history')
  const [viewingImage, setViewingImage] = useState<string | null>(null)

  // This page only ever shows the signed-in user's own profile right now —
  // there's no /customer/profile/[uid] route yet to view someone else's.
  // Written as a comparison rather than a hardcoded `true` so a future
  // shared-profile-view route can swap in a different profileUid without
  // touching the gating logic below.
  const profileUid = user?.uid ?? null
  const isOwnProfile = !!user && !!profileUid && user.uid === profileUid

  const { redemptions } = useUserRedemptions(isOwnProfile ? profileUid : null)
  const { reservations: eventReservations } = useUserEventReservations(isOwnProfile ? profileUid : null)
  const { reservations: tableReservations } = useUserTableReservations(isOwnProfile ? profileUid : null)
  const { invites } = usePendingInvites(isOwnProfile ? profileUid : null)
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [hoveredCancelId, setHoveredCancelId] = useState<string | null>(null)
  const [hoveredAcceptId, setHoveredAcceptId] = useState<string | null>(null)
  const [hoveredDeclineId, setHoveredDeclineId] = useState<string | null>(null)
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const [signOutHovered, setSignOutHovered] = useState(false)
  const [modalCloseHovered, setModalCloseHovered] = useState(false)
  const [hoveredAvatarOption, setHoveredAvatarOption] = useState<string | null>(null)
  const [hoveredThemeId, setHoveredThemeId] = useState<string | null>(null)

  async function handleAcceptInvite(invite: ParticipantInvite) {
    setBusyInviteId(invite.id)
    try { await acceptInvite(invite) } finally { setBusyInviteId(null) }
  }

  async function handleDeclineInvite(invite: ParticipantInvite) {
    setBusyInviteId(invite.id)
    try { await declineInvite(invite) } finally { setBusyInviteId(null) }
  }

  async function handleCancelTransaction(tx: Transaction) {
    if (!confirm('Cancel this submission? This can\'t be undone — you\'d need to resubmit from scratch.')) return
    setCancellingId(tx.id)
    try { await cancelTransaction(tx) } finally { setCancellingId(null) }
  }

  async function handleCancelRedemption(redemption: Redemption) {
    if (!confirm('Cancel this redemption request? This can\'t be undone.')) return
    setCancellingId(redemption.id)
    try { await cancelRedemption(redemption) } finally { setCancellingId(null) }
  }

  useEffect(() => {
    if (!user) return
    const ref = doc(db, 'users', user.uid)
    const unsub = onSnapshot(ref, snap => {
      setProfile(snap.data() as CustomerProfile)

      // This used to write `level`/`levelTitle` back from the browser whenever
      // they drifted from `xp`, so other screens could read them directly.
      //
      // Removed, because it forced those two fields to stay writable by the
      // account itself — and level gates the perks (10% off, free coffee,
      // priority event registration) and the avatar borders. `xp` is locked by
      // firestore.rules and always has been; level is *derived from xp*, so
      // leaving the derived value writable while pinning its own source meant
      // the cheaper field was the one worth attacking.
      //
      // Nothing needs the self-heal. getLevelFromXP() is pure, and every place
      // that gates on level now calls it. The stored copy is a denormalised
      // cache for admin list views, written only by staff paths.
    })
    return unsub
  }, [user])


  // Public feed — last 5 approved transactions. Visible regardless of whose
  // profile this is.
  useEffect(() => {
    if (!profileUid) return
    const q = query(
      collection(db, 'transactions'),
      where('userId', 'array-contains', profileUid),
      where('status', '==', 'approved'),
      orderBy('createdAt', 'desc'),
      limit(5)
    )
    const unsub = onSnapshot(q, snap => {
      setPublicFeed(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
      setLoadingPublicFeed(false)
    })
    return unsub
  }, [profileUid])

  // Private — full history (all statuses, no limit). Owner only.
  useEffect(() => {
    if (!isOwnProfile || !profileUid) return
    const q = query(
      collection(db, 'transactions'),
      where('userId', 'array-contains', profileUid),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, snap => {
      setFullHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
    })
    return unsub
  }, [isOwnProfile, profileUid])

  // Private — pending submissions only. Owner only.
  useEffect(() => {
    if (!isOwnProfile || !profileUid) return
    const q = query(
      collection(db, 'transactions'),
      where('userId', 'array-contains', profileUid),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, snap => {
      setPending(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
    })
    return unsub
  }, [isOwnProfile, profileUid])

  async function handleSignOut() {
    await signOutCustomer()
    router.replace('/customer/login')
  }

  async function handleSelectAvatar(url: string) {
    if (!user) return
    await updateDoc(doc(db, 'users', user.uid), { avatarUrl: url })
  }

  async function handleSelectTheme(themeId: string) {
    if (!user) return
    await updateDoc(doc(db, 'users', user.uid), { themeId })
  }

  const theme = THEMES.find(t => t.id === profile?.themeId) ?? DEFAULT_THEME
  const avatarSize = isMobile ? '80px' : '120px'
  const initials = (profile?.displayName || '?').trim().charAt(0).toUpperCase()
  const tierInfo = getTier(profile?.pointsEarned ?? 0)
  const tierColor = tierInfo.color
  const { perks } = useTierPerks()

  const sectionLabelStyle = {
    fontSize: '0.65rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase' as const,
    color: 'rgba(245,242,236,0.3)',
    fontFamily: 'var(--font-inter)',
    marginBottom: '1rem',
  }

  const emptyStateStyle = {
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: '4px',
    padding: isMobile ? '2rem 1rem' : '2.5rem',
    textAlign: 'center' as const,
    color: 'rgba(245,242,236,0.3)',
    fontFamily: 'var(--font-inter)',
    fontSize: '0.85rem',
  }

  if (!profile) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{
              padding: isMobile ? '2rem 1.25rem' : '3rem',
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'center' : 'flex-start',
              gap: isMobile ? '1.25rem' : '2rem',
            }}>
              <Skeleton width={avatarSize} height={avatarSize} borderRadius="50%" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1, width: isMobile ? '100%' : 'auto' }}>
                <Skeleton width="50%" height="1.5rem" />
                <Skeleton width="35%" height="1rem" />
                <Skeleton width="30%" height="1rem" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Profile Card */}
        <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>

          {/* Banner */}
          <div style={{
            position: 'relative',
            backgroundColor: theme.background,
            padding: isMobile ? '2rem 1.25rem' : '3rem',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : 'flex-start',
            gap: isMobile ? '1.25rem' : '2rem',
            textAlign: isMobile ? 'center' : 'left',
          }}>

            <button onClick={handleSignOut}
              onMouseEnter={() => setSignOutHovered(true)}
              onMouseLeave={() => setSignOutHovered(false)}
              style={{
                position: 'absolute',
                top: isMobile ? '0.8rem' : '1.2rem',
                right: isMobile ? '0.8rem' : '1.2rem',
                background: signOutHovered ? 'rgba(228,51,41,0.15)' : 'rgba(0,0,0,0.25)',
                border: `1px solid ${signOutHovered ? 'var(--red)' : 'rgba(255,255,255,0.25)'}`,
                color: signOutHovered ? 'var(--red)' : 'rgba(255,255,255,0.8)',
                padding: isMobile ? '0.5rem 0.9rem' : '0.6rem 1.2rem',
                borderRadius: '2px',
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'var(--font-inter)',
                transition: 'all 0.2s ease',
              }}>Sign Out</button>

            {/* Avatar — click to open the customize popup.
                The outer div used to carry a level-unlocked decorative border;
                that went with the rest of the level system. It stays as a plain
                ring in the profile's theme colour, which is what the inner
                button's overflow:hidden needs to sit inside anyway. */}
            <div style={{
              width: avatarSize, height: avatarSize, borderRadius: '50%',
              flexShrink: 0, padding: '3px', background: theme.accent, display: 'flex',
            }}>
            <button
              onClick={() => setModalOpen(true)}
              onMouseEnter={() => setAvatarHovered(true)}
              onMouseLeave={() => setAvatarHovered(false)}
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                overflow: 'hidden',
                border: 'none',
                backgroundColor: 'rgba(0,0,0,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                cursor: 'pointer',
              }}
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{
                  fontFamily: 'var(--font-cinzel)',
                  fontSize: isMobile ? '1.8rem' : '2.6rem',
                  color: 'rgba(245,242,236,0.5)',
                }}>{initials}</span>
              )}

              {/* Hover overlay (desktop) */}
              <div style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: avatarHovered ? 1 : 0,
                transition: 'opacity 0.2s ease',
              }}>
                <span style={{
                  color: '#fff',
                  fontSize: '0.7rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-inter)',
                }}>Edit</span>
              </div>

              {/* Persistent edit badge (always visible — covers touch/mobile, where hover doesn't apply) */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: isMobile ? '26px' : '30px',
                height: isMobile ? '26px' : '30px',
                borderRadius: '50%',
                backgroundColor: theme.accent,
                border: '2px solid var(--black)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <FontAwesomeIcon icon={faPen} style={{ width: '11px', color: '#fff' }} />
              </div>
            </button>
            </div>

            {/* Info */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              alignItems: isMobile ? 'center' : 'flex-start',
              minWidth: 0,
              width: isMobile ? '100%' : 'auto',
              flex: isMobile ? undefined : 1,
            }}>
              <h1 style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: isMobile ? '1.4rem' : '1.9rem',
                color: '#fff',
                wordBreak: 'break-word',
              }}>{profile.displayName || profile.username}</h1>

              <div style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: 'center',
                gap: isMobile ? '0.4rem' : '0.6rem',
              }}>
                <p style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.85rem',
                  color: 'rgba(255,255,255,0.75)',
                }}>
                  {tierInfo.tier} member
                </p>
                <span style={{
                  fontSize: '0.62rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '2px',
                  // Solid fill + white text + a dark outline, rather than a
                  // translucent tint of the tier color over the page's own
                  // background — a translucent badge reads fine on the
                  // admin's fixed dark background elsewhere in the app, but
                  // here it sits on one of 8 customer-chosen theme colors,
                  // several of which are close enough in hue to a tier color
                  // (e.g. Adventurer's teal-green vs. the Forest theme) that
                  // the badge nearly disappeared. A solid chip is legible
                  // against any background.
                  backgroundColor: tierColor,
                  color: '#fff',
                  border: '1px solid rgba(0,0,0,0.25)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>{profile.points?.toLocaleString() ?? 0} points</span>
              </div>

              {/* Progress toward the next tier. */}
              <div style={{ width: '100%', marginTop: '0.2rem', marginBottom: '0.3rem' }}>
                <div style={{
                  width: '100%',
                  height: '10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${tierInfo.progressPercent}%`,
                    backgroundColor: theme.accent,
                    borderRadius: '6px',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
                <p style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: isMobile ? '0.68rem' : '0.75rem',
                  color: 'rgba(255,255,255,0.55)',
                  marginTop: '0.4rem',
                }}>
                  {tierInfo.nextTier === null
                    ? `Top tier — ${(profile.pointsEarned ?? 0).toLocaleString()} points earned all time`
                    : `${tierInfo.pointsToNext.toLocaleString()} more points to ${tierInfo.nextTier}`}
                </p>
              </div>

              <p style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: '1.1rem',
                color: theme.accent,
              }}>
                {profile.points} Points
              </p>

              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.4rem',
                justifyContent: isMobile ? 'center' : 'flex-start',
                marginTop: '0.3rem',
              }}>
                {profile.badges && profile.badges.length > 0 ? (
                  profile.badges.map(badge => (
                    <span key={badge} style={{
                      fontSize: '0.68rem',
                      padding: '0.25rem 0.7rem',
                      borderRadius: '2px',
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      color: '#fff',
                      fontFamily: 'var(--font-inter)',
                      letterSpacing: '0.05em',
                    }}>{badge}</span>
                  ))
                ) : (
                  <span style={{
                    fontSize: '0.78rem',
                    color: 'rgba(255,255,255,0.45)',
                    fontFamily: 'var(--font-inter)',
                  }}>No badges yet</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Your Perks — every perk staff have configured (admin/loyalty/
            perks), with which ones this account has actually reached.
            Owner-only: it's framed around "what's unlocked for *you*",
            not a general public perks list (that's app/loyalty/page.tsx). */}
        {isOwnProfile && perks.length > 0 && (
          <div>
            <p style={sectionLabelStyle}>Your Perks</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {perks.map(p => {
                const unlocked = TIER_ORDER.indexOf(tierInfo.tier) >= TIER_ORDER.indexOf(p.tier)
                const color = colorForTier(p.tier)
                return (
                  <div key={p.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: isMobile ? '0.8rem 1rem' : '0.9rem 1.2rem',
                    backgroundColor: unlocked ? `${color}0d` : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${unlocked ? `${color}40` : 'rgba(255,255,255,0.06)'}`,
                    borderLeft: `3px solid ${unlocked ? color : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: '4px',
                    opacity: unlocked ? 1 : 0.55,
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-cinzel)',
                      fontSize: '0.85rem',
                      color: unlocked ? color : 'rgba(245,242,236,0.4)',
                      minWidth: isMobile ? '45px' : '55px',
                      flexShrink: 0,
                    }}>{p.tier}</span>
                    <p style={{
                      flex: 1,
                      fontFamily: 'var(--font-inter)',
                      fontSize: isMobile ? '0.78rem' : '0.85rem',
                      color: unlocked ? 'rgba(245,242,236,0.8)' : 'rgba(245,242,236,0.4)',
                    }}>{p.perk}</p>
                    <span style={{
                      fontSize: '0.62rem',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '2px',
                      backgroundColor: unlocked ? `${color}25` : 'rgba(255,255,255,0.06)',
                      color: unlocked ? color : 'rgba(245,242,236,0.35)',
                      fontFamily: 'var(--font-inter)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>{unlocked ? 'Unlocked' : 'Locked'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Email verification reminder — only the email/password signup path
            can ever be unverified; a Google sign-in is already verified by
            Google itself. Submitting checks and redeeming coins are gated
            on this (see those pages) — everything else here still works. */}
        {!emailVerified && (
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: 'space-between',
            alignItems: isMobile ? 'stretch' : 'center',
            gap: '0.8rem',
            padding: isMobile ? '1rem' : '1.2rem',
            backgroundColor: 'rgba(229,163,61,0.08)',
            border: '1px solid rgba(229,163,61,0.3)',
            borderRadius: '4px',
          }}>
            <div>
              <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.85rem', color: '#E5A33D' }}>
                Verify your email
              </p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)', marginTop: '0.2rem' }}>
                {verificationSent
                  ? `Sent to ${profile.email} — check your inbox, then tap "I've Verified."`
                  : 'Submitting checks and redeeming Points are locked until you verify your email.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
              <button onClick={handleResendVerification} disabled={resendingVerification} style={{
                flex: isMobile ? 1 : 'initial',
                background: 'transparent', border: '1px solid rgba(229,163,61,0.4)', color: '#E5A33D',
                padding: '0.6rem 1.1rem', borderRadius: '2px', fontSize: '0.72rem',
                letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                cursor: resendingVerification ? 'not-allowed' : 'pointer', opacity: resendingVerification ? 0.6 : 1,
              }}>{resendingVerification ? 'Sending…' : 'Resend Email'}</button>
              <button onClick={handleCheckVerified} disabled={checkingVerified} style={{
                flex: isMobile ? 1 : 'initial',
                backgroundColor: '#E5A33D', color: '#000', border: 'none',
                padding: '0.6rem 1.1rem', borderRadius: '2px', fontSize: '0.72rem',
                letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                cursor: checkingVerified ? 'not-allowed' : 'pointer', opacity: checkingVerified ? 0.6 : 1,
              }}>{checkingVerified ? 'Checking…' : "I've Verified"}</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '0.8rem' }}>
          <ActionButton href="/customer/submit-check" label="Submit a Check" color="#6A6AB7" />
          <ActionButton href="/customer/redeem" label="Redeem Points" color="#00A098" />
          <ActionButton href="/customer/friends" label="Friends" color="#00A098" variant="outline" />
        </div>

        {/* Pending Invites — someone added you (by account) to their event
            reservation and you haven't responded yet. */}
        {invites.length > 0 && (
          <div>
            <p style={sectionLabelStyle}>Pending Invites</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {invites.map(invite => {
                const isBusy = busyInviteId === invite.id
                return (
                  <div key={invite.id} style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    justifyContent: 'space-between',
                    alignItems: isMobile ? 'stretch' : 'center',
                    gap: '0.8rem',
                    padding: isMobile ? '1rem' : '1.2rem',
                    backgroundColor: 'rgba(106,106,183,0.06)',
                    border: '1px solid rgba(106,106,183,0.2)',
                    borderRadius: '4px',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>
                        {invite.reservationLabel}
                      </p>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)', marginTop: '0.2rem' }}>
                        {invite.reservationDate} · invited by {invite.inviterName}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                      <button
                        onClick={() => handleAcceptInvite(invite)}
                        disabled={isBusy}
                        onMouseEnter={() => setHoveredAcceptId(invite.id)}
                        onMouseLeave={() => setHoveredAcceptId(null)}
                        style={{
                          flex: isMobile ? 1 : 'initial',
                          backgroundColor: !isBusy && hoveredAcceptId === invite.id ? 'rgba(0,160,152,0.8)' : 'var(--teal)', color: '#fff', border: 'none',
                          padding: '0.6rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem',
                          letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                          cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1,
                          boxShadow: !isBusy && hoveredAcceptId === invite.id ? '0 6px 14px rgba(0,160,152,0.4)' : 'none',
                          transition: 'all 0.2s ease',
                        }}>Accept</button>
                      <button
                        onClick={() => handleDeclineInvite(invite)}
                        disabled={isBusy}
                        onMouseEnter={() => setHoveredDeclineId(invite.id)}
                        onMouseLeave={() => setHoveredDeclineId(null)}
                        style={{
                          flex: isMobile ? 1 : 'initial',
                          background: !isBusy && hoveredDeclineId === invite.id ? 'rgba(228,51,41,0.1)' : 'transparent',
                          border: `1px solid ${!isBusy && hoveredDeclineId === invite.id ? 'var(--red)' : 'rgba(228,51,41,0.3)'}`,
                          color: 'var(--red)',
                          padding: '0.6rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem',
                          letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                          cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1,
                          transition: 'all 0.2s ease',
                        }}>Decline</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Public Activity Feed — last 5 approved transactions, visible to anyone */}
        <div>
          <p style={sectionLabelStyle}>Recent Activity</p>
          {loadingPublicFeed ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {[0, 1].map(i => <Skeleton key={i} height="76px" borderRadius="4px" />)}
            </div>
          ) : publicFeed.length === 0 ? (
            <div style={emptyStateStyle}>No activity yet — come visit us!</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {publicFeed.map(tx => (
                <TransactionCard key={tx.id} tx={tx} theme={theme} isMobile={isMobile} onImageClick={setViewingImage} />
              ))}
            </div>
          )}
        </div>

        {/* Private — full history + pending submissions. Owner only. */}
        {isOwnProfile && (
          <div>
            <p style={sectionLabelStyle}>Your History</p>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {(['history', 'pending', 'redemptions', 'events', 'tables'] as const).map(tab => {
                const active = privateTab === tab
                const hov = hoveredTab === tab
                return (
                  <button
                    key={tab}
                    onClick={() => setPrivateTab(tab)}
                    onMouseEnter={() => setHoveredTab(tab)}
                    onMouseLeave={() => setHoveredTab(null)}
                    style={{
                      backgroundColor: active ? theme.accent : hov ? `${theme.accent}25` : 'transparent',
                      border: `1px solid ${active || hov ? theme.accent : 'rgba(255,255,255,0.1)'}`,
                      color: active ? '#fff' : hov ? 'var(--offwhite)' : 'rgba(245,242,236,0.5)',
                      padding: isMobile ? '0.55rem 0.8rem' : '0.6rem 1.2rem',
                      borderRadius: '2px',
                      fontSize: isMobile ? '0.7rem' : '0.75rem',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-inter)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {tab === 'history' ? 'Full History' : tab === 'pending' ? `Pending${pending.length > 0 ? ` (${pending.length})` : ''}` : tab === 'redemptions' ? 'Redemptions' : tab === 'events' ? 'Events' : 'Tables'}
                  </button>
                )
              })}
            </div>

            {privateTab === 'history' ? (
              fullHistory.length === 0 ? (
                <div style={emptyStateStyle}>Your adventure hasn&apos;t started yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {fullHistory.map(tx => (
                    <TransactionCard
                      key={tx.id} tx={tx} theme={theme} isMobile={isMobile}
                      showStatus showCheckDetails showSplit onImageClick={setViewingImage}
                    />
                  ))}
                </div>
              )
            ) : privateTab === 'pending' ? (
              pending.length === 0 ? (
                <div style={emptyStateStyle}>No pending submissions</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {pending.map(tx => (
                    <TransactionCard
                      key={tx.id} tx={tx} theme={theme} isMobile={isMobile}
                      showStatus onImageClick={setViewingImage}
                      cancelling={cancellingId === tx.id}
                      onCancel={tx.submittedBy === user?.uid ? () => handleCancelTransaction(tx) : undefined}
                    />
                  ))}
                </div>
              )
            ) : privateTab === 'redemptions' ? (
              redemptions.length === 0 ? (
                <div style={emptyStateStyle}>No redemption requests yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {redemptions.map(r => (
                    <div key={r.id} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: isMobile ? '0.8rem' : '1rem',
                      padding: isMobile ? '1rem' : '1.2rem',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '4px',
                      width: '100%',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>{r.itemName}</p>
                          <span style={{
                            fontSize: '0.62rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '2px',
                            backgroundColor: `${REDEMPTION_STATUS_COLORS[r.status]}25`,
                            color: REDEMPTION_STATUS_COLORS[r.status],
                            fontFamily: 'var(--font-inter)',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}>{r.status}</span>
                        </div>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)', marginTop: '0.3rem' }}>
                          {r.itemDescription}
                        </p>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: theme.accent }}>-{r.coinCost} Points</span>
                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)' }}>
                            {resolveBranchName(r.branchId)} · {formatDate(r.createdAt)}
                          </span>
                        </div>
                        {r.status === 'rejected' && r.rejectionReason && (
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'var(--red)', marginTop: '0.4rem' }}>
                            Reason: {r.rejectionReason}
                          </p>
                        )}
                        {r.status === 'pending' && (
                          <button onClick={() => handleCancelRedemption(r)} disabled={cancellingId === r.id}
                            onMouseEnter={() => setHoveredCancelId(r.id)}
                            onMouseLeave={() => setHoveredCancelId(null)}
                            style={{
                              marginTop: '0.7rem',
                              background: hoveredCancelId === r.id ? 'rgba(228,51,41,0.1)' : 'transparent',
                              border: `1px solid ${hoveredCancelId === r.id ? 'var(--red)' : 'rgba(255,255,255,0.1)'}`,
                              color: hoveredCancelId === r.id ? 'var(--red)' : 'rgba(245,242,236,0.5)',
                              padding: '0.5rem 1rem',
                              borderRadius: '2px',
                              fontSize: '0.7rem',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              cursor: cancellingId === r.id ? 'not-allowed' : 'pointer',
                              opacity: cancellingId === r.id ? 0.6 : 1,
                              fontFamily: 'var(--font-inter)',
                              transition: 'all 0.2s ease',
                            }}>{cancellingId === r.id ? 'Cancelling…' : 'Cancel'}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : privateTab === 'events' ? (
              eventReservations.length === 0 ? (
                <div style={emptyStateStyle}>No event reservations yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {eventReservations.map(r => (
                    <div key={r.id} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: isMobile ? '0.8rem' : '1rem',
                      padding: isMobile ? '1rem' : '1.2rem',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '4px',
                      width: '100%',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>{r.eventTitle}</p>
                          <span style={{
                            fontSize: '0.62rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '2px',
                            backgroundColor: `${RESERVATION_STATUS_COLORS[r.status]}25`,
                            color: RESERVATION_STATUS_COLORS[r.status],
                            fontFamily: 'var(--font-inter)',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}>{r.status}</span>
                        </div>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)', marginTop: '0.3rem' }}>
                          📍 {r.branch} · {r.eventDate} · {r.eventTimeStart}–{r.eventTimeEnd}
                        </p>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', marginTop: '0.3rem' }}>
                          {r.partySize} {r.partySize === 1 ? 'person' : 'people'}
                        </p>
                        {r.status === 'rejected' && r.rejectionReason && (
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'var(--red)', marginTop: '0.4rem' }}>
                            Reason: {r.rejectionReason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              tableReservations.length === 0 ? (
                <div style={emptyStateStyle}>No table reservations yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {tableReservations.map(r => (
                    <div key={r.id} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: isMobile ? '0.8rem' : '1rem',
                      padding: isMobile ? '1rem' : '1.2rem',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '4px',
                      width: '100%',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>
                            Table{r.tableNumbers.length > 1 ? 's' : ''} {r.tableNumbers.join(', ')}
                          </p>
                          <span style={{
                            fontSize: '0.62rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '2px',
                            backgroundColor: `${RESERVATION_STATUS_COLORS[r.status]}25`,
                            color: RESERVATION_STATUS_COLORS[r.status],
                            fontFamily: 'var(--font-inter)',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}>{r.status}</span>
                        </div>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)', marginTop: '0.3rem' }}>
                          📍 {r.branch} · {formatSessionDateTime(r.startAt)}
                        </p>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', marginTop: '0.3rem' }}>
                          {r.partySize} {r.partySize === 1 ? 'person' : 'people'}
                        </p>
                        {r.status === 'rejected' && r.rejectionReason && (
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'var(--red)', marginTop: '0.4rem' }}>
                            Reason: {r.rejectionReason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>


      {/* Customize Profile Modal — avatar + border + theme color */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: isMobile ? '1.25rem' : '2rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#0d0d0d',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '4px',
              width: '100%',
              maxWidth: '480px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              padding: isMobile ? '1rem 1.25rem' : '1.25rem 1.75rem',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <h3 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '0.95rem' : '1.1rem', color: 'var(--offwhite)' }}>
                Customize Profile
              </h3>
              <button onClick={() => setModalOpen(false)}
                onMouseEnter={() => setModalCloseHovered(true)}
                onMouseLeave={() => setModalCloseHovered(false)}
                style={{
                  background: modalCloseHovered ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: `1px solid ${modalCloseHovered ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  color: modalCloseHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.5)',
                  padding: isMobile ? '0.35rem 0.7rem' : '0.4rem 1rem',
                  borderRadius: '2px',
                  fontSize: isMobile ? '0.65rem' : '0.72rem',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: 'all 0.2s ease',
                }}>✕ Close</button>
            </div>

            <div style={{
              padding: isMobile ? '1.25rem' : '1.75rem',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.75rem',
            }}>

              {/* Avatar picker */}
              <div>
                <p style={{
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: 'rgba(245,242,236,0.3)',
                  fontFamily: 'var(--font-inter)',
                  marginBottom: '1rem',
                }}>Choose an Avatar</p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '0.8rem',
                  marginBottom: '1rem',
                }}>
                  {PREMADE_AVATARS.map(avatar => {
                    const selected = profile.avatarUrl === avatar.url
                    const hov = hoveredAvatarOption === avatar.url
                    return (
                      <button
                        key={avatar.url}
                        onClick={() => handleSelectAvatar(avatar.url)}
                        onMouseEnter={() => setHoveredAvatarOption(avatar.url)}
                        onMouseLeave={() => setHoveredAvatarOption(null)}
                        style={{
                          aspectRatio: '1',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          padding: 0,
                          backgroundColor: '#1a1a1a',
                          border: selected ? `3px solid ${theme.accent}` : `2px solid ${hov ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
                          cursor: 'pointer',
                          transform: hov && !selected ? 'scale(1.06)' : 'scale(1)',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <img src={avatar.url} alt={avatar.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* Theme picker */}
              <div>
                <p style={{
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: 'rgba(245,242,236,0.3)',
                  fontFamily: 'var(--font-inter)',
                  marginBottom: '1rem',
                }}>Theme Color</p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '0.8rem',
                  justifyItems: 'center',
                }}>
                  {THEMES.map(t => {
                    const selected = t.id === profile.themeId
                    const hov = hoveredThemeId === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTheme(t.id)}
                        onMouseEnter={() => setHoveredThemeId(t.id)}
                        onMouseLeave={() => setHoveredThemeId(null)}
                        aria-label={t.label}
                        title={t.label}
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          backgroundColor: t.background,
                          border: selected ? `3px solid ${t.accent}` : `2px solid ${hov ? t.accent : 'rgba(255,255,255,0.15)'}`,
                          boxShadow: selected ? `0 0 0 2px #0d0d0d, 0 0 0 4px ${t.accent}` : 'none',
                          cursor: 'pointer',
                          padding: 0,
                          transform: hov && !selected ? 'scale(1.1)' : 'scale(1)',
                          transition: 'all 0.2s ease',
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen check photo viewer */}
      {viewingImage && (
        <div
          onClick={() => setViewingImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.9)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            cursor: 'pointer',
          }}
        >
          <img src={viewingImage} alt="Check" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }} />
        </div>
      )}
    </div>
  )
}
