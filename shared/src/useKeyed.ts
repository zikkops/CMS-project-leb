// State that belongs to a key — a uid, a branch, a set of branches.
//
// A hook that listens for "this user's reservations" used to reset itself
// inside its effect: setReservations([]) and setLoading(false) when there was
// no user, setLoading(true) when the user changed. Each of those is a setState
// called straight from an effect, which renders the component twice for
// nothing (react-hooks/set-state-in-effect). Here the answer is stored WITH the
// key it answers, and what the caller sees is worked out while rendering:
//
//   - no key: the empty value, not loading;
//   - a key whose answer has not arrived (first time, or the key just
//     changed): the empty value, loading — never the previous key's data;
//   - otherwise: the answer.
//
// The effect then only ever calls put() from a listener's callback.

import { useCallback, useState } from 'react'

export interface Keyed<T> {
  value: T
  loading: boolean
  /** Records the answer for a key. Stable across renders, so safe in an effect. */
  put: (key: string, value: T) => void
}

export function useKeyed<T>(key: string | null, empty: T): Keyed<T> {
  const [got, setGot] = useState<{ key: string; value: T } | null>(null)
  const put = useCallback((k: string, value: T) => setGot({ key: k, value }), [])
  const current = got !== null && key !== null && got.key === key ? got : null
  return { value: current ? current.value : empty, loading: key !== null && current === null, put }
}

/**
 * The key for a branch filter: 'all', some branches, or nothing to show. An
 * empty list is nothing, the same as null, so a manager with no branches sees
 * an empty queue rather than a spinner.
 */
export function branchFilterKey(filter: string[] | 'all' | null): string | null {
  if (filter === 'all') return 'all'
  if (!filter || filter.length === 0) return null
  return filter.join(',')
}

/** The filter a key stands for, inside the effect. */
export function branchFilterFromKey(key: string): string[] | 'all' {
  return key === 'all' ? 'all' : key.split(',')
}
