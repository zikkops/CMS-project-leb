'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useParams } from 'next/navigation'
import Navbar from '../../components/layout/Navbar'
import Footer from '../../components/layout/Footer'
import Skeleton from '../../components/Skeleton'
import Link from 'next/link'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { totalStock } from '@big-cms/shared/branches'
import { BRAND } from '@big-cms/shared/brand'
import { PLACEHOLDER } from '@big-cms/shared/placeholderAssets'

// The board-product-era players/duration/age fields are still written by Manage
// Products but are no longer surfaced here, so they're left off the interface.
interface Product {
  id: string
  name: string
  category: string
  description: string
  price: number
  stock: Record<string, number>
  image: string
  sku?: string
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

function BackToShopLink({ withIcon }: { withIcon?: boolean }) {
  const [hovered, setHovered] = useState(false)
  return (
    <Link href="/shop"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        color: hovered ? 'var(--teal)' : (withIcon ? 'rgba(245,242,236,0.4)' : 'var(--teal)'),
        textDecoration: 'none',
        fontFamily: 'var(--font-inter)',
        fontSize: withIcon ? '0.78rem' : '0.85rem',
        letterSpacing: withIcon ? '0.1em' : undefined,
        textTransform: withIcon ? 'uppercase' : undefined,
        marginBottom: withIcon ? '3rem' : undefined,
        transform: hovered ? 'translateX(-4px)' : 'none',
        transition: 'all 0.2s ease',
      }}>
      {withIcon && <FontAwesomeIcon icon={faArrowLeft} style={{ width: '12px' }} />}
      {withIcon ? 'Back to Shop' : '← Back to Shop'}
    </Link>
  )
}

// WhatsApp is optional — BRAND.contact.whatsapp defaults to empty, and a
// tenant that hasn't set one must not get a link to somebody else's number.
// Email always has a value, so it's the fallback rather than hiding the only
// way to actually buy the thing.
function EnquiryCta() {
  const [hovered, setHovered] = useState(false)
  const wa = BRAND.contact.whatsapp
  const href = wa ? `https://wa.me/${wa}` : `mailto:${BRAND.contact.email}`
  const label = wa ? 'Enquire via WhatsApp' : 'Enquire by Email'
  return (
    <a
      href={href}
      target={wa ? '_blank' : undefined}
      rel={wa ? 'noopener noreferrer' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'block',
        width: '100%',
        textAlign: 'center',
        backgroundColor: hovered ? 'rgba(106,106,183,0.15)' : 'var(--purple)',
        color: '#fff',
        padding: '1rem',
        border: '1px solid var(--purple)',
        borderRadius: '2px',
        fontSize: '0.82rem',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        fontFamily: 'var(--font-inter)',
        backdropFilter: hovered ? 'blur(10px)' : 'none',
        transition: 'all 0.3s ease',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 0,
        left: hovered ? '120%' : '-60%',
        width: '40%',
        height: '100%',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
        transform: 'skewX(-20deg)',
        transition: 'left 0.5s ease',
        pointerEvents: 'none',
      }} />
      {label}
    </a>
  )
}

