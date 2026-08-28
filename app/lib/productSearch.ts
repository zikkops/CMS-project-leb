// Catalogue search.
//
// The shop loads its whole collection client-side (one `getDocs`, no paged
// query), so search runs in memory over an array that's already there. That's
// what makes a real ranked search affordable here — there's no per-keystroke
// round trip to pay for, and no index to maintain.
//
// ── Why not just `name.includes(query)` ───────────────────────────────────
// That's what this replaced, and it fails in the three ways people actually
// type. It can't match two words in either order ("wooden puzzle" vs "puzzle,
// wooden"), it can't match a word in the middle of a description, and it has
// no notion of a better or worse hit — so a product whose description happens
// to contain "card" outranks nothing and sorts alphabetically next to an exact
// title match.
//
// ── The model ─────────────────────────────────────────────────────────────
// Split the query into terms. EVERY term has to match SOMEWHERE on a product
// (AND, not OR) — typing more words must narrow the results, which is the one
// behaviour people rely on without thinking about it. A term's score is its
// best match across the fields, and the product's score is the sum over terms,
// so matching two terms strongly beats matching one term perfectly.
//
// No stemming, no fuzzy/edit-distance matching, no synonyms. Prefix matching
// covers most of what stemming would ("puzzle" finds "puzzles") without the
// false positives, and fuzzy matching on a catalogue this size mostly produces
// confident wrong answers. If a tenant ever needs typo tolerance, that's the
// point to reach for a real index rather than to bolt a distance function on
// here.

/** The shape search needs. Anything with these fields can be searched. */
export interface Searchable {
  name: string
  category: string
  description: string
}

// A title hit means far more than a description hit — a product literally
// called "Chess Set" should beat one whose blurb mentions chess in passing.
const FIELD_WEIGHT = {
  name: 10,
  category: 4,
  description: 1,
} as const

// How well a single term matched within one field, as a multiplier on that
// field's weight. Ordered strongest first; the first hit wins.
const EXACT_WORD = 3   // the term IS one of the field's words
const WORD_START = 2   // a word in the field starts with the term
const ANYWHERE   = 1   // the term appears somewhere, mid-word

/**
 * Lowercase and split on anything that isn't a letter or digit, so
 * "Ticket-to-Ride", "ticket to ride" and "Ticket To Ride!" all tokenize the
 * same. Accented characters are kept as-is rather than folded — folding
 * without a full Unicode normalization pass creates more surprises than it
 * removes, and the demo catalogue is Latin-script.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Best match strength for one term against one field's text, or 0 for none. */
function termScoreInField(term: string, fieldText: string): number {
  const words = tokenize(fieldText)
  if (words.some(w => w === term)) return EXACT_WORD
  if (words.some(w => w.startsWith(term))) return WORD_START
  if (fieldText.toLowerCase().includes(term)) return ANYWHERE
  return 0
}

/**
 * Score one item. Returns 0 when any term fails to match anywhere, which is
 * what makes the AND semantics fall out of the scoring rather than needing a
 * separate filter pass.
 */
function scoreItem(item: Searchable, terms: string[], rawQuery: string): number {
  let total = 0

  for (const term of terms) {
    const best = Math.max(
      termScoreInField(term, item.name) * FIELD_WEIGHT.name,
      termScoreInField(term, item.category) * FIELD_WEIGHT.category,
      termScoreInField(term, item.description ?? '') * FIELD_WEIGHT.description,
    )
    if (best === 0) return 0    // this term matched nothing — item is out
    total += best
  }

  // Phrase bonuses, applied once rather than per-term. Someone typing
  // "ticket to ride" wants that exact product first, ahead of an item that
  // happens to score well on all three words separately.
  const name = item.name.toLowerCase()
  const phrase = rawQuery.trim().toLowerCase()
  if (phrase.length > 1) {
    if (name.startsWith(phrase)) total += 40
    else if (name.includes(phrase)) total += 25
  }

  return total
}

/**
 * Rank items against a query.
 *
 * An empty query returns everything in the caller's original order — search
 * that isn't being used must not reorder the catalogue, or the default
 * browsing view would silently depend on relevance scores of nothing.
 *
 * Ties break alphabetically so the order is stable between renders and
 * between two products that genuinely matched equally well.
 */
export function searchItems<T extends Searchable>(items: T[], query: string): T[] {
  const terms = tokenize(query)
  if (terms.length === 0) return items

  return items
    .map(item => ({ item, score: scoreItem(item, terms, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .map(entry => entry.item)
}

/**
 * An excerpt of `text` around the first thing `query` matched, so a result
 * shows the reader WHY it matched.
 *
 * Without this, a product that matched on word 40 of its description renders
 * the first ten words — none of them the reason it's in the list — and the
 * result looks like a bug. Falls back to the leading excerpt when the query is
 * empty or matched somewhere other than this text (the name, say).
 *
 * `radius` is in characters either side of the match; the window is then
 * snapped out to whole words so it never cuts mid-word.
 */
export function snippet(text: string, query: string, radius = 60): string {
  if (!text) return ''

  const terms = tokenize(query)
  const lower = text.toLowerCase()

  let at = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }

  const leading = () => (text.length <= radius * 2 ? text : text.slice(0, radius * 2).trimEnd() + '…')
  if (at === -1) return leading()

  let start = Math.max(0, at - radius)
  let end = Math.min(text.length, at + radius)
  if (start > 0) start = text.indexOf(' ', start) + 1 || start
  if (end < text.length) {
    const nextSpace = text.indexOf(' ', end)
    end = nextSpace === -1 ? text.length : nextSpace
  }

  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
}

export interface Segment {
  text: string
  match: boolean
}

/**
 * Split text into matched/unmatched runs so a result can highlight what the
 * query actually hit. Returns a single unmatched segment when there's nothing
 * to highlight, so callers can render the result unconditionally.
 *
 * Matches the same way the scorer does — term prefixes, case-insensitive —
 * so the highlight explains the ranking instead of contradicting it.
 */
export function highlight(text: string, query: string): Segment[] {
  const terms = tokenize(query)
  if (terms.length === 0 || !text) return [{ text, match: false }]

  // One pass over the string, marking every character covered by any term.
  // Doing it per-character rather than with a global regex avoids having to
  // escape user input into a pattern, and merges overlapping term hits for
  // free ("card" and "cards" both matching "cards" yields one run, not two).
  const lower = text.toLowerCase()
  const covered = new Array<boolean>(text.length).fill(false)

  for (const term of terms) {
    let from = 0
    for (;;) {
      const at = lower.indexOf(term, from)
      if (at === -1) break
      for (let i = at; i < at + term.length; i++) covered[i] = true
      from = at + term.length
    }
  }

  const segments: Segment[] = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || covered[i] !== covered[start]) {
      segments.push({ text: text.slice(start, i), match: covered[start] })
      start = i
    }
  }
  return segments
}
