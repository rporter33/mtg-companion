import { notOutUntil, justOut } from './release.js'
import { today } from './season.js'
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

/**
 * A card's oracle id, which every printing of it shares, so it says which
 * printings are one card. A reversible card carries it on each face and not
 * on the card; an older cached record may carry none at all.
 */
export function oracleIdOf(card) {
  return card?.oracle_id ?? card?.card_faces?.[0]?.oracle_id ?? null
}

export function typeLineOf(card) {
  if (!card) return ''
  if (card.type_line) return card.type_line
  if (Array.isArray(card.card_faces)) {
    return card.card_faces.map((f) => f.type_line ?? '').join(' // ')
  }
  return ''
}

/**
 * The type line of the face you cast from hand.
 *
 * This matters for modal double-faced cards. Agadeem's Awakening is
 * "Sorcery // Land": the flattened line contains "Land", so a naive check
 * classifies a six-mana sorcery as a land and drops it out of the mana curve.
 * The front face is what you pay for, so the front face is what the curve and
 * the type breakdown should see.
 */
export function frontTypeLine(card) {
  if (!card) return ''
  if (Array.isArray(card.card_faces) && card.card_faces.length) {
    return card.card_faces[0].type_line ?? ''
  }
  return card.type_line ?? ''
}

/** A land you play from hand — the front face is a land. */
export function isTrueLand(card) {
  return /\bLand\b/.test(frontTypeLine(card))
}

/**
 * A spell whose *back* is a land: you choose, on the way down, whether this is
 * a spell or a land. It is not a land for curve purposes and it is not a land
 * you can count on, but it is a mana source you may deploy.
 */
export function isModalLand(card) {
  if (!Array.isArray(card?.card_faces) || card.card_faces.length < 2) return false
  if (isTrueLand(card)) return false
  return card.card_faces.some((face) => /\bLand\b/.test(face.type_line ?? ''))
}

export function isBasicLand(card) {
  const front = frontTypeLine(card)
  return /\bBasic\b/.test(front) && /\bLand\b/.test(front)
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

/**
 * Scryfall's legality, read with the card's release date beside it.
 *
 * Before a set comes out Scryfall marks its new cards not_legal everywhere,
 * and that one word covers two different things: not out yet, and never
 * going to be legal here (a Commander product's cards in Standard, a rare in
 * Pauper). So a not_legal card that is not out yet is never promised a
 * legality the app has worked out for itself. It is 'pending' — Scryfall
 * will say at release — except in Standard, where Scryfall's own Future
 * Standard (`future`) already says which previewed cards will be legal:
 * 'future_legal' when it lists the card, not_legal as it stands when it
 * does not. Every other status, and every card that is out, is Scryfall's
 * word unchanged; cardLegality stays the raw reading for anything that
 * records what Scryfall said.
 *
 * A reprint is not a new card. Legality belongs to the card, so an upcoming
 * printing of Lightning Bolt carries the not_legal in Pioneer that Bolt has
 * today, and that is Scryfall's answer for a card that already exists, not a
 * ruling it is waiting to make. Only in Standard, where Future Standard is
 * Scryfall's own word on the new set, is a reprint read the same way as a
 * new card. A record with no `reprint` field, as an older cache may be, is
 * read as new, which is how it was read before this was checked.
 *
 * Once a card is out, a record can still say what Scryfall said before
 * release: one saved then says it until it is fetched again, and when
 * Scryfall gives a new set its legalities after release has not been
 * checked. Such a record is not_legal in every paper format, which a record
 * of a released card almost never is (see listedInPaper). So in the week
 * after a card's release (justOut), a not_legal from a record that lists the
 * card in no paper format is 'catching_up': the app does not call the card
 * legal, and does not fail a deck for it, while a deck's cards are fetched
 * daily (see card-refresh.js). A record that lists it somewhere is
 * Scryfall's word since release, and its not_legal stands at once: a
 * Commander product's cards in Modern, a rare in Pauper. So do a reprint's
 * not_legal outside Standard and Future Standard's not_legal in Standard, as
 * before release. After the week every not_legal stands.
 *
 * Returns cardLegality's statuses plus 'future_legal' | 'pending' |
 * 'catching_up'.
 */
export function legalityStatus(card, format, now = today()) {
  const base = cardLegality(card, format)
  if (base !== 'not_legal') return base
  const standard = format.legalityKey === 'standard'
  const future = card?.legalities?.future
  if (notOutUntil(card, now)) {
    if (!standard) return card?.reprint === true ? base : 'pending'
    if (future === 'legal') return 'future_legal'
    if (future === 'not_legal') return 'not_legal'
    return 'pending'
  }
  if (!justOut(card, now)) return base
  const settled = listedInPaper(card) || (standard ? future === 'not_legal' : card?.reprint === true)
  return settled ? base : 'catching_up'
}

/**
 * Whether Scryfall's record of a card lists it in a paper format: legal,
 * banned or restricted in Vintage, Legacy or Commander. Before a set is out
 * Scryfall lists each of its new cards as not_legal in all three, and once
 * the card is out nearly every one is listed in at least one of them. Only
 * these are read: before release Scryfall already lists new cards in Future
 * Standard and in some digital formats (Reality Fracture's in `tlr` on
 * 2026-09-21), so any other key could make a pre-release record look settled.
 * An Un-set card is not_legal everywhere even after release, and reads as
 * unlisted for its first week, which only means the app does not call it
 * illegal for that week.
 */
export function listedInPaper(card) {
  return ['vintage', 'legacy', 'commander'].some((key) => {
    const status = card?.legalities?.[key]
    return typeof status === 'string' && status !== 'not_legal'
  })
}

/**
 * The Scryfall search term for a format's card pool.
 *
 * Scryfall keeps a new card out of every format's pool until it is released,
 * so `legal:<format>` alone cannot find the next set. Standard is the one format
 * where Scryfall already names the previewed cards that will be legal, in its
 * Future Standard, so Standard's pool takes those in too, and they come back
 * as 'future_legal' above rather than as legal.
 */
export function poolQuery(format) {
  return format.legalityKey === 'standard'
    ? '(legal:standard or legal:future)'
    : `legal:${format.legalityKey}`
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
