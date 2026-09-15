// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Checking a phone's key attestation when it registers — POS software, stage 5
// (owner's decisions S20, 15 Sep 2026). The DER reading and the rules are
// shared/src/keyAttestation.ts; this is the part that needs node:crypto and
// the internet: the chain's signatures, Google's roots, and Google's list of
// compromised keys.

import { X509Certificate, createHash, randomBytes } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { HttpError } from './auth'
import {
  ATTESTATION_OID,
  ENROL_CHALLENGE_MS,
  STAFF_KEY_CHALLENGES,
  certificateExtensions,
  normalizeSerial,
  readKeyDescription,
  readStatusList,
  statusListSeconds,
  type KeyDescription,
} from '../keyAttestation'

/**
 * Google's hardware attestation roots, from https://android.googleapis.com/attestation/root
 * (fetched 15 Sep 2026): the RSA root every older phone chains to, and the ECDSA
 * root that signs new chains from 1 Feb 2026. A root is matched by its public
 * key, because Google has reissued the RSA root's certificate over the same key.
 */
export const GOOGLE_ATTESTATION_ROOTS: readonly string[] = [
  `-----BEGIN CERTIFICATE-----
MIIFHDCCAwSgAwIBAgIJAPHBcqaZ6vUdMA0GCSqGSIb3DQEBCwUAMBsxGTAXBgNV
BAUTEGY5MjAwOWU4NTNiNmIwNDUwHhcNMjIwMzIwMTgwNzQ4WhcNNDIwMzE1MTgw
NzQ4WjAbMRkwFwYDVQQFExBmOTIwMDllODUzYjZiMDQ1MIICIjANBgkqhkiG9w0B
AQEFAAOCAg8AMIICCgKCAgEAr7bHgiuxpwHsK7Qui8xUFmOr75gvMsd/dTEDDJdS
Sxtf6An7xyqpRR90PL2abxM1dEqlXnf2tqw1Ne4Xwl5jlRfdnJLmN0pTy/4lj4/7
tv0Sk3iiKkypnEUtR6WfMgH0QZfKHM1+di+y9TFRtv6y//0rb+T+W8a9nsNL/ggj
nar86461qO0rOs2cXjp3kOG1FEJ5MVmFmBGtnrKpa73XpXyTqRxB/M0n1n/W9nGq
C4FSYa04T6N5RIZGBN2z2MT5IKGbFlbC8UrW0DxW7AYImQQcHtGl/m00QLVWutHQ
oVJYnFPlXTcHYvASLu+RhhsbDmxMgJJ0mcDpvsC4PjvB+TxywElgS70vE0XmLD+O
JtvsBslHZvPBKCOdT0MS+tgSOIfga+z1Z1g7+DVagf7quvmag8jfPioyKvxnK/Eg
sTUVi2ghzq8wm27ud/mIM7AY2qEORR8Go3TVB4HzWQgpZrt3i5MIlCaY504LzSRi
igHCzAPlHws+W0rB5N+er5/2pJKnfBSDiCiFAVtCLOZ7gLiMm0jhO2B6tUXHI/+M
RPjy02i59lINMRRev56GKtcd9qO/0kUJWdZTdA2XoS82ixPvZtXQpUpuL12ab+9E
aDK8Z4RHJYYfCT3Q5vNAXaiWQ+8PTWm2QgBR/bkwSWc+NpUFgNPN9PvQi8WEg5Um
AGMCAwEAAaNjMGEwHQYDVR0OBBYEFDZh4QB8iAUJUYtEbEf/GkzJ6k8SMB8GA1Ud
IwQYMBaAFDZh4QB8iAUJUYtEbEf/GkzJ6k8SMA8GA1UdEwEB/wQFMAMBAf8wDgYD
VR0PAQH/BAQDAgIEMA0GCSqGSIb3DQEBCwUAA4ICAQB8cMqTllHc8U+qCrOlg3H7
174lmaCsbo/bJ0C17JEgMLb4kvrqsXZs01U3mB/qABg/1t5Pd5AORHARs1hhqGIC
W/nKMav574f9rZN4PC2ZlufGXb7sIdJpGiO9ctRhiLuYuly10JccUZGEHpHSYM2G
tkgYbZba6lsCPYAAP83cyDV+1aOkTf1RCp/lM0PKvmxYN10RYsK631jrleGdcdkx
oSK//mSQbgcWnmAEZrzHoF1/0gso1HZgIn0YLzVhLSA/iXCX4QT2h3J5z3znluKG
1nv8NQdxei2DIIhASWfu804CA96cQKTTlaae2fweqXjdN1/v2nqOhngNyz1361mF
mr4XmaKH/ItTwOe72NI9ZcwS1lVaCvsIkTDCEXdm9rCNPAY10iTunIHFXRh+7KPz
lHGewCq/8TOohBRn0/NNfh7uRslOSZ/xKbN9tMBtw37Z8d2vvnXq/YWdsm1+JLVw
n6yYD/yacNJBlwpddla8eaVMjsF6nBnIgQOf9zKSe06nSTqvgwUHosgOECZJZ1Eu
zbH4yswbt02tKtKEFhx+v+OTge/06V+jGsqTWLsfrOCNLuA8H++z+pUENmpqnnHo
vaI47gC+TNpkgYGkkBT6B/m/U01BuOBBTzhIlMEZq9qkDWuM2cA5kW5V3FJUcfHn
w1IdYIg2Wxg7yHcQZemFQg==
-----END CERTIFICATE-----`,
  `-----BEGIN CERTIFICATE-----
MIICIjCCAaigAwIBAgIRAISp0Cl7DrWK5/8OgN52BgUwCgYIKoZIzj0EAwMwUjEc
MBoGA1UEAwwTS2V5IEF0dGVzdGF0aW9uIENBMTEQMA4GA1UECwwHQW5kcm9pZDET
MBEGA1UECgwKR29vZ2xlIExMQzELMAkGA1UEBhMCVVMwHhcNMjUwNzE3MjIzMjE4
WhcNMzUwNzE1MjIzMjE4WjBSMRwwGgYDVQQDDBNLZXkgQXR0ZXN0YXRpb24gQ0Ex
MRAwDgYDVQQLDAdBbmRyb2lkMRMwEQYDVQQKDApHb29nbGUgTExDMQswCQYDVQQG
EwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABCPaI3FO3z5bBQo8cuiEas4HjqCt
G/mLFfRT0MsIssPBEEU5Cfbt6sH5yOAxqEi5QagpU1yX4HwnGb7OtBYpDTB57uH5
Eczm34A5FNijV3s0/f0UPl7zbJcTx6xwqMIRq6NCMEAwDwYDVR0TAQH/BAUwAwEB
/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFFIyuyz7RkOb3NaBqQ5lZuA0QepA
MAoGCCqGSM49BAMDA2gAMGUCMETfjPO/HwqReR2CS7p0ZWoD/LHs6hDi422opifH
EUaYLxwGlT9SLdjkVpz0UUOR5wIxAIoGyxGKRHVTpqpGRFiJtQEOOTp/+s1GcxeY
uR2zh/80lQyu9vAFCj6E4AXc+osmRg==
-----END CERTIFICATE-----`,
]

