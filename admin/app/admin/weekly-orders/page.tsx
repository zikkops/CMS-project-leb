'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import {
  listWeeklyReports, listTemplateItems, listProviders,
  DEPARTMENTS,
  type WeeklyOrderReport, type OrderProvider, type Department,
} from '@big-cms/shared/weeklyOrders'
import { BRANCHES } from '@big-cms/shared/branches'
import { DEPARTMENT_COLOR as DEPT_COLOR } from '@big-cms/shared/departments'
import { SuppliesStatus } from './_components/SuppliesStatus'
import { ReportCard } from './_components/ReportCard'

export default function WeeklyOrdersPage() {
  const { checking, role, orderDepts, user } = useRequireRole(SECTION_ACCESS.weeklyOrders)
  const [reports,      setReports]      = useState<WeeklyOrderReport[]>([])
  const [providers,    setProviders]    = useState<Record<string, OrderProvider>>({})
  const [nameArMap,    setNameArMap]    = useState<Record<string, string>>({})
  const [loading,      setLoading]      = useState(true)
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [deptFilter,   setDeptFilter]   = useState<Department | 'all'>('all')

  const canEdit = role === 'admin' || role === 'manager'

  // Cast string[] from adminAuth to Department[]
  const allowedDepts = useMemo(
    () => DEPARTMENTS.filter(d => (orderDepts as string[]).includes(d)),
    [orderDepts],
  )

  useEffect(() => {
    Promise.all([listWeeklyReports(), listTemplateItems(), listProviders()]).then(
      ([reps, tItems, provs]) => {
        setReports(reps)
        setProviders(Object.fromEntries(provs.map(p => [p.id, p])))
        setNameArMap(Object.fromEntries(
          tItems.filter(i => i.nameAr).map(i => [i.id, i.nameAr!])
        ))
        setLoading(false)
      }
    )
  }, [])

  const visible = useMemo(() => reports.filter(r => {
    // Department access: admin/manager see all; other staff see only their depts
    if (canEdit) {
      // In a specific dept tab, show only reports for that dept (legacy mixed reports
      // only appear in the "all" tab)
      if (deptFilter !== 'all') {
        if (r.department !== deptFilter) return false
      }
    } else {
      // Non-admin/manager: only show reports for their assigned departments
      if (!r.department || !allowedDepts.includes(r.department)) return false
      if (deptFilter !== 'all' && r.department !== deptFilter) return false
    }
    // Branch filter
    if (branchFilter !== 'all' && r.branch !== branchFilter) return false
    return true
  }), [reports, canEdit, allowedDepts, deptFilter, branchFilter])

  if (checking) return null

  // Dept tabs: admin/manager see all 3; other staff see only their depts (skip tabs if only 1)
  const deptTabs: Array<Department | 'all'> = canEdit
    ? ['all', ...DEPARTMENTS]
    : allowedDepts.length > 1 ? ['all', ...allowedDepts] : []

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '3rem' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none',
            marginBottom: '0.5rem', display: 'block', fontFamily: 'var(--font-inter)',
          }}>← Dashboard</a>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)', marginBottom: '0.25rem' }}>
                Weekly Order Reports
              </h1>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
                End-of-week stock and supply orders — copy or WhatsApp directly to your suppliers
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a href="/admin/weekly-orders/submit" style={{
                backgroundColor: 'var(--teal)', color: '#fff', textDecoration: 'none',
                padding: '0.65rem 1.4rem', borderRadius: '2px', fontSize: '0.75rem',
                letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
              }}>+ Submit Report</a>
              {role === 'admin' && (
                <>
                  <a href="/admin/weekly-orders/template" style={{
                    backgroundColor: 'transparent', border: '1px solid rgba(var(--overlay-rgb),0.1)',
                    color: 'rgba(var(--offwhite-rgb),0.5)', textDecoration: 'none',
                    padding: '0.65rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem',
                    letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                  }}>Edit Template</a>
                  <a href="/admin/weekly-orders/access" style={{
                    backgroundColor: 'transparent', border: '1px solid rgba(var(--overlay-rgb),0.1)',
                    color: 'rgba(var(--offwhite-rgb),0.4)', textDecoration: 'none',
                    padding: '0.65rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem',
                    letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                  }}>Dept Access</a>
                </>
              )}
              {canEdit && (
                <a href="/admin/weekly-orders/log" style={{
                  backgroundColor: 'transparent', border: '1px solid rgba(var(--overlay-rgb),0.1)',
                  color: 'rgba(var(--offwhite-rgb),0.4)', textDecoration: 'none',
                  padding: '0.65rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem',
                  letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                }}>View Log</a>
              )}
            </div>
          </div>
        </div>

        {/* Supplies status */}
        <SuppliesStatus />

        {/* Department filter tabs */}
        {deptTabs.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {deptTabs.map(d => {
              const count = d === 'all'
                ? reports.filter(r => {
                    if (branchFilter !== 'all' && r.branch !== branchFilter) return false
                    if (!canEdit && (!r.department || !allowedDepts.includes(r.department))) return false
                    return true
                  }).length
                : reports.filter(r => r.department === d && (branchFilter === 'all' || r.branch === branchFilter)).length
              const color = d === 'all' ? 'rgba(var(--offwhite-rgb),0.5)' : DEPT_COLOR[d]
              const active = deptFilter === d
              return (
                <button key={d} onClick={() => setDeptFilter(d)} style={{
                  backgroundColor: active ? (d === 'all' ? 'rgba(var(--overlay-rgb),0.08)' : `color-mix(in srgb, ${color} 9%, transparent)`) : 'transparent',
                  border: `1px solid ${active ? (d === 'all' ? 'rgba(var(--overlay-rgb),0.2)' : color) : 'rgba(var(--overlay-rgb),0.08)'}`,
                  color: active ? (d === 'all' ? 'var(--offwhite)' : color) : 'rgba(var(--offwhite-rgb),0.35)',
                  padding: '0.4rem 0.9rem', borderRadius: '2px', fontSize: '0.7rem',
                  letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
                  fontFamily: 'var(--font-inter)', display: 'flex', alignItems: 'center', gap: '0.35rem',
                }}>
                  {d !== 'all' && (
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: active ? color : 'rgba(var(--overlay-rgb),0.2)', flexShrink: 0 }} />
                  )}
                  {d === 'all' ? `All (${count})` : `${d} (${count})`}
                </button>
              )
            })}
          </div>
        )}

        {/* Branch filter */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {(['all', ...BRANCHES] as const).map(b => (
            <button key={b} onClick={() => setBranchFilter(b)} style={{
              backgroundColor: branchFilter === b ? 'rgba(var(--overlay-rgb),0.08)' : 'transparent',
              border: `1px solid ${branchFilter === b ? 'rgba(var(--overlay-rgb),0.2)' : 'rgba(var(--overlay-rgb),0.08)'}`,
              color: branchFilter === b ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.4)',
              padding: '0.4rem 0.9rem', borderRadius: '2px', fontSize: '0.7rem',
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>
              {b === 'all' ? `All Branches (${reports.length})` : `${b} (${reports.filter(r => r.branch === b).length})`}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(var(--overlay-rgb),0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(var(--offwhite-rgb),0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            {deptFilter !== 'all'
              ? `No ${deptFilter} reports${branchFilter !== 'all' ? ` for ${branchFilter}` : ''} yet.`
              : branchFilter !== 'all'
                ? `No reports for ${branchFilter} yet.`
                : 'No reports submitted yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {visible.map(r => (
              <ReportCard
                key={r.id}
                report={r}
                providers={providers}
                nameArMap={nameArMap}
                canEdit={canEdit}
                staffUid={user?.uid ?? ''}
                staffEmail={user?.email ?? ''}
                onDeleted={id => setReports(prev => prev.filter(rr => rr.id !== id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
