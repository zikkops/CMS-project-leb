'use client'

// Food safety settings — the units that get a reading, the checklists, the
// limits and the allergens tracked.
//
// Units and checklists: managers and admins (foodSafetyReview). Limits and the
// allergen list: admins only, and enforced in the route, because they are the
// café's legal thresholds rather than its routine.
//
// The defaults are the UK's (Safer Food, Better Business). Research on 14 Sep
// 2026 found Lebanon sets two of them — fridge below 8 °C and freezer below
// −18 °C, in a Ministry of Public Health inspection checklist — both of which
// the defaults already meet; for the rest no Lebanese figure was found.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import {
  ALLERGENS_EU14, LIMIT_LABELS, UK_SFBB_LIMITS, UNIT_KINDS,
  type ChecklistItem, type FoodSafetyLimits, type LimitKey, type UnitKind,
} from '@big-cms/shared/foodSafety'
import { startLoad } from '@big-cms/shared/startLoad'

interface Unit { id: string; name: string; kind: UnitKind; active: boolean }
interface Settings { limits: FoodSafetyLimits; allergens: string[]; openingChecks: ChecklistItem[]; closingChecks: ChecklistItem[] }

const inp: React.CSSProperties = {
  background: 'rgba(var(--overlay-rgb),0.05)', border: '1px solid rgba(var(--overlay-rgb),0.12)',
  color: 'var(--offwhite)', borderRadius: '4px', padding: '0.5rem 0.7rem',
  fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-inter)',
}
const card: React.CSSProperties = {
  background: 'rgba(var(--overlay-rgb),0.03)', border: '1px solid rgba(var(--overlay-rgb),0.1)',
  borderRadius: '6px', padding: '1rem 1.1rem', marginBottom: '1.2rem',
}
const heading: React.CSSProperties = {
  fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.4)', marginBottom: '0.7rem',
}
const small: React.CSSProperties = { fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.45)', lineHeight: 1.5 }
const button: React.CSSProperties = { ...inp, cursor: 'pointer', background: 'var(--teal)', color: '#fff', border: 'none', fontWeight: 600 }
const quiet: React.CSSProperties = { ...inp, cursor: 'pointer', background: 'transparent', color: 'rgba(var(--offwhite-rgb),0.7)' }

const LIMIT_KEYS = Object.keys(UK_SFBB_LIMITS) as LimitKey[]

