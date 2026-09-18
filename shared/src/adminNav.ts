// Every page in the admin panel, grouped into sections — the ONE list.
//
// ── Why one list (owner's request, 14 Sep 2026) ────────────────────────────
// The sidebar and the dashboard used to declare their items separately, with
// a comment asking whoever added a page to add it to both. Nobody did. By
// September the dashboard had Wholesale, Sales Export and What Broke that the
// sidebar did not, and the sidebar had Recipes, Item Options, Tips, Business
// Settings, Modules and Printers that the dashboard did not — and four pages
// were in neither. Both screens now read this, and `npm run verify:admin-nav`
// fails if an admin page exists that is not listed here (or in NOT_IN_NAV),
// or if an entry points at a page that does not exist.
//
// ── What each entry says ───────────────────────────────────────────────────
// A section says what it is FOR, in a sentence a new member of staff can read.
// An item says what the page does, and whether it is daily USE or SETUP — the
// configuration somebody does once and then rarely touches. The sidebar, the
// dashboard and the guide strip at the top of every page all show that split,
// so "where do I set this up?" has one answer.
//
// ── Access ─────────────────────────────────────────────────────────────────
// Pass SECTION_ACCESS.xxx itself, never a copy: the sidebar and dashboard find
// the module that owns an item by reference equality, to hide it when that
// module is switched off. Imported from roles.ts rather than adminAuth.ts — it
// is the same object (adminAuth re-exports it), and roles.ts has no browser
// dependency, which is what lets the verifier load this file.

import {
  faCalendarDay, faChair, faMap, faCalendarCheck, faCalendar, faUtensils, faSliders, faBookOpen,
  faCashRegister, faReceipt, faRightLeft, faBagShopping, faFileImport, faHandshake, faStore,
  faThumbsUp, faGift, faClipboard, faClockRotateLeft, faUser, faTag, faTrophy, faClipboardCheck,
  faTruck, faPaperPlane, faBoxesStacked, faFile, faScroll, faChartPie, faTruckFast, faList,
  faUserLock, faMoneyBill, faHandHoldingDollar, faFileExport, faUsers, faTemperatureHalf,
  faTriangleExclamation, faShieldHalved, faGear, faUserShield, faBug, faImage, faToggleOn, faPrint,
  faChampagneGlasses, faStar, faWarehouse, faMoon, faScrewdriverWrench, faTableCells,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS, ALL_ROLES, hasSectionAccess, type Role } from './roles'
import { featureForSection, isFeatureOn, type FeatureFlags } from './features'

export type NavKind = 'use' | 'setup'

/** A live count the dashboard can show on a card. */
export type BadgeKey = 'loyaltyApprovals' | 'redemptions' | 'eventReservations' | 'tableReservations'

export interface AdminNavItem {
  label: string
  href: string
  access: Role[]
  icon: IconDefinition
  /** What the page does, in one line. */
  desc: string
  /** Daily use, or configuration done once. */
  kind: NavKind
  badge?: BadgeKey
}

export interface AdminNavSection {
  key: string
  title: string
  /** Any CSS colour. Tinted with color-mix(), so a CSS variable works too. */
  color: string
  icon: IconDefinition
  /** What this section is for — one or two sentences for somebody new. */
  purpose: string
  items: AdminNavItem[]
}

const ADMIN_ONLY = ['admin'] as Role[]

