// Seeds a fresh Firestore with a working demo dataset.
//
// A new Firestore is empty, which means the admin panel loads and shows
// nothing: no supplies to count, no order template, no weekly order to receive
// against. That makes the most interesting part of the system — the
// order → receive → count chain — impossible to exercise until someone
// hand-enters forty items and the supplyId links between them.
//
// This writes that chain end to end, already linked.
//
//   node --env-file=.env.local scripts/seed-demo.mjs           # dry run
//   node --env-file=.env.local scripts/seed-demo.mjs --apply
//   node --env-file=.env.local scripts/seed-demo.mjs --apply --force
//
// ── Two safety properties, both deliberate ────────────────────────────────
//
// 1. IT REFUSES TO RUN AGAINST A PROJECT THAT DOESN'T LOOK LIKE A DEMO.
//    A seed script pointed at production is precisely the accident this fork
//    exists to prevent — it would overwrite a real café's supplies and order
//    template with placeholder junk, using an Admin SDK credential that
//    bypasses every security rule. The project id must contain dev, demo,
//    test, staging, sandbox or local. --force overrides, and you should have
//    a specific reason.
//
// 2. IT IS IDEMPOTENT. Every document uses a deterministic id, so re-running
//    updates in place rather than creating a second copy of everything. Seed
//    scripts get run twice; that should be boring.
//
// It does NOT create staff accounts. Provisioning the first admin is manual by
// design — see FORK.md.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. See .env.example.')
  console.error('Did you forget --env-file=.env.local ?')
  process.exit(1)
}

const sa = JSON.parse(
  raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
)

const projectId = sa.project_id
const DEMO_HINTS = ['dev', 'demo', 'test', 'staging', 'sandbox', 'local']
const looksLikeDemo = DEMO_HINTS.some(h => projectId.toLowerCase().includes(h))

console.log(`Project: ${projectId}`)

// An explicit, exact opt-in for a demo project whose NAME doesn't happen to
// contain one of the hints — e.g. "cms-project-f7e15".
//
// Better than --force for the routine case: --force bypasses the check for
// WHATEVER project is configured, so a wrong .env.local sails straight through.
// This has to name the exact project id, so it can only ever authorise the one
// you meant. Set SEED_ALLOW_PROJECT in .env.local.
const explicitlyAllowed = process.env.SEED_ALLOW_PROJECT === projectId

if (!looksLikeDemo && !explicitlyAllowed && !FORCE) {
  console.error(
    `\nREFUSING TO RUN.\n\n` +
    `The project id "${projectId}" doesn't contain any of: ${DEMO_HINTS.join(', ')}.\n` +
    `This script writes placeholder supplies, providers and an order template\n` +
    `using a credential that bypasses every security rule. Against a real\n` +
    `café's project it would overwrite their inventory setup.\n\n` +
    `If this really is a demo project, add this line to .env.local:\n` +
    `    SEED_ALLOW_PROJECT=${projectId}\n\n` +
    `That names the exact project, so it can't silently authorise a different\n` +
    `one later. (--force also works, but bypasses the check entirely.)\n`
  )
  process.exit(1)
}
if (explicitlyAllowed && !looksLikeDemo) {
  console.log(`SEED_ALLOW_PROJECT matches "${projectId}" — proceeding.\n`)
}
if (!looksLikeDemo && !explicitlyAllowed && FORCE) {
  console.log('⚠  --force: project name does not look like a demo. Proceeding anyway.\n')
}

// Initialise LAZILY, and only for a real write.
//
// A dry run touches no Firestore — it just prints what it would do — so making
// it require a valid PEM credential would mean you can't preview the plan
// until Firebase setup is completely finished. That's backwards: the preview
// is most useful while you're still deciding.
//
// Parsing the service account above is enough for the project-id guard, and
// parsing doesn't validate the key.
let db = null
if (APPLY) {
  initializeApp({
    credential: cert({
      projectId,
      clientEmail: sa.client_email,
      privateKey: String(sa.private_key).replace(/\\n/g, '\n'),
    }),
  })
  db = getFirestore()
}

