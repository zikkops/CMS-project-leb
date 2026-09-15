// The BIG CMS POS for the café's Windows counter PC — POS software.
// Scope: the vault, "POS Software (Local Hub) - Scope".
//
// Online mode (stage 1): the hosted POS, full screen, talking to the cloud
// exactly as a browser tab does. What it adds is what a till needs and a tab
// does not give: it starts with Windows, stays full screen, keeps the display
// awake, cannot be navigated away from the POS, comes back from a crash on its
// own, and says plainly when there is no connection.
//
// Hub mode (stage 3): this PC is the café's hub. The app starts the POS server
// that travels inside it, with its database in the app's data folder, waits
// for it to answer, and opens it. The till then keeps trading with no internet,
// and the app starts the server again if it ever stops.
//
// It holds NO secrets in either mode. The Firebase Admin key never goes on a
// café PC (scope, "Security rule for the hub"): the hub server is started with
// a short list of environment variables that cannot carry it, and
// scripts/package-hub.mjs refuses to package a server that contains it.
//
// Every decision about addresses, permissions and the hub is policy.js,
// asserted by `npm run verify:desktop`. This file only applies it.

'use strict'

const { app, BrowserWindow, Menu, powerMonitor, powerSaveBlocker, session, shell, utilityProcess } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const {
  readConfig, isAllowedNavigation, isAllowedPermission,
  hubAddress, hubServerEnv, classifyHubProbe, hubRestartDelay,
} = require('./policy')
const { loadOrCreateCertificate, startLanFront } = require('./hubLan')
const updates = require('./update')

const SMOKE = process.argv.includes('--smoke')

let hub = null

// A smoke run reports the FIRST outcome and exits with it. A page that fails
// to load is followed by Chromium's own error page finishing loading, and
// reporting that as well turned "could not load the POS" into exit 0.
let smokeReported = false
function smokeReport(ok, detail) {
  if (smokeReported) return
  smokeReported = true
  console.log(JSON.stringify({ ok, ...detail }))
  if (hub) hub.stop()
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
  if (win.isDestroyed()) return
  const query = { url: config.posUrl, reason: String(reason ?? '') }
  if (config.mode === 'hub') query.hub = '1'
  win.loadFile(path.join(__dirname, 'offline.html'), { query })
}

