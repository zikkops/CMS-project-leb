// Idempotency keys for admin submissions — a delivery, a sale, a stock
// transfer, a weekly order.
//
// The same failure as the POS's doubled order, with worse consequences. A
// request that reaches the server but loses its reply looks like a failure;
// the person presses Save again; the server does the thing a second time.
// For these four "the thing" is stock and money: a delivery posted twice
// doubles stock and skews the average cost, a sale recorded twice deducts
// twice and issues two invoices, a transfer runs twice, a supplier gets two
// orders for one week. Receiving happens on a phone at a back door, which is
// exactly where replies get lost.
//
// ── What a key is ──────────────────────────────────────────────────────────
// A nonce for the kind of submission, plus a hash of what is being submitted.
//
//   same payload, no answer yet   → same key: the retry finds the first result
//   edited payload                → new key: it is a different submission
//   any answer arrives            → nonce resets: a second, identical sale is a
//                                   real second sale and must not be swallowed
//
// "Any answer" includes a refusal. When the server says no, nothing was
// written, and the next attempt is a new one. Only NO answer keeps the key.
//
// Nothing here knows about the browser or Firestore — the nonce generator is
// passed in — so a verifier can run it standalone.

/** What a request key may look like on the wire. */
export const REQUEST_KEY_PATTERN = /^[A-Za-z0-9-]{8,80}$/

/**
 * A short, stable hash of a string (cyrb53). Not cryptographic, and it does
 * not need to be: it only has to change when the submission changes.
 */
export function stableHash(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)
}

export interface RequestKeys {
  /** The key for submitting this payload now. Stable until settled(). */
  keyFor(kind: string, payload: unknown): string
  /** An answer arrived — the next submission of this kind is a new one. */
  settled(kind: string): void
}

export function createRequestKeys(newNonce: () => string): RequestKeys {
  const nonces = new Map<string, string>()
  return {
    keyFor(kind, payload) {
      let nonce = nonces.get(kind)
      if (!nonce) {
        nonce = newNonce()
        nonces.set(kind, nonce)
      }
      return `${nonce}-${stableHash(JSON.stringify(payload))}`
    },
    settled(kind) {
      nonces.delete(kind)
    },
  }
}
