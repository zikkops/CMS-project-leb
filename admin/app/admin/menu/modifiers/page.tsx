'use client'

// Modifier groups: the choices a menu item can carry.
//
// "Size" with Small and Large, "Milk" with oat and soy, "Extras" with a shot
// and a syrup. A group is defined once and attached to as many items as need
// it — adding oat milk should be one edit, not fourteen.
//
// The POS reads these when a waiter taps an item. Everything priced here is
// what the till charges, which is why the writes go through
// /api/admin/modifiers rather than the client SDK.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { db } from '@big-cms/shared/firebase'
import { collection, onSnapshot } from 'firebase/firestore'
import {
  MODIFIER_LIMITS, selectionLabel, type ModifierGroup, type ModifierOption,
} from '@big-cms/shared/modifiers'

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

interface MenuItemRow {
  id: string
  name: string
  categoryId: string
  modifierGroupIds: string[]
}

const label: React.CSSProperties = {
  display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.64rem',
  letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'rgba(245,242,236,0.35)', marginBottom: '0.35rem',
}
const inp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '4px', padding: '0.6rem 0.75rem', color: 'var(--offwhite)',
  fontFamily: 'var(--font-inter)', fontSize: '0.88rem', outline: 'none', width: '100%',
}
const btn: React.CSSProperties = {
  minHeight: '42px', borderRadius: '4px', cursor: 'pointer',
  fontFamily: 'var(--font-inter)', fontSize: '0.8rem', padding: '0 1rem',
}

/** A draft option while the group is being edited. */
interface DraftOption { id?: string; name: string; priceDelta: string }

/**
 * The editor for one group. Module scope, like every component in this repo —
 * one declared in a render body remounts on each keystroke and the input loses
 * focus. (CONTRIBUTING.md, gotcha #2.)
 */
