'use client'

import { useEffect, useState } from 'react'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'
import Image from 'next/image'
import { PLACEHOLDER } from '../lib/placeholderAssets'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBagShopping, faMugHot, faCalendarCheck, faTrophy, type IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { BRAND } from '../lib/brand'

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

export default function AboutPage() {
  const isMobile = useIsMobile()

  return (
    <>
      <Navbar />
      <main>

        {/* Hero */}
        <section style={{
          position: 'relative',
          height: isMobile ? '32vh' : '50vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url(${PLACEHOLDER.heroBackground})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(0,0,0,0.6) 100%)',
          }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <p style={{
              fontSize: '0.7rem',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: '1rem',
              fontFamily: 'var(--font-inter)',
            }}>Our Story</p>
            <h1 style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: isMobile ? '2.2rem' : '3.5rem',
              color: 'var(--offwhite)',
              lineHeight: 1.2,
            }}>About {BRAND.name}</h1>
          </div>
        </section>

        {/* Story Section */}
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '3rem 1.25rem' : '6rem 3rem' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: isMobile ? '2rem' : '5rem',
            alignItems: 'center',
            marginBottom: isMobile ? '3rem' : '6rem',
          }}>
            <div>
              <p style={{
                fontSize: '0.7rem',
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: 'var(--teal)',
                marginBottom: '1rem',
                fontFamily: 'var(--font-inter)',
              }}>Who We Are</p>
              <h2 style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: isMobile ? '1.75rem' : '2.5rem',
                color: 'var(--offwhite)',
                lineHeight: 1.2,
                marginBottom: '1.5rem',
              }}>More than a café.<br />A place to play.</h2>
              <div style={{
                width: '60px', height: '2px',
                backgroundColor: 'var(--teal)',
                marginBottom: '2rem',
              }} />
              <p style={{
                color: 'rgba(245,242,236,0.55)',
                lineHeight: 1.9,
                marginBottom: '1.2rem',
                fontFamily: 'var(--font-inter)',
              }}>
                {BRAND.name} was born from a simple belief: the best moments happen
                around a table. Good coffee, food worth staying for, and a room that
                makes people want to sit a while longer — that is the whole idea.
              </p>
              <p style={{
                color: 'rgba(245,242,236,0.55)',
                lineHeight: 1.9,
                marginBottom: '1.2rem',
                fontFamily: 'var(--font-inter)',
              }}>
                We started with one room and a short menu, and grew from there. Today
                we run {BRAND.branches.length} branch{BRAND.branches.length === 1 ? '' : 'es'} —{' '}
                {BRAND.branches.join(', ')} — each with its own character but all sharing
                the same kitchen standards and the same welcome.
              </p>
              <p style={{
                color: 'rgba(245,242,236,0.55)',
                lineHeight: 1.9,
                fontFamily: 'var(--font-inter)',
              }}>
                From a quiet morning coffee to a full table booking for the evening,
                {' '}{BRAND.name} is built around the people who keep coming back.
              </p>
            </div>

            <div style={{
              position: 'relative',
              height: isMobile ? '260px' : '500px',
              borderRadius: '4px',
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <Image
                src={PLACEHOLDER.heroBackground}
                alt={`${BRAND.name} interior`}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                style={{ objectFit: 'cover' }}
              />
            </div>
          </div>

          {/* Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '1px',
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '4px',
            overflow: 'hidden',
            marginBottom: isMobile ? '3rem' : '6rem',
          }}>
            {[
              { num: '500+', label: 'Products in Stock' },
              { num: String(BRAND.branches.length), label: BRAND.branches.length === 1 ? 'Branch' : 'Branches' },
              { num: '5+',   label: 'Years Serving' },
              { num: '∞',    label: 'Good Times' },
            ].map(({ num, label }) => (
              <div key={label} style={{
                padding: isMobile ? '2rem 1rem' : '3rem 2rem',
                textAlign: 'center',
                backgroundColor: 'var(--black)',
              }}>
                <p style={{
                  fontFamily: 'var(--font-cinzel)',
                  fontSize: isMobile ? '1.8rem' : '2.5rem',
                  color: 'var(--teal)',
                  marginBottom: '0.5rem',
                }}>{num}</p>
                <p style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: 'rgba(245,242,236,0.35)',
                }}>{label}</p>
              </div>
            ))}
          </div>

          {/* What We Offer */}
          <div style={{ marginBottom: isMobile ? '3rem' : '6rem' }}>
            <p style={{
              fontSize: '0.7rem',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: '1rem',
              fontFamily: 'var(--font-inter)',
            }}>What We Offer</p>
            <h2 style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: isMobile ? '1.75rem' : '2.5rem',
              color: 'var(--offwhite)',
              marginBottom: '1.5rem',
            }}>Everything Under One Roof</h2>
            <div style={{
              width: '60px', height: '2px',
              backgroundColor: 'var(--teal)',
              marginBottom: isMobile ? '2rem' : '3rem',
            }} />
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
              gap: isMobile ? '1rem' : '1.5rem',
            }}>
              {/* Icons used to be four pieces of the original café's icon art
                  (icon-1..4.png), drawn as 48px backgroundImages with
                  mixBlendMode: 'screen' so their black background dropped out.
                  FontAwesome is what the rest of the app uses, tints from the
                  card's own accent colour, and ships nothing. */}
              {([
                {
                  icon: faBagShopping,
                  title: 'Shop the Shelves',
                  text: 'A shelf of products worth taking home, priced in-store and online. Ask any of us and we will point you at the right one.',
                  color: 'var(--teal)',
                },
                {
                  icon: faMugHot,
                  title: 'Restaurant & Café',
                  text: 'A full food and drinks menu built for staying a while. From proper plates to a quick pastry with your coffee.',
                  color: 'var(--red)',
                },
                {
                  icon: faCalendarCheck,
                  title: 'Book a Table',
                  text: 'Reserve a table at any branch ahead of time — pick your spot on the floor plan and bring whoever you like.',
                  color: 'var(--purple)',
                },
                {
                  icon: faTrophy,
                  title: 'Events & Tournaments',
                  text: 'Tastings, launches, family days and special evenings, across every branch throughout the year.',
                  color: 'var(--navy)',
                },
              ] as { icon: IconDefinition; title: string; text: string; color: string }[])
                .map(({ icon, title, text, color }) => (
                <div key={title} style={{
                  display: 'flex',
                  gap: '1.5rem',
                  padding: isMobile ? '1.5rem' : '2rem',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '4px',
                  background: 'rgba(255,255,255,0.02)',
                  alignItems: 'flex-start',
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <FontAwesomeIcon icon={icon} style={{ fontSize: '1.15rem', color }} />
                  </div>
                  <div>
                    <h3 style={{
                      fontFamily: 'var(--font-cinzel)',
                      fontSize: '1rem',
                      color: 'var(--offwhite)',
                      marginBottom: '0.6rem',
                    }}>{title}</h3>
                    <p style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.82rem',
                      color: 'rgba(245,242,236,0.45)',
                      lineHeight: 1.7,
                    }}>{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </section>

      </main>
      <Footer />
    </>
  )
}
