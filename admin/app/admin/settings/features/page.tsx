'use client'

// The superadmin switchboard.
//
// shared/src/features.ts has carried the registry, the dependency graph and a
// full design for this screen since the fork, and nothing ever read any of it
// — every module was on regardless of what the flags said. This is the screen
// that makes the registry real.
//
// Two rules from that design are load-bearing and easy to undo by accident:
//
//   OFF CASCADES, ON DOESN'T. Switching a parent off computes its dependents
//   as off. Switching it back on restores whatever each dependent's own stored
//   setting was — it never silently switches a child on that somebody
//   deliberately turned off.
//
//   INTENT IS STORED, NEVER THE COMPUTED RESULT. A dependent shown as off
//   because its parent is off keeps its own `enabled: true` in the document.
//   Persisting the computed value here would destroy that on the first save.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRequireRole } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { useFeatureFlags } from '@big-cms/shared/useFeatures'
import {
  FEATURES, featuresByGroup, isFeatureOn, dependentsOf,
  type FeatureDefinition, type FeatureFlags, type FeatureKey,
} from '@big-cms/shared/features'
import type { Role } from '@big-cms/shared/roles'

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
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

/**
 * One module row.
 *
 * At module scope, not nested — a component declared inside another's render
 * body is a new type on every state change, so React remounts it and kills the
 * transition on the toggle. (CONTRIBUTING.md, gotcha #2.)
 */
function FeatureRow({
  def, own, effective, blockedBy, dependents, onToggle,
}: {
  def: FeatureDefinition
  /** The module's own stored intent, ignoring its dependencies. */
  own: boolean
  /** What it actually resolves to once dependencies are applied. */
  effective: boolean
  /** Labels of the switched-off modules holding this one down, if any. */
  blockedBy: string[]
  /** Labels of the modules that would go off with it. */
  dependents: string[]
  onToggle: () => void
}) {
  const locked = def.locked === true
  const held = !effective && own

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: '1rem', padding: '0.85rem 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{ minWidth: 0 }}>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.88rem', fontWeight: 500,
          color: effective ? 'var(--offwhite)' : 'rgba(245,242,236,0.35)',
        }}>
          {def.label}
          {locked && (
            <span style={{
              marginLeft: '0.55rem', fontSize: '0.58rem', letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', padding: '0.1rem 0.35rem',
            }}>Core</span>
          )}
        </p>

        {held && (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: '#C9962C', marginTop: '0.2rem' }}>
            Held off by {blockedBy.join(', ')} — switch that back on and this returns.
          </p>
        )}
        {!held && effective && dependents.length > 0 && (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.28)', marginTop: '0.2rem' }}>
            Switching off also stops {dependents.join(', ')}
          </p>
        )}
        {locked && (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.28)', marginTop: '0.2rem' }}>
            Always on — there must be no state that locks a superadmin out.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        aria-pressed={effective}
        aria-label={`${def.label}: ${effective ? 'on' : 'off'}`}
        style={{
          flexShrink: 0, width: '44px', height: '24px', borderRadius: '12px',
          border: `1px solid ${effective ? 'var(--teal)' : 'rgba(255,255,255,0.12)'}`,
          background: effective ? 'rgba(0,160,152,0.25)' : 'transparent',
          cursor: locked ? 'not-allowed' : 'pointer',
          opacity: locked ? 0.35 : 1,
          padding: 0, position: 'relative', transition: 'background 0.18s ease, border-color 0.18s ease',
        }}
      >
        <span style={{
          position: 'absolute', top: '3px', left: effective ? '23px' : '3px',
          width: '16px', height: '16px', borderRadius: '50%',
          background: effective ? 'var(--teal)' : 'rgba(245,242,236,0.35)',
          transition: 'left 0.18s ease, background 0.18s ease',
        }} />
      </button>
    </div>
  )
}

