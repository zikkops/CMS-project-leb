// Automatic updates for the Windows counter app — POS software (owner's
// decisions S26–S27, 15 Sep 2026).
//
//   S26  New versions come from a folder on our own site (the POS server's
//        /api/desktop-updates/), not GitHub: the repository is private, and a
//        GitHub token in every counter PC would be copyable from any of them.
//   S27  A downloaded update installs only when nobody is using the PC: after
//        05:00 with the PC idle and nobody signed in, or at the next start.
//        Never mid-service.
//
// ── Trust ──────────────────────────────────────────────────────────────────
// The installer runs on every café's counter PC. So https is not enough: the
// manifest must be signed by the release key (scripts/release-desktop.mjs),
// whose public half is pinned below, and the installer must match the
// manifest's size and SHA-512, byte for byte, before it is kept, and again
// before it runs. Somebody who got into the website could serve anything, and
// every counter PC would ignore it.
//
// No Electron here, so scripts/verify-desktop.mjs can run all of it. main.js
// only decides when to call it, and runs the installer.

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/** The release key's public half (Ed25519, SPKI). Replacing it means reinstalling every counter PC by hand. */
const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAW7Y9goSdq6sIuj9RSzqdRWoi9KowFRVvzH99HdSqTU4='

const APP_ID = 'big-cms-counter'
const MIN_SIZE = 1_000_000
const MAX_SIZE = 1_000_000_000
const MANIFEST_MAX_BYTES = 16_000
const PENDING_FILE = 'pending.json'
/** An installer that has been started this many times without the version changing is not started again. */
const MAX_ATTEMPTS = 2

const FIRST_CHECK_MS = 2 * 60_000
const CHECK_EVERY_MS = 6 * 3600_000
const INSTALL_LOOK_MS = 5 * 60_000
/** The quiet morning window on the counter PC's own clock, which is the café's. */
const INSTALL_FROM_HOUR = 5
const INSTALL_UNTIL_HOUR = 10
const IDLE_BEFORE_INSTALL_S = 10 * 60

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/
const SHA512_B64 = /^[A-Za-z0-9+/]{86}==$/

const installerName = version => `BIG-CMS-POS-Setup-${version}.exe`

/** A version as three numbers, or null. */
function parseVersion(raw) {
  const m = typeof raw === 'string' ? VERSION.exec(raw) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Whether `candidate` is a later version than `current`, compared as numbers: 0.1.10 is after 0.1.9. */
function isNewer(candidate, current) {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** One pending or offered update, as its fields must be; null for anything else. */
function readRelease(d) {
  if (!d || typeof d !== 'object') return null
  if (!parseVersion(d.version)) return null
  if (d.file !== installerName(d.version)) return null
  if (!Number.isInteger(d.size) || d.size < MIN_SIZE || d.size > MAX_SIZE) return null
  if (typeof d.sha512 !== 'string' || !SHA512_B64.test(d.sha512)) return null
  return { version: d.version, file: d.file, size: d.size, sha512: d.sha512 }
}

/**
 * The update a manifest offers, or null unless the release key signed it. The
 * installer's name is its version's, so a signed manifest cannot be pointed at
 * another file, and nothing in it is a path.
 */
function readManifest(raw, publicKeyB64 = UPDATE_PUBLIC_KEY) {
  if (typeof raw !== 'string' || raw.length > MANIFEST_MAX_BYTES) return null
  let outer
  try { outer = JSON.parse(raw) } catch { return null }
  if (!outer || typeof outer.payload !== 'string' || typeof outer.signature !== 'string') return null
  let key
  try {
    key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' })
  } catch {
    return null
  }
  if (key.asymmetricKeyType !== 'ed25519') return null
  let signed = false
  try {
    signed = crypto.verify(null, Buffer.from(outer.payload, 'utf8'), key, Buffer.from(outer.signature, 'base64'))
  } catch {
    signed = false
  }
  if (!signed) return null
  let payload
  try { payload = JSON.parse(outer.payload) } catch { return null }
  if (!payload || payload.app !== APP_ID) return null
  return readRelease(payload)
}

/** Where an installer is, under the updates address and nowhere else. */
function installerUrl(baseUrl, file) {
  const base = new URL(baseUrl)
  const url = new URL(file, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('An installer outside the updates folder.')
  return url.href
}

/**
 * Whether a downloaded update may install now (S27): in the quiet morning
 * window, with the PC untouched for ten minutes and nobody signed in. `live` is
 * how many hub sessions are live, 0 for an online till, and null when a hub did
 * not say: then it waits.
 */
function shouldInstallNow({ now, idleSeconds, liveSessions }) {
  const hour = now.getHours()
  return hour >= INSTALL_FROM_HOUR && hour < INSTALL_UNTIL_HOUR
    && Number.isFinite(idleSeconds) && idleSeconds >= IDLE_BEFORE_INSTALL_S
    && liveSessions === 0
}

/** The installer runs silently, over the installed app, and starts it again. */
const installerArgs = () => ['/S', '--force-run']

async function sha512Of(file) {
  const hash = crypto.createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }) } catch { /* already gone, or in use: cleared next time */ }
}

