// One .env.local at the repo root, read by every app.
//
// Next loads .env files from the directory it runs in, which after the split
// is apps/web, apps/admin or apps/pos — none of which has one. Three copies of
// a file holding a service-account key is three chances to update two of them,
// so the root file stays the only one and each app's next.config.ts calls this
// before Next reads its configuration.
//
// Timing matters: NEXT_PUBLIC_* values are inlined into the client bundle at
// compile time, so they have to be in process.env before compilation starts.
// next.config is evaluated first, which is why this belongs there and not in
// instrumentation or a layout.
//
// Deliberately no dotenv dependency — the format this project actually uses is
// KEY=value with the occasional quoted value, and a 20-line parser that is
// obvious beats a dependency in the build path of three apps.
//
// Existing values are never overwritten. A real environment variable set by
// the host (Hostinger's panel, a CI secret) has to win over a file that may be
// a developer's local copy.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * Reads the root .env.local (and .env, if present) into process.env.
 *
 * @param {string[]} [files] override, mostly for tests
 * @returns {{ file: string, loaded: number }[]} what was read, for logging
 */
export function loadRootEnv(files = ['.env.local', '.env']) {
  const report = []

  for (const name of files) {
    const path = resolve(join(ROOT, name))
    if (!existsSync(path)) continue

    let loaded = 0
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      // Comments and blanks. A '#' inside a value is NOT a comment — an API
      // key or a password may legitimately contain one.
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const eq = trimmed.indexOf('=')
      if (eq === -1) continue

      const key = trimmed.slice(0, eq).trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
      if (key in process.env) continue

      let value = trimmed.slice(eq + 1).trim()
      // Strip one matching pair of surrounding quotes, and only a matching
      // pair — a value that merely starts with a quote keeps it.
      if (value.length > 1 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
           (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
      loaded++
    }
    report.push({ file: name, loaded })
  }

  return report
}
