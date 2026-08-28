'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useCustomerUser } from '../../../lib/customerAuth'
import { useIsMobile } from '../../../lib/useIsMobile'
import { BRANCHES, resolveBranchName } from '../../../lib/branches'
import { useFriends, fetchCustomerDirectory, type DirectoryUser } from '../../../lib/friends'
import { uploadImage } from '../../../lib/media'
import { checkNumberAlreadyUsed } from '../../../lib/loyalty'

const MAX_FRIENDS = 9 // + submitter = 10 total

type FriendUser = DirectoryUser

interface SubmissionSummary {
  branchId: string
  checkNumber: string
  totalAmount: number
  splitCount: number
  xpAmount: number
  coinsAmount: number
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

const labelStyle = {
  display: 'block',
  fontSize: '0.68rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.5rem',
  fontFamily: 'var(--font-inter)',
}

const errorStyle = {
  fontSize: '0.75rem',
  color: 'var(--red)',
  fontFamily: 'var(--font-inter)',
  marginTop: '0.4rem',
}

export default function SubmitCheckPage() {
  const isMobile = useIsMobile()
  const { user } = useCustomerUser()
  const friends = useFriends(user?.uid ?? null)

  const [branchId, setBranchId]       = useState<string>(BRANCHES[0])
  const [checkNumber, setCheckNumber] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [checkPhotoUrl, setCheckPhotoUrl] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [splitEnabled, setSplitEnabled]     = useState(false)
  const [directory, setDirectory]           = useState<FriendUser[] | null>(null)
  const [loadingDirectory, setLoadingDirectory] = useState(false)
  const [friendSearch, setFriendSearch]     = useState('')
  const [addedFriends, setAddedFriends]     = useState<FriendUser[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors]         = useState<Record<string, string>>({})
  const [result, setResult]         = useState<SubmissionSummary | null>(null)
  const [backHovered, setBackHovered] = useState(false)
  const [submitAnotherHovered, setSubmitAnotherHovered] = useState(false)
  const [splitToggleHovered, setSplitToggleHovered] = useState(false)
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)
  const [submitHovered, setSubmitHovered] = useState(false)

  const amountNum    = parseFloat(totalAmount) || 0
  const splitCount   = 1 + addedFriends.length
  const rawXp        = Math.floor(amountNum * 10)
  const rawCoins     = Math.floor(amountNum * 1)
  const xpAmount      = splitCount > 0 ? Math.floor(rawXp / splitCount) : rawXp
  const coinsAmount   = splitCount > 0 ? Math.floor(rawCoins / splitCount) : rawCoins

  const searchResults = useMemo(() => {
    if (!directory || !friendSearch.trim()) return []
    const q = friendSearch.trim().toLowerCase()
    const addedIds = new Set(addedFriends.map(f => f.uid))
    return directory
      .filter(u => !addedIds.has(u.uid))
      .filter(u => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 8)
  }, [directory, friendSearch, addedFriends])

  async function handleToggleSplit() {
    const next = !splitEnabled
    setSplitEnabled(next)
    if (next && directory === null && user) {
      setLoadingDirectory(true)
      try {
        setDirectory(await fetchCustomerDirectory(user.uid))
      } finally {
        setLoadingDirectory(false)
      }
    }
  }

  function addFriend(friend: FriendUser) {
    if (addedFriends.length >= MAX_FRIENDS) return
    if (addedFriends.some(f => f.uid === friend.uid)) return
    setAddedFriends(prev => [...prev, friend])
    setFriendSearch('')
  }

