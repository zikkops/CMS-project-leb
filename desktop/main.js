// The BIG CMS POS for the café's Windows counter PC — POS software, stage 1.
// Scope: the vault, "POS Software (Local Hub) - Scope".
//
// Online mode: the hosted POS, full screen, talking to the cloud exactly as a
// browser tab does. What it adds is what a till needs and a tab does not
// give: it starts with Windows, stays full screen, keeps the display awake,
// cannot be navigated away from the POS, comes back from a crash on its own,
// and says plainly when there is no connection.
//
// It holds NO secrets. The POS server routes need the Firebase Admin key, and
// that key never goes on a café PC (scope, "Security rule for the hub"). The
// local server comes in stage 3, with a hub credential of its own.
//
// Every decision about addresses and permissions is policy.js, asserted by
// `npm run verify:desktop`. This file only applies it.

'use strict'

const { app, BrowserWindow, Menu, powerSaveBlocker, session, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { readConfig, isAllowedNavigation, isAllowedPermission } = require('./policy')

const SMOKE = process.argv.includes('--smoke')

// A smoke run reports the FIRST outcome and exits with it. A page that fails
// to load is followed by Chromium's own error page finishing loading, and
// reporting that as well turned "could not load the POS" into exit 0.
let smokeReported = false
function smokeReport(ok, detail) {
  if (smokeReported) return
  smokeReported = true
  console.log(JSON.stringify({ ok, ...detail }))
  app.exit(ok ? 0 : 1)
}

function loadConfig() {
  const file = path.join(app.getPath('userData'), 'config.json')
  let raw = null
  try { raw = fs.readFileSync(file, 'utf8') } catch { /* no file yet: the defaults */ }
  return { config: readConfig(raw, process.env), file }
}

function openExternally(url) {
  // Only web addresses reach the real browser. A file:, javascript: or custom
  // scheme link from a page is never handed to the operating system.
  if (/^https?:\/\//i.test(url)) shell.openExternal(url)
}

function showOffline(win, config, reason) {
  win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: config.posUrl, reason: String(reason ?? '') } })
}

function createWindow(config) {
  const win = new BrowserWindow({
    width: 1366,
    height: 800,
    show: false,
    backgroundColor: '#0a0a0a',
    title: 'BIG CMS POS',
    autoHideMenuBar: true,
    kiosk: config.kiosk && !SMOKE,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })

  if (!SMOKE) win.once('ready-to-show', () => win.show())

  const contents = win.webContents

  // New windows: the POS's own pages (a receipt to print) stay in the app;
  // anything else goes to the real browser, never into the till.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url, config.posUrl)) return { action: 'allow' }
    openExternally(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, config.posUrl)) return
    event.preventDefault()
    openExternally(url)
  })

  // No connection and nothing cached: a clear screen that keeps retrying,
  // rather than Chromium's error page. -3 is a navigation replaced by another,
  // which is not a failure.
  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    if (SMOKE) {
      console.log(JSON.stringify({ ok: false, code, description, url: config.posUrl }))
      app.exit(1)
      return
    }
    showOffline(win, config, description)
  })

  if (SMOKE) {
    contents.once('did-finish-load', () => {
      console.log(JSON.stringify({ ok: true, url: contents.getURL(), title: contents.getTitle() }))
      app.exit(0)
    })
  }

  // A crashed page reloads on its own. A till that shows a dead screen until
  // somebody finds the keyboard is a till that is down.
  contents.on('render-process-gone', (_event, details) => {
    console.error('[pos] renderer gone:', details.reason)
    if (!win.isDestroyed()) win.loadURL(config.posUrl)
  })

  // Keys a manager needs, and nothing a customer would stumble on:
  //   Ctrl+Shift+Alt+K  leave or return to full screen (to reach Windows)
  //   Ctrl+R / F5       reload
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = String(input.key).toLowerCase()
    if (input.control && input.shift && input.alt && key === 'k') {
      event.preventDefault()
      win.setKiosk(!win.isKiosk())
    } else if ((input.control && !input.shift && !input.alt && key === 'r') || input.key === 'F5') {
      event.preventDefault()
      contents.reload()
    }
  })

  win.loadURL(config.posUrl)
  return win
}

// One till per PC. A second launch brings the first to the front instead of
// opening a second POS beside it.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow = null

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    const { config, file } = loadConfig()
    console.log(`[pos] ${config.posUrl} (settings: ${file})`)

    Menu.setApplicationMenu(null)

    const ses = session.defaultSession
    ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(isAllowedPermission(permission, details.requestingUrl ?? '', config.posUrl))
    })
    ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
      isAllowedPermission(permission, requestingOrigin ?? '', config.posUrl))

    if (!SMOKE) {
      // The counter screen stays on through a quiet afternoon.
      powerSaveBlocker.start('prevent-display-sleep')
      // Starting with Windows only means something for the installed app.
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.startWithWindows })
    }

    mainWindow = createWindow(config)
  })

  app.on('window-all-closed', () => app.quit())
}
