'use client'

import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faCheck } from '@fortawesome/free-solid-svg-icons'
import { findUsages, type MediaItem } from '../../lib/media'

export default function MediaLibraryGrid({
  items,
  onDelete,
  onSelect,
  isMobile,
}: {
  items: MediaItem[]
  onDelete: (item: MediaItem) => Promise<void>
  onSelect?: (url: string) => void
  isMobile?: boolean
}) {
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleDelete(item: MediaItem) {
    setBusyId(item.id)
    const usages = await findUsages(item.url)
    const legacy = !item.deleteUrl

    const warning = usages.length > 0
      ? `This image is currently used by:\n${usages.join('\n')}\n\nDeleting it will break those entries' images. `
      : ''
    const action = legacy
      ? 'Remove this image from the library? It predates delete tracking, so it may still remain on the host.'
      : 'Permanently delete this image from hosting?'

    if (confirm(warning + action)) {
      await onDelete(item)
    }
    setBusyId(null)
  }

  if (items.length === 0) {
    return (
      <div style={{
        border: '1px dashed rgba(255,255,255,0.08)',
        borderRadius: '4px',
        padding: '3rem',
        textAlign: 'center',
        color: 'rgba(245,242,236,0.25)',
        fontFamily: 'var(--font-inter)',
        fontSize: '0.85rem',
      }}>No images in the media library yet.</div>
    )
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)',
      gap: '0.8rem',
    }}>
      {items.map(item => (
        <div key={item.id} style={{
          position: 'relative',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '4px',
          overflow: 'hidden',
          backgroundColor: '#fff',
          opacity: busyId === item.id ? 0.4 : 1,
        }}>
          <button
            type="button"
            onClick={() => onSelect?.(item.url)}
            disabled={!onSelect}
            title={item.fileName ?? item.url}
            style={{
              display: 'block',
              width: '100%',
              height: isMobile ? '70px' : '90px',
              border: 'none',
              padding: 0,
              cursor: onSelect ? 'pointer' : 'default',
              backgroundColor: 'transparent',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.fileName ?? ''} style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }} />
          </button>

          {!item.deleteUrl && (
            <span style={{
              position: 'absolute',
              top: '4px',
              left: '4px',
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: 'rgba(245,242,236,0.6)',
              fontSize: '0.55rem',
              padding: '0.1rem 0.4rem',
              borderRadius: '2px',
              fontFamily: 'var(--font-inter)',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}>Legacy</span>
          )}

          {onSelect && (
            <button
              type="button"
              onClick={() => onSelect(item.url)}
              title="Use this image"
              style={{
                position: 'absolute',
                bottom: '4px',
                left: '4px',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'rgba(0,160,152,0.9)',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.65rem',
              }}
            ><FontAwesomeIcon icon={faCheck} /></button>
          )}

          <button
            type="button"
            onClick={() => handleDelete(item)}
            disabled={busyId === item.id}
            title="Delete"
            style={{
              position: 'absolute',
              bottom: '4px',
              right: '4px',
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              border: 'none',
              backgroundColor: 'rgba(228,51,41,0.9)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.65rem',
            }}
          ><FontAwesomeIcon icon={faTrash} /></button>
        </div>
      ))}
    </div>
  )
}
