// New versions of the Windows counter app — POS software (owner's decision
// S26, 15 Sep 2026).
//
// GET /api/desktop-updates/latest.json                the signed manifest
// GET /api/desktop-updates/BIG-CMS-POS-Setup-x.y.z.exe  an installer
//
// Served from DESKTOP_UPDATES_DIR, a folder on the POS server OUTSIDE the app:
// the app folder is rebuilt on every deploy, and an installer is too large to
// live in git. With the variable unset, every request is a 404. Only those two
// names are ever looked up, so nothing else in the folder, or above it, is
// reachable. What is served is not trusted by the counter app: it checks the
// manifest's signature and the installer's SHA-512 itself (desktop/update.js).
//
// Cloud only; 404 on a hub.

import { createReadStream, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FILE = /^(latest\.json|BIG-CMS-POS-Setup-\d{1,4}\.\d{1,4}\.\d{1,6}\.exe)$/

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  try {
    const dir = process.env.DESKTOP_UPDATES_DIR
    const { file } = await params
    if (hubDbPath() || !dir || !FILE.test(file)) throw new HttpError(404, 'Not found.')
    const full = join(dir, file)
    let size: number
    try {
      const stat = statSync(full)
      if (!stat.isFile()) throw new Error('not a file')
      size = stat.size
    } catch {
      throw new HttpError(404, 'Not found.')
    }
    const manifest = file === 'latest.json'
    return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, {
      headers: {
        'Content-Type': manifest ? 'application/json' : 'application/octet-stream',
        'Content-Length': String(size),
        // The manifest changes with each release; an installer's name carries its version.
        'Cache-Control': manifest ? 'no-store' : 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    return toResponse(err)
  }
}
