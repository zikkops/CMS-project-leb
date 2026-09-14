// What the counter app decides about the outside world — which address it
// opens, where it may navigate, what it may be granted.
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
})

/**
 * The POS address the till opens: https, or http on this machine only, for
 * developing against `npm run dev:pos`. Anything else is refused — a till
 * pointed at an unencrypted address on a café network sends staff passwords
 * across it in the clear.
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
 * The app's settings, from config.json in its data folder (raw text, or
 * nothing) and the environment. Unreadable or wrong-typed values fall back to
 * the defaults one by one, so a typo in one setting cannot switch the till
 * off full screen or point it somewhere else.
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

module.exports = { DEFAULT_CONFIG, readPosUrl, readConfig, isAllowedNavigation, isAllowedPermission }
