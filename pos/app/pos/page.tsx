'use client'

// POS v1 lands here — Phase 03. The waiter's order screen: open a table, build
// a check with modifiers, send it to the kitchen.
//
// A placeholder rather than an empty app, because the deployment path is worth
// proving before the feature exists: this builds, deploys to its own subdomain
// and answers on /pos, so when the real screen arrives the only new thing is
// the screen.
//
// The modifier model it will read is already built — see
// @big-cms/shared/modifiers and /api/admin/modifiers.

import { BRAND } from '@big-cms/shared/brand'
import { adminUrl } from '@big-cms/shared/appUrls'

// The POS and the admin panel are separate deployments, so this is an absolute
// URL or nothing. Staff manage the menu the POS sells from there, so the way
// through matters — but a link that 404s is worse than no link, which is why
// it only renders when NEXT_PUBLIC_ADMIN_URL is set.
const ADMIN_HOME = adminUrl()

export default function PosPage() {
  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', fontFamily: 'var(--font-inter)',
    }}>
      <div style={{ textAlign: 'center', maxWidth: '38ch' }}>
        <p style={{
          fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase',
          color: 'var(--teal)', marginBottom: '0.8rem',
        }}>{BRAND.name}</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: '2rem',
          color: 'var(--offwhite)', marginBottom: '0.8rem',
        }}>Point of Sale</h1>
        <p style={{
          fontSize: '0.88rem', color: 'rgba(245,242,236,0.4)', lineHeight: 1.7,
        }}>
          Order entry is being built. This app is deployed and reachable — the
          screen is what is coming next.
        </p>
        {ADMIN_HOME && (
          <a href={ADMIN_HOME} style={{
            display: 'inline-block', marginTop: '2rem',
            fontSize: '0.72rem', letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--offwhite)', textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.14)', borderRadius: '2px',
            padding: '0.65rem 1.4rem',
          }}>Admin panel</a>
        )}
      </div>
    </main>
  )
}
