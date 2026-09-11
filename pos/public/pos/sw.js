/*
 * The counter device's service worker — Phase 04, slice 7a.
 *
 * Registered by /pos/counter, and only on a device somebody has marked as the
 * counter (owner's decision, 12 Sep 2026: one device works offline, not every
 * waiter's phone). Scope is /pos/, which is what this file's location buys —
 * a worker can only control paths at or below its own.
 *
 * ── What it does, and what it deliberately does not ────────────────────────
 * It keeps the counter screen and its JavaScript on the device, so an outage
 * does not turn the till into a blank page. That is all. It does not cache
 * anything from /api/: a stale answer about money reads exactly like a fresh
 * one and there is no way to tell them apart afterwards. Orders taken offline
 * go into the outbox (pos/app/lib/outbox.ts) and are sent when the connection
 * is back — the queue is the offline story, not this file.
 *
 * Firestore's own IndexedDB cache carries the READS — the menu, the open
 * checks — and it is cross-origin, so those requests are not this worker's
 * business either. Hence the origin check below.
 *
 * ── Changing this file ─────────────────────────────────────────────────────
 * Bump VERSION. Old caches are deleted on activate by that prefix, and the
 * header in next.config.ts stops the worker itself ever being cached — without
 * that, a device keeps the old worker, which keeps serving old code, and no
 * deploy ever reaches it.
 */

const VERSION = 'pos-counter-v1'
const SHELL = `${VERSION}-shell`
const STATIC = `${VERSION}-static`
const COUNTER = '/pos/counter'

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL)
    try {
      // 'reload': fetch it from the network, not from the browser's own HTTP
      // cache, so installing a new worker cannot enshrine a stale page.
      await cache.add(new Request(COUNTER, { cache: 'reload' }))
    } catch (err) {
      // Registered while the connection was already down. The worker still
      // installs: the pages loaded from now on get cached as they are used.
      console.warn('[pos sw] could not precache the counter screen:', err)
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter(n => n.startsWith('pos-counter-') && !n.startsWith(VERSION))
      .map(n => caches.delete(n)))
    await self.clients.claim()
  })())
})

/** Hashed and immutable — if it is on the device, it is the right one. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

/**
 * The network wins whenever it answers — a till showing yesterday's page
 * because it had one is the failure this is supposed to prevent, not cause.
 * The cache is what is left when there is no answer at all.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true })
    if (hit) return hit
    throw err
  }
}

async function navigate(request) {
  try {
    return await networkFirst(request, SHELL)
  } catch {
    // Any /pos/ page asked for while offline lands on the counter screen,
    // because it is the one that works without a server. Everything else in
    // the POS — a check page, the drawer, the KDS — is rendered per request.
    const cache = await caches.open(SHELL)
    const counter = await cache.match(COUNTER, { ignoreSearch: true })
    if (counter) return counter
    // System colours and a declared scheme, not the palette: a worker cannot
    // read the app's stylesheet, and a hex code copied in here is a colour
    // that stops following the brand the moment the brand changes.
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
      '<meta name="color-scheme" content="dark">' +
      '<body style="background:Canvas;color:CanvasText;font:16px/1.7 system-ui;padding:2rem">' +
      '<p>No connection, and this device has not loaded the counter screen yet.</p>' +
      '<p>Open it once while the wifi is up and it will work without one after that.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

self.addEventListener('fetch', event => {
  const request = event.request
  // A POST is an order or a payment. It must reach the server or fail loudly
  // so the outbox can hold it; there is nothing sensible to serve from a cache.
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Firestore, Firebase Auth, Google's APIs. Their SDKs do their own offline
  // handling and intercepting them here would only get in the way.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC))
    return
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request))
    return
  }
  if (url.pathname.startsWith('/pos/')) {
    event.respondWith(networkFirst(request, SHELL))
  }
})
