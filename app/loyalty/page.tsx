'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Navbar from '../components/layout/Navbar'
import { useCustomerUser } from '../lib/customerAuth'
import Footer from '../components/layout/Footer'
import Reveal from '../components/Reveal'
import Skeleton from '../components/Skeleton'
import { useIsMobile } from '../lib/useIsMobile'
import { useRedemptionItems, type RedemptionItem } from '../lib/redemptions'
import { PLACEHOLDER } from '../lib/placeholderAssets'
import { useTierPerks } from '../lib/tierPerks'
import { TIERS, tierColor } from '../lib/loyaltyTiers'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle } from '@fortawesome/free-brands-svg-icons'
import {
  faChartLine, faCoins, faReceipt, faCalendarDay,
  faArrowRight, faMugHot, faMugSaucer, faBurger, faTicket, faGift,
} from '@fortawesome/free-solid-svg-icons'

const EARN_CARDS = [
  {
    icon: faReceipt,
    color: 'var(--teal)',
    title: 'Order at any branch',
    desc: 'Every dollar you spend earns you points. Submit your check through your profile after your visit.',
    pointsEarned: 10, coins: 1, unit: 'per $1 spent',
    note: 'Tip — split the bill and share the reward',
  },
  {
    icon: faCalendarDay,
    color: 'var(--red)',
    title: 'Attend an event',
    desc: 'Come to any Onboard event — board game nights, tournaments, themed evenings — and earn a big point bonus just for showing up.',
    pointsEarned: 250, coins: 50, unit: 'per event',
  },
]

const SUBMIT_STEPS = [
  'Order food or drinks at any Onboard branch',
  'Ask for your check and note the check number',
  'Go to your profile and tap "Submit a check"',
  'Enter the check number, branch, total amount, and upload a photo of your check',
  'Optionally split it with friends — everyone earns equally',
  'A manager reviews and approves — points land in your account',
]

function getRedemptionIcon(item: RedemptionItem) {
  const text = `${item.name} ${item.description}`.toLowerCase()
  if (text.includes('coffee')) return faMugHot
  if (text.includes('drink')) return faMugSaucer
  if (text.includes('burger') || text.includes('food')) return faBurger
  if (text.includes('ticket') || text.includes('event')) return faTicket
  return faGift
}

function SectionHeading({ eyebrow, title, isMobile, color = 'var(--teal)' }: {
  eyebrow: string
  title: string
  isMobile: boolean
  color?: string
}) {
  return (
    <>
      <p style={{
        fontSize: '0.7rem',
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        color,
        marginBottom: '1rem',
        fontFamily: 'var(--font-inter)',
      }}>{eyebrow}</p>

      <h2 style={{
        fontFamily: 'var(--font-cinzel)',
        fontSize: isMobile ? '1.75rem' : '2.5rem',
        color: 'var(--offwhite)',
        marginBottom: '1.5rem',
      }}>{title}</h2>

      <div style={{
        width: '60px', height: '2px',
        backgroundColor: color,
        marginBottom: isMobile ? '2rem' : '3rem',
      }} />
    </>
  )
}

