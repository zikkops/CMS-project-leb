'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import Skeleton from '../Skeleton'

interface Category {
  id: string
  name: string
  section: string
  image?: string
  order: number
}

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

export default function MenuPreview() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading]       = useState(true)
  const [hoveredId, setHoveredId]   = useState<string | null>(null)
  const [menuHovered, setMenuHovered] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    async function load() {
      const snap = await getDocs(collection(db, 'menuCategories'))
      const cats = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Category))
        .sort((a, b) => a.order - b.order)
      setCategories(cats)
      setLoading(false)
    }
    load()
  }, [])

  // Pick 4 food, 3 beverage, 2 sweets
  const food     = categories.filter(c => c.section === 'Food').slice(0, 4)
  const beverage = categories.filter(c => c.section === 'Beverage').slice(0, 3)
  const sweets   = categories.filter(c => c.section === 'Sweets').slice(0, 2)
  const display  = [...food, ...beverage, ...sweets]

  return (
    <section style={{
      backgroundColor: 'rgba(255,255,255,0.015)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      padding: isMobile ? '4rem 1.25rem' : '6rem 3rem',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Header */}
        <p style={{
          fontSize: '0.7rem',
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: '1rem',
          fontFamily: 'var(--font-inter)',
        }}>Food & Drinks</p>

        <h2 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: isMobile ? '1.75rem' : '2.8rem',
          color: 'var(--offwhite)',
          lineHeight: 1.2,
          marginBottom: '1.5rem',
        }}>
          Fuel for<br />the Game
        </h2>

        <div style={{
          width: '60px', height: '2px',
          backgroundColor: 'var(--teal)',
          marginBottom: isMobile ? '2rem' : '3rem',
        }} />

        {loading ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
            gap: isMobile ? '0.75rem' : '1rem',
          }}>
            {(isMobile ? [0, 1, 2, 3] : [0, 1, 2, 3, 4]).map(i => (
              <Skeleton key={i} height={isMobile ? '140px' : '180px'} />
            ))}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
            gap: isMobile ? '0.75rem' : '1rem',
          }}>
            {/* Category Cards */}
            {display.map(({ id, name, image, section }) => {
              const color = section === 'Food'
                ? 'var(--teal)'
                : section === 'Beverage'
                ? 'var(--purple)'
                : 'var(--red)'

              const hovered = hoveredId === id
              return (
                <Link key={id} href="/menu"
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    position: 'relative',
                    height: isMobile ? '140px' : '180px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    textDecoration: 'none',
                    display: 'block',
                    border: `1px solid ${hovered ? color : 'rgba(255,255,255,0.06)'}`,
                    transform: hovered ? 'translateY(-4px)' : 'none',
                    boxShadow: hovered ? '0 12px 24px rgba(0,0,0,0.35)' : 'none',
                    transition: 'transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
                  }}>
                  {/* Background image or color */}
                  {image ? (
                    <Image
                      src={image}
                      alt={name}
                      fill
                      sizes="(max-width: 768px) 45vw, 20vw"
                      style={{
                        objectFit: 'cover',
                        transform: hovered ? 'scale(1.08)' : 'scale(1)',
                        transition: 'transform 0.35s ease',
                      }}
                    />
                  ) : (
                    <div style={{
                      position: 'absolute', inset: 0,
                      backgroundColor: 'rgba(255,255,255,0.03)',
                    }} />
                  )}

                  {/* Overlay */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 100%)',
                  }} />

                  {/* Section dot */}
                  <div style={{
                    position: 'absolute',
                    top: '0.7rem',
                    right: '0.7rem',
                    width: hovered ? '8px' : '6px',
                    height: hovered ? '8px' : '6px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    transition: 'all 0.3s ease',
                  }} />

                  {/* Label */}
                  <div style={{
                    position: 'absolute',
                    bottom: '1rem',
                    left: '1rem',
                    right: '1rem',
                  }}>
                    <p style={{
                      fontFamily: 'var(--font-cinzel)',
                      fontSize: isMobile ? '0.75rem' : '0.85rem',
                      color: '#fff',
                      letterSpacing: '0.05em',
                    }}>{name}</p>
                    <p style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: isMobile ? '0.6rem' : '0.65rem',
                      color: color,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      marginTop: '0.2rem',
                    }}>{section}</p>
                  </div>
                </Link>
              )
            })}

            {/* Last card — Go to Menu */}
            <Link href="/menu"
              onMouseEnter={() => setMenuHovered(true)}
              onMouseLeave={() => setMenuHovered(false)}
              style={{
                position: 'relative',
                height: isMobile ? '140px' : '180px',
                borderRadius: '4px',
                overflow: 'hidden',
                textDecoration: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.8rem',
                border: `1px solid ${menuHovered ? 'rgba(0,160,152,0.6)' : 'rgba(0,160,152,0.25)'}`,
                background: menuHovered ? 'rgba(0,160,152,0.12)' : 'rgba(0,160,152,0.05)',
                transform: menuHovered ? 'translateY(-4px)' : 'none',
                boxShadow: menuHovered ? '0 12px 24px rgba(0,160,152,0.2)' : 'none',
                transition: 'all 0.3s ease',
              }}>
              <div style={{
                width: isMobile ? '36px' : '44px',
                height: isMobile ? '36px' : '44px',
                borderRadius: '50%',
                border: `1px solid ${menuHovered ? 'var(--teal)' : 'rgba(0,160,152,0.4)'}`,
                backgroundColor: menuHovered ? 'var(--teal)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: menuHovered ? '#fff' : 'var(--teal)',
                fontSize: isMobile ? '1rem' : '1.2rem',
                transform: menuHovered ? 'translateX(4px)' : 'none',
                transition: 'all 0.3s ease',
              }}>{'→'}</div>
              <p style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: isMobile ? '0.75rem' : '0.85rem',
                color: 'var(--offwhite)',
                textAlign: 'center',
                padding: '0 1rem',
              }}>View Full Menu</p>
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}