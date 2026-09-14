// Which backend the till uses — POS software.
//
// Online mode is the cloud. On a café hub (stage 3) the root layout marks the
// page `data-backend="hub"`, and the till's data comes from the counter PC
// instead. No screen needs to know which: every read is a PosQuery and every
// write a request (types.ts).

import { cloudBackend } from './cloud'
import { hubBackend } from './hub'
import type { PosBackend } from './types'

export type { PosBackend, Snapshot, RequestOptions } from './types'

/** Whether this page was served by a café hub. Never true while rendering on the server. */
export function onHub(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.backend === 'hub'
}

export function backend(): PosBackend {
  return onHub() ? hubBackend : cloudBackend
}