// Branches come from config in the app; the script can't import a .ts module,
// so it reads the same env var with the same default. Keep in step with
// app/lib/brand.ts.
const BRANCHES = (process.env.NEXT_PUBLIC_BRANCHES ?? 'Main,Second,Third')
  .split(',').map(s => s.trim()).filter(Boolean)

const zeroStock = () => Object.fromEntries(BRANCHES.map(b => [b, 0]))

// ── The data ───────────────────────────────────────────────────────────────
// Generic on purpose. Real enough to exercise every code path, obviously fake
// enough that nobody mistakes a demo for a customer's live catalogue.

const PROVIDERS = [
  { id: 'prov-dairy',    name: 'Demo Dairy Co.',      categories: ['Milk', 'Cheese'] },
  { id: 'prov-dry',      name: 'Demo Dry Goods',      categories: ['Flour', 'Sugar', 'Coffee'] },
  { id: 'prov-produce',  name: 'Demo Fresh Produce',  categories: ['Vegetables', 'Fruit'] },
  { id: 'prov-beverage', name: 'Demo Beverages',      categories: ['Syrups', 'Soft Drinks'] },
  { id: 'prov-clean',    name: 'Demo Cleaning Supply', categories: ['Chemicals', 'Paper'] },
]

// [slug, name, department, unit, provider, category, unitCost]
// unitCost seeds avgUnitCost so the receiving form has a price to pre-fill and
// price-drift detection has a baseline to compare against.
const ITEMS = [
  ['whole-milk',      'Whole Milk',          'Kitchen', 'liter',  'prov-dairy',    'Milk',        1.20],
  ['skim-milk',       'Skim Milk',           'Kitchen', 'liter',  'prov-dairy',    'Milk',        1.25],
  ['heavy-cream',     'Heavy Cream',         'Kitchen', 'liter',  'prov-dairy',    'Milk',        3.40],
  ['mozzarella',      'Mozzarella',          'Kitchen', 'kg',     'prov-dairy',    'Cheese',      7.80],
  ['cheddar',         'Cheddar',             'Kitchen', 'kg',     'prov-dairy',    'Cheese',      9.10],
  ['butter',          'Butter',              'Kitchen', 'kg',     'prov-dairy',    'Cheese',      6.50],
  ['flour-white',     'White Flour',         'Kitchen', 'bag',    'prov-dry',      'Flour',       12.00],
  ['flour-whole',     'Wholemeal Flour',     'Kitchen', 'bag',    'prov-dry',      'Flour',       14.00],
  ['sugar-white',     'White Sugar',         'Kitchen', 'bag',    'prov-dry',      'Sugar',       10.50],
  ['sugar-brown',     'Brown Sugar',         'Kitchen', 'bag',    'prov-dry',      'Sugar',       11.75],
  ['olive-oil',       'Olive Oil',           'Kitchen', 'liter',  'prov-dry',      'Flour',       4.20],
  ['salt',            'Salt',                'Kitchen', 'kg',     'prov-dry',      'Sugar',       0.90],
  ['tomatoes',        'Tomatoes',            'Kitchen', 'kg',     'prov-produce',  'Vegetables',  1.80],
  ['lettuce',         'Lettuce',             'Kitchen', 'pcs',    'prov-produce',  'Vegetables',  0.95],
  ['onions',          'Onions',              'Kitchen', 'kg',     'prov-produce',  'Vegetables',  1.10],
  ['potatoes',        'Potatoes',            'Kitchen', 'kg',     'prov-produce',  'Vegetables',  1.05],
  ['lemons',          'Lemons',              'Kitchen', 'kg',     'prov-produce',  'Fruit',       2.20],
  ['chicken-breast',  'Chicken Breast',      'Kitchen', 'kg',     'prov-produce',  'Vegetables',  8.40],

  ['coffee-beans',    'Coffee Beans',        'Bar',     'kg',     'prov-dry',      'Coffee',      18.00],
  ['decaf-beans',     'Decaf Beans',         'Bar',     'kg',     'prov-dry',      'Coffee',      20.50],
  ['tea-black',       'Black Tea',           'Bar',     'box',    'prov-dry',      'Coffee',      6.00],
  ['tea-green',       'Green Tea',           'Bar',     'box',    'prov-dry',      'Coffee',      6.50],
  ['syrup-vanilla',   'Vanilla Syrup',       'Bar',     'bottle', 'prov-beverage', 'Syrups',      5.40],
  ['syrup-caramel',   'Caramel Syrup',       'Bar',     'bottle', 'prov-beverage', 'Syrups',      5.40],
  ['syrup-hazelnut',  'Hazelnut Syrup',      'Bar',     'bottle', 'prov-beverage', 'Syrups',      5.60],
  ['cola',            'Cola',                'Bar',     'can',    'prov-beverage', 'Soft Drinks', 0.55],
  ['sparkling-water', 'Sparkling Water',     'Bar',     'bottle', 'prov-beverage', 'Soft Drinks', 0.70],
  ['still-water',     'Still Water',         'Bar',     'bottle', 'prov-beverage', 'Soft Drinks', 0.35],
  ['orange-juice',    'Orange Juice',        'Bar',     'liter',  'prov-beverage', 'Soft Drinks', 2.30],
  ['ice',             'Ice',                 'Bar',     'bag',    'prov-beverage', 'Soft Drinks', 1.50],
  ['paper-cups',      'Paper Cups',          'Bar',     'box',    'prov-clean',    'Paper',       8.90],
  ['cup-lids',        'Cup Lids',            'Bar',     'box',    'prov-clean',    'Paper',       6.20],

  ['dish-soap',       'Dish Soap',           'Cleaning', 'bottle', 'prov-clean',   'Chemicals',   3.10],
  ['floor-cleaner',   'Floor Cleaner',       'Cleaning', 'gallon', 'prov-clean',   'Chemicals',   7.40],
  ['bleach',          'Bleach',              'Cleaning', 'liter',  'prov-clean',   'Chemicals',   2.20],
  ['sanitizer',       'Hand Sanitizer',      'Cleaning', 'bottle', 'prov-clean',   'Chemicals',   4.60],
  ['paper-towels',    'Paper Towels',        'Cleaning', 'pcs',    'prov-clean',   'Paper',       1.30],
  ['bin-bags',        'Bin Bags',            'Cleaning', 'bag',    'prov-clean',   'Paper',       4.80],
  ['gloves',          'Gloves',              'Cleaning', 'box',    'prov-clean',   'Paper',       5.90],
  ['sponges',         'Sponges',             'Cleaning', 'pcs',    'prov-clean',   'Paper',       0.60],
]

