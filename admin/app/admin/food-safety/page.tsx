'use client'

// Food safety diary — one page per branch per café day.
//
// Staff answer the opening and closing checks and log a reading for every
// fridge, freezer and hot-holding unit; a manager signs the day as supervised
// (owner's decisions, 14 Sep 2026). Every judgement shown here — what a reading
// means, what stops the signature — comes from shared/src/foodSafety.ts, and
// the server decides it again on save. The page only shows it sooner.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import {
  judgeReading, UNIT_KINDS,
  type ChecklistItem, type FoodSafetyLimits, type UnitKind, type DayAccess,
} from '@big-cms/shared/foodSafety'
import { BRAND } from '@big-cms/shared/brand'
import { startLoad } from '@big-cms/shared/startLoad'

interface Unit { id: string; name: string; kind: UnitKind; active: boolean }
interface StoredAnswer { key: string; done: boolean; note?: string; by?: string; at?: string }
interface StoredReading { unitId: string; tempC?: number; note?: string; outOfUse?: boolean; by?: string; at?: string }
interface DayDoc {
  opening?: StoredAnswer[]
  closing?: StoredAnswer[]
  readings?: StoredReading[]
  problems?: string
  signedAt?: number | null
  signedByEmail?: string
  amendments?: { by: string; at: string; reason: string }[]
  /** Corrections to an unsigned day: what each changed entry said before. */
  edits?: { by: string; at: string; before: { opening?: StoredAnswer[]; closing?: StoredAnswer[]; readings?: StoredReading[]; problems?: string } }[]
}

/** When a correction was made, on the café's clock rather than this device's. */
function cafeTime(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleString('en-GB', { timeZone: BRAND.locale.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : iso
}
interface DayView {
  branch: string
  date: string
  today: string
  access: DayAccess
  reviewer: boolean
  day: DayDoc | null
  units: Unit[]
  limits: FoodSafetyLimits
  openingChecks: ChecklistItem[]
  closingChecks: ChecklistItem[]
  blockers: string[]
  signedLate: boolean
  branches: string[]
}

interface AnswerDraft { done: boolean | null; note: string }
interface ReadingDraft { tempC: string; note: string; outOfUse: boolean }

const inp: React.CSSProperties = {
  background: 'rgba(var(--overlay-rgb),0.05)', border: '1px solid rgba(var(--overlay-rgb),0.12)',
  color: 'var(--offwhite)', borderRadius: '4px', padding: '0.5rem 0.7rem',
  fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-inter)',
}
const card: React.CSSProperties = {
  background: 'rgba(var(--overlay-rgb),0.03)', border: '1px solid rgba(var(--overlay-rgb),0.1)',
  borderRadius: '6px', padding: '1rem 1.1rem', marginBottom: '1rem',
}
const heading: React.CSSProperties = {
  fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.4)', marginBottom: '0.7rem',
}
const small: React.CSSProperties = { fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.4)' }

const VERDICT_COLOR = { ok: 'var(--teal)', warn: 'var(--brand-secondary)', breach: 'var(--red)' } as const
const KIND_LABEL = new Map(UNIT_KINDS.map(k => [k.kind, k.label]))

/** A typed temperature, or undefined for nothing typed, or NaN for something that is not a number. */
function parseTemp(s: string): number | undefined {
  const t = s.trim().replace(',', '.')
  return t === '' ? undefined : Number(t)
}

