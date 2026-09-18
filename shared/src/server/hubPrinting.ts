// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The café hub prints to network printers itself — POS software (owner's
// decision S28). Which changes make a job is shared/src/hubPrinting.ts; the
// bytes are shared/src/escpos.ts.
//
// It follows the hub's own commits (HubStore.onChange): a kitchen ticket sent,
// a check closed. Each job is created once, under its ticket's or check's id,
// then sent to the printer's port over the café network. One job at a time, so
// two tickets never interleave on one printer. Nothing here throws into a
// commit: a printer that is off is a job that failed, recorded and shown on the
// hub's page, while the order is already on the screen.

import { createConnection } from 'node:net'
import { adminDb, hubDbPath } from './firebaseAdmin'
import type { HubChange, HubStore } from './hubStore'
import type { Station } from '../checks'
import { BRAND } from '../brand'
import { parseSettings, SETTINGS_DOC } from '../businessSettings'
import { escposJob } from '../escpos'
import { PRINT_ATTEMPTS, PRINT_JOBS, PRINT_WINDOW_MS, receiptJob, retryDelay, ticketJob, ticketReprintJob, type PrintJobPlan } from '../hubPrinting'
import { PRINTING_DOC, parsePrintingSettings, printerFor, printsFromHub, readPrinterAddress, type PrintingSettings } from '../printing'
import type { PrintResult } from '../printClient'
import { buildReceipt, receiptToText } from '../receipt'
import { receiptOptionsFor } from '../receiptOptions'
import { ticketToText } from '../ticketDoc'
import { ticketSentAtMs, type Ticket } from '../tickets'
import type { Check } from '../checks'
import { timestampMs } from '../timestamps'

const DEVICE_DOC = 'hubMeta/device'

type Send = (address: { host: string; port: number }, bytes: Uint8Array) => Promise<PrintResult>

/** Sends one job's bytes to a printer's port. Resolves what happened; never throws. */
export function sendToPrinter(address: { host: string; port: number }, bytes: Uint8Array, timeoutMs = 8_000): Promise<PrintResult> {
  return new Promise(resolve => {
    let settled = false
    const socket = createConnection({ host: address.host, port: address.port })
    const finish = (result: PrintResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish({ printed: false, reason: `The printer at ${address.host}:${address.port} did not answer.` }))
    socket.on('error', (err: NodeJS.ErrnoException) =>
      finish({ printed: false, reason: `The printer at ${address.host}:${address.port} could not be reached (${err.code ?? err.message}).` }))
    socket.on('connect', () => {
      socket.end(Buffer.from(bytes), () => finish({ printed: true, reason: null }))
    })
  })
}

async function hubContext(store: HubStore): Promise<{ branch: string; settings: PrintingSettings }> {
  const [device, printing] = await Promise.all([store.doc(DEVICE_DOC).get(), store.doc(PRINTING_DOC).get()])
  const branch = device.data()?.branch
  return { branch: typeof branch === 'string' ? branch : '', settings: parsePrintingSettings(printing.data()) }
}

/** The print jobs a batch of commits makes: new tickets, and closed checks. */
export async function planPrintJobs(store: HubStore, changes: readonly HubChange[], now = Date.now()): Promise<PrintJobPlan[]> {
  const relevant = changes.filter(c => !c.deleted && (c.collection === 'kitchenTickets' || c.collection === 'checks'))
  if (relevant.length === 0) return []
  const { branch, settings } = await hubContext(store)
  const plans: PrintJobPlan[] = []
  const seen = new Set<string>()
  for (const change of relevant) {
    if (seen.has(change.path)) continue
    seen.add(change.path)
    const data = (await store.doc(change.path).get()).data()
    if (!data) continue
    const made = change.collection === 'kitchenTickets'
      ? [ticketJob({ id: change.id, data }, settings, branch, now), ticketReprintJob({ id: change.id, data }, settings, branch, now)]
      : [receiptJob({ id: change.id, data }, settings, branch, now)]
    for (const plan of made) if (plan) plans.push(plan)
  }
  return plans
}

/** Records a job, once. False when it was already recorded, so a document changing again prints nothing more. */
export async function enqueuePrintJob(store: HubStore, plan: PrintJobPlan, now = Date.now()): Promise<boolean> {
  try {
    await store.doc(`${PRINT_JOBS}/${plan.id}`).create({
      kind: plan.kind, refId: plan.refId, station: plan.station,
      status: 'waiting', attempts: 0, lastError: null, createdAt: now, printedAt: null,
    })
    return true
  } catch (err) {
    if ((err as { code?: unknown }).code === 6) return false
    throw err
  }
}

