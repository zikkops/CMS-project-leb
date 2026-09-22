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

/**
 * A colour as "r, g, b", for the translucent case.
 *
 * `rgba(var(--offwhite), 0.45)` does not work: a variable holding "#EDEBE7" is
 * a colour, not the three channel values rgba() wants. That is why roughly
 * fifteen hundred translucent colours across this codebase were written as
 * literal `rgba(245,242,236,0.45)` — the old café's off-white, frozen, in the
 * one form the brand variables could not express. Configuring a new palette
 * changed the solid colours and left every faded label, every divider and
 * every placeholder exactly as the original café had them.
 *
 * The triplet is the missing piece: `rgba(var(--offwhite-rgb), 0.45)`.
 *
 * envColor() in brand.ts guarantees a six-digit hex reaches this, so the
 * regex cannot fail in practice — the fallback is there because a variable
 * holding a malformed triplet would invalidate every rgba() using it, and an
 * invalid property is dropped rather than reported.
 */
function rgbTriplet(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return '128, 128, 128'
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`
}

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

  /* Channel triplets, for rgba(). See rgbTriplet() above for why these have
     to exist separately rather than being derived from the values above. */
  --brand-primary-rgb:    ${rgbTriplet(BRAND.colors.primary)};
  --brand-secondary-rgb:  ${rgbTriplet(BRAND.colors.secondary)};
  --brand-tertiary-rgb:   ${rgbTriplet(BRAND.colors.tertiary)};
  --brand-deep-rgb:       ${rgbTriplet(BRAND.colors.deep)};
  --brand-danger-rgb:     ${rgbTriplet(BRAND.colors.danger)};
  --brand-background-rgb: ${rgbTriplet(BRAND.colors.background)};
  --brand-foreground-rgb: ${rgbTriplet(BRAND.colors.foreground)};

  /* Legacy aliases — see the note above. Do not add more. */
  --teal:     var(--brand-primary);
  --red:      var(--brand-danger);
  --purple:   var(--brand-tertiary);
  --navy:     var(--brand-deep);
  --black:    var(--brand-background);
  --offwhite: var(--brand-foreground);

  --teal-rgb:     var(--brand-primary-rgb);
  --red-rgb:      var(--brand-danger-rgb);
  --purple-rgb:   var(--brand-tertiary-rgb);
  --offwhite-rgb: var(--brand-foreground-rgb);

  /* Theme tokens (UPGRADE.md T4.4): the neutrals the screens are drawn with,
     which used to be literals in every file. --overlay-rgb tints panels,
     dividers and hovers over the dark background: a light theme sets it to
     0, 0, 0 and everything faint follows. --surface-deep is the darkest
     panel, below the page; --on-accent is text on a bright chip or button.
     Write rgba(var(--overlay-rgb), 0.08), never rgba(255,255,255,0.08):
     verify:brand fails on the literal in app code. */
  /* Chart series (UPGRADE.md T7.19). NOT the brand hues, deliberately: a
     client configures those, and no configurable set can promise the thing a
     chart needs — that two adjacent series stay apart for a colour-blind
     reader. These six are a fixed order, validated against this dark surface
     (lightness band, chroma floor, CVD separation, normal-vision floor and
     3:1 contrast). Assign them in order and never cycle: a seventh series
     folds into Other. Charts on a light surface would need their own steps. */
  --chart-1: #3987e5;
  --chart-2: #d95926;
  --chart-3: #199e70;
  --chart-4: #c98500;
  --chart-5: #d55181;
  --chart-6: #9085e9;
  /* A difference that can go either way: gain, loss, and a neutral middle. */
  --chart-up:      #199e70;
  --chart-down:    #e66767;
  --chart-neutral: #8a8a86;

  --overlay-rgb:  255, 255, 255;
  --surface-deep: #0a0a0a;
  --on-accent:    #0a0a0a;

  --font-display: var(--font-brand-display);
  --font-body:    var(--font-brand-body);
  /* Legacy font aliases, same reasoning as the colours. */
  --font-cinzel:  var(--font-brand-display);
  --font-inter:   var(--font-brand-body);
}
  `.trim()
}
