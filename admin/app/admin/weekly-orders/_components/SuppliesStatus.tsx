'use client'

import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { emptyStock, PRIMARY_BRANCH } from '@big-cms/shared/branches'
import { SUPPLY_BRANCHES, type Supply } from './supplies'

export function SuppliesStatus() {
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    getDocs(collection(db, 'supplies')).then(snap => {
      setSupplies(snap.docs.map(d => {
        const data = d.data() as Omit<Supply, 'id'>
        const qty = typeof data.quantity === 'number'
          ? { ...emptyStock(), [PRIMARY_BRANCH]: data.quantity }
          : (data.quantity ?? emptyStock())
        return { ...data, id: d.id, quantity: qty }
      }).sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  // A supply is low if any branch is below threshold
  const alerts = supplies.filter(s => SUPPLY_BRANCHES.some(b => (s.quantity[b] ?? 0) < s.threshold))
  const ok     = supplies.filter(s => SUPPLY_BRANCHES.every(b => (s.quantity[b] ?? 0) >= s.threshold))

  if (supplies.length === 0) return null

  return (
    <div style={{ marginBottom: '2rem', border: `1px solid ${alerts.length > 0 ? 'rgba(var(--red-rgb),0.3)' : 'rgba(var(--teal-rgb),0.2)'}`, borderRadius: '6px', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: alerts.length > 0 ? 'rgba(var(--red-rgb),0.06)' : 'rgba(var(--teal-rgb),0.06)', border: 'none', color: 'var(--offwhite)', cursor: 'pointer', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ color: alerts.length > 0 ? 'var(--red)' : 'var(--teal)' }}>●</span>
          Supplies Status
          {alerts.length > 0
            ? <span style={{ background: 'var(--red)', color: '#fff', borderRadius: '3px', padding: '0.05rem 0.4rem', fontSize: '0.65rem', fontWeight: 700 }}>{alerts.length} low</span>
            : <span style={{ color: 'var(--teal)', fontSize: '0.7rem' }}>All OK</span>
          }
        </span>
        <span style={{ opacity: 0.4, fontSize: '0.9rem' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0.75rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', borderTop: '1px solid rgba(var(--overlay-rgb),0.06)' }}>
          {alerts.map(s => {
            const lowBranches = SUPPLY_BRANCHES.filter(b => (s.quantity[b] ?? 0) < s.threshold)
            const out = lowBranches.some(b => (s.quantity[b] ?? 0) <= 0)
            return (
              <div key={s.id} style={{ background: out ? 'rgba(var(--red-rgb),0.12)' : 'rgba(var(--brand-secondary-rgb),0.1)', border: `1px solid ${out ? 'rgba(var(--red-rgb),0.35)' : 'rgba(var(--brand-secondary-rgb),0.3)'}`, borderRadius: '4px', padding: '0.3rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--offwhite)' }}>{s.name}</span>
                <span style={{ fontSize: '0.65rem', color: out ? 'var(--red)' : 'var(--brand-secondary)', fontWeight: 600 }}>
                  {lowBranches.map(b => `${b} ${s.quantity[b]}`).join(' · ')}
                </span>
                <span style={{ fontSize: '0.62rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>/ min {s.threshold}</span>
              </div>
            )
          })}
          {ok.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              {ok.map(s => (
                <span key={s.id} style={{ background: 'rgba(var(--teal-rgb),0.07)', border: '1px solid rgba(var(--teal-rgb),0.18)', borderRadius: '4px', padding: '0.3rem 0.6rem', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>
                  {s.name}
                </span>
              ))}
            </div>
          )}
          <a href="/admin/supplies" style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none', alignSelf: 'center', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>
            Manage supplies →
          </a>
        </div>
      )}
    </div>
  )
}
