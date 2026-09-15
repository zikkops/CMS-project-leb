// The staff app's own screen — POS software, stage 5 (owner's decisions S6, S11–S17).
//
// 1. Pair this phone with the café's hub, by its QR (S11).
// 2. Register the phone once, online: the staff member's normal email and
//    password, then their fingerprint. The cloud checks the password and
//    records the phone's public key (S13).
// 3. Sign in at the hub with a fingerprint, with or without the internet (S12),
//    and open the till signed in until 05:00 (S14).
// 4. With no fingerprint on the phone, ask a manager: choose your first name,
//    and a manager approves from their own phone with their fingerprint (S6,
//    S15–S17). The app collects the session once approved.
//
// The native HubPin plugin holds the pin and the key, and makes every request:
// to the hub trusting only its certificate, to Firebase and the cloud as any
// app does. The password goes to Firebase and nowhere else, and is never kept.

import { registerPlugin } from '@capacitor/core'
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from '@capacitor/barcode-scanner'
// The hub draws the QR, checks the signatures and reads the hand-off from these
// same files, so the app and the hub cannot disagree about any of them.
import { parseHubLink } from '../../shared/src/hubNetwork'
import { enrolMessage, handoffHash, signInMessage } from '../../shared/src/staffKeys'
import { approveMessage, denyMessage } from '../../shared/src/staffApprovals'

interface Reply { status: number; body: string }

interface HubPinPlugin {
  get(): Promise<{ address?: string; fingerprint?: string }>
  pair(options: { address: string; fingerprint: string }): Promise<void>
  forget(): Promise<void>
  open(options?: { hash?: string }): Promise<void>
  keyStatus(): Promise<{ hasKey: boolean; publicKey?: string; strongBiometrics: boolean; model: string }>
  createKey(): Promise<{ publicKey: string }>
  deleteKey(): Promise<void>
  sign(options: { message: string; title?: string; subtitle?: string }): Promise<{ signature: string }>
  hubRequest(options: { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown> }): Promise<Reply>
  webRequest(options: { url: string; method: 'GET' | 'POST'; body?: Record<string, unknown>; bearer?: string }): Promise<Reply>
}

const HubPin = registerPlugin<HubPinPlugin>('HubPin')

/** Which account this phone's key is registered to, kept on the phone so the screen can say so. */
const REGISTERED = 'bigcms-registered'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function say(problem: string | null, note = false) {
  const el = $('problem')
  el.textContent = problem ?? ''
  el.className = note ? 'note' : 'problem'
  el.hidden = !problem
}

/** `AB:CD:…`, easier to compare by eye with the counter screen. */
const grouped = (hex: string) => hex.toUpperCase().match(/.{2}/g)?.join(':') ?? hex

const json = (reply: Reply): Record<string, unknown> => {
  try { return JSON.parse(reply.body) as Record<string, unknown> } catch { return {} }
}

const refusal = (reply: Reply, fallback: string) => {
  const e = json(reply).error
  return typeof e === 'string' ? e : fallback
}

async function keyIdOf(publicKeyBase64: string): Promise<string> {
  const der = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der))
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function registered(): { uid: string; keyId: string; email: string } | null {
  try {
    const r = JSON.parse(localStorage.getItem(REGISTERED) ?? 'null')
    return r && typeof r.keyId === 'string' && typeof r.uid === 'string' ? r : null
  } catch {
    return null
  }
}

async function show() {
  const hub = await HubPin.get()
  const paired = Boolean(hub.address && hub.fingerprint)
  $('unpaired').hidden = paired
  $('paired').hidden = !paired
  $('registerForm').hidden = true
  $('askForm').hidden = true
  if (!paired) return
  $('address').textContent = hub.address ?? ''
  $('fingerprint').textContent = grouped(hub.fingerprint ?? '')
  const status = await HubPin.keyStatus()
  const reg = status.hasKey ? registered() : null
  $('signIn').hidden = !reg
  // Approving needs the manager's own registered key; the hub checks they are a manager.
  $('managerTools').hidden = !reg
  $('whoIsRegistered').textContent = reg ? `This phone signs in as ${reg.email}.` : 'This phone is not registered for fingerprint sign-in yet.'
  $('register').textContent = reg ? 'Register this phone again' : 'Register this phone'
  $<HTMLInputElement>('deviceName').value ||= status.model
}

