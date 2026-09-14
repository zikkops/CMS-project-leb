// Checks the hub server went into the Windows app whole — POS software, stage 3.
//
//   node scripts/check-hub-shipped.mjs     # desktop's `npm run dist` runs it last
//
// electron-builder's copy filter drops a node_modules folder at the root of a
// copy source, whatever the filter patterns say (see package-hub.mjs). The
// first installer with the hub in it shipped 402 of the server's 2,352 files.
// It built, it passed the key search, it ran from the assembled folder — and,
// packaged, the server died on start with "Cannot find module 'next'", over
// and over. A change to the filter patterns then "fixed" nothing, and only
// this check said so. A folder that runs before packaging proves nothing about
// the copy.
//
// So every file assembled must be in the unpacked app, at the same size.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const assembled = join(root, 'desktop', 'hub-bundle', 'hub')
const shipped = join(root, 'desktop', 'dist', 'win-unpacked', 'resources', 'hub')

function list(dir) {
  const out = new Map()
  const walk = d => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else out.set(relative(dir, p).replace(/\\/g, '/'), s.size)
    }
  }
  walk(dir)
  return out
}

for (const [label, dir] of [['assembled', assembled], ['shipped', shipped]]) {
  if (!existsSync(dir)) {
    console.error(`No ${label} hub server at ${relative(root, dir)}.`)
    process.exit(1)
  }
}

const want = list(assembled)
const got = list(shipped)
const missing = [...want.keys()].filter(f => !got.has(f))
const differ = [...want.keys()].filter(f => got.has(f) && got.get(f) !== want.get(f))

if (missing.length || differ.length) {
  console.error(`\nThe installer's hub server is not the one assembled: ${missing.length} missing, ${differ.length} a different size, of ${want.size}.\n`)
  for (const f of [...missing.slice(0, 10).map(f => `missing  ${f}`), ...differ.slice(0, 5).map(f => `differs  ${f}`)]) console.error(`  ${f}`)
  console.error('\nDo not ship this installer.\n')
  process.exit(1)
}

console.log(`The installer's hub server is whole: ${got.size} of ${want.size} files, every size the same.`)
