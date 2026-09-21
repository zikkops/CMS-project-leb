import { BRANCHES as CONFIGURED_BRANCHES, PRIMARY_BRANCH } from '@big-cms/shared/branches'
import { BRAND } from '@big-cms/shared/brand'

// Not a branch — the "runs at every branch" option the picker offers alongside
// the real ones. Named rather than inlined so the string appears once.
const ALL_BRANCHES = 'All Branches'

export interface GameEvent {
  id: string
  title: string
  type: string
  branch: string
  date: string
  timeStart: string
  timeEnd: string
  description: string
  price: number
  minPlayers: number
  maxPlayers: number
  registrationLink?: string
  image?: string
  contactNumber?: string
}

export interface EventType {
  id: string
  name: string
}

export const EMPTY = {
  title: '',
  type: '',
  branch: PRIMARY_BRANCH,
  date: '',
  timeStart: '',
  timeEnd: '',
  description: '',
  price: 0,
  minPlayers: 2,
  maxPlayers: 6,
  registrationLink: '',
  image: '',
  contactNumber: BRAND.contact.phone,
}

export type EventForm = typeof EMPTY

// An event can be branch-specific or run everywhere, so the picker is the
// configured branches plus that one extra option.
export const BRANCH_OPTIONS = [...CONFIGURED_BRANCHES, ALL_BRANCHES]

// Quick-pick contact numbers for the event's enquiry line.
//
// This was a fixed table of the original café's three real phone numbers,
// which is business contact data with no place in a de-branded fork. There is
// nowhere to configure a number PER BRANCH yet — brand.ts holds one for the
// whole business — so every branch offers that one until the settings page
// this phase is really about gives them somewhere to live.
export const BRANCH_NUMBERS = CONFIGURED_BRANCHES.map(label => ({
  label,
  number: BRAND.contact.phone,
}))

export const inputStyle = {
  width: '100%',
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(var(--overlay-rgb),0.1)',
  color: 'var(--offwhite)',
  padding: '0.75rem 1rem',
  borderRadius: '2px',
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
}

export const labelStyle = {
  display: 'block',
  fontSize: '0.68rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  color: 'rgba(var(--offwhite-rgb),0.35)',
  marginBottom: '0.5rem',
  fontFamily: 'var(--font-inter)',
}