export const STATUS_LIST_URL = 'https://android.googleapis.com/attestation/status'

const CHAIN_MIN = 2
const CHAIN_MAX = 8
const CERT_B64_MAX = 16_000
const STATUS_LIST_MAX_BYTES = 20_000_000

const refuse = (message: string) => new HttpError(400, message)

const spki = (cert: X509Certificate) => cert.publicKey.export({ type: 'spki', format: 'der' })

export interface AttestedChain {
  description: KeyDescription
  /** Every certificate's serial, as the status list writes them. */
  serials: string[]
}

/**
 * Reads the chain a phone sent and checks it is Google's statement about THIS
 * key: each certificate signed by the next, the last one a Google root, the
 * first one certifying the registered key, and the attestation extension in
 * the first certificate only. Throws 400 otherwise. Does not judge what the
 * statement says; attestationProblem() does.
 */
export function readAttestedChain(raw: unknown, publicKeyDer: Buffer, roots: readonly string[] = GOOGLE_ATTESTATION_ROOTS): AttestedChain {
  const broken = refuse('The phone did not send a genuine statement from its security chip. Update the staff app and register again.')
  if (!Array.isArray(raw) || raw.length < CHAIN_MIN || raw.length > CHAIN_MAX) throw broken
  const certs: X509Certificate[] = []
  const ders: Buffer[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.length > CERT_B64_MAX || !/^[A-Za-z0-9+/]+={0,2}$/.test(item)) throw broken
    const der = Buffer.from(item, 'base64')
    if (der.toString('base64') !== item) throw broken
    try {
      certs.push(new X509Certificate(der))
    } catch {
      throw broken
    }
    ders.push(der)
  }

  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i].verify(certs[i + 1].publicKey)) throw broken
  }
  const top = certs[certs.length - 1]
  const rootKeys = roots.map(pem => spki(new X509Certificate(pem)))
  if (!top.verify(top.publicKey) || !rootKeys.some(key => key.equals(spki(top)))) {
    throw refuse('This phone\'s security chip is not one Google vouches for, so it cannot sign in by itself. Ask a manager to approve your sign-ins.')
  }
  if (!spki(certs[0]).equals(publicKeyDer)) throw broken

  // Only the first certificate may carry the statement. A genuine attested key
  // can sign a certificate of its own saying anything; that forgery sits one
  // step further from the root, under a certificate that carries the real one.
  let description: KeyDescription | null = null
  try {
    const own = certificateExtensions(ders[0], ATTESTATION_OID)
    if (own.length !== 1) throw broken
    for (const der of ders.slice(1)) {
      if (certificateExtensions(der, ATTESTATION_OID).length > 0) throw broken
    }
    description = readKeyDescription(own[0])
  } catch {
    throw broken
  }
  if (!description) throw broken
  return { description, serials: certs.map(cert => normalizeSerial(cert.serialNumber)) }
}

