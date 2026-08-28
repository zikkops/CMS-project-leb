'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { gsap } from 'gsap'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'

const ROLL_SEQ = [17, 3, 20, 8, 14, 2, 19, 6, 11, 4, 16, 9, 7, 13, 5, 18, 10, 12, 15, 20, 3, 8]

function D20({ num, rolling }: { num: number; rolling: boolean }) {
  const cx = 100, cy = 100, r = 88
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
  const pts = hex.map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <svg viewBox="0 0 200 200" width={220} height={220} xmlns="http://www.w3.org/2000/svg"
      aria-label={`D20 showing ${num}`}>
      <defs>
        <filter id="d20glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={rolling ? 1.5 : 5} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="d20fill" cx="45%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#1e0f42" />
          <stop offset="100%" stopColor="#0b0619" />
        </radialGradient>
      </defs>
      <polygon points={pts} fill="url(#d20fill)" stroke="#00a098" strokeWidth="2.5" />
      {hex.map(([x, y], i) => (
        <line key={i} x1={x} y1={y} x2={cx} y2={cy}
          stroke="rgba(0,160,152,0.28)" strokeWidth="1.2" />
      ))}
      {hex.map(([x, y], i) => {
        const [nx, ny] = hex[(i + 1) % 6]
        return <line key={`m${i}`} x1={(x + nx) / 2} y1={(y + ny) / 2} x2={cx} y2={cy}
          stroke="rgba(0,160,152,0.14)" strokeWidth="1" />
      })}
      <text x={cx} y={cy + (num >= 10 ? 15 : 22)} textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize={num >= 10 ? '46' : '58'}
        fontWeight="bold" fill="#00a098" filter="url(#d20glow)"
      >{num}</text>
      <text x={cx} y={cy + 62} textAnchor="middle"
        fontFamily="'Arial', sans-serif" fontSize="9" letterSpacing="2"
        fill="rgba(0,160,152,0.5)">D20</text>
    </svg>
  )
}