  function removeFromSplit(uid: string) {
    setAddedFriends(prev => prev.filter(f => f.uid !== uid))
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    try {
      const { url } = await uploadImage(file)
      setCheckPhotoUrl(url)
      setErrors(prev => { const next = { ...prev }; delete next.checkPhotoUrl; return next })
    } catch (err) {
      setErrors(prev => ({ ...prev, checkPhotoUrl: err instanceof Error ? err.message : 'Upload failed.' }))
      if (fileRef.current) fileRef.current.value = ''
    } finally {
      setUploadingPhoto(false)
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!checkNumber.trim()) next.checkNumber = 'Check number is required.'
    if (!totalAmount || amountNum <= 0) next.totalAmount = 'Enter a valid amount.'
    if (uploadingPhoto) next.checkPhotoUrl = 'Please wait for photo to finish uploading.'
    else if (!checkPhotoUrl) next.checkPhotoUrl = 'Check photo is required.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !validate()) return
    setSubmitting(true)
    try {
      // Checked right before submitting, not on every keystroke — this is
      // a real query, not local validation. Blocks re-submitting a check
      // that's already been credited, or your own still-pending duplicate.
      if (await checkNumberAlreadyUsed(branchId, checkNumber, user.uid)) {
        setErrors(prev => ({ ...prev, checkNumber: 'This check number has already been submitted for this branch.' }))
        return
      }
      const userIds = [user.uid, ...addedFriends.map(f => f.uid)]
      await addDoc(collection(db, 'transactions'), {
        type: 'check',
        userId: userIds,
        xpAmount,
        coinsAmount,
        status: 'pending',
        submittedBy: user.uid,
        approvedBy: null,
        checkPhotoUrl,
        checkNumber: checkNumber.trim(),
        branchId,
        totalAmount: amountNum,
        splitCount: userIds.length,
        createdAt: serverTimestamp(),
      })
      setResult({
        branchId,
        checkNumber: checkNumber.trim(),
        totalAmount: amountNum,
        splitCount: userIds.length,
        xpAmount,
        coinsAmount,
      })
    } finally {
      setSubmitting(false)
    }
  }

