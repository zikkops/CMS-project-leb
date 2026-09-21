'use client'

// Serving hours and happy-hour prices on a menu item (UPGRADE.md T5.12).
// Only draws and edits; the rules are shared/src/timePricing.ts, checked again
// by /api/admin/menu, and the till charges what the server works out when a
// line is added, in the café's zone.

import type { Dispatch, SetStateAction } from 'react'
import { MAX_PRICE_RULES, describeWindow, type PriceRule, type TimeWindow } from '@big-cms/shared/timePricing'
import { inputStyle, labelStyle, smallButton, type ItemForm } from './menuTypes'

const DAYS = [
  { d: 1, label: 'Mon' }, { d: 2, label: 'Tue' }, { d: 3, label: 'Wed' }, { d: 4, label: 'Thu' },
  { d: 5, label: 'Fri' }, { d: 6, label: 'Sat' }, { d: 0, label: 'Sun' },
]
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

function WindowFields({ value, onChange, colour }: { value: TimeWindow; onChange: (w: TimeWindow) => void; colour: string }) {
  const toggle = (d: number) => onChange({ ...value, days: value.days.includes(d) ? value.days.filter(x => x !== d) : [...value.days, d].sort() })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div role="group" aria-label="Days" style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        {DAYS.map(({ d, label }) => {
          const on = value.days.includes(d)
          return (
            <button key={d} type="button" aria-pressed={on} onClick={() => toggle(d)} style={{
              ...smallButton, padding: '0.35rem 0.55rem',
              borderColor: on ? colour : 'rgba(var(--overlay-rgb),0.15)',
              color: on ? colour : 'rgba(var(--offwhite-rgb),0.5)',
              background: on ? `color-mix(in srgb, ${colour} 14%, transparent)` : 'transparent',
            }}>{label}</button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input type="time" aria-label="From" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })} style={{ ...inputStyle, width: 'auto' }} />
        <span style={{ color: 'rgba(var(--offwhite-rgb),0.5)' }}>to</span>
        <input type="time" aria-label="To" value={value.to} onChange={e => onChange({ ...value, to: e.target.value })} style={{ ...inputStyle, width: 'auto' }} />
      </div>
    </div>
  )
}

export default function TimeRulesEditor({ form, setForm, colour }: {
  form: ItemForm
  setForm: Dispatch<SetStateAction<ItemForm>>
  colour: string
}) {
  const rules = form.priceRules
  const setRule = (i: number, r: PriceRule) => setForm(f => ({ ...f, priceRules: f.priceRules.map((x, j) => (j === i ? r : x)) }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <div>
        <label style={{ ...labelStyle, marginBottom: '0.6rem' }}>Served</label>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: form.hours ? '0.6rem' : 0 }}>
          <button type="button" aria-pressed={!form.hours} onClick={() => setForm(f => ({ ...f, hours: null }))}
            style={{ ...smallButton, color: !form.hours ? colour : undefined, borderColor: !form.hours ? colour : undefined }}>All day</button>
          <button type="button" aria-pressed={Boolean(form.hours)} onClick={() => setForm(f => ({ ...f, hours: f.hours ?? { days: EVERY_DAY, from: '07:00', to: '11:30' } }))}
            style={{ ...smallButton, color: form.hours ? colour : undefined, borderColor: form.hours ? colour : undefined }}>Only at certain times</button>
        </div>
        {form.hours && (
          <>
            <WindowFields value={form.hours} onChange={w => setForm(f => ({ ...f, hours: w }))} colour={colour} />
            <p style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.5)', marginTop: '0.4rem', lineHeight: 1.5 }}>
              The till greys it out at other times. An end before the start runs past midnight.
            </p>
          </>
        )}
      </div>

      <div>
        <label style={{ ...labelStyle, marginBottom: '0.6rem' }}>Price by time (happy hour)</label>
        {rules.map((r, i) => (
          <div key={i} style={{ border: '1px solid rgba(var(--overlay-rgb),0.1)', borderRadius: '4px', padding: '0.7rem', marginBottom: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="text" aria-label="Name" value={r.label} maxLength={30} placeholder="Happy hour"
                onChange={e => setRule(i, { ...r, label: e.target.value })} style={{ ...inputStyle, flex: 2 }} />
              <input type="number" aria-label="Price" min={0} step={0.01} value={r.price}
                onChange={e => setRule(i, { ...r, price: Number(e.target.value) })} style={{ ...inputStyle, flex: 1 }} />
            </div>
            <WindowFields value={r} onChange={w => setRule(i, { ...r, ...w })} colour={colour} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>{r.days.length ? describeWindow(r) : 'Choose the days'}</span>
              <button type="button" onClick={() => setForm(f => ({ ...f, priceRules: f.priceRules.filter((_, j) => j !== i) }))} style={smallButton}>Remove</button>
            </div>
          </div>
        ))}
        {rules.length < MAX_PRICE_RULES && (
          <button type="button" style={smallButton}
            onClick={() => setForm(f => ({ ...f, priceRules: [...f.priceRules, { label: 'Happy hour', price: f.price, days: [1, 2, 3, 4, 5], from: '17:00', to: '19:00' }] }))}>
            + Add a price by time
          </button>
        )}
        <p style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.5)', marginTop: '0.4rem', lineHeight: 1.5 }}>
          The first matching rule sets the price when an item is added at the till, judged on the café&apos;s clock. Options still add their own price.
        </p>
      </div>
    </div>
  )
}