export default function NotFound() {
  const dieRef   = useRef<HTMLDivElement>(null)
  const fourRef  = useRef<HTMLDivElement>(null)
  const textRef  = useRef<HTMLDivElement>(null)
  const linksRef = useRef<HTMLDivElement>(null)

  const [displayNum, setDisplayNum] = useState(20)
  const [rolling, setRolling]       = useState(true)
  const [landed, setLanded]         = useState(false)
  const [rollKey, setRollKey]       = useState(0)
  const [hoverDie, setHoverDie]     = useState(false)
  const [hoverHome, setHoverHome]   = useState(false)
  const [hoverShop, setHoverShop]   = useState(false)

  useEffect(() => {
    const isReroll = rollKey > 0
    const timers: ReturnType<typeof setTimeout>[] = []
    const ivals:  ReturnType<typeof setInterval>[] = []

    if (isReroll) {
      // Kill idle float, snap rotation to nearest upright multiple of 360
      gsap.killTweensOf(dieRef.current)
      const curr = (gsap.getProperty(dieRef.current, 'rotation') as number) || 0
      gsap.set(dieRef.current, { rotation: Math.round(curr / 360) * 360, y: 0, scaleX: 1, scaleY: 1 })
      setDisplayNum(20)
      setRolling(true)
      setLanded(false)
    }

    // ── Physical motion ──
    const tl = gsap.timeline()

    if (!isReroll) {
      tl.fromTo(dieRef.current,
        { opacity: 0, y: -90, scale: 0.5, rotation: -220 },
        { opacity: 1, y: 0, scale: 1, rotation: 0, duration: 0.65, ease: 'power2.out' })
    } else {
      // Quick throw before spin — die lifts slightly as if being picked up
      tl.to(dieRef.current, { y: -28, scale: 1.1, duration: 0.2, ease: 'power2.out' })
    }

    tl
      .to(dieRef.current, { rotation: '+=480', duration: 1.4, ease: 'none' })
      // 480 + 240 = 720° = 2 full rotations → always lands upright
      .to(dieRef.current, { rotation: '+=240', y: 0, scale: 1, duration: 1.1, ease: 'power3.out' })
      .to(dieRef.current, { scaleY: 0.78, scaleX: 1.2, y: 5, duration: 0.08 })
      .to(dieRef.current, { scaleY: 1.1, scaleX: 0.93, y: -8, duration: 0.13, ease: 'power2.out' })
      .to(dieRef.current, { scaleY: 1, scaleX: 1, y: 0, duration: 0.3, ease: 'elastic.out(1, 0.5)' })

    // ── Number cycling ──
    let seqIdx = 0
    const next = () => setDisplayNum(ROLL_SEQ[seqIdx++ % ROLL_SEQ.length])
    const startDelay = isReroll ? 180 : 700

    timers.push(setTimeout(() => {
      const iv = setInterval(next, 55)
      ivals.push(iv)
      timers.push(setTimeout(() => clearInterval(iv), 660))
    }, startDelay))

    timers.push(setTimeout(() => {
      const iv = setInterval(next, 120)
      ivals.push(iv)
      timers.push(setTimeout(() => clearInterval(iv), 840))
    }, startDelay + 660))

    timers.push(setTimeout(() => {
      const iv = setInterval(next, 250)
      ivals.push(iv)
      timers.push(setTimeout(() => clearInterval(iv), 750))
    }, startDelay + 660 + 840))

    // Land on 1 — timed with the GSAP squish
    const landAt = isReroll ? 2800 : 3000
    timers.push(setTimeout(() => {
      setDisplayNum(1)
      setRolling(false)
      setLanded(true)
    }, landAt))

    // Reveal content only on first roll
    if (!isReroll) {
      timers.push(setTimeout(() => {
        gsap.fromTo(fourRef.current,  { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.65, ease: 'power3.out' })
        gsap.fromTo(textRef.current,  { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out', delay: 0.18 })
        gsap.fromTo(linksRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', delay: 0.32 })
      }, 3750))
    }

    // Idle float after settling
    timers.push(setTimeout(() => {
      gsap.to(dieRef.current, { y: -16, repeat: -1, yoyo: true, duration: 2.6, ease: 'sine.inOut' })
      gsap.to(dieRef.current, { rotation: '+=7', repeat: -1, yoyo: true, duration: 4.8, ease: 'sine.inOut' })
    }, landAt + (isReroll ? 600 : 1100)))

    return () => {
      timers.forEach(clearTimeout)
      ivals.forEach(clearInterval)
      tl.kill()
      gsap.killTweensOf(dieRef.current)
      gsap.killTweensOf(fourRef.current)
      gsap.killTweensOf(textRef.current)
      gsap.killTweensOf(linksRef.current)
    }
  }, [rollKey])

  function handleDieClick() {
    if (!landed) return
    setRollKey(k => k + 1)
  }

  return (
    <>
      <style>{`
        @keyframes critFlash {
          0%   { filter: drop-shadow(0 0 32px rgba(228,51,41,0.95)) brightness(2); }
          35%  { filter: drop-shadow(0 0 22px rgba(228,51,41,0.7))  brightness(1.4); }
          100% { filter: drop-shadow(0 0  0px rgba(228,51,41,0))    brightness(1); }
        }
        .crit-flash { animation: critFlash 1.6s ease-out forwards; }
      `}</style>

      <Navbar />
      <main style={{
        minHeight: '100vh',
        backgroundColor: 'var(--black)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8rem 2rem 4rem',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>

        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px', height: '600px',
          background: 'radial-gradient(circle, rgba(0,160,152,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* The D20 — clickable after landing */}
        <div
          ref={dieRef}
          className={landed ? 'crit-flash' : ''}
          onClick={handleDieClick}
          onMouseEnter={() => setHoverDie(true)}
          onMouseLeave={() => setHoverDie(false)}
          title={landed ? 'Roll again' : undefined}
          style={{
            opacity: 0,
            marginBottom: '2.5rem',
            position: 'relative',
            zIndex: 1,
            cursor: landed ? 'pointer' : 'default',
            transform: landed && hoverDie ? 'scale(1.06)' : undefined,
            transition: 'transform 0.2s ease',
          }}
        >
          <D20 num={displayNum} rolling={rolling} />
          {landed && hoverDie && (
            <div style={{
              position: 'absolute',
              bottom: '-1.6rem',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '0.62rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'rgba(0,160,152,0.6)',
              fontFamily: 'var(--font-inter)',
              whiteSpace: 'nowrap',
            }}>Roll again</div>
          )}
        </div>

        {/* 404 */}
        <div ref={fourRef} style={{ opacity: 0, position: 'relative', zIndex: 1 }}>
          <h1 style={{
            fontFamily: 'var(--font-cinzel)',
            fontSize: 'clamp(5rem, 18vw, 10rem)',
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, var(--teal) 0%, rgba(0,160,152,0.4) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: '0.2rem',
            userSelect: 'none',
          }}>404</h1>
          <p style={{
            fontFamily: 'var(--font-cinzel)',
            fontSize: 'clamp(1rem, 3vw, 1.45rem)',
            color: 'rgba(245,242,236,0.55)',
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
          }}>Critical Miss</p>
        </div>

        {/* Copy */}
        <div ref={textRef} style={{ opacity: 0, maxWidth: '480px', margin: '2rem auto', zIndex: 1, position: 'relative' }}>
          <p style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '1rem',
            color: 'rgba(245,242,236,0.5)',
            lineHeight: 1.75,
          }}>
            You rolled a <span style={{ color: 'var(--teal)', fontWeight: 600 }}>1</span> on your perception check.<br />
            This page doesn&apos;t exist, or has been moved somewhere else.
          </p>
        </div>

        {/* Links */}
        <div ref={linksRef} style={{
          opacity: 0,
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
          zIndex: 1,
          position: 'relative',
        }}>
          <Link href="/"
            onMouseEnter={() => setHoverHome(true)}
            onMouseLeave={() => setHoverHome(false)}
            style={{
              backgroundColor: hoverHome ? 'rgba(0,160,152,0.15)' : 'var(--teal)',
              color: '#fff',
              padding: '0.8rem 2rem',
              borderRadius: '2px',
              fontSize: '0.78rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              border: '1px solid var(--teal)',
              transition: 'all 0.25s ease',
              boxShadow: hoverHome ? '0 0 20px rgba(0,160,152,0.4)' : 'none',
            }}
          >Return to Base Camp</Link>

          <Link href="/shop"
            onMouseEnter={() => setHoverShop(true)}
            onMouseLeave={() => setHoverShop(false)}
            style={{
              backgroundColor: 'transparent',
              color: hoverShop ? 'var(--offwhite)' : 'rgba(245,242,236,0.55)',
              padding: '0.8rem 2rem',
              borderRadius: '2px',
              fontSize: '0.78rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              border: `1px solid ${hoverShop ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)'}`,
              transition: 'all 0.25s ease',
            }}
          >Browse the Shop</Link>
        </div>

        <p style={{
          position: 'absolute', bottom: '2rem',
          fontFamily: 'var(--font-inter)',
          fontSize: '0.68rem',
          color: 'rgba(245,242,236,0.15)',
          letterSpacing: '0.1em',
          userSelect: 'none',
        }}>Error 404 · Page Not Found</p>
      </main>
      <Footer />
    </>
  )
}
