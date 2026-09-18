'use client'

// The dashboard's "Today" strip (UPGRADE.md T2.17): what a manager opening
// admin in the morning actually wants to know, before the list of pages.
//
// Every tile reads something that already exists — a route or the read its
// own page makes — and nothing here works a figure out that a page does not:
//   - Sales so far        /api/admin/exports/sales for today (endOfDay)
//   - End of day          the cash-up day's reports, as the form reads them (endOfDay)
//   - Held hub sales      /api/admin/hub-held (endOfDay), shown only when some wait
//   - New error reports   errorReports first seen in the last 24 hours (admin)
//   - Food safety         days nobody signed this past week, per branch (foodSafetyReview)
//
// A tile the person may not open, or whose module is off, is not drawn at all.
// One that could not be read says so rather than showing a reassuring zero.
// Low stock joins when par levels exist (T3.10).
//
// Module-scope components (CONTRIBUTING.md gotcha #2).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faSackDollar, faCashRegister, faServer, faBug, faShieldHalved, type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { db } from '@big-cms/shared/firebase'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { hasSectionAccess, type Role } from '@big-cms/shared/roles'
import { isFeatureOn, type FeatureFlags } from '@big-cms/shared/features'
import { BRAND, formatMoney } from '@big-cms/shared/brand'
import { todayYmd, cashUpDay } from '@big-cms/shared/dates'
import { getEndOfDayReport } from '@big-cms/shared/endOfDay'
import { timestampMs } from '@big-cms/shared/timestamps'
import { startLoad } from '@big-cms/shared/startLoad'

type Tone = 'good' | 'attention' | 'neutral' | 'unknown'

interface Tile {
  key: string
  label: string
  value: string
  detail: string
  href: string
  icon: IconDefinition
  tone: Tone
}

const TONE_COLOUR: Record<Tone, string> = {
  good: 'var(--teal)',
  attention: '#F59E0B',
  neutral: 'rgba(var(--offwhite-rgb),0.55)',
  unknown: 'rgba(var(--offwhite-rgb),0.4)',
}

const DAY_MS = 86_400_000
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10)
}

