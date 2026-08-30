// Assertions over the hostname routing in packages/shared/src/hosts.ts.
//
// Same shape as verify-delivery-math.mjs and for the same reason: no test
// runner in this repo yet, so this transpiles the real module with the
// project's own TypeScript and asserts against it. Nothing is re-implemented —
// a bug in the shipped code fails here.
//
//   node scripts/verify-hosts.mjs
//
// Worth having because the failure mode is asymmetric. Getting this wrong in
// one direction serves the admin panel on the customer domain, which is the
// thing it exists to prevent. Getting it wrong in the other locks every staff
// member out of a live café, and the person who finds out is a manager at
// 7am with no way back in.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// hosts.ts imports nothing at all — no React, no Firebase, no other module —
// so it transpiles and runs standalone. That is deliberate: proxy.ts runs on
// the edge and these have to be reasonable about without a request.
const out = mkdtempSync(join(tmpdir(), 'hosts-verify-'))
execSync(
  `npx tsc packages/shared/src/hosts.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' }
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const { hostConfigFromEnv, classifySurface, isPathAllowed, rootRedirectFor, shouldNoIndex } =
  await import(`file://${join(out, 'hosts.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const NONE = { admin: null, pos: null }
const BOTH = { admin: 'admin.cafe.test', pos: 'pos.cafe.test' }
const ADMIN_ONLY = { admin: 'admin.cafe.test', pos: null }

console.log('\nhostConfigFromEnv — tolerant of how a hostname gets pasted in')
eq('bare hostname', hostConfigFromEnv({ ADMIN_HOST: 'admin.cafe.test' }).admin, 'admin.cafe.test')
eq('with scheme', hostConfigFromEnv({ ADMIN_HOST: 'https://admin.cafe.test' }).admin, 'admin.cafe.test')
eq('with trailing path', hostConfigFromEnv({ ADMIN_HOST: 'https://admin.cafe.test/' }).admin, 'admin.cafe.test')
eq('upper case', hostConfigFromEnv({ ADMIN_HOST: 'Admin.Cafe.Test' }).admin, 'admin.cafe.test')
eq('whitespace only is unset', hostConfigFromEnv({ ADMIN_HOST: '  ' }).admin, null)
eq('absent is unset', hostConfigFromEnv({}).admin, null)

console.log('\nclassifySurface')
eq('admin hostname', classifySurface('admin.cafe.test', BOTH), 'admin')
eq('pos hostname', classifySurface('pos.cafe.test', BOTH), 'pos')
eq('customer hostname', classifySurface('cafe.test', BOTH), 'public')
// A Host header carries the port in development and behind some proxies.
eq('port is ignored', classifySurface('admin.cafe.test:3000', BOTH), 'admin')
eq('case is ignored', classifySurface('ADMIN.cafe.test', BOTH), 'admin')
eq('unknown hostname is public', classifySurface('whatever.test', BOTH), 'public')
eq('empty host is public', classifySurface('', BOTH), 'public')
// The important one: with nothing configured, nothing is special.
eq('unconfigured: admin hostname is still public', classifySurface('admin.cafe.test', NONE), 'public')

console.log('\nisPathAllowed — INERT until configured')
// This block is the safety property. Break it and a deployment with no
// hostnames set stops serving its own admin panel.
for (const p of ['/', '/menu', '/admin', '/admin/users', '/pos', '/pos/floor']) {
  eq(`unconfigured allows ${p}`, isPathAllowed(p, 'public', NONE), true)
}

console.log('\nisPathAllowed — admin surface')
eq('/admin allowed', isPathAllowed('/admin', 'admin', BOTH), true)
eq('/admin/users allowed', isPathAllowed('/admin/users', 'admin', BOTH), true)
eq('/admin/login allowed', isPathAllowed('/admin/login', 'admin', BOTH), true)
eq('/menu refused', isPathAllowed('/menu', 'admin', BOTH), false)
eq('/ refused (redirected before this)', isPathAllowed('/', 'admin', BOTH), false)
eq('/pos refused', isPathAllowed('/pos', 'admin', BOTH), false)
// A path that merely starts with the same letters is a different path.
eq('/administrator is NOT /admin', isPathAllowed('/administrator', 'admin', BOTH), false)

console.log('\nisPathAllowed — pos surface')
eq('/pos allowed', isPathAllowed('/pos', 'pos', BOTH), true)
eq('/pos/floor allowed', isPathAllowed('/pos/floor', 'pos', BOTH), true)
// Until the POS has a sign-in of its own, staff authenticate through the
// existing page. Refusing it here would be a locked door with no handle.
eq('/admin/login allowed', isPathAllowed('/admin/login', 'pos', BOTH), true)
eq('/admin/users refused', isPathAllowed('/admin/users', 'pos', BOTH), false)
eq('/menu refused', isPathAllowed('/menu', 'pos', BOTH), false)

console.log('\nisPathAllowed — customer surface, once a surface has moved out')
eq('/menu allowed', isPathAllowed('/menu', 'public', BOTH), true)
eq('/ allowed', isPathAllowed('/', 'public', BOTH), true)
eq('/admin refused', isPathAllowed('/admin', 'public', BOTH), false)
eq('/admin/login refused', isPathAllowed('/admin/login', 'public', BOTH), false)
eq('/pos refused', isPathAllowed('/pos', 'public', BOTH), false)

console.log('\nisPathAllowed — only ONE surface configured')
// Half-configured must not strand the other half. POS_HOST unset means the
// POS has nowhere else to be, so it stays on the customer host.
eq('/admin refused (it moved)', isPathAllowed('/admin', 'public', ADMIN_ONLY), false)
eq('/pos still allowed (it did not)', isPathAllowed('/pos', 'public', ADMIN_ONLY), true)

console.log('\nisPathAllowed — assets reachable everywhere')
// Getting this wrong does not 404 a page; it serves a page with no CSS.
for (const surface of ['public', 'admin', 'pos']) {
  eq(`${surface}: /_next/static/chunk.js`, isPathAllowed('/_next/static/chunk.js', surface, BOTH), true)
  eq(`${surface}: /api/admin/menu`, isPathAllowed('/api/admin/menu', surface, BOTH), true)
  eq(`${surface}: /favicon.ico`, isPathAllowed('/favicon.ico', surface, BOTH), true)
}

console.log('\nrootRedirectFor / shouldNoIndex')
eq('admin root → /admin', rootRedirectFor('admin'), '/admin')
eq('pos root → /pos', rootRedirectFor('pos'), '/pos')
eq('public root unchanged', rootRedirectFor('public'), null)
eq('admin noindex', shouldNoIndex('admin'), true)
eq('pos noindex', shouldNoIndex('pos'), true)
eq('public indexed', shouldNoIndex('public'), false)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
