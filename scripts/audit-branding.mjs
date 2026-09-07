// Finds branding that is still hardcoded in the source.
//
// De-branding by hand always misses things — a café name in an email template,
// a phone number in a WhatsApp link, a hex code in one component that never got
// migrated to a CSS variable. This scans for the specific values the fork was
// supposed to leave behind and prints every remaining hit with its file and
// line, so the work is a checklist rather than a memory product.
//
//   node scripts/audit-branding.mjs
//   node scripts/audit-branding.mjs --quiet   # counts only
//
// ── Prose is not a leak ────────────────────────────────────────────────────
// A comment reading "was hardcoded to ['Beirut','Zouk'] — the original café's
// branches — so every count came back undefined" is documentation of a fixed
// bug. It explains why the code looks the way it does. Deleting it to satisfy
// a scanner would make the codebase worse, and for a long time this script
// counted all sixteen such comments as HIGH findings.
//
// The effect was that the audit reported "high 21" and exited non-zero on
// every run, for months, with not one of those hits actionable. A check that
// always fails is a check nobody reads — which is the same failure as a cron
// that never fires, and this repo has had one of those too.
//
// So hits are split. CODE hits are strings that ship. PROSE hits are comments
// and markdown that merely describe the old branding; they are counted and
// shown, and they do not gate.
//
// ── The gate ───────────────────────────────────────────────────────────────
// Exits non-zero when an un-allowed HIGH code hit exists, or when the medium
// and low code count rises above BASELINE. Same shape as audit-client-writes:
// a number that can only go down.
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
    why: 'Move to BRAND.name in shared/src/brand.ts.',
    severity: 'high',
  },
  {
    label: 'Original brand phrase',
    // Separate from the name above: the full phrase appeared in headings where
    // "onboard" alone did not, and it is the form a visitor actually read.
    re: /\bGames\s*&\s*Tales\b/i,
    why: 'Move to BRAND.name in shared/src/brand.ts.',
    severity: 'high',
  },
  {
    label: 'Original branch names',
    // The negative lookbehind spares Asia/Beirut, which is an IANA timezone
    // identifier and the only correct value to write there.
    re: /(?<!Asia\/)\b(Beirut|Zouk|Broummana|Faten|Hamra)\b/,
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

// Code hits that are the correct code, not a leftover. Suppressed by file and
// label, with the reason, because a line number drifts and an unexplained
// suppression is worse than the false positive it hides.
const ALLOWED = [
  {
    file: 'shared/src/brand.ts', label: 'Hardcoded exchange rate',
    why: "envNum('NEXT_PUBLIC_EXCHANGE_RATE', 90000) — this IS the configured " +
         'default the pattern tells you to use. The one place the number belongs.',
  },
  {
    file: 'scripts/seed-demo.mjs', label: 'Hardcoded exchange rate',
    why: 'Same fallback, seeding demo data. Every record still stores its own rateUsed.',
  },
  {
    file: 'scripts/verify-delivery-math.mjs', label: 'Hardcoded exchange rate',
    why: 'A fixture asserting that a stored rateUsed is honoured. The literal is the point of the test.',
  },
  {
    file: 'docs/env-local.template.txt', label: 'Hardcoded exchange rate',
    why: 'The template that tells you what to set. Naming the value is its job.',
  },
]

const allowedFor = (file, label) => ALLOWED.find(a => a.file === file && a.label === label)

// Above which the medium/low code count may not rise. Lower it as hex codes
// move to CSS variables; never raise it to make a run pass.
const BASELINE = 298

// Which of a file's lines are prose rather than shipped code, as a parallel
// array. Imperfect on purpose: a branded string sharing a line with a trailing
// comment counts as code, which errs the safe way.
function proseLines(rel, lines) {
  // Markdown and plain text are documentation throughout.
  if (/\.(md|txt)$/.test(rel)) return lines.map(() => true)

  // Block state has to be tracked, not guessed per line. A wrapped comment's
  // second line starts with neither `//` nor `/*`, and the first version of
  // this check therefore read the middle of its own explanation as shipped
  // code — the audit's last remaining HIGH hit was a comment about a phone
  // number, in the commit that removed the phone number.
  let inBlock = false
  return lines.map(raw => {
    const t = raw.trim()
    if (inBlock) {
      if (t.includes('*/')) inBlock = false
      return true
    }
    if (t.startsWith('//') || t.startsWith('#')) return true
    // `{/*` is the JSX form and the one component explanations use.
    if (t.startsWith('/*') || t.startsWith('{/*')) {
      if (!t.includes('*/')) inBlock = true
      return true
    }
    return false
  })
}

// A branded string written as `Games &amp; Tales` is invisible to a regex for
// `Games & Tales`, and that is exactly how headings survived a de-branding
// pass while this script reported clean. Every pattern is therefore tested
// against the raw line AND against a decoded copy, so an HTML entity can never
// be a hiding place.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
}

function decodeEntities(text) {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

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
  const prose = proseLines(rel, lines)

  for (const { label, re } of PATTERNS) {
    lines.forEach((text, i) => {
      if (!re.test(text) && !re.test(decodeEntities(text))) return
      if (!hits.has(label)) hits.set(label, [])
      hits.get(label).push({
        file: rel, line: i + 1, text: text.trim().slice(0, 110),
        prose: prose[i], allowed: !!allowedFor(rel, label),
      })
    })
  }
}

let proseTotal = 0, allowedTotal = 0
const bySeverity = { high: 0, medium: 0, low: 0 }

for (const pattern of PATTERNS) {
  const all = hits.get(pattern.label) ?? []
  proseTotal += all.filter(h => h.prose).length
  allowedTotal += all.filter(h => !h.prose && h.allowed).length

  const found = all.filter(h => !h.prose && !h.allowed)
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

const mediumLow = bySeverity.medium + bySeverity.low

console.log(`\n${'─'.repeat(64)}`)
console.log(`In code:  high ${bySeverity.high} · medium ${bySeverity.medium} · low ${bySeverity.low}`)
console.log(`Not counted:  ${proseTotal} in comments and docs, ${allowedTotal} allowed by name.`)
console.log('  Prose describes the old branding rather than shipping it — see the top of this file.')

// Two different failures, said differently, because they need different work.
const failures = []
if (bySeverity.high > 0) {
  failures.push(`${bySeverity.high} HIGH hit(s) in code — a visitor or customer would see these.`)
}
if (mediumLow > BASELINE) {
  failures.push(
    `medium+low is ${mediumLow}, above the baseline of ${BASELINE}. ` +
    'Something branded was added. Fix it rather than raising the number.')
}

if (failures.length > 0) {
  console.log('')
  for (const f of failures) console.log(`  FAIL  ${f}`)
  process.exit(1)
}

if (bySeverity.high === 0 && mediumLow === 0) {
  console.log('\nNothing branded left in code.')
} else {
  console.log(`\nOK — no high hits, and medium+low (${mediumLow}) is at or under the baseline of ${BASELINE}.`)
  console.log('Lower BASELINE as hex codes move to CSS variables.')
}
process.exit(0)
