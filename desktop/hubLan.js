// The café hub on the café wifi, encrypted — POS software (owner's decision
// S11, 15 Sep 2026).
//
// Phones reach the hub through the Android app and never over plain http. On
// a café wifi, a signed-in session sent in the clear can be copied off the air
// by anyone on the same network, and it would work until 05:00.
//
// So the hub server itself stays on 127.0.0.1, and this puts an encrypted door
// in front of it on the network: TLS with the hub's own certificate, made once
// on this PC. No authority signs a certificate for an address like
// 192.168.1.20, so no browser trusts it, and that is fine. The app trusts
// exactly this certificate, by its SHA-256 fingerprint, which it learns from
// the QR on the counter screen when it pairs.
//
// No Electron and no packages (the app has no runtime dependencies), so
// scripts/verify-desktop.mjs makes a certificate and runs a real handshake.

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const tls = require('node:tls')

// ── DER: only the shapes a certificate needs ──────────────────────────────

function tlv(tag, content) {
  const len = content.length
  if (len < 0x80) return Buffer.concat([Buffer.from([tag, len]), content])
  const bytes = []
  for (let n = len; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256)
  return Buffer.concat([Buffer.from([tag, 0x80 | bytes.length, ...bytes]), content])
}
const seq = (...items) => tlv(0x30, Buffer.concat(items))
const set = (...items) => tlv(0x31, Buffer.concat(items))

/** A positive INTEGER from big-endian bytes. */
function integer(bytes) {
  let i = 0
  while (i < bytes.length - 1 && bytes[i] === 0) i++
  let b = bytes.subarray(i)
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b])
  return tlv(0x02, b)
}

function oid(dotted) {
  const parts = dotted.split('.').map(Number)
  const out = [40 * parts[0] + parts[1]]
  for (const p of parts.slice(2)) {
    const group = [p % 128]
    for (let n = Math.floor(p / 128); n > 0; n = Math.floor(n / 128)) group.unshift((n % 128) | 0x80)
    out.push(...group)
  }
  return tlv(0x06, Buffer.from(out))
}

/** UTCTime until 2049 and GeneralizedTime from 2050, as X.509 requires. */
function time(date) {
  const digits = date.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return date.getUTCFullYear() < 2050
    ? tlv(0x17, Buffer.from(`${digits.slice(2)}Z`))
    : tlv(0x18, Buffer.from(`${digits}Z`))
}

function extension(id, critical, value) {
  return seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value))
}

function pem(label, der) {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'))

/** How long a hub certificate lasts. A new one means every phone pairs again, so: long. */
const CERT_YEARS = 10

/**
 * A new self-signed certificate and its private key (P-256), as PEM.
 *
 * It starts a day early, so a phone whose clock runs ahead of this PC's does
 * not see a certificate from the future.
 */
function createHubCertificate({ name = 'BIG CMS café hub', now = new Date(), years = CERT_YEARS } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const notBefore = new Date(now.getTime() - 24 * 3600_000)
  const notAfter = new Date(now.getTime())
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + years)
  const subject = seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(name, 'utf8')))))

  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))), // version 3
    integer(Buffer.concat([Buffer.from([1]), crypto.randomBytes(15)])), // a serial that is never zero
    ECDSA_SHA256,
    subject,
    seq(time(notBefore), time(notAfter)),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(
      extension('2.5.29.19', true, seq()), // not an authority: it signs nothing else
      extension('2.5.29.15', true, tlv(0x03, Buffer.from([0x07, 0x80]))), // digitalSignature only
      extension('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))), // a TLS server
    )),
  )
  const signature = crypto.sign('sha256', tbs, privateKey)
  const der = seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])))
  return { cert: pem('CERTIFICATE', der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
}

/** The fingerprint a phone pins: SHA-256 of the certificate, as `AB:CD:…`. */
function certificateFingerprint(cert) {
  return new crypto.X509Certificate(cert).fingerprint256
}

/** Renewed this long before it runs out, so a hub never serves an expired certificate. */
const RENEW_BEFORE_MS = 30 * 24 * 3600_000

/** Why a stored certificate cannot be used, or null. */
function certificateProblem(cert, key, now = new Date()) {
  let x
  try { x = new crypto.X509Certificate(cert) } catch { return 'unreadable certificate' }
  let privateKey
  try { privateKey = crypto.createPrivateKey(key) } catch { return 'unreadable key' }
  if (!x.checkPrivateKey(privateKey)) return 'the key is not this certificate\'s'
  if (!x.verify(x.publicKey)) return 'not signed by its own key'
  if (Date.parse(x.validTo) - now.getTime() < RENEW_BEFORE_MS) return 'runs out within 30 days'
  return null
}

const CERT_FILE = 'hub-tls.crt'
const KEY_FILE = 'hub-tls.key'

/**
 * The hub's certificate from its data folder, made when there is none or it
 * cannot be used. Kept, never remade on every start: a new certificate has a
 * new fingerprint, and every paired phone would stop trusting the hub.
 */
function loadOrCreateCertificate(dir, { fsImpl = fs, now = new Date() } = {}) {
  const certPath = path.join(dir, CERT_FILE)
  const keyPath = path.join(dir, KEY_FILE)
  let cert = null
  let key = null
  try {
    cert = fsImpl.readFileSync(certPath, 'utf8')
    key = fsImpl.readFileSync(keyPath, 'utf8')
  } catch { /* none yet */ }

  const problem = cert && key ? certificateProblem(cert, key, now) : 'none yet'
  if (!problem) return { cert, key, fingerprint: certificateFingerprint(cert), created: null }

  const made = createHubCertificate({ now })
  fsImpl.mkdirSync(dir, { recursive: true })
  // The key first: a certificate on disk without its key is one nobody can serve.
  fsImpl.writeFileSync(keyPath, made.key, { mode: 0o600 })
  fsImpl.writeFileSync(certPath, made.cert)
  return { ...made, fingerprint: certificateFingerprint(made.cert), created: problem }
}

/**
 * The encrypted door: TLS on the network, passed through to the hub server on
 * 127.0.0.1. Resolves once it is listening.
 *
 * The bytes inside are passed on untouched, so the change feed's long-lived
 * stream works through it as it does on this PC. A client that refuses the
 * certificate (a browser, say) is its own business, not an error of the hub's.
 */
function startLanFront({ key, cert, host = '0.0.0.0', port, targetPort, onError = () => {} }) {
  const server = tls.createServer({ key, cert, minVersion: 'TLSv1.2' }, socket => {
    const upstream = net.connect({ host: '127.0.0.1', port: targetPort })
    const close = () => { socket.destroy(); upstream.destroy() }
    socket.on('error', close)
    upstream.on('error', close)
    socket.on('close', () => upstream.destroy())
    upstream.on('close', () => socket.destroy())
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
  server.maxConnections = 256
  server.on('tlsClientError', () => {})
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      server.on('error', onError)
      resolve(server)
    })
  })
}

module.exports = {
  createHubCertificate, certificateFingerprint, certificateProblem, loadOrCreateCertificate, startLanFront,
  CERT_FILE, KEY_FILE,
}
