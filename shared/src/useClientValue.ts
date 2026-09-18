// A value only the browser can know — today's date on this device, something
// remembered in localStorage — without a setState inside an effect.
//
// The page is rendered on the server first, where there is no localStorage and
// the clock is the host's. Reading the browser's value during the first render
// would disagree with the server's HTML (a hydration error), which is why these
// used to be set from an effect after mounting — a second render straight away
// (react-hooks/set-state-in-effect). useSyncExternalStore is React's own way:
// the server snapshot is used while hydrating, then the browser's.
//
// Primitives only (string, number, boolean): React compares snapshots by
// identity, and a fresh object on every read would never settle.

import { useSyncExternalStore } from 'react'

const noSubscription = () => () => {}

export function useClientValue<T extends string | number | boolean | null>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscription, read, () => serverValue)
}
