'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { collection, getDocs, limit, query } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import Skeleton from '../Skeleton'
import { totalStock } from '../../lib/branches'
import { PLACEHOLDER } from '../../lib/placeholderAssets'

interface Product {
  id: string
  name: string
  description: string
  stock: Record<string, number>
  price: number
  image: string
}

function truncate(text: string, words: number) {
  const arr = text.split(' ')
  return arr.length > words ? arr.slice(0, words).join(' ') + '…' : text
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

export default function ShopPreview() {
  const [products, setProducts]         = useState<Product[]>([])
  const [loading, setLoading]     = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [libraryHovered, setLibraryHovered] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    async function load() {
      const q    = query(collection(db, 'products'), limit(3))
      const snap = await getDocs(q)
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)))
      setLoading(false)
    }
    load()
  }, [])

  return (
    <section style={{ padding: isMobile ? '4rem 1.25rem' : '6rem 3rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        <p style={{
          fontSize: '0.7rem',
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: 'var(--purple)',
          marginBottom: '1rem',
          fontFamily: 'var(--font-inter)',
        }}>The Shop</p>

        <h2 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: isMobile ? '1.75rem' : '2.8rem',
          color: 'var(--offwhite)',
          lineHeight: 1.2,
          marginBottom: '1.5rem',
        }}>
          Take Something<br />Home With You
        </h2>

        <div style={{
          width: '60px', height: '2px',
          backgroundColor: 'var(--purple)',
          marginBottom: isMobile ? '2rem' : '3rem',
        }} />

        {loading ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: isMobile ? '0.75rem' : '1.5rem',
          }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                <Skeleton height={isMobile ? '120px' : '200px'} borderRadius="0" />
                <div style={{ padding: isMobile ? '0.8rem' : '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <Skeleton width="70%" height="1rem" />
                  <Skeleton width="45%" height="0.8rem" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: isMobile ? '0.75rem' : '1.5rem',
          }}>

            {/* Product Cards */}
            {products.map(({ id, name, description, stock: stockByBranch, price, image }) => {
              const stock      = totalStock(stockByBranch)
              const outOfStock = stock === 0
              const hovered    = hoveredId === id
              return (
                <Link key={id} href={`/shop/${id}`}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${hovered && !outOfStock ? 'rgba(106,106,183,0.4)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: '4px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    textDecoration: 'none',
                    cursor: 'pointer',
                    opacity: outOfStock ? 0.6 : 1,
                    transition: 'border-color 0.2s, opacity 0.2s',
                    position: 'relative',
                  }}>

                  {/* Out of stock banner */}
                  {outOfStock && (
                    <div style={{
                      position: 'absolute',
                      top: '1rem', left: 0, right: 0,
                      textAlign: 'center',
                      zIndex: 2,
                    }}>
                      <span style={{
                        backgroundColor: 'rgba(228,51,41,0.9)',
                        color: '#fff',
                        padding: '0.3rem 1rem',
                        fontSize: '0.65rem',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        fontFamily: 'var(--font-inter)',
                        borderRadius: '2px',
                      }}>Out of Stock</span>
                    </div>
                  )}

                  {/* Image with white bg and zoom */}
                  <div style={{
                    backgroundColor: '#fff',
                    padding: isMobile ? '0.6rem' : '1rem',
                    height: isMobile ? '120px' : '200px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}>
                    <img
                      src={image || PLACEHOLDER.product}
                      alt={name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        filter: outOfStock ? 'grayscale(60%)' : 'none',
                        transform: hovered && !outOfStock ? 'scale(1.08)' : 'scale(1)',
                        transition: 'transform 0.35s ease, filter 0.3s ease',
                      }}
                    />
                  </div>

                  {/* Content */}
                  <div style={{
                    padding: isMobile ? '0.8rem' : '1.2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    gap: '0.6rem',
                  }}>
                    <h3 style={{
                      fontFamily: 'var(--font-cinzel)',
                      fontSize: isMobile ? '0.85rem' : '1rem',
                      color: 'var(--offwhite)',
                    }}>{name}</h3>

                    {!isMobile && (
                      <p style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.78rem',
                        color: 'rgba(245,242,236,0.45)',
                        lineHeight: 1.6,
                      }}>{truncate(description, 10)}</p>
                    )}

                    {/* Price + Stock + Learn More */}
                    <div style={{
                      marginTop: 'auto',
                      paddingTop: '0.6rem',
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      alignItems: isMobile ? 'flex-start' : 'center',
                      justifyContent: 'space-between',
                      gap: isMobile ? '0.4rem' : 0,
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {price > 0 && (
                          <span style={{
                            fontFamily: 'var(--font-cinzel)',
                            fontSize: isMobile ? '1rem' : '1.2rem',
                            color: 'var(--purple)',
                          }}>${price}</span>
                        )}
                        <span style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: isMobile ? '0.6rem' : '0.68rem',
                          color: outOfStock ? 'var(--red)' : 'var(--teal)',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                        }}>
                          {outOfStock ? 'Out of stock' : `${stock} in stock`}
                        </span>
                      </div>
                      <span style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: isMobile ? '0.65rem' : '0.72rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: hovered && !outOfStock ? 'var(--purple)' : 'rgba(245,242,236,0.35)',
                        transition: 'color 0.2s',
                      }}>
                        Learn More →
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}

            {/* Last card — go to shop */}
            <Link href="/shop"
              onMouseEnter={() => setLibraryHovered(true)}
              onMouseLeave={() => setLibraryHovered(false)}
              style={{
                background: libraryHovered ? 'rgba(106,106,183,0.16)' : 'rgba(106,106,183,0.08)',
                border: `1px solid ${libraryHovered ? 'rgba(106,106,183,0.6)' : 'rgba(106,106,183,0.25)'}`,
                borderRadius: '4px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
                gap: isMobile ? '0.6rem' : '1rem',
                padding: isMobile ? '1.25rem' : '2rem',
                minHeight: isMobile ? '180px' : '360px',
                transform: libraryHovered ? 'translateY(-4px)' : 'none',
                boxShadow: libraryHovered ? '0 12px 24px rgba(106,106,183,0.2)' : 'none',
                transition: 'all 0.3s ease',
              }}>
              <div style={{
                width: isMobile ? '40px' : '60px',
                height: isMobile ? '40px' : '60px',
                borderRadius: '50%',
                border: `1px solid ${libraryHovered ? 'var(--purple)' : 'rgba(106,106,183,0.4)'}`,
                backgroundColor: libraryHovered ? 'var(--purple)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isMobile ? '1.1rem' : '1.5rem',
                color: libraryHovered ? '#fff' : 'var(--purple)',
                transform: libraryHovered ? 'translateX(4px)' : 'none',
                transition: 'all 0.3s ease',
              }}>{'→'}</div>
              <p style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: isMobile ? '0.85rem' : '1rem',
                color: 'var(--offwhite)',
                textAlign: 'center',
              }}>Browse the Full Range</p>
              {!isMobile && (
                <p style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  color: 'rgba(245,242,236,0.35)',
                  textAlign: 'center',
                  lineHeight: 1.6,
                }}>
                  The full catalogue, searchable by name, description or category
                </p>
              )}
            </Link>

          </div>
        )}
      </div>
    </section>
  )
}