// ESC/POS for a network thermal printer — POS software (owner's decision S28,
// 15 Sep 2026).
//
// The printers are not chosen yet, so this is the command set nearly every
// thermal receipt printer accepts on port 9100: initialise, the PC437 code page,
// the text, feed, cut. The text is already laid out to the roll's columns by
// receiptToText(); this only turns it into bytes.
//
// ── Why the text is made ASCII ─────────────────────────────────────────────
// A printer prints bytes in its code page, and the layouts count characters.
// "·" or "—" sent as UTF-8 is two or three bytes of rubbish and pushes every
// column after it out of line. So a handful of known characters become their
// nearest ASCII, accents lose their marks, and anything else becomes "?",
// one character for one, so the columns still line up.
//
// Pure, asserted by verify:printing.

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** The most copies one job prints, as the printer settings allow. */
export const MAX_JOB_COPIES = 5

const NEAREST: Record<string, string> = {
  '·': '.', '•': '*', '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"',
  '…': '.', '×': 'x', '°': 'o', '€': 'E', '£': 'L', '\u00a0': ' ',
}

/** The text as the printer should get it: one ASCII character for each character, newlines only. */
export function printableAscii(text: string): string {
  let out = ''
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    if (ch === '\n' || (ch >= ' ' && ch <= '~')) { out += ch; continue }
    if (NEAREST[ch]) { out += NEAREST[ch]; continue }
    const plain = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    out += plain.length === 1 && plain >= ' ' && plain <= '~' ? plain : (ch < ' ' ? '' : '?')
  }
  return out
}

/**
 * The bytes for one print job: each copy initialised, in PC437, fed clear of
 * the cutter and partly cut, so the copies tear apart.
 */
export function escposJob(text: string, copies = 1): Uint8Array {
  const body = printableAscii(text)
  const count = Number.isInteger(copies) ? Math.min(MAX_JOB_COPIES, Math.max(1, copies)) : 1
  const one: number[] = [ESC, 0x40, ESC, 0x74, 0x00]
  for (let i = 0; i < body.length; i++) one.push(body.charCodeAt(i))
  if (!body.endsWith('\n')) one.push(LF)
  // Feed four lines past the print head, then a partial cut.
  one.push(ESC, 0x64, 0x04, GS, 0x56, 0x42, 0x00)
  const out = new Uint8Array(one.length * count)
  for (let c = 0; c < count; c++) out.set(one, c * one.length)
  return out
}
