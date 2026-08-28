import type { Metadata } from 'next'
import { Inter, Bree_Serif } from 'next/font/google'
import './globals.css'
import { BRAND, isPlaceholderBrand } from './lib/brand'
import { DemoBanner } from './components/DemoBanner'

// next/font requires a static import per face — the family cannot come from a
// runtime config value. So the FACES are a code change; which of them is used
// for display vs body, and every colour around them, is configuration.
//
// A tenant wanting different typography edits these two lines. Everything else
// about their brand is env-driven. That's a deliberate line: fonts are a build
// concern (they're subset and self-hosted at build time), colours are not.
const bodyFont = Inter({
  subsets: ['latin'],
  variable: '--font-brand-body',
  display: 'swap',
})

const displayFont = Bree_Serif({
  subsets: ['latin'],
  variable: '--font-brand-display',
  weight: '400',
  display: 'swap',
})

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
  icons: { icon: BRAND.faviconUrl, apple: BRAND.faviconUrl },
  // A demo deployment must never be indexed. It would compete with a real
  // customer's site for their own brand terms, and a half-finished CMS showing
  // up in search results is its own kind of damage. public/robots.txt covers
  // crawlers that read it; this covers the ones that only read meta tags.
  robots: isPlaceholderBrand() ? { index: false, follow: false } : undefined,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <head>
        {/*
          Brand colours are injected here rather than written into globals.css,
          because globals.css is a static file and these come from config.

          THE ALIASES MATTER. Roughly fifty components already reference
          var(--teal), var(--red), var(--purple) and var(--navy) in inline
          style objects. Renaming them all would be a thousand-line diff with
          no behavioural change and a real chance of missing one. So the
          semantic names are the source of truth and the old names alias onto
          them: existing code keeps working, new code uses the semantic names,
          and both resolve to the same configured value.

          Write --brand-primary in anything new. The four legacy aliases are
          kept for compatibility, not as an example to follow.
        */}
        <style dangerouslySetInnerHTML={{ __html: `
:root {
  --brand-primary:    ${BRAND.colors.primary};
  --brand-secondary:  ${BRAND.colors.secondary};
  --brand-tertiary:   ${BRAND.colors.tertiary};
  --brand-deep:       ${BRAND.colors.deep};
  --brand-danger:     ${BRAND.colors.danger};
  --brand-background: ${BRAND.colors.background};
  --brand-foreground: ${BRAND.colors.foreground};

  /* Legacy aliases — see the note above. Do not add more. */
  --teal:     var(--brand-primary);
  --red:      var(--brand-danger);
  --purple:   var(--brand-tertiary);
  --navy:     var(--brand-deep);
  --black:    var(--brand-background);
  --offwhite: var(--brand-foreground);

  --font-display: var(--font-brand-display);
  --font-body:    var(--font-brand-body);
  /* Legacy font aliases, same reasoning as the colours. */
  --font-cinzel:  var(--font-brand-display);
  --font-inter:   var(--font-brand-body);
}
        `.trim() }} />
      </head>
      <body>
        <DemoBanner />
        {children}
      </body>
    </html>
  )
}
