'use client'

// The café hub's own page — POS software, stage 4.
//
// Only on a hub: whether it is paired with the cloud, when it last sent its
// trading up and took the menu down, how many receipt numbers it has left,
// and, while it is not paired, where to type the code an admin gets from
// Settings → Café Hubs.
//
// No sign-in, on purpose. A hub that is not paired has no staff records, and
// the admin's code is itself the authority. Once paired, the page only reports:
// the route refuses a second pairing.

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { BRAND } from '@big-cms/shared/brand'
import { startLoad } from '@big-cms/shared/startLoad'
import { ErrorNote, Chip, PosButton } from '../../lib/posUi'
import { faPrint } from '@fortawesome/free-solid-svg-icons'

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

interface HubStatus {
  appVersion?: string | null
  tradingOnline: boolean
  paired: boolean
  revoked: boolean
  branch: string | null
  name: string | null
  pairedAt: number | null
  cloudConfigured: boolean
  lastPullAt: number | null
  lastChanged: number
  lastError: string | null
  receiptsLeft: number
  receiptError: string | null
  lastPushAt: number | null
  pushError: string | null
  movesWaiting: number
  lan: { port: number; fingerprint: string; addresses: string[]; links: string[]; publicNetwork?: string[] | null } | null
}

const field: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '4px', padding: '0.9rem 1rem', color: 'var(--offwhite)',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '1.4rem', letterSpacing: '0.12em',
  outline: 'none', width: '100%', boxSizing: 'border-box', textTransform: 'uppercase', textAlign: 'center',
}

const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: '1rem',
  padding: '0.7rem 0', borderTop: '1px solid rgba(255,255,255,0.08)',
  fontSize: '0.9rem',
}

function when(ms: number | null): string {
  if (!ms) return 'not yet'
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: BRAND.locale.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

interface PrintingStatus {
  printers: { station: string; address: string; ready: boolean }[]
  /** The latest tickets for a network printer, to print one again (UPGRADE.md T3.6). Absent from an older hub. */
  recentTickets?: { id: string; station: string; tableNumber: number; round: number; status: string; sentAt: number; reprints: number }[]
  printedToday: number
  waiting: number
  failures: { kind: string; station: string; reason: string; at: number }[]
}

/**
 * Network printers the counter PC prints to itself (S28): which are ready, what
 * failed today, and a test page for whoever is setting one up. Shown only on
 * the counter PC: the route refuses anywhere else.
 */
function HubPrinters() {
  const [printing, setPrinting] = useState<PrintingStatus | null>(null)
  const [note, setNote] = useState('')
  const [testing, setTesting] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/hub/printing', { cache: 'no-store' })
      if (res.ok) setPrinting(await res.json() as PrintingStatus)
    } catch { /* this PC's own hub; the next look says more */ }
  }

  useEffect(() => {
    startLoad(load)
    const poll = setInterval(() => { void load() }, 15_000)
    return () => clearInterval(poll)
  }, [])

  async function reprint(ticketId: string, label: string) {
    setTesting(ticketId)
    setNote('')
    try {
      const res = await fetch('/api/hub/printing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reprint', ticketId }) })
      const data = await res.json().catch(() => ({})) as { error?: string }
      setNote(res.ok ? `${label} is printing again, marked as a reprint.` : (data.error ?? 'It did not print again.'))
      void load()
    } catch {
      setNote('It did not print again.')
    } finally {
      setTesting(null)
    }
  }

  async function test(station: string) {
    setTesting(station)
    setNote('')
    try {
      const res = await fetch('/api/hub/printing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station }) })
      const data = await res.json().catch(() => ({})) as { printed?: boolean; reason?: string | null; error?: string }
      setNote(res.ok && data.printed ? `A test page went to the ${station} printer.` : (data.reason ?? data.error ?? 'The test page did not print.'))
    } catch {
      setNote('The test page did not print.')
    } finally {
      setTesting(null)
    }
  }

  if (!printing || printing.printers.length === 0) return null
  return (
    <div style={{ ...row, flexDirection: 'column', gap: '0.6rem' }}>
      <span style={{ opacity: 0.55 }}>Printers on the café network · {printing.printedToday} printed today{printing.waiting > 0 ? ` · ${printing.waiting} waiting` : ''}</span>
      {printing.printers.map(p => (
        <div key={p.station} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem' }}>
          <span style={{ fontSize: '0.85rem' }}>
            {p.station} <span style={{ opacity: 0.5, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '0.75rem' }}>{p.address || 'no address'}</span>
            {!p.ready && <span style={{ color: 'var(--red)', fontSize: '0.75rem' }}> · switched off or no address</span>}
          </span>
          {p.ready && (
            <PosButton icon={faPrint} label={testing === p.station ? 'Printing…' : 'Test page'} tone="neutral" size="sm"
              disabled={testing !== null} onClick={() => { void test(p.station) }} />
          )}
        </div>
      ))}
      {(printing.recentTickets ?? []).length > 0 && (
        <>
          <span style={{ opacity: 0.55, marginTop: '0.4rem' }}>Recent tickets · print one again</span>
          {(printing.recentTickets ?? []).map(t => {
            const label = `Table ${t.tableNumber}${t.round > 1 ? `, round ${t.round}` : ''}, ${t.station}`
            return (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem' }}>
                <span style={{ fontSize: '0.85rem' }}>
                  {label}
                  <span style={{ opacity: 0.5, fontSize: '0.75rem' }}> · {when(t.sentAt)}{t.reprints > 0 ? ` · printed again ${t.reprints}×` : ''}</span>
                </span>
                <PosButton icon={faPrint} label={testing === t.id ? 'Printing…' : 'Print again'} tone="neutral" size="sm"
                  disabled={testing !== null} onClick={() => { void reprint(t.id, label) }} />
              </div>
            )
          })}
        </>
      )}
      {note && <span style={{ fontSize: '0.8rem', opacity: 0.8, lineHeight: 1.6 }}>{note}</span>}
      {printing.failures.map((f, i) => (
        <span key={i} style={{ color: 'var(--red)', fontSize: '0.78rem', lineHeight: 1.6 }}>
          {f.station} {f.kind} did not print ({when(f.at)}): {f.reason}
        </span>
      ))}
    </div>
  )
}