function createWindow(config, { load }) {
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
      smokeReport(false, { code, description, url: config.posUrl })
      return
    }
    showOffline(win, config, description)
  })

  if (SMOKE) {
    // Only the POS itself counts: in hub mode the waiting screen loads first.
    contents.on('did-finish-load', () => {
      if (!isAllowedNavigation(contents.getURL(), config.posUrl)) return
      smokeReport(true, { url: contents.getURL(), title: contents.getTitle(), mode: config.mode })
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

  if (load) win.loadURL(config.posUrl)
  return win
}

// ── The café hub ───────────────────────────────────────────────────────────

/** Where the POS server is: inside the installer, or the folder package-hub.mjs assembles. */
function hubServerPath() {
  if (process.env.BIG_CMS_HUB_SERVER) return process.env.BIG_CMS_HUB_SERVER
  return app.isPackaged
    ? path.join(process.resourcesPath, 'hub', 'pos', 'server.js')
    : path.join(__dirname, 'hub-bundle', 'hub', 'pos', 'server.js')
}

/** One look at the hub's port, classified by policy.js. */
function probeHub(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/hub/session', timeout: 2000 }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { if (body.length < 4096) body += chunk })
      res.on('end', () => resolve(classifyHubProbe(res.statusCode, body)))
      res.on('error', () => resolve('starting'))
    })
    req.on('timeout', () => { req.destroy(); resolve('starting') })
    req.on('error', () => resolve('starting'))
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Starts the hub server and keeps it running.
 *
 * `onReady` when it answers as the hub, `onStopped` when it exits on its own
 * (it is started again, backing off), `onFailed` when it cannot be used: not
 * installed, another program on its port, or no answer within a minute.
 */
function startHub(config, { onReady, onStopped, onFailed }) {
  const serverPath = hubServerPath()
  // BIG_CMS_HUB_DATA is for development, so a smoke run does not use the
  // café's real database folder.
  const dataDir = process.env.BIG_CMS_HUB_DATA || path.join(app.getPath('userData'), 'hub')
  fs.mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'pos.db')
  const logFile = path.join(dataDir, 'hub.log')

  // The log is for somebody looking into a problem, and must not fill a disk.
  try { if (fs.statSync(logFile).size > 5_000_000) fs.renameSync(logFile, `${logFile}.old`) } catch { /* no log yet */ }
  const log = line => {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`) } catch { /* the hub runs without a log */ }
  }

  let child = null
  let stopping = false
  let attempt = 0
  let restartTimer = null
  // Phones on the café wifi (owner's decision S11): an encrypted door with the
  // hub's own certificate, opened once the server answers. Off unless
  // config.json has "hubLan": true. The server itself stays on 127.0.0.1.
  let lan = null
  let front = null
  let opening = false

  const stop = () => {
    stopping = true
    clearTimeout(restartTimer)
    if (child) child.kill()
    if (front) front.close()
  }

  if (!fs.existsSync(serverPath)) {
    onFailed(`The hub is not installed with this app: ${serverPath} is missing.`)
    return { stop, logFile }
  }

  if (config.hubLan) {
    try {
      const made = loadOrCreateCertificate(dataDir)
      lan = { port: config.hubLanPort, fingerprint: made.fingerprint, key: made.key, cert: made.cert }
      if (made.created) log(`made the hub's certificate (${made.created}), fingerprint ${made.fingerprint}`)
    } catch (err) {
      log(`no certificate, so phones on the café wifi cannot reach the hub: ${err?.message ?? err}`)
    }
  }

  const openLan = () => {
    if (!lan || front || opening) return
    opening = true
    startLanFront({
      key: lan.key, cert: lan.cert, port: lan.port, targetPort: config.hubPort,
      onError: err => log(`the café wifi door: ${err.message}`),
    })
      .then(server => {
        if (stopping) { server.close(); return }
        front = server
        log(`phones on the café wifi reach the hub on port ${lan.port}, encrypted`)
      })
      .catch(err => log(`could not open port ${lan.port} to the café wifi: ${err.message}`))
      .finally(() => { opening = false })
  }

  const launch = () => {
    if (stopping) return
    log(`starting ${serverPath} on port ${config.hubPort}, data in ${dbFile}`)
    const started = Date.now()
    const current = utilityProcess.fork(serverPath, [], {
      cwd: path.dirname(serverPath),
      env: hubServerEnv(process.env, {
        port: config.hubPort, dbFile, cloudUrl: config.cloudUrl,
        lan: lan && { port: lan.port, fingerprint: lan.fingerprint },
      }),
      stdio: 'pipe',
      serviceName: 'BIG CMS hub',
    })
    child = current
    current.stdout?.on('data', d => log(String(d).trimEnd()))
    current.stderr?.on('data', d => log(String(d).trimEnd()))

    current.on('exit', code => {
      log(`the hub server exited with code ${code}`)
      if (child === current) child = null
      if (stopping) return
      onStopped(code)
      restartTimer = setTimeout(launch, hubRestartDelay(attempt++))
    })

    void (async () => {
      while (!stopping && child === current) {
        const state = await probeHub(config.hubPort)
        if (stopping || child !== current) return
        if (state === 'ready') {
          attempt = 0
          log('the hub is answering')
          openLan()
          onReady()
          return
        }
        if (state === 'other') {
          onFailed(`Port ${config.hubPort} is answered by a program that is not the hub. Close it, or set another "hubPort" in config.json.`)
          stop()
          return
        }
        if (Date.now() - started > 60_000) {
          onFailed(`The hub did not start within a minute. Its log is ${logFile}.`)
          return
        }
        await sleep(500)
      }
    })()
  }

  launch()
  return { stop, logFile }
}

