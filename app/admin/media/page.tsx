'use client'

import { useEffect, useState } from 'react'
import { useRequireRole, ALL_ROLES } from '../../lib/adminAuth'
import { listMediaPage, deleteMediaItem, backfillMediaLibrary, type MediaItem } from '../../lib/media'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import MediaLibraryGrid from '../../components/admin/MediaLibraryGrid'

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

export default function MediaLibraryPage() {
  const { checking } = useRequireRole(ALL_ROLES)
  const isMobile = useIsMobile()
  const [items, setItems]         = useState<MediaItem[]>([])
  const [cursor, setCursor]       = useState<QueryDocumentSnapshot | null>(null)
  const [hasMore, setHasMore]     = useState(false)
  const [loading, setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [syncing, setSyncing]     = useState(false)
  const [syncMsg, setSyncMsg]     = useState('')

  async function load() {
    setLoading(true)
    const result = await listMediaPage(null)
    setItems(result.items)
    setCursor(result.cursor)
    setHasMore(result.hasMore)
    setLoading(false)
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    const result = await listMediaPage(cursor)
    setItems(prev => [...prev, ...result.items])
    setCursor(result.cursor)
    setHasMore(result.hasMore)
    setLoadingMore(false)
  }

  useEffect(() => { load() }, [])

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    const { added } = await backfillMediaLibrary()
    setSyncMsg(added > 0 ? `Added ${added} previously-hosted image${added === 1 ? '' : 's'}.` : 'Nothing new to add — the library is already up to date.')
    await load()
    setSyncing(false)
  }

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1300px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'flex-start' : 'center',
          gap: isMobile ? '1.25rem' : '0',
          marginBottom: '2rem',
        }}>
          <div>
            <a href="/admin" style={{
              fontSize: '0.7rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.3)',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              marginBottom: '0.5rem',
              display: 'block',
            }}>← Back to Dashboard</a>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Media Library
            </h1>
            <p style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.78rem',
              color: 'rgba(245,242,236,0.3)',
              marginTop: '0.5rem',
            }}>
              {items.length} image{items.length === 1 ? '' : 's'} loaded{hasMore ? ' — more available' : ''}
            </p>
          </div>
          <button onClick={handleSync} disabled={syncing} style={{
            backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(245,242,236,0.6)',
            padding: '0.7rem 1.5rem',
            borderRadius: '2px',
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.6 : 1,
            fontFamily: 'var(--font-inter)',
          }}>{syncing ? 'Syncing…' : 'Sync Existing Images'}</button>
        </div>

        {syncMsg && (
          <p style={{ marginBottom: '1.5rem', fontSize: '0.8rem', color: 'var(--teal)', fontFamily: 'var(--font-inter)' }}>
            {syncMsg}
          </p>
        )}

        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.78rem',
          color: 'rgba(245,242,236,0.3)',
          marginBottom: '2rem',
          lineHeight: 1.6,
        }}>
          Every image uploaded through Products, Menu, or Events shows up here automatically.
          Images marked <strong style={{ color: 'rgba(245,242,236,0.6)' }}>Legacy</strong> were uploaded before this library existed
          (or backfilled by Sync) — deleting them only removes the entry from this list, since the original delete link wasn&apos;t kept.
        </p>

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : (
          <>
            <MediaLibraryGrid
              items={items}
              isMobile={isMobile}
              onDelete={async item => {
                // The grid listed what uses this image and asked first.
                await deleteMediaItem(item, true)
                setItems(prev => prev.filter(i => i.id !== item.id))
              }}
            />
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: loadingMore ? 'rgba(245,242,236,0.3)' : 'rgba(245,242,236,0.6)',
                    padding: '0.8rem 2.5rem',
                    borderRadius: '2px',
                    fontSize: '0.75rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: loadingMore ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-inter)',
                  }}
                >
                  {loadingMore ? 'Loading…' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
