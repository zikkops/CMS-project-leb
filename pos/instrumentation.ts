// Runs once when a POS server starts (Next's instrumentation hook).
//
// On a café hub it starts pulling the menu, settings and staff from the cloud
// every two minutes — POS software, stage 4 — and printing to network printers
// on the café network (S28). Online it does nothing: that POS server IS the
// cloud.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.BIG_CMS_HUB_DB) return
  const { startHubSync } = await import('@big-cms/shared/server/hubSync')
  startHubSync()
  const { startHubPrinting } = await import('@big-cms/shared/server/hubPrinting')
  startHubPrinting()
}