// ── Automatic updates (S26–S27) ────────────────────────────────────────────
// What to trust and when to install is update.js; this only schedules it and
// runs the installer.

const updatesDir = () => path.join(app.getPath('userData'), 'updates')

/** Runs a checked installer silently and leaves, stopping the hub first. It starts the app again. */
function runInstaller(file) {
  console.log(`[pos] installing the update ${path.basename(file)}`)
  updates.markAttempt(updatesDir())
  if (hub) hub.stop()
  spawn(file, updates.installerArgs(), { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  app.exit(0)
}

/** How many hub sessions are live, from the hub itself, or null when it does not say. */
function liveHubSessions(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/hub/quiet', timeout: 3000 }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { if (body.length < 1024) body += chunk })
      res.on('end', () => {
        try {
          const live = JSON.parse(body).live
          resolve(res.statusCode === 200 && Number.isInteger(live) ? live : null)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
  })
}

/** Looks for new versions every six hours, and installs one only when nobody is using the PC. */
function startUpdates(config) {
  let ready = false
  const check = async () => {
    try {
      const result = await updates.fetchUpdate({ baseUrl: config.updatesUrl, currentVersion: app.getVersion(), dir: updatesDir() })
      if (result.status === 'ready') {
        if (!ready) console.log(`[pos] version ${result.version} is downloaded and checked; it installs when nobody is using this PC`)
        ready = true
      }
    } catch (err) {
      console.error(`[pos] no update this time: ${err?.message ?? err}`)
    }
    setTimeout(check, updates.CHECK_EVERY_MS)
  }
  const look = async () => {
    if (ready) {
      const live = config.mode === 'hub' ? await liveHubSessions(config.hubPort) : 0
      if (updates.shouldInstallNow({ now: new Date(), idleSeconds: powerMonitor.getSystemIdleTime(), liveSessions: live })) {
        const file = await updates.pendingInstaller(updatesDir(), app.getVersion())
        if (file) return runInstaller(file)
        ready = false
      }
    }
    setTimeout(look, updates.INSTALL_LOOK_MS)
  }
  setTimeout(check, updates.FIRST_CHECK_MS)
  setTimeout(look, updates.INSTALL_LOOK_MS)
}

// One till per PC. A second launch brings the first to the front instead of
// opening a second POS beside it — and, on a hub, a second server fighting the
// first for the same database.
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

  app.whenReady().then(async () => {
    const { config: settings, file } = loadConfig()
    const onHub = settings.mode === 'hub'
    const config = onHub ? { ...settings, posUrl: hubAddress(settings.hubPort) } : settings
    console.log(`[pos] ${config.mode} mode, ${config.posUrl} (settings: ${file})`)

    // A checked update downloaded earlier installs at start, before anybody can
    // be using the till (S27). Only the installed app updates itself.
    const updating = app.isPackaged && !SMOKE && config.autoUpdate
    if (updating) {
      const pending = await updates.pendingInstaller(updatesDir(), app.getVersion()).catch(() => null)
      if (pending) {
        runInstaller(pending)
        return
      }
    }

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

    mainWindow = createWindow(config, { load: !onHub })
    if (updating) startUpdates(config)

    if (onHub) {
      showOffline(mainWindow, config, 'Starting the café hub…')
      hub = startHub(config, {
        onReady: () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(config.posUrl)
        },
        onStopped: code => {
          if (mainWindow) showOffline(mainWindow, config, `The café hub stopped (code ${code}). Starting it again.`)
        },
        onFailed: reason => {
          console.error(`[pos] ${reason}`)
          if (SMOKE) smokeReport(false, { reason, mode: 'hub' })
          else if (mainWindow) showOffline(mainWindow, config, reason)
        },
      })
    }
  })

  app.on('before-quit', () => { if (hub) hub.stop() })
  app.on('window-all-closed', () => app.quit())
}
