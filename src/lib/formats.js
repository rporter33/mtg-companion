// Format definitions and deck construction rules.
//
// DESIGN DECISION — ban lists are not stored here.
// Banned/restricted status is read from Scryfall's per-card `legalities` object
// at validation time. Ban lists change on a rolling announcement schedule; a
// hardcoded copy would be wrong within weeks and wrong silently. What *is*
// encoded here is the structural stuff that effectively never changes: deck
// sizes, copy limits, singleton, commander requirements, starting life.

export const FORMAT_GROUPS = [
  { id: 'constructed', label: 'Constructed' },
  { id: 'commander', label: 'Commander family' },
]

/**
 * legalityKey maps to the key inside a Scryfall card's `legalities` object.
 * If a key is absent from a card's legalities (Scryfall adds formats over
 * time), validation reports it as unknown rather than silently passing.
 */
export const FORMATS = {
  standard: {
    id: 'standard', name: 'Standard', group: 'constructed', legalityKey: 'standard',
    blurb: 'The rotating format. Roughly the last three years of sets.',
    deck: { min: 60, max: null }, maxCopies: 4, singleton: false,
    sideboard: { max: 15 }, startingLife: 20, commanderDamage: false,
  },
  pioneer: {
    id: 'pioneer', name: 'Pioneer', group: 'constructed', legalityKey: 'pioneer',
    blurb: 'Non-rotating, Return to Ravnica forward. No fetchlands.',
    deck: { min: 60, max: null }, maxCopies: 4, singleton: false,
    sideboard: { max: 15 }, startingLife: 20, commanderDamage: false,
  },
  modern: {
    id: 'modern', name: 'Modern', group: 'constructed', legalityKey: 'modern',
    blurb: 'Non-rotating, 8th Edition forward. Fast and powerful.',
    deck: { min: 60, max: null }, maxCopies: 4, singleton: false,
    sideboard: { max: 15 }, startingLife: 20, commanderDamage: false,
  },
  legacy: {
    id: 'legacy', name: 'Legacy', group: 'constructed', legalityKey: 'legacy',
    blurb: 'Nearly every card ever printed, with a ban list.',
    deck: { min: 60, max: null }, maxCopies: 4, singleton: false,
    sideboard: { max: 15 }, startingLife: 20, commanderDamage: false,
  },
  vintage: {
    id: 'vintage', name: 'Vintage', group: 'constructed', legalityKey: 'vintage',
    blurb: 'The most permissive format. Restricts rather than bans — restricted cards are limited to one copy.',
    deck: { min: 60, max: null }, maxCopies: 4, singleton: false,
    sideboard: { max: 15 }, startingLife: 20, commanderDamage: false,
  },
  pauper: {
    id: 'pauper', name: 'Pauper', group: 'constructed', legalityKey: 'pauper',
    blurb: 'Commons only. Cheap to build, deep to play.',
    deck: { min: 60, max: null }, maxCopies: 4, singleton: false,
    sideboard: { max: 15 }, startingLife: 20, commanderDamage: false,
  },

  commander: {
    id: 'commander', name: 'Commander', group: 'commander', legalityKey: 'commander',
    blurb: 'The most-played paper format. 100 singleton cards led by a legendary creature.',
    deck: { min: 100, max: 100 }, maxCopies: 1, singleton: true,
    sideboard: { max: 0 }, startingLife: 40, commanderDamage: 21,
    commander: { required: true, min: 1, max: 2, colorIdentity: true },
    commanderCountsTowardDeck: true,
  },
  duel: {
    id: 'duel', name: 'Duel Commander', group: 'commander', legalityKey: 'duel',
    blurb: 'One-on-one Commander with its own ban list and a lower life total.',
    deck: { min: 100, max: 100 }, maxCopies: 1, singleton: true,
    sideboard: { max: 0 }, startingLife: 20, commanderDamage: 21,
    commander: { required: true, min: 1, max: 2, colorIdentity: true },
    commanderCountsTowardDeck: true,
  },
  brawl: {
    id: 'brawl', name: 'Brawl', group: 'commander', legalityKey: 'brawl',
    blurb: 'Commander built from a narrower, more modern card pool. Planeswalkers are legal commanders.',
    deck: { min: 100, max: 100 }, maxCopies: 1, singleton: true,
    sideboard: { max: 0 }, startingLife: 25, commanderDamage: 21,
    commander: { required: true, min: 1, max: 1, colorIdentity: true, allowPlaneswalker: true },
    commanderCountsTowardDeck: true,
  },
  oathbreaker: {
    id: 'oathbreaker', name: 'Oathbreaker', group: 'commander', legalityKey: 'oathbreaker',
    blurb: 'A planeswalker commands, paired with a signature spell you can always cast.',
    deck: { min: 60, max: 60 }, maxCopies: 1, singleton: true,
    sideboard: { max: 0 }, startingLife: 20, commanderDamage: false,
    commander: { required: true, min: 1, max: 1, colorIdentity: true, requirePlaneswalker: true },
    signatureSpell: { required: true, types: ['Instant', 'Sorcery'] },
    commanderCountsTowardDeck: true,
  },
}

