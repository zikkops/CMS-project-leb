import type { Metadata } from 'next'
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
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