export default function LoyaltyPage() {
  const isMobile = useIsMobile()
  const { user } = useCustomerUser()
  const { items: redemptionItems, loading: loadingRedemptions } = useRedemptionItems(true)
  const { perks: PERKS, loading: loadingPerks } = useTierPerks()
  const [hoveredTierBtn, setHoveredTierBtn] = useState<string | null>(null)
  const [signInHovered, setSignInHovered] = useState(false)
  const [profileLinkHovered, setProfileLinkHovered] = useState(false)
  const [joinHovered, setJoinHovered] = useState(false)


  return (
    <>
      <Navbar />
      <main>

        {/* 1. Hero */}
        <section style={{
          position: 'relative',
          minHeight: isMobile ? '70vh' : '75vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: isMobile ? '8rem 1.5rem 3rem' : '7rem 2rem 4rem',
          overflow: 'hidden',
        }}>
          <Image
            src={PLACEHOLDER.heroBackground}
            alt="Onboard interior"
            fill
            priority
            sizes="100vw"
            style={{ objectFit: 'cover', objectPosition: 'center' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,5,0.82)' }} />
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `
              radial-gradient(ellipse at 25% 70%, rgba(0,160,152,0.25) 0%, transparent 55%),
              radial-gradient(ellipse at 75% 25%, rgba(106,106,183,0.25) 0%, transparent 55%)
            `,
          }} />

          <div style={{ position: 'relative', zIndex: 1, maxWidth: '720px' }}>
            <p style={{
              fontSize: isMobile ? '0.62rem' : '0.7rem',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: '1.2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.8rem',
              fontFamily: 'var(--font-inter)',
            }}>
              <span style={{ display: 'block', width: '30px', height: '1px', background: 'var(--teal)', opacity: 0.5 }} />
              Rewards Program
              <span style={{ display: 'block', width: '30px', height: '1px', background: 'var(--teal)', opacity: 0.5 }} />
            </p>

            <h1 style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: isMobile ? '2.1rem' : '3.6rem',
              color: 'var(--offwhite)',
              lineHeight: 1.2,
              marginBottom: '1rem',
            }}>
              The Onboard<br />Loyalty Program
            </h1>

            <p style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: isMobile ? '0.95rem' : '1.2rem',
              color: 'var(--teal)',
              marginBottom: '1.5rem',
            }}>
              Every visit, every game, every adventure — rewarded.
            </p>

            <p style={{
              fontFamily: 'var(--font-inter)',
              fontSize: isMobile ? '0.85rem' : '1rem',
              color: 'rgba(245,242,236,0.6)',
              lineHeight: 1.8,
              maxWidth: '520px',
              margin: '0 auto 2.5rem',
            }}>
              Loyal customers earn points to level up and unlock permanent perks, and Points
              to redeem for free food and drinks. The more you play and visit, the more
              Onboard gives back.
            </p>

            <div style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              gap: '0.7rem',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              {user ? (
                <Link href="/customer/profile"
                  onMouseEnter={() => setSignInHovered(true)}
                  onMouseLeave={() => setSignInHovered(false)}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    backgroundColor: signInHovered ? 'rgba(0,160,152,0.15)' : 'var(--teal)',
                    color: '#fff',
                    padding: '0.65rem 1.4rem',
                    borderRadius: '2px',
                    fontSize: '0.72rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    textDecoration: 'none',
                    fontFamily: 'var(--font-inter)',
                    width: isMobile ? '100%' : 'auto',
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
                  Go to Profile
                </Link>
              ) : (
                <>
                  <Link href="/customer/login"
                    onMouseEnter={() => setSignInHovered(true)}
                    onMouseLeave={() => setSignInHovered(false)}
                    style={{
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      backgroundColor: signInHovered ? 'rgba(0,160,152,0.15)' : 'var(--teal)',
                      color: '#fff',
                      padding: '0.65rem 1.4rem',
                      borderRadius: '2px',
                      fontSize: '0.72rem',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      textDecoration: 'none',
                      fontFamily: 'var(--font-inter)',
                      width: isMobile ? '100%' : 'auto',
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
                    <FontAwesomeIcon icon={faGoogle} style={{ width: '12px' }} />
                    Sign In
                  </Link>

                  <Link href="/customer/profile"
                    onMouseEnter={() => setProfileLinkHovered(true)}
                    onMouseLeave={() => setProfileLinkHovered(false)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: profileLinkHovered ? 'rgba(245,242,236,0.08)' : 'transparent',
                      border: `1px solid ${profileLinkHovered ? 'rgba(245,242,236,0.5)' : 'rgba(245,242,236,0.25)'}`,
                      color: profileLinkHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.8)',
                      padding: '0.65rem 1.4rem',
                      borderRadius: '2px',
                      fontSize: '0.72rem',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      textDecoration: 'none',
                      fontFamily: 'var(--font-inter)',
                      width: isMobile ? '100%' : 'auto',
                      transition: 'all 0.2s ease',
                    }}>
                    My Profile
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '3.5rem 1.25rem' : '6rem 3rem' }}>

          {/* 2. The two currencies */}
          <Reveal>
            <section style={{ marginBottom: isMobile ? '4rem' : '7rem' }}>
              <SectionHeading eyebrow="How It Works" title="How points work" isMobile={isMobile} color="var(--purple)" />

              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                gap: isMobile ? '1.25rem' : '2rem',
              }}>
                <div style={{
                  padding: isMobile ? '1.75rem' : '2.5rem',
                  border: '1px solid rgba(0,160,152,0.2)',
                  borderRadius: '4px',
                  background: 'rgba(0,160,152,0.05)',
                }}>
                  <div style={{
                    width: '52px', height: '52px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(0,160,152,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '1.5rem',
                  }}>
                    <FontAwesomeIcon icon={faChartLine} style={{ width: '20px', color: 'var(--teal)' }} />
                  </div>
                  <h3 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.3rem', color: 'var(--offwhite)', marginBottom: '0.9rem' }}>
                    points — Experience Points
                  </h3>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: isMobile ? '0.85rem' : '0.9rem', color: 'rgba(245,242,236,0.55)', lineHeight: 1.8 }}>
                    points is your progression currency. It accumulates as you visit, play, and attend
                    events. It never gets spent — it only grows and levels you up, unlocking
                    permanent perks along the way.
                  </p>
                </div>

                <div style={{
                  padding: isMobile ? '1.75rem' : '2.5rem',
                  border: '1px solid rgba(106,106,183,0.2)',
                  borderRadius: '4px',
                  background: 'rgba(106,106,183,0.05)',
                }}>
                  <div style={{
                    width: '52px', height: '52px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(106,106,183,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '1.5rem',
                  }}>
                    <FontAwesomeIcon icon={faCoins} style={{ width: '20px', color: 'var(--purple)' }} />
                  </div>
                  <h3 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.3rem', color: 'var(--offwhite)', marginBottom: '0.9rem' }}>
                    Points
                  </h3>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: isMobile ? '0.85rem' : '0.9rem', color: 'rgba(245,242,236,0.55)', lineHeight: 1.8 }}>
                    Points are your reward currency. Earn them alongside points and spend them on
                    free coffees, drinks, burgers, event tickets, and D&amp;D sessions at any branch.
                  </p>
                </div>
              </div>
            </section>
          </Reveal>

          {/* 3. How to earn */}
          <Reveal>
            <section style={{ marginBottom: isMobile ? '4rem' : '7rem' }}>
              <SectionHeading eyebrow="Earn As You Go" title="Two ways to earn" isMobile={isMobile} color="var(--teal)" />

              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                gap: isMobile ? '1.25rem' : '1.5rem',
              }}>
                {EARN_CARDS.map(card => (
                  <div key={card.title} style={{
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderTop: `3px solid ${card.color}`,
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.02)',
                    padding: isMobile ? '1.5rem' : '2rem',
                    display: 'flex',
                    flexDirection: 'column',
                  }}>
                    <div style={{
                      width: '48px', height: '48px',
                      borderRadius: '50%',
                      backgroundColor: `${card.color}20`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: '1.25rem',
                    }}>
                      <FontAwesomeIcon icon={card.icon} style={{ width: '18px', color: card.color }} />
                    </div>

                    <h3 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color: 'var(--offwhite)', marginBottom: '0.7rem' }}>
                      {card.title}
                    </h3>
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.5)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                      {card.desc}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginTop: 'auto' }}>
                      <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', color: card.color }}>
                        +{card.pointsEarned} points
                      </span>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.3)' }}>+</span>
                      <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', color: card.color }}>
                        {card.coins} Coins
                      </span>
                    </div>
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem' }}>
                      {card.unit}
                    </p>

                    {card.note && (
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.76rem', color: card.color, marginTop: '1rem', fontStyle: 'italic' }}>
                        {card.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </Reveal>

          {/* 4. Tier system */}
          <Reveal>
            <section style={{ marginBottom: isMobile ? '4rem' : '7rem' }}>
              <SectionHeading eyebrow="Your Status" title="Four tiers" isMobile={isMobile} color="var(--red)" />

              {isMobile ? (
                <div style={{ position: 'relative', paddingLeft: '2.2rem' }}>
                  <div style={{
                    position: 'absolute', left: '9px', top: '10px', bottom: '10px',
                    width: '2px', backgroundColor: 'rgba(255,255,255,0.08)',
                  }} />
                  {TIERS.map(tier => {
                    const color = tier.color
                    return (
                      <div key={tier.label} style={{ position: 'relative', marginBottom: '1.5rem' }}>
                        <div style={{
                          position: 'absolute', left: '-2.2rem', top: '6px',
                          width: '18px', height: '18px', borderRadius: '50%',
                          backgroundColor: color, border: '3px solid var(--black)',
                        }} />
                        <div style={{
                          border: `1px solid ${color}35`,
                          borderLeft: `3px solid ${color}`,
                          borderRadius: '4px',
                          background: `${color}0d`,
                          padding: '1.25rem 1.4rem',
                        }}>
                          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.05rem', color }}>{tier.label}</p>
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', margin: '0.3rem 0 0.6rem' }}>
                            {tier.threshold === 0 ? 'From your first visit' : `${tier.threshold.toLocaleString()}+ points earned`}
                          </p>
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.83rem', color: 'rgba(245,242,236,0.55)', lineHeight: 1.6 }}>
                            {tier.blurb}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                  {TIERS.map((tier, i) => {
                    const color = tier.color
                    return (
                      <div key={tier.label} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                        <div style={{
                          flex: 1,
                          border: `1px solid ${color}35`,
                          borderTop: `3px solid ${color}`,
                          borderRadius: '4px',
                          background: `${color}0d`,
                          padding: '1.5rem 1.25rem',
                          textAlign: 'center',
                          minHeight: '180px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}>
                          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color, marginBottom: '0.4rem' }}>{tier.label}</p>
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.8rem' }}>
                            {tier.threshold === 0 ? 'To start' : `${tier.threshold.toLocaleString()}+`}
                          </p>
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.76rem', color: 'rgba(245,242,236,0.5)', lineHeight: 1.6 }}>
                            {tier.blurb}
                          </p>
                        </div>
                        {i < TIERS.length - 1 && (
                          <FontAwesomeIcon icon={faArrowRight} style={{ width: '14px', color: 'rgba(245,242,236,0.15)', flexShrink: 0, margin: '0 0.6rem' }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </Reveal>

          {/* 6. Perks by tier */}
          <Reveal>
            <section style={{ marginBottom: isMobile ? '4rem' : '7rem' }}>
              <SectionHeading eyebrow="The Payoff" title="What each tier gets you" isMobile={isMobile} color="var(--purple)" />

              {loadingPerks ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                  {[0, 1, 2].map(i => <Skeleton key={i} height="70px" borderRadius="4px" />)}
                </div>
              ) : isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                  {PERKS.map(p => {
                    const color = tierColor(p.tier)
                    return (
                      <div key={p.id} style={{
                        border: `1px solid ${color}30`,
                        borderLeft: `3px solid ${color}`,
                        borderRadius: '4px',
                        background: `${color}0a`,
                        padding: '1.1rem 1.25rem',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color }}>{p.tier}</span>
                          
                        </div>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.6)', lineHeight: 1.6 }}>{p.perk}</p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                  {PERKS.map((p, i) => {
                    const color = tierColor(p.tier)
                    return (
                      <div key={p.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '120px 160px 1fr',
                        alignItems: 'center',
                        padding: '1.1rem 1.5rem',
                        borderLeft: `3px solid ${color}`,
                        borderBottom: i < PERKS.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                      }}>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', letterSpacing: '0.1em', textTransform: 'uppercase', color }}>{p.tier}</span>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(245,242,236,0.7)' }}>{p.perk}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </Reveal>

          {/* 7. Point redemptions */}
          <Reveal>
            <section style={{ marginBottom: isMobile ? '4rem' : '7rem' }}>
              <SectionHeading eyebrow="Spend Your Points" title="Redeem your points" isMobile={isMobile} color="var(--teal)" />

              {loadingRedemptions ? (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '1.25rem' }}>
                  {[0, 1, 2].map(i => <Skeleton key={i} height="160px" borderRadius="4px" />)}
                </div>
              ) : redemptionItems.length === 0 ? (
                <div style={{
                  border: '1px dashed rgba(255,255,255,0.08)',
                  borderRadius: '4px',
                  padding: isMobile ? '2.5rem 1.5rem' : '3rem',
                  textAlign: 'center',
                }}>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.35)' }}>
                    Redeemable items are being set up — check back soon!
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '1.25rem' }}>
                  {redemptionItems.map(item => (
                    <div key={item.id} style={{
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '4px',
                      background: 'rgba(255,255,255,0.02)',
                      padding: isMobile ? '1.4rem' : '1.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                    }}>
                      <div style={{
                        width: '44px', height: '44px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(0,160,152,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: '1.1rem',
                      }}>
                        <FontAwesomeIcon icon={getRedemptionIcon(item)} style={{ width: '16px', color: 'var(--teal)' }} />
                      </div>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
                        {item.name}
                      </p>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.5)', lineHeight: 1.6, marginBottom: '1.1rem', flex: 1 }}>
                        {item.description}
                      </p>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.15rem', color: 'var(--teal)' }}>
                        {item.coinCost} coins
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.35)', marginTop: '1.5rem', textAlign: 'center' }}>
                Redeem directly from your profile. A manager confirms your request in-branch when you arrive.
              </p>
            </section>
          </Reveal>

          {/* 8. How to submit a check */}
          <Reveal>
            <section>
              <SectionHeading eyebrow="Earning Made Easy" title="How to submit a check" isMobile={isMobile} color="var(--red)" />

              {isMobile ? (
                <div style={{ position: 'relative', paddingLeft: '2.2rem' }}>
                  <div style={{
                    position: 'absolute', left: '11px', top: '12px', bottom: '12px',
                    width: '2px', backgroundColor: 'rgba(228,51,41,0.2)',
                  }} />
                  {SUBMIT_STEPS.map((step, i) => (
                    <div key={i} style={{ position: 'relative', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                      <div style={{
                        position: 'absolute', left: '-2.2rem', top: 0,
                        width: '24px', height: '24px', borderRadius: '50%',
                        backgroundColor: 'var(--red)', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-cinzel)', fontSize: '0.75rem',
                        border: '3px solid var(--black)',
                      }}>{i + 1}</div>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.65)', lineHeight: 1.7 }}>
                        {step}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', top: '17px', left: '5%', right: '5%',
                    height: '2px', backgroundColor: 'rgba(228,51,41,0.2)', zIndex: 0,
                  }} />
                  {SUBMIT_STEPS.map((step, i) => (
                    <div key={i} style={{ flex: 1, textAlign: 'center', padding: '0 0.6rem', position: 'relative', zIndex: 1 }}>
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        backgroundColor: 'var(--red)', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem',
                        margin: '0 auto 1rem',
                        border: '3px solid var(--black)',
                      }}>{i + 1}</div>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.55)', lineHeight: 1.6 }}>
                        {step}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </Reveal>

        </div>

        {/* 9. Bottom CTA */}
        <Reveal>
          <section style={{
            position: 'relative',
            textAlign: 'center',
            padding: isMobile ? '4rem 1.5rem' : '6rem 2rem',
            overflow: 'hidden',
            background: 'linear-gradient(180deg, rgba(0,160,152,0.06) 0%, rgba(10,10,10,0) 100%)',
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: 'radial-gradient(ellipse at 50% 0%, rgba(0,160,152,0.15) 0%, transparent 60%)',
            }} />

            <div style={{ position: 'relative', zIndex: 1 }}>
              <h2 style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: isMobile ? '1.8rem' : '2.6rem',
                color: 'var(--offwhite)',
                marginBottom: '1rem',
              }}>
                Ready to start your adventure?
              </h2>
              <p style={{
                fontFamily: 'var(--font-inter)',
                fontSize: isMobile ? '0.85rem' : '0.95rem',
                color: 'rgba(245,242,236,0.55)',
                marginBottom: '2.25rem',
              }}>
                Sign in with your Google account — it takes 10 seconds.
              </p>

              <Link href={user ? '/customer/profile' : '/customer/login'}
                onMouseEnter={() => setJoinHovered(true)}
                onMouseLeave={() => setJoinHovered(false)}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  backgroundColor: joinHovered ? 'rgba(0,160,152,0.15)' : 'var(--teal)',
                  color: '#fff',
                  padding: '1.1rem 3rem',
                  borderRadius: '2px',
                  fontSize: '0.85rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-inter)',
                  marginBottom: '1.5rem',
                  border: '1px solid var(--teal)',
                  backdropFilter: joinHovered ? 'blur(10px)' : 'none',
                  boxShadow: joinHovered ? '0 0 24px rgba(0,160,152,0.4)' : 'none',
                  transition: 'all 0.3s ease',
                }}>
                <span style={{
                  position: 'absolute', top: 0,
                  left: joinHovered ? '120%' : '-60%',
                  width: '40%', height: '100%',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                  transform: 'skewX(-20deg)',
                  transition: 'left 0.5s ease',
                  pointerEvents: 'none',
                }} />
                {!user && <FontAwesomeIcon icon={faGoogle} style={{ width: '15px' }} />}
                {user ? 'Go to your profile' : 'Join the loyalty program'}
              </Link>

            </div>
          </section>
        </Reveal>

      </main>
      <Footer />
    </>
  )
}