export const ADMIN_NAV: AdminNavSection[] = [
  {
    key: 'tables',
    title: 'Table Bookings',
    color: '#3B82F6',
    icon: faTableCells,
    purpose: 'Customers book tables on the website. Approve their requests here and see who is coming today.',
    items: [
      { label: "Today's Schedule", href: '/admin/schedule', access: SECTION_ACCESS.tableReservations, icon: faCalendarDay, kind: 'use', desc: 'Every approved reservation for today — tables and events.' },
      { label: 'Table Reservations', href: '/admin/tables/reservations', access: SECTION_ACCESS.tableReservations, icon: faChair, kind: 'use', badge: 'tableReservations', desc: 'Approve or reject table booking requests.' },
      { label: 'Table Map Editor', href: '/admin/branches/tables', access: SECTION_ACCESS.branchTables, icon: faMap, kind: 'setup', desc: 'Each branch’s floor plan and where its tables are, so they can be booked.' },
    ],
  },
  {
    key: 'events',
    title: 'Events',
    color: '#A855F7',
    icon: faChampagneGlasses,
    purpose: 'Events customers can see on the website and sign up for. Manage what is on and approve requests for a place.',
    items: [
      { label: 'Event Reservations', href: '/admin/events/reservations', access: SECTION_ACCESS.events, icon: faCalendarCheck, kind: 'use', badge: 'eventReservations', desc: 'Approve or reject requests for a place at an event.' },
      { label: 'Manage Events', href: '/admin/events', access: SECTION_ACCESS.events, icon: faCalendar, kind: 'use', desc: 'Create, edit and remove events.' },
    ],
  },
  {
    key: 'menu',
    title: 'Menu & Recipes',
    color: '#F97316',
    icon: faUtensils,
    purpose: 'What the café sells: the menu the website and the till show, the options on each item, and what each dish is made of and costs.',
    items: [
      { label: 'Manage Menu', href: '/admin/menu', access: SECTION_ACCESS.menu, icon: faUtensils, kind: 'use', desc: 'Food and drink items, prices, categories and what is available.' },
      { label: 'Item Options', href: '/admin/menu/modifiers', access: SECTION_ACCESS.menu, icon: faSliders, kind: 'setup', desc: 'Sizes, milks and extras offered on items, and what they cost.' },
      // Admin only, reading as well as writing: a recipe is what a dish costs,
      // which is margin (owner's decision, 14 Sep 2026).
      { label: 'Recipes & Costing', href: '/admin/menu/recipes', access: ADMIN_ONLY, icon: faBookOpen, kind: 'setup', desc: 'What each dish is made of, what it costs to make, its allergens and a suggested price.' },
    ],
  },
  {
    key: 'shop',
    title: 'Shop & Retail',
    color: '#EC4899',
    icon: faBagShopping,
    purpose: 'Retail products sold in the café and online: record a sale, find an invoice, and move stock between branches.',
    items: [
      { label: 'Record a Sale', href: '/admin/products/purchase', access: SECTION_ACCESS.productPurchases, icon: faCashRegister, kind: 'use', desc: 'Sell a product, take it off stock and issue an invoice.' },
      { label: 'Sales & Invoices', href: '/admin/products/invoices', access: SECTION_ACCESS.productPurchases, icon: faReceipt, kind: 'use', desc: 'Past sales, their invoices, and refunds.' },
      { label: 'Transfer Stock', href: '/admin/products/transfer', access: SECTION_ACCESS.productTransfers, icon: faRightLeft, kind: 'use', desc: 'Move retail stock from one branch to another.' },
      { label: 'Manage Products', href: '/admin/products', access: SECTION_ACCESS.products, icon: faBagShopping, kind: 'setup', desc: 'The product catalogue: names, prices, photos and stock per branch.' },
      { label: 'Import Products', href: '/admin/products/import', access: SECTION_ACCESS.products, icon: faFileImport, kind: 'setup', desc: 'Add or update many products at once from a spreadsheet.' },
    ],
  },
  {
    key: 'wholesale',
    title: 'Wholesale',
    color: '#8B5CF6',
    icon: faHandshake,
    purpose: 'Shops that buy from you at trade prices. They order online; you approve the order here.',
    items: [
      { label: 'Wholesale Orders', href: '/admin/wholesale/orders', access: SECTION_ACCESS.products, icon: faHandshake, kind: 'use', desc: 'Approve or reject trade orders, then send them on.' },
      { label: 'Wholesale Accounts', href: '/admin/wholesale/accounts', access: ADMIN_ONLY, icon: faStore, kind: 'setup', desc: 'Create and switch off the shop logins that see trade prices.' },
    ],
  },
  {
    key: 'loyalty',
    title: 'Loyalty',
    color: '#EAB308',
    icon: faStar,
    purpose: 'Points customers earn and spend. Approve what they submit and what they redeem; set up what points can buy.',
    items: [
      { label: 'Loyalty Approvals', href: '/admin/loyalty/approvals', access: SECTION_ACCESS.loyalty, icon: faThumbsUp, kind: 'use', badge: 'loyaltyApprovals', desc: 'Approve or reject points customers have submitted.' },
      { label: 'Redemption Requests', href: '/admin/loyalty/redemptions', access: SECTION_ACCESS.loyalty, icon: faGift, kind: 'use', badge: 'redemptions', desc: 'Confirm or reject what customers want to spend points on.' },
      { label: 'Event Attendance', href: '/admin/loyalty/events', access: SECTION_ACCESS.loyaltyEvents, icon: faClipboard, kind: 'use', desc: 'Record who came to an event, to award their points.' },
      { label: 'Loyalty Activity', href: '/admin/loyalty/activity', access: SECTION_ACCESS.loyalty, icon: faClockRotateLeft, kind: 'use', desc: 'Every submission, approval, rejection and redemption.' },
      { label: 'Redemption Items', href: '/admin/loyalty/redemption-items', access: SECTION_ACCESS.loyalty, icon: faTag, kind: 'setup', desc: 'What customers can spend points on, and how many it costs.' },
      { label: 'Tier Perks', href: '/admin/loyalty/perks', access: SECTION_ACCESS.loyalty, icon: faTrophy, kind: 'setup', desc: 'The perks each loyalty tier unlocks.' },
      { label: 'Manage Customers', href: '/admin/loyalty/customers', access: ADMIN_ONLY, icon: faUser, kind: 'setup', desc: 'Customer accounts, point balances, password resets and the annual reset date.' },
    ],
  },
  {
    key: 'stock',
    title: 'Stock & Ordering',
    color: '#22C55E',
    icon: faWarehouse,
    purpose: 'Consumables: what is on the shelf, what to order each week, what arrived, and what it all cost.',
    items: [
      { label: 'Daily Inventory Count', href: '/admin/supplies/daily', access: SECTION_ACCESS.dailyInventory, icon: faClipboardCheck, kind: 'use', desc: 'Count today’s stock at your branch and submit it.' },
      { label: 'End of Week Order', href: '/admin/weekly-orders/submit', access: SECTION_ACCESS.weeklyOrdersSubmit, icon: faPaperPlane, kind: 'use', desc: 'Fill in and submit this week’s stock order.' },
      { label: 'Receive a Delivery', href: '/admin/supplies/receiving', access: SECTION_ACCESS.deliveries, icon: faTruck, kind: 'use', desc: 'Book in what arrived, what was short and what it cost.' },
      { label: 'Inventory Management', href: '/admin/supplies', access: SECTION_ACCESS.supplies, icon: faBoxesStacked, kind: 'use', desc: 'Stock levels per branch, with alerts when something runs low.' },
      { label: 'Daily Inventory History', href: '/admin/supplies/daily/history', access: SECTION_ACCESS.dailyInventoryHistory, icon: faClockRotateLeft, kind: 'use', desc: 'Every count, what was expected and what was found.' },
      { label: 'Order Reports', href: '/admin/weekly-orders', access: SECTION_ACCESS.weeklyOrders, icon: faFile, kind: 'use', desc: 'The weekly orders staff have submitted.' },
      { label: 'Weekly Order Log', href: '/admin/weekly-orders/log', access: SECTION_ACCESS.weeklyOrders, icon: faScroll, kind: 'use', desc: 'Who submitted or changed which weekly order, and when.' },
      { label: 'Food Cost Report', href: '/admin/supplies/receiving/report', access: SECTION_ACCESS.deliveriesReport, icon: faChartPie, kind: 'use', desc: 'What stock cost against sales — actual and theoretical food cost, and waste.' },
      { label: 'Manage Providers', href: '/admin/weekly-orders/providers', access: ADMIN_ONLY, icon: faTruckFast, kind: 'setup', desc: 'Suppliers, and each branch’s number for ordering on WhatsApp.' },
      { label: 'Edit Template', href: '/admin/weekly-orders/template', access: ADMIN_ONLY, icon: faList, kind: 'setup', desc: 'What can be ordered: items, pack sizes, units and Arabic names.' },
      { label: 'Ordering Access', href: '/admin/weekly-orders/access', access: ADMIN_ONLY, icon: faUserLock, kind: 'setup', desc: 'Which departments each staff account may order for.' },
    ],
  },
  {
    key: 'endOfDay',
    title: 'End of Day',
    color: '#F59E0B',
    icon: faMoon,
    purpose: 'Closing the day: the cash count, the day’s totals, tips, and the export for your accountant.',
    items: [
      { label: 'Submit EOD Report', href: '/admin/end-of-day', access: SECTION_ACCESS.endOfDay, icon: faMoneyBill, kind: 'use', desc: 'Cash count, expenses, income and attendance at the end of the day.' },
      { label: 'EOD History', href: '/admin/end-of-day/history', access: SECTION_ACCESS.endOfDayHistory, icon: faClockRotateLeft, kind: 'use', desc: 'Past end-of-day reports by branch.' },
      { label: 'Daily Summary', href: '/admin/end-of-day/summary', access: SECTION_ACCESS.endOfDayHistory, icon: faReceipt, kind: 'use', desc: 'The day’s totals at a glance.' },
      { label: 'Tips Calculator', href: '/admin/end-of-day/tips', access: SECTION_ACCESS.endOfDay, icon: faHandHoldingDollar, kind: 'use', desc: 'Split the tips between staff after the deduction.' },
      { label: 'End of Day Log', href: '/admin/end-of-day/log', access: SECTION_ACCESS.endOfDay, icon: faScroll, kind: 'use', desc: 'Who submitted or changed which end-of-day report, and when.' },
      { label: 'Sales Export', href: '/admin/exports', access: SECTION_ACCESS.endOfDay, icon: faFileExport, kind: 'use', desc: 'Closed checks for a date range, with VAT and both currencies, for the accountant.' },
      // endOfDay, as the export: deciding a held sale is deciding what the branch took.
      { label: 'Held Hub Sales', href: '/admin/settings/hubs/held', access: SECTION_ACCESS.endOfDay, icon: faStore, kind: 'use', desc: 'What a counter PC sent up while its branch traded online: apply or dismiss each one.' },
      { label: 'Staff Roster', href: '/admin/end-of-day/staff', access: ADMIN_ONLY, icon: faUsers, kind: 'setup', desc: 'The usual staff list per branch, for attendance on the report.' },
    ],
  },
  {
    key: 'foodSafety',
    title: 'Food Safety',
    color: '#06B6D4',
    icon: faShieldHalved,
    purpose: 'The daily food safety checks and temperatures a manager signs, and the allergen chart staff use to answer customers.',
    items: [
      { label: 'Food Safety Diary', href: '/admin/food-safety', access: SECTION_ACCESS.foodSafety, icon: faTemperatureHalf, kind: 'use', desc: 'Opening and closing checks and temperatures — signed each day by a manager.' },
      { label: 'Allergen Chart', href: '/admin/food-safety/allergens', access: SECTION_ACCESS.foodSafety, icon: faTriangleExclamation, kind: 'use', desc: 'What each dish contains, and whether that is verified.' },
      { label: 'Food Safety History', href: '/admin/food-safety/history', access: SECTION_ACCESS.foodSafetyReview, icon: faShieldHalved, kind: 'use', desc: 'Which days were signed, readings out of range, and days nobody signed.' },
      { label: 'Food Safety Settings', href: '/admin/food-safety/settings', access: SECTION_ACCESS.foodSafetyReview, icon: faGear, kind: 'setup', desc: 'Fridges, freezers and hot holding per branch, the checklists, limits and allergens.' },
    ],
  },
  {
    key: 'admin',
    title: 'Administration',
    color: '#EF4444',
    icon: faScrewdriverWrench,
    purpose: 'Running the system itself: who has an account, what changed and when, what broke, and how the business is set up.',
    items: [
      { label: 'Activity Log', href: '/admin/logs', access: ADMIN_ONLY, icon: faScroll, kind: 'use', desc: 'Who created, changed or deleted what, and when.' },
      { label: 'What Broke', href: '/admin/errors', access: ADMIN_ONLY, icon: faBug, kind: 'use', desc: 'Errors the website, admin and till reported, and how often.' },
      { label: 'Media Library', href: '/admin/media', access: ALL_ROLES, icon: faImage, kind: 'use', desc: 'Images that have been uploaded, and removing old ones.' },
      { label: 'Manage Users', href: '/admin/users', access: ADMIN_ONLY, icon: faUserShield, kind: 'setup', desc: 'Staff accounts, their roles, branches and extra access.' },
      // Admin-gated here and superadmin-gated on the page, because the nav has
      // no notion of superadmin. An admin who is not one sees the link and is
      // told why rather than hitting a blank screen.
      { label: 'Business Settings', href: '/admin/settings', access: ADMIN_ONLY, icon: faGear, kind: 'setup', desc: 'VAT, the exchange rate, tips deduction, staff discounts and target margins.' },
      { label: 'Modules', href: '/admin/settings/features', access: ADMIN_ONLY, icon: faToggleOn, kind: 'setup', desc: 'Switch whole parts of the system on or off — POS, loyalty, food safety…' },
      // Admin, not superadmin: the person who plugs a printer in should not
      // have to find a superadmin to tell the app about it.
      { label: 'Printers', href: '/admin/settings/printers', access: ADMIN_ONLY, icon: faPrint, kind: 'setup', desc: 'Receipt and kitchen printers, and which device prints.' },
      // Admin, as Printers: pairing a counter PC is done by whoever set it up.
      { label: 'Café Hubs', href: '/admin/settings/hubs', access: ADMIN_ONLY, icon: faStore, kind: 'setup', desc: 'Counter PCs that keep the till working offline: pair one, see when it last synced, unpair a lost one.' },
      // Admin, as Café Hubs: removing a phone is what happens to a lost one or a leaver's.
      { label: 'Staff Phones', href: '/admin/settings/phones', access: ADMIN_ONLY, icon: faUserLock, kind: 'setup', desc: 'Phones registered for fingerprint sign-in at the till: see whose, remove a lost one or a leaver\'s.' },
    ],
  },
]

