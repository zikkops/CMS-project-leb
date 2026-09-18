// What the counter app decides about the outside world — which address it
// opens, where it may navigate, what it may be granted, and how it runs the
// café hub.
//
// No Electron in this file, so scripts/verify-desktop.mjs can load it and
// assert every decision (`npm run verify:desktop`). main.js only applies what
// this says, the same split as the rest of the repo: logic that drifts into
// main.js is logic nothing tests.

'use strict'

const DEFAULT_CONFIG = Object.freeze({
  posUrl: 'https://pos.cms-projectlb.com/pos',
  kiosk: true,
  startWithWindows: true,
  // 'online' opens the hosted POS. 'hub' runs the POS on this PC, the café's
  // hub (POS software, stage 3): it keeps trading with no internet.
  mode: 'online',
  hubPort: 3100,
  // Where a hub pairs and takes the menu from (stage 4): the hosted POS.
  cloudUrl: 'https://pos.cms-projectlb.com',
  // Phones on the café wifi reach a hub through an encrypted door with the
  // hub's own certificate (owner's decision S11, hubLan.js). Off until a café
  // sets phones up: nothing listens on the network before somebody asks it to.
  hubLan: false,
  hubLanPort: 3443,
  // New versions of this app (owner's decisions S26–S27, update.js): checked on
  // our own site, installed only when nobody is using the PC.
  autoUpdate: true,
  updatesUrl: 'https://pos.cms-projectlb.com/api/desktop-updates/',
})

const MODES = new Set(['online', 'hub'])

/**
 * The POS address the till opens: https, or http on this machine only, for
 * developing against `npm run dev:pos` and for the hub. Anything else is
 * refused — a till pointed at an unencrypted address on a café network sends
 * staff passwords across it in the clear.
 */
function readPosUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let url
  try { url = new URL(raw.trim()) } catch { return null }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.toString()
  return null
}

/**
 * Where the hub pairs and syncs: the same rule as the POS address, and only
 * its origin. A hub sends its credential there, so plain http across a network
 * is refused, and a path cannot aim that credential at some other route.
 */
function readCloudUrl(raw) {
  const url = readPosUrl(raw)
  return url ? new URL(url).origin : null
}

/**
 * Where new versions are looked for: the same rule as the POS address, as a
 * folder (a trailing slash, no query), so an installer's name can only be
 * looked up inside it.
 */
function readUpdatesUrl(raw) {
  const href = readPosUrl(raw)
  if (!href) return null
  const url = new URL(href)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

const readMode = raw => (typeof raw === 'string' && MODES.has(raw) ? raw : null)

// Not a privileged port, and a real number: "3200" as text is a typo, not a port.
const readPort = raw => (Number.isInteger(raw) && raw >= 1024 && raw <= 65535 ? raw : null)

// The encrypted port can never be the hub's own: that one stays on this PC.
function readLanPort(raw, hubPort) {
  const port = readPort(raw)
  if (port && port !== hubPort) return port
  return hubPort === DEFAULT_CONFIG.hubLanPort ? DEFAULT_CONFIG.hubLanPort + 1 : DEFAULT_CONFIG.hubLanPort
}

/**
 * The app's settings, from config.json in its data folder (raw text, or
 * nothing) and the environment. Unreadable or wrong-typed values fall back to
 * the defaults one by one, so a typo in one setting cannot switch the till
 * off full screen, point it somewhere else, or turn a hub into a browser tab.
 */
function readConfig(raw, env) {
  let src = {}
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) src = parsed
    } catch { /* unreadable: the defaults */ }
  }
  const fromEnv = env && typeof env.BIG_CMS_POS_URL === 'string' ? readPosUrl(env.BIG_CMS_POS_URL) : null
  const chosenMode = readMode(env?.BIG_CMS_DESKTOP_MODE) ?? readMode(src.mode)
  return {
    posUrl: fromEnv ?? readPosUrl(src.posUrl) ?? DEFAULT_CONFIG.posUrl,
    kiosk: typeof src.kiosk === 'boolean' ? src.kiosk : DEFAULT_CONFIG.kiosk,
    startWithWindows: typeof src.startWithWindows === 'boolean' ? src.startWithWindows : DEFAULT_CONFIG.startWithWindows,
    mode: chosenMode ?? DEFAULT_CONFIG.mode,
    // Nobody has chosen online till or café hub on this PC yet (S29): the app
    // opens its setup screen instead of guessing.
    modeChosen: chosenMode !== null,
    hubPort: readPort(src.hubPort) ?? DEFAULT_CONFIG.hubPort,
    cloudUrl: readCloudUrl(env?.BIG_CMS_CLOUD_URL) ?? readCloudUrl(src.cloudUrl) ?? DEFAULT_CONFIG.cloudUrl,
    hubLan: typeof src.hubLan === 'boolean' ? src.hubLan : DEFAULT_CONFIG.hubLan,
    hubLanPort: readLanPort(src.hubLanPort, readPort(src.hubPort) ?? DEFAULT_CONFIG.hubPort),
    autoUpdate: typeof src.autoUpdate === 'boolean' ? src.autoUpdate : DEFAULT_CONFIG.autoUpdate,
    updatesUrl: readUpdatesUrl(src.updatesUrl) ?? DEFAULT_CONFIG.updatesUrl,
  }
}

