'use client'

// An error in the ROOT LAYOUT. Next replaces the whole document with this, so
// the brand variables and the fonts are both gone — see GlobalErrorPage for
// why every value in it is a literal.

import { GlobalErrorPage } from '@big-cms/shared/components/GlobalErrorPage'

export default function GlobalError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <GlobalErrorPage app="admin" {...props} />
}