export const FORMAT_IDS = Object.keys(FORMATS)

export function getFormat(id) {
  return FORMATS[id] ?? null
}

export function formatsInGroup(groupId) {
  return FORMAT_IDS.map((id) => FORMATS[id]).filter((f) => f.group === groupId)
}

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

/**
 * Some cards opt out of the copy limit in their own rules text
 * ("A deck can have any number of cards named Relentless Rats",
 *  "A deck can have up to nine cards named Nazgûl").
 *
 * Reading this from oracle text rather than maintaining a list means new
 * printings work on release day without a code change.
 *
 * Returns Infinity, a specific cap, or null if the card has no such clause.
 */
export function copyLimitOverride(card) {
  const text = oracleTextOf(card)
  if (!text) return null
  const any = /a deck can have any number of cards named/i.test(text)
  if (any) return Infinity
  const upTo = text.match(/a deck can have up to (\w+) cards named/i)
  if (upTo) {
    const word = upTo[1].toLowerCase()
    const n = NUMBER_WORDS[word] ?? Number(word)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Oracle text, flattened across faces for double-faced and split cards. */
export function oracleTextOf(card) {
  if (!card) return ''
  if (card.oracle_text) return card.oracle_text
  if (Array.isArray(card.card_faces)) {
    return card.card_faces.map((f) => f.oracle_text ?? '').join('\n')
  }
  return ''
}

export function typeLineOf(card) {
  if (!card) return ''
  if (card.type_line) return card.type_line
  if (Array.isArray(card.card_faces)) {
    return card.card_faces.map((f) => f.type_line ?? '').join(' // ')
  }
  return ''
}

export function isBasicLand(card) {
  return /\bBasic\b/.test(typeLineOf(card)) && /\bLand\b/.test(typeLineOf(card))
}

/** Basic lands are exempt from both the copy limit and singleton rules. */
export function effectiveCopyLimit(card, format) {
  if (isBasicLand(card)) return Infinity
  const override = copyLimitOverride(card)
  if (override !== null) {
    // Singleton formats still honour explicit "any number" clauses; that is how
    // Relentless Rats decks are legal in Commander.
    return override
  }
  return format.singleton ? 1 : format.maxCopies
}

/**
 * Legality of a single card in a format, straight from Scryfall.
 * Returns 'legal' | 'not_legal' | 'banned' | 'restricted' | 'unknown'.
 */
export function cardLegality(card, format) {
  const status = card?.legalities?.[format.legalityKey]
  if (!status) return 'unknown'
  return status
}

/** Can this card be the commander for this format? */
export function canBeCommander(card, format) {
  const rules = format.commander
  if (!rules) return { ok: false, reason: `${format.name} does not use a commander.` }

  const type = typeLineOf(card)
  const isLegendary = /\bLegendary\b/.test(type)
  const isCreature = /\bCreature\b/.test(type)
  const isPlaneswalker = /\bPlaneswalker\b/.test(type)
  const text = oracleTextOf(card)
  const saysCanBeCommander = /can be your commander/i.test(text)

  if (rules.requirePlaneswalker) {
    if (!isPlaneswalker) return { ok: false, reason: 'An Oathbreaker must be a planeswalker.' }
    return { ok: true }
  }

  if (saysCanBeCommander) return { ok: true }

  if (isLegendary && isCreature) return { ok: true }
  if (rules.allowPlaneswalker && isLegendary && isPlaneswalker) return { ok: true }

  return {
    ok: false,
    reason: rules.allowPlaneswalker
      ? 'A commander must be a legendary creature or a legendary planeswalker.'
      : 'A commander must be a legendary creature (or say it can be your commander).',
  }
}
