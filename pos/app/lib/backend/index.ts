// Which backend the till uses — POS software, stage 2.
//
// Online mode is the cloud. Software mode (stage 3) will choose the café's hub
// here, by the client's setting, and no screen needs to know which: every
// read is a PosQuery and every write a request (types.ts).

import { cloudBackend } from './cloud'
import type { PosBackend } from './types'

export type { PosBackend, Snapshot, RequestOptions } from './types'

const active: PosBackend = cloudBackend

export function backend(): PosBackend {
  return active
}
