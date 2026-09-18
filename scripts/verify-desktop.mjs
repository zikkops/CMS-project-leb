// Assertions over the Windows counter app's decisions — desktop/policy.js.
//
//   node scripts/verify-desktop.mjs
//   npm run verify:desktop
//
// The app is a till on a café PC that anybody can walk up to. What it most
// has to prevent: being pointed at an unencrypted address (staff passwords on
// the café network), navigating away from the POS (another site on the
// counter screen), and granting a permission nothing asked for. A typo in its
// settings must not switch any of that off. On a hub, two more: the Firebase
// Admin key on the PC must never reach the server it starts, and the hub's own
// credential must never be sent to the cloud over plain http.

import { createRequire } from 'node:module'
import { X509Certificate, createPrivateKey } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:tls'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const P = require('../desktop/policy.js')
const L = require('../desktop/hubLan.js')

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const POS = 'https://pos.cms-projectlb.com/pos'
const CLOUD = 'https://pos.cms-projectlb.com'
const UPDATES = 'https://pos.cms-projectlb.com/api/desktop-updates/'
const DEFAULTS = { posUrl: POS, kiosk: true, startWithWindows: true, mode: 'online', modeChosen: false, hubPort: 3100, cloudUrl: CLOUD, hubLan: false, hubLanPort: 3443, autoUpdate: true, updatesUrl: UPDATES }

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
  eq('no settings file: the defaults', P.readConfig(null, {}), DEFAULTS)
  eq('an unreadable file: the defaults', P.readConfig('{not json', {}), DEFAULTS)
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

console.log('\nthe café hub (stages 3 and 4)')
{
  eq('online unless a PC is set up as the hub', P.readConfig(null, {}).mode, 'online')
  eq('hub mode from the settings file', P.readConfig('{"mode": "hub"}', {}).mode, 'hub')
  eq('a mode that does not exist falls back to online', P.readConfig('{"mode": "offline"}', {}).mode, 'online')
  eq('the environment can set it, for development', P.readConfig(null, { BIG_CMS_DESKTOP_MODE: 'hub' }).mode, 'hub')
  eq('the hub port defaults to 3100', P.readConfig(null, {}).hubPort, 3100)
  eq('a port from the file', P.readConfig('{"hubPort": 3200}', {}).hubPort, 3200)
  eq('THE TRAP: a privileged port, or a port as text, falls back',
    [P.readConfig('{"hubPort": 80}', {}).hubPort, P.readConfig('{"hubPort": "3200"}', {}).hubPort, P.readConfig('{"hubPort": 3100.5}', {}).hubPort], [3100, 3100, 3100])
  eq('the till opens the hub on this PC', P.hubAddress(3100), 'http://localhost:3100/pos')
  eq('...an address the till is allowed to open', P.readPosUrl(P.hubAddress(3100)), 'http://localhost:3100/pos')
  eq('...and the hub\'s pages are the POS\'s own', P.isAllowedNavigation('http://localhost:3100/pos/kds', P.hubAddress(3100)), true)

  eq('the cloud a hub pairs with defaults to the hosted POS', P.readConfig(null, {}).cloudUrl, CLOUD)
  eq('a cloud address is kept as its origin, never a path', P.readConfig('{"cloudUrl": "https://pos.other.cafe/api/anything"}', {}).cloudUrl, 'https://pos.other.cafe')
  eq('THE TRAP: a cloud on plain http across a network falls back: the hub sends its secret there',
    P.readConfig('{"cloudUrl": "http://192.168.1.10:3002"}', {}).cloudUrl, CLOUD)
  eq('the environment can point a development hub at a local cloud', P.readConfig(null, { BIG_CMS_CLOUD_URL: 'http://localhost:3002' }).cloudUrl, 'http://localhost:3002')

  const pcEnv = {
    Path: 'C:\\Windows\\system32', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp',
    FIREBASE_SERVICE_ACCOUNT: 'eyJ0eXBlIjoic2VydmljZV9hY2NvdW50In0=', GOOGLE_APPLICATION_CREDENTIALS: 'C:\\keys\\sa.json',
    IMGBB_API_KEY: 'k', CRON_SECRET: 's', NODE_OPTIONS: '--require C:\\evil.js', BIG_CMS_HUB_DB: 'C:\\somewhere-else.db',
    BIG_CMS_CLOUD_URL: 'http://evil.example',
  }
  const env = P.hubServerEnv(pcEnv, { port: 3100, dbFile: 'C:\\Users\\till\\AppData\\Roaming\\BIG CMS POS\\hub\\pos.db', cloudUrl: CLOUD })
  eq('THE TRAP: the Admin key on this PC never reaches the hub server',
    ['FIREBASE_SERVICE_ACCOUNT', 'GOOGLE_APPLICATION_CREDENTIALS'].filter(k => k in env), [])
  eq('nor other secrets, nor code loaded through NODE_OPTIONS',
    ['IMGBB_API_KEY', 'CRON_SECRET', 'NODE_OPTIONS'].filter(k => k in env), [])
  eq('the hub server gets its port, its own database, this PC only, production, and the app\'s cloud',
    [env.PORT, env.BIG_CMS_HUB_DB, env.HOSTNAME, env.NODE_ENV, env.BIG_CMS_CLOUD_URL],
    ['3100', 'C:\\Users\\till\\AppData\\Roaming\\BIG CMS POS\\hub\\pos.db', '127.0.0.1', 'production', CLOUD])
  eq('Windows still has what it needs to run it', [env.Path, env.SystemRoot, env.TEMP], ['C:\\Windows\\system32', 'C:\\Windows', 'C:\\Temp'])

  eq('our hub answers 401 as JSON: ready', P.classifyHubProbe(401, '{"error":"Not signed in."}'), 'ready')
  eq('no answer yet: starting', [P.classifyHubProbe(null, ''), P.classifyHubProbe(undefined, '')], ['starting', 'starting'])
  eq('THE TRAP: a POS server that is not a hub is not the hub', P.classifyHubProbe(404, '{"error":"Not found."}'), 'other')
  eq('another program on the port is not the hub',
    [P.classifyHubProbe(200, '<html></html>'), P.classifyHubProbe(401, 'Unauthorized'), P.classifyHubProbe(500, '')], ['other', 'other', 'other'])
  eq('a stopped hub is started again, backing off to at most 30 seconds',
    [0, 1, 2, 4, 5, 50, -1].map(P.hubRestartDelay), [1000, 2000, 4000, 16000, 30000, 30000, 1000])
}

