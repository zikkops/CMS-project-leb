// The café hub's change feed — POS software, stage 3.
//
// GET /api/hub/changes
//
// Server-sent events saying which documents each commit wrote: never their
// contents. On connecting, `{ seq }`; after every commit, `{ seq, touched }`.
// Every watch on a screen shares this one stream (pos/app/lib/backend/hub.ts),
// and each asks /api/hub/query again when a write touches what it shows.
//
// ── Why one stream, not one per watch ──────────────────────────────────────
// A browser opens at most six connections to one address over plain HTTP, and
// a stream keeps its connection for as long as the screen is open. The first
// version streamed each watch on its own: the floor opened seven, and the
// seventh — and every write after it — waited behind them forever, so "Open
// table" never came back. A hub on the café wifi is plain HTTP, so the limit
// is real there too.

import { toResponse } from '@big-cms/shared/server/auth'
import { requireHubReader } from '../access'

export const runtime = 'nodejs'

// A comment line now and then, so nothing between the till and the hub decides
// a quiet stream is a dead one.
const KEEP_ALIVE_MS = 20_000

export async function GET(request: Request): Promise<Response> {
  try {
    const { store } = await requireHubReader(request)
    const encoder = new TextEncoder()
    let stop = () => {}

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        const write = (text: string) => {
          if (!closed) controller.enqueue(encoder.encode(text))
        }
        const unsubscribe = store.onChange(changes => {
          const seq = Math.max(...changes.map(c => c.seq))
          write(`data: ${JSON.stringify({ seq, touched: changes.map(c => ({ collection: c.collection, id: c.id })) })}\n\n`)
        })
        const beat = setInterval(() => write(': still here\n\n'), KEEP_ALIVE_MS)
        stop = () => {
          if (closed) return
          closed = true
          unsubscribe()
          clearInterval(beat)
          try { controller.close() } catch { /* already closed by the reader */ }
        }
        request.signal.addEventListener('abort', stop)
        // Where the log stands now. A watch that connects — or reconnects after
        // the wifi dropped — asks again, since it cannot know what it missed.
        write(`data: ${JSON.stringify({ seq: store.lastSeq() })}\n\n`)
      },
      cancel() {
        stop()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    return toResponse(err)
  }
}
