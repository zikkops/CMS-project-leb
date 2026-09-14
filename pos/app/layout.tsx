import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Inter, Bree_Serif } from 'next/font/google'
import '@big-cms/shared/styles/globals.css'
import { BRAND } from '@big-cms/shared/brand'
import { brandCssVars } from '@big-cms/shared/brandCss'
import { DemoBanner } from '@big-cms/shared/components/DemoBanner'
// next/font requires a static import per face — the family cannot come from a
// variable, so it stays in each app rather than moving to the shared package.
// The COLOURS are shared (brandCssVars); only the font loading is duplicated,
// and that duplication is the framework's requirement rather than a choice.
const bodyFont = Inter({
  subsets: ['latin'],
  variable: '--font-brand-body',
})

const displayFont = Bree_Serif({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-brand-display',
})

export const metadata: Metadata = {
  title: `${BRAND.name} — POS`,
  // Neither the admin panel nor the POS belongs in a search index. proxy.ts
  // sets X-Robots-Tag as well; this is the copy a crawler sees without it.
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request, never prerendered. A prerendered page is sent with
  // `s-maxage=31536000`, and the host's CDN keeps it for a year: on 14 Sep 2026
  // the live floor was several deploys old. A till has nothing to gain from an
  // edge cache and everything to lose from a stale one (Next's CDN caching
  // guide). The service worker still keeps the counter screen for outages —
  // the Cache API stores what it is given, whatever the header says.
  await connection()
  // On a café hub (POS software, stage 3) the page says so, and the till's
  // backend() reads it: its data then comes from the hub, not Firestore. An
  // attribute rather than an inline script, which the CSP would refuse.
  const onHub = Boolean(process.env.BIG_CMS_HUB_DB)
  return (
    <html lang="en" data-backend={onHub ? 'hub' : undefined} className={`${bodyFont.variable} ${displayFont.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandCssVars() }} />
      </head>
      <body>
        <DemoBanner />
        {children}
      </body>
    </html>
  )
}
