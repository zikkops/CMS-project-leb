'use client'

import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useRequireRole, updateOrderDepts, ROLE_LABELS, ROLE_COLORS, type Role } from '../../../lib/adminAuth'
import { DEPARTMENTS, type Department } from '../../../lib/weeklyOrders'

const DEPT_COLOR: Record<Department, string> = {
  Kitchen:  'var(--teal)',
  Bar:      '#C9962C',
  Cleaning: '#8B7CF6',
}

interface StaffAccount {
  id:         string
  email:      string
  role:       Role
  orderDepts: Department[]
}

export default function WeeklyOrdersAccessPage() {
  const { checking } = useRequireRole(['admin'])
  const [accounts, setAccounts] = useState<StaffAccount[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState<string | null>(null) // uid of account being saved
  const [saved,    setSaved]    = useState<string | null>(null) // uid of last saved

  async function loadAccounts() {
    const snap = await getDocs(query(collection(db, 'users'), where('isStaff', '==', true)))
    const list: StaffAccount[] = snap.docs.map(d => {
      const data = d.data()
      return {
        id:         d.id,
        email:      data.email as string ?? '',
        role:       (data.role as Role) ?? 'social',
        orderDepts: Array.isArray(data.orderDepts) ? data.orderDepts as Department[] : [],
      }
    })
    // Sort: admin first, then manager, then others alphabetically by email
    list.sort((a, b) => {
      const order = ['admin', 'manager', 'social', 'retail']
      const diff = order.indexOf(a.role) - order.indexOf(b.role)
      if (diff !== 0) return diff
      return a.email.localeCompare(b.email)
    })
    setAccounts(list)
    setLoading(false)
  }

  useEffect(() => { if (!checking) loadAccounts() }, [checking])

  async function toggleDept(account: StaffAccount, dept: Department) {
    const next = account.orderDepts.includes(dept)
      ? account.orderDepts.filter(d => d !== dept)
      : [...account.orderDepts, dept]

    setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, orderDepts: next } : a))
    setSaving(account.id)
    try {
      // Sends only orderDepts — a partial save, so toggling a department
      // here can't write back a role this page loaded before someone else
      // changed it. The route validates the names and logs the change.
      await updateOrderDepts(account.id, account.email, next)
      setSaved(account.id)
      setTimeout(() => setSaved(null), 1500)
    } catch {
      // revert on error
      setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, orderDepts: account.orderDepts } : a))
    } finally {
      setSaving(null)
    }
  }

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '3rem', fontFamily: 'var(--font-inter)' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>

        <a href="/admin/weekly-orders" style={{
          fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
          display: 'block', marginBottom: '0.5rem',
        }}>← Weekly Orders</a>

        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)', marginBottom: '0.25rem' }}>
          Department Access
        </h1>
        <p style={{ fontSize: '0.82rem', color: 'rgba(245,242,236,0.35)', marginBottom: '2.5rem' }}>
          Control which order departments each staff member can submit and view.
          Admin and manager accounts always have access to all three.
        </p>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          {DEPARTMENTS.map(d => (
            <div key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: DEPT_COLOR[d] }} />
              <span style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.5)' }}>{d}</span>
            </div>
          ))}
        </div>

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)' }}>Loading staff…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {accounts.map(account => {
              const isPrivileged = account.role === 'admin' || account.role === 'manager'
              const isSavingThis = saving === account.id
              const isSavedThis  = saved === account.id

              return (
                <div key={account.id} style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '4px', padding: '1rem 1.25rem',
                  display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                }}>
                  {/* Role badge */}
                  <span style={{
                    backgroundColor: `${ROLE_COLORS[account.role]}18`,
                    border: `1px solid ${ROLE_COLORS[account.role]}50`,
                    color: ROLE_COLORS[account.role],
                    borderRadius: '2px', padding: '0.2rem 0.6rem',
                    fontSize: '0.68rem', letterSpacing: '0.1em',
                    textTransform: 'uppercase', fontWeight: 600, flexShrink: 0,
                  }}>
                    {ROLE_LABELS[account.role]}
                  </span>

                  {/* Email */}
                  <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--offwhite)', minWidth: '180px' }}>
                    {account.email}
                  </span>

                  {/* Department toggles */}
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    {DEPARTMENTS.map(dept => {
                      const hasAccess = isPrivileged || account.orderDepts.includes(dept)
                      return (
                        <button
                          key={dept}
                          disabled={isPrivileged || isSavingThis}
                          onClick={() => toggleDept(account, dept)}
                          title={isPrivileged ? `${ROLE_LABELS[account.role]}s always have ${dept} access` : `Toggle ${dept} access`}
                          style={{
                            backgroundColor: hasAccess ? `${DEPT_COLOR[dept]}20` : 'transparent',
                            border: `1px solid ${hasAccess ? DEPT_COLOR[dept] : 'rgba(255,255,255,0.1)'}`,
                            color: hasAccess ? DEPT_COLOR[dept] : 'rgba(245,242,236,0.2)',
                            padding: '0.3rem 0.7rem', borderRadius: '2px',
                            fontSize: '0.7rem', letterSpacing: '0.05em',
                            cursor: isPrivileged ? 'default' : (isSavingThis ? 'wait' : 'pointer'),
                            fontFamily: 'var(--font-inter)',
                            opacity: isPrivileged ? 0.6 : 1,
                          }}
                        >
                          {dept}
                        </button>
                      )
                    })}

                    {/* Save indicator */}
                    <span style={{
                      fontSize: '0.68rem', minWidth: '36px', textAlign: 'center',
                      color: isSavedThis ? 'var(--teal)' : 'transparent',
                      transition: 'color 0.2s',
                    }}>
                      {isSavedThis ? '✓ Saved' : isSavingThis ? '…' : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
