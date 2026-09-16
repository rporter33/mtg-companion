// Parsing and classification of Magic mana symbols.
//
// Mana costs arrive from Scryfall as a string of brace-delimited symbols:
// "{2}{W}{U}", "{X}{B/R}", "{W/P}". Everything here works off that string.
// Mana value is NOT computed here — Scryfall supplies `cmc` and it is
// authoritative (it already handles split cards, {X}=0, and other oddities).

export const COLORS = ['W', 'U', 'B', 'R', 'G']

export const COLOR_NAMES = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
}

/** Splits "{2}{W/U}{P}" into ['2', 'W/U', 'P']. Unparseable input yields []. */
export function parseManaCost(cost) {
  if (!cost || typeof cost !== 'string') return []
  const matches = cost.match(/\{([^}]+)\}/g)
  if (!matches) return []
  return matches.map((s) => s.slice(1, -1))
}

/**
 * Classifies a single symbol body (the text between the braces).
 * Returns { kind, colors, generic } where kind is one of:
 * 'generic' | 'variable' | 'colored' | 'hybrid' | 'monocolor-hybrid' |
 * 'phyrexian' | 'colorless' | 'snow' | 'other'
 */
export function classifySymbol(body) {
  const sym = String(body).toUpperCase()

  if (/^\d+$/.test(sym)) return { kind: 'generic', colors: [], generic: Number(sym) }
  if (sym === 'X' || sym === 'Y' || sym === 'Z') return { kind: 'variable', colors: [], generic: 0 }
  if (sym === 'C') return { kind: 'colorless', colors: [], generic: 0 }
  if (sym === 'S') return { kind: 'snow', colors: [], generic: 0 }

  // Un-set and joke symbols. None are legal in any format this app supports,
  // but Scryfall serves them and they used to fall through to 'other', which
  // renders a grey circle with raw text. Live validation surfaced six of them:
  // {½} {∞} {H} {HW} {HR} {L}.
  if (sym === '½') return { kind: 'half-generic', colors: [], generic: 0.5 }
  if (sym === '∞') return { kind: 'infinite', colors: [], generic: Infinity }
  // {HW} and {HR} are half-coloured mana. They count toward their colour: half
  // a white pip still means the deck needs white.
  if (/^H[WUBRG]$/.test(sym)) {
    return { kind: 'half-colored', colors: [sym[1]], generic: 0 }
  }

  if (COLORS.includes(sym)) return { kind: 'colored', colors: [sym], generic: 0 }

  if (sym.includes('/')) {
    const parts = sym.split('/')
    // Phyrexian: {W/P}, and the rare two-color phyrexian {B/G/P}.
    if (parts.includes('P')) {
      const colors = parts.filter((p) => COLORS.includes(p))
      return { kind: 'phyrexian', colors, generic: 0 }
    }
    // Monocolor hybrid: {2/W} — pay 2 generic or one W.
    const numeric = parts.find((p) => /^\d+$/.test(p))
    if (numeric) {
      const colors = parts.filter((p) => COLORS.includes(p))
      return { kind: 'monocolor-hybrid', colors, generic: Number(numeric) }
    }
    const colors = parts.filter((p) => COLORS.includes(p))
    if (colors.length) return { kind: 'hybrid', colors, generic: 0 }
  }

  return { kind: 'other', colors: [], generic: 0 }
}

/**
 * Counts colored pips in a mana cost, for measuring how demanding a deck's
 * colour requirements are against its land base.
 *
 * A hybrid symbol is deliberately counted as a *full* pip for each colour it
 * could be paid with, not a half. It overstates a hybrid-heavy deck's needs,
 * but the failure mode we care about is "I couldn't cast my spell", and that
 * asymmetry should favour recommending more sources, not fewer.
 */
export function countPips(cost) {
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const body of parseManaCost(cost)) {
    const { kind, colors } = classifySymbol(body)
    if (kind === 'colored' || kind === 'hybrid' || kind === 'phyrexian'
      || kind === 'monocolor-hybrid' || kind === 'half-colored') {
      for (const c of colors) pips[c] += 1
    }
  }
  return pips
}

/** Sums pip counts across an array of { card, quantity } entries. */
export function aggregatePips(entries) {
  const total = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const { card, quantity } of entries) {
    const cost = card?.mana_cost ?? faceManaCost(card)
    const pips = countPips(cost)
    for (const c of COLORS) total[c] += pips[c] * quantity
  }
  return total
}

/**
 * Double-faced and split cards put mana costs on `card_faces` rather than the
 * top level. We use the front face: it is the only side you can cast from hand
 * for transforming cards, and for split cards it is the cheaper half, which is
 * the conservative choice for curve purposes.
 */
export function faceManaCost(card) {
  if (!card) return ''
  if (card.mana_cost) return card.mana_cost
  const face = card.card_faces?.[0]
  return face?.mana_cost ?? ''
}

/** Human-readable colour identity, e.g. ['U','G'] -> "Blue/Green". */
export function describeColors(colors) {
  if (!colors || colors.length === 0) return 'Colorless'
  return colors.map((c) => COLOR_NAMES[c] ?? c).join('/')
}