// Module scope, not inside the page: a component declared in another's render
// body remounts on every keystroke and drops focus (CONTRIBUTING gotcha #2).
function Checklist({ title, items, answers, onChange, disabled }: {
  title: string
  items: ChecklistItem[]
  answers: Record<string, AnswerDraft>
  onChange: (key: string, next: AnswerDraft) => void
  disabled: boolean
}) {
  return (
    <div style={card}>
      <p style={heading}>{title}</p>
      {items.map(item => {
        const a = answers[item.key] ?? { done: null, note: '' }
        const pick = (done: boolean) => onChange(item.key, { ...a, done })
        const button = (active: boolean, color: string): React.CSSProperties => ({
          ...inp, cursor: disabled ? 'default' : 'pointer', padding: '0.35rem 0.7rem', fontSize: '0.75rem',
          background: active ? color : 'transparent', color: active ? '#fff' : 'rgba(var(--offwhite-rgb),0.6)',
          border: `1px solid ${active ? color : 'rgba(var(--overlay-rgb),0.15)'}`,
        })
        return (
          <div key={item.key} style={{ padding: '0.55rem 0', borderTop: '1px solid rgba(var(--overlay-rgb),0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)', flex: '1 1 16rem' }}>{item.label}</span>
              <span style={{ display: 'flex', gap: '0.4rem' }}>
                <button type="button" disabled={disabled} onClick={() => pick(true)} style={button(a.done === true, 'var(--teal)')}>Done</button>
                <button type="button" disabled={disabled} onClick={() => pick(false)} style={button(a.done === false, 'var(--red)')}>Not done</button>
              </span>
            </div>
            {a.done === false && (
              <input
                style={{ ...inp, width: '100%', marginTop: '0.45rem' }} disabled={disabled}
                placeholder="What happened, and what was done about it?"
                value={a.note} onChange={e => onChange(item.key, { ...a, note: e.target.value })}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ReadingRow({ unit, draft, limits, onChange, disabled, stampedBy }: {
  unit: Unit
  draft: ReadingDraft
  limits: FoodSafetyLimits
  onChange: (next: ReadingDraft) => void
  disabled: boolean
  stampedBy?: string
}) {
  const temp = parseTemp(draft.tempC)
  const verdict = temp === undefined || draft.outOfUse ? null : judgeReading(unit.kind, temp, limits)
  const unreadable = temp !== undefined && !draft.outOfUse && verdict === null
  const needsNote = draft.outOfUse || verdict?.status === 'breach'
  return (
    <div style={{ padding: '0.6rem 0', borderTop: '1px solid rgba(var(--overlay-rgb),0.05)' }}>
      <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: '1 1 12rem' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>{unit.name}</span>
          <span style={small}> · {KIND_LABEL.get(unit.kind)}{unit.active ? '' : ' · retired'}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            style={{ ...inp, width: '6rem', textAlign: 'right' }} inputMode="decimal" disabled={disabled || draft.outOfUse}
            placeholder="°C" value={draft.outOfUse ? '' : draft.tempC}
            onChange={e => onChange({ ...draft, tempC: e.target.value })}
          />
          <span style={small}>°C</span>
        </span>
        <label style={{ ...small, display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: disabled ? 'default' : 'pointer' }}>
          <input type="checkbox" disabled={disabled} checked={draft.outOfUse}
            onChange={e => onChange({ ...draft, outOfUse: e.target.checked })} />
          Out of use
        </label>
      </div>
      {verdict && (
        <p style={{ ...small, color: VERDICT_COLOR[verdict.status], marginTop: '0.3rem' }}>{verdict.message}</p>
      )}
      {unreadable && (
        <p style={{ ...small, color: 'var(--red)', marginTop: '0.3rem' }}>That is not a temperature this unit could read.</p>
      )}
      {(needsNote || draft.note) && (
        <input
          style={{ ...inp, width: '100%', marginTop: '0.45rem' }} disabled={disabled}
          placeholder={draft.outOfUse ? 'Why is it out of use?' : 'What was done about it? (moved stock, adjusted, called the engineer…)'}
          value={draft.note} onChange={e => onChange({ ...draft, note: e.target.value })}
        />
      )}
      {stampedBy && <p style={{ ...small, marginTop: '0.25rem' }}>Recorded by {stampedBy}</p>}
    </div>
  )
}

function FoodSafetyDiaryInner() {
  const params = useSearchParams()
  const { checking } = useRequireRole(SECTION_ACCESS.foodSafety)
  const isMobile = useIsMobile()

  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [date, setDate] = useState('')
  const [view, setView] = useState<DayView | null>(null)
  const [loadError, setLoadError] = useState('')

  const [opening, setOpening] = useState<Record<string, AnswerDraft>>({})
  const [closing, setClosing] = useState<Record<string, AnswerDraft>>({})
  const [readings, setReadings] = useState<Record<string, ReadingDraft>>({})
  const [problems, setProblems] = useState('')
  const [amendReason, setAmendReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'' | 'save' | 'sign'>('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  // Which branches, and the café's today — from the server, not the device clock.
  useEffect(() => {
    if (checking) return
    authedFetch('/api/admin/food-safety?view=settings', 'GET').then(unwrap)
      .then(r => {
        const list = (r.branches as string[]) ?? []
        setBranches(list)
        const pb = params.get('branch')
        const pd = params.get('date')
        setBranch(pb && list.includes(pb) ? pb : (list[0] ?? ''))
        setDate(pd && /^\d{4}-\d{2}-\d{2}$/.test(pd) ? pd : String(r.today))
      })
      .catch(e => setLoadError(e instanceof Error ? e.message : 'Could not load food safety settings.'))
  }, [checking, params])

  const load = useCallback(async () => {
    if (!branch || !date) return
    setLoadError('')
    try {
      const r = await unwrap(await authedFetch(`/api/admin/food-safety?view=day&branch=${encodeURIComponent(branch)}&date=${date}`, 'GET'))
      const v = r as unknown as DayView
      setView(v)
      const d = v.day
      const answers = (list: StoredAnswer[] | undefined) =>
        Object.fromEntries((list ?? []).map(a => [a.key, { done: a.done, note: a.note ?? '' }]))
      setOpening(answers(d?.opening))
      setClosing(answers(d?.closing))
      setReadings(Object.fromEntries((d?.readings ?? []).map(x => [x.unitId, {
        tempC: x.tempC === undefined ? '' : String(x.tempC), note: x.note ?? '', outOfUse: Boolean(x.outOfUse),
      }])))
      setProblems(d?.problems ?? '')
      setAmendReason('')
      setDirty(false)
    } catch (e) {
      setView(null)
      setLoadError(e instanceof Error ? e.message : 'Could not load the diary.')
    }
  }, [branch, date])

  useEffect(() => { startLoad(load) }, [load])

  const units = useMemo(() => {
    if (!view) return []
    const recorded = new Set((view.day?.readings ?? []).map(r => r.unitId))
    // Active units, plus any retired one that has a reading on this day.
    return view.units.filter(u => u.active || recorded.has(u.id))
  }, [view])

  const stampOf = useMemo(() => new Map((view?.day?.readings ?? []).map(r => [r.unitId, r.by])), [view])

  if (checking) return null

  const signed = Boolean(view?.day?.signedAt)
  const disabled = !view || view.access === 'read' || busy !== ''
  const edit = <T,>(setter: React.Dispatch<React.SetStateAction<Record<string, T>>>) =>
    (key: string, next: T) => { setter(prev => ({ ...prev, [key]: next })); setDirty(true); setMessage(null) }

  async function save() {
    if (!view) return
    const payloadReadings = []
    for (const unit of units) {
      const r = readings[unit.id]
      if (!r) continue
      const tempC = r.outOfUse ? undefined : parseTemp(r.tempC)
      if (tempC !== undefined && !Number.isFinite(tempC)) {
        setMessage({ tone: 'error', text: `${unit.name}: "${r.tempC}" is not a number.` })
        return
      }
      if (tempC === undefined && !r.outOfUse) continue
      payloadReadings.push({ unitId: unit.id, ...(tempC !== undefined ? { tempC } : {}), note: r.note, outOfUse: r.outOfUse })
    }
    const answersOf = (items: ChecklistItem[], drafts: Record<string, AnswerDraft>) => items
      .filter(i => drafts[i.key]?.done === true || drafts[i.key]?.done === false)
      .map(i => ({ key: i.key, done: drafts[i.key].done as boolean, note: drafts[i.key].note }))

    setBusy('save'); setMessage(null)
    try {
      await unwrap(await authedFetch('/api/admin/food-safety', 'PUT', {
        action: 'day', branch, date,
        opening: answersOf(view.openingChecks, opening),
        closing: answersOf(view.closingChecks, closing),
        readings: payloadReadings,
        problems,
        amendReason,
      }))
      await load()
      setMessage({ tone: 'ok', text: signed ? 'Amendment saved. What the day said before is kept with it.' : 'Saved.' })
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not save.' })
    } finally {
      setBusy('')
    }
  }

  async function sign() {
    setBusy('sign'); setMessage(null)
    try {
      await unwrap(await authedFetch('/api/admin/food-safety', 'PUT', { action: 'sign', branch, date }))
      await load()
      setMessage({ tone: 'ok', text: 'Signed as supervised.' })
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not sign.' })
      await load()
    } finally {
      setBusy('')
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '2rem 1rem 4rem' }}>
      <div style={{ maxWidth: '820px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>Food Safety Diary</h1>
            <p style={small}>Opening and closing checks, temperatures, and a manager&apos;s signature — every day.</p>
          </div>
          {view?.reviewer && (
            <span style={{ display: 'flex', gap: '1rem' }}>
              <Link href="/admin/food-safety/history" style={{ ...small, color: 'var(--teal)' }}>History</Link>
              <Link href="/admin/food-safety/settings" style={{ ...small, color: 'var(--teal)' }}>Units &amp; settings</Link>
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
          <select style={{ ...inp, background: '#1c1c1c' }} value={branch} onChange={e => setBranch(e.target.value)} disabled={branches.length <= 1}>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <input type="date" style={inp} value={date} max={view?.today} onChange={e => setDate(e.target.value)} />
        </div>

        {loadError && <p style={{ ...small, color: 'var(--red)', marginBottom: '1rem' }}>{loadError}</p>}

        {view && (
          <>
            <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: signed ? 'var(--teal)' : 'var(--offwhite)' }}>
                {signed
                  ? `Signed as supervised by ${view.day?.signedByEmail}${view.signedLate ? ' — signed late' : ''}`
                  : view.day ? 'Not signed yet' : 'Nothing recorded yet'}
              </span>
              <span style={small}>
                {view.access === 'read' && !signed ? 'This day can no longer be changed.' : ''}
                {view.access === 'read' && signed ? 'Signed days are amended by a manager, with a reason.' : ''}
                {(view.day?.amendments?.length ?? 0) > 0 ? ` Amended ${view.day?.amendments?.length} time(s).` : ''}
              </span>
            </div>

            {(view.day?.edits?.length ?? 0) > 0 && (
              <details style={card}>
                <summary style={{ ...small, cursor: 'pointer' }}>
                  Corrected after it was first entered — {view.day?.edits?.length} time(s). What it said before is kept.
                </summary>
                {view.day?.edits?.map((e, i) => (
                  <div key={i} style={{ marginTop: '0.6rem' }}>
                    <p style={{ ...small, color: 'var(--offwhite)' }}>{e.by} · {cafeTime(e.at)}</p>
                    {[...(e.before.opening ?? []), ...(e.before.closing ?? [])].map((a, j) => (
                      <p key={j} style={small}>
                        {[...view.openingChecks, ...view.closingChecks].find(c => c.key === a.key)?.label ?? 'A check no longer on the list'}:
                        {' '}was {a.done ? 'done' : 'not done'}{a.note && <> — “{a.note}”</>}{a.by && <> ({a.by})</>}
                      </p>
                    ))}
                    {(e.before.readings ?? []).map((r, j) => (
                      <p key={j} style={small}>
                        {units.find(u => u.id === r.unitId)?.name ?? 'A unit'}:
                        {' '}was {r.outOfUse ? 'out of use' : <>{r.tempC} °C</>}{r.note && <> — “{r.note}”</>}{r.by && <> ({r.by})</>}
                      </p>
                    ))}
                    {e.before.problems && <p style={small}>Problems and actions: was “{e.before.problems}”</p>}
                  </div>
                ))}
              </details>
            )}

            <Checklist title="Opening checks" items={view.openingChecks} answers={opening} onChange={edit(setOpening)} disabled={disabled} />

            <div style={card}>
              <p style={heading}>Temperatures</p>
              {units.length === 0 ? (
                <p style={small}>
                  No fridges, freezers or hot-holding units are set up for {branch}.
                  {view.reviewer ? ' Add them under Units & settings.' : ' Ask a manager to add them.'}
                </p>
              ) : units.map(unit => (
                <ReadingRow
                  key={unit.id} unit={unit} limits={view.limits} disabled={disabled}
                  draft={readings[unit.id] ?? { tempC: '', note: '', outOfUse: false }}
                  onChange={next => { setReadings(prev => ({ ...prev, [unit.id]: next })); setDirty(true); setMessage(null) }}
                  stampedBy={stampOf.get(unit.id)}
                />
              ))}
            </div>

            <Checklist title="Closing checks" items={view.closingChecks} answers={closing} onChange={edit(setClosing)} disabled={disabled} />

            <div style={card}>
              <p style={heading}>Any problems or changes today — and what was done</p>
              <textarea
                style={{ ...inp, width: '100%', minHeight: '5rem', resize: 'vertical' }} disabled={disabled}
                value={problems} onChange={e => { setProblems(e.target.value); setDirty(true); setMessage(null) }}
                placeholder="A delivery rejected, a unit repaired, a complaint, a new supplier…"
              />
            </div>

            {view.access === 'amend' && (
              <div style={card}>
                <p style={heading}>Reason for amending a signed day</p>
                <input style={{ ...inp, width: '100%' }} value={amendReason} disabled={busy !== ''}
                  onChange={e => setAmendReason(e.target.value)} placeholder="Required — the day keeps what it said before" />
              </div>
            )}

            {message && (
              <p style={{ ...small, whiteSpace: 'pre-line', color: message.tone === 'ok' ? 'var(--teal)' : 'var(--red)', marginBottom: '0.8rem' }}>
                {message.text}
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {view.access !== 'read' && (
                <button type="button" onClick={save} disabled={busy !== '' || (view.access === 'amend' && !amendReason.trim())}
                  style={{ ...inp, cursor: 'pointer', background: 'var(--teal)', color: '#fff', border: 'none', fontWeight: 600 }}>
                  {busy === 'save' ? 'Saving…' : view.access === 'amend' ? 'Save amendment' : 'Save'}
                </button>
              )}
              {view.reviewer && !signed && view.day && view.access !== 'read' && (
                <button type="button" onClick={sign} disabled={busy !== '' || dirty || view.blockers.length > 0}
                  style={{ ...inp, cursor: 'pointer', background: 'transparent', color: 'var(--offwhite)', border: '1px solid var(--teal)' }}>
                  {busy === 'sign' ? 'Signing…' : 'Sign as supervised'}
                </button>
              )}
              {view.reviewer && !signed && dirty && <span style={small}>Save before signing.</span>}
            </div>

            {view.reviewer && !signed && view.day && view.blockers.length > 0 && !dirty && (
              <div style={{ ...card, marginTop: '1rem' }}>
                <p style={heading}>Before this day can be signed</p>
                {view.blockers.map(b => <p key={b} style={{ ...small, color: 'var(--brand-secondary)', marginBottom: '0.25rem' }}>{b}</p>)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function FoodSafetyDiaryPage() {
  return (
    <Suspense fallback={null}>
      <FoodSafetyDiaryInner />
    </Suspense>
  )
}
