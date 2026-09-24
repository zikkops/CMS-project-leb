'use client'

// What each branch's till shows (UPGRADE.md T7.20, owner's request 24 Sep 2026).
//
// A café that does not sell desserts at one branch had no way to take them off
// that till without taking them off the website too. Tick a category to hide
// the whole of it, or single dishes.
//
// It changes what is SEEN on the till, not what may be sold: `available` takes
// something off the menu everywhere, and Sold out is the till's own switch for
// the rest of the day. Nothing here touches a check that is already open.

import { useCallback, useEffect, useState } from 'react'
import { faEye, faRotateLeft, faFloppyDisk } from '@fortawesome/free-solid-svg-icons'
import { useRequireRole, SECTION_ACCESS, useAdminUser } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { startLoad } from '@big-cms/shared/startLoad'
import { Page, PageHeader, Panel, Button, ErrorLine, Loading, EmptyState, inputStyle } from '../../../components/ui'

interface Cat { id: string; name: string; section: string; hidden: boolean }
interface Item { id: string; name: string; categoryId: string; available: boolean; hidden: boolean }
interface View {
  branch: string
  branches: string[]
  categories: Cat[]
  items: Item[]
  counts: { categoriesShown: number; categoriesTotal: number; itemsShown: number; itemsTotal: number; empty: boolean }
}

const words = (err: unknown, fallback: string) =>
  isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : fallback

