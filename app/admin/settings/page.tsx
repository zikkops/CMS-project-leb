'use client'

// Business settings — the numbers that change while the business runs.
//
// Superadmin only, and gated by role rather than by a SECTION_ACCESS key on
// purpose: sections are handed out per user as checkboxes in /admin/users, and
// "can change the VAT rate" must not be something somebody ticks by accident
// while granting a barista the stock count. Same reasoning as account
// management — see the note in app/lib/roles.ts.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireRole } from '../../lib/adminAuth'
import { authedFetch, unwrap } from '../../lib/apiClient'
import { useBusinessSettings } from '../../lib/useBusinessSettings'
import { SETTINGS_LIMITS } from '../../lib/businessSettings'
import { BRAND } from '../../lib/brand'
import type { Role } from '../../lib/roles'

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

const labelStyle: React.CSSProperties = {
  display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.66rem',
  letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'rgba(245,242,236,0.35)', marginBottom: '0.4rem',
}

const inp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '4px', padding: '0.65rem 0.8rem', color: 'var(--offwhite)',
  fontFamily: 'var(--font-inter)', fontSize: '0.9rem', outline: 'none',
}

/**
 * One editable rate.
 *
 * Declared at module scope, not inside the page component. A component defined
 * in another component's render body is a new type on every state change, so
 * React unmounts and remounts it — which here would drop focus out of the
 * input on every keystroke. (CONTRIBUTING.md, gotcha #2.)
 */
function RateField({
  label, hint, value, suffix, step, onChange, isMobile,
}: {
  label: string
  hint: string
  value: string
  suffix: string
  step: string
  onChange: (v: string) => void
  isMobile: boolean
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <input
          type="number" min="0" step={step} inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ ...inp, width: isMobile ? '100%' : '200px', textAlign: 'right', fontWeight: 600 }}
        />
        <span style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          color: 'rgba(245,242,236,0.45)', whiteSpace: 'nowrap',
        }}>{suffix}</span>
      </div>
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '0.68rem',
        color: 'rgba(245,242,236,0.3)', marginTop: '0.35rem', lineHeight: 1.6, maxWidth: '46ch',
      }}>{hint}</p>
    </div>
  )
}

export default function BusinessSettingsPage() {
  const { checking, superadmin } = useRequireRole(['admin'] as Role[])
  const isMobile = useIsMobile()
  const { settings, loading } = useBusinessSettings()

  // Percentages are edited as percentages and stored as fractions. The form
  // does the ÷100 so nobody has to reason about 0.11 while reading a tax
  // notice that says 11%.
  const [vat,  setVat]  = useState('')
  const [rate, setRate] = useState('')
  const [tips, setTips] = useState('')

  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const [done,   setDone]   = useState('')

  // Seed the fields once the live values arrive, and again whenever they
  // change underneath — someone else saving in another tab should not leave
  // this form quietly holding stale numbers it would write back on Save.
  useEffect(() => {
    if (loading) return
    setVat(String(+(settings.vatRate * 100).toFixed(4)))
    setRate(String(settings.exchangeRate))
    setTips(String(+(settings.tipsDeductionRate * 100).toFixed(4)))
  }, [loading, settings])

  const dirty =
    Number(vat)  / 100 !== settings.vatRate ||
    Number(rate)        !== settings.exchangeRate ||
    Number(tips) / 100 !== settings.tipsDeductionRate

  async function save() {
    setSaving(true); setErr(''); setDone('')
    try {
      const r = await unwrap(
        await authedFetch('/api/admin/settings', 'PATCH', {
          vatRate:           Number(vat) / 100,
          exchangeRate:      Number(rate),
          tipsDeductionRate: Number(tips) / 100,
        })
      )
      const changed = Number(r.changed ?? 0)
      setDone(changed === 0 ? 'Nothing changed.' : `Saved — ${changed} value${changed === 1 ? '' : 's'} updated.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  if (!superadmin) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <p style={{ color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem', textAlign: 'center', maxWidth: '38ch', lineHeight: 1.7 }}>
          These settings decide what customers are charged and what staff are
          paid, so they are superadmin-only. Ask a superadmin to make the change.
        </p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2.5rem 5rem' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em',
          textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.6rem',
        }}>Superadmin</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.2rem',
          color: 'var(--offwhite)', marginBottom: '0.6rem',
        }}>Business Settings</h1>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.4)',
          lineHeight: 1.7, marginBottom: '2.5rem', maxWidth: '54ch',
        }}>
          These took a redeploy to change. They take effect the moment you save
          now — on new records only. Every delivery and end-of-day report keeps
          the rate it was written with, so nothing already recorded moves.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.9rem', marginBottom: '2.5rem' }}>
          <RateField
            label="VAT rate" suffix="%" step="0.1" value={vat} onChange={setVat} isMobile={isMobile}
            hint={`Applied per line when receiving, to items marked as taxable. Between ${SETTINGS_LIMITS.vatRate.min * 100}% and ${SETTINGS_LIMITS.vatRate.max * 100}%.`}
          />
          <RateField
            label={`Exchange rate`} suffix={`${BRAND.locale.secondaryCurrency} per 1 ${BRAND.locale.currency}`}
            step="1000" value={rate} onChange={setRate} isMobile={isMobile}
            hint="Seeds the end-of-day form and the receiving form. Each record stores the rate actually used, so changing this never re-values an old one."
          />
          <RateField
            label="Tips deduction" suffix="%" step="0.5" value={tips} onChange={setTips} isMobile={isMobile}
            hint="Taken off the tips pool before it is split between staff."
          />
        </div>

        {err && (
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', marginBottom: '1rem' }}>{err}</p>
        )}
        {done && (
          <p style={{ color: 'var(--teal)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', marginBottom: '1rem' }}>{done}</p>
        )}

        <button
          onClick={save}
          disabled={saving || loading || !dirty}
          style={{
            background: dirty ? 'var(--teal)' : 'rgba(255,255,255,0.05)',
            color: dirty ? '#000' : 'rgba(245,242,236,0.3)',
            border: 'none', borderRadius: '4px', padding: '0.75rem 1.75rem',
            fontFamily: 'var(--font-inter)', fontSize: '0.8rem', fontWeight: 700,
            letterSpacing: '0.06em', cursor: saving || !dirty ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >{saving ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}</button>

        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.25)',
          marginTop: '2.5rem', lineHeight: 1.7, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.25rem',
        }}>
          Every change is recorded in the activity log with the old and new
          value and who made it.
        </p>

        <Link href="/admin/settings/features" style={{
          display: 'inline-block', marginTop: '1rem',
          fontFamily: 'var(--font-inter)', fontSize: '0.78rem',
          color: 'var(--teal)', textDecoration: 'none',
        }}>Modules — switch features on and off →</Link>

      </div>
    </div>
  )
}
