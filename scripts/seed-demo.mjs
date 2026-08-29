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

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Duplicated from app/lib/skuFormat.ts for the same reason BRANCHES is read
// from env above: this is a plain .mjs script run by node directly, and it
// can't import a TypeScript module. Keep the two in step — skuFormat.ts owns
// the format, and SKU_PATTERN there validates what this produces.
const skuLetters = name => {
  const letters = (name ?? '').replace(/[^a-zA-Z]/g, '').toUpperCase()
  return letters.length === 0 ? 'XXX' : letters.slice(0, 3).padEnd(3, 'X')
}
const formatSku = (name, sequence) =>
  `ob-${skuLetters(name)}${String(sequence).padStart(4, '0')}`

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
// Which order categories carry VAT. Basic foodstuffs are zero-rated and
// everything else is not, which is the split a café actually sees on its
// invoices — and the reason VAT is a per-item flag rather than one rate on the
// whole bill. Derived from the category so the item table stays readable
// instead of growing an eighth column repeated forty times.
const VATABLE_CATEGORIES = new Set(['Chemicals', 'Paper', 'Soft Drinks', 'Syrups'])

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

// ── Storefront data ────────────────────────────────────────────────────────
// The supply chain above makes the ADMIN panel usable. None of it renders on
// the public site, so a fresh install still looked broken from the front: an
// empty shop, "no upcoming events", a floor plan with no tables. These cover
// the public pages.

// Seeded imagery.
//
// These are demo CONTENT, not app assets — they land in each document's
// `image` field exactly where a real tenant's uploaded photo would, which is
// what makes the demo exercise the same render path as production. App-level
// fallbacks for a product with NO image live in app/lib/placeholderAssets.ts
// and are a different thing.
//
// Every id below was checked to return 200 before being committed. All are
// plain `photo-` ids on images.unsplash.com — free content. `premium_photo-`
// ids are Unsplash+ subscription material and must never be hotlinked here;
// the prefix is the only way to tell them apart.
//
// One distinct image per item, deliberately. Reusing a handful across the
// catalogue reads as a broken import rather than as a demo.
const img = (id, w = 800, h = 600) =>
  `https://images.unsplash.com/${id}?auto=format&q=70&w=${w}&h=${h}&fit=crop`

const PRODUCT_IMAGES = {
  'house-blend':     'photo-1517701550927-30cf4ba1dba5',
  'single-origin':   'photo-1442512595331-e89e73853f31',
  'decaf-blend':     'photo-1559056199-641a0ac8b55e',
  'loose-leaf-tea':  'photo-1564890369478-c89ca6d9cde9',
  'cold-brew-kit':   'photo-1544787219-7f47ccb76574',
  'ceramic-mug':     'photo-1461023058943-07fcbe16d735',
  'espresso-cups':   'photo-1514432324607-a09d9b4aefdd',
  'travel-tumbler':  'photo-1523362628745-0c100150b504',
  'glass-carafe':    'photo-1523362289600-a70b4a0e09aa',
  'linen-napkins':   'photo-1600166898405-da9535204843',
  'scented-candle':  'photo-1596040033229-a9821ebd058d',
  'woven-coasters':  'photo-1578500494198-246f612d3b3d',
  'serving-board':   'photo-1595535373192-fc8935bacd89',
  'dotted-notebook': 'photo-1531346878377-a5be20888e57',
  'pocket-notebook': 'photo-1517842645767-c639042777db',
  'fineliner-set':   'photo-1583485088034-697b5bc54ccd',
  'desk-pad':        'photo-1544816155-12df9643f363',
  'staff-tee':       'photo-1521572163474-6864f9cf17ab',
  'canvas-apron':    'photo-1581655353564-df123a1eb820',
  'knit-beanie':     'photo-1576871337622-98d48d1cf531',
  'gift-card-25':    'photo-1513885535751-8b9238bd345a',
  'starter-bundle':  'photo-1549465220-1a8b9238cd48',
  'brew-guide':      'photo-1544716278-ca5e3f4abd8c',
  'recipe-book':     'photo-1589998059171-988d887df646',
  'tote-bag':        'photo-1483985988355-763728e1935b',
  'card-wallet':     'photo-1627123424574-724758594e93',
}

