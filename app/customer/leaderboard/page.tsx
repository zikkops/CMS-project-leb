'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  collection, doc, query, where, orderBy, limit, onSnapshot, getDocs,
  documentId, getCountFromServer,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useCustomerUser } from '../../lib/customerAuth'
import { useFriends } from '../../lib/friends'
import { useIsMobile } from '../../lib/useIsMobile'
import { getLevelFromXP, TIER_COLORS } from '../../lib/levelConfig'
import Navbar from '../../components/layout/Navbar'
import Footer from '../../components/layout/Footer'
import Reveal from '../../components/Reveal'
import Skeleton from '../../components/Skeleton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrophy, faMedal, faUserGroup } from '@fortawesome/free-solid-svg-icons'

const TOP_LIMIT = 50

interface LeaderboardEntry {
  uid: string
  displayName: string
  avatarUrl: string
  xp: number
  level: number
  levelTitle: string
  tier: string
}

function toEntry(uid: string, data: Record<string, unknown>): LeaderboardEntry {
  const xp = (data.xp as number) ?? 0
  const info = getLevelFromXP(xp)
  return {
    uid,
    displayName: (data.displayName as string) || (data.username as string) || 'Unnamed',
    avatarUrl: (data.avatarUrl as string) || '',
    xp,
    level: info.level,
    levelTitle: info.levelTitle,
    tier: info.tier,
  }
}

async function fetchEntries(uids: string[]): Promise<LeaderboardEntry[]> {
  const unique = Array.from(new Set(uids))
  if (unique.length === 0) return []
  const entries: LeaderboardEntry[] = []
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30)
    const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)))
    snap.docs.forEach(d => entries.push(toEntry(d.id, d.data())))
  }
  return entries
}

const RANK_COLORS: Record<number, string> = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' }

