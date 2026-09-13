'use client'

// The customer site's 404.
//
// This was a rolling D20 that landed on 1: "Critical Miss — you rolled a 1 on
// your perception check — Return to Base Camp". Lovingly built, and pure
// Dungeons & Dragons, surviving on every mistyped URL in a product whose D&D
// modules were removed entirely. It outlived every grep for "D&D" because
// nothing in it says D&D; it just is one. The animation is in git history if a
// games café ever wants it back — that is a brand decision, not a default.

import { useState } from 'react'
import Link from 'next/link'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'

export default function NotFound() {
  const [hoverHome, setHoverHome] = useState(false)
  const [hoverMenu, setHoverMenu] = useState(false)

  return (
    <>
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
          background: 'radial-gradient(circle, rgba(var(--teal-rgb),0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <h1 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: 'clamp(5rem, 18vw, 10rem)',
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, var(--teal) 0%, rgba(var(--teal-rgb),0.4) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          marginBottom: '0.2rem',
          userSelect: 'none',
          position: 'relative',
        }}>404</h1>

        <p style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: 'clamp(1rem, 3vw, 1.45rem)',
          color: 'rgba(var(--offwhite-rgb),0.55)',
          letterSpacing: '0.35em',
          textTransform: 'uppercase',
          position: 'relative',
        }}>Not on the menu</p>

        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '1rem',
          color: 'rgba(var(--offwhite-rgb),0.5)',
          lineHeight: 1.75,
          maxWidth: '480px',
          margin: '2rem auto',
          position: 'relative',
        }}>
          This page doesn&apos;t exist, or has been moved somewhere else.
        </p>

        <div style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
          position: 'relative',
        }}>
          <Link href="/"
            onMouseEnter={() => setHoverHome(true)}
            onMouseLeave={() => setHoverHome(false)}
            style={{
              backgroundColor: hoverHome ? 'rgba(var(--teal-rgb),0.15)' : 'var(--teal)',
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
              boxShadow: hoverHome ? '0 0 20px rgba(var(--teal-rgb),0.4)' : 'none',
            }}
          >Back to the home page</Link>

          <Link href="/menu"
            onMouseEnter={() => setHoverMenu(true)}
            onMouseLeave={() => setHoverMenu(false)}
            style={{
              backgroundColor: 'transparent',
              color: hoverMenu ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.55)',
              padding: '0.8rem 2rem',
              borderRadius: '2px',
              fontSize: '0.78rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              border: `1px solid ${hoverMenu ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)'}`,
              transition: 'all 0.25s ease',
            }}
          >See the menu</Link>
        </div>

        <p style={{
          position: 'absolute', bottom: '2rem',
          fontFamily: 'var(--font-inter)',
          fontSize: '0.68rem',
          color: 'rgba(var(--offwhite-rgb),0.15)',
          letterSpacing: '0.1em',
          userSelect: 'none',
        }}>Error 404 · Page Not Found</p>
      </main>
      <Footer />
    </>
  )
}