const EVENT_IMAGES = {
  'latte-art':    'photo-1509042239860-f550ce710b93',
  'cupping':      'photo-1447933601403-0c6688de566e',
  'acoustic':     'photo-1493225457124-a3eb161ffa5f',
  'quiz-night':   'photo-1543007630-9710e4a00a20',
  'brew-basics':  'photo-1516450360452-9312f5e86fc7',
  'supper-club':  'photo-1555396273-367ea4eb4db5',
  'past-quiz':    'photo-1534790566855-4cb788d389ec',
  'past-jazz':    'photo-1481833761820-0509d3217039',
  'past-tasting': 'photo-1415604934674-561df9abf539',
  'past-pastry':  'photo-1509440159596-0249088772ff',
}

// Keyed by category name. `categoryImage()` in app/lib/menuCategoryImages.ts
// only overrides the stored field for names that appear in PLACEHOLDER_MENU —
// none of these four do, so the seeded value is what actually renders. That
// override is a known bug (see Phase 02); this seed does not depend on it.
const MENU_CATEGORY_IMAGES = {
  'Hot Drinks':  'photo-1511920170033-f8396924c348',
  'Cold Drinks': 'photo-1437418747212-8d9709afab22',
  'Food':        'photo-1504674900247-0877df9cc836',
  'Sweets':      'photo-1486427944299-d1955d23e34d',
}

const PRODUCT_CATEGORIES = [
  'Coffee & Tea', 'Drinkware', 'Home', 'Stationery',
  'Apparel', 'Gifts', 'Books', 'Accessories',
]

// [slug, name, category, price, description]
//
// Descriptions are written to exercise the catalogue search rather than to
// read as marketing copy: distinct nouns, some words repeated across products
// so multi-term queries have something to narrow, and a few terms that appear
// ONLY in a description so description-only matching is visibly working.
const PRODUCTS = [
  ['house-blend',     'House Blend Beans',       'Coffee & Tea', 18, 'A medium roast with cocoa and hazelnut notes. Whole bean, roasted weekly, 250g bag.'],
  ['single-origin',   'Single Origin Beans',     'Coffee & Tea', 24, 'Rotating single origin, light roast. Currently a washed Ethiopian with jasmine and citrus.'],
  ['decaf-blend',     'Decaf Blend Beans',       'Coffee & Tea', 19, 'Swiss water process decaf. Same medium roast profile as the house blend, no caffeine.'],
  ['loose-leaf-tea',  'Loose Leaf Tea Tin',      'Coffee & Tea', 14, 'Earl grey with real bergamot, in a resealable tin. Makes roughly forty cups.'],
  ['cold-brew-kit',   'Cold Brew Kit',           'Coffee & Tea', 32, 'Glass carafe, reusable steel filter and a coarse grind guide. Steeps overnight in the fridge.'],

  ['ceramic-mug',     'Ceramic Mug',             'Drinkware',    12, 'Stoneware mug in a matte glaze. Dishwasher and microwave safe, holds 350ml.'],
  ['espresso-cups',   'Espresso Cup Pair',       'Drinkware',    20, 'Two 80ml porcelain cups with saucers. Thick walled, so a short shot stays hot.'],
  ['travel-tumbler',  'Travel Tumbler',          'Drinkware',    26, 'Vacuum sealed steel tumbler, leakproof lid. Keeps a drink hot for six hours.'],
  ['glass-carafe',    'Glass Carafe',            'Drinkware',    22, 'Borosilicate carafe with a cork stopper. Doubles as a water jug for the table.'],

  ['linen-napkins',   'Linen Napkin Set',        'Home',         28, 'Four stonewashed linen napkins in natural flax. Softens with every wash.'],
  ['scented-candle',  'Scented Candle',          'Home',         21, 'Soy wax candle with cedar and black pepper. Forty hour burn, reusable glass.'],
  ['woven-coasters',  'Woven Coaster Set',       'Home',         15, 'Six handwoven cotton coasters. Machine washable, absorbs a cold glass properly.'],
  ['serving-board',   'Olive Wood Board',        'Home',         38, 'Solid olive wood serving board. Every piece has a different grain pattern.'],

  ['dotted-notebook', 'Dotted Notebook',         'Stationery',   16, 'A5 notebook, dotted pages, hardcover with a lay-flat binding and a ribbon marker.'],
  ['pocket-notebook', 'Pocket Notebook Pair',    'Stationery',    9, 'Two A6 stapled notebooks with plain pages. Fits a jacket pocket.'],
  ['fineliner-set',   'Fineliner Set',           'Stationery',   18, 'Six fineliners in greys and one deep red. Waterproof once dry.'],
  ['desk-pad',        'Leather Desk Pad',        'Stationery',   45, 'Full grain leather desk pad with a felt backing. Ages into a darker patina.'],

  ['staff-tee',       'Cotton T-Shirt',          'Apparel',      25, 'Heavyweight organic cotton tee with a small chest print. Unisex sizing, S to XXL.'],
  ['canvas-apron',    'Canvas Apron',            'Apparel',      42, 'Waxed canvas apron with crossback straps and two deep front pockets.'],
  ['knit-beanie',     'Knit Beanie',             'Apparel',      19, 'Ribbed merino beanie with a folded cuff. One size, warm without being bulky.'],

  ['gift-card-25',    'Gift Card',               'Gifts',        25, 'A gift card redeemable in any branch, for anything on the menu or the shelf.'],
  ['starter-bundle',  'Coffee Starter Bundle',   'Gifts',        49, 'House blend beans, a ceramic mug and a pack of filters, boxed together.'],

  ['brew-guide',      'Home Brewing Guide',      'Books',        29, 'A practical guide to grind size, ratio and water temperature. Illustrated, 180 pages.'],
  ['recipe-book',     'Café Recipe Book',        'Books',        34, 'Sixty recipes from the kitchen, written for a home oven rather than a service line.'],

  ['tote-bag',        'Canvas Tote',             'Accessories',  16, 'Unbleached heavy canvas tote with a flat base and reinforced webbing handles.'],
  ['card-wallet',     'Leather Card Wallet',     'Accessories',  30, 'Slim vegetable tanned wallet, four card slots. Sized for a standard card deck too.'],
]

