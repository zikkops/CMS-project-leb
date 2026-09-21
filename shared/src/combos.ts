// Combos and meal deals (UPGRADE.md T5.13). Pure, asserted by verify:checks.
//
// A combo is a menu item with `comboOf`: the menu items it is made of, say a
// burger, fries and a soft drink, at the combo's own price. When one is added
// the server writes the combo as a line at that price, and each component as a
// line of its own at $0 with `comboOf` naming the combo's line. That one
// choice keeps every other part of the till unchanged:
//
//   the kitchen   each component fires to its own station, as any line does;
//                 the combo line has no station, so it makes no ticket;
//   the bill      the combo line carries the whole price and the components
//                 add nothing, so totals, VAT, splits and the drawer are right;
//   the stock     each component snapshots its own recipe, so ingredients
//                 leave, go back or are wasted exactly as for a dish;
//   the reports   the mix counts the combo sold, and the components made at $0.
//
// A component that needs a choice (a required option group) cannot be in a
// combo yet: nobody would be asked, and the kitchen would get a burger with
// no doneness. Combos do not nest.

export const COMBO_MIN = 2
export const COMBO_MAX = 6

/** A stored or sent comboOf, cleaned: unique ids, never the item itself. Anything else is no combo. */
export function readComboOf(raw: unknown, selfId?: string): string[] {
  if (!Array.isArray(raw)) return []
  const ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128 && !x.includes('/')))]
    .filter(id => id !== selfId)
  return ids.length >= COMBO_MIN && ids.length <= COMBO_MAX ? ids : []
}

/** Why an admin's combo cannot be saved, or null. `components` are the menu items it names, as stored. */
export function comboProblem(
  selfId: string | null,
  raw: unknown,
  components: ReadonlyMap<string, { name: string; comboOf?: unknown; requiresChoice: boolean } | null>,
): string | null {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return null
  if (!Array.isArray(raw)) return 'A combo is a list of menu items.'
  const ids = [...new Set(raw.map(String))]
  if (selfId && ids.includes(selfId)) return 'A combo cannot contain itself.'
  if (ids.length < COMBO_MIN) return `A combo needs at least ${COMBO_MIN} items.`
  if (ids.length > COMBO_MAX) return `A combo holds at most ${COMBO_MAX} items.`
  for (const id of ids) {
    const c = components.get(id)
    if (!c) return 'An item in the combo is no longer on the menu.'
    if (readComboOf(c.comboOf, id).length > 0) return `"${c.name}" is a combo itself; combos do not nest.`
    if (c.requiresChoice) return `"${c.name}" needs a choice from its options, so it cannot be in a combo yet.`
  }
  return null
}

/** The ids given plus the component lines of any combo line among them: a combo moves or is voided whole. */
export function withComboParts(lines: readonly { id: string; comboOf?: string }[], ids: readonly string[]): string[] {
  const chosen = new Set(ids)
  const parts = lines.filter(l => l.comboOf && chosen.has(l.comboOf)).map(l => l.id)
  return [...new Set([...ids, ...parts])]
}

/** Whether any of these ids is a component chosen without its combo. */
export function partWithoutCombo(lines: readonly { id: string; comboOf?: string }[], ids: readonly string[]): boolean {
  const chosen = new Set(ids)
  return lines.some(l => chosen.has(l.id) && Boolean(l.comboOf) && !chosen.has(l.comboOf!))
}