export type StatusList = () => Promise<Set<string>>

/**
 * Google's list of compromised attestation keys, fetched when the last copy is
 * older than its Cache-Control allows (S20c). When it cannot be fetched and the
 * copy is out of date, registering waits: a 503 saying to try again.
 */
export function createStatusList(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  clock: () => number = Date.now,
): StatusList {
  let cached: { serials: Set<string>; freshUntil: number } | null = null
  return async () => {
    const now = clock()
    if (cached && now < cached.freshUntil) return cached.serials
    try {
      const res = await fetchImpl(STATUS_LIST_URL, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const text = await res.text()
      if (text.length > STATUS_LIST_MAX_BYTES) throw new Error('too large')
      const serials = readStatusList(JSON.parse(text))
      if (!serials) throw new Error('not the list')
      cached = { serials, freshUntil: now + statusListSeconds(res.headers.get('cache-control')) * 1000 }
      return serials
    } catch {
      throw new HttpError(503, 'The cloud could not check Google\'s list of compromised phones just now. Try registering again in a minute.')
    }
  }
}

export const googleStatusList: StatusList = createStatusList()

/** Refuses a chain any certificate of which Google lists as compromised. */
export async function refuseRevoked(chain: AttestedChain, statusList: StatusList = googleStatusList): Promise<void> {
  const listed = await statusList()
  if (chain.serials.some(serial => listed.has(serial))) {
    throw new HttpError(403, 'Google has reported this phone\'s security chip as compromised, so it cannot sign in by itself. Ask a manager to approve your sign-ins.')
  }
}

const challengeId = (challenge: Uint8Array) => createHash('sha256').update(challenge).digest('hex')

/**
 * A one-time challenge for registering, which the phone builds into its new
 * key's attestation. Asking again replaces the last one. Stored hashed, for
 * this person, for ENROL_CHALLENGE_MS.
 */
export async function issueEnrolChallenge(uid: string, db: Firestore, now = Date.now()): Promise<{ challenge: string; expiresAt: number }> {
  const challenge = randomBytes(32)
  const expiresAt = now + ENROL_CHALLENGE_MS
  await db.runTransaction(async tx => {
    const earlier = await tx.get(db.collection(STAFF_KEY_CHALLENGES).where('uid', '==', uid))
    for (const doc of earlier.docs) tx.delete(doc.ref)
    tx.create(db.doc(`${STAFF_KEY_CHALLENGES}/${challengeId(challenge)}`), { uid, expiresAt })
  })
  return { challenge: challenge.toString('base64url'), expiresAt }
}

/** Uses up the challenge an attestation names. Throws unless the cloud gave it to this person and it is still in time. */
export async function consumeEnrolChallenge(uid: string, challenge: Uint8Array, db: Firestore, now = Date.now()): Promise<void> {
  const stale = refuse('This registration was not started just now. Start again.')
  if (challenge.length !== 32) throw stale
  const ref = db.doc(`${STAFF_KEY_CHALLENGES}/${challengeId(challenge)}`)
  const ok = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const d = snap.data() ?? {}
    if (d.uid !== uid) return false
    tx.delete(ref)
    return typeof d.expiresAt === 'number' && now < d.expiresAt
  })
  if (!ok) throw stale
}