const EVENT_TYPES = [
  'ev-live-music', 'ev-workshop', 'ev-tasting', 'ev-quiz', 'ev-private',
]
const EVENT_TYPE_NAMES = {
  'ev-live-music': 'Live Music',
  'ev-workshop':   'Workshop',
  'ev-tasting':    'Tasting',
  'ev-quiz':       'Quiz Night',
  'ev-private':    'Private Hire',
}

// Offsets in days from today, so the split between "upcoming" and "completed"
// on /events stays correct whenever this is run rather than going stale the
// week after seeding.
// [slug, title, typeId, dayOffset, start, end, price, min, max, description]
const EVENTS = [
  ['latte-art',    'Latte Art Workshop',      'ev-workshop',    3,  '17:00', '19:00', 20, 4,  10, 'A hands-on session on milk texture and pouring. Every seat gets a machine, and you keep the practice jug.'],
  ['cupping',      'Coffee Cupping',          'ev-tasting',     6,  '11:00', '12:30', 15, 6,  14, 'Taste four origins side by side and learn the vocabulary roasters actually use.'],
  ['acoustic',     'Acoustic Evening',        'ev-live-music',  9,  '20:00', '22:30',  0, 1,  60, 'A rotating lineup of local acoustic acts. Free entry, kitchen open until close.'],
  ['quiz-night',   'Quiz Night',              'ev-quiz',        13, '19:30', '22:00', 10, 2,  40, 'Six rounds, teams of up to four. Winning table takes the pot and the bragging rights.'],
  ['brew-basics',  'Home Brewing Basics',     'ev-workshop',    17, '16:00', '18:00', 25, 4,  12, 'Grind, ratio and water. Leave able to make a consistent pour over at home.'],
  ['supper-club',  'Supper Club',             'ev-private',     24, '19:00', '23:00', 45, 10, 24, 'A set five course menu, one long table. Booked as a whole, not by the seat.'],

  ['past-quiz',    'Quiz Night',              'ev-quiz',       -7,  '19:30', '22:00', 10, 2,  40, 'Six rounds, teams of up to four.'],
  ['past-jazz',    'Jazz Trio',               'ev-live-music', -14, '20:00', '22:30',  0, 1,  60, 'A trio playing standards through the evening.'],
  ['past-tasting', 'Single Origin Tasting',   'ev-tasting',    -21, '11:00', '12:30', 15, 6,  14, 'Three washed origins, tasted blind.'],
  ['past-pastry',  'Pastry Workshop',         'ev-workshop',   -30, '15:00', '17:30', 30, 4,  10, 'Laminated dough from scratch, with plenty to take home.'],
]