/**
 * Whether the till may navigate to this address: the POS's own origin, and
 * nothing else. A link to anywhere else opens in the real browser instead —
 * a counter screen that can wander off to another site is a counter screen
 * showing that site to the next customer.
 */
function isAllowedNavigation(url, posUrl) {
  try {
    const target = new URL(url)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
    return target.origin === new URL(posUrl).origin
  } catch {
    return false
  }
}

/**
 * The camera (scanning a customer's loyalty QR at the till) and going full
 * screen, for the POS's own pages. Location, notifications, the microphone,
 * USB and the rest are refused: the POS asks for none of them, and a
 * permission nothing needs is one that can only be misused.
 */
const ALLOWED_PERMISSIONS = new Set(['media', 'fullscreen', 'clipboard-sanitized-write'])

function isAllowedPermission(permission, requestingUrl, posUrl) {
  return ALLOWED_PERMISSIONS.has(permission) && isAllowedNavigation(requestingUrl, posUrl)
}

// ── The café hub ───────────────────────────────────────────────────────────

/**
 * The address the till opens in hub mode. This PC only: the hub server listens
 * on 127.0.0.1, and the café network reaches it only through the encrypted
 * door in hubLan.js, when `hubLan` is on. localhost
 * rather than 127.0.0.1 in the page address, because that is the name Firebase
 * sign-in already knows.
 */
function hubAddress(port) {
  return `http://localhost:${port}/pos`
}

// What Windows and Node need to run a server at all. Nothing else of this PC's
// environment is passed on.
const HUB_ENV_KEEP = [
  'SystemRoot', 'SYSTEMROOT', 'windir', 'SystemDrive', 'TEMP', 'TMP', 'Path', 'PATH', 'PATHEXT',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'COMPUTERNAME',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'TZ', 'LANG',
]

/**
 * The environment the hub server starts with.
 *
 * Built up from a short list, never a copy of this PC's environment minus a
 * few names. A developer's machine — or a PC somebody set up carelessly — may
 * hold FIREBASE_SERVICE_ACCOUNT, and the hub never holds the Admin key; nor
 * NODE_OPTIONS, which could load any code into the server that takes money.
 * A list of what to keep cannot miss a name nobody thought of.
 */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

function hubServerEnv(baseEnv, { port, dbFile, cloudUrl, lan = null, appVersion = null }) {
  const env = {}
  for (const key of HUB_ENV_KEEP) {
    if (typeof baseEnv?.[key] === 'string') env[key] = baseEnv[key]
  }
  return {
    ...env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    BIG_CMS_HUB_DB: dbFile,
    BIG_CMS_CLOUD_URL: cloudUrl,
    // Which counter app this is, shown on the hub page (UPGRADE.md T1.25). Only
    // a plain x.y.z, so nothing else can travel in it.
    ...(typeof appVersion === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(appVersion) ? { BIG_CMS_APP_VERSION: appVersion } : {}),
    // So the counter screen can show phones where the encrypted door is and
    // which certificate to trust. The server itself still listens on this PC only.
    ...(lan && readPort(lan.port) && FINGERPRINT.test(String(lan.fingerprint))
      ? { BIG_CMS_HUB_LAN_PORT: String(lan.port), BIG_CMS_HUB_CERT_SHA256: lan.fingerprint }
      : {}),
  }
}