/**
 * Admin pages deliberately not in the navigation, each for a reason:
 * the dashboard itself, the sign-in page, and a detail page reached from its
 * list. `verify:admin-nav` fails on any other page that is not listed above.
 */
export const NOT_IN_NAV: readonly string[] = [
  '/admin',
  '/admin/login',
  '/admin/supplies/daily/history/[date]',
]

/**
 * The section and item a path belongs to — exactly, or by the longest listed
 * prefix, so a detail page under an item still shows that item's guide.
 * Longest wins: /admin/supplies/receiving/report is the Food Cost Report, not
 * Receive a Delivery.
 */
export function sectionForPath(pathname: string): { section: AdminNavSection; item: AdminNavItem } | null {
  let best: { section: AdminNavSection; item: AdminNavItem } | null = null
  for (const section of ADMIN_NAV) {
    for (const item of section.items) {
      if (pathname === item.href) return { section, item }
      if (pathname.startsWith(item.href + '/') && (!best || item.href.length > best.item.href.length)) {
        best = { section, item }
      }
    }
  }
  return best
}

/** Who is looking: their role and their per-person section changes. */
export interface NavViewer {
  role: Role | null
  sectionGrants?: string[]
  sectionRevocations?: string[]
}

/**
 * Whether an item shows for this person, with these modules switched on.
 *
 * One answer for the sidebar and the dashboard, which used to work it out
 * separately and drifted: the dashboard ignored revocations, so a section
 * taken away from somebody vanished from the sidebar but stayed on the
 * dashboard (UPGRADE.md T1.14).
 *
 * - Section grants and revocations count, as useRequireRole() counts them.
 * - `flags` null means the switches are still loading: shown, so nothing
 *   flickers; a link to a switched-off module is a dead end, not a hole —
 *   useRequireFeature() and the server are what stop anything.
 * - The section is found through SECTION_ACCESS by reference, the same array
 *   an item passes (verify:sections checks that).
 */
export function navItemVisible(access: Role[], viewer: NavViewer, flags: FeatureFlags | null): boolean {
  const sectionKey = Object.entries(SECTION_ACCESS).find(([, v]) => v === access)?.[0]
  if (!hasSectionAccess(viewer.role, access, viewer.sectionGrants, sectionKey, viewer.sectionRevocations)) return false
  if (flags === null || !sectionKey) return true
  const feature = featureForSection(sectionKey)
  return feature ? isFeatureOn(feature, flags) : true
}

/** The navigation as this person sees it: only visible items, and only sections with any. */
export function visibleNav(viewer: NavViewer, flags: FeatureFlags | null): AdminNavSection[] {
  return ADMIN_NAV
    .map(section => ({ ...section, items: section.items.filter(item => navItemVisible(item.access, viewer, flags)) }))
    .filter(section => section.items.length > 0)
}