export default function HubPage() {
  const isMobile = useIsMobile()
  const [status, setStatus] = useState<HubStatus | null>(null)
  const [notHub, setNotHub] = useState(false)
  // A hub that has not answered in 20 s is said to be slow, not left at "Looking…" (UPGRADE.md T1.11).
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 20_000)
    return () => clearTimeout(t)
  }, [])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const res = await fetch('/api/hub/pairing', { cache: 'no-store' })
      if (res.status === 404) { setNotHub(true); return }
      const data = await res.json() as HubStatus & { error?: string }
      if (res.ok) setStatus(data)
    } catch {
      // The hub is this PC; if it does not answer, the next look will say more.
    }
  }

  useEffect(() => {
    startLoad(load)
    const poll = setInterval(() => { void load() }, 10_000)
    return () => clearInterval(poll)
  }, [])

  // The QR a phone scans to pair with this hub: where it is on the wifi, and
  // the one certificate to trust there (S11).
  // The real network is listed first (lanAddresses()); a PC on two real
  // networks lets the manager pick which one's QR to show (UPGRADE.md T1.23).
  const [linkIndex, setLinkIndex] = useState(0)
  const links = status?.lan?.links ?? []
  const link = links[Math.min(linkIndex, links.length - 1)] ?? null
  // Drawn for one link; a QR drawn for another link is never shown.
  const [drawn, setDrawn] = useState<{ link: string; img: string | null } | null>(null)
  const qr = link && drawn?.link === link ? drawn.img : null
  useEffect(() => {
    if (!link) return
    let live = true
    QRCode.toDataURL(link, { margin: 1, width: 240 })
      .then(img => { if (live) setDrawn({ link, img }) })
      .catch(() => { if (live) setDrawn({ link, img: null }) })
    return () => { live = false }
  }, [link])

  async function pair(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/hub/pairing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({})) as HubStatus & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'The hub was not paired.')
      setStatus(data)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The hub was not paired.')
    } finally {
      setBusy(false)
    }
  }

  const needsPairing = status && (!status.paired || status.revoked)

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)', color: 'var(--offwhite)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: isMobile ? '1.5rem 1.25rem' : '2rem', fontFamily: 'var(--font-inter)',
    }}>
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <p style={{ fontSize: '0.6rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.4rem', textAlign: 'center' }}>{BRAND.name}</p>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.7rem', marginBottom: '1.6rem', textAlign: 'center' }}>Café hub</h1>

        {notHub && (
          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)', lineHeight: 1.7 }}>
            This page is for a café hub. This POS runs online, so there is nothing to pair.
          </p>
        )}

        {!notHub && !status && (slow
          ? <ErrorNote tone="warn" message="The hub is not answering yet. It may still be starting: the first start takes up to 30 seconds. If this stays, restart the BIG CMS POS app." />
          : <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>Looking…</p>)}

        {status && needsPairing && (
          <form onSubmit={pair} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <p style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.7, fontSize: '0.9rem' }}>
              {status.revoked
                ? 'An admin unpaired this hub. It keeps what it had, but takes nothing new until it is paired again.'
                : 'This hub is not paired with the cloud yet, so it has no menu or staff of its own.'}
              {' '}An admin gets a code from <strong>Settings → Café Hubs</strong> in the admin panel. It works once, for fifteen minutes.
            </p>
            <input
              value={code} onChange={e => setCode(e.target.value)}
              placeholder="ABCDE-FGH23" aria-label="Pairing code"
              autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              style={field}
            />
            {!status.cloudConfigured && (
              <p style={{ color: 'var(--red)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                This hub does not know where the cloud is, so it cannot pair. Start it from the Windows app.
              </p>
            )}
            {error && <p style={{ color: 'var(--red)', fontSize: '0.82rem', lineHeight: 1.6 }}>{error}</p>}
            <button
              type="submit" disabled={busy || !code.trim()}
              style={{
                minHeight: '56px', backgroundColor: busy || !code.trim() ? 'rgba(var(--teal-rgb),0.35)' : 'var(--teal)',
                color: '#fff', border: 'none', borderRadius: '4px', fontSize: '0.85rem', letterSpacing: '0.14em',
                textTransform: 'uppercase', fontFamily: 'var(--font-inter)', cursor: busy ? 'default' : 'pointer',
              }}
            >{busy ? 'Pairing…' : 'Pair this hub'}</button>
          </form>
        )}

        {status && !needsPairing && (
          <div>
            {status.tradingOnline && (
              <p role="status" style={{
                padding: '0.9rem 1rem', marginBottom: '1rem', borderRadius: '8px', lineHeight: 1.6, fontSize: '0.88rem',
                border: '2px solid rgba(var(--brand-secondary-rgb),0.55)', background: 'rgba(var(--brand-secondary-rgb),0.14)',
              }}>
                <strong style={{ color: 'var(--brand-secondary)' }}>{status.branch} is trading on the online till.</strong>{' '}
                An admin switched it over while this PC was out of action, so this till takes no orders,
                payments or drawer changes. What it sent up waits for a manager. An admin hands the branch
                back from Settings → Café Hubs.
              </p>
            )}
            <div style={row}><span style={{ opacity: 0.55 }}>Branch</span><span>{status.branch}</span></div>
            <div style={row}><span style={{ opacity: 0.55 }}>This PC</span><span>{status.name || '—'}</span></div>
            <div style={row}><span style={{ opacity: 0.55 }}>Paired</span><span>{when(status.pairedAt)}</span></div>
            <div style={row}><span style={{ opacity: 0.55 }}>Last sent its trading up</span><span>{when(status.lastPushAt)}</span></div>
            <div style={row}>
              <span style={{ opacity: 0.55 }}>Stock movements waiting</span>
              <span>{status.movesWaiting}</span>
            </div>
            <div style={row}>
              <span style={{ opacity: 0.55 }}>Last took the menu</span>
              <span>{when(status.lastPullAt)}{status.lastPullAt && status.lastChanged > 0 ? ` · ${status.lastChanged} changed` : ''}</span>
            </div>
            <div style={row}>
              <span style={{ opacity: 0.55 }}>Receipt numbers left</span>
              <span style={{ color: status.receiptsLeft === 0 ? 'var(--red)' : undefined }}>{status.receiptsLeft}</span>
            </div>
            {status.lan && (
              <div style={{ ...row, flexDirection: 'column', gap: '0.6rem' }}>
                <span style={{ opacity: 0.55 }}>Phones on the café wifi</span>
                {status.lan.addresses.length === 0 ? (
                  <span style={{ fontSize: '0.82rem', lineHeight: 1.6 }}>
                    This PC is not on a local network that phones can reach.
                  </span>
                ) : (
                  <>
                    {status.lan.addresses.length > 1 && (
                      <div role="group" aria-label="Which network the phones are on" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {status.lan.addresses.map((address, i) => (
                          <Chip key={address} size="sm" label={address.slice('https://'.length)} active={i === Math.min(linkIndex, links.length - 1)} onClick={() => setLinkIndex(i)} />
                        ))}
                      </div>
                    )}
                    {(status.lan.publicNetwork ?? []).length > 0 && (
                      // Windows' firewall blocks phones on a network it calls
                      // Public, even after "Allow" (UPGRADE.md T2.19).
                      <ErrorNote tone="warn"
                        message={`Windows treats the network at ${(status.lan.publicNetwork ?? []).map(a => a.slice('https://'.length).replace(/:\d+$/, '')).join(' and ')} as Public, so it blocks phones.`}
                        details={'On this PC: Settings → Network & internet → Wi‑Fi (or Ethernet) → this network’s properties → Network profile type → Private network. Phones can connect a minute later; nothing needs restarting. Only do this on the café’s own network.'} />
                    )}
                    {qr && <img src={qr} alt="Pairing code for the phone app" width={240} height={240} style={{ alignSelf: 'center', borderRadius: '6px', background: '#fff' }} />}
                    <span style={{ fontSize: '0.82rem', lineHeight: 1.6, opacity: 0.8 }}>
                      For the phone app: it reaches this hub at {status.lan.addresses.join(' or ')}, encrypted, and trusts only this certificate.
                    </span>
                  </>
                )}
                <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '0.68rem', opacity: 0.45, wordBreak: 'break-all' }}>{status.lan.fingerprint}</span>
              </div>
            )}
            {!status.lan && (
              // Said, not just hidden: the phone section used to vanish with
              // no hint that it was a switch (UPGRADE.md T2.18).
              <div style={{ ...row, flexDirection: 'column', gap: '0.4rem' }}>
                <span style={{ opacity: 0.55 }}>Phones on the café wifi</span>
                <span style={{ fontSize: '0.82rem', lineHeight: 1.6 }}>
                  Off, so no phone can reach this hub. To let staff phones take orders, press Ctrl+Shift+Alt+M on
                  this PC and switch <strong>Staff phones on the café Wi‑Fi</strong> on. The app starts again.
                </span>
              </div>
            )}
            <HubPrinters />
            {/* Sending up and taking down usually fail for the same reason and
                say so in the same words: each problem once (UPGRADE.md T1.7). */}
            {[...new Set([status.pushError, status.lastError, status.receiptError].filter((m): m is string => Boolean(m)))].map(m => (
              <div key={m} style={{ marginTop: '0.8rem' }}><ErrorNote message={m} /></div>
            ))}
            {status.receiptsLeft === 0 && (
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', lineHeight: 1.7, marginTop: '0.8rem' }}>
                With no receipt numbers left, checks can be opened, sent and paid, but not closed, until the hub is online and fetches more.
              </p>
            )}
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', lineHeight: 1.7, marginTop: '1rem' }}>
              The till works from what this hub holds, with or without the internet. While
              it is online, every two minutes the hub sends its checks, tickets, drawer and
              stock movements up, takes the menu, settings and staff roles down, and fetches
              receipt numbers once fewer than 100 are left.
            </p>
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: '1.8rem' }}>
          <a href="/pos" style={{ color: 'var(--offwhite)', fontSize: '0.95rem', fontWeight: 600, marginRight: '1.5rem' }}>Go to the till</a>
          <a href="/pos/login" style={{ color: 'rgba(var(--offwhite-rgb),0.7)', fontSize: '0.95rem' }}>Sign in</a>
        </p>
        {/* Which build this PC runs, so two installs can be told apart (UPGRADE.md T1.25). */}
        {status?.appVersion && (
          <p style={{ textAlign: 'center', marginTop: '0.8rem', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.4)' }}>BIG CMS POS {status.appVersion}</p>
        )}
      </div>
    </main>
  )
}