export default function ProductPage() {
  const { id }                  = useParams()
  const isMobile                = useIsMobile()
  const [product, setProduct]         = useState<Product | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'products', id as string))
      if (!snap.exists()) {
        setNotFound(true)
      } else {
        setProduct({ id: snap.id, ...snap.data() } as Product)
      }
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return (
    <>
      <Navbar />
      <main style={{ backgroundColor: 'var(--black)', minHeight: '100vh' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '7rem 1.25rem 3rem' : '9rem 3rem 6rem' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: isMobile ? '2rem' : '5rem',
            alignItems: 'start',
          }}>
            <Skeleton height={isMobile ? '260px' : '400px'} borderRadius="8px" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <Skeleton width="30%" height="0.8rem" />
              <Skeleton width="60%" height={isMobile ? '1.75rem' : '2.5rem'} />
              <Skeleton width="90%" height="1rem" />
              <Skeleton width="80%" height="1rem" />
              <Skeleton height="3.5rem" style={{ marginTop: '1rem' }} />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )

  if (notFound || !product) return (
    <>
      <Navbar />
      <div style={{
        minHeight: '100vh',
        backgroundColor: 'var(--black)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
      }}>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', color: 'var(--offwhite)', fontSize: '2rem' }}>
          Product Not Found
        </h1>
        <BackToShopLink />
      </div>
      <Footer />
    </>
  )

  const stock      = totalStock(product.stock)
  const outOfStock = stock === 0

  return (
    <>
      <Navbar />
      <main style={{ backgroundColor: 'var(--black)', minHeight: '100vh' }}>

        {/* Back button */}
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '7rem 1.25rem 0' : '9rem 3rem 0' }}>
          <BackToShopLink withIcon />
        </div>

        {/* Product Detail */}
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '0 1.25rem 3rem' : '0 3rem 6rem' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: isMobile ? '2rem' : '5rem',
            alignItems: 'start',
          }}>

            {/* Left — Image */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: isMobile ? '1.25rem' : '2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {outOfStock && (
                <div style={{
                  position: 'absolute',
                  top: '1.2rem',
                  left: '1.2rem',
                  backgroundColor: 'rgba(228,51,41,0.9)',
                  color: '#fff',
                  padding: '0.4rem 1rem',
                  borderRadius: '2px',
                  fontSize: '0.72rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-inter)',
                  zIndex: 1,
                }}>Out of Stock</div>
              )}
              <img
                src={product.image || PLACEHOLDER.product}
                alt={product.name}
                style={{
                  width: '100%',
                  height: isMobile ? '260px' : '400px',
                  objectFit: 'contain',
                  filter: outOfStock ? 'grayscale(60%)' : 'none',
                }}
              />
            </div>

            {/* Right — Info */}
            <div>

              {/* Category */}
              <p style={{
                fontSize: '0.68rem',
                letterSpacing: '0.25em',
                textTransform: 'uppercase',
                color: 'var(--purple)',
                fontFamily: 'var(--font-inter)',
                marginBottom: '0.8rem',
              }}>{product.category}</p>

              {/* Name */}
              <h1 style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: isMobile ? '1.75rem' : '2.5rem',
                color: 'var(--offwhite)',
                lineHeight: 1.2,
                marginBottom: '1.5rem',
              }}>{product.name}</h1>

              {/* SKU — issued once on create and never rewritten, so it's the
                  one stable public identifier a customer can quote back. */}
              {product.sku && (
                <p style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.7rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'rgba(245,242,236,0.3)',
                  marginBottom: '1.2rem',
                }}>{product.sku}</p>
              )}

              {/* Divider */}
              <div style={{
                width: '60px', height: '2px',
                backgroundColor: 'var(--purple)',
                marginBottom: '2rem',
              }} />

              {/* Description */}
              <p style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.95rem',
                color: 'rgba(245,242,236,0.6)',
                lineHeight: 1.8,
                marginBottom: '2rem',
              }}>{product.description}</p>

              {/* Price */}
              {product.price > 0 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.8rem',
                  marginBottom: '2rem',
                  padding: isMobile ? '1rem 1.2rem' : '1.2rem 1.5rem',
                  background: 'rgba(106,106,183,0.08)',
                  border: '1px solid rgba(106,106,183,0.2)',
                  borderRadius: '4px',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-cinzel)',
                    fontSize: '2rem',
                    color: 'var(--purple)',
                  }}>${product.price}</span>
                  <span style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: 'rgba(245,242,236,0.3)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}>per unit</span>
                </div>
              )}

              {/* This was a 3-up spec grid for Players / Duration / Min Age.
                  Those are board-product attributes, and a generic catalogue has
                  no equivalent trio — the honest generic facts are the SKU
                  (rendered under the name) and the category (the eyebrow above
                  it), both of which already have a home. Rather than invent
                  filler to keep a three-column grid, the grid is gone. */}

              {/* Stock */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                marginBottom: '2rem',
                padding: '1rem 1.2rem',
                background: outOfStock ? 'rgba(228,51,41,0.08)' : 'rgba(0,160,152,0.08)',
                border: `1px solid ${outOfStock ? 'rgba(228,51,41,0.2)' : 'rgba(0,160,152,0.2)'}`,
                borderRadius: '4px',
              }}>
                <div style={{
                  width: '8px', height: '8px',
                  borderRadius: '50%',
                  backgroundColor: outOfStock ? 'var(--red)' : 'var(--teal)',
                  flexShrink: 0,
                }} />
                <p style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.82rem',
                  color: outOfStock ? 'var(--red)' : 'var(--teal)',
                }}>
                  {outOfStock
                    ? 'Currently out of stock'
                    : `${stock} available in store`}
                </p>
              </div>

              {/* CTA */}
              {outOfStock ? (
                <button disabled style={{
                  width: '100%',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  color: 'rgba(245,242,236,0.25)',
                  padding: '1rem',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '2px',
                  fontSize: '0.82rem',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  cursor: 'not-allowed',
                  fontFamily: 'var(--font-inter)',
                }}>Out of Stock</button>
              ) : (
                <EnquiryCta />
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}