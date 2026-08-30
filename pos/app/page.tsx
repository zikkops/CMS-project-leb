import { redirect } from 'next/navigation'

// The POS lives at /pos, not at /, so the app keeps working whether it is on
// its own hostname or sharing one. proxy.ts redirects / when POS_HOST is set;
// this covers every other case — a local dev server, or a deploy where the
// hostname split has not been configured yet.
export default function PosRoot() {
  redirect('/pos')
}
