'use client'

// Which station prints where.
//
// Admin rather than superadmin, unlike the two pages next door. Those decide
// what customers are charged and which modules exist; this decides whether
// paper comes out of a machine, and the person who plugs a printer in should
// not have to find a superadmin to tell the app about it.
//
// ── The shape follows the room, not the data ───────────────────────────────
// The stored document is branches → stations → printer. So is this page: one
// panel per branch, one row per station inside it. Somebody configuring this
// is standing in a café looking at machines, and the question they are
// answering is "what does the kitchen here print to" — not "what is the value
// of branches.Main.Kitchen.transport".

import { useEffect, useState } from 'react'
import { useRequireRole, type Role } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { BRANCHES } from '@big-cms/shared/branches'
import { STATIONS, type Station } from '@big-cms/shared/checks'
import { RECEIPT_WIDTHS } from '@big-cms/shared/receipt'
import {
  PRINTING_DEFAULTS, PRINTER_DEFAULT, PRINT_TRANSPORTS, TRANSPORT_LABEL,
  printerBlockedReason,
  type PrintingSettings, type StationPrinter, type PrintTransport,
} from '@big-cms/shared/printing'

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

// Module scope, not inside the page. A component declared in a render body
// remounts on every state change — CONTRIBUTING.md gotcha #2 — which here
// would mean every field losing focus on every keystroke.
const label: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-inter)',
  fontSize: '0.62rem',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(var(--offwhite-rgb),0.35)',
  marginBottom: '0.35rem',
}

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: '42px',
  padding: '0.5rem 0.7rem',
  backgroundColor: 'rgba(var(--offwhite-rgb),0.04)',
  border: '1px solid rgba(var(--offwhite-rgb),0.12)',
  borderRadius: '3px',
  color: 'var(--offwhite)',
  fontFamily: 'var(--font-inter)',
  fontSize: '0.85rem',
}

function StationRow({
  station, printer, onChange,
}: {
  branch: string
  station: Station
  printer: StationPrinter
  onChange: (next: StationPrinter) => void
}) {
  const set = <K extends keyof StationPrinter>(key: K, value: StationPrinter[K]) =>
    onChange({ ...printer, [key]: value })

  const blocked = printerBlockedReason(printer)

  return (
    <div style={{
      padding: '1.1rem 0',
      borderTop: '1px solid rgba(var(--offwhite-rgb),0.07)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '1rem', marginBottom: printer.transport === 'none' ? 0 : '0.9rem',
      }}>
        <span style={{
          fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color: 'var(--offwhite)',
        }}>{station}</span>

        <label style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
          fontFamily: 'var(--font-inter)', fontSize: '0.75rem',
          color: printer.enabled ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.35)',
        }}>
          <input
            type="checkbox"
            checked={printer.enabled}
            onChange={e => set('enabled', e.target.checked)}
            style={{ width: '18px', height: '18px', accentColor: 'var(--teal)' }}
          />
          Prints
        </label>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '0.8rem',
      }}>
        <div>
          <span style={label}>How it connects</span>
          <select
            value={printer.transport}
            onChange={e => set('transport', e.target.value as PrintTransport)}
            style={field}
          >
            {PRINT_TRANSPORTS.map(t => (
              <option key={t} value={t}>{TRANSPORT_LABEL[t]}</option>
            ))}
          </select>
        </div>

        {printer.transport !== 'none' && (
          <>
            <div>
              <span style={label}>Roll</span>
              <select
                value={printer.width}
                onChange={e => set('width', Number(e.target.value) === RECEIPT_WIDTHS.wide
                  ? RECEIPT_WIDTHS.wide : RECEIPT_WIDTHS.narrow)}
                style={field}
              >
                <option value={RECEIPT_WIDTHS.narrow}>58mm · {RECEIPT_WIDTHS.narrow} columns</option>
                <option value={RECEIPT_WIDTHS.wide}>80mm · {RECEIPT_WIDTHS.wide} columns</option>
              </select>
            </div>

            <div>
              <span style={label}>Copies</span>
              <input
                type="number" min={1} max={5}
                value={printer.copies}
                onChange={e => set('copies', Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                style={field}
              />
            </div>
          </>
        )}

        {/* Only ePOS needs an address. CloudPRNT is given OUR url instead, and
            the browser transport prints to whatever this device is attached
            to — asking for an address in either case invites somebody to fill
            one in and wonder why it changes nothing. */}
        {(printer.transport === 'epos' || printer.transport === 'network') && (
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={label}>Printer address on the café network</span>
            <input
              type="text"
              value={printer.address}
              onChange={e => set('address', e.target.value)}
              placeholder={printer.transport === 'network' ? '192.168.1.50  or  192.168.1.50:9100' : 'http://192.168.1.50/cgi-bin/epos/service.cgi'}
              style={{ ...field, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '0.78rem' }}
            />
            {printer.transport === 'network' && (
              <p style={{ marginTop: '0.45rem', fontFamily: 'var(--font-inter)', fontSize: '0.72rem', lineHeight: 1.6, color: 'rgba(var(--offwhite-rgb),0.45)' }}>
                The counter PC prints to it itself, with no screen needing Print here and no internet, but only
                at a branch with a café hub. Most thermal printers take ESC/POS on port 9100; print a test page from
                the counter PC&apos;s Café hub page.
              </p>
            )}
          </div>
        )}
      </div>

      {blocked && printer.transport !== 'none' && (
        <p style={{
          marginTop: '0.7rem',
          fontFamily: 'var(--font-inter)', fontSize: '0.72rem', lineHeight: 1.6,
          color: 'var(--brand-secondary)',
        }}>{blocked}</p>
      )}
    </div>
  )
}

