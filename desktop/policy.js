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

const readMode = raw => (typeof raw === 'string' && MODES.has(raw) ? raw : null)

// Not a privileged port, and a real number: "3200" as text is a typo, not a port.
const readPort = raw => (Number.isInteger(raw) && raw >= 1024 && raw <= 65535 ? raw : null)

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
  return {
    posUrl: fromEnv ?? readPosUrl(src.posUrl) ?? DEFAULT_CONFIG.posUrl,
    kiosk: typeof src.kiosk === 'boolean' ? src.kiosk : DEFAULT_CONFIG.kiosk,
    startWithWindows: typeof src.startWithWindows === 'boolean' ? src.startWithWindows : DEFAULT_CONFIG.startWithWindows,
    mode: readMode(env?.BIG_CMS_DESKTOP_MODE) ?? readMode(src.mode) ?? DEFAULT_CONFIG.mode,
    hubPort: readPort(src.hubPort) ?? DEFAULT_CONFIG.hubPort,
    cloudUrl: readCloudUrl(env?.BIG_CMS_CLOUD_URL) ?? readCloudUrl(src.cloudUrl) ?? DEFAULT_CONFIG.cloudUrl,
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
 * on 127.0.0.1, so nothing else on the café network reaches it yet. localhost
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
function hubServerEnv(baseEnv, { port, dbFile, cloudUrl }) {
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

/** How long to wait before starting a stopped hub again: 1s, 2s, 4s… never more than 30s. */
function hubRestartDelay(attempt) {
  const n = Number.isInteger(attempt) && attempt > 0 ? Math.min(attempt, 10) : 0
  return Math.min(30_000, 1000 * 2 ** n)
}

module.exports = {
  DEFAULT_CONFIG, readPosUrl, readCloudUrl, readConfig, isAllowedNavigation, isAllowedPermission,
  hubAddress, hubServerEnv, classifyHubProbe, hubRestartDelay,
}