// Matches DEFAULT_REDEMPTION_ITEMS / DEFAULT_LEVEL_PERKS in app/lib. Both have
// a client-side seedXIfEmpty() that fires when a staff member opens the admin
// page — seeding the same content here just means the PUBLIC loyalty page
// isn't empty before anyone has logged in. Those helpers then no-op.
const REDEMPTIONS = [
  ['redeem-coffee',  'Free coffee',                 'Any hot or cold coffee from our menu',                   100],
  ['redeem-drink',   'Free drink (any menu item)',  'Any drink from our full menu',                           150],
  ['redeem-burger',  'Free burger',                 'One burger of your choice',                              300],
  ['redeem-ticket',  'Event ticket (1 person)',     'Entry to any upcoming event',                            200],
  ['redeem-table',   'Reserved table for four',     'A table held for you and three guests at any branch',    500],
]

// Keyed by tier, not by a level number — see app/lib/tierPerks.ts.
const PERKS = [
  ['Bronze',   'Earn points on every purchase'],
  ['Bronze',   'A free drink on your birthday'],
  ['Silver',   '5% off food orders'],
  ['Silver',   'Reserve a table up to 48h ahead'],
  ['Gold',     '10% off everything'],
  ['Gold',     'Early access to event tickets'],
  ['Gold',     'A free coffee every month'],
  ['Platinum', '15% off everything'],
  ['Platinum', 'Priority event registration'],
  ['Platinum', 'A free item every month'],
]

// A floor plan needs a background image plus markers positioned in the image's
// NATURAL pixel space (see app/lib/branchTableLayouts.ts) — the renderer
// converts those to percentages. 1600×900 is declared here and requested at
// exactly that size, so the two agree.
const FLOOR_W = 1600
const FLOOR_H = 900
const FLOOR_IMAGE =
  'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&q=70&w=1600&h=900&fit=crop'

// [number, capMin, capMax, shape, type, x, y, w, h]
const TABLES = [
  [1,  2, 2, 'round', 'chairs', 260,  240, 150, 150],
  [2,  2, 4, 'round', 'chairs', 470,  240, 150, 150],
  [3,  4, 6, 'rect',  'chairs', 730,  230, 250, 160],
  [4,  4, 6, 'rect',  'chairs', 1080, 230, 250, 160],
  [5,  2, 2, 'round', 'chairs', 1370, 250, 140, 140],
  [6,  6, 8, 'rect',  'couch',  330,  560, 320, 180],
  [7,  4, 4, 'hex',   'chairs', 720,  580, 180, 180],
  [8,  4, 6, 'rect',  'chairs', 1010, 570, 250, 160],
  [9,  2, 4, 'round', 'chairs', 1330, 590, 150, 150],
]

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
    vatable: VATABLE_CATEGORIES.has(category),
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
    name: catName, section, sortOrder: ci,
    image: MENU_CATEGORY_IMAGES[catName] ? img(MENU_CATEGORY_IMAGES[catName], 600, 450) : null,
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

// ── Storefront ─────────────────────────────────────────────────────────────

PRODUCT_CATEGORIES.forEach((name, i) => {
  set(`gameCategories/pcat-${slugify(name)}`, {
    name,
    sortOrder: i,
    createdAt: FieldValue.serverTimestamp(),
  }, `product category · ${name}`)
})

