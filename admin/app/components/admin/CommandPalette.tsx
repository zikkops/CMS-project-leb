'use client'

// Ctrl+K (⌘K on a Mac) from any admin page: type a few letters of what you
// want, press Enter, and you are there (UPGRADE.md T2.15). It searches the
// pages this person can open (the same visibleNav() the sidebar shows) by
// name, description and section, through filterNav(), so it grows with the
// navigation and never offers a page the sidebar would not.
// Module-scope component (CONTRIBUTING.md gotcha #2).

import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faGear } from '@fortawesome/free-solid-svg-icons'
import { filterNav, navSearchActive, navSearchLetters, NAV_SEARCH_MIN, type AdminNavSection } from '@big-cms/shared/adminNav'

export function CommandPalette({ sections, onGo, onClose }: {
  sections: AdminNavSection[]
  onGo: (href: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  // Everything, until the search has enough letters to mean something —
  // filterNav() holds that rule, so this and the sidebar cannot disagree
  // about when a search has begun.
  const results = filterNav(sections, query).flatMap(s => s.items.map(item => ({ item, section: s })))
  const lettersWanted = NAV_SEARCH_MIN - navSearchLetters(query)
  const typingStill = !navSearchActive(query) && navSearchLetters(query) > 0
  const chosen = Math.min(at, Math.max(0, results.length - 1))

  useEffect(() => { input.current?.focus() }, [])

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(results.length - 1, chosen + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(0, chosen - 1)) }
    else if (e.key === 'Enter' && results[chosen]) { e.preventDefault(); onGo(results[chosen].item.href) }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 1rem 1rem',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Go to a page" onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: '560px', background: '#141414', border: '1px solid rgba(var(--overlay-rgb),0.14)',
        borderRadius: '12px', overflow: 'hidden', fontFamily: 'var(--font-inter)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.9rem 1rem', borderBottom: '1px solid rgba(var(--overlay-rgb),0.08)' }}>
          <FontAwesomeIcon icon={faMagnifyingGlass} style={{ color: 'rgba(var(--offwhite-rgb),0.45)' }} />
          <input
            ref={input}
            value={query}
            onChange={e => { setQuery(e.target.value); setAt(0) }}
            onKeyDown={onKey}
            placeholder={`Go to a page… ${NAV_SEARCH_MIN} letters`}
            aria-label="Go to a page"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="palette-results"
            aria-activedescendant={results[chosen] ? `palette-${chosen}` : undefined}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--offwhite)', fontSize: '1rem', fontFamily: 'inherit' }}
          />
          <kbd style={{ fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.4)', border: '1px solid rgba(var(--overlay-rgb),0.15)', borderRadius: '4px', padding: '0.1rem 0.35rem' }}>Esc</kbd>
        </div>
        <ul id="palette-results" role="listbox" style={{ listStyle: 'none', margin: 0, padding: '0.4rem', maxHeight: '50vh', overflowY: 'auto' }}>
          {typingStill && (
            <li aria-live="polite" style={{ padding: '0.9rem', fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.45)' }}>
              {lettersWanted === 1 ? 'One more letter…' : `${lettersWanted} more letters…`}
            </li>
          )}
          {results.length === 0 && (
            <li style={{ padding: '0.9rem', fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.45)' }}>No page matches.</li>
          )}
          {results.map(({ item, section }, i) => (
            <li key={item.href} id={`palette-${i}`} role="option" aria-selected={i === chosen}
              onMouseEnter={() => setAt(i)}
              onClick={() => onGo(item.href)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.7rem', borderRadius: '8px', cursor: 'pointer',
                background: i === chosen ? 'rgba(var(--overlay-rgb),0.07)' : 'transparent',
              }}>
              <FontAwesomeIcon icon={item.icon} style={{ color: section.color, width: '1rem' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '0.92rem', color: 'var(--offwhite)' }}>
                  {item.label}
                  {item.kind === 'setup' && <FontAwesomeIcon icon={faGear} title="Setup" style={{ marginLeft: '0.45rem', fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.4)' }} />}
                </span>
                <span style={{ display: 'block', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {section.title} · {item.desc}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