/**
 * What a look at the hub's port found.
 *
 * 'ready' is OUR hub: /api/hub/session answering 401 with a JSON error, which
 * only a POS server running as a hub does. Anything else that answers is
 * 'other' — another program on the port, or a POS server that is not a hub —
 * and the till must not open it as if it were. No answer is 'starting'.
 */
function classifyHubProbe(status, body) {
  if (status === null || status === undefined) return 'starting'
  if (status === 401) {
    try {
      const parsed = JSON.parse(body)
      if (parsed && typeof parsed.error === 'string') return 'ready'
    } catch { /* not JSON: not the hub */ }
  }
  return 'other'
}

// ── Online till or café hub (owner's decisions S29–S30) ────────────────────

/**
 * The settings file with its mode set, every other setting kept as it was. A
 * file that cannot be read is replaced by one with only the mode: nothing in it
 * could be used anyway.
 */
function configWithMode(raw, mode) {
  if (!MODES.has(mode)) throw new Error(`"${mode}" is not a mode.`)
  return `${JSON.stringify({ ...parseConfigFile(raw), mode }, null, 2)}\n`
}

/** config.json as an object, or {} when it is missing or unreadable. */
function parseConfigFile(raw) {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* unreadable: start again */ }
  }
  return {}
}

/**
 * The settings the setup screen may change besides the mode, and what each
 * may be set to (UPGRADE.md T2.18). Only these: the setup page is the app's
 * own, but a list of what it may touch is what keeps it from becoming a way
 * to re-point the till or switch kiosk off.
 */
const SETUP_SETTINGS = {
  // Staff phones reach the hub through the encrypted door on the café wifi.
  hubLan: value => typeof value === 'boolean',
}

/** The settings file with one setup setting changed and every other kept, as configWithMode does. */
function configWithSetting(raw, key, value) {
  if (!Object.prototype.hasOwnProperty.call(SETUP_SETTINGS, key)) throw new Error(`"${key}" cannot be changed here.`)
  if (!SETUP_SETTINGS[key](value)) throw new Error(`That is not a value for "${key}".`)
  return `${JSON.stringify({ ...parseConfigFile(raw), [key]: value }, null, 2)}\n`
}

/** The manager's key combination for the setup screen: Ctrl+Shift+Alt+M. */
function isSetupShortcut(input) {
  return Boolean(input && input.type === 'keyDown' && input.control && input.shift && input.alt && String(input.key).toLowerCase() === 'm')
}

/**
 * Whether a page may use the setup screen's bridge to the app: the app's own
 * setup.html, loaded from the app's files, and nothing else. Never a POS page,
 * which comes from the network.
 */
function isSetupPage(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'file:' && /\/setup\.html$/.test(u.pathname)
  } catch {
    return false
  }
}

/** The name the old hub database is kept under when a PC leaves hub mode (S30): pos.db.hub-backup-20260915-221530. */
function hubBackupName(date) {
  const pad = n => String(n).padStart(2, '0')
  return `pos.db.hub-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** How long to wait before starting a stopped hub again: 1s, 2s, 4s… never more than 30s. */
function hubRestartDelay(attempt) {
  const n = Number.isInteger(attempt) && attempt > 0 ? Math.min(attempt, 10) : 0
  return Math.min(30_000, 1000 * 2 ** n)
}

module.exports = {
  DEFAULT_CONFIG, readPosUrl, readCloudUrl, readUpdatesUrl, readConfig, isAllowedNavigation, isAllowedPermission,
  hubAddress, hubServerEnv, classifyHubProbe, hubRestartDelay,
  configWithMode, configWithSetting, isSetupShortcut, isSetupPage, hubBackupName,
}
