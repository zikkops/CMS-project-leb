// Assertions over recipe costing and ingredient stock — shared/src/recipes.ts.
//
//   node scripts/verify-recipes.mjs
//   npm run verify:recipes
//
// Same shape as the other verifiers: transpile the real module and assert
// against it. Nothing is re-implemented.
//
// ── Why it exists before any screen does ───────────────────────────────────
// Stock and money arithmetic that lives in a component cannot be asserted on,
// and that is how the counter till's two money bugs shipped past tsc, builds
// and a browser. The failure this module most has to prevent is quiet: a wrong
// unit factor is a number a thousand times too big, and an uncosted ingredient
// makes a dish look cheap. Both are asserted here as UNKNOWN, never a guess.
//
// The decaf cases were added after a mutation survived: the first tests never
// combined an addition with a replacement of the SAME ingredient, which is the
// only place their order matters — and the order first written put regular
// beans into a decaf latte's extra shot.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'recipes-verify-'))
execSync(
  `npx tsc shared/src/recipes.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const R = await import(`file://${join(out, 'recipes.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

// Purchase units are what receiving and the count use; recipe units are what a
// barista measures. Costs are USD per purchase unit.
const milk  = { id: 'milk',  name: 'Whole milk',     unit: 'gallon', recipeUnit: 'ml', recipeUnitsPerPurchaseUnit: 3785.41, avgUnitCost: 4.2 }
const oat   = { id: 'oat',   name: 'Oat milk',       unit: 'liter',  recipeUnit: 'ml', recipeUnitsPerPurchaseUnit: 1000,    avgUnitCost: 3.6 }
const beans = { id: 'beans', name: 'Espresso beans', unit: 'kg',     recipeUnit: 'g',  recipeUnitsPerPurchaseUnit: 1000,    avgUnitCost: 22 }
const decaf = { id: 'decaf', name: 'Decaf beans',    unit: 'kg',     recipeUnit: 'g',  recipeUnitsPerPurchaseUnit: 1000,    avgUnitCost: 26 }
const cups  = { id: 'cups',  name: 'Takeaway cup',   unit: 'pcs',                                                          avgUnitCost: 0.15 }
const onion = { id: 'onion', name: 'Onion',          unit: 'kg',     recipeUnit: 'g',  recipeUnitsPerPurchaseUnit: 1000, yieldPercent: 85, avgUnitCost: 1.3 }
// A factor nobody entered, and an ingredient nobody has received yet.
const syrup = { id: 'syrup', name: 'Vanilla syrup',  unit: 'bottle', recipeUnit: 'ml',                                     avgUnitCost: 9 }
const fresh = { id: 'fresh', name: 'New oat brand',  unit: 'liter',  recipeUnit: 'ml', recipeUnitsPerPurchaseUnit: 1000,    avgUnitCost: 0 }
const S = { milk, oat, beans, decaf, cups, onion, syrup, fresh }

const latte = {
  lines: [{ supplyId: 'beans', qty: 18 }, { supplyId: 'milk', qty: 200 }],
  adjustments: {
    'opt-oat':     [{ kind: 'replace', fromSupplyId: 'milk', toSupplyId: 'oat' }],
    'opt-decaf':   [{ kind: 'replace', fromSupplyId: 'beans', toSupplyId: 'decaf' }],
    'opt-shot':    [{ kind: 'add', supplyId: 'beans', qty: 18 }],
    'opt-milk':    [{ kind: 'add', supplyId: 'milk', qty: 50 }],
    'opt-vanilla': [{ kind: 'add', supplyId: 'syrup', qty: 15 }],
  },
}

console.log('\nunits — recipe units into the units stock is counted in')
eq('200 ml of milk is a fraction of a gallon', R.toPurchaseUnits(200, milk), 0.052834)
eq('18 g of beans is 0.018 kg', R.toPurchaseUnits(18, beans), 0.018)
eq('a cup bought and used as pieces needs no factor', R.toPurchaseUnits(1, cups), 1)
eq('THE TRAP: a recipe unit with no factor is unknown, not 1', R.toPurchaseUnits(15, syrup), null)
eq('...and a zero factor is unknown too', R.toPurchaseUnits(15, { ...syrup, recipeUnitsPerPurchaseUnit: 0 }), null)
eq('...as is a negative one', R.toPurchaseUnits(15, { ...syrup, recipeUnitsPerPurchaseUnit: -30 }), null)
eq('a negative quantity is refused', R.toPurchaseUnits(-5, beans), null)
eq('quantities keep six decimals', R.roundQty(0.1 + 0.2), 0.3)

console.log('\nunit spellings — "L" and "liter" are the same litre')
// The inventory form offers L, mL and pieces; the order template liter and pcs.
eq('L and liter need no factor', R.toPurchaseUnits(2, { id: 'w', unit: 'L', recipeUnit: 'liter' }), 2)
eq('mL and ml need no factor', R.toPurchaseUnits(250, { id: 'c', unit: 'mL', recipeUnit: 'ml' }), 250)
eq('pieces and pcs need no factor', R.toPurchaseUnits(3, { id: 'e', unit: 'pieces', recipeUnit: 'pcs' }), 3)
eq('a suggested factor reads through spellings', R.suggestedFactor('L', 'mL'), 1000)
eq('...long names too', R.suggestedFactor('Kilograms', 'grams'), 1000)
eq('an unrecognised unit still needs a real factor', R.toPurchaseUnits(3, { id: 'x', unit: 'crate', recipeUnit: 'bottle' }), null)

console.log('\ntrim — what is bought versus what ends up in the dish')
eq('85 g of onion at 85% usable is 100 g bought', R.toPurchaseUnits(85, onion), 0.1)
eq('no yield set means all of it is usable', R.yieldFraction(beans), 1)
eq('a yield of 0 is unknown, not a division by zero', R.toPurchaseUnits(85, { ...onion, yieldPercent: 0 }), null)
eq('a yield above 100% is unknown', R.toPurchaseUnits(85, { ...onion, yieldPercent: 150 }), null)
eq('a yield of NaN is unknown', R.toPurchaseUnits(85, { ...onion, yieldPercent: Number.NaN }), null)

console.log('\nboth units, as the editor shows them')
// Seeing the purchase figure is the cheapest defence against a wrong factor.
eq('milk', R.describeQty(200, milk), '200 ml = 0.0528 gallon')
eq('onion, trim included', R.describeQty(85, onion), '85 g = 0.1 kg')
eq('a supply used in its own unit says it once', R.describeQty(1, cups), '1 pcs')
eq('a missing factor says so instead of guessing', R.describeQty(15, syrup), '15 ml = ? bottle (no conversion set)')

console.log('\nsuggested factors')
eq('gallon to ml', R.suggestedFactor('gallon', 'ml'), 3785.41)
eq('kg to g', R.suggestedFactor('kg', 'g'), 1000)
eq('a box has no fixed size', R.suggestedFactor('box', 'pcs'), null)
eq('the same unit is 1', R.suggestedFactor('kg', 'kg'), 1)

console.log('\nmodifiers — add and replace')
eq('the recipe as written', R.resolveLines(latte, []),
  [{ supplyId: 'beans', qty: 18 }, { supplyId: 'milk', qty: 200 }])
eq('oat milk replaces the milk, same quantity', R.resolveLines(latte, ['opt-oat']),
  [{ supplyId: 'beans', qty: 18 }, { supplyId: 'oat', qty: 200 }])
eq('an extra shot adds beans', R.resolveLines(latte, ['opt-shot']),
  [{ supplyId: 'beans', qty: 36 }, { supplyId: 'milk', qty: 200 }])
eq('oat milk and an extra shot together', R.resolveLines(latte, ['opt-oat', 'opt-shot']),
  [{ supplyId: 'beans', qty: 36 }, { supplyId: 'oat', qty: 200 }])
eq('an option with no adjustment changes nothing', R.resolveLines(latte, ['opt-large']), R.resolveLines(latte, []))
eq('the same option twice counts once', R.resolveLines(latte, ['opt-shot', 'opt-shot']),
  [{ supplyId: 'beans', qty: 36 }, { supplyId: 'milk', qty: 200 }])
eq('replacing something the recipe lacks is a no-op',
  R.resolveLines({ lines: [{ supplyId: 'beans', qty: 18 }], adjustments: { x: [{ kind: 'replace', fromSupplyId: 'milk', toSupplyId: 'oat' }] } }, ['x']),
  [{ supplyId: 'beans', qty: 18 }])
eq('a supply listed twice is merged',
  R.resolveLines({ lines: [{ supplyId: 'beans', qty: 9 }, { supplyId: 'beans', qty: 9 }] }, []),
  [{ supplyId: 'beans', qty: 18 }])

console.log('\nan addition and a replacement of the same ingredient')
// The only place their order matters, and the case the first tests never had.
eq('THE TRAP: an extra shot in a decaf latte is decaf', R.resolveLines(latte, ['opt-decaf', 'opt-shot']),
  [{ supplyId: 'decaf', qty: 36 }, { supplyId: 'milk', qty: 200 }])
eq('THE TRAP: extra milk in an oat latte is oat', R.resolveLines(latte, ['opt-oat', 'opt-milk']),
  [{ supplyId: 'beans', qty: 18 }, { supplyId: 'oat', qty: 250 }])
eq('THE TRAP: tap order does not change a decaf with an extra shot',
  R.resolveLines(latte, ['opt-shot', 'opt-decaf']), R.resolveLines(latte, ['opt-decaf', 'opt-shot']))
eq('...nor an oat latte with extra milk',
  R.resolveLines(latte, ['opt-milk', 'opt-oat']), R.resolveLines(latte, ['opt-oat', 'opt-milk']))

console.log('\nwhat a line takes off the shelf')
{
  const one = R.lineConsumption(latte, [], 1, S)
  eq('one latte', one, {
    consumes: [
      { supplyId: 'beans', qty: 0.018, unitCostUsd: 22 },
      { supplyId: 'milk', qty: 0.052834, unitCostUsd: 4.2 },
    ],
    unknown: [],
  })
  eq('three lattes take three times as much', R.lineConsumption(latte, [], 3, S).consumes.map(c => c.qty), [0.054, 0.158502])
  eq('a quantity of 0 takes nothing', R.lineConsumption(latte, [], 0, S), { consumes: [], unknown: [] })
  eq('a fractional quantity is refused', R.lineConsumption(latte, [], 1.5, S), { consumes: [], unknown: [] })

  const vanilla = R.lineConsumption(latte, ['opt-vanilla'], 1, S)
  eq('an ingredient with no conversion is reported, not guessed', vanilla.unknown, ['syrup'])
  eq('...and the rest of the drink still counts', vanilla.consumes.map(c => c.supplyId), ['beans', 'milk'])
  eq('a supply missing from the list is unknown',
    R.lineConsumption({ lines: [{ supplyId: 'ghost', qty: 5 }] }, [], 1, S).unknown, ['ghost'])
}

console.log('\nwhat a dish costs')
{
  eq('a latte', R.consumptionCost(R.lineConsumption(latte, [], 1, S)), { costUsd: 0.62, reason: 'ok', missing: [] })
  eq('an oat latte', R.consumptionCost(R.lineConsumption(latte, ['opt-oat'], 1, S)).costUsd, 1.12)
  eq('a decaf latte with an extra shot costs decaf twice',
    R.consumptionCost(R.lineConsumption(latte, ['opt-decaf', 'opt-shot'], 1, S)).costUsd, 1.16)
  eq('THE TRAP: a never-received ingredient is unknown, never $0',
    R.consumptionCost(R.lineConsumption({ lines: [{ supplyId: 'fresh', qty: 200 }] }, [], 1, S)),
    { costUsd: null, reason: 'incomplete', missing: ['fresh'] })
  eq('a missing conversion makes the whole dish unknown',
    R.consumptionCost(R.lineConsumption(latte, ['opt-vanilla'], 1, S)),
    { costUsd: null, reason: 'incomplete', missing: ['syrup'] })
  eq('an empty recipe has no cost rather than a free one',
    R.consumptionCost({ consumes: [], unknown: [] }), { costUsd: null, reason: 'empty', missing: [] })
}

console.log('\nmargin, on the price before VAT')
{
  // A deliberately unround rate, so a hardcoded one cannot pass by coincidence.
  const m = R.dishMargin(5.65, 0.62, 0.13)
  eq('THE TRAP: the price is taken before VAT', m.priceExVatUsd, 5)
  eq('...so the margin is on that', m.marginUsd, 4.38)
  eq('...and so is the cost share', m.costPercent, 0.124)
  eq('an unknown cost gives no margin', R.dishMargin(5.65, null, 0.13), { priceExVatUsd: 5, marginUsd: null, costPercent: null })
}

console.log('\none stock move per supply for a whole Send')
{
  const moves = R.stockMoves([
    R.lineConsumption(latte, [], 2, S).consumes,
    R.lineConsumption(latte, ['opt-oat'], 1, S).consumes,
  ])
  eq('summed by supply, sorted', moves, [
    { supplyId: 'beans', qty: 0.054 },
    { supplyId: 'milk', qty: 0.105668 },
    { supplyId: 'oat', qty: 0.2 },
  ])
  eq('nothing sent, nothing moved', R.stockMoves([]), [])
}

console.log('\na serving snapshot scaled to a line')
{
  // A check line stores what ONE serving takes; the quantity multiplies it
  // wherever stock moves, so the snapshot cannot go stale if a quantity ever
  // becomes editable.
  const perServing = R.lineConsumption(latte, [], 1, S).consumes
  eq('three servings take three times one', R.scaleConsumption(perServing, 3).map(c => c.qty), [0.054, 0.158502])
  eq('...exactly what consuming three at once takes',
    R.scaleConsumption(perServing, 3), R.lineConsumption(latte, [], 3, S).consumes)
  eq('the cost per purchase unit is carried, not multiplied',
    R.scaleConsumption(perServing, 3).map(c => c.unitCostUsd), [22, 4.2])
  eq('a quantity of 0 takes nothing', R.scaleConsumption(perServing, 0), [])
  eq('a fractional quantity is refused', R.scaleConsumption(perServing, 2.5), [])
}

console.log('\nvoids and refunds follow their cause')
eq('never sent: nothing was taken', R.ingredientOutcome(false, { returnsToStock: true, isWaste: false }), 'nothing-taken')
eq('changed their mind before it was made: back on the shelf', R.ingredientOutcome(true, { returnsToStock: true, isWaste: false }), 'return')
eq('already made: waste', R.ingredientOutcome(true, { returnsToStock: false, isWaste: true }), 'waste')
eq('eaten and not wasted: kept', R.ingredientOutcome(true, { returnsToStock: false, isWaste: false }), 'kept')
eq('THE TRAP: a reason claiming both is waste, never invented stock',
  R.ingredientOutcome(true, { returnsToStock: true, isWaste: true }), 'waste')

console.log('\nwhat a Send takes, and what a void or refund gives back')
{
  const perServing = R.lineConsumption(latte, [], 1, S).consumes
  const oatServing = R.lineConsumption(latte, ['opt-oat'], 1, S).consumes
  const drafts = [
    { status: 'draft', quantity: 2, consumesPerServing: perServing },
    { status: 'draft', quantity: 1, consumesPerServing: oatServing },
    { status: 'draft', quantity: 4 },                                  // merchandise: no snapshot
    { status: 'draft', quantity: 3, consumesPerServing: [] },          // a dish with no ingredients
  ]
  eq('a Send takes each dish times its quantity, one move per supply', R.sendMoves(drafts), [
    { supplyId: 'beans', qty: 0.054 }, { supplyId: 'milk', qty: 0.105668 }, { supplyId: 'oat', qty: 0.2 },
  ])
  eq('a line with no snapshot takes nothing', R.lineTaken(drafts[2]), [])

  const sent = { status: 'sent', quantity: 2, consumesPerServing: perServing }
  const changedMind = { returnsToStock: true, isWaste: false }
  const madeWrong = { returnsToStock: false, isWaste: true }
  eq('changed their mind before it was made: the ingredients come back',
    R.reversalPlan([sent], true, changedMind),
    { outcome: 'return', returns: [{ supplyId: 'beans', qty: 0.036 }, { supplyId: 'milk', qty: 0.105668 }], wasteUsd: 0 })
  eq('already made: nothing comes back, and the waste is valued',
    R.reversalPlan([sent], true, madeWrong), { outcome: 'waste', returns: [], wasteUsd: 1.24 })
  eq('never sent: nothing was taken, so nothing comes back',
    R.reversalPlan([{ ...sent, status: 'draft' }], false, changedMind), { outcome: 'nothing-taken', returns: [], wasteUsd: 0 })
  eq('a refund skips lines already voided',
    R.reversalPlan([sent, { ...sent, status: 'void' }], true, changedMind).returns,
    [{ supplyId: 'beans', qty: 0.036 }, { supplyId: 'milk', qty: 0.105668 }])
  eq('THE TRAP: waste that cannot be costed is unknown, not smaller',
    R.reversalPlan([sent, { ...sent, consumesUnknown: ['syrup'] }], true, madeWrong).wasteUsd, null)
  eq('nothing carrying ingredients: no outcome at all',
    R.reversalPlan([{ status: 'sent', quantity: 1 }], true, madeWrong), { outcome: null, returns: [], wasteUsd: 0 })
}

console.log('\ntheoretical food cost — the POS checks\' own sales, before VAT')
{
  const perServing = R.lineConsumption(latte, [], 1, S).consumes
  // A deliberately unround VAT rate, so a hardcoded one cannot pass by coincidence.
  const costed   = { status: 'sent', quantity: 2, consumesPerServing: perServing, salesUsd: 11.3, vatRate: 0.13 }
  const noRecipe = { status: 'sent', quantity: 1, salesUsd: 4.52, vatRate: 0.13 }
  const uncosted = { status: 'sent', quantity: 1, consumesPerServing: perServing, consumesUnknown: ['syrup'], salesUsd: 5.65, vatRate: 0.13 }
  const voided   = { status: 'void', quantity: 1, consumesPerServing: perServing, salesUsd: 5.65, vatRate: 0.13 }
  const r4 = n => (n === null ? null : Number(n.toFixed(4)))

  const all = R.theoreticalFoodCost([costed, noRecipe, uncosted, voided])
  eq('sales are taken before VAT, at each check\'s own rate', all.salesExVatUsd, 19)
  eq('only fully costed lines are in the costed sales', all.costedSalesExVatUsd, 10)
  eq('...and their ingredient cost comes from the snapshots', all.costUsd, 1.24)
  eq('food cost is over the costable sales', r4(all.costPercent), 0.124)
  eq('coverage says how much of sales that is', r4(all.coverage), 0.5263)
  eq('lines are counted by what could be costed',
    [all.linesCosted, all.linesUncosted, all.linesWithoutRecipe], [1, 1, 1])

  const withoutGaps = R.theoreticalFoodCost([costed])
  eq('THE TRAP: a dish with no recipe does not make food cost look cheaper',
    r4(all.costPercent), r4(withoutGaps.costPercent))
  eq('...nor does a dish whose recipe cannot be costed',
    r4(R.theoreticalFoodCost([costed, uncosted]).costPercent), r4(withoutGaps.costPercent))
  eq('...they lower the coverage instead', r4(R.theoreticalFoodCost([costed, uncosted]).coverage), 0.6667)

  const noRate = R.theoreticalFoodCost([{ ...costed, vatRate: null }])
  eq('a check with no recorded VAT rate is counted at full price', noRate.salesExVatUsd, 11.3)
  eq('...and flagged, never guessed at today\'s rate', noRate.linesWithoutVatRate, 1)

  eq('merchandise is not food: a mug sold is in neither side',
    R.theoreticalFoodCost([costed, { ...noRecipe, source: 'product' }]).coverage, 1)

  eq('no sales: no percentage and no coverage', R.theoreticalFoodCost([]),
    { salesExVatUsd: 0, costedSalesExVatUsd: 0, costUsd: 0, costPercent: null, coverage: null,
      linesCosted: 0, linesUncosted: 0, linesWithoutRecipe: 0, linesWithoutVatRate: 0 })
  eq('nothing costable: no percentage, not 0%', R.theoreticalFoodCost([noRecipe]).costPercent, null)
}

console.log('\nwhat a dish should sell for')
{
  // VAT 0.13 on purpose, as above: not the café's configured rate.
  eq('70% margin on $1.20: $4.00 before VAT, $4.52 with it, $4.75 on the menu',
    R.suggestedPrice(1.2, 0.7, 0.13), { exVatUsd: 4, withVatUsd: 4.52, roundedUsd: 4.75 })
  const m = R.dishMargin(4.75, 1.2, 0.13)
  eq('THE TRAP: at the suggested price the margin is at least the target, before VAT',
    m.costPercent <= 0.3, true)
  eq('...which it would not be if VAT were left out of the suggestion',
    R.dishMargin(4, 1.2, 0.13).costPercent > 0.3, true)
  // 0.2 ÷ (1 − 0.8) is 1.0000000000000002 in floating point: a hair above $1.00.
  eq('a price exactly on a step is not pushed to the next one by float noise',
    R.suggestedPrice(0.2, 0.8, 0).roundedUsd, 1)
  eq('a drink at 80% costs more to buy than the same cost at 70%',
    R.suggestedPrice(0.59, 0.8, 0.13), { exVatUsd: 2.95, withVatUsd: 3.33, roundedUsd: 3.5 })
  eq('no margin: cost plus VAT, rounded up', R.suggestedPrice(2, 0, 0.13).roundedUsd, 2.5)
  eq('another step', R.suggestedPrice(1.2, 0.7, 0.13, 0.5).roundedUsd, 5)
  eq('no cost: nothing to suggest, not $0.00', R.suggestedPrice(null, 0.7, 0.13), null)
  eq('a cost of zero: nothing to suggest', R.suggestedPrice(0, 0.7, 0.13), null)
  eq('a 100% margin: no price reaches it', R.suggestedPrice(1.2, 1, 0.13), null)
  eq('a negative margin: refused', R.suggestedPrice(1.2, -0.1, 0.13), null)
  eq('a nonsense VAT rate counts as none, as dishMargin does', R.suggestedPrice(1.2, 0.7, Number.NaN).roundedUsd, 4)

  const margins = { food: 0.65, drink: 0.85 }
  eq('drinks take the drinks margin', R.targetMarginFor('Bar', margins), 0.85)
  eq('the kitchen takes the food margin', R.targetMarginFor('Kitchen', margins), 0.65)
  eq('sweets are food, as for the staff discount', R.targetMarginFor('Sweets', margins), 0.65)
  eq('an unmapped station gets no target, not a guess', R.targetMarginFor(null, margins), null)
}

console.log('\ncounted against expected')
eq('half a gallon short', R.countVariance(2.5, 2, 4.2), { varianceQty: -0.5, varianceUsd: -2.1 })
eq('more than expected is positive', R.countVariance(2, 2.75, 4.2).varianceQty, 0.75)
eq('no expected figure: no variance, not an invented one', R.countVariance(null, 2, 4.2), { varianceQty: null, varianceUsd: null })
eq('an uncosted supply has a quantity but no money', R.countVariance(2, 2.75, 0), { varianceQty: 0.75, varianceUsd: null })

console.log('\nwhat stops a recipe being saved')
{
  const clean = { lines: [{ supplyId: 'beans', qty: 18 }, { supplyId: 'milk', qty: 200 }],
    adjustments: { 'opt-oat': [{ kind: 'replace', fromSupplyId: 'milk', toSupplyId: 'oat' }] } }
  eq('a sound recipe has no problems', R.recipeProblems(clean, S), [])
  eq('an empty recipe', R.recipeProblems({ lines: [] }).length > 0, true)
  eq('a quantity of zero', R.recipeProblems({ lines: [{ supplyId: 'beans', qty: 0 }] }, S),
    ['Espresso beans needs a quantity above zero.'])
  eq('replacing with itself', R.recipeProblems({ lines: [{ supplyId: 'milk', qty: 200 }],
    adjustments: { o: [{ kind: 'replace', fromSupplyId: 'milk', toSupplyId: 'milk' }] } }, S),
    ['Whole milk cannot replace itself.'])
  eq('replacing something not in the recipe', R.recipeProblems({ lines: [{ supplyId: 'beans', qty: 18 }],
    adjustments: { o: [{ kind: 'replace', fromSupplyId: 'milk', toSupplyId: 'oat' }] } }, S),
    ['Oat milk replaces Whole milk, which this recipe does not use.'])
  eq('adding a negative amount', R.recipeProblems({ lines: [{ supplyId: 'beans', qty: 18 }],
    adjustments: { o: [{ kind: 'add', supplyId: 'beans', qty: -1 }] } }, S),
    ['Adding Espresso beans needs a quantity above zero.'])
  eq('THE TRAP: an ingredient with no conversion cannot be saved', R.recipeProblems({ lines: [{ supplyId: 'syrup', qty: 15 }] }, S),
    ['Vanilla syrup is measured in ml but has no conversion to bottle.'])
  eq('an ingredient no longer in supplies', R.recipeProblems({ lines: [{ supplyId: 'ghost', qty: 5 }] }, S),
    ['An ingredient is no longer in the supplies list (ghost).'])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
