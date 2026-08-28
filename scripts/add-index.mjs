// Turn a Firestore "this query requires an index" error into a repo change.
//
//   node scripts/add-index.mjs "<the console URL from the error>"     # preview
//   node scripts/add-index.mjs "<url>" --apply                        # write it
//
// Accepts the whole URL, or just the create_composite=... value.
//
// ── Why not just click the link ───────────────────────────────────────────
// Clicking works, and it targets the right project — the project id is baked
// into the URL, so it can't land in the wrong one. What it does NOT do is
// write anything to this repo.
//
// That matters once firestore.indexes.json exists. `firebase deploy --only
// firestore:indexes` treats that file as the complete intended set, so an
// index that exists in the project but not in the file shows up as one to
// DELETE. Click enough links and the next deploy offers to undo them.
//
// It's also per-project. A fresh project — staging, a new tenant, a rebuilt
// demo — starts with no indexes, and clicking rediscovers each one by breaking
// a page first. This script puts the index in git, where a deploy can install
// it everywhere without anything breaking to find it.
//
// ── The encoding ──────────────────────────────────────────────────────────
// `create_composite` is base64url of a serialised protobuf. Enough of it to
// read, verified against a real error URL:
//
//   0a <len> <string>   field 1: ".../collectionGroups/<COLLECTION>/indexes/_"
//   10 01               field 2: queryScope, 1 = COLLECTION
//   1a <len> {...}      field 3, repeated: one IndexField, containing
//        0a <len> <str>   field 1: the field path
//        10 01 | 10 02    field 2: order, 1 = ASCENDING, 2 = DESCENDING
//        18 01            field 3: arrayConfig, 1 = CONTAINS (array-contains)
//
// Only these tags are read. Anything else is skipped by length rather than
// guessed at, so an unrecognised field can't silently corrupt the output.

import { readFileSync, writeFileSync } from 'node:fs'

const INDEX_FILE = 'firestore.indexes.json'
const APPLY = process.argv.includes('--apply')
const input = process.argv.slice(2).find(a => !a.startsWith('--'))

if (!input) {
  console.error('Usage: node scripts/add-index.mjs "<error URL>" [--apply]')
  process.exit(1)
}

// ── Minimal protobuf reader ────────────────────────────────────────────────

function reader(buf) {
  let i = 0
  return {
    done: () => i >= buf.length,
    varint() {
      let result = 0, shift = 0
      for (;;) {
        const b = buf[i++]
        result |= (b & 0x7f) << shift
        if ((b & 0x80) === 0) return result
        shift += 7
      }
    },
    bytes() {
      const len = this.varint()
      const out = buf.subarray(i, i + len)
      i += len
      return out
    },
    skip(wire) {
      if (wire === 0) this.varint()
      else if (wire === 2) this.bytes()
      else if (wire === 5) i += 4
      else if (wire === 1) i += 8
      else throw new Error(`unsupported wire type ${wire}`)
    },
  }
}

function decodeField(buf) {
  const r = reader(buf)
  const out = {}
  while (!r.done()) {
    const key = r.varint()
    const [field, wire] = [key >> 3, key & 7]
    if (field === 1 && wire === 2) out.fieldPath = r.bytes().toString('utf8')
    else if (field === 2 && wire === 0) out.order = r.varint() === 2 ? 'DESCENDING' : 'ASCENDING'
    else if (field === 3 && wire === 0) { r.varint(); out.arrayConfig = 'CONTAINS' }
    else r.skip(wire)
  }
  return out
}

function decode(b64) {
  const buf = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const r = reader(buf)
  let name = '', scope = 'COLLECTION'
  const fields = []

  while (!r.done()) {
    const key = r.varint()
    const [field, wire] = [key >> 3, key & 7]
    if (field === 1 && wire === 2) name = r.bytes().toString('utf8')
    else if (field === 2 && wire === 0) scope = r.varint() === 2 ? 'COLLECTION_GROUP' : 'COLLECTION'
    else if (field === 3 && wire === 2) fields.push(decodeField(r.bytes()))
    else r.skip(wire)
  }

  const collectionGroup = (name.match(/collectionGroups\/([^/]+)/) || [])[1]
  if (!collectionGroup) throw new Error('could not read the collection out of the payload')
  const project = (name.match(/projects\/([^/]+)/) || [])[1] ?? '(unknown)'

  return {
    project,
    index: {
      collectionGroup,
      queryScope: scope,
      // __name__ is appended by Firestore itself and is rejected as an
      // explicit entry in firestore.indexes.json.
      fields: fields.filter(f => f.fieldPath !== '__name__'),
    },
  }
}

// ── Run ────────────────────────────────────────────────────────────────────

const b64 = (input.match(/create_composite=([^&\s]+)/) || [, input.trim()])[1]

let decoded
try {
  decoded = decode(b64)
} catch (err) {
  console.error(`Could not decode that. ${err.message}`)
  console.error('Pass the whole URL from the error, in quotes.')
  process.exit(1)
}

const { project, index } = decoded
const shape = i =>
  `${i.collectionGroup}(${i.fields.map(f => `${f.fieldPath} ${f.arrayConfig ?? f.order}`).join(', ')})`

console.log(`Project:  ${project}`)
console.log(`Index:    ${shape(index)}\n`)

const file = JSON.parse(readFileSync(INDEX_FILE, 'utf8'))
const already = file.indexes.find(
  i => i.collectionGroup === index.collectionGroup && shape(i) === shape(index)
)

if (already) {
  console.log(`Already in ${INDEX_FILE} — nothing to do.`)
  console.log('If the query is still failing, the index is probably still building.')
  process.exit(0)
}

console.log(JSON.stringify(index, null, 2))

if (!APPLY) {
  console.log(`\nPreview only. Re-run with --apply to add it to ${INDEX_FILE}.`)
  process.exit(0)
}

file.indexes.push(index)
writeFileSync(INDEX_FILE, JSON.stringify(file, null, 2) + '\n')

console.log(`\nAdded to ${INDEX_FILE} (${file.indexes.length} total).`)
console.log('\nDeploy it with:')
console.log(`  npx firebase deploy --only firestore:indexes --project ${project}`)
console.log('\nNaming the project is deliberate — there is no .firebaserc, and')
console.log('the live café project is in the same account.')
