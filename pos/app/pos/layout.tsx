// Every till page, with the "Signed in" strip a shared device shows on each
// of them (UPGRADE.md T6.2). The strip hides itself on a personal phone, on a
// kitchen screen, and on the sign-in and hub pages.

import { SignedInStrip } from '../lib/SignedInStrip'

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedInStrip />
      {children}
    </>
  )
}