export default function PosLayoutPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.menu)
  const { role, superadmin } = useAdminUser()
  const [view, setView] = useState<View | null>(null)
  const [branch, setBranch] = useState('')
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set())
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const load = useCallback(async (which: string) => {
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const params = which ? `?branch=${encodeURIComponent(which)}` : ''
      const data = await unwrap(await authedFetch(`/api/admin/pos-layout${params}`, 'GET')) as unknown as View
      setView(data)
      setBranch(data.branch)
      setHiddenCats(new Set(data.categories.filter(c => c.hidden).map(c => c.id)))
      setHiddenItems(new Set(data.items.filter(i => i.hidden).map(i => i.id)))
    } catch (err) {
      setError(words(err, 'The layout could not be read.'))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { startLoad(() => load('')) }, [load])

  async function save() {
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const res = await unwrap(await authedFetch('/api/admin/pos-layout', 'PUT', {
        branch, hiddenCategories: [...hiddenCats], hiddenItems: [...hiddenItems],
      })) as { changed: number; counts: View['counts'] }
      setSaved(res.changed === 0
        ? 'Nothing had changed.'
        : `Saved. ${branch}'s till shows ${res.counts.itemsShown} of ${res.counts.itemsTotal} dishes.`)
      await load(branch)
    } catch (err) {
      setError(words(err, 'The layout was not saved.'))
    } finally {
      setSaving(false)
    }
  }

  if (checking) return <Loading />
  const isAdmin = role === 'admin' || superadmin

  // Worked out here rather than read from the server, so the counts follow the
  // ticks as they are made instead of only after a save.
  const shownItems = view
    ? view.items.filter(i => !hiddenItems.has(i.id) && !hiddenCats.has(i.categoryId)).length
    : 0
  const dirty = view
    ? view.categories.some(c => c.hidden !== hiddenCats.has(c.id)) || view.items.some(i => i.hidden !== hiddenItems.has(i.id))
    : false

  function toggleCat(id: string) {
    setHiddenCats(now => { const next = new Set(now); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function toggleItem(id: string) {
    setHiddenItems(now => { const next = new Set(now); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  return (
    <Page width="wide">
      <PageHeader
        title="POS Layout"
        lead="What each branch's till shows. Hide a whole category — the desserts at a branch that does not do them — or single dishes. This changes what staff SEE on the till: it does not take anything off the website, and it never touches a check that is already open."
      />

      {view && view.branches.length > 1 && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <label htmlFor="branch" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.7)' }}>Branch</label>
          <select id="branch" value={branch} disabled={busy || saving}
            onChange={e => { void load(e.target.value) }}
            style={{ ...inputStyle, maxWidth: '240px' }}>
            {view.branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          {dirty && <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--brand-secondary)' }}>Unsaved changes — switching branch loses them.</span>}
        </div>
      )}

      {error && <ErrorLine>{error}</ErrorLine>}
      {busy && !view && <Loading label="Reading the menu…" />}

      {view && (
        <>
          <Panel title={`${branch}'s till shows ${shownItems} of ${view.items.length} dishes`}>
            {shownItems === 0 && view.items.length > 0 && (
              <ErrorLine>Everything is hidden. This branch&apos;s till would have an empty menu.</ErrorLine>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Button icon={faFloppyDisk} tone="primary" disabled={!dirty || saving} onClick={() => { void save() }}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button icon={faRotateLeft} disabled={!dirty || saving} onClick={() => {
                setHiddenCats(new Set(view.categories.filter(c => c.hidden).map(c => c.id)))
                setHiddenItems(new Set(view.items.filter(i => i.hidden).map(i => i.id)))
                setSaved('')
              }}>Undo my changes</Button>
              <Button icon={faEye} disabled={saving || (hiddenCats.size === 0 && hiddenItems.size === 0)} onClick={() => { setHiddenCats(new Set()); setHiddenItems(new Set()) }}>
                Show everything
              </Button>
            </div>
            {saved && <p style={{ marginTop: '0.7rem', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--teal)' }}>{saved}</p>}
            {!isAdmin && <p style={{ marginTop: '0.7rem', fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>You can set this for the branches you are assigned to.</p>}
          </Panel>

          {view.categories.length === 0 ? (
            <EmptyState title="There is no menu yet.">Add categories and dishes on Manage Menu first.</EmptyState>
          ) : view.categories.map(cat => {
            const catHidden = hiddenCats.has(cat.id)
            const mine = view.items.filter(i => i.categoryId === cat.id)
            return (
              <Panel key={cat.id} title={`${cat.name}${cat.section ? ` · ${cat.section}` : ''}`}>
                <label style={{
                  display: 'flex', gap: '0.6rem', alignItems: 'center', cursor: 'pointer', marginBottom: '0.8rem',
                  fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color: catHidden ? 'var(--red)' : 'var(--offwhite)',
                }}>
                  <input type="checkbox" checked={catHidden} onChange={() => toggleCat(cat.id)} />
                  <span>{catHidden ? 'Hidden from this till — the whole category' : 'Hide this whole category from this till'}</span>
                </label>

                {mine.length === 0 ? (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.45)' }}>Nothing in this category.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.4rem', opacity: catHidden ? 0.45 : 1 }}>
                    {mine.map(item => {
                      const hidden = catHidden || hiddenItems.has(item.id)
                      return (
                        <label key={item.id}
                          title={catHidden ? 'The whole category is hidden' : undefined}
                          style={{
                            display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.5rem 0.6rem', borderRadius: '8px',
                            fontFamily: 'var(--font-inter)', fontSize: '0.85rem', cursor: catHidden ? 'not-allowed' : 'pointer',
                            border: `1px solid ${hidden ? 'color-mix(in srgb, var(--red) 35%, transparent)' : 'rgba(var(--overlay-rgb),0.12)'}`,
                            background: hidden ? 'color-mix(in srgb, var(--red) 8%, transparent)' : 'rgba(var(--overlay-rgb),0.04)',
                          }}>
                          <input type="checkbox" checked={!hidden} disabled={catHidden} onChange={() => toggleItem(item.id)} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ color: hidden ? 'rgba(var(--offwhite-rgb),0.55)' : 'var(--offwhite)' }}>{item.name}</span>
                            {!item.available && (
                              <span style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.45)' }}>
                                Not available — off the menu everywhere already
                              </span>
                            )}
                          </span>
                          <span aria-hidden style={{ color: hidden ? 'var(--red)' : 'var(--teal)', fontSize: '0.8rem' }}>
                            {hidden ? '✕' : '✓'}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </Panel>
            )
          })}
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.6 }}>
            A tick means the till shows it. Anything added to the menu later is shown by default, so a new dish never goes missing without somebody deciding it should.
          </p>
        </>
      )}
    </Page>
  )
}
