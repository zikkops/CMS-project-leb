'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useCustomerUser } from '@big-cms/shared/customerAuth'
import { adminUrl } from '@big-cms/shared/appUrls'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'

const LOGIN_PATH = '/customer/login'

// The admin panel is a separate deployment, so this is an absolute URL or
// nothing. What matters here is that a staff account does not sit in the
// customer area — sending them home achieves that when there is no admin app
// to send them to, and never leaves them on a 404.
const ADMIN_HOME = adminUrl()

// Scoped to the (customer) route group only — entirely separate from the
// admin/CMS auth in app/admin and shared/src/adminAuth.ts.
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, isStaff } = useCustomerUser()

  useEffect(() => {
    if (loading) return
    // A staff account is staff only. The sign-in guards stop one signing in
    // through the customer forms, but somebody already signed into the admin
    // panel in this browser holds a live session and would otherwise walk
    // straight in — including into /customer/login itself, which is why this
    // check comes before the LOGIN_PATH exemption below.
    if (user && isStaff) {
      if (ADMIN_HOME) window.location.href = ADMIN_HOME
      else router.replace('/')
      return
    }
    if (!user && pathname !== LOGIN_PATH) {
      router.replace(LOGIN_PATH)
    }
  }, [loading, user, isStaff, pathname, router])

  if (loading) return null
  if (user && isStaff) return null
  if (!user && pathname !== LOGIN_PATH) return null

  // Navbar/Footer are added here once for the whole group, rather than
  // per-page like the public pages do, since every page here shares the
  // same "customer area" framing. Navbar floats fixed on top, so the
  // extra top padding keeps it from covering each page's own content —
  // those pages already have their own top padding too, which just means
  // a bit of extra breathing room, not an exact science.
  return (
    <>
      <Navbar />
      <div style={{ paddingTop: '5rem' }}>
        {children}
      </div>
      <Footer />
    </>
  )
}
