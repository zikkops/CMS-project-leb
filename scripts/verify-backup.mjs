// Assertions over the backup codec — shared/src/backupCodec.ts.
//
//   node scripts/verify-backup.mjs
//   npm run verify:backup
//
// Same shape as the other verifiers: transpile the real module and assert
// against it. Nothing is re-implemented.
//
// ── Why a backup needs a test at all ───────────────────────────────────────
// Because a broken one passes every inspection. The file is written, the file
// is large, the file is valid JSON — and the damage is only discovered when
// somebody restores it, which is the single worst moment to find out. Each
// case below is something JSON.stringify does wrong to a Firestore document
// while looking entirely successful.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'backup-verify-'))
execSync(
  `npx tsc shared/src/backupCodec.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const B = await import(`file://${join(out, 'backupCodec.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

// Stand-ins for the Firestore natives. The codec has never heard of them —
// that is the point of classify/revive — so a fake is as good as the real one.
class Stamp {
  constructor(seconds, nanos) { this.seconds = seconds; this.nanos = nanos }
}
class Ref {
  constructor(path) { this.path = path }
}

const classify = v =>
  v instanceof Stamp ? { kind: 'ts', data: { s: v.seconds, n: v.nanos } }
  : v instanceof Ref ? { kind: 'ref', data: { path: v.path } }
  : null

const revive = (kind, data) =>
  kind === 'ts' ? new Stamp(data.s, data.n)
  : kind === 'ref' ? new Ref(data.path)
  : null

const round = value => B.decode(JSON.parse(JSON.stringify(B.encode(value, classify))), revive)

console.log('\na timestamp survives the trip')
{
  const doc = { closedAt: new Stamp(1_757_700_000, 500), name: 'Flat White' }
  const back = round(doc)
  eq('THE TRAP: it comes back as a timestamp, not a map', back.closedAt instanceof Stamp, true)
  eq('...with its seconds', back.closedAt.seconds, 1_757_700_000)
  eq('...and its nanoseconds', back.closedAt.nanos, 500)
  eq('the ordinary fields are untouched', back.name, 'Flat White')

  const nested = round({ shift: { openedAt: new Stamp(1, 2) }, list: [new Stamp(3, 4)] })
  eq('nested in a map', nested.shift.openedAt instanceof Stamp, true)
  eq('nested in an array', nested.list[0] instanceof Stamp, true)
}

console.log('\nnumbers JSON cannot spell')
{
  eq('THE TRAP: NaN does not become null', Number.isNaN(round({ n: Number.NaN }).n), true)
  // String(), not the value: JSON.stringify(Infinity) is "null", so comparing
  // encoded forms would pass even if the codec HAD turned it into null.
  eq('Infinity survives', String(round({ n: Infinity }).n), 'Infinity')
  eq('-Infinity survives', String(round({ n: -Infinity }).n), '-Infinity')
  eq('an ordinary number is left alone', round({ n: 12.75 }).n, 12.75)
  eq('zero is not confused with absent', round({ n: 0 }).n, 0)
}

console.log('\nundefined is not null, and null is not absent')
{
  const back = round({ a: undefined, b: null, c: 1 })
  eq('THE TRAP: an absent field stays absent', 'a' in back, false)
  eq('...and a null field stays null', back.b, null)
  eq('...and the rest is intact', back.c, 1)
  // In an array there is no such thing as an absent slot: a hole would shift
  // every element after it, so it becomes null and the length is preserved.
  eq('a hole in an array becomes null, keeping the positions', round({ a: [1, undefined, 3] }).a, [1, null, 3])
}

console.log('\nreal data is allowed to contain the tag')
{
  // The escape nobody writes until the day an import brings a field called
  // "$fs" — at which point an unescaped codec decodes it as a native and the
  // document comes back mangled.
  const awkward = { $fs: 'not a timestamp', normal: 1 }
  const back = round(awkward)
  // Guarded with ?. deliberately. Without the escape, decode() hands the tag
  // to revive(), which does not know that kind and returns null — so the whole
  // document comes back null and a bare back.$fs would THROW. A suite that
  // dies here reports a stack trace instead of a named failure, and every case
  // after it goes unrun.
  eq('THE TRAP: a literal $fs field is still a field', back?.$fs ?? '(the document came back mangled)', 'not a timestamp')
  eq('...and does not become a native', back?.$fs instanceof Stamp, false)
  eq('an already-escaped-looking key round-trips too', round({ $$fs: 'x' }).$$fs, 'x')
  eq('...and so does a third one', round({ $$$fs: 'x' }).$$$fs, 'x')
  eq('a key merely containing fs is untouched', round({ fsx: 1, 'a$fs': 2 }), { fsx: 1, 'a$fs': 2 })
}

console.log('\nshapes are preserved exactly')
{
  eq('an empty object stays an object', round({ a: {} }).a, {})
  eq('an empty array stays an array', round({ a: [] }).a, [])
  eq('a deep mixture', round({ a: [{ b: [{ c: 'd' }] }] }), { a: [{ b: [{ c: 'd' }] }] })
  eq('a reference comes back a reference', round({ r: new Ref('users/u1') }).r instanceof Ref, true)
  eq('...pointing at the same place', round({ r: new Ref('users/u1') }).r.path, 'users/u1')
}

console.log('\ncomparing a restored document with its backup')
{
  const a = B.encode({ at: new Stamp(1, 2), name: 'x' }, classify)
  const b = B.encode({ name: 'x', at: new Stamp(1, 2) }, classify)
  eq('field order is not a difference', B.sameEncoded(a, b), true)

  const c = B.encode({ at: new Stamp(1, 3), name: 'x' }, classify)
  eq('a different instant IS a difference', B.sameEncoded(a, c), false)
  eq('NaN compares equal to NaN, which JSON.stringify cannot do',
    B.sameEncoded(B.encode({ n: Number.NaN }, classify), B.encode({ n: Number.NaN }, classify)), true)
  eq('a missing field is a difference',
    B.sameEncoded(B.encode({ a: 1, b: 2 }, classify), B.encode({ a: 1 }, classify)), false)
}

console.log('\none document, as a backup line')
{
  const line = B.encodeDoc('check-1', { at: new Stamp(9, 8), total: 12.5 }, classify)
  eq('the id rides alongside the data', line.id, 'check-1')
  const back = B.decodeDoc(JSON.parse(JSON.stringify(line)), revive)
  eq('...and comes back with it', back.id, 'check-1')
  eq('...with the natives rebuilt', back.data.at instanceof Stamp, true)
  eq('...and the plain fields intact', back.data.total, 12.5)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
