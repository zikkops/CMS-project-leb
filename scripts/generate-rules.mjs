// Writes the section helpers in firestore.rules from SECTIONS (UPGRADE.md T5.10).
//
//   npm run rules:generate            rewrite the block, and say what changed
//   npm run rules:generate -- --check exit 1 if the file is not up to date
//
// It only writes the file. Deploying rules stays a deliberate, approved
// `firebase deploy --only firestore:rules`; `npm run rules:live` compares.

import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { generateRulesBlock } from './rules-helpers.mjs'

const root = process.cwd()
const cache = join(root, 'node_modules', '.cache')
mkdirSync(cache, { recursive: true })
const out = mkdtempSync(join(cache, 'rules-generate-'))
execSync(`npx tsc shared/src/roles.ts --outDir ${out} --module esnext --target es2022 --skipLibCheck --strict`, { stdio: 'pipe' })
const { SECTION_ACCESS } = await import(`file://${join(out, 'roles.js')}`)
rmSync(out, { recursive: true, force: true })

const file = join(root, 'firestore.rules')
const rules = readFileSync(file, 'utf8')
const next = generateRulesBlock(rules, SECTION_ACCESS)

if (process.argv.includes('--check')) {
  if (next !== rules) {
    console.error('firestore.rules is not what SECTIONS would write. Run: npm run rules:generate')
    process.exit(1)
  }
  console.log('firestore.rules section helpers match SECTIONS.')
} else if (next === rules) {
  console.log('firestore.rules section helpers already match SECTIONS. Nothing written.')
} else {
  writeFileSync(file, next)
  console.log('firestore.rules section helpers rewritten from SECTIONS. Not deployed: that is `firebase deploy --only firestore:rules`, with approval.')
}
