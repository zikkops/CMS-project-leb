import { BRAND } from '@big-cms/shared/brand'

// The installed counter app's icon.
//
// A route rather than a file in public/ for one reason: the colour. A committed
// .svg would carry a hex code that no longer changes when the palette does, and
// this repo has spent real effort getting colours out of files and into
// BRAND — an icon is not the place to put one back.
//
// Under /pos/ because that is what the POS host serves (shared/src/hosts.ts);
// /images or /icon.svg would 404 on pos.<domain> and the manifest would install
// with no icon at all, silently.

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const initial = (BRAND.name.trim()[0] ?? 'C').toUpperCase()
  // Escaped: a brand name is configuration, and configuration ends up in the
  // one place nobody escapes it.
  const safe = initial.replace(/[<>&"']/g, '')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${BRAND.name} counter">
  <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
  <rect x="96" y="128" width="320" height="256" rx="24" fill="none" stroke="${BRAND.colors.primary}" stroke-width="24"/>
  <text x="256" y="300" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="140" fill="${BRAND.colors.primary}">${safe}</text>
</svg>`

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      // A day. The icon changes when the palette does, which is rarely, and a
      // manifest icon that cannot be re-fetched for a year is a bad trade.
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
