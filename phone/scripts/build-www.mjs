// Bundles the staff app's own page (src/app.ts) into www/app.js.
//
// The app's reading of the counter screen's QR is shared/src/hubNetwork.ts,
// imported here rather than copied, so the hub and the app cannot disagree
// about what a hub link is. esbuild is this folder's own dev dependency.

import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const phone = resolve(here, '..')

await build({
  entryPoints: [resolve(phone, 'src/app.ts')],
  outfile: resolve(phone, 'www/app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
})