export default function PrintersPage() {
  const { checking } = useRequireRole(['admin'] as Role[])
  const isMobile = useIsMobile()

  const [settings, setSettings] = useState<PrintingSettings>(PRINTING_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const data = await unwrap(await authedFetch('/api/admin/printing', 'GET')) as
          { settings: PrintingSettings }
        if (live) setSettings(data.settings)
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : 'Could not load the printer settings.')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [])

  const printerAt = (branch: string, station: Station): StationPrinter =>
    settings.branches[branch]?.[station] ?? PRINTER_DEFAULT

  function setPrinter(branch: string, station: Station, next: StationPrinter) {
    setSaved(false)
    setSettings(s => ({
      ...s,
      branches: {
        ...s.branches,
        [branch]: {
          ...(STATIONS.reduce((acc, st) => {
            acc[st] = s.branches[branch]?.[st] ?? PRINTER_DEFAULT
            return acc
          }, {} as Record<Station, StationPrinter>)),
          [station]: next,
        },
      },
    }))
  }

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await unwrap(await authedFetch('/api/admin/printing', 'PUT', settings))
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2.5rem 5rem',
    }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>

        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em',
          textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.6rem',
        }}>Settings</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.2rem',
          color: 'var(--offwhite)', marginBottom: '0.6rem',
        }}>Printers</h1>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          color: 'rgba(var(--offwhite-rgb),0.4)', lineHeight: 1.7,
          marginBottom: '2.5rem', maxWidth: '56ch',
        }}>
          A station that does not print still works — the kitchen screen is the
          order, and paper is a copy of it. Nothing here can stop an order
          reaching the pass.
        </p>

        {loading && (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        )}

        {!loading && BRANCHES.map(branch => (
          <section key={branch} style={{
            marginBottom: '2rem',
            padding: '1.4rem 1.5rem 0.6rem',
            backgroundColor: 'rgba(var(--offwhite-rgb),0.02)',
            border: '1px solid rgba(var(--offwhite-rgb),0.07)',
            borderRadius: '4px',
          }}>
            <h2 style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.2em',
              textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)',
              marginBottom: '0.2rem',
            }}>{branch}</h2>

            {STATIONS.map(station => (
              <StationRow
                key={station}
                branch={branch}
                station={station}
                printer={printerAt(branch, station)}
                onChange={next => setPrinter(branch, station, next)}
              />
            ))}
          </section>
        ))}

        {!loading && (
          <section style={{
            marginBottom: '2rem', padding: '1.4rem 1.5rem',
            backgroundColor: 'rgba(var(--offwhite-rgb),0.02)',
            border: '1px solid rgba(var(--offwhite-rgb),0.07)',
            borderRadius: '4px',
          }}>
            <h2 style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.2em',
              textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)',
              marginBottom: '1rem',
            }}>The customer receipt</h2>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.7rem', cursor: 'pointer',
              fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
              color: 'rgba(var(--offwhite-rgb),0.75)', lineHeight: 1.6,
            }}>
              <input
                type="checkbox"
                checked={settings.receiptOnClose}
                onChange={e => { setSaved(false); setSettings(s => ({ ...s, receiptOnClose: e.target.checked })) }}
                style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: 'var(--teal)' }}
              />
              <span>
                Print a receipt when a check is closed.
                <span style={{ display: 'block', color: 'rgba(var(--offwhite-rgb),0.4)', fontSize: '0.78rem', marginTop: '0.3rem' }}>
                  Leave this off while the old till is still taking payment. Two
                  receipts for one table is worse than none.
                </span>
              </span>
            </label>

            {settings.receiptOnClose && (
              <div style={{ marginTop: '1rem', maxWidth: '220px' }}>
                <span style={label}>Printed at</span>
                <select
                  value={settings.receiptStation}
                  onChange={e => setSettings(s => ({ ...s, receiptStation: e.target.value as Station }))}
                  style={field}
                >
                  {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
          </section>
        )}

        {error && (
          <p style={{
            color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
            marginBottom: '1rem', lineHeight: 1.6,
          }}>{error}</p>
        )}

        {!loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                minHeight: '46px', padding: '0 1.8rem',
                backgroundColor: saving ? 'rgba(var(--teal-rgb),0.35)' : 'var(--teal)',
                color: '#fff', border: 'none', borderRadius: '4px',
                fontFamily: 'var(--font-inter)', fontSize: '0.78rem', fontWeight: 600,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                cursor: saving ? 'default' : 'pointer',
              }}
            >{saving ? 'Saving…' : 'Save'}</button>

            {saved && (
              <span style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--teal)',
              }}>Saved</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