function RankBadge({ rank }: { rank: number }) {
  const color = RANK_COLORS[rank]
  if (color) {
    return (
      <div style={{
        width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
        backgroundColor: `${color}22`, border: `1px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <FontAwesomeIcon icon={rank === 1 ? faTrophy : faMedal} style={{ width: '14px', color }} />
      </div>
    )
  }
  return (
    <div style={{
      width: '34px', height: '34px', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'rgba(245,242,236,0.4)',
    }}>{rank}</div>
  )
}

function LeaderboardRow({ rank, entry, isOwn, isMobile }: {
  rank: number
  entry: LeaderboardEntry
  isOwn: boolean
  isMobile: boolean
}) {
  const tierColor = TIER_COLORS[entry.tier]
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: isMobile ? '0.8rem' : '1rem',
      padding: isMobile ? '0.8rem 1rem' : '0.9rem 1.25rem',
      backgroundColor: isOwn ? 'rgba(0,160,152,0.08)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${isOwn ? 'rgba(0,160,152,0.4)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: '4px',
    }}>
      <RankBadge rank={rank} />

      <div style={{
        width: isMobile ? '34px' : '38px', height: isMobile ? '34px' : '38px',
        borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {entry.avatarUrl ? (
          <img src={entry.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: '0.8rem', color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-cinzel)' }}>
            {entry.displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '0.85rem' : '0.92rem', color: 'var(--offwhite)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {entry.displayName}{isOwn && <span style={{ color: 'var(--teal)' }}> (You)</span>}
        </p>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: tierColor }}>
          Lv {entry.level} · {entry.levelTitle}
        </p>
      </div>

      <span style={{
        fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '0.85rem' : '0.95rem', color: 'var(--teal)',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {entry.xp.toLocaleString()} XP
      </span>
    </div>
  )
}

export default function LeaderboardPage() {
  const isMobile = useIsMobile()
  const { user } = useCustomerUser()
  const friends = useFriends(user?.uid ?? null)

  const [tab, setTab] = useState<'global' | 'friends'>('global')

  const [globalList, setGlobalList] = useState<LeaderboardEntry[]>([])
  const [loadingGlobal, setLoadingGlobal] = useState(true)

  const [myProfile, setMyProfile] = useState<LeaderboardEntry | null>(null)
  const [myRank, setMyRank] = useState<number | null>(null)

  const [friendEntries, setFriendEntries] = useState<LeaderboardEntry[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const [signInHovered, setSignInHovered] = useState(false)
  const [findFriendsHovered, setFindFriendsHovered] = useState(false)

  // Global Top 50 — live.
  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('xp', 'desc'), limit(TOP_LIMIT))
    const unsub = onSnapshot(q, snap => {
      setGlobalList(snap.docs.map(d => toEntry(d.id, d.data())))
      setLoadingGlobal(false)
    })
    return unsub
  }, [])

  // Signed-in viewer's own live profile.
  useEffect(() => {
    if (!user) { setMyProfile(null); setMyRank(null); return }
    const unsub = onSnapshot(doc(db, 'users', user.uid), snap => {
      if (snap.exists()) setMyProfile(toEntry(user.uid, snap.data()))
    })
    return unsub
  }, [user])

  // Rank computed via a server-side count aggregate — avoids reading every
  // customer doc just to find one person's position.
  useEffect(() => {
    if (!myProfile) return
    const q = query(collection(db, 'users'), where('xp', '>', myProfile.xp))
    getCountFromServer(q).then(snap => setMyRank(snap.data().count + 1))
  }, [myProfile?.xp])

  // Friends leaderboard — self + confirmed friends, fetched fresh whenever
  // the friends list changes.
  useEffect(() => {
    if (!user) { setFriendEntries([]); return }
    setLoadingFriends(true)
    fetchEntries([user.uid, ...friends.map(f => f.uid)]).then(list => {
      list.sort((a, b) => b.xp - a.xp)
      setFriendEntries(list)
      setLoadingFriends(false)
    })
  }, [user, friends])

  const isInTop = !!user && globalList.some(e => e.uid === user.uid)
  const showOwnRankCard = tab === 'global' && !!user && !!myProfile && !isInTop && myRank != null

  return (
    <>
      <Navbar />
      <main>

        {/* Header */}
        <section style={{
          position: 'relative',
          textAlign: 'center',
          padding: isMobile ? '8.5rem 1.5rem 2.5rem' : '9rem 2rem 3rem',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 50% 0%, rgba(0,160,152,0.12) 0%, transparent 60%)',
          }} />
          <p style={{
            position: 'relative', zIndex: 1,
            fontSize: '0.7rem', letterSpacing: '0.3em', textTransform: 'uppercase',
            color: 'var(--teal)', marginBottom: '1rem', fontFamily: 'var(--font-inter)',
          }}>Hall of Fame</p>
          <h1 style={{
            position: 'relative', zIndex: 1,
            fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '2rem' : '3rem', color: 'var(--offwhite)',
            marginBottom: '0.8rem',
          }}>Leaderboard</h1>
          <p style={{
            position: 'relative', zIndex: 1,
            fontFamily: 'var(--font-inter)', fontSize: isMobile ? '0.85rem' : '0.95rem',
            color: 'rgba(245,242,236,0.5)', maxWidth: '480px', margin: '0 auto', lineHeight: 1.7,
          }}>
            See how you stack up against the Onboard community.
          </p>
        </section>

        <div style={{ maxWidth: '700px', margin: '0 auto', padding: isMobile ? '0 1.25rem 4rem' : '0 2rem 6rem' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {([
              { key: 'global' as const,  label: 'Global Top 50', icon: faTrophy },
              { key: 'friends' as const, label: 'Friends',       icon: faUserGroup },
            ]).map(({ key, label, icon }) => {
              const active = tab === key
              const hov = hoveredTab === key
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  onMouseEnter={() => setHoveredTab(key)}
                  onMouseLeave={() => setHoveredTab(null)}
                  style={{
                    flex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    backgroundColor: active ? 'var(--teal)' : hov ? 'rgba(0,160,152,0.15)' : 'transparent',
                    border: `1px solid ${active || hov ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
                    color: active ? '#fff' : hov ? 'var(--offwhite)' : 'rgba(245,242,236,0.5)',
                    padding: '0.75rem 1rem',
                    borderRadius: '2px',
                    fontSize: '0.75rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-inter)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <FontAwesomeIcon icon={icon} style={{ width: '12px' }} />
                  {label}
                </button>
              )
            })}
          </div>

          {/* Your Rank card — only when viewer is outside the visible Top 50 */}
          {showOwnRankCard && myProfile && (
            <Reveal>
              <div style={{
                border: '1px solid rgba(0,160,152,0.35)',
                borderRadius: '4px',
                background: 'rgba(0,160,152,0.06)',
                padding: isMobile ? '1.1rem 1.25rem' : '1.25rem 1.5rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
              }}>
                <div>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.3rem' }}>
                    Your Rank
                  </p>
                  <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)' }}>
                    #{myRank}
                  </p>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>{myProfile.displayName}</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: TIER_COLORS[myProfile.tier] }}>
                    Lv {myProfile.level} · {myProfile.levelTitle}
                  </p>
                </div>
                <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'var(--teal)', whiteSpace: 'nowrap' }}>
                  {myProfile.xp.toLocaleString()} XP
                </span>
              </div>
            </Reveal>
          )}

          {/* Global tab */}
          {tab === 'global' && (
            loadingGlobal ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height="60px" borderRadius="4px" />)}
              </div>
            ) : globalList.length === 0 ? (
              <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px', padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.35)' }}>
                  No customers yet — be the first to earn XP!
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {globalList.map((entry, i) => (
                  <LeaderboardRow key={entry.uid} rank={i + 1} entry={entry} isOwn={entry.uid === user?.uid} isMobile={isMobile} />
                ))}
              </div>
            )
          )}

          {/* Friends tab */}
          {tab === 'friends' && (
            !user ? (
              <div style={{
                border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
                padding: isMobile ? '2.5rem 1.5rem' : '3rem', textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem',
              }}>
                <FontAwesomeIcon icon={faUserGroup} style={{ width: '28px', color: 'rgba(245,242,236,0.15)' }} />
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.4)' }}>
                  Sign in to see how you rank against your friends.
                </p>
                <Link href="/customer/login"
                  onMouseEnter={() => setSignInHovered(true)}
                  onMouseLeave={() => setSignInHovered(false)}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    backgroundColor: signInHovered ? 'rgba(0,160,152,0.15)' : 'var(--teal)',
                    color: '#fff', padding: '0.7rem 1.8rem',
                    borderRadius: '2px', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                    textDecoration: 'none', fontFamily: 'var(--font-inter)',
                    border: '1px solid var(--teal)',
                    backdropFilter: signInHovered ? 'blur(10px)' : 'none',
                    transition: 'all 0.3s ease',
                  }}>
                  <span style={{
                    position: 'absolute', top: 0,
                    left: signInHovered ? '120%' : '-60%',
                    width: '40%', height: '100%',
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                    transform: 'skewX(-20deg)',
                    transition: 'left 0.5s ease',
                    pointerEvents: 'none',
                  }} />
                  Sign In
                </Link>
              </div>
            ) : loadingFriends ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {[0, 1, 2].map(i => <Skeleton key={i} height="60px" borderRadius="4px" />)}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>
                  {friendEntries.map((entry, i) => (
                    <LeaderboardRow key={entry.uid} rank={i + 1} entry={entry} isOwn={entry.uid === user.uid} isMobile={isMobile} />
                  ))}
                </div>
                {friendEntries.length <= 1 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.4)', textAlign: 'center' }}>
                    Add some friends to see how you compare — <Link href="/customer/friends"
                      onMouseEnter={() => setFindFriendsHovered(true)}
                      onMouseLeave={() => setFindFriendsHovered(false)}
                      style={{ color: 'var(--teal)', textDecoration: findFriendsHovered ? 'underline' : 'none' }}>find friends</Link>
                  </p>
                )}
              </>
            )
          )}

        </div>
      </main>
      <Footer />
    </>
  )
}