// Stock is deliberately uneven: some products are out at one branch, and
// `clearance-*` is out everywhere so the "Out of Stock" badge and the greyed
// card actually appear in the demo instead of only existing in the code.
PRODUCTS.forEach(([slug, name, category, price, description], i) => {
  const stock = Object.fromEntries(BRANCHES.map((b, bi) => {
    if (i % 7 === 0) return [b, 0]                 // out everywhere
    if (i % 5 === 0 && bi === 0) return [b, 0]     // out at the flagship only
    return [b, 3 + ((i * 3 + bi * 5) % 12)]
  }))

  set(`games/product-${slug}`, {
    name,
    category,
    description,
    price,
    stock,
    image: img(PRODUCT_IMAGES[slug]),
    sku: formatSku(name, i + 1),
    // The board-game-era fields. Written empty rather than omitted: Manage
    // Games still renders inputs for them, and an absent field there shows as
    // `undefined` in a controlled input and warns.
    players: '',
    duration: '',
    age: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, `product · ${name}`)
})

// Advance the global SKU counter past everything seeded, or the next product
// created in Manage Games is issued a sequence that's already in use.
set('appSettings/skuCounter', { nextNumber: PRODUCTS.length + 1 },
  `sku counter → ${PRODUCTS.length + 1}`)

EVENT_TYPES.forEach(id => {
  set(`eventTypes/${id}`, {
    name: EVENT_TYPE_NAMES[id],
    createdAt: FieldValue.serverTimestamp(),
  }, `event type · ${EVENT_TYPE_NAMES[id]}`)
})

EVENTS.forEach(([slug, title, typeId, dayOffset, timeStart, timeEnd, price, minPlayers, maxPlayers, description], i) => {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  set(`events/event-${slug}`, {
    title,
    type: EVENT_TYPE_NAMES[typeId],
    branch: BRANCHES[i % BRANCHES.length],
    date,
    timeStart,
    timeEnd,
    description,
    price,
    minPlayers,
    maxPlayers,
    registrationLink: '',
    image: img(EVENT_IMAGES[slug], 1200, 800),
    contactNumber: process.env.NEXT_PUBLIC_CONTACT_PHONE ?? '',
    createdAt: FieldValue.serverTimestamp(),
  }, `event · ${title} · ${date}`)
})

REDEMPTIONS.forEach(([id, name, description, coinCost]) => {
  set(`redemptionItems/${id}`, {
    name, description, coinCost,
    isActive: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: 'seed-script',
  }, `redemption · ${name}`)
})

PERKS.forEach(([tier, perk], i) => {
  set(`tierPerks/perk-${slugify(tier)}-${i}`, {
    tier, perk,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, `perk · ${tier}`)
})

// One floor plan per branch. Table ids are deterministic rather than
// crypto.randomUUID() so re-running updates the same tables instead of
// orphaning every reservation that referenced the previous ones.
BRANCHES.forEach(branch => {
  const tables = TABLES.map(([number, capacityMin, capacityMax, shape, tableType, x, y, width, height]) => ({
    id: `${slugify(branch)}-t${number}`,
    number, capacityMin, capacityMax, shape, tableType,
    x, y, width, height,
    rotation: 0,
    adjacentTo: [],
    bookable: true,
  }))

  // Tables 3 and 4 sit side by side, so mark them joinable — otherwise the
  // adjacency feature has no data to demonstrate itself with.
  const t3 = tables.find(t => t.number === 3)
  const t4 = tables.find(t => t.number === 4)
  if (t3 && t4) { t3.adjacentTo = [t4.id]; t4.adjacentTo = [t3.id] }

  set(`branchTableLayouts/${branch}`, {
    branch,
    imageUrl: FLOOR_IMAGE,
    imageDeleteUrl: null,
    imageFileName: null,
    imageWidth: FLOOR_W,
    imageHeight: FLOOR_H,
    tables,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'seed-script',
  }, `floor plan · ${branch} · ${tables.length} tables`)
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