console.log('\nphones on the café wifi, encrypted (S11)')
try {
  eq('THE TRAP: nothing listens on the network until a café asks for it', P.readConfig(null, {}).hubLan, false)
  eq('switched on in the settings file', P.readConfig('{"hubLan": true}', {}).hubLan, true)
  eq('..."true" as text does not switch it on', P.readConfig('{"hubLan": "true"}', {}).hubLan, false)
  eq('its port defaults to 3443, and can be set', [P.readConfig(null, {}).hubLanPort, P.readConfig('{"hubLanPort": 4443}', {}).hubLanPort], [3443, 4443])
  eq('THE TRAP: it is never the hub server\'s own port, which stays on this PC',
    [P.readConfig('{"hubPort": 3200, "hubLanPort": 3200}', {}).hubLanPort, P.readConfig('{"hubPort": 3443}', {}).hubLanPort], [3443, 3444])

  const FP = Array(32).fill('AB').join(':')
  const lanEnv = P.hubServerEnv({}, { port: 3100, dbFile: 'C:\\hub\\pos.db', cloudUrl: CLOUD, lan: { port: 3443, fingerprint: FP } })
  eq('the hub server is told where the door is and which certificate it has',
    [lanEnv.BIG_CMS_HUB_LAN_PORT, lanEnv.BIG_CMS_HUB_CERT_SHA256], ['3443', FP])
  eq('THE TRAP: ...and still listens on this PC only: only the encrypted door faces the wifi', lanEnv.HOSTNAME, '127.0.0.1')
  eq('a malformed fingerprint or port is not passed on',
    ['BIG_CMS_HUB_LAN_PORT' in P.hubServerEnv({}, { port: 3100, dbFile: 'x', cloudUrl: CLOUD, lan: { port: 3443, fingerprint: 'AB:CD' } }),
      'BIG_CMS_HUB_LAN_PORT' in P.hubServerEnv({}, { port: 3100, dbFile: 'x', cloudUrl: CLOUD, lan: { port: 80, fingerprint: FP } })], [false, false])

  const now = new Date(Date.UTC(2026, 8, 15, 12))
  const made = L.createHubCertificate({ now })
  const x = new X509Certificate(made.cert)
  eq('the hub makes a real certificate, signed by its own key, for a TLS server and nothing more',
    [x.verify(x.publicKey), x.checkPrivateKey(createPrivateKey(made.key)), x.ca, x.keyUsage], [true, true, false, ['1.3.6.1.5.5.7.3.1']])
  // Node's x.ca also needs the right to sign certificates, so it reads false for
  // an authority without it. The certificate's own bytes say what it claims.
  eq('THE TRAP: its basic constraints say, in its own bytes, that it is not an authority',
    Buffer.from(x.raw).includes(Buffer.from('300c0603551d130101ff04023000', 'hex')), true)
  eq('it lasts ten years, and starts a day early for a phone whose clock runs ahead',
    [new Date(x.validTo).getUTCFullYear(), Date.parse(x.validFrom) < now.getTime()], [2036, true])
  eq('its fingerprint is the one a phone pins', L.certificateFingerprint(made.cert), x.fingerprint256)
  eq('a sound certificate has no problem', L.certificateProblem(made.cert, made.key, now), null)
  const other = L.createHubCertificate({ now })
  eq('THE TRAP: a key that is not the certificate\'s, one about to run out, or garbage, is not used',
    [L.certificateProblem(made.cert, other.key, now), L.certificateProblem(made.cert, made.key, new Date(Date.UTC(2036, 8, 1))), L.certificateProblem('nonsense', made.key, now)],
    ['the key is not this certificate\'s', 'runs out within 30 days', 'unreadable certificate'])

  const dir = mkdtempSync(join(tmpdir(), 'hub-lan-verify-'))
  const first = L.loadOrCreateCertificate(dir, { now })
  const again = L.loadOrCreateCertificate(dir, { now })
  eq('THE TRAP: made once and kept, so paired phones keep trusting the hub',
    [first.created, again.created, again.fingerprint === first.fingerprint], ['none yet', null, true])
  writeFileSync(join(dir, L.CERT_FILE), 'damaged')
  const remade = L.loadOrCreateCertificate(dir, { now })
  eq('a damaged one is made again, with a new fingerprint', [remade.created, remade.fingerprint !== first.fingerprint], ['unreadable certificate', true])

  const upstream = createServer((req, res) => res.end(`hub saw ${req.url}`))
  await new Promise(r => upstream.listen(0, '127.0.0.1', r))
  const front = await L.startLanFront({ key: remade.key, cert: remade.cert, host: '127.0.0.1', port: 0, targetPort: upstream.address().port })
  const port = front.address().port
  const talk = opts => new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port, ...opts }, () => {
      const fp = socket.getPeerCertificate().fingerprint256
      let body = ''
      socket.on('data', d => { body += d })
      socket.on('end', () => resolve({ fp, body }))
      socket.write('GET /api/hub/session HTTP/1.1\r\nHost: hub\r\nConnection: close\r\n\r\n')
    })
    socket.on('error', e => resolve({ error: e.code ?? e.message }))
  })
  const pinned = await talk({ rejectUnauthorized: false })
  eq('through the door, encrypted, a phone reaches the hub server and sees the certificate it pinned',
    [pinned.fp === remade.fingerprint, /hub saw \/api\/hub\/session/.test(pinned.body ?? '')], [true, true])
  const trusting = await talk({})
  eq('THE TRAP: an ordinary client trusts no hub certificate: only the app, by fingerprint, does',
    trusting.error, 'DEPTH_ZERO_SELF_SIGNED_CERT')
  front.close()
  upstream.close()
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* the OS cleans temp */ }
} catch (err) {
  console.log(`  FAIL  the run stopped: ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`)
  fail++
}

