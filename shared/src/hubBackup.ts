// Nightly copies of a café hub's database (UPGRADE.md T5.11). Pure: which
// copy to make and which to let go, so verify:hub asserts it. The copying is
// shared/src/server/hubBackup.ts.
//
// One copy per café day, named by the day, beside pos.db in a `backups`
// folder: pos-2026-09-21.db. Seven are kept. Only files with exactly that
// shape are ever deleted, so nothing else a person puts in the folder is
// touched. The copy is SQLite's own VACUUM INTO, a consistent snapshot taken
// by the database while the till keeps trading, not a file copy of a
// database mid-write.

export const HUB_BACKUPS_KEPT = 7

const NAME = /^pos-(\d{4}-\d{2}-\d{2})\.db$/

export function hubBackupName(day: string): string {
  return `pos-${day}.db`
}

/** What to do in the backups folder today: make today's copy if missing, and which old copies go. */
export function hubBackupPlan(existing: readonly string[], today: string, keep = HUB_BACKUPS_KEPT): { make: boolean; remove: string[] } {
  const days = existing.map(f => NAME.exec(f)?.[1]).filter((d): d is string => Boolean(d)).sort()
  const make = !days.includes(today)
  const after = make ? [...days, today].sort() : days
  const n = Math.max(1, Math.floor(keep))
  const remove = after.slice(0, Math.max(0, after.length - n)).filter(d => d !== today).map(hubBackupName)
  return { make, remove }
}
