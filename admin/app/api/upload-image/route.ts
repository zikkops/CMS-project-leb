// Thin adapter. The handler lives in @big-cms/shared/server/uploadImageRoute
// so the customer site and the admin panel cannot drift apart on who may
// upload and what is accepted.
export { handleUploadImage as POST } from '@big-cms/shared/server/uploadImageRoute'
export const runtime = 'nodejs'
