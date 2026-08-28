'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useCustomerUser } from '../lib/customerAuth'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'

const LOGIN_PATH = '/customer/login'

// Scoped to the (customer) route group only — entirely separate from the
// admin/CMS auth in app/admin and app/lib/adminAuth.ts.
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useCustomerUser()

  useEffect(() => {
    if (loading) return
    if (!user && pathname !== LOGIN_PATH) {
      router.replace(LOGIN_PATH)
    }
  }, [loading, user, pathname, router])

  if (loading) return null
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
