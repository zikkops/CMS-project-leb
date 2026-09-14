// Assertions over food safety limits, readings and the diary — shared/src/foodSafety.ts.
//
//   node scripts/verify-food-safety.mjs
//   npm run verify:food-safety
//
// Same shape as the other verifiers: transpile the real module and assert
// against it. Nothing is re-implemented.
//
// ── What it most has to prevent ────────────────────────────────────────────
// A limit read wrong is a fridge at 9 °C recorded as fine. A typo saved as a
// limit (80 for 8, a freezer missing its minus) is the same failure one step
// earlier. And a diary that can only be signed by ticking every box is a diary
// that gets ticked: "not done, and here is what happened" must sign as well as
// "done".

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'food-safety-verify-'))
execSync(
  `npx tsc shared/src/foodSafety.ts shared/src/allergens.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const F = await import(`file://${join(out, 'foodSafety.js')}`)
const A = await import(`file://${join(out, 'allergens.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const UK = F.UK_SFBB_LIMITS

console.log('\nlimits are settings, read fail-safe')
{
  eq('nothing stored: the defaults', F.readLimits(undefined), UK)
  eq('a real local rule is kept', F.readLimits({ chilledKeepMaxC: 5, fridgeSetMaxC: 4 }).chilledKeepMaxC, 5)
  eq('THE TRAP: 80 typed for 8 is not a limit', F.readLimits({ chilledKeepMaxC: 80 }).chilledKeepMaxC, 8)
  eq('a freezer limit missing its minus is not a limit', F.readLimits({ freezerMaxC: 18 }).freezerMaxC, -18)
  eq('a number stored as text is not trusted', F.readLimits({ hotHoldMinC: '60' }).hotHoldMinC, 63)
  eq('a set point above the keep limit falls back as a pair',
    [F.readLimits({ fridgeSetMaxC: 7, chilledKeepMaxC: 6 }).fridgeSetMaxC, F.readLimits({ fridgeSetMaxC: 7, chilledKeepMaxC: 6 }).chilledKeepMaxC], [5, 8])
  // The bounds keep a probe range the right way up on their own (iced min ≤ 0 ≤
  // iced max; boiling min ≤ 100 ≤ boiling max), so the only edge left is equal ends.
  eq('a probe range with equal ends is kept',
    [F.readLimits({ probeBoilingMinC: 100, probeBoilingMaxC: 100 }).probeBoilingMaxC, F.readLimits({ probeIcedMinC: 0, probeIcedMaxC: 0 }).probeIcedMaxC], [100, 0])
  eq('14 allergens, every key different', new Set(F.ALLERGENS_EU14.map(a => a.key)).size, 14)
}

console.log('\nwhat a reading means')
{
  const status = (kind, t, limits = UK) => F.judgeReading(kind, t, limits)?.status ?? null
  eq('a fridge at its set point is fine — "or below" includes it', status('fridge', 5), 'ok')
  eq('a hair over, as typed to the hundredth, is judged to the tenth', status('fridge', 5.04), 'ok')
  eq('above the set point: adjust the unit', status('fridge', 5.1), 'warn')
  eq('at the keep limit: still a warning, not a breach', status('fridge', 8), 'warn')
  eq('THE TRAP: above the keep limit is a breach', status('fridge', 8.1), 'breach')
  eq('a chilled display is held to the same limits', status('chilledDisplay', 9), 'breach')
  eq('a freezer at its limit is fine', status('freezer', -18), 'ok')
  eq('a freezer a tenth warmer is a breach', status('freezer', -17.9), 'breach')
  eq('hot holding at its limit is fine — "or above" includes it', status('hotHold', 63), 'ok')
  eq('hot holding a tenth under is a breach', status('hotHold', 62.9), 'breach')
  eq('a typo is not a reading — not ok, not a breach', status('fridge', 800), null)
  eq('nothing entered is not a reading', status('fridge', Number.NaN), null)
  eq('the café\'s own limits are the ones applied',
    status('fridge', 6, F.readLimits({ fridgeSetMaxC: 3, chilledKeepMaxC: 5 })), 'breach')
  eq('the verdict says what to do', F.judgeReading('hotHold', 55, UK).message.includes('63 °C'), true)
}

console.log('\nprobe calibration')
{
  eq('in range both ways', F.judgeProbe(0, 100, UK), { iced: true, boiling: true, passed: true })
  eq('off in iced water fails', F.judgeProbe(1.5, 100, UK).passed, false)
  eq('off in boiling water fails', F.judgeProbe(0, 98.9, UK), { iced: true, boiling: false, passed: false })
  eq('not a number: no verdict', F.judgeProbe(Number.NaN, 100, UK), null)
}

console.log('\nwhat a reading needs before it saves')
{
  const p = r => F.readingProblem(r, UK)
  eq('a good reading saves', p({ unitId: 'f1', kind: 'fridge', tempC: 3 }), null)
  eq('a warning saves without a note', p({ unitId: 'f1', kind: 'fridge', tempC: 7 }), null)
  eq('THE TRAP: a breach does not save without what was done', p({ unitId: 'f1', kind: 'fridge', tempC: 10 })?.includes('Record what was done'), true)
  eq('a breach with what was done saves', p({ unitId: 'f1', kind: 'fridge', tempC: 10, note: 'Moved stock to fridge 2, called the engineer' }), null)
  eq('a note of spaces is no note', p({ unitId: 'f1', kind: 'fridge', tempC: 10, note: '   ' }) !== null, true)
  eq('out of use needs a reason', p({ unitId: 'f1', kind: 'fridge', outOfUse: true }), 'Say why the unit is out of use.')
  eq('out of use with a reason saves', p({ unitId: 'f1', kind: 'fridge', outOfUse: true, note: 'Defrosting' }), null)
  eq('no reading and not out of use', p({ unitId: 'f1', kind: 'fridge' }), 'Enter a reading, or mark the unit out of use.')
}

console.log('\nsigning the day')
{
  const checklists = {
    opening: [{ key: 'a', label: 'Fridges working' }, { key: 'b', label: 'Staff fit' }],
    closing: [{ key: 'c', label: 'No food left out' }],
  }
  const units = [{ id: 'f1', name: 'Fridge 1', kind: 'fridge' }, { id: 'h1', name: 'Bain-marie', kind: 'hotHold' }]
  const good = {
    opening: [{ key: 'a', done: true }, { key: 'b', done: true }],
    closing: [{ key: 'c', done: true }],
    readings: [{ unitId: 'f1', kind: 'fridge', tempC: 4 }, { unitId: 'h1', kind: 'hotHold', tempC: 70 }],
  }
  const s = day => F.signingBlockers(day, checklists, units, UK)

  eq('everything answered and in range: signs', s(good), [])
  eq('THE TRAP: "not done, and here is why" signs as well as done',
    s({ ...good, opening: [{ key: 'a', done: true }, { key: 'b', done: false, note: 'Chef sent home, covered by Sam' }] }), [])
  eq('not done with nothing said does not sign',
    s({ ...good, opening: [{ key: 'a', done: true }, { key: 'b', done: false }] }), ['Opening: "Staff fit" was not done — say what happened.'])
  eq('an unanswered check does not sign', s({ ...good, closing: [] }), ['Closing: "No food left out" has not been answered.'])
  eq('a unit with no reading does not sign',
    s({ ...good, readings: [good.readings[0]] }), ['Bain-marie: no reading today.'])
  eq('the unit decides its kind, not the reading — 5 °C in a bain-marie is a breach',
    s({ ...good, readings: [good.readings[0], { unitId: 'h1', kind: 'fridge', tempC: 5 }] }).length, 1)
  eq('blockers come in the order they are fixed: opening, readings, closing',
    s({ opening: [], closing: [], readings: [] }).map(b => b.split(':')[0]),
    ['Opening', 'Opening', 'Fridge 1', 'Bain-marie', 'Closing'])
}

console.log('\ndays nobody signed')
{
  eq('the gaps in a range', F.missedDays('2026-09-10', '2026-09-13', ['2026-09-11']), ['2026-09-10', '2026-09-12', '2026-09-13'])
  eq('across the end of a short February', F.missedDays('2026-02-27', '2026-03-01', []), ['2026-02-27', '2026-02-28', '2026-03-01'])
  eq('all signed: none missed', F.missedDays('2026-09-10', '2026-09-11', ['2026-09-10', '2026-09-11']), [])
  eq('a range the wrong way round: nothing, not a loop', F.missedDays('2026-09-13', '2026-09-10', []), [])
  eq('not a date: nothing', F.missedDays('13/09/2026', '2026-09-14', []), [])
}

console.log('\nwho may write a day')
{
  eq('a day moved back over a month end', F.addDays('2026-03-01', -1), '2026-02-28')
  eq('...and over a leap day', F.addDays('2028-03-01', -1), '2028-02-29')
  eq('...and into a new year', F.addDays('2026-12-31', 1), '2027-01-01')
  eq('a date that does not exist is not moved', F.addDays('2026-02-30', 1), '')

  const today = '2026-09-14'
  const a = (date, who) => F.dayAccess(date, today, who)
  const staff = { reviewer: false, signed: false }
  const manager = { reviewer: true, signed: false }
  eq('staff write today', a('2026-09-14', staff), 'edit')
  eq('THE TRAP: staff write yesterday — closing checks after midnight', a('2026-09-13', staff), 'edit')
  eq('staff do not write two days back', a('2026-09-12', staff), 'read')
  eq('a manager fills in a missed day within the week', a('2026-09-07', manager), 'edit')
  eq('...but not beyond it', a('2026-09-06', manager), 'read')
  eq('nobody writes tomorrow', a('2026-09-15', manager), 'read')
  eq('a signed day is read-only to staff', a('2026-09-14', { reviewer: false, signed: true }), 'read')
  eq('THE TRAP: a signed day is amended by a manager, never edited', a('2026-09-14', { reviewer: true, signed: true }), 'amend')
  eq('...even a week later', a('2026-08-01', { reviewer: true, signed: true }), 'amend')
  eq('not a date: read', a('14/09/2026', manager), 'read')

  eq('signed the morning after: on time', F.signedLate('2026-09-10', '2026-09-11'), false)
  eq('signed on the day: on time', F.signedLate('2026-09-10', '2026-09-10'), false)
  eq('signed two days on: late, and says so', F.signedLate('2026-09-10', '2026-09-12'), true)
  eq('every limit has a name a person reads', Object.keys(F.LIMIT_LABELS).sort(), Object.keys(F.UK_SFBB_LIMITS).sort())
}

console.log('\nwhat a dish contains')
{
  // An oat drink can carry gluten; the beans were checked and carry nothing;
  // nobody has checked the syrup yet.
  const S = {
    milk:  { id: 'milk',  name: 'Whole milk',    allergens: ['milk'] },
    oat:   { id: 'oat',   name: 'Oat drink',     allergens: ['gluten'] },
    beans: { id: 'beans', name: 'Coffee beans',  allergens: [] },
    syrup: { id: 'syrup', name: 'Vanilla syrup', allergens: null },
  }
  const latte = {
    lines: [{ supplyId: 'beans', qty: 18 }, { supplyId: 'milk', qty: 220 }],
    adjustments: {
      oat: [{ kind: 'replace', fromSupplyId: 'milk', toSupplyId: 'oat' }],
      syrup: [{ kind: 'add', supplyId: 'syrup', qty: 15 }],
      shot: [{ kind: 'add', supplyId: 'beans', qty: 18 }],
    },
  }
  const confirmed = { recipe: latte, confirmed: true }

  eq('a checked, confirmed recipe is verified', A.dishAllergens(confirmed, S), { verified: true, contains: ['milk'], reasons: [] })
  const unconfirmed = A.dishAllergens({ recipe: latte, confirmed: false }, S)
  eq('THE TRAP: unconfirmed is not verified — the dressing may not be in the recipe', unconfirmed.verified, false)
  eq('...but what IS known is still shown', unconfirmed.contains, ['milk'])
  eq('...and it says why', unconfirmed.reasons[0].includes('every ingredient'), true)
  eq('no recipe: not verified, and never "contains nothing"',
    A.dishAllergens({ recipe: null, confirmed: true }, S), { verified: false, contains: [], reasons: ['No recipe — its ingredients are not known.'] })
  eq('"checked, contains none" is an answer: an espresso verifies with nothing in it',
    A.dishAllergens({ recipe: { lines: [{ supplyId: 'beans', qty: 18 }] }, confirmed: true }, S), { verified: true, contains: [], reasons: [] })
  eq('THE TRAP: an ingredient nobody checked makes the dish unverified',
    A.optionAllergenChange(confirmed, S, 'syrup').reasons, ['Vanilla syrup has not been checked for allergens.'])
  eq('an ingredient no longer in supplies makes it unverified',
    A.dishAllergens({ recipe: { lines: [{ supplyId: 'gone', qty: 1 }] }, confirmed: true }, S).verified, false)
  eq('a recipe with no ingredients is not verified',
    A.dishAllergens({ recipe: { lines: [] }, confirmed: true }, S).verified, false)
  eq('oat for whole milk: takes milk out, brings gluten in',
    A.optionAllergenChange(confirmed, S, 'oat'), { adds: ['gluten'], removes: ['milk'], verified: true, reasons: [] })
  eq('an extra shot changes nothing', A.optionAllergenChange(confirmed, S, 'shot'), { adds: [], removes: [], verified: true, reasons: [] })
  eq('allergens from outside supplies count, in list order',
    A.dishAllergens({ ...confirmed, extraAllergens: ['sesame', 'milk'] }, S).contains, ['milk', 'sesame'])
  eq('a key that is not an allergen is ignored', A.dishAllergens({ ...confirmed, extraAllergens: ['plutonium'] }, S).contains, ['milk'])

  // Cream brings milk, and with whole milk already in the drink it changes
  // nothing on its own. Oat takes the milk out. Chosen together, the drink
  // still has milk in it — in the cream.
  const withCream = { ...S, cream: { id: 'cream', name: 'Whipped cream', allergens: ['milk'] } }
  const mocha = { ...latte, adjustments: { ...latte.adjustments, cream: [{ kind: 'add', supplyId: 'cream', qty: 30 }] } }
  const both = { recipe: mocha, confirmed: true }
  eq('cream on its own changes nothing', A.optionAllergenChange(both, withCream, 'cream'), { adds: [], removes: [], verified: true, reasons: [] })
  eq('THE TRAP: oat and cream together still contain milk',
    A.dishAllergens(both, withCream, ['oat', 'cream']).contains.includes('milk'), true)
  // Which is why the till asks the server about a choice instead of adding up
  // the chart's per-option lines. Added up, they say the milk is gone:
  const summed = new Set(A.dishAllergens(both, withCream).contains)
  for (const id of ['oat', 'cream']) {
    const c = A.optionAllergenChange(both, withCream, id)
    c.removes.forEach(k => summed.delete(k))
    c.adds.forEach(k => summed.add(k))
  }
  eq('...and adding up the per-option lines would have said no milk', summed.has('milk'), false)

  eq('THE TRAP: an allergen the café does not track is never dropped',
    A.splitTracked(['milk', 'sesame'], ['milk']), { tracked: ['milk'], others: ['sesame'] })
  eq('keys from a request: known ones, once each, in order', A.readAllergenKeys(['milk', 'milk', 'x', 3, 'eggs']), ['eggs', 'milk'])
  eq('not a list: nothing', A.readAllergenKeys('milk'), [])
}

console.log('\nwhat the till says')
{
  eq('THE TRAP: unverified with nothing listed is unverified, never "none"',
    A.staffAnswer({ verified: false, contains: [] }), { kind: 'unverified', keys: [] })
  eq('unverified keeps what is known', A.staffAnswer({ verified: false, contains: ['milk'] }), { kind: 'unverified', keys: ['milk'] })
  eq('verified and empty is the only "none"', A.staffAnswer({ verified: true, contains: [], others: [] }), { kind: 'none', keys: [] })
  eq('THE TRAP: an allergen the café does not track still stops "none"',
    A.staffAnswer({ verified: true, contains: [], others: ['sesame'] }), { kind: 'contains', keys: ['sesame'] })
  eq('tracked and untracked together, once each, in list order',
    A.staffAnswer({ verified: true, contains: ['milk'], others: ['eggs', 'milk'] }).keys, ['eggs', 'milk'])

  eq('THE TRAP: unverified and not listing nuts is unknown, never free of nuts',
    A.allergenVerdict({ verified: false, contains: ['milk'] }, 'nuts'), 'unknown')
  eq('verified and not listing it: free', A.allergenVerdict({ verified: true, contains: ['milk'] }, 'nuts'), 'free')
  eq('listed, verified or not: contains', A.allergenVerdict({ verified: false, contains: ['nuts'] }, 'nuts'), 'contains')
  eq('an untracked allergen still counts for the customer',
    A.allergenVerdict({ verified: true, contains: [], others: ['sesame'] }, 'sesame'), 'contains')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
