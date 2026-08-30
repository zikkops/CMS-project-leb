'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { BRAND } from '@big-cms/shared/brand'
import { PLACEHOLDER } from '@big-cms/shared/placeholderAssets'

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

function AnimatedNumber({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          const duration = 1500
          const steps = 60
          const increment = target / steps
          let current = 0
          const timer = setInterval(() => {
            current += increment
            if (current >= target) {
              setCount(target)
              clearInterval(timer)
            } else {
              setCount(Math.floor(current))
            }
          }, duration / steps)
        }
      },
      { threshold: 0.3 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [target])

  return (
    <div ref={ref} style={{
      fontFamily: 'var(--font-cinzel)',
      fontSize: '2.5rem',
      color: 'var(--offwhite)',
      minWidth: '80px',
      textAlign: 'center',
    }}>
      {count}{suffix}
    </div>
  )
}

function InfinityNumber() {
  const [display, setDisplay] = useState('0')
  const ref = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          const duration = 1500
          const steps = 60
          let current = 0
          const timer = setInterval(() => {
            current += 1
            setDisplay(String(current * 17))
            if (current >= steps) {
              clearInterval(timer)
              setDisplay('∞')
            }
          }, duration / steps)
        }
      },
      { threshold: 0.3 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} style={{
      fontFamily: 'var(--font-cinzel)',
      fontSize: '2.5rem',
      color: 'var(--offwhite)',
      minWidth: '80px',
      textAlign: 'center',
    }}>
      {display}
    </div>
  )
}

export default function About() {
  const isMobile = useIsMobile()
  const [storyHovered, setStoryHovered] = useState(false)

  return (
    <section id="about" style={{
      maxWidth: '1200px',
      margin: '0 auto',
      padding: isMobile ? '4rem 1.25rem' : '6rem 3rem',
    }}>

      {/* Top grid — image + text */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: isMobile ? '2rem' : '5rem',
        alignItems: 'center',
        marginBottom: '4rem',
      }}>

        {/* Image */}
        <div style={{
          position: 'relative',
          height: isMobile ? '240px' : '450px',
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

        {/* Text */}
        <div>
          <p style={{
            fontSize: '0.7rem',
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            marginBottom: '1rem',
            fontFamily: 'var(--font-inter)',
          }}>
            Who We Are
          </p>

          <h2 style={{
            fontFamily: 'var(--font-cinzel)',
            fontSize: isMobile ? '1.75rem' : '2.5rem',
            color: 'var(--offwhite)',
            lineHeight: 1.2,
            marginBottom: '1.5rem',
          }}>
            More than a café.<br />A place to play.
          </h2>

          <div style={{
            width: '60px', height: '2px',
            backgroundColor: 'var(--teal)',
            marginBottom: '2rem',
          }} />

          <p style={{
            color: 'rgba(245,242,236,0.55)',
            lineHeight: 1.9,
            marginBottom: '2.5rem',
            fontFamily: 'var(--font-inter)',
            fontSize: isMobile ? '0.88rem' : '1rem',
          }}>
            {/* Placeholder copy. The original told a specific café's founding
                story — that belongs to them, not to the product. Real body copy
                is tenant content and should come from the CMS, not a component. */}
            {`${BRAND.name} is a placeholder business used to demonstrate this
            platform. Replace this copy, the name and the imagery in your brand
            settings. ${BRAND.branches.length} locations, one community.`}
          </p>

          <Link href="/about"
            onMouseEnter={() => setStoryHovered(true)}
            onMouseLeave={() => setStoryHovered(false)}
            style={{
              position: 'relative',
              overflow: 'hidden',
              display: 'inline-block',
              backgroundColor: storyHovered ? 'rgba(0,160,152,0.15)' : 'var(--teal)',
              color: '#fff',
              padding: '0.85rem 2.5rem',
              borderRadius: '2px',
              fontSize: '0.78rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              border: '1px solid var(--teal)',
              backdropFilter: storyHovered ? 'blur(10px)' : 'none',
              transition: 'all 0.3s ease',
            }}>
            <span style={{
              position: 'absolute',
              top: 0,
              left: storyHovered ? '120%' : '-60%',
              width: '40%',
              height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
              transform: 'skewX(-20deg)',
              transition: 'left 0.5s ease',
              pointerEvents: 'none',
            }} />
            Our Story
          </Link>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
        gap: '1px',
        backgroundColor: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        {[
          { el: <AnimatedNumber target={500} suffix="+" />, label: 'Products in Stock' },
          { el: <AnimatedNumber target={3} />, label: 'Branches' },
          { el: <InfinityNumber />, label: 'Good Times' },
        ].map(({ el, label }, i) => (
          <div key={i} style={{
            padding: isMobile ? '1.75rem 1.5rem' : '2.5rem 2rem',
            textAlign: 'center',
            backgroundColor: 'var(--black)',
          }}>
            {el}
            <div style={{
              fontSize: '0.68rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.4)',
              marginTop: '0.5rem',
              fontFamily: 'var(--font-inter)',
            }}>{label}</div>
          </div>
        ))}
      </div>

    </section>
  )
}