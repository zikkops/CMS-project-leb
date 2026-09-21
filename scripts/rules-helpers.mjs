// The section helpers in firestore.rules, generated from SECTIONS (UPGRADE.md T5.10).
//
// The role arrays in firestore.rules used to be written by hand, and
// verify:sections could only notice when one drifted. Now the block between
// the markers is written from roles.ts, so a rule and the page that writes
// through it cannot disagree about who is allowed.
//
// A helper is generated only for a section the rules actually CALL (a
// `canX()` outside the block). A defined-but-uncalled function in a security
// file reads as though something enforces it, and the rules compiler warns
// about it on every deploy. So removing the last call removes the helper, and
// a new call to a section's helper makes it appear.
//
// Writing the file is not deploying it. A rules deploy is its own approved
// step, one collection at a time (CLAUDE.md, Firestore rules).
//
// Pure: generateRulesBlock() takes the rules text and the section roles and
// returns the new text. scripts/generate-rules.mjs writes it; verify:sections
// fails when the file is not what this would write.

export const BEGIN = '    // BEGIN GENERATED section helpers: npm run rules:generate writes this from SECTIONS in shared/src/roles.ts. Do not edit by hand.'
export const END = '    // END GENERATED section helpers'

/** "dailyInventory" -> "canDailyInventory" */
export const helperName = key => `can${key[0].toUpperCase()}${key.slice(1)}`

/**
 * The rules text with the generated block rewritten.
 * @param {string} rules the whole firestore.rules
 * @param {Record<string, readonly string[]>} sectionAccess SECTION_ACCESS, in SECTIONS order
 */
export function generateRulesBlock(rules, sectionAccess) {
  const nl = rules.includes('\r\n') ? '\r\n' : '\n'
  const start = rules.indexOf(BEGIN)
  const endAt = rules.indexOf(END)
  if (start === -1 || endAt === -1 || endAt < start) throw new Error('firestore.rules has no generated block between the markers')
  const before = rules.slice(0, start)
  const after = rules.slice(endAt + END.length)
  // Calls only: a comment saying a helper "was here" is not a call.
  const outside = (before + after).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const keys = Object.keys(sectionAccess).filter(key => new RegExp(`\\b${helperName(key)}\\(\\)`).test(outside))
  const width = Math.max(0, ...keys.map(k => helperName(k).length + 2))
  const keyWidth = Math.max(0, ...keys.map(k => k.length + 3))
  const lines = keys.map(key => {
    const roles = sectionAccess[key].map(r => `'${r}'`).join(', ')
    return `    function ${`${helperName(key)}()`.padEnd(width)} { return can(${`'${key}',`.padEnd(keyWidth)} [${roles}]); }`
  })
  return before + [BEGIN, ...lines, END].join(nl) + after
}