console.log('\nonline till or café hub, chosen on the PC (S29–S30)')
{
  eq('THE TRAP: a PC nobody has set up asks, rather than guessing online',
    [P.readConfig(null, {}).modeChosen, P.readConfig('{"kiosk": false}', {}).modeChosen, P.readConfig('{"mode": "sideways"}', {}).modeChosen], [false, false, false])
  eq('...and a mode in the file, or the environment, counts as chosen',
    [P.readConfig('{"mode": "online"}', {}).modeChosen, P.readConfig('{"mode": "hub"}', {}).modeChosen, P.readConfig(null, { BIG_CMS_DESKTOP_MODE: 'hub' }).modeChosen], [true, true, true])
  const written = P.configWithMode('{"kiosk": false, "hubLan": true, "mode": "hub"}', 'online')
  eq('choosing a mode keeps every other setting', [JSON.parse(written), P.readConfig(written, {}).modeChosen], [{ kiosk: false, hubLan: true, mode: 'online' }, true])
  eq('...an unreadable file becomes one with the mode', [JSON.parse(P.configWithMode('{oops', 'hub')), JSON.parse(P.configWithMode(null, 'online'))], [{ mode: 'hub' }, { mode: 'online' }])
  let refused = null
  try { P.configWithMode('{}', 'offline') } catch (err) { refused = err.message }
  eq('a mode that does not exist is refused, not written', refused, '"offline" is not a mode.')

  eq('the manager\'s key combination is Ctrl+Shift+Alt+M, on a key press',
    [P.isSetupShortcut({ type: 'keyDown', control: true, shift: true, alt: true, key: 'M' }), P.isSetupShortcut({ type: 'keyUp', control: true, shift: true, alt: true, key: 'm' }),
      P.isSetupShortcut({ type: 'keyDown', control: true, shift: true, alt: false, key: 'm' }), P.isSetupShortcut({ type: 'keyDown', control: true, shift: true, alt: true, key: 'k' })],
    [true, false, false, false])
  eq('THE TRAP: only the app\'s own setup page may switch the PC: never a POS page from the network, or a look-alike',
    [P.isSetupPage('file:///C:/Program%20Files/BIG%20CMS%20POS/resources/app.asar/setup.html'), P.isSetupPage('https://pos.cms-projectlb.com/setup.html'),
      P.isSetupPage('http://localhost:3100/pos'), P.isSetupPage('file:///C:/x/offline.html'), P.isSetupPage('file:///C:/x/setup.html.evil'), P.isSetupPage('nonsense')],
    [true, false, false, false, false, false])
  eq('the old hub database is kept under a dated backup name', P.hubBackupName(new Date(2026, 8, 15, 22, 15, 30)), 'pos.db.hub-backup-20260915-221530')
}

