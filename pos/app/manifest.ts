import type { MetadataRoute } from 'next'
import { BRAND } from '@big-cms/shared/brand'

// The counter device's manifest — Phase 04, slice 7a.
//
// This is what lets the till be installed to a home screen and opened without
// browser chrome, which matters for more than looks: an installed page keeps
// its service worker and its storage when a tab would have been closed, and a
// staff member cannot navigate the till away by tapping the address bar.
//
// Served at /manifest.webmanifest, which shared/src/hosts.ts allows on every
// surface — so the POS host answers for it without a path exception.
//
// start_url is the counter screen, not /pos: the counter is the one page that
// works with no server behind it (App Router navigation to /pos/check/[id]
// needs one), so it is the only honest place to land a device that may be
// opened during an outage. scope keeps the installed app to /pos/ — the same
// boundary the service worker has, and the same one the POS host enforces.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — Counter`,
    short_name: 'Counter',
    description: 'The till at the counter. Takes orders and payment, and keeps working through an outage.',
    start_url: '/pos/counter',
    scope: '/pos/',
    display: 'standalone',
    orientation: 'portrait',
    // The POS is dark throughout — this is the colour behind the screen while
    // it opens, so anything else is a white flash on every launch.
    background_color: '#0a0a0a',
    theme_color: BRAND.colors.primary,
    icons: [
      {
        src: '/pos/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
