'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { useIsStaff } from '../../lib/adminAuth'
import { BRAND } from '../../lib/brand'
import { PLACEHOLDER } from '../../lib/placeholderAssets'

function HeroButton({
  label, color, onClick
}: {
  label: string
  color: string
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: hovered ? `${color}30` : `${color}15`,
        color: '#fff',
        padding: '0.75rem 1.5rem',
        borderRadius: '2px',
        fontSize: '0.78rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-inter)',
        border: `1px solid ${hovered ? color : `${color}60`}`,
        backdropFilter: 'blur(10px)',
        transition: 'all 0.3s ease',
        boxShadow: hovered
          ? `0 0 20px ${color}50, inset 0 0 20px ${color}15`
          : 'none',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}>
      <span style={{
        position: 'absolute',
        top: 0,
        left: hovered ? '120%' : '-60%',
        width: '40%',
        height: '100%',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
        transform: 'skewX(-20deg)',
        transition: 'left 0.5s ease',
        pointerEvents: 'none',
      }} />
      {label}
    </button>
  )
}

export default function Hero() {
  const router = useRouter()
  const [isMobile, setIsMobile] = useState(false)
  const isStaff = useIsStaff()

  const bgRef       = useRef<HTMLDivElement>(null)
  const overlayRef  = useRef<HTMLDivElement>(null)
  const eyebrowRef  = useRef<HTMLParagraphElement>(null)
  const logoRef     = useRef<HTMLDivElement>(null)
  const taglineRef  = useRef<HTMLParagraphElement>(null)
  const buttonsRef  = useRef<HTMLDivElement>(null)
  const scrollRef   = useRef<HTMLDivElement>(null)

  // isMobile starts false (SSR-safe default) and corrects itself here on
  // mount — introReady gates the animation below until *after* that
  // correction lands, so it never captures the desktop button layout's
  // children only to have them replaced by the mobile rows moments later.
  const [introReady, setIntroReady] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    setIntroReady(true)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Fires once introReady flips true (the first render with the correct,
  // final button layout already committed), never again afterward — a
  // later resize toggling isMobile swaps the buttons' children but doesn't
  // replay this entrance. Each button row (two on either layout) is
  // staggered as a whole rather than reaching into HeroButton itself.
  useLayoutEffect(() => {
    if (!introReady) return
    // Every target's hidden starting point (opacity/scale) is already
    // baked into its JSX style below, not set here — that's what's in the
    // very first paint (and the server-rendered HTML), so there's nothing
    // to flash from before this timeline takes over and animates it in.
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

    tl.to(bgRef.current, { scale: 1, opacity: 1, duration: 1.6, ease: 'power2.out' })
      .to(overlayRef.current, { opacity: 1, duration: 1.2 }, '<')
      .to(eyebrowRef.current, { opacity: 1, y: 0, duration: 0.7 }, '-=0.9')
      .to(logoRef.current, { opacity: 1, y: 0, duration: 0.9, ease: 'back.out(1.4)' }, '-=0.4')
      .to(taglineRef.current, { opacity: 1, y: 0, duration: 0.7 }, '-=0.4')
      .to(buttonsRef.current ? Array.from(buttonsRef.current.children) : [], {
        opacity: 1, y: 0, duration: 0.6, stagger: 0.12,
      }, '-=0.3')
      .to(scrollRef.current, { opacity: 1, duration: 0.6 }, '-=0.1')

    return () => { tl.kill() }
  }, [introReady])

  function scrollTo(id: string) {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section style={{
      position: 'relative',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: isMobile ? '5rem 1.5rem 3rem' : '6rem 2rem 4rem',
      overflow: 'hidden',
    }}>

      {/* Background Image — wrapped so GSAP scales/fades the wrapper, not
          the next/image-managed <img> itself */}
      <div ref={bgRef} style={{ position: 'absolute', inset: 0, opacity: 0, transform: 'scale(1.12)' }}>
        <Image
          src={PLACEHOLDER.heroBackground}
          alt={`${BRAND.name} interior`}
          fill
          priority
          sizes="100vw"
          style={{ objectFit: 'cover', objectPosition: 'center' }}
        />
      </div>

      {/* Dark overlay + color glows, faded in together with the background */}
      <div ref={overlayRef} style={{ opacity: 0 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `
            radial-gradient(ellipse at 30% 60%, rgba(50,50,124,0.3) 0%, transparent 60%),
            radial-gradient(ellipse at 70% 30%, rgba(0,160,152,0.15) 0%, transparent 50%)
          `,
        }} />
      </div>

      {/* Eyebrow */}
      <p ref={eyebrowRef} style={{
        position: 'relative', zIndex: 1,
        opacity: 0, transform: 'translateY(24px)',
        fontSize: isMobile ? '0.6rem' : '0.7rem',
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        color: 'var(--teal)',
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
      }}>
        <span style={{ display: 'block', width: '30px', height: '1px', background: 'var(--teal)', opacity: 0.5 }} />
        {BRAND.tagline}
        <span style={{ display: 'block', width: '30px', height: '1px', background: 'var(--teal)', opacity: 0.5 }} />
      </p>

      {/* Logo */}
      <div ref={logoRef} style={{ position: 'relative', zIndex: 1, marginBottom: '1.5rem', opacity: 0, transform: 'translateY(24px)' }}>
        <Image
          src={BRAND.logoUrl}
          alt={BRAND.name}
          width={isMobile ? 200 : 340}
          height={isMobile ? 200 : 340}
          style={{ width: isMobile ? 200 : 340, height: 'auto', display: 'block' }}
          priority
        />
      </div>

      {/* Tagline */}
      <p ref={taglineRef} style={{
        position: 'relative', zIndex: 1,
        opacity: 0, transform: 'translateY(24px)',
        fontFamily: 'var(--font-inter)',
        fontSize: isMobile ? '0.85rem' : '1rem',
        fontWeight: 300,
        letterSpacing: '0.05em',
        color: 'rgba(245,242,236,0.6)',
        maxWidth: isMobile ? '300px' : '480px',
        lineHeight: 1.9,
        marginBottom: '2.5rem',
      }}>
        Where every meal comes with a story and every story begins with a product.
        {`${BRAND.branches.length} branches.`}
      </p>

      {/* Buttons */}
      <div ref={buttonsRef} style={{
        position: 'relative', zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.8rem',
        width: '100%',
        maxWidth: isMobile ? '320px' : '600px',
      }}>

        {isMobile ? (
          // Mobile — 2 columns
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', width: '100%', opacity: 0, transform: 'translateY(20px)' }}>
              <HeroButton label="Our Menu"  color="#00A098" onClick={() => scrollTo('menu-section')} />
              <HeroButton label="Shop"      color="#6A6AB7" onClick={() => scrollTo('shop-section')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', width: '100%', opacity: 0, transform: 'translateY(20px)' }}>
              <HeroButton label="Events"    color="#E43329" onClick={() => scrollTo('events-section')} />
              <HeroButton label={isStaff ? 'CMS' : 'Reserve'} color="#32327C" onClick={() => router.push(isStaff ? '/admin' : '/tables')} />
            </div>
          </>
        ) : (
          // Desktop — 2 x 2. Was 3 + 2 with a "Dungeons & Dragons" button
          // filling the second row; four buttons split evenly rather than
          // leaving one stranded on a row of its own.
          <>
            <div style={{ display: 'flex', gap: '1rem', opacity: 0, transform: 'translateY(20px)' }}>
              <HeroButton label="Our Menu"          color="#00A098" onClick={() => scrollTo('menu-section')} />
              <HeroButton label="Shop"              color="#6A6AB7" onClick={() => scrollTo('shop-section')} />
            </div>
            <div style={{ display: 'flex', gap: '1rem', opacity: 0, transform: 'translateY(20px)' }}>
              <HeroButton label="Events"            color="#E43329" onClick={() => scrollTo('events-section')} />
              <HeroButton label={isStaff ? 'CMS' : 'Reserve a Spot'} color="#32327C" onClick={() => router.push(isStaff ? '/admin' : '/tables')} />
            </div>
          </>
        )}
      </div>

      {/* Scroll hint */}
      <div ref={scrollRef} style={{
        position: 'absolute', zIndex: 1,
        opacity: 0,
        bottom: '2rem',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        color: 'rgba(245,242,236,0.2)',
        fontSize: '0.6rem',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
      }}>
        <div style={{ width: '1px', height: '35px', background: 'linear-gradient(to bottom, rgba(0,160,152,0.6), transparent)' }} />
        Scroll
      </div>
    </section>
  )
}