/** The text a job prints, laid out for the printer's roll, or a reason it cannot be built. */
async function jobText(store: HubStore, kind: string, refId: string, width: number): Promise<{ text: string } | { reason: string }> {
  if (kind === 'ticket' || kind === 'reprint') {
    const data = (await store.doc(`kitchenTickets/${refId}`).get()).data()
    if (!data) return { reason: 'The ticket is no longer there.' }
    const ticket = { id: refId, ...data } as Ticket
    return {
      text: ticketToText(ticket, {
        businessName: BRAND.shortName,
        sentAt: ticketSentAtMs(ticket, Date.now()),
        sentBy: String(ticket.sentByEmail ?? '').split('@')[0] || String(ticket.sentBy ?? ''),
        timeZone: BRAND.locale.timezone,
        locale: BRAND.locale.locale,
        reprint: kind === 'reprint',
      }, width),
    }
  }
  const data = (await store.doc(`checks/${refId}`).get()).data()
  if (!data) return { reason: 'The check is no longer there.' }
  const rate = parseSettings((await store.doc(SETTINGS_DOC).get()).data()).exchangeRate
  try {
    return { text: receiptToText(buildReceipt({ id: refId, ...data } as Check, receiptOptionsFor(rate)), width) }
  } catch (err) {
    return { reason: `The receipt could not be built: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export type JobOutcome = { outcome: 'printed' | 'retry' | 'failed' | 'skipped'; attempts: number; reason: string | null }

/**
 * Tries one job: its printer as configured NOW, its document as it stands.
 * Printed, it is marked printed. Failed, it is tried again up to
 * PRINT_ATTEMPTS, then left failed with the reason.
 */
export async function runPrintJob(store: HubStore, jobId: string, { send = sendToPrinter as Send, now = Date.now() }: { send?: Send; now?: number } = {}): Promise<JobOutcome> {
  const ref = store.doc(`${PRINT_JOBS}/${jobId}`)
  const job = (await ref.get()).data()
  if (!job || job.status !== 'waiting') return { outcome: 'skipped', attempts: Number(job?.attempts ?? 0), reason: null }
  const attempts = Number(job.attempts ?? 0) + 1
  const fail = async (reason: string, final: boolean): Promise<JobOutcome> => {
    const last = final || attempts >= PRINT_ATTEMPTS
    await ref.update({ status: last ? 'failed' : 'waiting', attempts, lastError: reason, failedAt: now })
    return { outcome: last ? 'failed' : 'retry', attempts, reason }
  }

  const { branch, settings } = await hubContext(store)
  const printer = printerFor(settings, branch, job.station as Station)
  const address = readPrinterAddress(printer.address)
  if (!printsFromHub(printer) || !address) {
    return fail('The printer for this station was switched off or changed before it printed.', true)
  }
  const built = await jobText(store, String(job.kind), String(job.refId), printer.width)
  if ('reason' in built) return fail(built.reason, true)

  const result = await send(address, escposJob(built.text, printer.copies))
  if (!result.printed) return fail(result.reason ?? 'The printer did not take it.', false)
  await ref.update({ status: 'printed', attempts, lastError: null, printedAt: now })
  return { outcome: 'printed', attempts, reason: null }
}

export interface PrintingStatus {
  /** Network printers at this hub's branch, by station. */
  printers: { station: Station; address: string; ready: boolean }[]
  /** The latest kitchen tickets for a network printer, to print one again (UPGRADE.md T3.6). */
  recentTickets: { id: string; station: string; tableNumber: number; round: number; status: string; sentAt: number; reprints: number }[]
  printedToday: number
  waiting: number
  /** The latest failures in the last day, newest first. */
  failures: { kind: string; station: string; reason: string; at: number }[]
}

/** What the hub's page shows about printing. */
export async function printingStatus(store: HubStore, now = Date.now()): Promise<PrintingStatus> {
  const { branch, settings } = await hubContext(store)
  const printers = branch
    ? Object.keys(settings.branches[branch] ?? {})
      .map(station => ({ station: station as Station, printer: printerFor(settings, branch, station as Station) }))
      .filter(p => p.printer.transport === 'network')
      .map(p => ({ station: p.station, address: p.printer.address, ready: printsFromHub(p.printer) && Boolean(readPrinterAddress(p.printer.address)) }))
    : []
  const jobs = (await store.collection(PRINT_JOBS).get()).docs.map(d => d.data() ?? {})
  const dayAgo = now - 24 * 3600_000
  const networkStations = new Set(printers.map(p => p.station as string))
  const recentTickets = branch && networkStations.size > 0
    ? (await store.collection('kitchenTickets').where('branch', '==', branch).orderBy('sentAt', 'desc').limit(30).get()).docs
      .map(d => ({ id: d.id, t: d.data() ?? {} }))
      .filter(({ t }) => networkStations.has(String(t.station)) && t.status !== 'cancelled' && timestampMs(t.sentAt, 0) > now - 12 * 3600_000)
      .slice(0, 10)
      .map(({ id, t }) => ({
        id, station: String(t.station), tableNumber: Number(t.tableNumber ?? 0), round: Number(t.round ?? 1),
        status: String(t.status ?? ''), sentAt: timestampMs(t.sentAt, 0), reprints: Number(t.reprints ?? 0),
      }))
    : []
  return {
    printers,
    recentTickets,
    printedToday: jobs.filter(j => j.status === 'printed' && Number(j.printedAt) > dayAgo).length,
    waiting: jobs.filter(j => j.status === 'waiting').length,
    failures: jobs
      .filter(j => j.status === 'failed' && Number(j.failedAt) > dayAgo)
      .sort((a, b) => Number(b.failedAt) - Number(a.failedAt))
      .slice(0, 5)
      .map(j => ({ kind: String(j.kind), station: String(j.station), reason: String(j.lastError ?? ''), at: Number(j.failedAt) })),
  }
}

/** A test page on one station's network printer, straight away, for whoever is setting it up. */
export async function printTestPage(store: HubStore, station: unknown, send: Send = sendToPrinter): Promise<PrintResult> {
  const { branch, settings } = await hubContext(store)
  if (typeof station !== 'string' || !(settings.branches[branch] && station in settings.branches[branch])) {
    return { printed: false, reason: 'That station has no printer at this hub.' }
  }
  const printer = printerFor(settings, branch, station as Station)
  const address = readPrinterAddress(printer.address)
  if (printer.transport !== 'network' || !address) return { printed: false, reason: 'That station has no network printer with an address.' }
  const when = new Date().toLocaleString('en-GB', { timeZone: BRAND.locale.timezone })
  const line = '-'.repeat(printer.width)
  const text = [BRAND.shortName, 'Test print', line, `Station: ${station}`, `Branch:  ${branch}`, `Printer: ${address.host}:${address.port}`, `Roll:    ${printer.width} columns`, when, line, '0123456789'.repeat(Math.ceil(printer.width / 10)).slice(0, printer.width)].join('\n')
  return send(address, escposJob(text, 1))
}

/**
 * Starts printing on a hub: follows every commit, and picks up jobs still
 * waiting from before a restart that are recent enough to be worth paper.
 * Once per process; nothing on a server that is not a hub.
 */
export function startHubPrinting(send: Send = sendToPrinter): void {
  if (!hubDbPath()) return
  const g = globalThis as { __bigCmsHubPrintingStarted?: boolean }
  if (g.__bigCmsHubPrintingStarted) return
  g.__bigCmsHubPrintingStarted = true
  const store = adminDb() as unknown as HubStore

  // One job at a time, in order.
  let chain: Promise<unknown> = Promise.resolve()
  const run = (jobId: string, delay: number) => {
    setTimeout(() => {
      chain = chain.then(async () => {
        try {
          const result = await runPrintJob(store, jobId, { send })
          const wait = result.outcome === 'retry' ? retryDelay(result.attempts) : null
          if (wait !== null) run(jobId, wait)
          if (result.outcome === 'failed') console.error(`[hub] print job ${jobId} failed: ${result.reason}`)
        } catch (err) {
          console.error(`[hub] print job ${jobId} stopped:`, err)
        }
      })
    }, delay).unref?.()
  }

  store.onChange(changes => {
    void (async () => {
      try {
        for (const plan of await planPrintJobs(store, changes)) {
          if (await enqueuePrintJob(store, plan)) run(plan.id, 0)
        }
      } catch (err) {
        console.error('[hub] could not plan printing:', err)
      }
    })()
  })

  void (async () => {
    try {
      const now = Date.now()
      for (const doc of (await store.collection(PRINT_JOBS).get()).docs) {
        const d = doc.data() ?? {}
        if (d.status === 'waiting' && now - timestampMs(d.createdAt, 0) <= PRINT_WINDOW_MS) run(doc.id, 2_000)
      }
    } catch (err) {
      console.error('[hub] could not pick up waiting print jobs:', err)
    }
  })()
}
