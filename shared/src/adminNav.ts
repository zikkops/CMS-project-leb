import { SECTION_ACCESS, ALL_ROLES, type Role } from './adminAuth'

export interface AdminNavItem {
  label: string
  href: string
  access: Role[]
}

export interface AdminNavSection {
  title: string
  color: string
  items: AdminNavItem[]
}

// Mirrors the section/card layout on app/admin/page.tsx (kept as a separate,
// independently-declared list there since that page also carries per-card
// descriptions and live pending-count badges that the sidebar doesn't need)
// — if a new admin page is added, add it in both places.
export const ADMIN_NAV: AdminNavSection[] = [
  {
    title: 'Product Sales',
    color: 'var(--teal)',
    items: [
      { label: 'Record a Sale',    href: '/admin/products/purchase',  access: SECTION_ACCESS.productPurchases },
      { label: 'Sales & Invoices', href: '/admin/products/invoices',  access: SECTION_ACCESS.productPurchases },
      { label: 'Transfer Stock',   href: '/admin/products/transfer',  access: SECTION_ACCESS.productTransfers },
    ],
  },
  {
    title: 'Content Management',
    color: 'var(--teal)',
    items: [
      { label: 'Manage Products',       href: '/admin/products',             access: SECTION_ACCESS.products },
      { label: 'Manage Menu',        href: '/admin/menu',              access: SECTION_ACCESS.menu },
      { label: 'Manage Events',      href: '/admin/events',            access: SECTION_ACCESS.events },
      { label: 'Event Reservations', href: '/admin/events/reservations', access: SECTION_ACCESS.events },
    ],
  },
  {
    title: 'Table Bookings',
    color: 'var(--navy)',
    items: [
      { label: "Today's Schedule",   href: '/admin/schedule',            access: SECTION_ACCESS.tableReservations },
      { label: 'Table Reservations', href: '/admin/tables/reservations', access: SECTION_ACCESS.tableReservations },
      { label: 'Table Map Editor',   href: '/admin/branches/tables',     access: SECTION_ACCESS.branchTables },
    ],
  },
  {
    title: 'Loyalty Submissions',
    color: 'var(--navy)',
    items: [
      { label: 'Event Attendance',       href: '/admin/loyalty/events', access: SECTION_ACCESS.loyaltyEvents },
    ],
  },
  {
    title: 'Loyalty Approvals',
    color: 'var(--navy)',
    items: [
      { label: 'Loyalty Approvals',   href: '/admin/loyalty/approvals',   access: SECTION_ACCESS.loyalty },
      { label: 'Redemption Requests', href: '/admin/loyalty/redemptions', access: SECTION_ACCESS.loyalty },
    ],
  },
  {
    title: 'Loyalty Catalog',
    color: 'var(--navy)',
    items: [
      { label: 'Redemption Items', href: '/admin/loyalty/redemption-items', access: SECTION_ACCESS.loyalty },
      { label: 'Tier Perks',       href: '/admin/loyalty/perks',            access: SECTION_ACCESS.loyalty },
    ],
  },
  {
    title: 'Customer Accounts',
    color: 'var(--navy)',
    items: [
      { label: 'Manage Customers', href: '/admin/loyalty/customers', access: ['admin'] as Role[] },
      { label: 'Loyalty Activity', href: '/admin/loyalty/activity',  access: SECTION_ACCESS.loyalty },
    ],
  },
  {
    title: 'Weekly Orders',
    color: 'var(--teal)',
    items: [
      { label: 'Order Reports',      href: '/admin/weekly-orders',           access: SECTION_ACCESS.weeklyOrders },
      { label: 'End of Week Order',  href: '/admin/weekly-orders/submit',    access: SECTION_ACCESS.weeklyOrdersSubmit },
      { label: 'Inventory Management', href: '/admin/supplies',              access: SECTION_ACCESS.products },
      { label: 'Receive a Delivery', href: '/admin/supplies/receiving',      access: SECTION_ACCESS.deliveries },
      { label: 'Daily Inventory Count', href: '/admin/supplies/daily',       access: SECTION_ACCESS.dailyInventory },
      { label: 'Daily Inventory History', href: '/admin/supplies/daily/history', access: SECTION_ACCESS.dailyInventoryHistory },
      { label: 'Manage Providers',   href: '/admin/weekly-orders/providers', access: ['admin'] as Role[] },
      { label: 'Edit Template',      href: '/admin/weekly-orders/template',  access: ['admin'] as Role[] },
    ],
  },
  {
    title: 'End of Day',
    color: '#C9962C',
    items: [
      { label: 'Submit EOD Report', href: '/admin/end-of-day',          access: SECTION_ACCESS.endOfDay },
      { label: 'EOD History',       href: '/admin/end-of-day/history',  access: SECTION_ACCESS.endOfDayHistory },
      { label: 'Daily Summary',     href: '/admin/end-of-day/summary',  access: SECTION_ACCESS.endOfDayHistory },
      { label: 'Tips Calculator',   href: '/admin/end-of-day/tips',     access: SECTION_ACCESS.endOfDay },
      { label: 'Staff Roster',      href: '/admin/end-of-day/staff',   access: ['admin'] as Role[] },
    ],
  },
  {
    title: 'Administration',
    color: 'var(--red)',
    items: [
      { label: 'Media Library', href: '/admin/media', access: ALL_ROLES },
      { label: 'Manage Users',  href: '/admin/users',  access: ['admin'] as Role[] },
      { label: 'Activity Log',  href: '/admin/logs',   access: ['admin'] as Role[] },
      // Admin-gated here and superadmin-gated on the page, because the nav has
      // no notion of superadmin. An admin who is not one sees the link and is
      // told why rather than hitting a blank screen.
      { label: 'Business Settings', href: '/admin/settings',          access: ['admin'] as Role[] },
      { label: 'Modules',           href: '/admin/settings/features', access: ['admin'] as Role[] },
    ],
  },
]