// ── Pairing (S11) ──────────────────────────────────────────────────────────

async function pairWith(text: string) {
  const hub = parseHubLink(text.trim())
  if (!hub) {
    say('That is not a café hub\'s code. Use the one under "Phones on the café wifi" on the counter PC.')
    return
  }
  try {
    await HubPin.pair(hub)
    say(null)
    await show()
  } catch (err) {
    say(err instanceof Error ? err.message : 'This phone could not be paired.')
  }
}

$('scan').addEventListener('click', async () => {
  say(null)
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: 'Point the camera at the code on the counter PC',
    })
    await pairWith(result.ScanResult ?? '')
  } catch (err) {
    say(`Scanning did not work${err instanceof Error && err.message ? ` (${err.message})` : ''}. Paste the link instead.`)
  }
})

$('usePasted').addEventListener('click', () => { void pairWith($<HTMLTextAreaElement>('link').value) })

// ── Registering the phone, once, online (S13) ─────────────────────────────

$('register').addEventListener('click', () => {
  say(null)
  $('registerForm').hidden = false
})

$('registerForm').addEventListener('submit', async e => {
  e.preventDefault()
  const email = $<HTMLInputElement>('email').value.trim()
  const passwordField = $<HTMLInputElement>('password')
  const button = $<HTMLButtonElement>('registerSubmit')
  button.disabled = true
  say('Registering…', true)
  try {
    const status = await HubPin.keyStatus()
    if (!status.strongBiometrics) {
      throw new Error('This phone has no fingerprint (or face unlock Android counts as strong) set up. Add one in the phone\'s settings, or ask a manager.')
    }

    const setupReply = await HubPin.hubRequest({ method: 'GET', path: '/api/hub/phone-setup' })
    if (setupReply.status !== 200) throw new Error(refusal(setupReply, 'The hub could not say where the cloud is.'))
    const setup = json(setupReply) as { cloudUrl?: string; firebaseApiKey?: string }
    if (!setup.cloudUrl || !setup.firebaseApiKey) throw new Error('The hub could not say where the cloud is.')

    // The password goes to Firebase, as on the sign-in page, and is never kept.
    const signInReply = await HubPin.webRequest({
      method: 'POST',
      url: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(setup.firebaseApiKey)}`,
      body: { email, password: passwordField.value, returnSecureToken: true },
    })
    passwordField.value = ''
    const account = json(signInReply) as { idToken?: string; localId?: string }
    if (signInReply.status !== 200 || !account.idToken || !account.localId) {
      // One message for every failure, as on the sign-in page.
      throw new Error('That email and password did not match an account.')
    }

    const publicKey = status.hasKey ? status.publicKey! : (await HubPin.createKey()).publicKey
    const keyId = await keyIdOf(publicKey)
    const { signature: proof } = await HubPin.sign({ message: enrolMessage(account.localId, keyId), title: 'Register this phone', subtitle: email })

    const cloudReply = await HubPin.webRequest({
      method: 'POST',
      url: `${setup.cloudUrl}/api/staff-keys`,
      bearer: account.idToken,
      body: { publicKey, proof, deviceName: $<HTMLInputElement>('deviceName').value },
    })
    if (cloudReply.status !== 200) throw new Error(refusal(cloudReply, 'The cloud did not register this phone.'))

    localStorage.setItem(REGISTERED, JSON.stringify({ uid: account.localId, keyId, email }))
    await show()
    say('Registered. The hub picks this phone up at its next sync, within two minutes; then sign in with your fingerprint.', true)
  } catch (err) {
    say(err instanceof Error ? err.message : 'This phone could not be registered.')
  } finally {
    passwordField.value = ''
    button.disabled = false
  }
})

// ── Signing in with a fingerprint, at the hub, with or without internet (S12, S14) ──

$('signIn').addEventListener('click', async () => {
  const reg = registered()
  const hub = await HubPin.get()
  if (!reg || !hub.fingerprint) return
  say('Signing in…', true)
  try {
    const challengeReply = await HubPin.hubRequest({ method: 'POST', path: '/api/hub/key-signin', body: { action: 'challenge', keyId: reg.keyId } })
    if (challengeReply.status !== 200) throw new Error(refusal(challengeReply, 'The hub did not answer.'))
    const { nonce } = json(challengeReply) as { nonce?: string }
    if (!nonce) throw new Error('The hub did not answer.')

    const { signature } = await HubPin.sign({ message: signInMessage(hub.fingerprint, reg.keyId, nonce), title: 'Sign in to the till', subtitle: reg.email })

    const signInReply = await HubPin.hubRequest({ method: 'POST', path: '/api/hub/key-signin', body: { action: 'signin', keyId: reg.keyId, nonce, signature } })
    const { token } = json(signInReply) as { token?: string }
    if (signInReply.status !== 200 || !token) throw new Error(refusal(signInReply, 'The hub did not sign you in.'))

    say(null)
    await HubPin.open({ hash: handoffHash(token) })
  } catch (err) {
    say(err instanceof Error ? err.message : 'The phone could not sign you in.')
  }
})

// ── No fingerprint on this phone: ask a manager (S6, S15, S17) ────────────

let waiting: ReturnType<typeof setTimeout> | undefined

function stopWaiting(message: string | null, note = false) {
  clearTimeout(waiting)
  waiting = undefined
  $('waitingForManager').hidden = true
  say(message, note)
}

$('askManager').addEventListener('click', async () => {
  say(null)
  try {
    const reply = await HubPin.hubRequest({ method: 'GET', path: '/api/hub/approvals?view=people' })
    if (reply.status !== 200) throw new Error(refusal(reply, 'The hub did not answer.'))
    const people = (json(reply).people ?? []) as { uid: string; label: string }[]
    $<HTMLSelectElement>('person').replaceChildren(...people.map(p => new Option(p.label, p.uid)))
    $('askForm').hidden = false
  } catch (err) {
    say(err instanceof Error ? err.message : 'The hub did not answer.')
  }
})

/** Asks the hub for a manager's approval and waits for the answer, then opens the till. */
async function askAndWait(body: Record<string, unknown>, waitingText: string) {
  try {
    const status = await HubPin.keyStatus()
    const reply = await HubPin.hubRequest({ method: 'POST', path: '/api/hub/approvals', body: { action: 'ask', deviceName: status.model, ...body } })
    if (reply.status !== 200) throw new Error(refusal(reply, 'The hub did not take the request.'))
    const { id, secret, expiresAt } = json(reply) as { id?: string; secret?: string; expiresAt?: number }
    if (!id || !secret) throw new Error('The hub did not take the request.')
    $('askForm').hidden = true
    $('waitingText').textContent = waitingText
    $('waitingForManager').hidden = false
    say(null)

    const poll = async () => {
      if (Date.now() > Number(expiresAt ?? 0) + 5_000) return stopWaiting('Nobody approved it in time. Ask again.')
      try {
        const answer = await HubPin.hubRequest({ method: 'POST', path: '/api/hub/approvals', body: { action: 'collect', id, secret } })
        const data = json(answer) as { status?: string; token?: string }
        if (answer.status === 200 && data.status === 'approved' && data.token) {
          stopWaiting(null)
          await HubPin.open({ hash: handoffHash(data.token) })
          return
        }
        if (answer.status !== 200) return stopWaiting(refusal(answer, 'The request did not go through.'))
        if (data.status === 'expired') return stopWaiting('Nobody approved it in time. Ask again.')
        if (data.status === 'denied') return stopWaiting('A manager turned this request down. Talk to them before asking again.')
        if (data.status === 'collected') return stopWaiting('That request is closed. Ask again.')
      } catch {
        // No answer this time: the wifi. Keep asking until the request runs out.
      }
      waiting = setTimeout(() => { void poll() }, 3_000)
    }
    waiting = setTimeout(() => { void poll() }, 3_000)
  } catch (err) {
    say(err instanceof Error ? err.message : 'The hub did not take the request.')
  }
}

$('askForm').addEventListener('submit', e => {
  e.preventDefault()
  const select = $<HTMLSelectElement>('person')
  const label = select.selectedOptions[0]?.textContent ?? ''
  void askAndWait({ uid: select.value }, `Waiting for a manager to approve ${label}. Show them this phone, or ask them to open "Approve a sign-in" in their app.`)
})

// A shared tablet in the kitchen (S19): a manager approves it as a kitchen
// screen, and it opens the kitchen display, signed in as the screen, until 05:00.
$('kitchenScreen').addEventListener('click', () => {
  say(null)
  void askAndWait({ kind: 'screen' }, 'Waiting for a manager to approve this device as a kitchen screen. Ask them to open "Approve a sign-in" in their app.')
})

$('stopWaiting').addEventListener('click', () => stopWaiting(null))

// ── Managers: approve somebody's sign-in with your own fingerprint (S16) ──

/** Approve or turn down one request; either way with the manager's own fingerprint (S16). */
async function answer(request: { id: string; label: string; deviceName: string }, approve: boolean) {
  const reg = registered()
  const hub = await HubPin.get()
  if (!reg || !hub.fingerprint) return
  try {
    const challengeReply = await HubPin.hubRequest({ method: 'POST', path: '/api/hub/approvals', body: { action: 'challenge', keyId: reg.keyId } })
    if (challengeReply.status !== 200) throw new Error(refusal(challengeReply, 'The hub did not answer.'))
    const { nonce } = json(challengeReply) as { nonce?: string }
    if (!nonce) throw new Error('The hub did not answer.')

    const { signature } = await HubPin.sign({
      message: (approve ? approveMessage : denyMessage)(hub.fingerprint, request.id, reg.keyId, nonce),
      title: approve ? `Approve ${request.label}` : `Turn down ${request.label}`,
      subtitle: `Signing in on ${request.deviceName}`,
    })
    const reply = await HubPin.hubRequest({
      method: 'POST', path: '/api/hub/approvals',
      body: { action: approve ? 'approve' : 'deny', id: request.id, keyId: reg.keyId, nonce, signature },
    })
    if (reply.status !== 200) throw new Error(refusal(reply, 'The hub did not take the answer.'))
    say(approve ? `Approved ${request.label}. Their phone opens the till in a moment.` : `Turned down ${request.label}. Their phone is told.`, true)
    await loadRequests()
  } catch (err) {
    say(err instanceof Error ? err.message : 'The answer did not go through.')
  }
}

async function loadRequests() {
  const list = $('requestList')
  try {
    const reply = await HubPin.hubRequest({ method: 'GET', path: '/api/hub/approvals?view=waiting' })
    if (reply.status !== 200) throw new Error(refusal(reply, 'The hub did not answer.'))
    const requests = (json(reply).waiting ?? []) as { id: string; label: string; deviceName: string }[]
    if (requests.length === 0) {
      const empty = document.createElement('p')
      empty.textContent = 'Nobody is waiting for approval.'
      list.replaceChildren(empty)
      return
    }
    list.replaceChildren(...requests.map(request => {
      const row = document.createElement('div')
      row.className = 'request'
      const text = document.createElement('p')
      const who = request.label.charAt(0).toUpperCase() + request.label.slice(1)
      text.textContent = `${who} wants to sign in on ${request.deviceName}.`
      const approveButton = document.createElement('button')
      approveButton.type = 'button'
      approveButton.className = 'primary'
      approveButton.textContent = `Approve ${request.label} with my fingerprint`
      approveButton.addEventListener('click', () => { void answer(request, true) })
      const denyButton = document.createElement('button')
      denyButton.type = 'button'
      denyButton.className = 'danger'
      denyButton.textContent = 'Turn down'
      denyButton.addEventListener('click', () => { void answer(request, false) })
      row.append(text, approveButton, denyButton)
      return row
    }))
  } catch (err) {
    say(err instanceof Error ? err.message : 'The hub did not answer.')
  }
}

$('managerRequests').addEventListener('click', () => { say(null); void loadRequests() })

$('open').addEventListener('click', async () => {
  say(null)
  try {
    await HubPin.open()
  } catch (err) {
    say(err instanceof Error ? err.message : 'The till could not be opened.')
  }
})

$('forget').addEventListener('click', async () => {
  if (!window.confirm('Forget this hub? To use the till again, this phone has to scan the counter PC\'s code again.')) return
  stopWaiting(null)
  await HubPin.forget()
  await show()
})

void show().catch(err => say(err instanceof Error ? err.message : 'The app could not start.'))
