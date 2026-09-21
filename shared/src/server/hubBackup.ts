// SERVER ONLY, and only on a café hub — see firebaseAdmin.ts for the import rule.
//
// Makes the hub's nightly copy of its database (UPGRADE.md T5.11); the plan
// is hubBackupPlan() in shared/src/hubBackup.ts. Started from
// pos/instrumentation.ts: a check shortly after the server starts, then every
// hour, so a PC switched off overnight still gets its copy when it comes on.
// A failure is logged and tried again next hour; it never stops the till.

import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { adminDb, hubDbPath } from './firebaseAdmin'
import type { HubStore } from './hubStore'
import { hubBackupName, hubBackupPlan } from '../hubBackup'
import { todayYmd } from '../dates'
import { BRAND } from '../brand'

export function hubBackupDir(): string | null {
  const db = hubDbPath()
  return db ? join(dirname(db), 'backups') : null
}

/** Makes today's copy if it is missing and lets the oldest go. Returns what it did. */
export function runHubBackup(now = new Date()): { made: string | null; removed: string[] } {
  const dir = hubBackupDir()
  if (!dir) return { made: null, removed: [] }
  mkdirSync(dir, { recursive: true })
  const today = todayYmd(BRAND.locale.timezone, now)
  const plan = hubBackupPlan(readdirSync(dir), today)
  let made: string | null = null
  if (plan.make) {
    const final = join(dir, hubBackupName(today))
    // VACUUM INTO refuses a file that exists, and a half-written copy must
    // never carry the finished name: written aside, then renamed.
    const part = `${final}.part`
    if (existsSync(part)) rmSync(part)
    ;(adminDb() as unknown as HubStore).backupTo(part)
    renameSync(part, final)
    made = hubBackupName(today)
  }
  for (const name of plan.remove) rmSync(join(dir, name), { force: true })
  return { made, removed: plan.remove }
}

export function startHubBackups(): void {
  const g = globalThis as { __bigCmsHubBackups?: boolean }
  if (g.__bigCmsHubBackups || !hubDbPath()) return
  g.__bigCmsHubBackups = true
  const run = () => {
    try {
      const done = runHubBackup()
      if (done.made) console.log(`[hub] copied the database to backups/${done.made}${done.removed.length ? `, let go of ${done.removed.join(', ')}` : ''}`)
    } catch (err) {
      console.error('[hub] the nightly database copy failed; trying again in an hour:', err)
    }
  }
  setTimeout(run, 60_000).unref?.()
  setInterval(run, 3_600_000).unref?.()
}
