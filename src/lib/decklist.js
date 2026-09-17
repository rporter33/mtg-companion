// Plain text is the only decklist interchange format every site agrees on, so
// it is the one this app reads and writes. This parser lives in lib rather than
// beside the component because it is pure, it is the part most likely to be
// wrong about a real export, and both the app and the offline tooling need it.

/** Trailing "(SET) 123" or "[SET]" is printing metadata, not part of the name. */
function stripPrinting(name) {
  return name
    .replace(/\s*\([^)]*\)\s*\d*\s*$/, '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .trim()
}

/**
 * Could this line be a bare card name?
 *
 * Deliberately conservative, because this only ever runs as a last resort and a
 * false positive becomes a card the user did not ask for. Prose gives itself
 * away by length and by ending in sentence punctuation; card names do neither.
 */
function looksLikeBareName(line) {
  if (line.length < 2 || line.length > 80) return false
  if (!/[a-z]/i.test(line)) return false
  if (/[.!?]$/.test(line)) return false
  if (/https?:\/\//i.test(line)) return false
  return line.split(/\s+/).length <= 12
}

/**
 * Parses the loose decklist formats that sites actually emit:
 * "4 Lightning Bolt", "4x Lightning Bolt", "4 Lightning Bolt (2X2) 117",
 * with optional section headers.
 *
 * Some pages present a singleton deck as bare names with no quantities at all.
 * Those are handled by a fallback that fires ONLY when the normal pass found
 * nothing — so no input that parses today can change meaning because of it,
 * and the alternative for those pages is the dead end of "no cards found".
 */
export function parseDecklist(text) {
  const out = []
  const bare = []
  let section = 'main'

  // A file saved by PowerShell, Notepad or Excel often starts with a UTF-8
  // byte order mark. Left alone it fuses to the first card name and that line
  // silently fails to resolve, which is the worst kind of import bug: quiet,
  // and only on one platform.
  for (const raw of String(text ?? '').replace(/^﻿/, '').split('\n')) {
    const line = raw.trim()
    if (!line) {
      // A commander section holds one or two cards and is followed by a blank
      // line. Plenty of real exports then list the rest of the deck with no
      // "Deck" header at all, and without this the whole deck lands in the
      // command zone. Only the commander section ends this way: a blank line
      // between categories inside the maindeck must stay meaningless.
      if (section === 'commander' && out.some((entry) => entry.section === 'commander')) {
        section = 'main'
      }
      continue
    }
    if (line.startsWith('//') || line.startsWith('#')) continue

    const header = line.toLowerCase().replace(/[:\s]+$/, '')
    if (['sideboard', 'sb'].includes(header)) { section = 'sideboard'; continue }
    if (['commander', 'commanders'].includes(header)) { section = 'commander'; continue }
    if (['deck', 'maindeck', 'main', 'mainboard'].includes(header)) { section = 'main'; continue }

    const match = line.match(/^(\d+)\s*[xX]?\s+(.+)$/)
    if (!match) {
      // Split cards are written "Fire // Ice"; Scryfall's fuzzy search wants
      // the full name, so leave the separator alone.
      if (looksLikeBareName(line)) {
        const name = stripPrinting(line)
        if (name) bare.push({ quantity: 1, name, section })
      }
      continue
    }

    const name = stripPrinting(match[2])
    if (!name) continue
    out.push({ quantity: Number(match[1]), name, section })
  }

  // Ten is high enough that a stray line or a short paragraph cannot trip it,
  // and far below any real deck.
  if (out.length === 0 && bare.length >= 10) return bare
  return out
}
