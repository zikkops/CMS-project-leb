'use client'

// Food safety history — which days were signed, by whom, and what went wrong.
//
// Managers and admins (foodSafetyReview). A day nobody signed is listed as
// MISSED rather than simply absent: an empty row is what an inspector notices,
// and a list that skips it reads as a clean record.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { addDays } from '@big-cms/shared/foodSafety'
import { startLoad } from '@big-cms/shared/startLoad'

interface DaySummary {
  date: string
  recorded: boolean
  signed: boolean
  signedByEmail: string | null
  signedLate: boolean
  breaches: number
  notDone: number
  amendments: number
  problems: string
}

const inp: React.CSSProperties = {
  background: 'rgba(var(--overlay-rgb),0.05)', border: '1px solid rgba(var(--overlay-rgb),0.12)',
  color: 'var(--offwhite)', borderRadius: '4px', padding: '0.5rem 0.7rem',
  fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-inter)',
}
const small: React.CSSProperties = { fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.45)' }

export default function FoodSafetyHistoryPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.foodSafetyReview)
  const isMobile = useIsMobile()
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [days, setDays] = useState<DaySummary[]>([])
  const [missed, setMissed] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (checking) return
    authedFetch('/api/admin/food-safety?view=settings', 'GET').then(unwrap)
      .then(r => {
        const list = (r.branches as string[]) ?? []
        setBranches(list)
        setBranch(list[0] ?? '')
        const today = String(r.today)
        setTo(today)
        setFrom(addDays(today, -13))
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load.'))
  }, [checking])

  useEffect(() => {
    if (!branch || !from || !to) return
    let alive = true
    startLoad(() => {
      if (!alive) return
      setLoading(true); setError('')
      return authedFetch(`/api/admin/food-safety?view=history&branch=${encodeURIComponent(branch)}&from=${from}&to=${to}`, 'GET').then(unwrap)
        .then(r => { if (alive) { setDays(((r.days as DaySummary[]) ?? []).slice().reverse()); setMissed((r.missed as string[]) ?? []) } })
        .catch(e => { if (alive) { setError(e instanceof Error ? e.message : 'Could not load the history.'); setDays([]); setMissed([]) } })
        .finally(() => { if (alive) setLoading(false) })
    })
    return () => { alive = false }
  }, [branch, from, to])

  if (checking) return null
  const missedSet = new Set(missed)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '2rem 1rem 4rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <Link href="/admin/food-safety" style={{ ...small, textDecoration: 'none', display: 'block', marginBottom: '0.5rem' }}>← Today&apos;s diary</Link>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '1.2rem' }}>Food Safety History</h1>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
          <select style={{ ...inp, background: '#1c1c1c' }} value={branch} onChange={e => setBranch(e.target.value)}>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <input type="date" style={inp} value={from} max={to} onChange={e => setFrom(e.target.value)} />
          <input type="date" style={inp} value={to} onChange={e => setTo(e.target.value)} />
        </div>

        {error && <p style={{ ...small, color: 'var(--red)', marginBottom: '1rem' }}>{error}</p>}
        {!error && !loading && missed.length > 0 && (
          <p style={{ ...small, color: 'var(--red)', marginBottom: '1rem' }}>
            {missed.length} {missed.length === 1 ? 'day was' : 'days were'} not signed in this range.
          </p>
        )}
        {loading && <p style={small}>Loading…</p>}

        {!loading && days.map(d => {
          const status = d.signed ? (d.signedLate ? 'Signed late' : 'Signed') : missedSet.has(d.date) ? 'Missed' : d.recorded ? 'Not signed yet' : 'Nothing recorded'
          const color = d.signed ? (d.signedLate ? 'var(--brand-secondary)' : 'var(--teal)') : missedSet.has(d.date) ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.5)'
          return (
            <Link key={d.date} href={`/admin/food-safety?branch=${encodeURIComponent(branch)}&date=${d.date}`} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '7rem 8rem 1fr auto', gap: '0.3rem 1rem', alignItems: 'center',
                padding: '0.7rem 0.9rem', borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)',
              }}>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>{d.date}</span>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color }}>{status}</span>
                <span style={{ ...small, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.signedByEmail ? `${d.signedByEmail}` : ''}{d.problems ? `${d.signedByEmail ? ' · ' : ''}${d.problems}` : ''}
                </span>
                <span style={{ ...small, whiteSpace: 'nowrap' }}>
                  {d.breaches > 0 && <span style={{ color: 'var(--red)' }}>{d.breaches} out of range · </span>}
                  {d.notDone > 0 && <span style={{ color: 'var(--brand-secondary)' }}>{d.notDone} not done · </span>}
                  {d.amendments > 0 && <span>{d.amendments} amended</span>}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
