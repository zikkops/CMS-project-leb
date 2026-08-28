'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useCustomerUser } from '../../../lib/customerAuth'
import { useIsMobile } from '../../../lib/useIsMobile'
import { BRANCHES, resolveBranchName } from '../../../lib/branches'
import { useRedemptionItems, createRedemptionRequest, type RedemptionItem } from '../../../lib/redemptions'

const labelStyle = {
  display: 'block',
  fontSize: '0.68rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.5rem',
  fontFamily: 'var(--font-inter)',
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

interface SuccessInfo {
  itemName: string
  branchName: string
}

export default function RedeemPage() {
  const isMobile = useIsMobile()
  const { user } = useCustomerUser()
  const { items, loading } = useRedemptionItems(true)

  const [obCoins, setObCoins] = useState<number>(0)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [branchId, setBranchId] = useState<string>(BRANCHES[0])
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<SuccessInfo | null>(null)
  const [backHovered, setBackHovered] = useState(false)
  const [redeemAgainHovered, setRedeemAgainHovered] = useState(false)
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(doc(db, 'users', user.uid), snap => {
      setObCoins((snap.data()?.obCoins as number) ?? 0)
    })
    return unsub
  }, [user])

  function startRedeem(item: RedemptionItem) {
    setConfirmingId(item.id)
    setBranchId(BRANCHES[0])
  }

  async function handleConfirm(item: RedemptionItem) {
    if (!user) return
    setSubmitting(true)
    try {
      await createRedemptionRequest({ userId: user.uid, item, branchId })
      setSuccess({ itemName: item.name, branchName: resolveBranchName(branchId) })
      setConfirmingId(null)
    } finally {
      setSubmitting(false)
    }
  }

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
            Redeeming OB Coins spends real value, so we need to confirm it's really you first.
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

  if (success) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: '480px', width: '100%', textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.6rem' : '2rem', color: 'var(--offwhite)', marginBottom: '1rem' }}>
            Request submitted!
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(245,242,236,0.6)', lineHeight: 1.6, marginBottom: '2rem' }}>
            Show this to the manager at <strong style={{ color: 'var(--offwhite)' }}>{success.branchName}</strong> to claim your{' '}
            <strong style={{ color: 'var(--offwhite)' }}>{success.itemName}</strong>. Coins will be deducted on confirmation.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <button onClick={() => setSuccess(null)}
              onMouseEnter={() => setRedeemAgainHovered(true)}
              onMouseLeave={() => setRedeemAgainHovered(false)}
              style={{
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                backgroundColor: redeemAgainHovered ? 'rgba(106,106,183,0.15)' : 'var(--purple)',
                color: '#fff',
                border: '1px solid var(--purple)',
                padding: '0.9rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-inter)',
                cursor: 'pointer',
                backdropFilter: redeemAgainHovered ? 'blur(10px)' : 'none',
                transition: 'all 0.3s ease',
              }}>
              <span style={{
                position: 'absolute', top: 0,
                left: redeemAgainHovered ? '120%' : '-60%',
                width: '40%', height: '100%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                transform: 'skewX(-20deg)',
                transition: 'left 0.5s ease',
                pointerEvents: 'none',
              }} />
              Redeem Something Else
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

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

        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.6rem' : '2rem', color: 'var(--offwhite)', marginBottom: '1.25rem' }}>
          Redeem OB Coins
        </h1>

        <div style={{
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '4px',
          backgroundColor: 'rgba(255,255,255,0.02)',
          padding: isMobile ? '1.25rem' : '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Your Balance
          </span>
          <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--teal)' }}>
            {obCoins.toLocaleString()} coins
          </span>
        </div>

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : items.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)',
            borderRadius: '4px',
            padding: isMobile ? '3rem 1.5rem' : '4rem',
            textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.3)' }}>
              No redeemable items available right now.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {items.map(item => {
              const canAfford = obCoins >= item.coinCost
              const isConfirming = confirmingId === item.id

              return (
                <div key={item.id} style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '4px',
                  padding: isMobile ? '1.1rem' : '1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.9rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <div>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color: 'var(--offwhite)', marginBottom: '0.3rem' }}>{item.name}</p>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.45)' }}>{item.description}</p>
                    </div>
                    <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color: 'var(--teal)', whiteSpace: 'nowrap' }}>{item.coinCost} coins</span>
                  </div>

                  {isConfirming ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.9rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-inter)', fontSize: '0.82rem' }}>
                        <span style={{ color: 'rgba(245,242,236,0.4)' }}>Current Balance</span>
                        <span style={{ color: 'var(--offwhite)' }}>{obCoins.toLocaleString()} coins</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-inter)', fontSize: '0.82rem' }}>
                        <span style={{ color: 'rgba(245,242,236,0.4)' }}>Remaining After Redemption</span>
                        <span style={{ color: 'var(--teal)' }}>{(obCoins - item.coinCost).toLocaleString()} coins</span>
                      </div>

                      <div>
                        <label style={labelStyle}>Branch</label>
                        <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ ...inputStyle, color: '#F5F2EC', backgroundColor: '#1a1a1a' }}>
                          {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>

                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button
                          onClick={() => handleConfirm(item)}
                          disabled={submitting}
                          onMouseEnter={() => setHoveredBtn(`confirm-${item.id}`)}
                          onMouseLeave={() => setHoveredBtn(null)}
                          style={{
                            flex: 1,
                            backgroundColor: !submitting && hoveredBtn === `confirm-${item.id}` ? 'rgba(106,106,183,0.8)' : 'var(--purple)',
                            color: '#fff',
                            border: 'none',
                            padding: '0.8rem',
                            borderRadius: '2px',
                            fontSize: '0.75rem',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            fontFamily: 'var(--font-inter)',
                            cursor: submitting ? 'not-allowed' : 'pointer',
                            opacity: submitting ? 0.6 : 1,
                            boxShadow: !submitting && hoveredBtn === `confirm-${item.id}` ? '0 6px 14px rgba(106,106,183,0.4)' : 'none',
                            transition: 'all 0.2s ease',
                          }}
                        >{submitting ? 'Submitting…' : 'Confirm Redemption'}</button>
                        <button
                          onClick={() => setConfirmingId(null)}
                          disabled={submitting}
                          onMouseEnter={() => setHoveredBtn(`cancel-${item.id}`)}
                          onMouseLeave={() => setHoveredBtn(null)}
                          style={{
                            flex: isMobile ? 1 : 'initial',
                            background: hoveredBtn === `cancel-${item.id}` ? 'rgba(255,255,255,0.06)' : 'transparent',
                            border: `1px solid ${hoveredBtn === `cancel-${item.id}` ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                            color: hoveredBtn === `cancel-${item.id}` ? 'var(--offwhite)' : 'rgba(245,242,236,0.5)',
                            padding: '0.8rem 1.5rem',
                            borderRadius: '2px',
                            fontSize: '0.75rem',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            fontFamily: 'var(--font-inter)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                        >Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => startRedeem(item)}
                      disabled={!canAfford}
                      onMouseEnter={() => setHoveredBtn(`redeem-${item.id}`)}
                      onMouseLeave={() => setHoveredBtn(null)}
                      style={{
                        width: isMobile ? '100%' : 'auto',
                        alignSelf: isMobile ? 'stretch' : 'flex-end',
                        backgroundColor: canAfford ? (hoveredBtn === `redeem-${item.id}` ? 'rgba(106,106,183,0.8)' : 'var(--purple)') : 'rgba(255,255,255,0.05)',
                        color: canAfford ? '#fff' : 'rgba(245,242,236,0.35)',
                        border: 'none',
                        padding: '0.8rem 1.5rem',
                        borderRadius: '2px',
                        fontSize: '0.75rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        fontFamily: 'var(--font-inter)',
                        cursor: canAfford ? 'pointer' : 'not-allowed',
                        boxShadow: canAfford && hoveredBtn === `redeem-${item.id}` ? '0 6px 14px rgba(106,106,183,0.4)' : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >{canAfford ? 'Redeem' : 'Not enough coins'}</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
