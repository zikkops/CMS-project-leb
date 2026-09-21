'use client'

// Colours come from lib/branches so every screen agrees, and so a branch
// outside the original three gets one at all.
import { branchColor } from '@big-cms/shared/branches'
import { inp, labelStyle } from './styles'

// Branch + Department
export function BranchDepartmentPicker({
  isMobile, branchOptions, branch, onBranch, departmentOptions, department, onDepartment,
}: {
  isMobile: boolean
  branchOptions: string[]
  branch: string
  onBranch: (branch: string) => void
  departmentOptions: string[]
  department: string
  onDepartment: (department: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
      <div>
        <label style={labelStyle}>Branch</label>
        {branchOptions.length === 1 ? (
          <div style={{ ...inp, display: 'inline-block', color: branchColor(branch), fontWeight: 600 }}>{branch}</div>
        ) : (
          <select value={branch} onChange={e => onBranch(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
            <option value="">— Select Branch —</option>
            {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </div>
      <div>
        <label style={labelStyle}>Department</label>
        <select value={department} onChange={e => onDepartment(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
          <option value="">— Select Department —</option>
          {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
    </div>
  )
}
