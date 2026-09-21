// ─── helpers ────────────────────────────────────────────────────────────────

export function parseCash(vals: Record<string, string>): Record<string, number> {
  return Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v) || 0]))
}

export function cashToStr(vals: Record<string, number>): Record<string, string> {
  return Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v === 0 ? '' : String(v)]))
}
