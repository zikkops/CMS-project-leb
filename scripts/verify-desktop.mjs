// Assertions over the Windows counter app's decisions — desktop/policy.js.
//
//   node scripts/verify-desktop.mjs
//   npm run verify:desktop
//
// The app is a till on a café PC that anybody can walk up to. What it most
// has to prevent: being pointed at an unencrypted address (staff passwords on
// the café network), navigating away from the POS (another site on the
// counter screen), and granting a permission nothing asked for. A typo in its
// settings must not switch any of that off.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const P = require('../desktop/policy.js')

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const POS = 'https://pos.cms-projectlb.com/pos'

console.log('\nthe address the till opens')
{
  eq('an https address is kept', P.readPosUrl('https://pos.example.com/pos'), 'https://pos.example.com/pos')
  eq('THE TRAP: plain http on a network is refused', P.readPosUrl('http://192.168.1.20:3002/pos'), null)
  eq('http on this machine is allowed, for development', P.readPosUrl('http://localhost:3002/pos'), 'http://localhost:3002/pos')
  eq('...and on 127.0.0.1', P.readPosUrl('http://127.0.0.1:3002/pos'), 'http://127.0.0.1:3002/pos')
  eq('a file address is refused', P.readPosUrl('file:///C:/pos.html'), null)
  eq('not an address at all', P.readPosUrl('pos'), null)
  eq('nothing', P.readPosUrl(undefined), null)
}

console.log('\nits settings')
{
  eq('no settings file: the defaults', P.readConfig(null, {}), { posUrl: POS, kiosk: true, startWithWindows: true })
  eq('an unreadable file: the defaults', P.readConfig('{not json', {}), { posUrl: POS, kiosk: true, startWithWindows: true })
  eq('a list instead of settings: the defaults', P.readConfig('[1,2]', {}).posUrl, POS)
  eq('full screen can be switched off on purpose', P.readConfig('{"kiosk": false}', {}).kiosk, false)
  eq('THE TRAP: "false" as text does not switch it off', P.readConfig('{"kiosk": "false"}', {}).kiosk, true)
  eq('a bad address falls back rather than stopping the till', P.readConfig('{"posUrl": "http://10.0.0.5/pos"}', {}).posUrl, POS)
  eq('a good address from the file is used', P.readConfig('{"posUrl": "https://pos.other.cafe/pos"}', {}).posUrl, 'https://pos.other.cafe/pos')
  eq('the environment wins over the file', P.readConfig('{"posUrl": "https://pos.other.cafe/pos"}', { BIG_CMS_POS_URL: 'http://localhost:3002/pos' }).posUrl, 'http://localhost:3002/pos')
  eq('...but a bad address in the environment is ignored', P.readConfig(null, { BIG_CMS_POS_URL: 'http://evil.example/pos' }).posUrl, POS)
}

console.log('\nwhere it may go')
{
  eq('another POS page', P.isAllowedNavigation('https://pos.cms-projectlb.com/pos/counter', POS), true)
  eq('THE TRAP: a look-alike address is another site', P.isAllowedNavigation('https://pos.cms-projectlb.com.evil.example/pos', POS), false)
  eq('the customer website is another site', P.isAllowedNavigation('https://cms-projectlb.com/', POS), false)
  eq('the same host without https is refused', P.isAllowedNavigation('http://pos.cms-projectlb.com/pos', POS), false)
  eq('a javascript: link is refused', P.isAllowedNavigation('javascript:alert(1)', POS), false)
  eq('a file: link is refused', P.isAllowedNavigation('file:///C:/Windows/System32', POS), false)
  eq('garbage is refused', P.isAllowedNavigation('%%%', POS), false)
}

console.log('\nwhat it may be granted')
{
  eq('the camera, for a loyalty QR on the POS', P.isAllowedPermission('media', 'https://pos.cms-projectlb.com/pos/check/abc', POS), true)
  eq('full screen on the POS', P.isAllowedPermission('fullscreen', POS, POS), true)
  eq('THE TRAP: the camera for another site is refused', P.isAllowedPermission('media', 'https://evil.example/', POS), false)
  eq('location is refused, even on the POS', P.isAllowedPermission('geolocation', POS, POS), false)
  eq('notifications are refused', P.isAllowedPermission('notifications', POS, POS), false)
  eq('USB and serial are refused', [P.isAllowedPermission('usb', POS, POS), P.isAllowedPermission('serial', POS, POS)], [false, false])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
