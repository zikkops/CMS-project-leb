// The POS dev server running as a café hub. DEVELOPMENT ONLY — POS software,
// stage 3.
//
//   npm run hub:seed        # once: the menu and settings into .hub/dev.db
//   npm run dev:pos-hub     # http://localhost:3004
//
// BIG_CMS_HUB_DB is the whole difference between a POS server and a hub: with
// it set, the server code reads and writes that file and the pages use the hub
// backend. Only one `next dev` can run in pos/ at a time, so stop the ordinary
// POS dev server first.

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const db = resolve(process.env.BIG_CMS_HUB_DB || '.hub/dev.db')
console.log(`[hub] POS on http://localhost:3004 with its data in ${db}`)

const child = spawn('npm', ['run', 'dev', '--workspace', 'pos', '--', '-p', '3004'], {
  stdio: 'inherit',
  shell: true,
  // The "cloud" a dev hub pairs with and pulls from is the ordinary POS dev
  // server (npm run dev:pos, port 3002), which has this machine's Admin key.
  env: { ...process.env, BIG_CMS_HUB_DB: db, BIG_CMS_CLOUD_URL: process.env.BIG_CMS_CLOUD_URL || 'http://localhost:3002' },
})
child.on('exit', code => process.exit(code ?? 0))
