// The weekly-order departments, in a module with NO imports.
//
// Extracted from weeklyOrders.ts for the same reason roles.ts was extracted
// from adminAuth.ts: that file imports the Firebase client SDK, so a route
// handler validating a department against it would drag the client SDK onto
// the server. weeklyOrders.ts re-exports both names, so every existing import
// site keeps working unchanged.
//
// NOT the same list as DEPARTMENTS in dailyInventory.ts, which carries a
// fourth entry ('Other') and means supply *categories* rather than the
// departments a staff account can submit orders for. Nothing imports that
// one's Department type; the collision is in the name only.

export type Department = 'Kitchen' | 'Bar' | 'Cleaning'

export const DEPARTMENTS: Department[] = ['Kitchen', 'Bar', 'Cleaning']

export function isDepartment(value: unknown): value is Department {
  return typeof value === 'string' && (DEPARTMENTS as string[]).includes(value)
}