/** Whether a file on disk is exactly this release's installer. */
async function matches(file, release) {
  try {
    if (fs.statSync(file).size !== release.size) return false
    return (await sha512Of(file)) === release.sha512
  } catch {
    return false
  }
}

function writePending(dir, release, attempts = 0) {
  fs.writeFileSync(path.join(dir, PENDING_FILE), JSON.stringify({ ...release, attempts }))
}

/**
 * Looks for a newer version and downloads it, checked, into `dir`. Resolves
 * { status: 'current' } or { status: 'ready', version, file }; throws with a
 * reason on anything else, leaving no partial or unchecked installer behind.
 */
async function fetchUpdate({ baseUrl, currentVersion, dir, fetchImpl = fetch, publicKey = UPDATE_PUBLIC_KEY }) {
  const base = new URL(baseUrl).href
  const res = await fetchImpl(new URL('latest.json', base).href, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`The updates folder answered ${res.status}.`)
  const text = await res.text()
  const release = readManifest(text, publicKey)
  if (!release) throw new Error('The update manifest is not signed by the release key, so it is ignored.')
  if (!isNewer(release.version, currentVersion)) return { status: 'current' }

  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, release.file)
  if (!(await matches(target, release))) {
    const part = `${target}.part`
    removeQuietly(part)
    const download = await fetchImpl(installerUrl(base, release.file), { signal: AbortSignal.timeout(30 * 60_000) })
    if (!download.ok || !download.body) throw new Error(`The installer answered ${download.status}.`)
    const hash = crypto.createHash('sha512')
    const fd = fs.openSync(part, 'w')
    let size = 0
    try {
      const reader = download.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > release.size) {
          await reader.cancel()
          throw new Error('The installer is larger than its manifest says.')
        }
        hash.update(value)
        fs.writeSync(fd, value)
      }
    } catch (err) {
      fs.closeSync(fd)
      removeQuietly(part)
      throw err
    }
    fs.closeSync(fd)
    if (size !== release.size || hash.digest('base64') !== release.sha512) {
      removeQuietly(part)
      throw new Error('The installer does not match its signed manifest, so it is not kept.')
    }
    fs.renameSync(part, target)
  }
  writePending(dir, release)
  return { status: 'ready', version: release.version, file: target }
}

/**
 * The downloaded installer to run, checked again byte for byte, or null: none
 * waiting, not newer than this version (it installed: cleared), changed on disk
 * (cleared), or already started MAX_ATTEMPTS times without the version changing
 * (left, so it is not started in a loop at every start).
 */
async function pendingInstaller(dir, currentVersion) {
  let pending
  try { pending = JSON.parse(fs.readFileSync(path.join(dir, PENDING_FILE), 'utf8')) } catch { return null }
  const release = readRelease(pending)
  const target = release ? path.join(dir, release.file) : null
  if (!release || !isNewer(release.version, currentVersion)) {
    if (target) removeQuietly(target)
    removeQuietly(path.join(dir, PENDING_FILE))
    return null
  }
  const attempts = Number.isInteger(pending.attempts) ? pending.attempts : 0
  if (attempts >= MAX_ATTEMPTS) return null
  if (!(await matches(target, release))) {
    removeQuietly(target)
    removeQuietly(path.join(dir, PENDING_FILE))
    return null
  }
  return target
}

/** Counts one start of the pending installer, before it runs. */
function markAttempt(dir) {
  try {
    const pending = JSON.parse(fs.readFileSync(path.join(dir, PENDING_FILE), 'utf8'))
    const release = readRelease(pending)
    if (release) writePending(dir, release, (Number.isInteger(pending.attempts) ? pending.attempts : 0) + 1)
  } catch { /* nothing pending */ }
}

/**
 * Why an installer about to be built must not be, or null (UPGRADE.md T0.3).
 *
 * A counter PC installs only a HIGHER version, so a second build under the
 * version already released never reaches any PC by update, and two different
 * builds with one number cannot be told apart by anybody. That is how, on 16
 * Sep 2026, a café laptop ran the 14 Sep build while everyone believed it had
 * the 16 Sep one: both said 0.1.0. `published` is the version in the last
 * signed latest.json, or null when nothing has been released from this PC.
 */
function releaseVersionProblem(version, published) {
  if (!parseVersion(version)) return `"${version}" is not a version like 1.2.3. Set "version" in desktop/package.json.`
  if (published === null || published === undefined) return null
  if (!parseVersion(published)) return null
  if (!isNewer(version, published)) {
    return `Version ${version} is not higher than ${published}, which is already released. Raise "version" in desktop/package.json (a counter PC installs only a higher one).`
  }
  return null
}

module.exports = {
  UPDATE_PUBLIC_KEY, MAX_ATTEMPTS, FIRST_CHECK_MS, CHECK_EVERY_MS, INSTALL_LOOK_MS,
  parseVersion, isNewer, readManifest, installerUrl, shouldInstallNow, installerArgs,
  fetchUpdate, pendingInstaller, markAttempt, releaseVersionProblem,
}
