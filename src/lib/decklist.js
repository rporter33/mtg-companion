// Plain text is the only decklist interchange format every site agrees on, so
// it is the one this app reads and writes. This parser lives in lib rather than
// beside the component because it is pure, it is the part most likely to be
// wrong about a real export, and both the app and the offline tooling need it.

/**
 * Archidekt writes a card's categories in trailing brackets, comma separated,
 * with modifiers in braces: "[Commander{top}]", "[Ramp,Removal]",
 * "[Maybeboard{noDeck}]". Its default categories are just the card's type,
 * which the app already derives, so only a name a person chose survives as a
 * section of their own.
 */
const ARCHIDEKT_DEFAULTS = new Set([
  'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land',
  'planeswalker', 'battle', 'kindred', 'tribal', 'commander', 'sideboard', 'maybeboard',
])

const SET_CODE = /^[a-z0-9]{2,6}$/i
const COLLECTOR = /^(?:\d[\w★†]*|A-\d+)$/

/**
 * Everything a site appends after a card name — printing, foil marker,
 * categories — in whatever order it appends them.
 *
 * The old version took a trailing "(SET) 123" and, separately, a trailing
 * "[SET]", once each and only at the very end. Archidekt writes
 * "Name (soc) 180 [Creature]", so the printing was never at the end, every
 * name kept its set code, and a whole deck missed the bulk lookup. Markers
 * are peeled from the end now until nothing recognisable is left, so their
 * order does not matter, and each one is kept rather than discarded: the
 * printing picks the exact card, the category becomes the person's section.
 */
function stripPrinting(raw) {
  let name = raw.trim()
  const out = { name, set: undefined, number: undefined, categories: [] }
  for (;;) {
    let m
    if ((m = name.match(/\s*\*[A-Z]\*\s*$/))) {
      // Moxfield foil ("*F*") and etched ("*E*") markers.
      name = name.slice(0, -m[0].length)
    } else if ((m = name.match(/\s*\[([^\]]*)\]\s*$/))) {
      const inner = m[1].trim()
      // "[CMD]" is a set code; anything with lowercase, spaces or braces is a
      // category list. A real category called "LAND" would be lost, but that
      // is Archidekt's own default and would be dropped anyway.
      if (/^[A-Z0-9]{2,6}$/.test(inner)) out.set ??= inner
      else out.categories.unshift(...inner.split(',').map((c) => c.trim()).filter(Boolean))
      name = name.slice(0, -m[0].length)
    } else if ((m = name.match(/\s*\(([^()]*)\)(?:\s+([^\s()[\]]+))?\s*$/))) {
      // A parenthesised group is only a set code when it looks like one. The
      // card "Erase (Not the Urza's Legacy One)" ends in parentheses that are
      // part of its name, and a bare "Erase (Not the Urza's Legacy One)" line
      // used to lose them.
      const code = m[1].trim()
      const number = m[2]
      if (!SET_CODE.test(code)) break
      if (number !== undefined && !COLLECTOR.test(number)) break
      out.set ??= code
      out.number ??= number
      name = name.slice(0, -m[0].length)
    } else break
  }
  out.name = name.trim()
  out.set = out.set?.toLowerCase()
  return out
}

/**
 * What a line's trailing markers say about where the card goes. A category of
 * "Commander" on the line beats whatever section header is in force, because
 * Archidekt has no header and marks the commander this way. A maybeboard card
 * is not in the deck; the sideboard is the closest thing the app has, and the
 * preview shows it there rather than dropping it silently.
 */
function placeLine(parsed, section) {
  const kinds = parsed.categories.map((c) => c.replace(/\{[^}]*\}/g, '').trim().toLowerCase())
  const modifiers = parsed.categories.join(' ').toLowerCase()
  let where = section
  if (kinds.includes('commander')) where = 'commander'
  else if (kinds.includes('sideboard') || kinds.includes('maybeboard') || modifiers.includes('{nodeck}')) where = 'sideboard'
  const own = parsed.categories
    .map((c) => c.replace(/\{[^}]*\}/g, '').trim())
    .find((c) => c && !ARCHIDEKT_DEFAULTS.has(c.toLowerCase()))
  const entry = { name: parsed.name, section: where }
  if (parsed.set) entry.set = parsed.set
  if (parsed.number) entry.number = parsed.number
  if (own) entry.category = own
  return entry
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
 * Moxfield's "1 Sol Ring (C21) 263 *F*", Archidekt's
 * "1x Sol Ring (c21) 263 [Ramp]", with optional section headers.
 *
 * Each entry is { quantity, name, section } plus, when the line carried them,
 * the printing as { set, number } and the person's own category as
 * { category }. Callers that only want names can ignore the rest.
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

    // Cockatrice and MTGO mark each sideboard card on its own line, "SB: 2
    // Plains", with no header at all. The prefix places that one line and
    // leaves the section alone, so a maindeck card after it stays in the deck.
    let text = line
    let where = section
    const prefixed = line.match(/^sb:\s*(\S.*)$/i)
    if (prefixed) { text = prefixed[1]; where = 'sideboard' }

    const match = text.match(/^(\d+)\s*[xX]?\s+(.+)$/)
    if (!match) {
      // Split cards are written "Fire // Ice"; Scryfall's fuzzy search wants
      // the full name, so leave the separator alone.
      if (looksLikeBareName(text)) {
        const parsed = stripPrinting(text)
        if (parsed.name) bare.push({ quantity: 1, ...placeLine(parsed, where) })
      }
      continue
    }

    const parsed = stripPrinting(match[2])
    if (!parsed.name) continue
    out.push({ quantity: Number(match[1]), ...placeLine(parsed, where) })
  }

  // Ten is high enough that a stray line or a short paragraph cannot trip it,
  // and far below any real deck.
  if (out.length === 0 && bare.length >= 10) return bare
  return out
}
