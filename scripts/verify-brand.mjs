// Assertions over the brand palette plumbing.
//
//   node scripts/verify-brand.mjs
//   npm run verify:brand
//
// Same shape as verify-checks.mjs and verify-receipt.mjs: transpiles the real
// modules with the project's own TypeScript and asserts against them. Nothing
// is re-implemented.
//
// ── Why this needs a verifier at all ───────────────────────────────────────
// Roughly fifteen hundred colours in this codebase are written as
// `rgba(var(--offwhite-rgb), 0.45)`. If that variable is misspelled, or if
// brandCss.ts stops emitting it, the browser does not report anything: an
// unresolvable var() makes the whole declaration invalid, and an invalid
// declaration is discarded. The element keeps whatever it had, which is
// usually "inherited from the parent" — so the page still renders, still
// looks plausible, and is quietly wrong.
//
// tsc cannot see it (they are strings), the build cannot see it, and it does
// not throw. A cross-check between what the source references and what
// brandCss.ts emits is the only thing that can.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

const out = mkdtempSync(join(tmpdir(), 'brand-verify-'))
execSync(
  `npx tsc shared/src/brandCss.ts shared/src/brand.ts ` +
  `--outDir ${out} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const { brandCssVars } = await import(`file://${join(out, 'brandCss.js')}`)
const { BRAND } = await import(`file://${join(out, 'brand.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

const css = brandCssVars()

// Every custom property the stylesheet defines, and its value.
const DEFINED = new Map()
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
  DEFINED.set(m[1], m[2].trim())
}

console.log('\nthe triplets exist and are triplets')
const RGB_VARS = [
  '--brand-primary-rgb', '--brand-secondary-rgb', '--brand-tertiary-rgb',
  '--brand-deep-rgb', '--brand-danger-rgb', '--brand-background-rgb',
  '--brand-foreground-rgb',
]
for (const v of RGB_VARS) {
  const value = DEFINED.get(v)
  eq(`${v} is three channels`, /^\d{1,3}, \d{1,3}, \d{1,3}$/.test(value ?? ''), true)
  const inRange = (value ?? '').split(',').every(n => {
    const x = Number(n.trim())
    return Number.isInteger(x) && x >= 0 && x <= 255
  })
  eq(`${v} channels are 0-255`, inRange, true)
}

console.log('\nthe aliases point at the triplets, not at colours')
for (const [alias, target] of [
  ['--offwhite-rgb', '--brand-foreground-rgb'],
  ['--teal-rgb', '--brand-primary-rgb'],
  ['--red-rgb', '--brand-danger-rgb'],
  ['--purple-rgb', '--brand-tertiary-rgb'],
]) {
  eq(`${alias} -> ${target}`, DEFINED.get(alias), `var(${target})`)
}

console.log('\nthe triplet matches the configured hex')
const hexToTriplet = hex => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null
}
for (const [role, v] of [
  ['primary', '--brand-primary-rgb'], ['secondary', '--brand-secondary-rgb'],
  ['tertiary', '--brand-tertiary-rgb'], ['deep', '--brand-deep-rgb'],
  ['danger', '--brand-danger-rgb'], ['background', '--brand-background-rgb'],
  ['foreground', '--brand-foreground-rgb'],
]) {
  eq(`${role} triplet == its hex`, DEFINED.get(v), hexToTriplet(BRAND.colors[role]))
}

console.log('\nevery colour is a valid hex, whatever the environment said')
for (const [role, value] of Object.entries(BRAND.colors)) {
  eq(`${role} is #rrggbb`, /^#[0-9a-f]{6}$/i.test(value), true)
}

// ── The cross-check ────────────────────────────────────────────────────────
// This is the one that matters. Every variable the source references has to
// be one this stylesheet defines, or the declaration using it is silently
// discarded at render time.
console.log('\nevery var() the source references is defined')

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', '.claude', 'out', 'build'])
const EXT = ['.ts', '.tsx', '.css']
const walk = (dir, acc = []) => {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (EXT.some(x => e.endsWith(x))) acc.push(full)
  }
  return acc
}

// Names the stylesheet does not define but the app legitimately uses: the
// font variables next/font injects per app, and the colour aliases.
const FROM_ELSEWHERE = new Set(['--font-brand-display', '--font-brand-body'])

const referenced = new Map()   // name -> first "file:line"
for (const dir of ['web', 'admin', 'pos', 'shared']) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).split('\\').join('/')
    if (rel === 'shared/src/brandCss.ts') continue
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*')) return
      for (const m of line.matchAll(/var\((--[a-z0-9-]+)/gi)) {
        if (!referenced.has(m[1])) referenced.set(m[1], `${rel}:${i + 1}`)
      }
    })
  }
}

const undefinedVars = [...referenced.entries()]
  .filter(([name]) => !DEFINED.has(name) && !FROM_ELSEWHERE.has(name))

eq('no source file references an undefined variable', undefinedVars.length, 0)
for (const [name, where] of undefinedVars) {
  console.log(`        ${name}  first at ${where}`)
}
eq('and the source does reference the triplets', referenced.has('--offwhite-rgb'), true)

// ── Theme tokens (UPGRADE.md T4.4) ─────────────────────────────────────────
// The neutrals every screen is drawn with are variables, so a light theme or a
// client's own palette is one stylesheet. A literal white tint or the old
// near-black in app code is a colour that theme would miss. Two files are not
// CSS and cannot read a variable: the web app manifest and the POS icon.
console.log('\nthe theme tokens exist, and app code uses them')
eq('--overlay-rgb is three channels', /^\d{1,3}, \d{1,3}, \d{1,3}$/.test(DEFINED.get('--overlay-rgb') ?? ''), true)
eq('--surface-deep and --on-accent are defined', DEFINED.has('--surface-deep') && DEFINED.has('--on-accent'), true)
const NOT_CSS = new Set(['pos/app/manifest.ts', 'pos/app/pos/icon.svg/route.ts'])
const literals = []
for (const dir of ['web/app', 'admin/app', 'pos/app']) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).split('\\').join('/')
    if (NOT_CSS.has(rel)) continue
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,|#0a0a0a/i.test(line)) literals.push(`${rel}:${i + 1}`)
    })
  }
}
eq('no literal white tint or #0a0a0a in app code', literals.length, 0)
for (const where of literals.slice(0, 10)) console.log(`        ${where}  use rgba(var(--overlay-rgb), a) or var(--surface-deep)`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
