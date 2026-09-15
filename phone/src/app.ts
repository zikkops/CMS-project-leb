// The staff app's own screen: pair this phone with the café's hub, then open
// the till — POS software, stage 5 (owner's decision S11).
//
// It never talks to the hub itself. Pairing hands the address and the
// certificate fingerprint to the native HubPin plugin, which stores them and
// is the only thing that decides which certificate the app trusts. The hub's
// pages then load in this same WebView, from the hub's own address.

import { registerPlugin } from '@capacitor/core'
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from '@capacitor/barcode-scanner'
// The hub's page draws the QR from the same file, so the two cannot disagree
// about what a hub link is.
import { parseHubLink } from '../../shared/src/hubNetwork'

interface HubPinPlugin {
  get(): Promise<{ address?: string; fingerprint?: string }>
  pair(options: { address: string; fingerprint: string }): Promise<void>
  forget(): Promise<void>
  open(): Promise<void>
}

const HubPin = registerPlugin<HubPinPlugin>('HubPin')

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function say(problem: string | null) {
  const el = $('problem')
  el.textContent = problem ?? ''
  el.hidden = !problem
}

/** `AB:CD:…`, easier to compare by eye with the counter screen. */
const grouped = (hex: string) => hex.toUpperCase().match(/.{2}/g)?.join(':') ?? hex

async function show() {
  const hub = await HubPin.get()
  const paired = Boolean(hub.address && hub.fingerprint)
  $('unpaired').hidden = paired
  $('paired').hidden = !paired
  if (paired) {
    $('address').textContent = hub.address ?? ''
    $('fingerprint').textContent = grouped(hub.fingerprint ?? '')
  }
}

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
  await HubPin.forget()
  await show()
})

void show().catch(err => say(err instanceof Error ? err.message : 'The app could not start.'))
