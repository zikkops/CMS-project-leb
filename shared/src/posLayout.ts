// What the till shows, per branch (owner's request, 24 Sep 2026).
//
// A café that does not sell desserts at one branch had no way to take them off
// that till. The three switches that existed each answer a different question:
//
//   available          on the menu at all — the website AND the till
//   soldOut.<branch>   run out today, set from the till, gone again at 05:00
//   hours              only served between these times
//
// None of them says "this branch's till never shows this", which is a standing
// fact about a branch rather than a fact about a dish. That is this.
//
// ── Where it lives ────────────────────────────────────────────────────────
// On the menu documents themselves — `menuItems/{id}.posHidden.<branch>` and
// `menuCategories/{id}.posHidden.<branch>` — for exactly the reasons soldOut
// does: the till already reads the menu live, both collections are already
// world-readable, and a café hub already pulls both. So there is no new
// collection, no new query, no new Firestore rule to deploy and nothing to add
// to the hub's pull.
//
// ── Hidden, not shown ─────────────────────────────────────────────────────
// The stored list is what is HIDDEN, never what is shown. A dish added to the
// menu tomorrow appears on the till by itself; with a list of what to show, it
// would silently never appear and nobody would know why. The same reasoning as
// a missing tips rate taking nothing off rather than everything.
//
// ── It decides what is SEEN, not what may be sold ─────────────────────────
// Hiding is a display rule for the till's menu picker. It does not stop the
// server accepting a line, and it never touches a check that is already open:
// a dish hidden while somebody's order is on screen stays on that order, and a
// line already sent still cooks, prints and is paid for. `available` and
// `soldOut` are the rules about what may be SOLD, and the server enforces
// those. Keeping the two apart is what stops a layout change turning into a
// refused check in the middle of a service.

/** A stored `posHidden` map read defensively: branch → true, anything else dropped. */
export function readPosHidden(raw: unknown): Record<string, true> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, true> = {}
  for (const [branch, on] of Object.entries(raw as Record<string, unknown>)) {
    if (on === true && branch) out[branch] = true
  }
  return out
}

/** Whether this document is hidden from the till at this branch. */
export function hiddenOnTill(raw: unknown, branch: string): boolean {
  return readPosHidden(raw)[branch] === true
}

export interface LayoutCategory { id: string; posHidden?: unknown }
export interface LayoutItem { id: string; categoryId: string; posHidden?: unknown }

/**
 * The menu as this branch's till should show it.
 *
 * An item goes when it is hidden itself OR when its category is — hiding
 * "Sweets" is meant to take the whole dessert menu off, which is the case this
 * was asked for. An item whose category does not exist is left alone rather
 * than hidden: a dish is not something to make disappear because of a dangling
 * reference.
 */
export function tillMenu<C extends LayoutCategory, I extends LayoutItem>(
  categories: readonly C[],
  items: readonly I[],
  branch: string,
): { categories: C[]; items: I[] } {
  const goneCategories = new Set(categories.filter(c => hiddenOnTill(c.posHidden, branch)).map(c => c.id))
  return {
    categories: categories.filter(c => !goneCategories.has(c.id)),
    items: items.filter(i => !hiddenOnTill(i.posHidden, branch) && !goneCategories.has(i.categoryId)),
  }
}

export interface LayoutCounts {
  categoriesShown: number
  categoriesTotal: number
  itemsShown: number
  itemsTotal: number
  /** Nothing at all on the till — worth saying out loud on the admin page. */
  empty: boolean
}

/** What the admin page reports: how much of the menu this branch's till shows. */
export function layoutCounts<C extends LayoutCategory, I extends LayoutItem>(
  categories: readonly C[],
  items: readonly I[],
  branch: string,
): LayoutCounts {
  const shown = tillMenu(categories, items, branch)
  return {
    categoriesShown: shown.categories.length,
    categoriesTotal: categories.length,
    itemsShown: shown.items.length,
    itemsTotal: items.length,
    empty: items.length > 0 && shown.items.length === 0,
  }
}

/**
 * What a save changes, as the ids to hide and the ids to show again. The page
 * sends the whole state it is looking at; this works out the difference, so a
 * save writes only what moved and an unchanged document is not touched.
 */
export function layoutChanges(
  current: readonly { id: string; posHidden?: unknown }[],
  hiddenNow: readonly string[],
  branch: string,
): { hide: string[]; show: string[] } {
  const wanted = new Set(hiddenNow)
  const hide: string[] = []
  const show: string[] = []
  for (const doc of current) {
    const was = hiddenOnTill(doc.posHidden, branch)
    const is = wanted.has(doc.id)
    if (is && !was) hide.push(doc.id)
    if (!is && was) show.push(doc.id)
  }
  return { hide, show }
}
