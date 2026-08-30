// The brand CSS variables, as a string every app's root layout injects.
//
// These are written into a <style> tag rather than into globals.css because
// globals.css is a static file and these come from configuration — the whole
// point of the fork is that a new tenant sets their colours without editing
// source.
//
// Extracted from web/app/layout.tsx when the apps split. Three copies of this
// block is three chances for the customer site and the admin panel to render
// a different shade of the same brand, and the drift would be invisible until
// somebody put two screenshots side by side.
//
// THE ALIASES MATTER. Roughly fifty components reference var(--teal),
// var(--red), var(--purple) and var(--navy) in inline style objects. Renaming
// them all would be a thousand-line diff with no behavioural change and a real
// chance of missing one. So the semantic names are the source of truth and the
// old names alias onto them: existing code keeps working, new code uses the
// semantic names, and both resolve to the same configured value.
//
// Write --brand-primary in anything new. The four legacy aliases are kept for
// compatibility, not as an example to follow.

import { BRAND } from './brand'

export function brandCssVars(): string {
  return `
:root {
  --brand-primary:    ${BRAND.colors.primary};
  --brand-secondary:  ${BRAND.colors.secondary};
  --brand-tertiary:   ${BRAND.colors.tertiary};
  --brand-deep:       ${BRAND.colors.deep};
  --brand-danger:     ${BRAND.colors.danger};
  --brand-background: ${BRAND.colors.background};
  --brand-foreground: ${BRAND.colors.foreground};

  /* Legacy aliases — see the note above. Do not add more. */
  --teal:     var(--brand-primary);
  --red:      var(--brand-danger);
  --purple:   var(--brand-tertiary);
  --navy:     var(--brand-deep);
  --black:    var(--brand-background);
  --offwhite: var(--brand-foreground);

  --font-display: var(--font-brand-display);
  --font-body:    var(--font-brand-body);
  /* Legacy font aliases, same reasoning as the colours. */
  --font-cinzel:  var(--font-brand-display);
  --font-inter:   var(--font-brand-body);
}
  `.trim()
}
