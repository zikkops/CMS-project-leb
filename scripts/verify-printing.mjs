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
  `npx tsc shared/src/printing.ts shared/src/checks.ts shared/src/receipt.ts ` +
  `shared/src/money.ts shared/src/modifiers.ts ` +
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
  ok ? pass++ : fail++
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
