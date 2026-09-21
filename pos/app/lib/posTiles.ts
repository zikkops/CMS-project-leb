// The till's other screens, as the floor shows them (UPGRADE.md T4.1).
//
// One list, filtered the way the admin navigation is (adminNav.ts): a tile
// shows when its feature is on and the person's role may open its section.
// Adding a till screen means adding one entry here, and verify:sections fails
// when an entry points at a page that does not exist or names a feature or a
// section that does not.
//
// Each tile has its own hue, never teal: teal is the floor's main action
// (CLAUDE.md, POS look and feel).

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faStore, faReceipt, faFire, faCashRegister, faWheatAwnCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS, hasSectionAccess, type Role } from '@big-cms/shared/roles'
import { isFeatureOn, type FeatureFlags, type FeatureKey } from '@big-cms/shared/features'

export interface PosTile {
  key: string
  label: string
  /** One line under the label, on a wide screen. */
  sub: string
  icon: IconDefinition
  colour: string
  href: string
  /** Shown only while this feature is on. None: always, with the till. */
  feature?: FeatureKey
  /** Who may open it. */
  section: keyof typeof SECTION_ACCESS
}

export const POS_TILES: readonly PosTile[] = [
  { key: 'counter', label: 'Counter', sub: 'The till, even offline', icon: faStore, colour: '#06B6D4', href: '/pos/counter', section: 'pos' },
  { key: 'closed', label: 'Closed', sub: 'Checks closed today', icon: faReceipt, colour: '#A855F7', href: '/pos/closed', section: 'pos' },
  { key: 'kds', label: 'Kitchen display', sub: 'The pass', icon: faFire, colour: '#F97316', href: '/pos/kds', feature: 'kds', section: 'kds' },
  { key: 'drawer', label: 'Drawer', sub: 'Float, X and Z', icon: faCashRegister, colour: '#EAB308', href: '/pos/drawer', feature: 'payments', section: 'pos' },
  { key: 'allergens', label: 'Allergens', sub: 'What is in each dish', icon: faWheatAwnCircleExclamation, colour: '#EC4899', href: '/pos/allergens', feature: 'foodSafety', section: 'pos' },
]

/** The tiles this person sees: feature on, and a role that opens the section. */
export function visibleTiles(role: Role | null, flags: FeatureFlags): PosTile[] {
  return POS_TILES.filter(t =>
    (!t.feature || isFeatureOn(t.feature, flags)) &&
    hasSectionAccess(role, SECTION_ACCESS[t.section], [], t.section, []))
}