function listed(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export interface TodayViewer {
  role: Role | null
  branchIds: string[]
  sectionGrants: string[]
  sectionRevocations: string[]
}

/** The tiles this person may see, as unread placeholders, in order. */
function tilesFor(viewer: TodayViewer, flags: FeatureFlags): Tile[] {
  const can = (key: keyof typeof SECTION_ACCESS) =>
    hasSectionAccess(viewer.role, SECTION_ACCESS[key], viewer.sectionGrants, key, viewer.sectionRevocations)
  const blank = (t: Omit<Tile, 'value' | 'detail' | 'tone'>): Tile => ({ ...t, value: '…', detail: 'Reading…', tone: 'unknown' })
  const out: Tile[] = []
  if (can('endOfDay') && isFeatureOn('endOfDay', flags)) {
    out.push(blank({ key: 'sales', label: 'Sales so far', href: '/admin/exports', icon: faSackDollar }))
    out.push(blank({ key: 'eod', label: 'End of day', href: '/admin/end-of-day', icon: faCashRegister }))
    out.push(blank({ key: 'held', label: 'Held hub sales', href: '/admin/settings/hubs/held', icon: faServer }))
  }
  if (can('foodSafetyReview') && isFeatureOn('foodSafety', flags)) {
    out.push(blank({ key: 'food', label: 'Food safety', href: '/admin/food-safety/history', icon: faShieldHalved }))
  }
  if (viewer.role === 'admin') {
    out.push(blank({ key: 'errors', label: 'New error reports', href: '/admin/errors', icon: faBug }))
  }
  return out
}

function ownBranches(viewer: TodayViewer): string[] {
  return viewer.role === 'admin' || viewer.branchIds.length === 0 ? BRAND.branches : viewer.branchIds
}

/** Reads one tile. Throws when it cannot be read; returns null to leave it out. */
async function readTile(key: string, viewer: TodayViewer): Promise<Pick<Tile, 'value' | 'detail' | 'tone'> | null> {
  const tz = BRAND.locale.timezone
  const today = todayYmd(tz)
  const branches = ownBranches(viewer)

  if (key === 'sales') {
    const res = await unwrap(await authedFetch(`/api/admin/exports/sales?from=${today}&to=${today}`, 'GET')) as {
      days?: { net: number; checks: number; refunds: number }[]
    }
    const days = res.days ?? []
    const net = days.reduce((s, d) => s + (d.net ?? 0), 0)
    const checks = days.reduce((s, d) => s + (d.checks ?? 0), 0)
    const refunds = days.reduce((s, d) => s + (d.refunds ?? 0), 0)
    return {
      value: formatMoney(net),
      detail: `${checks} closed check${checks === 1 ? '' : 's'} on the till today${refunds > 0 ? `, ${formatMoney(refunds)} refunded` : ''}`,
      tone: 'neutral',
    }
  }

  if (key === 'eod') {
    // The cash-up day, as the form opens on: before 10:00 it is still last night's.
    const day = cashUpDay(tz)
    const reports = await Promise.all(branches.map(b => getEndOfDayReport(b, day)))
    const missing = branches.filter((_, i) => !reports[i])
    const when = day === today ? 'today' : 'last night'
    if (missing.length === 0) return { value: 'Submitted', detail: `Every branch has cashed up ${when}.`, tone: 'good' }
    return {
      value: branches.length === 1 ? 'Not yet' : `${branches.length - missing.length} of ${branches.length}`,
      detail: `${listed(missing)} ${missing.length === 1 ? 'has' : 'have'} not cashed up ${when}.`,
      tone: 'attention',
    }
  }

  if (key === 'held') {
    const res = await unwrap(await authedFetch('/api/admin/hub-held', 'GET')) as { items?: unknown[] }
    const n = res.items?.length ?? 0
    if (n === 0) return null
    return { value: String(n), detail: `Sent up by a café hub while its branch traded online, waiting for a decision.`, tone: 'attention' }
  }

  if (key === 'food') {
    // Yesterday back a week; today is still being run and is never "missed".
    const from = daysBefore(today, 7)
    const to = daysBefore(today, 1)
    const results = await Promise.all(branches.map(async b => {
      const res = await unwrap(await authedFetch(`/api/admin/food-safety?view=history&branch=${encodeURIComponent(b)}&from=${from}&to=${to}`, 'GET')) as { missed?: string[] }
      return { branch: b, missed: res.missed?.length ?? 0 }
    }))
    const total = results.reduce((s, r) => s + r.missed, 0)
    if (total === 0) return { value: 'All signed', detail: 'Every day this past week was signed by a manager.', tone: 'good' }
    const where = results.filter(r => r.missed > 0).map(r => `${r.branch} ${r.missed}`)
    return { value: `${total} unsigned`, detail: `Days this past week nobody signed: ${where.join(', ')}.`, tone: 'attention' }
  }

  if (key === 'errors') {
    // The same read /admin/errors makes, narrowed to faults first seen in the
    // last day. Ordered by lastSeenAt, a single-field index Firestore keeps.
    const snap = await getDocs(query(collection(db, 'errorReports'), orderBy('lastSeenAt', 'desc'), limit(200)))
    const since = Date.now() - DAY_MS
    const fresh = snap.docs.filter(d => timestampMs(d.data().firstSeenAt, 0) >= since)
    const seen = snap.docs.filter(d => timestampMs(d.data().lastSeenAt, 0) >= since).length
    return {
      value: String(fresh.length),
      detail: fresh.length === 0
        ? `Nothing new in the last 24 hours${seen > 0 ? `; ${seen} known fault${seen === 1 ? '' : 's'} recurred` : ''}.`
        : `First seen in the last 24 hours${seen > fresh.length ? `, and ${seen - fresh.length} known fault${seen - fresh.length === 1 ? '' : 's'} recurred` : ''}.`,
      tone: fresh.length > 0 ? 'attention' : 'good',
    }
  }
  return null
}

function TileCard({ tile, compact }: { tile: Tile; compact: boolean }) {
  const colour = TONE_COLOUR[tile.tone]
  return (
    <Link href={tile.href} style={{
      display: 'flex', flexDirection: 'column', gap: '0.35rem', textDecoration: 'none', minWidth: 0,
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)',
      borderTop: `3px solid ${colour}`, borderRadius: '10px', padding: compact ? '0.8rem 0.9rem' : '0.95rem 1.05rem',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.72rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(var(--offwhite-rgb),0.55)' }}>
        <FontAwesomeIcon icon={tile.icon} style={{ color: colour }} />
        {tile.label}
      </span>
      <span style={{ fontSize: compact ? '1.25rem' : '1.45rem', fontWeight: 700, color: tile.tone === 'unknown' ? colour : 'var(--offwhite)', lineHeight: 1.2 }}>
        {tile.value}
      </span>
      <span style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.4 }}>{tile.detail}</span>
    </Link>
  )
}

export function TodayStrip({ viewer, flags, flagsLoading, isMobile }: {
  viewer: TodayViewer
  flags: FeatureFlags
  flagsLoading: boolean
  isMobile: boolean
}) {
  // What was read, by tile key; null = leave the tile out.
  const [read, setRead] = useState<Record<string, Pick<Tile, 'value' | 'detail' | 'tone'> | null>>({})
  const tiles = flagsLoading ? [] : tilesFor(viewer, flags)
  const loadKey = `${viewer.role}|${viewer.branchIds.join(',')}|${tiles.map(t => t.key).join(',')}`

  useEffect(() => {
    if (!loadKey.split('|')[2]) return
    let cancelled = false
    const keys = loadKey.split('|')[2].split(',')
    startLoad(() => Promise.all(keys.map(async key => {
      let answer: Pick<Tile, 'value' | 'detail' | 'tone'> | null
      try {
        answer = await readTile(key, viewer)
      } catch (err) {
        // A tile that cannot be read says so; a zero here would be a guess.
        console.error(`[admin/today] could not read ${key}:`, err)
        answer = { value: '—', detail: 'Could not be read just now. Open the page for the full picture.', tone: 'unknown' }
      }
      if (!cancelled) setRead(prev => ({ ...prev, [key]: answer }))
    })))
    return () => { cancelled = true }
    // viewer is folded into loadKey; its object identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey])

  const shown = tiles
    .filter(t => read[t.key] !== null)
    .map(t => (read[t.key] ? { ...t, ...read[t.key] } : t))
  if (shown.length === 0) return null

  return (
    <section aria-label="Today" style={{ marginBottom: '2rem' }}>
      <p style={{ fontSize: '0.78rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)', fontWeight: 700, marginBottom: '0.8rem' }}>
        Today
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '150px' : '200px'}, 1fr))`, gap: '0.7rem' }}>
        {shown.map(tile => <TileCard key={tile.key} tile={tile} compact={isMobile} />)}
      </div>
    </section>
  )
}
