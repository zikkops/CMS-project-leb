'use client'

// The customer site's 404.
//
// Deliberately generic. This was a rolling D20 that landed on 1 — "Critical
// Miss, you rolled a 1 on your perception check, Return to Base Camp" — pure
// Dungeons & Dragons in a product whose D&D modules were removed entirely, and
// it outlived every grep for "D&D" because nothing in it says D&D. The first
// replacement said "Not on the menu" and linked to the menu, which was still a
// theme, and still assumed a feature every tenant might not have switched on.
//
// So: no pun, no feature, one way home. A tenant who wants personality here
// can add it knowing what they are choosing; the default should not choose
// for them. The die is in git history.

import { useState } from 'react'
import Link from 'next/link'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'

export default function NotFound() {
  const [hoverHome, setHoverHome] = useState(false)

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
      }}>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: 'clamp(5rem, 18vw, 10rem)',
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: 'var(--teal)',
          marginBottom: '0.5rem',
          userSelect: 'none',
        }}>404</h1>

        <p style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: 'clamp(1rem, 3vw, 1.45rem)',
          color: 'rgba(var(--offwhite-rgb),0.7)',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
        }}>Page not found</p>

        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '1rem',
          color: 'rgba(var(--offwhite-rgb),0.5)',
          lineHeight: 1.75,
          maxWidth: '480px',
          margin: '1.5rem auto 2rem',
        }}>
          The page you were looking for doesn&apos;t exist or has moved.
        </p>

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
          }}
        >Back to the home page</Link>
      </main>
      <Footer />
    </>
  )
}