// Module scope: see CONTRIBUTING gotcha #2.
function ChecklistEditor({ title, items, onChange, disabled }: {
  title: string
  items: ChecklistItem[]
  onChange: (next: ChecklistItem[]) => void
  disabled: boolean
}) {
  return (
    <div style={card}>
      <p style={heading}>{title}</p>
      {items.map((item, i) => (
        <div key={`${item.key}-${i}`} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.45rem' }}>
          <input style={{ ...inp, flex: 1 }} disabled={disabled} value={item.label}
            onChange={e => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button type="button" style={quiet} disabled={disabled || items.length <= 1}
            onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {!disabled && (
        // A new check has no key; the server gives it one, so an existing
        // check keeps the key its past answers point at.
        <button type="button" style={quiet} onClick={() => onChange([...items, { key: '', label: '' }])}>Add a check</button>
      )}
    </div>
  )
}

export default function FoodSafetySettingsPage() {
  const { checking, role } = useRequireRole(SECTION_ACCESS.foodSafetyReview)
  const isMobile = useIsMobile()
  const isAdmin = role === 'admin'

  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<UnitKind>('fridge')

  const [settings, setSettings] = useState<Settings | null>(null)
  const [limits, setLimits] = useState<Record<LimitKey, string>>({} as Record<LimitKey, string>)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const fillLimits = (l: FoodSafetyLimits) =>
    setLimits(Object.fromEntries(LIMIT_KEYS.map(k => [k, String(l[k])])) as Record<LimitKey, string>)

  useEffect(() => {
    if (checking) return
    authedFetch('/api/admin/food-safety?view=settings', 'GET').then(unwrap)
      .then(r => {
        const s = r.settings as Settings
        setSettings(s)
        fillLimits(s.limits)
        const list = (r.branches as string[]) ?? []
        setBranches(list)
        setBranch(list[0] ?? '')
      })
      .catch(e => setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not load settings.' }))
  }, [checking])

  const loadUnits = useCallback(async () => {
    if (!branch) return
    try {
      const r = await unwrap(await authedFetch(`/api/admin/food-safety?view=units&branch=${encodeURIComponent(branch)}`, 'GET'))
      setUnits((r.units as Unit[]) ?? [])
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not load units.' })
    }
  }, [branch])

  useEffect(() => { startLoad(loadUnits) }, [loadUnits])

  if (checking) return null

  async function put(body: Record<string, unknown>, done: string) {
    setBusy(true); setMessage(null)
    try {
      await unwrap(await authedFetch('/api/admin/food-safety', 'PUT', body))
      setMessage({ tone: 'ok', text: done })
      return true
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not save.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addUnit() {
    if (await put({ action: 'unit', branch, name: newName, kind: newKind }, `${newName} added.`)) {
      setNewName('')
      await loadUnits()
    }
  }

  async function saveUnit(u: Unit, changes: Partial<Unit>) {
    const next = { ...u, ...changes }
    if (await put({ action: 'unit', id: u.id, branch, name: next.name, kind: next.kind, active: next.active }, `${next.name} saved.`)) {
      await loadUnits()
    }
  }

  async function saveSettings() {
    if (!settings) return
    // Sent as numbers, or null for anything that is not one — the route refuses
    // null with the limit's name, rather than this page guessing.
    const parsed = Object.fromEntries(LIMIT_KEYS.map(k => {
      const n = Number(limits[k]?.trim().replace(',', '.'))
      return [k, limits[k]?.trim() !== '' && Number.isFinite(n) ? n : null]
    }))
    await put({ action: 'settings', ...settings, limits: parsed }, 'Settings saved.')
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '2rem 1rem 4rem' }}>
      <div style={{ maxWidth: '820px', margin: '0 auto' }}>
        <Link href="/admin/food-safety" style={{ ...small, textDecoration: 'none', display: 'block', marginBottom: '0.5rem' }}>← Today&apos;s diary</Link>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '1.2rem' }}>Food Safety Settings</h1>

        {message && (
          <p style={{ ...small, whiteSpace: 'pre-line', color: message.tone === 'ok' ? 'var(--teal)' : 'var(--red)', marginBottom: '1rem' }}>{message.text}</p>
        )}

        {/* ── Units ─────────────────────────────────────────────────────── */}
        <div style={card}>
          <p style={heading}>Units that get a daily reading</p>
          <select style={{ ...inp, background: '#1c1c1c', marginBottom: '0.8rem', width: isMobile ? '100%' : 'auto' }}
            value={branch} onChange={e => setBranch(e.target.value)}>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          {units.length === 0 && <p style={{ ...small, marginBottom: '0.8rem' }}>No units at {branch} yet.</p>}
          {units.map(u => (
            <div key={u.id} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.45rem', opacity: u.active ? 1 : 0.55 }}>
              <input style={{ ...inp, flex: '1 1 12rem' }} defaultValue={u.name}
                onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== u.name) void saveUnit(u, { name: e.target.value.trim() }) }} />
              <select style={{ ...inp, background: '#1c1c1c' }} value={u.kind} onChange={e => void saveUnit(u, { kind: e.target.value as UnitKind })}>
                {UNIT_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <button type="button" style={quiet} disabled={busy} onClick={() => void saveUnit(u, { active: !u.active })}>
                {u.active ? 'Retire' : 'Bring back'}
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
            <input style={{ ...inp, flex: '1 1 12rem' }} placeholder='e.g. "Walk-in fridge"' value={newName} onChange={e => setNewName(e.target.value)} />
            <select style={{ ...inp, background: '#1c1c1c' }} value={newKind} onChange={e => setNewKind(e.target.value as UnitKind)}>
              {UNIT_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            <button type="button" style={button} disabled={busy || !newName.trim() || !branch} onClick={() => void addUnit()}>Add unit</button>
          </div>
          <p style={{ ...small, marginTop: '0.6rem' }}>A unit is retired rather than deleted, so the days that recorded it still name it.</p>
        </div>

        {settings && (
          <>
            <ChecklistEditor title="Opening checks" items={settings.openingChecks} disabled={busy}
              onChange={next => setSettings({ ...settings, openingChecks: next })} />
            <ChecklistEditor title="Closing checks" items={settings.closingChecks} disabled={busy}
              onChange={next => setSettings({ ...settings, closingChecks: next })} />

            {/* ── Limits ───────────────────────────────────────────────── */}
            <div style={card}>
              <p style={heading}>Limits {isAdmin ? '' : '— set by an admin'}</p>
              <p style={{ ...small, marginBottom: '0.9rem' }}>
                The defaults are the UK&apos;s, from the Food Standards Agency&apos;s <em>Safer Food, Better Business</em>.
                In Lebanon, the Ministry of Public Health&apos;s inspection checklist asks for fridges below 8 °C and freezers
                below −18 °C, logged daily; no Lebanese figure was found for the others. These are guidance for setting
                up — the business is responsible for following its local rules.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.6rem 1rem' }}>
                {LIMIT_KEYS.map(k => (
                  <label key={k} style={{ ...small, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {LIMIT_LABELS[k]}
                    <input style={inp} inputMode="decimal" disabled={!isAdmin || busy} value={limits[k] ?? ''}
                      onChange={e => setLimits(prev => ({ ...prev, [k]: e.target.value }))} />
                  </label>
                ))}
              </div>
              {isAdmin && (
                <button type="button" style={{ ...quiet, marginTop: '0.8rem' }} onClick={() => fillLimits(UK_SFBB_LIMITS)}>Use the UK defaults</button>
              )}
            </div>

            {/* ── Allergens ────────────────────────────────────────────── */}
            <div style={card}>
              <p style={heading}>Allergens tracked</p>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.35rem 1rem' }}>
                {ALLERGENS_EU14.map(a => (
                  <label key={a.key} style={{ ...small, color: 'var(--offwhite)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input type="checkbox" disabled={!isAdmin || busy} checked={settings.allergens.includes(a.key)}
                      onChange={e => setSettings({
                        ...settings,
                        allergens: e.target.checked ? [...settings.allergens, a.key] : settings.allergens.filter(k => k !== a.key),
                      })} />
                    {a.label}
                  </label>
                ))}
              </div>
            </div>

            {isAdmin ? (
              <button type="button" style={button} disabled={busy} onClick={() => void saveSettings()}>
                {busy ? 'Saving…' : 'Save checklists, limits and allergens'}
              </button>
            ) : (
              <p style={small}>Checklists, limits and allergens are saved by an admin.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
