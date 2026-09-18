// Assertions over what the staff app says — shared/src/phoneMessages.ts.
//
//   node scripts/verify-phone.mjs
//   npm run verify:phone
//
// The phone's native side names what went wrong with a code
// (HubHttp.classify(), tested on the JVM by HubHttpTest); this is the other
// half, turning the code into what to do. It exists because the first real
// setup (16 Sep 2026) showed a waiter Android's own sentence about a socket
// timeout for what was a phone on mobile data (UPGRADE.md T1.18).

import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const cache = join(process.cwd(), 'node_modules', '.cache')
mkdirSync(cache, { recursive: true })
const out = mkdtempSync(join(cache, 'phone-verify-'))
execSync(`npx tsc shared/src/phoneMessages.ts --outDir ${out} --module esnext --target es2022 --skipLibCheck --strict`, { stdio: 'pipe' })
const M = await import(`file://${join(out, 'phoneMessages.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

// A Capacitor plugin rejection: an Error carrying the native side's code.
const rejected = (message, code) => Object.assign(new Error(message), { code })

console.log('\nwhat a code says')
eq('THE TRAP: a phone on mobile data is told so, not about a socket',
  M.phoneMessage(rejected('The phone could not reach the hub: failed to connect to /192.168.68.148 (port 3443) from /10.32.155.185 (port 48698) after 15000ms', 'UNREACHABLE'), 'x'),
  M.PHONE_MESSAGES.UNREACHABLE)
eq('...and the words name the fix: the café Wi-Fi, not mobile data, the PC on',
  ['café Wi-Fi', 'mobile data', 'counter PC'].every(w => M.PHONE_MESSAGES.UNREACHABLE.includes(w)), true)
eq('a certificate that is not the pinned one is the wrong hub', M.phoneMessage(rejected('pin', 'WRONG_HUB'), 'x'), M.PHONE_MESSAGES.WRONG_HUB)
eq('no internet for registering says it needs the internet', M.phoneMessage(rejected('dns', 'OFFLINE'), 'x'), M.PHONE_MESSAGES.OFFLINE)
eq('closing the fingerprint prompt is only "Cancelled."', M.phoneMessage(rejected('Fingerprint operation cancelled by user.', 'CANCELLED'), 'x'), 'Cancelled.')

console.log('\nwhat keeps its own words')
eq('a refusal from the hub or the app is already written for people', M.phoneMessage(rejected('That request is closed.', 'NETWORK_NO'), 'x'), 'That request is closed.')
eq('an error with no code keeps its text', M.phoneMessage(new Error('A manager turned it down.'), 'x'), 'A manager turned it down.')
eq('nothing usable falls back', [M.phoneMessage(null, 'fallback'), M.phoneMessage({}, 'fallback'), M.phoneMessage(new Error('  '), 'fallback')], ['fallback', 'fallback', 'fallback'])
eq('a code that only looks like one is not trusted', M.phoneMessage(rejected('own words', 'toString'), 'x'), 'own words')

console.log('\nthe scanner')
eq('closing the camera is not an error; anything else says how to scan',
  [M.scanWasCancelled(new Error('User cancelled the scan')), M.scanWasCancelled(new Error('No camera')), M.scanWasCancelled(null)],
  [true, false, false])
eq('...and how to scan is something a person can do', /20 cm/.test(M.SCAN_FAILED) && /paste the link/.test(M.SCAN_FAILED), true)

console.log('\nthe app uses it')
{
  const app = readFileSync(join('phone', 'src', 'app.ts'), 'utf8')
  eq('no screen shows a raw error message any more', (app.match(/err instanceof Error \? err\.message/g) ?? []).length, 0)
  eq('every catch goes through phoneMessage', (app.match(/say\(phoneMessage\(err,/g) ?? []).length >= 10, true)
}

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
