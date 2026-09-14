// Seeds recipes for the demo menu, the unit conversions they need, and the
// per-serving snapshots a till would have taken — onto the SEEDED checks only —
// so costing, the Recipes page and theoretical food cost have something real
// to read.
//
//   node --env-file=.env.local scripts/seed-recipes.mjs                  # dry run
//   node --env-file=.env.local scripts/seed-recipes.mjs --apply
//   node --env-file=.env.local scripts/seed-recipes.mjs --clear --apply  # remove it again
//
// ── Why this exists ────────────────────────────────────────────────────────
// Recipes arrived after both seeds. The demo had 40 costed supplies, 16 dishes
// and 415 closed checks, and not one recipe, conversion or snapshot, so the
// whole recipes chain had only ever run against fixtures.
//
// ── It borrows the real arithmetic rather than imitating it ────────────────
// Every recipe is checked with recipeProblems() before anything is written, and
// every snapshot is lineConsumption() — the call buildLines() makes at the
// till — transpiled and called here. The summary is theoreticalFoodCost() over
// each line's shareForLines(), exactly what /api/admin/food-cost computes, so
// the Food Cost Report should print the same figure for the same range.
//
// ── What it will not touch ─────────────────────────────────────────────────
//   - A supply that already has a conversion keeps it; the seed only fills
//     gaps, and flags what it filled (`recipeSeeded`) so --clear removes only that.
//   - A recipe somebody saved on the Recipes page is left alone.
//   - Only checks carrying `seeded: true` get snapshots. A real check's
//     snapshot is what the till took when it was rung up, and no script may
//     rewrite that after the fact.
//   - The Club Sandwich gets no recipe on purpose: there is no bread in
//     supplies, and a report with 100% coverage never shows its warning.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const CLEAR = process.argv.includes('--clear')

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. See .env.example.')
  console.error('Did you forget --env-file=.env.local ?')
  process.exit(1)
}
const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
const projectId = sa.project_id

const DEMO_HINTS = ['dev', 'demo', 'test', 'staging', 'sandbox', 'local']
const looksLikeDemo = DEMO_HINTS.some(h => projectId.toLowerCase().includes(h))
const explicitlyAllowed = process.env.SEED_ALLOW_PROJECT === projectId

console.log(`Project: ${projectId}`)

if (!looksLikeDemo && !explicitlyAllowed && !FORCE) {
  console.error(
    `\nREFUSING TO RUN.\n\n` +
    `The project id "${projectId}" doesn't contain any of: ${DEMO_HINTS.join(', ')}.\n` +
    `This script writes recipes and changes supply conversions with a credential\n` +
    `that bypasses every security rule.\n\n` +
    `If this really is a demo project, add this line to .env.local:\n` +
    `    SEED_ALLOW_PROJECT=${projectId}\n`
  )
  process.exit(1)
}

const db = getFirestore(initializeApp({
  credential: cert({
    projectId,
    clientEmail: sa.client_email,
    privateKey: String(sa.private_key ?? '').replace(/\\n/g, '\n'),
  }),
}))

async function commitAll(ops, label) {
  let done = 0
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch()
    for (const op of ops.slice(i, i + 400)) op(batch)
    await batch.commit()
    done += Math.min(400, ops.length - i)
    console.log(`  ${label} ${done}/${ops.length}`)
  }
}

// ── Taking it out again ────────────────────────────────────────────────────
if (CLEAR) {
  const recipes = await db.collection('recipes').where('seeded', '==', true).get()
  const supplies = await db.collection('supplies').where('recipeSeeded', '==', true).get()
  const checks = await db.collection('checks').where('recipeSnapshotSeeded', '==', true).get()
  console.log(`\n${recipes.size} seeded recipes, ${supplies.size} seeded conversions, ${checks.size} checks with seeded snapshots.`)
  if (!APPLY) {
    console.log('\nDry run — nothing removed. Add --apply to remove them.')
    process.exit(0)
  }
  await commitAll([
    ...recipes.docs.map(d => b => b.delete(d.ref)),
    ...supplies.docs.map(d => b => b.update(d.ref, {
      recipeUnit: FieldValue.delete(),
      recipeUnitsPerPurchaseUnit: FieldValue.delete(),
      yieldPercent: FieldValue.delete(),
      recipeSeeded: FieldValue.delete(),
    })),
    ...checks.docs.map(d => b => b.update(d.ref, {
      lines: (d.data().lines ?? []).map(({ consumesPerServing, consumesUnknown, ...rest }) => rest),
      recipeSnapshotSeeded: FieldValue.delete(),
    })),
  ], 'removed')
  console.log('Done.')
  process.exit(0)
}

