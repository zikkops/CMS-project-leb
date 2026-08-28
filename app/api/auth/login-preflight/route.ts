import { NextResponse } from 'next/server'

// In-memory rate limit for /admin/login: 10 attempts per IP per 15 minutes.
// Module-level state persists within a single Node.js function instance.
// On Vercel/serverless, state resets on cold starts — Firebase Auth's own
// built-in rate limiting (which *does* persist) is the primary protection;
// this adds a visible server-side layer on top.
const attempts = new Map<string, { count: number; firstAt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000

export async function POST(request: Request): Promise<NextResponse> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '0.0.0.0'

  const now = Date.now()
  const entry = attempts.get(ip)

  if (entry && now - entry.firstAt <= WINDOW_MS) {
    if (entry.count >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { ok: false },
        { status: 429, headers: { 'Retry-After': '900' } },
      )
    }
    entry.count++
  } else {
    attempts.set(ip, { count: 1, firstAt: now })
  }

  return NextResponse.json({ ok: true })
}