export default function FeatureSwitchboardPage() {
  const { checking, superadmin } = useRequireRole(['admin'] as Role[])
  const isMobile = useIsMobile()
  const { flags: stored, loading } = useFeatureFlags()

  // Local intent, seeded from the stored document. Only ever holds what a
  // person chose — never the computed effective value.
  const [draft, setDraft] = useState<FeatureFlags>({})
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const [done,   setDone]   = useState('')

  useEffect(() => {
    if (loading) return
    setDraft(stored)
  }, [loading, stored])

  function ownState(key: FeatureKey): boolean {
    const s = draft[key]?.enabled
    return s === undefined ? (FEATURES[key] as FeatureDefinition).defaultEnabled : s
  }

  function toggle(key: FeatureKey) {
    setDone(''); setErr('')
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], enabled: !ownState(key) } }))
  }

  const dirty = useMemo(() => {
    return (Object.keys(FEATURES) as FeatureKey[]).some(k => {
      const a = draft[k]?.enabled ?? (FEATURES[k] as FeatureDefinition).defaultEnabled
      const b = stored[k]?.enabled ?? (FEATURES[k] as FeatureDefinition).defaultEnabled
      return a !== b
    })
  }, [draft, stored])

  async function save() {
    setSaving(true); setErr(''); setDone('')
    try {
      // Send intent for every module, so the stored document is complete and
      // a later registry default change can't silently move a live switch.
      const flags = Object.fromEntries(
        (Object.keys(FEATURES) as FeatureKey[])
          .filter(k => !(FEATURES[k] as FeatureDefinition).locked)
          .map(k => [k, { enabled: ownState(k) }])
      )
      const r = await unwrap(await authedFetch('/api/admin/features', 'PATCH', { flags }))
      const changed = Number(r.changed ?? 0)
      setDone(changed === 0 ? 'Nothing changed.' : `Saved — ${changed} module${changed === 1 ? '' : 's'} changed.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  if (!superadmin) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <p style={{ color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem', textAlign: 'center', maxWidth: '38ch', lineHeight: 1.7 }}>
          Switching modules on and off is superadmin-only.
        </p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2.5rem 5rem' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        <Link href="/admin/settings" style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.66rem', letterSpacing: '0.2em',
          textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
          display: 'block', marginBottom: '0.6rem',
        }}>← Business Settings</Link>

        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.2rem',
          color: 'var(--offwhite)', marginBottom: '0.6rem',
        }}>Modules</h1>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.4)',
          lineHeight: 1.7, marginBottom: '2rem', maxWidth: '56ch',
        }}>
          Switch off what this installation doesn&apos;t use. A module that is off
          disappears from the navigation and its pages redirect away. Data is
          never deleted — switching it back on returns everything exactly as it
          was.
        </p>

        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)',
          lineHeight: 1.7, marginBottom: '2.5rem', maxWidth: '56ch',
          borderLeft: '2px solid rgba(201,150,44,0.4)', paddingLeft: '0.8rem',
        }}>
          These are business switches, not permissions. Someone determined can
          still reach a switched-off page by typing its address — what stops
          people doing things they shouldn&apos;t is their role, not this screen.
        </p>

        {featuresByGroup().map(({ group, keys }) => (
          <div key={group} style={{ marginBottom: '2rem' }}>
            <p style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.18em',
              textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.4rem',
            }}>{group}</p>
            {keys.map(key => {
              const def = FEATURES[key] as FeatureDefinition
              const blockedBy = def.requires
                .filter(r => !isFeatureOn(r as FeatureKey, draft))
                .map(r => (FEATURES[r as FeatureKey] as FeatureDefinition).label)
              const dependents = dependentsOf(key)
                .filter(d => isFeatureOn(d, draft))
                .map(d => (FEATURES[d] as FeatureDefinition).label)
              return (
                <FeatureRow
                  key={key}
                  def={def}
                  own={ownState(key)}
                  effective={isFeatureOn(key, draft)}
                  blockedBy={blockedBy}
                  dependents={dependents}
                  onToggle={() => toggle(key)}
                />
              )
            })}
          </div>
        ))}

        {err  && <p style={{ color: 'var(--red)',  fontFamily: 'var(--font-inter)', fontSize: '0.82rem', marginBottom: '1rem' }}>{err}</p>}
        {done && <p style={{ color: 'var(--teal)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', marginBottom: '1rem' }}>{done}</p>}

        <button
          onClick={save}
          disabled={saving || loading || !dirty}
          style={{
            background: dirty ? 'var(--teal)' : 'rgba(255,255,255,0.05)',
            color: dirty ? '#000' : 'rgba(245,242,236,0.3)',
            border: 'none', borderRadius: '4px', padding: '0.75rem 1.75rem',
            fontFamily: 'var(--font-inter)', fontSize: '0.8rem', fontWeight: 700,
            letterSpacing: '0.06em', cursor: saving || !dirty ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >{saving ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}</button>

      </div>
    </div>
  )
}
