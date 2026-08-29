// Finds branding that is still hardcoded in the source.
//
// De-branding by hand always misses things — a café name in an email template,
// a phone number in a WhatsApp link, a hex code in one component that never got
// migrated to a CSS variable. This scans for the specific values the fork was
// supposed to leave behind and prints every remaining hit with its file and
// line, so the work is a checklist rather than a memory game.
//
//   node scripts/audit-branding.mjs
//   node scripts/audit-branding.mjs --quiet   # counts only
//
// Exits non-zero while anything remains, so it can gate a release later.
//
// Add a pattern here whenever you find something this missed. The point is
// that the next person doesn't have to rediscover it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const QUIET = process.argv.includes('--quiet')

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'out', 'build', '.vercel', 'coverage',
  // Worktrees are separate checkouts of this same repo. Their hits are
  // duplicates of the working tree's and cannot be fixed from here.
  '.claude',
])

// This script names the very things it's looking for, so it would report
// itself on every run. Same for the docs that explain the fork.
const SKIP_FILES = new Set([
  'scripts/audit-branding.mjs',
  'FORK.md',
])

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.json', '.md', '.html', '.txt']

const PATTERNS = [
  {
    label: 'Original brand name',
    re: /\bonboard\b(?!\s+App\b)/i,
    why: 'Move to BRAND.name in app/lib/brand.ts.',
    severity: 'high',
  },
  {
    label: 'Original branch names',
    re: /\b(Beirut|Zouk|Broummana|Faten|Hamra)\b/,
    why: 'Move to BRAND.branches / BRAND.stockedBranches.',
    severity: 'high',
  },
  {
    label: 'Original brand palette',
    re: /#(00A098|E43329|6A6AB7|32327C|C9962C|8B7CF6|F5F2EC|E8965A|8B6914)\b/i,
    why: 'Use var(--brand-primary) and friends; configure in brand.ts.',
    severity: 'medium',
  },
  {
    label: 'Original font families',
    re: /\b(Cinzel|Bree_Serif|Bree Serif)\b/,
    why: 'Fonts load in app/layout.tsx only — a face elsewhere is a leftover.',
    severity: 'medium',
  },
  {
    label: 'Hardcoded exchange rate',
    re: /\b90[,_]?000\b/,
    why: 'Use BRAND.locale.exchangeRate as a default; store rateUsed per record.',
    severity: 'high',
  },
  {
    label: 'Hardcoded VAT or tips rate',
    re: /\b0\.11\b|\b11\s*%/,
    why: 'Use BRAND.locale.vatRate / BRAND.tipsDeductionRate.',
    severity: 'medium',
  },
  {
    label: 'Live domain reference',
    re: /onboardlb\.com|onboardlb\.vercel\.app/i,
    why: 'A demo must never link to the live site.',
    severity: 'high',
  },
  {
    label: 'Hardcoded phone or WhatsApp number',
    re: /wa\.me\/\d|\+961\s?\d/,
    why: 'Use BRAND.contact.whatsapp / BRAND.contact.phone.',
    severity: 'high',
  },
  {
    label: 'Hardcoded email address',
    // Deliberately ignores the placeholder domains this fork uses on purpose.
    re: /[\w.+-]+@(?!example\.com|placeholder)[\w-]+\.[\w.]+/,
    why: 'Use BRAND.contact.email.',
    severity: 'medium',
  },
  {
    label: 'Third-party account reference',
    re: /\bomega\b/i,
    why: 'The incumbent POS. Should not appear in a generic product.',
    severity: 'low',
  },
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (SKIP_DIRS.has(entry)) continue
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (EXTENSIONS.some(e => entry.endsWith(e))) out.push(full)
  }
  return out
}

const files = walk(ROOT)
const hits = new Map()   // label -> [{file, line, text}]

for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/')
  if (SKIP_FILES.has(rel)) continue

  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }
  const lines = content.split('\n')

  for (const { label, re } of PATTERNS) {
    lines.forEach((text, i) => {
      if (!re.test(text)) return
      if (!hits.has(label)) hits.set(label, [])
      hits.get(label).push({ file: rel, line: i + 1, text: text.trim().slice(0, 110) })
    })
  }
}

let total = 0
const bySeverity = { high: 0, medium: 0, low: 0 }

for (const pattern of PATTERNS) {
  const found = hits.get(pattern.label) ?? []
  total += found.length
  bySeverity[pattern.severity] += found.length
  if (found.length === 0) continue

  console.log(`\n${pattern.severity.toUpperCase()}  ${pattern.label} — ${found.length} hit(s)`)
  console.log(`  ${pattern.why}`)
  if (!QUIET) {
    // Group by file so a page with thirty colour references reads as one item
    // of work rather than thirty.
    const byFile = new Map()
    for (const h of found) {
      if (!byFile.has(h.file)) byFile.set(h.file, [])
      byFile.get(h.file).push(h)
    }
    for (const [file, list] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${file}  (${list.length})`)
      for (const h of list.slice(0, 3)) console.log(`      ${h.line}: ${h.text}`)
      if (list.length > 3) console.log(`      … ${list.length - 3} more`)
    }
  }
}

console.log(`\n${'─'.repeat(64)}`)
console.log(`${total} remaining  ·  high ${bySeverity.high} · medium ${bySeverity.medium} · low ${bySeverity.low}`)
if (total === 0) console.log('Nothing branded left in source.')
else console.log('Work top-down: high first — those are the ones a visitor or a customer would see.')

process.exit(total > 0 ? 1 : 0)
