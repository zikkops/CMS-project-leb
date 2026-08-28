'use client'

import { useEffect, useState } from 'react'
import { listMedia, deleteMediaItem, type MediaItem } from '../../lib/media'
import MediaLibraryGrid from './MediaLibraryGrid'

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

export default function MediaPickerModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (url: string) => void
}) {
  const isMobile = useIsMobile()
  const [items, setItems]     = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    listMedia().then(setItems).finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? '1.25rem' : '2rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#0d0d0d',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '4px',
          width: '100%',
          maxWidth: '900px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: isMobile ? '1rem 1.25rem' : '1.25rem 1.75rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color: 'var(--offwhite)' }}>
            Choose from Media
          </h3>
          <button onClick={onClose} style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(245,242,236,0.5)',
            padding: '0.4rem 1rem',
            borderRadius: '2px',
            fontSize: '0.72rem',
            cursor: 'pointer',
            fontFamily: 'var(--font-inter)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>✕ Close</button>
        </div>

        <div style={{ padding: isMobile ? '1.25rem' : '1.75rem', overflowY: 'auto' }}>
          {loading ? (
            <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>Loading…</p>
          ) : (
            <MediaLibraryGrid
              items={items}
              isMobile={isMobile}
              onSelect={url => { onSelect(url); onClose() }}
              onDelete={async item => {
                await deleteMediaItem(item)
                setItems(prev => prev.filter(i => i.id !== item.id))
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
