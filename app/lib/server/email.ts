// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Transactional email, via Resend's REST API. Deliberately a raw fetch rather
// than the `resend` npm package: it's one POST, and not adding a dependency
// keeps the Vercel bundle and the audit surface smaller.
//
// CONFIGURATION
//   RESEND_API_KEY   required for anything to actually send
//   RESEND_FROM      e.g. "Onboard <orders@onboard.lb>" — the domain must be
//                    verified in Resend, or delivery fails for every recipient
//                    except the Resend account's own address.
//
// WITHOUT A KEY this is a no-op that reports back why. Callers must treat a
// failed send as non-fatal — an order that saved but didn't email is a
// notification problem, not a lost order, and throwing here would tell the
// shop their order failed when it didn't.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export interface EmailResult {
  sent:   boolean
  id?:    string
  reason?: string
}

export interface EmailAttachment {
  // Resend fetches this URL server-side and attaches the result, so it must be
  // publicly reachable — which imgbb URLs are.
  path:     string
  filename: string
}

export interface EmailInput {
  to:           string | string[]
  subject:      string
  text:         string
  replyTo?:     string
  attachments?: EmailAttachment[]
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, reason: 'RESEND_API_KEY is not set' }

  const from = process.env.RESEND_FROM || 'Onboard <onboarding@resend.dev>'

  try {
    // Resend has no published hard timeout; bound it ourselves so a hanging
    // request can't hold the order response open.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.attachments?.length ? 20_000 : 10_000)

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Resend's message is genuinely useful here ("domain not verified",
      // "invalid from"), so it's surfaced rather than flattened.
      return { sent: false, reason: (body as { message?: string }).message ?? `Resend returned ${res.status}` }
    }
    return { sent: true, id: (body as { id?: string }).id }
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError'
      ? 'Resend timed out'
      : err instanceof Error ? err.message : 'Unknown email error'
    return { sent: false, reason }
  }
}