function GroupEditor({
  initial, onCancel, onSave, saving, isMobile,
}: {
  initial: ModifierGroup | null
  onCancel: () => void
  onSave: (body: Record<string, unknown>) => void
  saving: boolean
  isMobile: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [min, setMin] = useState(String(initial?.minSelections ?? 0))
  const [max, setMax] = useState(String(initial?.maxSelections ?? 1))
  const [options, setOptions] = useState<DraftOption[]>(
    initial?.options.map(o => ({ id: o.id, name: o.name, priceDelta: String(o.priceDelta) }))
      ?? [{ name: '', priceDelta: '0' }],
  )

  const filled = options.filter(o => o.name.trim())
  const minN = Number(min)
  const maxN = Number(max)

  // The same rules the route enforces, so Save is disabled for exactly the
  // reasons a request would be refused rather than after a round trip.
  const problem =
    !name.trim() ? 'Give the group a name.'
    : filled.length === 0 ? 'Add at least one option.'
    : new Set(filled.map(o => o.name.trim().toLowerCase())).size !== filled.length
      ? 'Two options have the same name.'
    : !Number.isInteger(maxN) || maxN < 1 || maxN > filled.length
      ? `Maximum must be between 1 and ${filled.length}.`
    : !Number.isInteger(minN) || minN < 0 || minN > maxN
      ? 'Minimum cannot be more than the maximum.'
    : filled.some(o => !(Number(o.priceDelta) >= 0))
      ? 'An extra charge cannot be negative — price the item at its lower size and charge for the larger one.'
    : null

  return (
    <div style={{
      border: '1px solid rgba(0,160,152,0.35)', borderRadius: '5px',
      padding: isMobile ? '1rem' : '1.25rem', marginBottom: '1rem',
      background: 'rgba(0,160,152,0.04)',
    }}>
      <label style={label}>Group name</label>
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder="Size" style={inp} />

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.9rem' }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Choose at least</label>
          <input value={min} onChange={e => setMin(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric" style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>At most</label>
          <input value={max} onChange={e => setMax(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric" style={inp} />
        </div>
      </div>
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '0.7rem',
        color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem', lineHeight: 1.6,
      }}>
        {/* Spelled out because "min 0 max 1" is not how anybody thinks about a
            menu. 0 and 1 is an optional extra; 1 and 1 is a required choice. */}
        Minimum 0 makes it optional. Minimum 1 makes the waiter choose before
        the item can be added. The POS will show: <strong style={{ color: 'rgba(245,242,236,0.5)' }}>
          {selectionLabel({ minSelections: minN || 0, maxSelections: maxN || 1 })}
        </strong>
      </p>

      <label style={{ ...label, marginTop: '1.1rem' }}>Options</label>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {options.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              value={o.name}
              onChange={e => setOptions(list => list.map((x, n) => n === i ? { ...x, name: e.target.value } : x))}
              placeholder={i === 0 ? 'Small' : 'Large'}
              style={{ ...inp, flex: 2 }}
            />
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ color: 'rgba(245,242,236,0.35)', fontSize: '0.85rem' }}>+$</span>
              <input
                value={o.priceDelta}
                onChange={e => setOptions(list => list.map((x, n) =>
                  n === i ? { ...x, priceDelta: e.target.value.replace(/[^0-9.]/g, '') } : x))}
                inputMode="decimal"
                style={{ ...inp, textAlign: 'right' }}
              />
            </div>
            <button
              onClick={() => setOptions(list => list.filter((_, n) => n !== i))}
              disabled={options.length === 1}
              style={{
                ...btn, padding: '0 0.7rem', background: 'none',
                border: '1px solid rgba(255,255,255,0.1)',
                color: options.length === 1 ? 'rgba(245,242,236,0.15)' : 'var(--red)',
                cursor: options.length === 1 ? 'default' : 'pointer',
              }}
            >✕</button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setOptions(list => [...list, { name: '', priceDelta: '0' }])}
        disabled={options.length >= MODIFIER_LIMITS.optionsPerGroup}
        style={{
          ...btn, marginTop: '0.6rem', background: 'none',
          border: '1px dashed rgba(255,255,255,0.18)', color: 'rgba(245,242,236,0.5)',
        }}
      >+ Add option</button>

      {problem && (
        <p style={{
          color: '#C9962C', fontFamily: 'var(--font-inter)', fontSize: '0.78rem',
          marginTop: '0.9rem', lineHeight: 1.6,
        }}>{problem}</p>
      )}

      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.1rem' }}>
        <button onClick={onCancel} style={{
          ...btn, flex: 1, background: 'transparent',
          border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(245,242,236,0.6)',
        }}>Cancel</button>
        <button
          disabled={Boolean(problem) || saving}
          onClick={() => onSave({
            ...(initial ? { id: initial.id } : {}),
            name: name.trim(),
            minSelections: minN,
            maxSelections: maxN,
            options: filled.map(o => ({
              ...(o.id ? { id: o.id } : {}),
              name: o.name.trim(),
              priceDelta: Number(o.priceDelta) || 0,
            })),
          })}
          style={{
            ...btn, flex: 2, border: 'none', color: '#fff',
            backgroundColor: problem || saving ? 'rgba(0,160,152,0.25)' : 'var(--teal)',
            cursor: problem || saving ? 'default' : 'pointer',
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}
        >{saving ? 'Saving…' : initial ? 'Save changes' : 'Create group'}</button>
      </div>
    </div>
  )
}

/** Which items a group is attached to. */
function AttachPanel({
  group, items, busy, onToggle,
}: {
  group: ModifierGroup
  items: MenuItemRow[]
  busy: boolean
  onToggle: (item: MenuItemRow, on: boolean) => void
}) {
  return (
    <div style={{
      marginTop: '0.75rem', paddingTop: '0.75rem',
      borderTop: '1px solid rgba(255,255,255,0.07)',
    }}>
      <p style={{ ...label, marginBottom: '0.5rem' }}>On which items</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {items.map(i => {
          const on = i.modifierGroupIds.includes(group.id)
          return (
            <button
              key={i.id}
              disabled={busy}
              onClick={() => onToggle(i, !on)}
              style={{
                ...btn, minHeight: '36px', padding: '0 0.75rem', fontSize: '0.75rem',
                backgroundColor: on ? 'rgba(0,160,152,0.18)' : 'transparent',
                border: `1px solid ${on ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
                color: on ? 'var(--offwhite)' : 'rgba(245,242,236,0.45)',
              }}
            >{on ? '✓ ' : ''}{i.name}</button>
          )
        })}
        {items.length === 0 && (
          <p style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.78rem',
            color: 'rgba(245,242,236,0.3)',
          }}>No menu items yet — add some under Manage Menu first.</p>
        )}
      </div>
    </div>
  )
}

export default function ModifiersPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.menu)
  const isMobile = useIsMobile()

  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [items, setItems] = useState<MenuItemRow[]>([])
  const [editing, setEditing] = useState<ModifierGroup | null | 'new'>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Live, like the rest of the panel — two people editing the menu at once
  // should not overwrite each other's view of it.
  useEffect(() => {
    const a = onSnapshot(collection(db, 'modifierGroups'), snap => {
      setGroups(snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as ModifierGroup)
        .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0) || x.name.localeCompare(y.name)))
    }, err => setError(err.message))

    const b = onSnapshot(collection(db, 'menuItems'), snap => {
      setItems(snap.docs.map(d => ({
        id: d.id,
        name: String(d.data().name ?? ''),
        categoryId: String(d.data().categoryId ?? ''),
        modifierGroupIds: Array.isArray(d.data().modifierGroupIds)
          ? d.data().modifierGroupIds as string[] : [],
      })).sort((x, y) => x.name.localeCompare(y.name)))
    }, err => setError(err.message))

    return () => { a(); b() }
  }, [])

  async function save(body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      await unwrap(await authedFetch('/api/admin/modifiers', body.id ? 'PATCH' : 'POST', body))
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(group: ModifierGroup) {
    if (!confirm(`Delete "${group.name}"?`)) return
    setBusy(true)
    setError('')
    try {
      await unwrap(await authedFetch(
        `/api/admin/modifiers?id=${encodeURIComponent(group.id)}`, 'DELETE'))
    } catch (err) {
      // The route refuses while items still use it and names them, which is
      // more useful than anything this page could say.
      setError(err instanceof Error ? err.message : 'Could not delete.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleAttach(group: ModifierGroup, item: MenuItemRow, on: boolean) {
    setBusy(true)
    setError('')
    const next = on
      ? [...item.modifierGroupIds, group.id]
      : item.modifierGroupIds.filter(id => id !== group.id)
    try {
      await unwrap(await authedFetch('/api/admin/modifiers', 'PATCH',
        { itemId: item.id, groupIds: next }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that item.')
    } finally {
      setBusy(false)
    }
  }

  if (checking) return null

  return (
    <div style={{ maxWidth: '760px' }}>
      <Link href="/admin/menu" style={{
        fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.16em',
        textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)',
        textDecoration: 'none', display: 'block', marginBottom: '0.6rem',
      }}>← Manage Menu</Link>

      <h1 style={{
        fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.9rem',
        color: 'var(--offwhite)', marginBottom: '0.5rem',
      }}>Item options</h1>
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
        color: 'rgba(245,242,236,0.4)', lineHeight: 1.7, marginBottom: '1.75rem', maxWidth: '56ch',
      }}>
        The choices a waiter is asked for when they add an item at the till —
        size, milk, extras. Define a group once and attach it to as many items
        as need it, so adding oat milk is one edit rather than fourteen.
      </p>

      {error && (
        <p style={{
          color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
          background: 'rgba(228,51,41,0.08)', border: '1px solid rgba(228,51,41,0.25)',
          borderRadius: '3px', padding: '0.7rem 0.9rem', marginBottom: '1rem', lineHeight: 1.6,
        }}>{error}</p>
      )}

      {editing === 'new' && (
        <GroupEditor initial={null} isMobile={isMobile} saving={busy}
          onCancel={() => setEditing(null)} onSave={save} />
      )}

      {groups.map(g => (
        <div key={g.id} style={{
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px',
          padding: isMobile ? '0.9rem' : '1.1rem', marginBottom: '0.7rem',
        }}>
          {editing !== null && editing !== 'new' && editing.id === g.id ? (
            <GroupEditor initial={g} isMobile={isMobile} saving={busy}
              onCancel={() => setEditing(null)} onSave={save} />
          ) : (
            <>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap',
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{
                    fontFamily: 'var(--font-inter)', fontSize: '0.95rem',
                    color: 'var(--offwhite)',
                  }}>{g.name}</p>
                  <p style={{
                    fontFamily: 'var(--font-inter)', fontSize: '0.75rem',
                    color: 'rgba(245,242,236,0.4)', marginTop: '0.2rem',
                  }}>
                    {selectionLabel(g)} · {g.options.map((o: ModifierOption) =>
                      o.priceDelta > 0 ? `${o.name} +$${o.priceDelta}` : o.name).join(', ')}
                  </p>
                  <p style={{
                    fontFamily: 'var(--font-inter)', fontSize: '0.7rem',
                    color: 'rgba(245,242,236,0.28)', marginTop: '0.25rem',
                  }}>
                    On {items.filter(i => i.modifierGroupIds.includes(g.id)).length} item(s)
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => setExpanded(expanded === g.id ? null : g.id)} style={{
                    ...btn, background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(245,242,236,0.6)',
                  }}>{expanded === g.id ? 'Done' : 'Attach'}</button>
                  <button onClick={() => setEditing(g)} style={{
                    ...btn, background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(245,242,236,0.6)',
                  }}>Edit</button>
                  <button onClick={() => remove(g)} style={{
                    ...btn, background: 'transparent',
                    border: '1px solid rgba(228,51,41,0.3)', color: 'var(--red)',
                  }}>Delete</button>
                </div>
              </div>

              {expanded === g.id && (
                <AttachPanel group={g} items={items} busy={busy}
                  onToggle={(item, on) => toggleAttach(g, item, on)} />
              )}
            </>
          )}
        </div>
      ))}

      {groups.length === 0 && editing !== 'new' && (
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.88rem',
          color: 'rgba(245,242,236,0.3)', lineHeight: 1.7, padding: '1.5rem 0',
        }}>
          No option groups yet. A café usually starts with one for size and one
          for milk.
        </p>
      )}

      {editing !== 'new' && (
        <button onClick={() => setEditing('new')} style={{
          ...btn, minHeight: '46px', marginTop: '0.6rem',
          backgroundColor: 'var(--teal)', border: 'none', color: '#fff',
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>+ New option group</button>
      )}
    </div>
  )
}