console.log('\nautomatic updates: signed, checked, and installed only when nobody is using the PC (S26–S27)')
try {
  const U = require('../desktop/update.js')
  const { generateKeyPairSync, sign, createHash, randomBytes } = await import('node:crypto')
  const { existsSync, readdirSync, readFileSync } = await import('node:fs')

  eq('updates are looked for on our own site by default, and on by default', [P.readConfig(null, {}).updatesUrl, P.readConfig(null, {}).autoUpdate], [UPDATES, true])
  eq('an updates address is a folder: a trailing slash, no query',
    P.readUpdatesUrl('https://pos.other.cafe/api/desktop-updates?x=1#y'), 'https://pos.other.cafe/api/desktop-updates/')
  eq('THE TRAP: an updates address on plain http across a network falls back',
    P.readConfig('{"updatesUrl": "http://192.168.1.10/updates/"}', {}).updatesUrl, UPDATES)
  eq('switching updates off needs a real false', [P.readConfig('{"autoUpdate": false}', {}).autoUpdate, P.readConfig('{"autoUpdate": "false"}', {}).autoUpdate], [false, true])

  eq('versions compare as numbers: 0.1.10 is after 0.1.9',
    [U.isNewer('0.1.10', '0.1.9'), U.isNewer('0.2.0', '0.1.99'), U.isNewer('1.0.0', '0.9.9'), U.isNewer('0.1.0', '0.1.0'), U.isNewer('0.1.0', '0.2.0'), U.isNewer('0.2', '0.1.0'), U.isNewer('0.2.0-beta', '0.1.0')],
    [true, true, true, false, false, false, false])
  eq('THE TRAP: a build under the version already released is refused, a higher one is not',
    [U.releaseVersionProblem('0.1.0', '0.1.0') !== null, U.releaseVersionProblem('0.1.0', '0.2.0') !== null,
      U.releaseVersionProblem('0.1.1', '0.1.0'), U.releaseVersionProblem('0.1.0', null), U.releaseVersionProblem('0.1', null) !== null],
    [true, true, null, null, true])

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const testKey = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const other = generateKeyPairSync('ed25519')
  const installer = randomBytes(1_200_000)
  const release = (overrides = {}) => ({
    app: 'big-cms-counter', version: '0.2.0', file: 'BIG-CMS-POS-Setup-0.2.0.exe', size: installer.length,
    sha512: createHash('sha512').update(installer).digest('base64'), ...overrides,
  })
  const signed = (payloadObject, key = privateKey) => {
    const payload = JSON.stringify(payloadObject)
    return JSON.stringify({ payload, signature: sign(null, Buffer.from(payload), key).toString('base64') })
  }
  eq('a manifest signed by the release key offers its version',
    U.readManifest(signed(release()), testKey), { version: '0.2.0', file: 'BIG-CMS-POS-Setup-0.2.0.exe', size: installer.length, sha512: release().sha512 })
  const tampered = JSON.parse(signed(release()))
  tampered.payload = tampered.payload.replace('0.2.0', '9.9.9')
  eq('THE TRAP: a manifest changed after signing is ignored', U.readManifest(JSON.stringify(tampered), testKey), null)
  eq('THE TRAP: a manifest signed by any other key is ignored', U.readManifest(signed(release(), other.privateKey), testKey), null)
  eq('THE TRAP: the app trusts only the pinned release key, not whoever signed a manifest',
    U.readManifest(signed(release())), null)
  eq('the pinned key is an Ed25519 key, the one scripts/release-desktop.mjs made',
    [U.UPDATE_PUBLIC_KEY, (await import('node:crypto')).createPublicKey({ key: Buffer.from(U.UPDATE_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType],
    ['MCowBQYDK2VwAyEAW7Y9goSdq6sIuj9RSzqdRWoi9KowFRVvzH99HdSqTU4=', 'ed25519'])
  eq('THE TRAP: even signed, a manifest cannot name another file, a path, another app, or nonsense',
    [U.readManifest(signed(release({ file: 'BIG-CMS-POS-Setup-0.1.9.exe' })), testKey), U.readManifest(signed(release({ file: '../../Windows/evil.exe' })), testKey),
      U.readManifest(signed(release({ app: 'something-else' })), testKey), U.readManifest(signed(release({ size: 10 })), testKey),
      U.readManifest(signed(release({ sha512: 'abc' })), testKey), U.readManifest('not json', testKey), U.readManifest(JSON.stringify({ payload: 'x' }), testKey)],
    [null, null, null, null, null, null, null])
  eq('an installer is looked up inside the updates folder only',
    [U.installerUrl(UPDATES, 'BIG-CMS-POS-Setup-0.2.0.exe'), (() => { try { return U.installerUrl(UPDATES, 'https://evil.example/x.exe') } catch { return 'refused' } })()],
    [`${UPDATES}BIG-CMS-POS-Setup-0.2.0.exe`, 'refused'])

  const at = (h, m = 0) => new Date(2026, 8, 16, h, m)
  const idle = 11 * 60
  eq('it installs after 05:00, with the PC idle for ten minutes and nobody signed in',
    U.shouldInstallNow({ now: at(6), idleSeconds: idle, liveSessions: 0 }), true)
  eq('THE TRAP: never mid-service: not before 05:00, not from 10:00, not while somebody used the PC, not while somebody is signed in',
    [U.shouldInstallNow({ now: at(4, 59), idleSeconds: idle, liveSessions: 0 }), U.shouldInstallNow({ now: at(10), idleSeconds: idle, liveSessions: 0 }),
      U.shouldInstallNow({ now: at(6), idleSeconds: 9 * 60, liveSessions: 0 }), U.shouldInstallNow({ now: at(6), idleSeconds: idle, liveSessions: 1 })],
    [false, false, false, false])
  eq('...and not when a hub did not say who is signed in', U.shouldInstallNow({ now: at(6), idleSeconds: idle, liveSessions: null }), false)
  eq('the installer runs silently and starts the app again', U.installerArgs(), ['/S', '--force-run'])

  // A local updates folder, over http on this PC.
  let served = { manifest: signed(release()), installer }
  let downloads = 0
  const folder = createServer((req, res) => {
    if (req.url === '/updates/latest.json') return res.end(served.manifest)
    if (req.url === '/updates/BIG-CMS-POS-Setup-0.2.0.exe') { downloads++; return res.end(served.installer) }
    res.statusCode = 404
    res.end()
  })
  await new Promise(r => folder.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${folder.address().port}/updates/`
  const dir = mkdtempSync(join(tmpdir(), 'desktop-updates-verify-'))
  const fetchUpdate = (current = '0.1.0') => U.fetchUpdate({ baseUrl: base, currentVersion: current, dir, publicKey: testKey })

  const ready = await fetchUpdate()
  eq('a newer signed version is downloaded, checked and kept', [ready.status, ready.version, existsSync(ready.file), readFileSync(ready.file).equals(installer)], ['ready', '0.2.0', true, true])
  await fetchUpdate()
  eq('...and not downloaded again while the kept one still matches', downloads, 1)
  writeFileSync(ready.file, randomBytes(installer.length))
  const again = await fetchUpdate()
  eq('THE TRAP: a kept installer that no longer matches is downloaded again, never reused', [downloads, readFileSync(again.file).equals(installer)], [2, true])
  eq('the same version is current: nothing to do', (await fetchUpdate('0.2.0')).status, 'current')
  eq('...and so is an older one offered to a newer app: never a downgrade', (await fetchUpdate('0.3.0')).status, 'current')

  eq('the checked installer waits to run', await U.pendingInstaller(dir, '0.1.0'), ready.file)
  U.markAttempt(dir)
  eq('...still after one start', await U.pendingInstaller(dir, '0.1.0'), ready.file)
  U.markAttempt(dir)
  eq('THE TRAP: an installer started twice without the version changing is not started in a loop', await U.pendingInstaller(dir, '0.1.0'), null)
  eq('once installed, the waiting installer is cleared', [await U.pendingInstaller(dir, '0.2.0'), readdirSync(dir)], [null, []])

  await fetchUpdate()
  writeFileSync(ready.file, randomBytes(installer.length))
  eq('THE TRAP: an installer changed on disk after it was checked does not run, and is cleared',
    [await U.pendingInstaller(dir, '0.1.0'), readdirSync(dir)], [null, []])

  served = { manifest: signed(release()), installer: randomBytes(installer.length) }
  let refusal = ''
  try { await fetchUpdate() } catch (err) { refusal = err.message }
  eq('THE TRAP: an installer that does not match its signed manifest is not kept, and nothing half-downloaded is left',
    [/does not match/.test(refusal), readdirSync(dir)], [true, []])
  served = { manifest: signed(release()), installer: Buffer.concat([installer, randomBytes(10)]) }
  refusal = ''
  try { await fetchUpdate() } catch (err) { refusal = err.message }
  eq('...nor one larger than its manifest says', [/larger/.test(refusal), readdirSync(dir)], [true, []])
  served = { manifest: signed(release(), other.privateKey), installer }
  refusal = ''
  try { await fetchUpdate() } catch (err) { refusal = err.message }
  eq('THE TRAP: a manifest the release key did not sign downloads nothing', [/not signed/.test(refusal), downloads], [true, 5])

  folder.close()
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* the OS cleans temp */ }
} catch (err) {
  console.log(`  FAIL  the run stopped: ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`)
  fail++
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
