'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useCustomerUser } from '../../../lib/customerAuth'
import { useIsMobile } from '../../../lib/useIsMobile'
import {
  useFriends, useIncomingRequests, useOutgoingRequests,
  fetchCustomerDirectory, sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend,
  type DirectoryUser,
} from '../../../lib/friends'

interface OwnProfile {
  displayName: string
  avatarUrl: string
}

const inputStyle = {
  width: '100%',
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC',
  padding: '0.8rem 1rem',
  borderRadius: '4px',
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
}

const sectionLabelStyle = {
  fontSize: '0.65rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  color: 'rgba(245,242,236,0.3)',
  fontFamily: 'var(--font-inter)',
  marginBottom: '1rem',
}

function Avatar({ url, name, size = 36 }: { url: string; name: string; size?: number }) {
  return (
    <div style={{
      width: `${size}px`, height: `${size}px`,
      borderRadius: '50%',
      overflow: 'hidden',
      backgroundColor: '#1a1a1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {url ? (
        <img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: `${size * 0.4}px`, color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-cinzel)' }}>
          {(name || '?').charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}

export default function FriendsPage() {
  const isMobile = useIsMobile()
  const { user } = useCustomerUser()
  const [ownProfile, setOwnProfile] = useState<OwnProfile | null>(null)

  const friends  = useFriends(user?.uid ?? null)
  const incoming = useIncomingRequests(user?.uid ?? null)
  const outgoing = useOutgoingRequests(user?.uid ?? null)

  const [directory, setDirectory]   = useState<DirectoryUser[] | null>(null)
  const [loadingDir, setLoadingDir] = useState(true)
  const [search, setSearch]         = useState('')
  const [busyUid, setBusyUid]       = useState<string | null>(null)
  const [backHovered, setBackHovered] = useState(false)
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    return onSnapshot(doc(db, 'users', user.uid), snap => {
      const data = snap.data() as { displayName?: string; username?: string; avatarUrl?: string } | undefined
      setOwnProfile({
        displayName: data?.displayName || data?.username || 'Me',
        avatarUrl: data?.avatarUrl || '',
      })
    })
  }, [user])

  useEffect(() => {
    if (!user) return
    setLoadingDir(true)
    fetchCustomerDirectory(user.uid).then(list => {
      setDirectory(list)
      setLoadingDir(false)
    })
  }, [user])

  const friendUids  = useMemo(() => new Set(friends.map(f => f.uid)), [friends])
  const incomingUids = useMemo(() => new Set(incoming.map(r => r.fromUid)), [incoming])
  const outgoingUids = useMemo(() => new Set(outgoing.map(r => r.toUid)), [outgoing])

  const searchResults = useMemo(() => {
    if (!directory || !search.trim()) return []
    const q = search.trim().toLowerCase()
    return directory
      .filter(u => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 10)
  }, [directory, search])

  async function handleSendRequest(target: DirectoryUser) {
    if (!user || !ownProfile) return
    setBusyUid(target.uid)
    try {
      await sendFriendRequest(
        { uid: user.uid, displayName: ownProfile.displayName, avatarUrl: ownProfile.avatarUrl },
        { uid: target.uid, displayName: target.displayName, avatarUrl: target.avatarUrl }
      )
    } finally {
      setBusyUid(null)
    }
  }

  async function handleAccept(requestId: string) {
    setBusyUid(requestId)
    try { await acceptFriendRequest(requestId) } finally { setBusyUid(null) }
  }

  async function handleDecline(requestId: string) {
    setBusyUid(requestId)
    try { await declineFriendRequest(requestId) } finally { setBusyUid(null) }
  }

  async function handleRemove(requestId: string) {
    if (!confirm('Remove this friend?')) return
    setBusyUid(requestId)
    try { await removeFriend(requestId) } finally { setBusyUid(null) }
  }

  const cardStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.8rem',
    padding: isMobile ? '0.9rem' : '1rem 1.2rem',
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '4px',
  }

  const emptyStateStyle = {
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: '4px',
    padding: isMobile ? '1.5rem 1rem' : '2rem',
    textAlign: 'center' as const,
    color: 'rgba(245,242,236,0.3)',
    fontFamily: 'var(--font-inter)',
    fontSize: '0.85rem',
  }

  const actionButtonStyle = {
    backgroundColor: 'var(--purple)',
    color: '#fff',
    border: 'none',
    padding: '0.5rem 1rem',
    borderRadius: '2px',
    fontSize: '0.7rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    fontFamily: 'var(--font-inter)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        <div>
          <Link href="/customer/profile"
            onMouseEnter={() => setBackHovered(true)}
            onMouseLeave={() => setBackHovered(false)}
            style={{
              fontSize: '0.7rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: backHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.3)',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              marginBottom: '0.5rem',
              display: 'block',
              transition: 'color 0.2s ease',
            }}>← Back to Profile</Link>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.6rem' : '2rem', color: 'var(--offwhite)' }}>
            Friends
          </h1>
        </div>

        {/* Search */}
        <div>
          <p style={sectionLabelStyle}>Find Friends</p>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            style={inputStyle}
          />
          {loadingDir && (
            <p style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', marginTop: '0.5rem' }}>
              Loading members…
            </p>
          )}
          {search.trim() && !loadingDir && (
            searchResults.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', marginTop: '0.6rem' }}>
                No matching members found.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.8rem', maxHeight: isMobile ? '280px' : '320px', overflowY: 'auto' }}>
                {searchResults.map(u => {
                  const isFriend = friendUids.has(u.uid)
                  const isIncoming = incomingUids.has(u.uid)
                  const isOutgoing = outgoingUids.has(u.uid)
                  return (
                    <div key={u.uid} style={cardStyle}>
                      <Avatar url={u.avatarUrl} name={u.displayName} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>{u.displayName}</p>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>{u.email}</p>
                      </div>
                      {isFriend ? (
                        <span style={{ fontSize: '0.7rem', color: 'var(--teal)', fontFamily: 'var(--font-inter)' }}>Friends</span>
                      ) : isIncoming ? (
                        <span style={{ fontSize: '0.7rem', color: '#E5A33D', fontFamily: 'var(--font-inter)', textAlign: 'right' }}>Respond below</span>
                      ) : isOutgoing ? (
                        <span style={{ fontSize: '0.7rem', color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)' }}>Request sent</span>
                      ) : (
                        <button
                          onClick={() => handleSendRequest(u)}
                          disabled={busyUid === u.uid}
                          onMouseEnter={() => setHoveredBtn(`add-${u.uid}`)}
                          onMouseLeave={() => setHoveredBtn(null)}
                          style={{
                            ...actionButtonStyle,
                            backgroundColor: busyUid !== u.uid && hoveredBtn === `add-${u.uid}` ? 'rgba(106,106,183,0.8)' : 'var(--purple)',
                            opacity: busyUid === u.uid ? 0.6 : 1,
                            boxShadow: busyUid !== u.uid && hoveredBtn === `add-${u.uid}` ? '0 6px 14px rgba(106,106,183,0.4)' : 'none',
                            transition: 'all 0.2s ease',
                          }}
                        >Add Friend</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>

        {/* Incoming requests */}
        {incoming.length > 0 && (
          <div>
            <p style={sectionLabelStyle}>Friend Requests ({incoming.length})</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {incoming.map(r => (
                <div key={r.id} style={cardStyle}>
                  <Avatar url={r.fromAvatar} name={r.fromName} />
                  <p style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>{r.fromName}</p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => handleAccept(r.id)}
                      disabled={busyUid === r.id}
                      onMouseEnter={() => setHoveredBtn(`accept-${r.id}`)}
                      onMouseLeave={() => setHoveredBtn(null)}
                      style={{
                        ...actionButtonStyle,
                        backgroundColor: busyUid !== r.id && hoveredBtn === `accept-${r.id}` ? 'rgba(0,160,152,0.8)' : 'var(--teal)',
                        opacity: busyUid === r.id ? 0.6 : 1,
                        boxShadow: busyUid !== r.id && hoveredBtn === `accept-${r.id}` ? '0 6px 14px rgba(0,160,152,0.4)' : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >Accept</button>
                    {(() => {
                      const declineHovered = busyUid !== r.id && hoveredBtn === `decline-${r.id}`
                      return (
                        <button
                          onClick={() => handleDecline(r.id)}
                          disabled={busyUid === r.id}
                          onMouseEnter={() => setHoveredBtn(`decline-${r.id}`)}
                          onMouseLeave={() => setHoveredBtn(null)}
                          style={{
                            background: declineHovered ? 'rgba(228,51,41,0.1)' : 'transparent',
                            border: `1px solid ${declineHovered ? 'var(--red)' : 'rgba(228,51,41,0.3)'}`,
                            color: 'var(--red)',
                            padding: '0.5rem 1rem',
                            borderRadius: '2px',
                            fontSize: '0.7rem',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            fontFamily: 'var(--font-inter)',
                            cursor: 'pointer',
                            opacity: busyUid === r.id ? 0.6 : 1,
                            transition: 'all 0.2s ease',
                          }}
                        >Decline</button>
                      )
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My friends */}
        <div>
          <p style={sectionLabelStyle}>My Friends ({friends.length})</p>
          {friends.length === 0 ? (
            <div style={emptyStateStyle}>No friends yet — search above to add some!</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {friends.map(f => (
                <div key={f.requestId} style={cardStyle}>
                  <Avatar url={f.avatarUrl} name={f.displayName} />
                  <p style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>{f.displayName}</p>
                  <button
                    onClick={() => handleRemove(f.requestId)}
                    disabled={busyUid === f.requestId}
                    onMouseEnter={() => setHoveredBtn(`remove-${f.requestId}`)}
                    onMouseLeave={() => setHoveredBtn(null)}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${hoveredBtn === `remove-${f.requestId}` ? 'var(--red)' : 'rgba(255,255,255,0.1)'}`,
                      color: hoveredBtn === `remove-${f.requestId}` ? 'var(--red)' : 'rgba(245,242,236,0.5)',
                      padding: '0.5rem 1rem',
                      borderRadius: '2px',
                      fontSize: '0.7rem',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      fontFamily: 'var(--font-inter)',
                      cursor: 'pointer',
                      opacity: busyUid === f.requestId ? 0.6 : 1,
                      transition: 'all 0.2s ease',
                    }}
                  >Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sent requests */}
        {outgoing.length > 0 && (
          <div>
            <p style={sectionLabelStyle}>Sent Requests ({outgoing.length})</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {outgoing.map(r => (
                <div key={r.id} style={cardStyle}>
                  <Avatar url={r.toAvatar} name={r.toName} />
                  <p style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>{r.toName}</p>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)' }}>Pending</span>
                  <button
                    onClick={() => handleDecline(r.id)}
                    disabled={busyUid === r.id}
                    onMouseEnter={() => setHoveredBtn(`cancel-${r.id}`)}
                    onMouseLeave={() => setHoveredBtn(null)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: hoveredBtn === `cancel-${r.id}` ? 'var(--red)' : 'rgba(228,51,41,0.6)',
                      cursor: 'pointer', fontSize: '0.78rem', padding: '0 0.2rem',
                      transform: hoveredBtn === `cancel-${r.id}` ? 'scale(1.2)' : 'scale(1)',
                      transition: 'all 0.2s ease',
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
