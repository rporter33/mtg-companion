// Plain text is the only decklist interchange format every site agrees on, so
// it is the one this app reads and writes. This parser lives in lib rather than
// beside the component because it is pure, it is the part most likely to be
// wrong about a real export, and both the app and the offline tooling need it.

/**
 * Parses the loose decklist formats that sites actually emit:
 * "4 Lightning Bolt", "4x Lightning Bolt", "4 Lightning Bolt (2X2) 117",
 * with optional section headers.
 */
export function parseDecklist(text) {
  const out = []
  let section = 'main'

  // A file saved by PowerShell, Notepad or Excel often starts with a UTF-8
  // byte order mark. Left alone it fuses to the first card name and that line
  // silently fails to resolve, which is the worst kind of import bug: quiet,
  // and only on one platform.
  for (const raw of String(text ?? '').replace(/^\uFEFF/, '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue

    const header = line.toLowerCase().replace(/[:\s]+$/, '')
    if (['sideboard', 'sb'].includes(header)) { section = 'sideboard'; continue }
    if (['commander', 'commanders'].includes(header)) { section = 'commander'; continue }
    if (['deck', 'maindeck', 'main', 'mainboard'].includes(header)) { section = 'main'; continue }

    const match = line.match(/^(\d+)\s*[xX]?\s+(.+)$/)
    if (!match) continue

    let name = match[2]
      .replace(/\s*\([^)]*\)\s*\d*\s*$/, '')   // trailing "(SET) 123"
      .replace(/\s*\[[^\]]*\]\s*$/, '')        // trailing "[SET]"
      .trim()
    // Split cards are written "Fire // Ice"; Scryfall's fuzzy search wants the
    // full name, so leave the separator alone.
    if (!name) continue

    out.push({ quantity: Number(match[1]), name, section })
  }
  return out
}