// ── The application's own arithmetic, not a copy of it ─────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'seed-recipes-'))
execSync(
  `npx tsc shared/src/recipes.ts shared/src/splits.ts shared/src/salesExport.ts ` +
  `--outDir ${tmp} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
for (const f of readdirSync(tmp).filter(n => n.endsWith('.js'))) {
  const p = join(tmp, f)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const { lineConsumption, consumptionCost, recipeProblems, describeQty, theoreticalFoodCost, suggestedPrice, targetMarginFor } =
  await import(`file://${join(tmp, 'recipes.js')}`)
const { stationForSection } = await import(`file://${join(tmp, 'checks.js')}`)
const { shareForLines } = await import(`file://${join(tmp, 'splits.js')}`)
const { closedAtParts } = await import(`file://${join(tmp, 'salesExport.js')}`)

const timeZone = process.env.NEXT_PUBLIC_TIMEZONE ?? 'Asia/Beirut'

// ── What a demo café measures in ───────────────────────────────────────────
// Pack sizes (a bag of sugar, a bottle of syrup) are this demo's, not facts —
// which is exactly why the application has no default for them.
const CONVERSIONS = {
  'supply-coffee-beans':    { recipeUnit: 'g',   factor: 1000 },
  'supply-decaf-beans':     { recipeUnit: 'g',   factor: 1000 },
  'supply-whole-milk':      { recipeUnit: 'ml',  factor: 1000 },
  'supply-skim-milk':       { recipeUnit: 'ml',  factor: 1000 },
  'supply-heavy-cream':     { recipeUnit: 'ml',  factor: 1000 },
  'supply-syrup-vanilla':   { recipeUnit: 'ml',  factor: 750 },
  'supply-syrup-caramel':   { recipeUnit: 'ml',  factor: 750 },
  'supply-syrup-hazelnut':  { recipeUnit: 'ml',  factor: 750 },
  'supply-tea-black':       { recipeUnit: 'bag', factor: 100 },
  'supply-ice':             { recipeUnit: 'g',   factor: 5000 },
  'supply-lemons':          { recipeUnit: 'g',   factor: 1000, yieldPercent: 45 },
  'supply-sugar-white':     { recipeUnit: 'g',   factor: 10000 },
  'supply-sugar-brown':     { recipeUnit: 'g',   factor: 10000 },
  'supply-flour-white':     { recipeUnit: 'g',   factor: 25000 },
  'supply-butter':          { recipeUnit: 'g',   factor: 1000 },
  'supply-cheddar':         { recipeUnit: 'g',   factor: 1000 },
  'supply-mozzarella':      { recipeUnit: 'g',   factor: 1000 },
  'supply-chicken-breast':  { recipeUnit: 'g',   factor: 1000, yieldPercent: 90 },
  'supply-tomatoes':        { recipeUnit: 'g',   factor: 1000, yieldPercent: 90 },
  'supply-potatoes':        { recipeUnit: 'g',   factor: 1000, yieldPercent: 80 },
  'supply-olive-oil':       { recipeUnit: 'ml',  factor: 1000 },
  'supply-salt':            { recipeUnit: 'g',   factor: 1000 },
  // Bought and used as the same thing: trim only, no conversion.
  'supply-lettuce':         { yieldPercent: 70 },
}

const s = (id, qty) => ({ supplyId: `supply-${id}`, qty })
const COFFEE_EXTRAS = {
  'Extra shot': [s('coffee-beans', 18)],
  'Vanilla syrup': [s('syrup-vanilla', 15)],
  'Whipped cream': [s('heavy-cream', 30)],
}

/** Lines per serving, and what a named option adds. */
const RECIPES = {
  'item-espresso':      { lines: [s('coffee-beans', 18)], options: { ...COFFEE_EXTRAS, Large: [s('coffee-beans', 9)] } },
  'item-americano':     { lines: [s('coffee-beans', 18)], options: { ...COFFEE_EXTRAS, Large: [s('coffee-beans', 9)] } },
  'item-cappuccino':    { lines: [s('coffee-beans', 18), s('whole-milk', 150)], options: { ...COFFEE_EXTRAS, Large: [s('whole-milk', 100)] } },
  'item-latte':         { lines: [s('coffee-beans', 18), s('whole-milk', 220)], options: { ...COFFEE_EXTRAS, Large: [s('whole-milk', 120)] } },
  'item-iced-latte':    { lines: [s('coffee-beans', 18), s('whole-milk', 180), s('ice', 150)], options: { ...COFFEE_EXTRAS, Large: [s('whole-milk', 100)] } },
  'item-tea':           { lines: [s('tea-black', 2)], options: { 'Vanilla syrup': [s('syrup-vanilla', 15)] } },
  'item-lemonade':      { lines: [s('lemons', 120), s('sugar-white', 30), s('ice', 100)], options: { Large: [s('lemons', 60), s('sugar-white', 15)] } },
  'item-soft-drink':    { lines: [s('cola', 1), s('ice', 80)] },
  'item-sparkling':     { lines: [s('sparkling-water', 1)] },
  'item-brownie':       { lines: [s('flour-white', 40), s('butter', 30), s('sugar-brown', 45)] },
  'item-cookie':        { lines: [s('flour-white', 30), s('butter', 15), s('sugar-brown', 20)] },
  'item-cheesecake':    { lines: [s('heavy-cream', 60), s('sugar-white', 35), s('butter', 20), s('flour-white', 25)] },
  'item-fries':         { lines: [s('potatoes', 250), s('olive-oil', 30), s('salt', 3)] },
  'item-margherita':    { lines: [s('flour-white', 180), s('mozzarella', 120), s('tomatoes', 100), s('olive-oil', 10), s('salt', 3)] },
  'item-caesar-salad':  { lines: [s('lettuce', 1), s('chicken-breast', 120), s('cheddar', 20), s('olive-oil', 15), s('lemons', 20)] },
}

// ── What is there now ──────────────────────────────────────────────────────
const [supplySnap, menuSnap, groupSnap, recipeSnap, categorySnap, settingsSnap] = await Promise.all([
  db.collection('supplies').get(),
  db.collection('menuItems').get(),
  db.collection('modifierGroups').get(),
  db.collection('recipes').get(),
  db.collection('menuCategories').get(),
  db.doc('appSettings/business').get(),
])

// For the suggested price printed beside each dish. The stored figures, or the
// settings page's defaults when none are saved — and today's rate only, which
// is all a printout needs; the pages read the scheduled change too.
const business = settingsSnap.data() ?? {}
const printVat = Number(business.vatRate ?? 0)
const margins = { food: Number(business.targetMarginFood ?? 0.7), drink: Number(business.targetMarginDrink ?? 0.8) }
const sectionOf = new Map(categorySnap.docs.map(d => [d.id, String(d.data().section ?? '')]))

// Supplies as they will be once the conversions are filled, in the shape the
// server's toRecipeSupply() reads.
const n = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const supplies = {}
const supplyWrites = []
let keptConversions = 0
for (const d of supplySnap.docs) {
  const data = d.data()
  const conv = CONVERSIONS[d.id]
  const hasOwn = n(data.recipeUnitsPerPurchaseUnit) !== null || n(data.yieldPercent) !== null
    || (typeof data.recipeUnit === 'string' && data.recipeUnit.trim() !== '')
  const fill = conv && !hasOwn
  if (conv && hasOwn) keptConversions++
  const merged = fill
    ? { ...data, recipeUnit: conv.recipeUnit ?? null, recipeUnitsPerPurchaseUnit: conv.factor ?? null, yieldPercent: conv.yieldPercent ?? null }
    : data
  supplies[d.id] = {
    id: d.id,
    name: String(merged.name ?? d.id),
    unit: String(merged.unit ?? ''),
    recipeUnit: typeof merged.recipeUnit === 'string' && merged.recipeUnit.trim() ? merged.recipeUnit : null,
    recipeUnitsPerPurchaseUnit: n(merged.recipeUnitsPerPurchaseUnit),
    yieldPercent: n(merged.yieldPercent),
    avgUnitCost: n(merged.avgUnitCost),
  }
  if (fill) {
    supplyWrites.push({
      ref: d.ref,
      fields: {
        ...(conv.recipeUnit ? { recipeUnit: conv.recipeUnit, recipeUnitsPerPurchaseUnit: conv.factor } : {}),
        ...(conv.yieldPercent ? { yieldPercent: conv.yieldPercent } : {}),
        recipeSeeded: true,
      },
    })
  }
}

const groups = new Map(groupSnap.docs.map(d => [d.id, d.data()]))
const menu = new Map(menuSnap.docs.map(d => [d.id, d.data()]))
const existingRecipes = new Map(recipeSnap.docs.map(d => [d.id, d.data()]))

const recipes = new Map()
const recipeWrites = []
const problems = []
console.log('\nRecipes')
for (const [menuItemId, spec] of Object.entries(RECIPES)) {
  const item = menu.get(menuItemId)
  if (!item) { console.log(`  skip  ${menuItemId}: not on the menu`); continue }
  const existing = existingRecipes.get(menuItemId)
  if (existing && !existing.seeded) {
    // Somebody's own recipe wins, and snapshots use it.
    recipes.set(menuItemId, { lines: existing.lines ?? [], adjustments: existing.adjustments ?? {} })
    console.log(`  keep  ${item.name}: saved on the Recipes page, left alone`)
    continue
  }

  // Options are found by name within the item's own groups — option ids are
  // generated per project, and saveRecipe() refuses an option the item does not offer.
  const offered = (item.modifierGroupIds ?? []).flatMap(id => groups.get(id)?.options ?? [])
  const adjustments = {}
  for (const [optionName, adds] of Object.entries(spec.options ?? {})) {
    const option = offered.find(o => String(o.name).toLowerCase() === optionName.toLowerCase())
    if (!option) continue
    adjustments[option.id] = adds.map(a => ({ kind: 'add', supplyId: a.supplyId, qty: a.qty }))
  }
  const recipe = { lines: spec.lines, adjustments }
  for (const p of recipeProblems(recipe, supplies)) problems.push(`${item.name}: ${p}`)

  const plain = lineConsumption(recipe, [], 1, supplies)
  const cost = consumptionCost(plain)
  const target = targetMarginFor(stationForSection(sectionOf.get(item.categoryId)), margins)
  const suggested = target === null ? null : suggestedPrice(cost.costUsd, target, printVat)
  console.log(`  ${item.name.padEnd(18)} $${Number(item.price).toFixed(2).padStart(5)}  costs ` +
    (cost.costUsd === null ? `unknown (${plain.unknown.join(', ')})` : `$${cost.costUsd.toFixed(2)}`) +
    (suggested ? `  → suggested $${suggested.roundedUsd.toFixed(2)} at ${Math.round(target * 100)}%${Number(item.price) < suggested.withVatUsd ? ' (priced below it)' : ''}` : '') +
    `  · ${spec.lines.map(l => `${supplies[l.supplyId]?.name ?? l.supplyId} ${describeQty(l.qty, supplies[l.supplyId] ?? { unit: '?' })}`).join(', ')}`)

  recipes.set(menuItemId, recipe)
  const referenced = [...recipe.lines.map(l => l.supplyId), ...Object.values(adjustments).flat().map(a => a.supplyId)]
  recipeWrites.push({
    ref: db.doc(`recipes/${menuItemId}`),
    doc: {
      menuItemId,
      lines: recipe.lines,
      adjustments,
      supplyIds: [...new Set(referenced)].sort(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'seed',
      updatedByEmail: 'seed@demo',
      seeded: true,
    },
  })
}
for (const [id, item] of menu) {
  if (!recipes.has(id)) console.log(`  none  ${item.name}: no recipe — left out of theoretical food cost, which is the point`)
}

if (problems.length > 0) {
  console.error(`\nREFUSING: recipeProblems() found ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

// ── Snapshots on the seeded checks ─────────────────────────────────────────
const seededChecks = await db.collection('checks').where('seeded', '==', true).get()
let snapshotted = 0
let withoutRecipe = 0
const checkWrites = []
const afterChecks = []
for (const d of seededChecks.docs) {
  const data = d.data()
  const lines = (data.lines ?? []).map(({ consumesPerServing, consumesUnknown, ...line }) => {
    const recipe = line.source === 'menu' ? recipes.get(line.refId) : undefined
    if (!recipe) { if (line.source === 'menu') withoutRecipe++; return line }
    // Exactly the call buildLines() makes at the till: per serving, with the
    // line's own options.
    const c = lineConsumption(recipe, (line.modifiers ?? []).map(m => m.optionId), 1, supplies)
    snapshotted++
    return {
      ...line,
      ...(c.consumes.length > 0 ? { consumesPerServing: c.consumes } : {}),
      ...(c.unknown.length > 0 ? { consumesUnknown: c.unknown } : {}),
    }
  })
  checkWrites.push({ ref: d.ref, lines })
  afterChecks.push({ id: d.id, ...data, lines })
}

// ── What the Food Cost Report should then say ──────────────────────────────
function theoryFor(from, to) {
  const sold = []
  let checks = 0
  for (const check of afterChecks) {
    if (check.status !== 'closed') continue
    const { day } = closedAtParts(check.closedAt, timeZone)
    if (!day || day < from || day > to) continue
    checks++
    const vatRate = typeof check.vatRate === 'number' ? check.vatRate : null
    for (const line of check.lines) {
      if (line.status === 'void') continue
      sold.push({ ...line, salesUsd: shareForLines(check, [line.id]), vatRate })
    }
  }
  return { checks, ...theoreticalFoodCost(sold) }
}
const days = afterChecks.map(c => closedAtParts(c.closedAt, timeZone).day).filter(Boolean).sort()
const pct = x => (x === null ? '—' : `${(x * 100).toFixed(1)}%`)

console.log(`\n${supplyWrites.length} conversions to fill` + (keptConversions ? `, ${keptConversions} already set and kept` : ''))
console.log(`${recipeWrites.length} recipes to write`)
console.log(`${seededChecks.size} seeded checks: ${snapshotted} lines snapshotted, ${withoutRecipe} menu lines with no recipe`)
if (days.length > 0) {
  const t = theoryFor(days[0], days[days.length - 1])
  console.log(`\nTheoretical food cost, all branches, café days ${days[0]} → ${days[days.length - 1]}:`)
  console.log(`  ${pct(t.costPercent)} — $${t.costUsd.toFixed(2)} of recipe cost on $${t.costedSalesExVatUsd.toFixed(2)} of costed sales before VAT`)
  console.log(`  coverage ${pct(t.coverage)} of $${t.salesExVatUsd.toFixed(2)} · ${t.checks} closed checks · ` +
    `${t.linesCosted} costed, ${t.linesUncosted} uncosted, ${t.linesWithoutRecipe} without a recipe, ${t.linesWithoutVatRate} without a VAT rate`)
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Add --apply to write it.')
  process.exit(0)
}

await commitAll([
  ...supplyWrites.map(w => b => b.update(w.ref, w.fields)),
  ...recipeWrites.map(w => b => b.set(w.ref, w.doc)),
  ...checkWrites.map(w => b => b.update(w.ref, { lines: w.lines, recipeSnapshotSeeded: true })),
], 'written')
console.log('Done.')
