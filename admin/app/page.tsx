import { redirect } from 'next/navigation'

// Same reasoning as the POS root: /admin is the app, and / must not 404 just
// because ADMIN_HOST has not been set.
export default function AdminRoot() {
  redirect('/admin')
}
