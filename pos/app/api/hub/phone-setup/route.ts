// What the staff app needs from a café hub to register a phone — POS software,
// stage 5 (S13).
//
// GET   { cloudUrl, firebaseApiKey }
//
// Only on a hub. Registering is online and the cloud's: the app signs the staff
// member in with their normal email and password, then sends the phone's key to
// the cloud. It learns where the cloud is from the hub it paired with, over the
// pinned connection, so a phone is never pointed at a cloud by anything else.
// Neither value is a secret: the Firebase web API key is in every page the POS
// serves.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { cloudBaseUrl } from '@big-cms/shared/server/hubSync'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    const cloudUrl = cloudBaseUrl(process.env.BIG_CMS_CLOUD_URL)
    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? ''
    if (!cloudUrl || !firebaseApiKey) {
      throw new HttpError(503, 'This hub does not know its cloud yet, so it cannot register phones. Start it from the Windows app.')
    }
    return Response.json({ ok: true, cloudUrl, firebaseApiKey }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
