'use client'

import { usePathname } from 'next/navigation'
import AdminShell from '../components/admin/AdminShell'

// /admin/login is intentionally excluded — no one is signed in yet there, so
// there's no role to filter nav items by, and showing sidebar chrome above a
// login form would be pointless.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === '/admin/login') return <>{children}</>
  return <AdminShell>{children}</AdminShell>
}
