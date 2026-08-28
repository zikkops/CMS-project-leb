'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { categoryImage } from '../lib/menuCategoryImages'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'
import { PLACEHOLDER } from '../lib/placeholderAssets'
import Skeleton from '../components/Skeleton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faList } from '@fortawesome/free-solid-svg-icons'

type Section = 'Food' | 'Beverage' | 'Sweets'

interface Category {
  id: string
  name: string
  section: Section
  image?: string
  order: number
}

interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  categoryId: string
  order: number
  badge?: string
  available: boolean
}

const SECTIONS: Section[] = ['Food', 'Beverage', 'Sweets']

const sectionColors: Record<Section, string> = {
  Food:     '#00A098',
  Beverage: '#6A6AB7',
  Sweets:   '#E43329',
}

const sectionBg: Record<Section, string> = {
  Food:     'rgba(0,160,152,0.06)',
  Beverage: 'rgba(106,106,183,0.06)',
  Sweets:   'rgba(228,51,41,0.06)',
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

export default function MenuPage() {
  const [categories, setCategories]               = useState<Category[]>([])
  const [items, setItems]                         = useState<MenuItem[]>([])
  const [loading, setLoading]                     = useState(true)
  const [activeCategory, setActiveCategory]       = useState<string>('')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
  Food:     true,
  Beverage: true,
  Sweets:   true,
  })
  const isMobile = useIsMobile()
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [categoriesTabHovered, setCategoriesTabHovered] = useState(false)
  const [hoveredSection, setHoveredSection] = useState<string | null>(null)


  function toggleSection(s: string) {
    setCollapsedSections(prev => ({ ...prev, [s]: !prev[s] }))
  }

  useEffect(() => {
    async function load() {
      const [catSnap, itemSnap] = await Promise.all([
        getDocs(collection(db, 'menuCategories')),
        getDocs(collection(db, 'menuItems')),
      ])

      const cats = catSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Category))
        .sort((a, b) => a.order - b.order)

      const its = itemSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as MenuItem))
        .filter(i => i.available)
        .sort((a, b) => a.order - b.order)

      setCategories(cats)
      setItems(its)

      const firstCat = cats.find(c => c.section === 'Food')
      if (firstCat) setActiveCategory(firstCat.id)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <>
      <Navbar />
      <main>

        {/* Hero */}
        <section style={{
          position: 'relative',
          height: isMobile ? '32vh' : '40vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url(${PLACEHOLDER.menuHero})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }} />
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)' }} />
          <div style={{ position: 'relative', zIndex: 1, paddingTop: '4rem' }}>
            <p style={{
              fontSize: '0.7rem',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: '1rem',
              fontFamily: 'var(--font-inter)',
            }}>Food & Drinks</p>
            <h1 style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: isMobile ? '2.2rem' : '3.5rem',
              color: 'var(--offwhite)',
              lineHeight: 1.2,
            }}>Our Menu</h1>
          </div>
        </section>

        {loading ? (
          <div style={{
            maxWidth: '1400px',
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '280px 1fr',
            gap: isMobile ? '1.5rem' : 0,
            padding: isMobile ? '1.5rem' : '3rem 0',
          }}>
            {!isMobile && (
              <div style={{ borderRight: '1px solid rgba(255,255,255,0.06)', padding: '3rem 0', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} width="80%" height="1.2rem" style={{ marginLeft: '1.5rem' }} />
                ))}
              </div>
            )}
            <div style={{ padding: isMobile ? '0' : '4rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.9rem 1.2rem', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px' }}>
                  <Skeleton width="50px" height="50px" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <Skeleton width="40%" height="1rem" />
                    <Skeleton width="70%" height="0.8rem" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{
            maxWidth: '1400px',
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '280px 1fr',
            minHeight: '80vh',
          }}>

            {/* Mobile categories tab — fixed, vertically centered on the left edge */}
            {isMobile && !categoriesOpen && (
              <button onClick={() => setCategoriesOpen(true)}
                onMouseEnter={() => setCategoriesTabHovered(true)}
                onMouseLeave={() => setCategoriesTabHovered(false)}
                style={{
                  position: 'fixed',
                  left: 0,
                  top: '50%',
                  transform: categoriesTabHovered ? 'translateY(-50%) translateX(3px)' : 'translateY(-50%)',
                  zIndex: 60,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: categoriesTabHovered ? 'rgba(0,160,152,0.85)' : 'var(--teal)',
                  border: 'none',
                  color: '#fff',
                  padding: '1rem 0.6rem',
                  borderRadius: '0 6px 6px 0',
                  fontSize: '0.65rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter)',
                  boxShadow: categoriesTabHovered ? '6px 0 16px rgba(0,0,0,0.5)' : '4px 0 12px rgba(0,0,0,0.4)',
                  transition: 'all 0.2s ease',
                }}>
                <FontAwesomeIcon icon={faList} style={{ width: '13px' }} />
                Categories
              </button>
            )}

            {/* Backdrop — closes the panel when tapped */}
            {isMobile && categoriesOpen && (
              <div onClick={() => setCategoriesOpen(false)} style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                zIndex: 59,
              }} />
            )}

            {/* LEFT SIDEBAR — desktop: sticky inline. Mobile: slides in from the left as an overlay */}
            <div style={isMobile ? {
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: '80%',
              maxWidth: '320px',
              backgroundColor: 'var(--black)',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '8px 0 24px rgba(0,0,0,0.6)',
              zIndex: 60,
              padding: '6rem 0 2rem',
              overflowY: 'auto',
              transform: categoriesOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform 0.3s ease',
            } : {
              borderRight: '1px solid rgba(255,255,255,0.06)',
              padding: '3rem 0',
              position: 'sticky',
              top: '64px',
              height: 'fit-content',
              maxHeight: 'calc(100vh - 64px)',
              overflowY: 'auto',
            }}>
              {SECTIONS.map(s => {
                const sectionCats = categories.filter(c => c.section === s)
                const isCollapsed = collapsedSections[s]

                return (
                  <div key={s} style={{ marginBottom: '0.5rem' }}>

                    {/* Section Header — collapsible */}
                    <button
                      onClick={() => toggleSection(s)}
                      onMouseEnter={() => setHoveredSection(s)}
                      onMouseLeave={() => setHoveredSection(null)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.9rem 1.5rem',
                        borderLeft: `3px solid ${sectionColors[s]}`,
                        marginBottom: isCollapsed ? '0.5rem' : '0.5rem',
                        background: hoveredSection === s ? `${sectionColors[s]}20` : sectionBg[s],
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'background 0.2s ease',
                      }}>
                      <p style={{
                        fontFamily: 'var(--font-cinzel)',
                        fontSize: '0.85rem',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: sectionColors[s],
                      }}>{s}</p>
                      <span style={{
                        color: sectionColors[s],
                        fontSize: '0.65rem',
                        display: 'block',
                        transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      }}>▼</span>
                    </button>

                    {/* Subcategories — collapsible */}
                    
                      <div style={{
                            maxHeight: isCollapsed ? '0' : '500px',
                            overflow: 'hidden',
                            transition: 'max-height 0.4s ease',
                            marginBottom: isCollapsed ? '0' : '1rem',
                          }}>
                        {sectionCats.length === 0 ? (
                          <p style={{
                            fontFamily: 'var(--font-inter)',
                            fontSize: '0.78rem',
                            color: 'rgba(245,242,236,0.2)',
                            padding: '0.5rem 1.5rem 0.5rem 2rem',
                          }}>No categories yet</p>
                        ) : sectionCats.map(cat => (
                          <button key={cat.id}
                            onClick={() => {
                              setActiveCategory(cat.id)
                              setCategoriesOpen(false)
                              const el = document.getElementById(`cat-${cat.id}`)
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            }}
                            onMouseEnter={e => {
                              if (activeCategory !== cat.id) {
                                const el = e.currentTarget as HTMLButtonElement
                                el.style.color = '#fff'
                                el.style.borderLeftColor = sectionColors[s]
                                const shine = el.querySelector('.shine') as HTMLElement
                                if (shine) shine.style.left = '120%'
                              }
                            }}
                            onMouseLeave={e => {
                              if (activeCategory !== cat.id) {
                                const el = e.currentTarget as HTMLButtonElement
                                el.style.color = 'rgba(245,242,236,0.45)'
                                el.style.borderLeftColor = 'transparent'
                                const shine = el.querySelector('.shine') as HTMLElement
                                if (shine) shine.style.left = '-60%'
                              }
                            }}
                            style={{
                              position: 'relative',
                              overflow: 'hidden',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.8rem',
                              width: '100%',
                              textAlign: 'left',
                              background: activeCategory === cat.id
                                ? `${sectionColors[s]}10`
                                : 'transparent',
                              border: 'none',
                              borderLeft: `2px solid ${activeCategory === cat.id ? sectionColors[s] : 'transparent'}`,
                              color: activeCategory === cat.id ? 'var(--offwhite)' : 'rgba(245,242,236,0.45)',
                              padding: '0.6rem 1rem 0.6rem 2rem',
                              fontSize: '0.82rem',
                              cursor: 'pointer',
                              fontFamily: 'var(--font-inter)',
                              borderRadius: '0 4px 4px 0',
                              transition: 'color 0.2s, border-color 0.2s',
                            }}>

                            {/* Shine effect */}
                            <span className="shine" style={{
                              position: 'absolute',
                              top: 0,
                              left: '-60%',
                              width: '40%',
                              height: '100%',
                              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
                              transform: 'skewX(-20deg)',
                              transition: 'left 0.4s ease',
                              pointerEvents: 'none',
                            }} />

                            {categoryImage(cat.name, cat.image) && (
                              <Image
                                src={categoryImage(cat.name, cat.image)}
                                alt={cat.name}
                                width={24}
                                height={24}
                                style={{
                                  width: '24px', height: '24px',
                                  borderRadius: '2px',
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                  opacity: activeCategory === cat.id ? 1 : 0.5,
                                  transition: 'opacity 0.2s',
                                }}
                              />
                            )}
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    
                  </div>
                )
              })}
            </div>

            {/* RIGHT — All Items */}
            <div style={{ padding: isMobile ? '1.5rem' : '4rem' }}>
              {categories.length === 0 ? (
                <p style={{ color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)' }}>
                  No categories yet.
                </p>
              ) : (
                SECTIONS.map(s => {
                  const sectionCats = categories.filter(c => c.section === s)
                  const hasItems = sectionCats.some(cat =>
                    items.some(i => i.categoryId === cat.id)
                  )
                  if (sectionCats.length === 0 || !hasItems) return null

                  return (
                    <div key={s} style={{ marginBottom: '5rem' }}>

                      {/* Section Title */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        marginBottom: '3rem',
                        paddingBottom: '1rem',
                        borderBottom: `2px solid ${sectionColors[s]}`,
                      }}>
                        <h2 style={{
                          fontFamily: 'var(--font-cinzel)',
                          fontSize: isMobile ? '1.5rem' : '2rem',
                          color: sectionColors[s],
                        }}>{s}</h2>
                      </div>

                      {/* Categories */}
                      {sectionCats.map(cat => {
                        const catItems = items.filter(i => i.categoryId === cat.id)
                        if (catItems.length === 0) return null
                        return (
                          <div key={cat.id} id={`cat-${cat.id}`} style={{ marginBottom: '3rem', scrollMarginTop: isMobile ? '90px' : '110px' }}>

                            {/* Category Header */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '1rem',
                              marginBottom: '1.5rem',
                            }}>
                              {categoryImage(cat.name, cat.image) && (
                                <Image
                                  src={categoryImage(cat.name, cat.image)}
                                  alt={cat.name}
                                  width={50}
                                  height={50}
                                  style={{
                                    width: isMobile ? '40px' : '50px',
                                    height: isMobile ? '40px' : '50px',
                                    borderRadius: '4px',
                                    objectFit: 'cover',
                                    border: `1px solid ${sectionColors[s]}40`,
                                    flexShrink: 0,
                                  }}
                                />
                              )}
                              <div>
                                <p style={{
                                  fontSize: '0.62rem',
                                  letterSpacing: '0.2em',
                                  textTransform: 'uppercase',
                                  color: sectionColors[s],
                                  fontFamily: 'var(--font-inter)',
                                  marginBottom: '0.2rem',
                                  opacity: 0.7,
                                }}>{s}</p>
                                <h3 style={{
                                  fontFamily: 'var(--font-cinzel)',
                                  fontSize: isMobile ? '1.1rem' : '1.4rem',
                                  color: 'var(--offwhite)',
                                }}>{cat.name}</h3>
                              </div>
                            </div>

                            {/* Gradient divider */}
                            <div style={{
                              height: '1px',
                              background: `linear-gradient(to right, ${sectionColors[s]}40, transparent)`,
                              marginBottom: '1.5rem',
                            }} />

                            {/* Items */}
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
                              gap: '0',
                            }}>
                              {catItems.map(item => (
                                <div key={item.id} style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'flex-start',
                                  padding: '1.1rem 1.2rem',
                                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                                  gap: '1rem',
                                }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.6rem',
                                      marginBottom: '0.3rem',
                                    }}>
                                      <p style={{
                                        fontFamily: 'var(--font-cinzel)',
                                        fontSize: '0.92rem',
                                        color: 'var(--offwhite)',
                                      }}>{item.name}</p>
                                      {item.badge && (
                                        <span style={{
                                          fontSize: '0.6rem',
                                          padding: '0.15rem 0.5rem',
                                          borderRadius: '50px',
                                          backgroundColor: `${sectionColors[s]}20`,
                                          color: sectionColors[s],
                                          fontFamily: 'var(--font-inter)',
                                          whiteSpace: 'nowrap',
                                        }}>{item.badge}</span>
                                      )}
                                    </div>
                                    <p style={{
                                      fontFamily: 'var(--font-inter)',
                                      fontSize: '0.78rem',
                                      color: 'rgba(245,242,236,0.4)',
                                      lineHeight: 1.6,
                                    }}>{item.description}</p>
                                  </div>
                                  <span style={{
                                    fontFamily: 'var(--font-inter)',
                                    fontSize: '0.9rem',
                                    color: sectionColors[s],
                                    fontWeight: 600,
                                    whiteSpace: 'nowrap',
                                  }}>${item.price}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}