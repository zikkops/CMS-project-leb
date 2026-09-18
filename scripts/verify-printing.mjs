// Assertions over the printer configuration model.
//
//   node scripts/verify-printing.mjs
//   npm run verify:printing
//
// Transpiles the real modules with the project's own TypeScript and asserts
// against them. Nothing is re-implemented.
//
// ── Why this is worth assertions ──────────────────────────────────────────
// Printing is the one subsystem where every failure is quiet. A printer that
// is off prints nothing; a printer that is misconfigured also prints nothing;
// a settings document that failed to parse ALSO prints nothing. Three
// different problems with one symptom, none of which raises anything, and all
// of which are discovered mid-service by somebody holding a tray.
//
// So the parsers are the thing to pin down: what a malformed document does,
// and which combinations are refused at the point somebody can still fix them
// rather than at the pass.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'printing-verify-'))
execSync(
  `npx tsc shared/src/printing.ts shared/src/checks.ts shared/src/receipt.ts shared/src/escpos.ts ` +
  `shared/src/money.ts shared/src/modifiers.ts shared/src/tickets.ts shared/src/ticketDoc.ts ` +
  `--outDir ${out} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const P = await import(`file://${join(out, 'printing.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

// ── Reading a stored document ─────────────────────────────────────────────
console.log('\nparsePrintingSettings — a bad document must not break the POS')

eq('undefined gives the defaults', P.parsePrintingSettings(undefined), P.PRINTING_DEFAULTS)
eq('an empty object gives the defaults', P.parsePrintingSettings({}), P.PRINTING_DEFAULTS)
eq('receiptOnClose defaults OFF, for the pilot',
   P.PRINTING_DEFAULTS.receiptOnClose, false)
eq('garbage in branches does not throw',
   typeof P.parsePrintingSettings({ branches: { Main: 'nonsense' } }), 'object')
eq('an unknown receiptStation falls back',
   P.parsePrintingSettings({ receiptStation: 'Cellar' }).receiptStation,
   P.PRINTING_DEFAULTS.receiptStation)

const stored = P.parsePrintingSettings({
  branches: { Main: { Kitchen: { enabled: true, transport: 'browser', width: 42, copies: 2 } } },
})
eq('a stored printer is read back', stored.branches.Main.Kitchen.enabled, true)
eq('its width survives', stored.branches.Main.Kitchen.width, 42)
eq('its copies survive', stored.branches.Main.Kitchen.copies, 2)
eq('stations absent from the document are filled in',
   stored.branches.Main.Bar, P.PRINTER_DEFAULT)

// THE CASE THAT MATTERS. "Enabled" and "has somewhere to print" are different
// facts, and only the second one should make the app try.
eq('enabled with no transport reads as OFF',
   P.parsePrintingSettings({ branches: { Main: { Kitchen: { enabled: true, transport: 'none' } } } })
     .branches.Main.Kitchen.enabled, false)

eq('an unknown transport falls back rather than throwing',
   P.parsePrintingSettings({ branches: { Main: { Kitchen: { transport: 'carrier-pigeon' } } } })
     .branches.Main.Kitchen.transport, 'none')
eq('a nonsense width falls back to the narrow roll',
   P.parsePrintingSettings({ branches: { Main: { Kitchen: { width: 999 } } } })
     .branches.Main.Kitchen.width, 32)
eq('copies out of range falls back to 1',
   P.parsePrintingSettings({ branches: { Main: { Kitchen: { copies: 900 } } } })
     .branches.Main.Kitchen.copies, 1)
eq('a fractional copy count falls back to 1',
   P.parsePrintingSettings({ branches: { Main: { Kitchen: { copies: 1.5 } } } })
     .branches.Main.Kitchen.copies, 1)

// ── Looking one up ────────────────────────────────────────────────────────
console.log('\nprinterFor / activeStations')

const cfg = P.parsePrintingSettings({
  branches: {
    Main: {
      Kitchen: { enabled: true, transport: 'browser' },
      Bar: { enabled: false, transport: 'browser' },
    },
  },
})
eq('a branch nobody configured has no printers', P.printerFor(cfg, 'Nowhere', 'Kitchen'), P.PRINTER_DEFAULT)
eq('a configured station comes back', P.printerFor(cfg, 'Main', 'Kitchen').enabled, true)
eq('only enabled stations are active', P.activeStations(cfg, 'Main'), ['Kitchen'])
eq('an unconfigured branch has none active', P.activeStations(cfg, 'Nowhere'), [])

// ── Saying why, not just no ───────────────────────────────────────────────
console.log('\nprinterBlockedReason — every failure has a different fix')

const reason = over => P.printerBlockedReason({ ...P.PRINTER_DEFAULT, ...over })
eq('no transport says so', typeof reason({}), 'string')
eq('switched off says so',
   typeof reason({ transport: 'browser', enabled: false }), 'string')
eq('ePOS without an address says so',
   typeof reason({ transport: 'epos', enabled: true, address: '' }), 'string')
eq('ePOS with an address is ready',
   reason({ transport: 'epos', enabled: true, address: 'http://192.168.1.50/x' }), null)
eq('browser needs no address', reason({ transport: 'browser', enabled: true }), null)
eq('the three reasons differ from each other',
   new Set([reason({}), reason({ transport: 'browser', enabled: false }),
            reason({ transport: 'epos', enabled: true })]).size, 3)

// ── The transports ────────────────────────────────────────────────────────
console.log('\nthe transports themselves')

eq('every transport has a label',
   P.PRINT_TRANSPORTS.every(t => typeof P.TRANSPORT_LABEL[t] === 'string' && P.TRANSPORT_LABEL[t].length > 0),
   true)
eq('"none" is the default, so nothing prints until somebody says so',
   P.PRINTER_DEFAULT.transport, 'none')
eq('and the default is not enabled', P.PRINTER_DEFAULT.enabled, false)

// ── When the KDS prints ───────────────────────────────────────────────────
// A separate transpile: this file lives in pos/, and adding it to the tsc call
// above would move the common root and every output path with it.
const outB = mkdtempSync(join(tmpdir(), 'printbatch-verify-'))
execSync(
  `npx tsc pos/app/lib/printBatch.ts --outDir ${outB} ` +
  `--module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
const B = await import(`file://${join(outB, 'printBatch.js')}`)

console.log('\nnextPrintBatch — the backlog, a station switch, and printing once')

const base = { ticketsLoading: false, settingsLoading: false, on: true }
const step = (state, over) => B.nextPrintBatch(state, { ...base, ...over })

let s = B.EMPTY_PRINT_STATE
let r = step(s, { scope: 'Main|Kitchen', ids: ['k1', 'k2', 'k3'] })
eq('opening the screen prints none of what is already on the pass', r.print, [])
s = r.state

r = step(s, { scope: 'Main|Kitchen', ids: ['k1', 'k2', 'k3', 'k4'] })
eq('a ticket arriving after that prints', r.print, ['k4'])
s = r.state

r = step(s, { scope: 'Main|Kitchen', ids: ['k1', 'k2', 'k3', 'k4'] })
eq('the same list again prints nothing', r.print, [])

r = step(s, { scope: 'Main|Kitchen', ids: ['k2', 'k4'] })
eq('tickets leaving the pass print nothing', r.print, [])
s = r.state

// THE BUG. The first version printed all three of these.
r = step(s, { scope: 'Main|Bar', ids: ['b1', 'b2', 'b3'] })
eq('switching station does not print the new pass\'s backlog', r.print, [])
s = r.state

r = step(s, { scope: 'Main|Bar', ids: ['b1', 'b2', 'b3', 'b4'] })
eq('but a new ticket on the new station does', r.print, ['b4'])
s = r.state

r = step(s, { scope: 'Main|Kitchen', ids: ['k2', 'k4', 'k5'] })
eq('switching back absorbs what arrived while away', r.print, [])
s = r.state

r = step(s, { scope: 'Main|*', ids: ['k2', 'k4', 'k5', 'b1', 'b2', 'b3', 'b4'] })
eq('switching to All does not print the other stations', r.print, [])
s = r.state

r = step(s, { scope: 'Main|*', ids: ['k2', 'k4', 'k5', 'b1', 'b2', 'b3', 'b4', 'x1', 'x2'] })
eq('several at once print in list order', r.print, ['x1', 'x2'])

console.log('\nnextPrintBatch — waiting, and this device being off')

const loadingT = step(s, { scope: 'Main|*', ids: ['new'], ticketsLoading: true })
eq('nothing is decided while tickets are loading', loadingT.print, [])
// Identity, not eq(): JSON.stringify renders every Set as {}, so comparing
// states by value would pass whatever the state held.
eq('and nothing is recorded either (same state object back)', loadingT.state === s, true)

const loadingS = step(B.EMPTY_PRINT_STATE, { scope: 'Main|Kitchen', ids: ['k1'], settingsLoading: true })
eq('nothing is decided while the printer config is loading', loadingS.state.primedScope, null)
const afterS = step(loadingS.state, { scope: 'Main|Kitchen', ids: ['k1'] })
eq('and the first real snapshot after it is still history', afterS.print, [])

let off = step(B.EMPTY_PRINT_STATE, { scope: 'Main|Kitchen', ids: ['k1'] }).state
const offRun = step(off, { scope: 'Main|Kitchen', ids: ['k1', 'k2'], on: false })
eq('with this device off, nothing prints', offRun.print, [])
off = offRun.state
eq('turning it on does not print what arrived while it was off',
   step(off, { scope: 'Main|Kitchen', ids: ['k1', 'k2'], on: true }).print, [])
eq('but the next one after does',
   step(off, { scope: 'Main|Kitchen', ids: ['k1', 'k2', 'k3'], on: true }).print, ['k3'])

const before = B.EMPTY_PRINT_STATE.seen.size
step(B.EMPTY_PRINT_STATE, { scope: 'Main|Kitchen', ids: ['a', 'b'] })
eq('the previous state is never mutated', B.EMPTY_PRINT_STATE.seen.size, before)

// ── Which screen prints the receipt ───────────────────────────────────────
console.log('\nshouldPrintReceiptHere — the station\'s device, never the phone that closed it')

const rcfg = (over = {}) => P.parsePrintingSettings({
  receiptOnClose: true,
  receiptStation: 'Bar',
  branches: { Main: { Bar: { enabled: true, transport: 'browser' } } },
  ...over,
})
eq('off unless receipt-on-close is on',
   P.shouldPrintReceiptHere(rcfg({ receiptOnClose: false }), 'Main', 'Bar'), false)
eq('off when the receipt station has no printer',
   P.shouldPrintReceiptHere(rcfg({ branches: {} }), 'Main', 'Bar'), false)
eq('the receipt station\'s screen prints it', P.shouldPrintReceiptHere(rcfg(), 'Main', 'Bar'), true)
eq('a screen showing All prints it', P.shouldPrintReceiptHere(rcfg(), 'Main', null), true)
eq('another station\'s screen does not', P.shouldPrintReceiptHere(rcfg(), 'Main', 'Kitchen'), false)
eq('another branch does not', P.shouldPrintReceiptHere(rcfg(), 'Second', 'Bar'), false)

// ── When the receipt prints ───────────────────────────────────────────────
console.log('\nnextReceiptBatch — new closings only, and never an old one a refund shuffles in')

const rd = (id, closedAtMs, status = 'closed') => ({ id, status, closedAtMs })
let rs = B.EMPTY_RECEIPT_STATE
let rr = B.nextReceiptBatch(rs, [rd('c1', 1000), rd('c2', 2000)], [rd('c1', 1000), rd('c2', 2000)])
eq('opening the screen prints none of the recent closings', rr.print, [])
eq('and takes the newest closedAt as the watermark', rr.state.watermark, 2000)
rs = rr.state

rr = B.nextReceiptBatch(rs, [], [rd('c3', 3000)])
eq('a check closing after that prints', rr.print, ['c3'])
rs = rr.state

eq('the same check changing again does not reprint',
   B.nextReceiptBatch(rs, [], [rd('c3', 3000)]).print, [])

// THE TRAP. A refund drops a check out of the "closed" query and the
// eleventh-newest slides into the limit-10 window as an added change.
eq('an old check a refund pushes into the window does not print',
   B.nextReceiptBatch(rs, [], [rd('c0', 500)]).print, [])
eq('a refunded check does not print', B.nextReceiptBatch(rs, [], [rd('c9', 9000, 'refunded')]).print, [])

const pending = B.nextReceiptBatch(rs, [], [rd('c4', Number.NaN)])
eq('an unresolved timestamp waits', pending.print, [])
eq('and resolving prints it once',
   B.nextReceiptBatch(pending.state, [], [rd('c4', 4000)]).print, ['c4'])

const outOfOrder = B.nextReceiptBatch(rs, [], [rd('c6', 6000)])
eq('two closings arriving out of order both print',
   B.nextReceiptBatch(outOfOrder.state, [], [rd('c5', 5000)]).print, ['c5'])

const empty = B.nextReceiptBatch(B.EMPTY_RECEIPT_STATE, [], [])
eq('a branch with no closed checks yet primes to zero', empty.state.watermark, 0)
eq('and its first closing prints', B.nextReceiptBatch(empty.state, [], [rd('n1', 10)]).print, ['n1'])

console.log('\nnetwork printers, printed by the café hub itself (S28)')
{
  const E = await import(`file://${join(out, 'escpos.js')}`)
  eq('a private address on the café network, port 9100 unless one is given',
    [P.readPrinterAddress('192.168.1.50'), P.readPrinterAddress(' 10.0.0.7:9101 '), P.readPrinterAddress('172.16.4.2')],
    [{ host: '192.168.1.50', port: 9100 }, { host: '10.0.0.7', port: 9101 }, { host: '172.16.4.2', port: 9100 }])
  eq('THE TRAP: never a public address, this PC itself, a name, a url, or a port that is not one',
    ['8.8.8.8', '127.0.0.1', 'printer.local', 'http://192.168.1.50', '192.168.1.50:0', '192.168.1.50:70000', '192.168.1.300', '', null].map(P.readPrinterAddress),
    [null, null, null, null, null, null, null, null, null])

  const network = { enabled: true, transport: 'network', width: 42, address: '192.168.1.50', copies: 2 }
  eq('a stored network printer is read as one', P.parsePrintingSettings({ branches: { Main: { Kitchen: network } } }).branches.Main.Kitchen, network)
  eq('a network printer with a good address is ready; without one it says what to fix',
    [P.printerBlockedReason(network), /192\.168\.1\.50/.test(P.printerBlockedReason({ ...network, address: 'printer.local' }) ?? '')], [null, true])
  eq('printed by the hub only when switched on and a network printer',
    [P.printsFromHub(network), P.printsFromHub({ ...network, enabled: false }), P.printsFromHub({ ...network, transport: 'browser' })], [true, false, false])
  const receiptAtKitchen = { branches: { Main: { Kitchen: network } }, receiptOnClose: true, receiptStation: 'Kitchen' }
  eq('THE TRAP: a screen never prints a receipt the hub prints to a network printer: two receipts for one table',
    [P.shouldPrintReceiptHere(P.parsePrintingSettings(receiptAtKitchen), 'Main', null), P.shouldPrintReceiptHere(P.parsePrintingSettings({ ...receiptAtKitchen, branches: { Main: { Kitchen: { ...network, transport: 'browser' } } } }), 'Main', null)],
    [false, true])

  eq('text reaches the printer one ASCII character for each character, so the columns still line up',
    E.printableAscii('Café · 2×Latté — 5°\r\nنعم'), 'Cafe . 2xLatte - 5o\n???')
  const job = [...E.escposJob('A\nB', 1)]
  eq('a job initialises the printer, picks PC437, prints the text, feeds and cuts',
    job, [0x1b, 0x40, 0x1b, 0x74, 0x00, 0x41, 0x0a, 0x42, 0x0a, 0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00])
  eq('copies are whole jobs one after the other, never more than five', [E.escposJob('A', 2).length, E.escposJob('A', 9).length, E.escposJob('A', 0).length], [28, 70, 14])
}

console.log('\nprinting a ticket again (UPGRADE.md T3.6)')
{
  const TK = await import(`file://${join(out, 'tickets.js')}`)
  const TD = await import(`file://${join(out, 'ticketDoc.js')}`)
  eq('a ticket never reprinted is one print id; after two reprints it carries the second',
    [TK.printIdsOf({ id: 'k1' }), TK.printIdsOf({ id: 'k1', reprints: 2 }), TK.printIdsOf({ id: 'k1', reprints: 0 })], [['k1'], ['k1', 'k1#r2'], ['k1']])
  eq('...and the id reads back as that ticket, as a reprint', [TK.readPrintId('k1#r2'), TK.readPrintId('k1')],
    [{ ticketId: 'k1', reprint: true }, { ticketId: 'k1', reprint: false }])
  let st = B.EMPTY_PRINT_STATE
  let rr = step(st, { scope: 'Main|Kitchen', ids: ['k1', 'k1#r1'] })
  eq('THE TRAP: a screen opening does not print reprints asked for before it looked', rr.print, [])
  st = rr.state
  rr = step(st, { scope: 'Main|Kitchen', ids: ['k1', 'k1#r2'] })
  eq('a new reprint prints once', rr.print, ['k1#r2'])
  rr = step(rr.state, { scope: 'Main|Kitchen', ids: ['k1', 'k1#r2'] })
  eq('...and not again when the list arrives again', rr.print, [])
  const text = TD.ticketToText({ id: 'k1', checkId: 'c', branch: 'Main', tableNumber: 7, station: 'Kitchen', status: 'new', round: 1,
    lines: [{ lineId: 'l', name: 'Fries', quantity: 1, modifiers: '', seat: null, course: null, note: '', voided: false }],
    sentBy: 'u', sentByEmail: 'u', bumpedAt: null, bumpedBy: null }, { sentAt: 0, sentBy: 'u', reprint: true }, 32)
  eq('the paper says it is a reprint, near the top, so nobody cooks it twice', text.split('\n').slice(0, 4).some(l => l.includes('REPRINT, NOT A NEW ORDER')), true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
