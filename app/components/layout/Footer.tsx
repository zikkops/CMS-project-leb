'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faInstagram, faFacebook, faWhatsapp } from '@fortawesome/free-brands-svg-icons'
import { BRAND } from '../../lib/brand'

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

function FooterLink({ label, href }: { label: string; href: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <a href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontSize: '0.82rem',
        color: hovered ? 'var(--teal)' : 'rgba(245,242,236,0.5)',
        textDecoration: 'none',
        fontFamily: 'var(--font-inter)',
        transition: 'color 0.2s ease',
      }}>{label}</a>
  )
}

export default function Footer() {
  const isMobile = useIsMobile()
  const [hoveredSocial, setHoveredSocial] = useState<number | null>(null)

  return (
    <footer style={{
      backgroundColor: '#060606',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      padding: isMobile ? '3rem 1.25rem 1.5rem' : '4rem 3rem 2rem',
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
      }}>

        {/* Top grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr 1fr',
          gap: isMobile ? '2rem' : '3rem',
          marginBottom: isMobile ? '2.5rem' : '3rem',
        }}>

          {/* Brand */}
          <div>
            <Image
              src={BRAND.logoUrl}
              alt={BRAND.name}
              width={120}
              height={80}
              style={{ marginBottom: '1rem' }}
            />
            <p style={{
              fontSize: '0.82rem',
              color: 'rgba(245,242,236,0.35)',
              lineHeight: 1.7,
              maxWidth: isMobile ? '100%' : '240px',
              fontFamily: 'var(--font-inter)',
            }}>
              Lebanon's favourite board game café and restaurant. Where every table tells a story.
            </p>
          </div>

          {/* Explore */}
          <div>
            <p style={{
              fontSize: '0.68rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.25)',
              marginBottom: '1.2rem',
              fontFamily: 'var(--font-inter)',
            }}>Explore</p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {[
                { label: 'Shop',         href: '/shop' },
                { label: 'Menu',         href: '/menu' },
                { label: 'Events',       href: '#events' },
                { label: 'Loyalty',      href: '/loyalty' },
              ].map(({ label, href }) => (
                <li key={label}>
                  <FooterLink label={label} href={href} />
                </li>
              ))}
            </ul>
          </div>

          {/* Branches */}
          <div>
            <p style={{
              fontSize: '0.68rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.25)',
              marginBottom: '1.2rem',
              fontFamily: 'var(--font-inter)',
            }}>Branches</p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              {/* Generated from BRAND.branches. Previously three real branches with
                  three real phone and WhatsApp numbers — a demo must not hand a
                  visitor a working line to somebody's actual café. */}
              {BRAND.branches.map(city => ({
                city,
                hours: '9:00 AM – 11:00 PM',
                whatsapp: BRAND.contact.whatsapp,
                phone: BRAND.contact.phone,
              })).map(({ city, hours, whatsapp, phone }) => (
                <li key={city}>
                  <a href="/#branches-section" style={{ textDecoration: 'none', display: 'block' }}>
                    <span style={{
                      display: 'block',
                      fontSize: '0.82rem',
                      color: 'rgba(245,242,236,0.5)',
                      fontFamily: 'var(--font-inter)',
                      marginBottom: '0.15rem',
                    }}>{city}</span>
                    <span style={{
                      display: 'block',
                      fontSize: '0.7rem',
                      color: 'rgba(245,242,236,0.25)',
                      fontFamily: 'var(--font-inter)',
                    }}>{hours}</span>
                  </a>
                  <a
                    href={`https://wa.me/${whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      marginTop: '0.3rem',
                      fontSize: '0.68rem',
                      color: 'rgba(245,242,236,0.2)',
                      fontFamily: 'var(--font-inter)',
                      textDecoration: 'none',
                    }}
                  >{phone}</a>
                </li>
              ))}
            </ul>
          </div>

          {/* Connect */}
          <div>
            <p style={{
              fontSize: '0.68rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.25)',
              marginBottom: '1.2rem',
              fontFamily: 'var(--font-inter)',
            }}>Connect</p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              {/* Only renders the accounts that are actually configured — an
                  empty NEXT_PUBLIC_SOCIAL_* means no icon, rather than a dead
                  link or somebody else's Instagram. */}
              {[
                { icon: faInstagram, href: BRAND.social.instagram },
                { icon: faFacebook,  href: BRAND.social.facebook },
                { icon: faWhatsapp,  href: BRAND.contact.whatsapp ? `https://wa.me/${BRAND.contact.whatsapp}` : '' },
              ].filter(s => s.href).map(({ icon, href }, i) => {
                const hovered = hoveredSocial === i
                return (
                  <a key={i} href={href}
                    onMouseEnter={() => setHoveredSocial(i)}
                    onMouseLeave={() => setHoveredSocial(null)}
                    style={{
                      width: '36px',
                      height: '36px',
                      border: `1px solid ${hovered ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
                      backgroundColor: hovered ? 'rgba(0,160,152,0.12)' : 'transparent',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: hovered ? 'var(--teal)' : 'rgba(245,242,236,0.4)',
                      transform: hovered ? 'translateY(-3px)' : 'none',
                      transition: 'all 0.25s ease',
                    }}>
                    <FontAwesomeIcon icon={icon} style={{ width: '16px' }} />
                  </a>
                )
              })}
            </div>
          </div>

        </div>

        {/* Bottom */}
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: isMobile ? '1.25rem' : '1.5rem',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'flex-start' : 'center',
          gap: isMobile ? '0.5rem' : 0,
        }}>
          <p style={{
            fontSize: isMobile ? '0.7rem' : '0.74rem',
            color: 'rgba(245,242,236,0.2)',
            fontFamily: 'var(--font-inter)',
          }}>
            {`© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.`}
          </p>
          <p style={{
            fontSize: isMobile ? '0.7rem' : '0.74rem',
            color: 'rgba(245,242,236,0.2)',
            fontFamily: 'var(--font-inter)',
          }}>
            Developed by Mark Zakkak
          </p>
        </div>

      </div>
    </footer>
  )
}