  function handleReset() {
    setBranchId(BRANCHES[0])
    setCheckNumber('')
    setTotalAmount('')
    setCheckPhotoUrl('')
    setSplitEnabled(false)
    setFriendSearch('')
    setAddedFriends([])
    setErrors({})
    setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const canSubmit = checkNumber.trim() !== '' && amountNum > 0 && !!checkPhotoUrl && !uploadingPhoto && !submitting

  // ---------- Unverified email screen ----------
  // Only an email/password signup can ever land here — Google sign-in is
  // already verified by Google. Gated here (not just hidden behind a
  // disabled button) so this can't be bypassed by calling the Firestore
  // write directly.
  if (user && !user.emailVerified) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: '420px', width: '100%', textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.4rem' : '1.7rem', color: 'var(--offwhite)', marginBottom: '0.8rem' }}>
            Verify your email first
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.5)', lineHeight: 1.7, marginBottom: '2rem' }}>
            Submitting a check earns real XP and OB Coins, so we need to confirm it's really you first.
            Check your inbox for the verification email, then head to your profile to confirm it.
          </p>
          <Link href="/customer/profile" style={{
            display: 'inline-block', backgroundColor: 'var(--purple)', color: '#fff',
            padding: '0.8rem 2rem', borderRadius: '2px', fontSize: '0.78rem',
            letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none', fontFamily: 'var(--font-inter)',
          }}>Go to Profile</Link>
        </div>
      </div>
    )
  }

  // ---------- Success screen ----------
  if (result) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: '480px', width: '100%', textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.6rem' : '2rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
            Submission received!
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.5)', marginBottom: '2rem' }}>
            Your XP and coins will be added once a manager approves your submission.
          </p>

          <div style={{
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '4px',
            backgroundColor: 'rgba(255,255,255,0.02)',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.7rem',
            textAlign: 'left',
            marginBottom: '2rem',
          }}>
            {[
              ['Branch', resolveBranchName(result.branchId)],
              ['Check Number', result.checkNumber],
              ['Amount', `$${result.totalAmount.toFixed(2)}`],
              ['People in Split', String(result.splitCount)],
              ['XP Pending', `+${result.xpAmount} XP`],
              ['Coins Pending', `+${result.coinsAmount} OB Coins`],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)' }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)', textAlign: 'right' }}>{value}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <button onClick={handleReset}
              onMouseEnter={() => setSubmitAnotherHovered(true)}
              onMouseLeave={() => setSubmitAnotherHovered(false)}
              style={{
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                backgroundColor: submitAnotherHovered ? 'rgba(106,106,183,0.15)' : 'var(--purple)',
                color: '#fff',
                border: '1px solid var(--purple)',
                padding: '0.9rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-inter)',
                cursor: 'pointer',
                backdropFilter: submitAnotherHovered ? 'blur(10px)' : 'none',
                transition: 'all 0.3s ease',
              }}>
              <span style={{
                position: 'absolute', top: 0,
                left: submitAnotherHovered ? '120%' : '-60%',
                width: '40%', height: '100%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                transform: 'skewX(-20deg)',
                transition: 'left 0.5s ease',
                pointerEvents: 'none',
              }} />
              Submit Another
            </button>

            <Link href="/customer/profile"
              onMouseEnter={() => setBackHovered(true)}
              onMouseLeave={() => setBackHovered(false)}
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.8rem',
                color: 'var(--teal)',
                textDecoration: backHovered ? 'underline' : 'none',
              }}>← Back to Profile</Link>
          </div>
        </div>
      </div>
    )
  }

  // ---------- Form ----------
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--black)',
      paddingTop: isMobile ? '1.25rem' : '3rem',
      paddingLeft: isMobile ? '1.25rem' : '3rem',
      paddingRight: isMobile ? '1.25rem' : '3rem',
      paddingBottom: isMobile ? '6.5rem' : '3rem',
    }}>
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>

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

        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.6rem' : '2rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
          Submit a Check
        </h1>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.4)', marginBottom: '2rem' }}>
          Earn XP and OB Coins for your food or drink purchase — a branch manager will review and approve it.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Branch */}
          <div>
            <label style={labelStyle}>Branch</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ ...inputStyle, color: '#F5F2EC', backgroundColor: '#1a1a1a' }}>
              {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {/* Check Number */}
          <div>
            <label style={labelStyle}>Check Number</label>
            <input
              type="text"
              value={checkNumber}
              onChange={e => setCheckNumber(e.target.value)}
              placeholder="e.g. 4521"
              style={inputStyle}
            />
            {errors.checkNumber && <p style={errorStyle}>{errors.checkNumber}</p>}
          </div>

          {/* Total Amount */}
          <div>
            <label style={labelStyle}>Total Amount (USD)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={totalAmount}
              onChange={e => setTotalAmount(e.target.value)}
              placeholder="12.50"
              style={inputStyle}
            />
            {errors.totalAmount && <p style={errorStyle}>{errors.totalAmount}</p>}

            {amountNum > 0 && (
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--teal)', marginTop: '0.6rem' }}>
                {splitCount > 1
                  ? `Each person will earn ${xpAmount} XP and ${coinsAmount} OB Coins`
                  : `You will earn ${xpAmount} XP and ${coinsAmount} OB Coins`}
              </p>
            )}
          </div>

          {/* Check Photo */}
          <div>
            <label style={labelStyle}>Check Photo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {checkPhotoUrl && (
                <div style={{
                  width: isMobile ? '80px' : '120px',
                  height: isMobile ? '80px' : '120px',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.1)',
                  flexShrink: 0,
                }}>
                  <img src={checkPhotoUrl} alt="Check" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  style={{ ...inputStyle, cursor: 'pointer', padding: '0.6rem' }}
                />
                {uploadingPhoto && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--teal)', fontFamily: 'var(--font-inter)', marginTop: '0.4rem' }}>Uploading…</p>
                )}
              </div>
            </div>
            {errors.checkPhotoUrl && <p style={errorStyle}>{errors.checkPhotoUrl}</p>}
          </div>

          {/* Split with friends */}
          <div>
            <button
              type="button"
              onClick={handleToggleSplit}
              onMouseEnter={() => setSplitToggleHovered(true)}
              onMouseLeave={() => setSplitToggleHovered(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                background: splitToggleHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: `1px solid ${splitToggleHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
                color: splitToggleHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.7)',
                padding: '0.8rem 1rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-inter)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <span>Split with Friends</span>
              <span style={{
                width: '36px', height: '20px',
                borderRadius: '10px',
                backgroundColor: splitEnabled ? 'var(--purple)' : 'rgba(255,255,255,0.15)',
                position: 'relative',
                transition: 'background-color 0.2s',
                flexShrink: 0,
              }}>
                <span style={{
                  position: 'absolute',
                  top: '2px',
                  left: splitEnabled ? '18px' : '2px',
                  width: '16px', height: '16px',
                  borderRadius: '50%',
                  backgroundColor: '#fff',
                  transition: 'left 0.2s',
                }} />
              </span>
            </button>

            {splitEnabled && (
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>

                {/* Added friends as chips */}
                {addedFriends.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {addedFriends.map(f => (
                      <div key={f.uid} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backgroundColor: 'rgba(106,106,183,0.12)',
                        border: '1px solid rgba(106,106,183,0.25)',
                        borderRadius: '20px',
                        padding: '0.3rem 0.5rem 0.3rem 0.3rem',
                      }}>
                        <div style={{
                          width: '22px', height: '22px',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          backgroundColor: '#1a1a1a',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          {f.avatarUrl ? (
                            <img src={f.avatarUrl} alt={f.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-cinzel)' }}>
                              {f.displayName.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--offwhite)' }}>{f.displayName}</span>
                        <button type="button" onClick={() => removeFromSplit(f.uid)}
                          onMouseEnter={() => setHoveredBtn(`removechip-${f.uid}`)}
                          onMouseLeave={() => setHoveredBtn(null)}
                          style={{
                            background: 'transparent', border: 'none',
                            color: hoveredBtn === `removechip-${f.uid}` ? 'var(--red)' : 'rgba(228,51,41,0.7)',
                            cursor: 'pointer', fontSize: '0.85rem', padding: '0 0.2rem', lineHeight: 1,
                            transform: hoveredBtn === `removechip-${f.uid}` ? 'scale(1.2)' : 'scale(1)',
                            transition: 'all 0.2s ease',
                          }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick-add — confirmed friends, no search needed */}
                {addedFriends.length < MAX_FRIENDS && (() => {
                  const addedIds = new Set(addedFriends.map(f => f.uid))
                  const quickAddFriends = friends.filter(f => !addedIds.has(f.uid))
                  if (quickAddFriends.length === 0) return null
                  return (
                    <div>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', marginBottom: '0.5rem' }}>
                        Quick add a friend
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {quickAddFriends.map(f => (
                          <button
                            key={f.uid}
                            type="button"
                            onClick={() => addFriend({ uid: f.uid, displayName: f.displayName, avatarUrl: f.avatarUrl, email: '' })}
                            onMouseEnter={() => setHoveredBtn(`quickadd-${f.uid}`)}
                            onMouseLeave={() => setHoveredBtn(null)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              backgroundColor: hoveredBtn === `quickadd-${f.uid}` ? 'rgba(106,106,183,0.15)' : 'rgba(255,255,255,0.04)',
                              border: `1px solid ${hoveredBtn === `quickadd-${f.uid}` ? 'rgba(106,106,183,0.5)' : 'rgba(255,255,255,0.1)'}`,
                              borderRadius: '20px',
                              padding: '0.3rem 0.8rem 0.3rem 0.3rem',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                            }}
                          >
                            <div style={{
                              width: '22px', height: '22px',
                              borderRadius: '50%',
                              overflow: 'hidden',
                              backgroundColor: '#1a1a1a',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              {f.avatarUrl ? (
                                <img src={f.avatarUrl} alt={f.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-cinzel)' }}>
                                  {f.displayName.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--offwhite)' }}>{f.displayName}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {addedFriends.length >= MAX_FRIENDS ? (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)' }}>
                    Maximum of {MAX_FRIENDS} friends added (10 people total).
                  </p>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={friendSearch}
                      onChange={e => setFriendSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      style={inputStyle}
                    />
                    {loadingDirectory && (
                      <p style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', marginTop: '0.4rem' }}>
                        Loading members…
                      </p>
                    )}
                    {friendSearch.trim() && searchResults.length > 0 && (
                      <div style={{
                        marginTop: '0.5rem',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '4px',
                        backgroundColor: '#111',
                        maxHeight: '220px',
                        overflowY: 'auto',
                      }}>
                        {searchResults.map(u => (
                          <button
                            key={u.uid}
                            type="button"
                            onClick={() => addFriend(u)}
                            onMouseEnter={() => setHoveredBtn(`searchresult-${u.uid}`)}
                            onMouseLeave={() => setHoveredBtn(null)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.7rem',
                              width: '100%',
                              padding: '0.7rem 1rem',
                              background: hoveredBtn === `searchresult-${u.uid}` ? 'rgba(255,255,255,0.05)' : 'transparent',
                              border: 'none',
                              borderBottom: '1px solid rgba(255,255,255,0.04)',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'background 0.15s ease',
                            }}
                          >
                            <div style={{
                              width: '28px', height: '28px',
                              borderRadius: '50%',
                              overflow: 'hidden',
                              backgroundColor: '#1a1a1a',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              {u.avatarUrl ? (
                                <img src={u.avatarUrl} alt={u.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span style={{ fontSize: '0.7rem', color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-cinzel)' }}>
                                  {u.displayName.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--offwhite)' }}>{u.displayName}</p>
                              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>{u.email}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {friendSearch.trim() && !loadingDirectory && searchResults.length === 0 && (
                      <p style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', marginTop: '0.5rem' }}>
                        No matching members found.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Submit — inline on desktop, fixed to the bottom of the screen on
              mobile. Both are real type="submit" buttons inside this <form>
              (the mobile one is just visually repositioned via fixed
              positioning), so either one triggers the same onSubmit handler. */}
          {!isMobile && (
            <button type="submit" disabled={!canSubmit}
              onMouseEnter={() => setSubmitHovered(true)}
              onMouseLeave={() => setSubmitHovered(false)}
              style={{
                width: '100%',
                backgroundColor: canSubmit && submitHovered ? 'rgba(106,106,183,0.8)' : 'var(--purple)',
                color: '#fff',
                border: 'none',
                padding: '1rem',
                borderRadius: '4px',
                fontSize: '0.82rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-inter)',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                opacity: canSubmit ? 1 : 0.5,
                boxShadow: canSubmit && submitHovered ? '0 8px 20px rgba(106,106,183,0.4)' : 'none',
                transition: 'all 0.2s ease',
              }}>
              {submitting ? 'Submitting…' : 'Submit Check'}
            </button>
          )}

          {isMobile && (
            <div style={{
              position: 'fixed',
              bottom: 0, left: 0, right: 0,
              padding: '1rem 1.25rem',
              backgroundColor: 'rgba(10,10,10,0.95)',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(8px)',
            }}>
              <button type="submit" disabled={!canSubmit} style={{
                width: '100%',
                backgroundColor: 'var(--purple)',
                color: '#fff',
                border: 'none',
                padding: '1rem',
                borderRadius: '4px',
                fontSize: '0.82rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-inter)',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                opacity: canSubmit ? 1 : 0.5,
              }}>
                {submitting ? 'Submitting…' : 'Submit Check'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