const MENU = [
  ['hot-drinks',  'Hot Drinks',  'Beverage', [
    ['espresso', 'Espresso', 2.50], ['americano', 'Americano', 3.00],
    ['cappuccino', 'Cappuccino', 3.75], ['latte', 'Latte', 4.00], ['tea', 'Pot of Tea', 3.25],
  ]],
  ['cold-drinks', 'Cold Drinks', 'Beverage', [
    ['iced-latte', 'Iced Latte', 4.25], ['lemonade', 'Lemonade', 3.50],
    ['soft-drink', 'Soft Drink', 2.00], ['sparkling', 'Sparkling Water', 2.25],
  ]],
  ['food',        'Food',        'Food', [
    ['club-sandwich', 'Club Sandwich', 8.50], ['margherita', 'Margherita Pizza', 11.00],
    ['caesar-salad', 'Caesar Salad', 9.25], ['fries', 'Fries', 4.50],
  ]],
  ['sweets',      'Sweets',      'Sweets', [
    ['cheesecake', 'Cheesecake', 5.50], ['brownie', 'Brownie', 4.75], ['cookie', 'Cookie', 2.25],
  ]],
]

function weekStart() {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return {
    startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    label: `${fmt(monday)} – ${fmt(sunday)} ${sunday.getFullYear()}`,
  }
}

const plan = []
const record = (path, note) => plan.push({ path, note })

// ── Build ──────────────────────────────────────────────────────────────────
const batch = APPLY ? db.batch() : null
const set = (path, data, note) => {
  record(path, note)
  if (batch) batch.set(db.doc(path), data, { merge: true })
}

