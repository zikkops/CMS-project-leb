// Layouts that cannot fit on a phone.
//
//   node scripts/audit-mobile.mjs
//   npm run audit:mobile
//
// This panel is used on phones, and the narrowest one worth designing for is
// 360 CSS pixels — about 328 once a page's own padding is taken off. Anything
// wider than that with nowhere to scroll drags the WHOLE page sideways, not
// just itself, and every other element goes with it.
//
// Two rules, both narrow on purpose. A heuristic that guesses at layout would
// cry wolf and be switched off within a week; these two are things that are
// simply true:
//
//   1. An element with a fixed minimum width over the phone budget must sit
//      in something that scrolls. Found for real: the product import
//      preview, eight columns at minWidth 600px with no wrapper, which took
//      the page to 600px on a phone. Every other wide table in the panel was
//      already wrapped, so this was one that got missed rather than a style
//      nobody follows.
//
//   2. A grid track with a fixed minimum over the budget cannot shrink —
//      `minmax(400px, 1fr)` is at least 400px however narrow the screen. Those
//      are fine behind an isMobile check, which is how the till's two-column
//      screens do it, so only an unguarded one is reported.
//
// What it does NOT try to judge: whether a table has too many columns, or
// whether text will wrap. `overflow-wrap: anywhere` in globals.css handles
// long unbroken ids, and the rest is a matter of looking at it.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** A phone at 360px, less a page's usual side padding. */
const BUDGET = 328
const ROOTS = ['web/app', 'admin/app', 'pos/app', 'admin/app/components', 'pos/app/lib']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.next')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const files = [...new Set(ROOTS.flatMap(r => { try { return walk(r) } catch { return [] } }))]
const problems = []

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)

  lines.forEach((line, i) => {
    // 1 — a fixed floor wider than a phone, with nowhere to scroll.
    for (const m of line.matchAll(/minWidth: '(\d+)px'/g)) {
      const px = Number(m[1])
      if (px <= BUDGET) continue
      // The wrapper is an ancestor, so it sits above this line — and these
      // style objects run one property to a line, so it can sit a long way
      // above. The product import preview scrolls from a grandparent eleven
      // lines up, which a ten-line window called a bug when it was not one.
      const near = lines.slice(Math.max(0, i - 25), i + 1).join('\n')
      if (near.includes("overflowX: 'auto'") || near.includes("overflowX: 'scroll'")) continue
      problems.push({ file, line: i + 1, what: `minWidth ${px}px with nothing to scroll in`, text: line.trim().slice(0, 90) })
    }

    // 2 — a grid track that cannot shrink below a phone, with no isMobile
    //     branch on the same line to swap it out.
    for (const m of line.matchAll(/minmax\((\d+)px/g)) {
      const px = Number(m[1])
      if (px <= BUDGET) continue
      // The branch that swaps it out is an `isMobile ? (…) : (` above the
      // grid, not on its line — on the till's order screen it is 17 lines up.
      // Forty lines is generous, deliberately: this rule is here to catch a
      // grid written with no thought for a phone at all, not to police how
      // far apart a ternary's halves may sit.
      const near = lines.slice(Math.max(0, i - 40), i + 1).join('\n')
      if (/isMobile\s*(\?|&&)/.test(near)) continue
      problems.push({ file, line: i + 1, what: `grid track of at least ${px}px, not switched out on a phone`, text: line.trim().slice(0, 90) })
    }
  })
}

for (const p of problems) {
  console.log(`  ${relative(process.cwd(), p.file)}:${p.line}`)
  console.log(`      ${p.what}`)
  console.log(`      ${p.text}`)
}

if (problems.length === 0) {
  console.log(`OK — nothing wider than ${BUDGET}px without somewhere to scroll. ${files.length} files.`)
  process.exit(0)
}
console.log(`\nFAIL — ${problems.length} layout${problems.length === 1 ? '' : 's'} that cannot fit a ${BUDGET}px phone.`)
console.log('Wrap it in <div style={{ overflowX: \'auto\' }}>, or give it an isMobile branch.')
process.exit(1)