for (const p of PROVIDERS) {
  set(`orderProviders/${p.id}`, {
    name: p.name,
    phones: Object.fromEntries(BRANCHES.map(b => [b, ''])),
    categories: p.categories,
    notes: 'Demo provider — not a real supplier.',
    createdAt: FieldValue.serverTimestamp(),
  }, p.name)
}

// Supplies and template items are created together with the supplyId link
// already set — the whole point of the Phase 01 migration. Seeding them
// unlinked would recreate the exact problem that migration exists to fix.
ITEMS.forEach(([slug, name, dept, unit, providerId, category, cost], i) => {
  set(`supplies/supply-${slug}`, {
    name,
    nameAr: null,
    category: dept,
    unit,
    quantity: zeroStock(),
    threshold: 5,
    provider: PROVIDERS.find(p => p.id === providerId)?.name ?? null,
    avgUnitCost: cost,
    lastUnitCost: cost,
    updatedAt: FieldValue.serverTimestamp(),
  }, `${dept} · ${name}`)

  set(`orderTemplateItems/tpl-${slug}`, {
    name,
    nameAr: null,
    department: dept,
    category,
    providerId,
    unit,
    supplyId: `supply-${slug}`,
    sortOrder: i,
    createdAt: FieldValue.serverTimestamp(),
  }, `template · ${name}`)
})

// One submitted weekly order for the flagship branch's Kitchen, so the
// receiving form has something to open against on first run.
const week = weekStart()
const kitchenItems = ITEMS.filter(([, , dept]) => dept === 'Kitchen')
set(`weeklyOrderReports/demo-order-${week.startStr}-Kitchen`, {
  branch: BRANCHES[0],
  weekStart: week.startStr,
  weekLabel: week.label,
  department: 'Kitchen',
  items: kitchenItems.map(([slug, name, dept, unit, providerId, category]) => ({
    templateId: `tpl-${slug}`,
    name, department: dept, category, providerId, unit,
    quantity: [5, 10, 12, 20, 6, 8][Math.floor(Math.random() * 6)],
  })),
  notes: 'Demo order — seeded so Receive a Delivery has something to open against.',
  submittedBy: 'seed-script',
  submittedByEmail: 'seed@example.com',
  submittedAt: FieldValue.serverTimestamp(),
}, `weekly order · ${BRANCHES[0]} Kitchen · ${week.label}`)

MENU.forEach(([catId, catName, section, items], ci) => {
  set(`menuCategories/cat-${catId}`, {
    name: catName, section, sortOrder: ci, image: null,
    createdAt: FieldValue.serverTimestamp(),
  }, `menu category · ${catName}`)

  items.forEach(([id, name, price], ii) => {
    set(`menuItems/item-${id}`, {
      name, description: '', price,
      categoryId: `cat-${catId}`, sortOrder: ii, available: true,
      createdAt: FieldValue.serverTimestamp(),
    }, `menu item · ${name}`)
  })
})

// ── Report ─────────────────────────────────────────────────────────────────
const counts = plan.reduce((acc, { path }) => {
  const col = path.split('/')[0]
  acc[col] = (acc[col] ?? 0) + 1
  return acc
}, {})

console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: DRY RUN — nothing written. Re-run with --apply.\n')
for (const [col, n] of Object.entries(counts)) {
  console.log(`  ${String(n).padStart(3)}  ${col}`)
}
console.log(`\n  ${plan.length} documents total across ${BRANCHES.length} branch(es): ${BRANCHES.join(', ')}`)

if (APPLY) {
  await batch.commit()
  console.log('\nWritten.')
  console.log(
    '\nNext:\n' +
    '  1. Provision your first admin by hand (FORK.md) — this script deliberately\n' +
    '     creates no staff accounts.\n' +
    '  2. Open Weekly Orders to see the seeded order.\n' +
    '  3. Open Receive a Delivery, pick that order, and confirm the lines pre-fill\n' +
    '     with quantities and costs. That is the Phase 01 chain working end to end.\n' +
    '  4. Run a Daily Inventory Count and check the stock reconciles against what\n' +
    '     you received.'
  )
} else {
  console.log('\nNothing was written. Re-run with --apply.')
}

process.exit(0)
