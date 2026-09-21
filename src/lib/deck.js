// Deck model and format-aware validation.
//
// A deck stores card *ids* plus quantities; the card objects themselves live in
// the card cache. Validation therefore takes a lookup map so it stays a pure
// function — which is what makes it straightforward to test.

import {
  getFormat, legalityStatus, canBeCommander, effectiveCopyLimit,
  typeLineOf, isBasicLand, isTrueLand, isModalLand, frontTypeLine, oracleIdOf,
} from './formats.js'
import { notOutUntil, releaseLabel } from './release.js'
import { today } from './season.js'

export function createDeck({ name = 'Untitled deck', formatId = 'commander' } = {}) {
  const now = new Date().toISOString()
  return {
    id: `deck_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    name,
    formatId,
    commanders: [],
    signatureSpell: null,
    main: [],
    sideboard: [],
    createdAt: now,
    updatedAt: now,
  }
}

const zoneOf = (deck, zone) => (zone === 'sideboard' ? deck.sideboard : deck.main)

export function addCard(deck, cardId, quantity = 1, zone = 'main') {
  const current = zoneOf(deck, zone)
  // A new entry object, never `existing.quantity += n`: the entries are
  // shared with the deck passed in, and a version or a "before" held by
  // reference would otherwise change under the caller's feet.
  const list = current.some((e) => e.cardId === cardId)
    ? current.map((e) => (e.cardId === cardId ? { ...e, quantity: e.quantity + quantity } : e))
    : [...current, { cardId, quantity }]
  const pruned = list.filter((e) => e.quantity > 0)
  return { ...deck, [zone]: pruned, updatedAt: new Date().toISOString() }
}

export function setQuantity(deck, cardId, quantity, zone = 'main') {
  const list = zoneOf(deck, zone)
    .map((e) => (e.cardId === cardId ? { ...e, quantity } : e))
    .filter((e) => e.quantity > 0)
  return { ...deck, [zone]: list, updatedAt: new Date().toISOString() }
}

export function removeCard(deck, cardId, zone = 'main') {
  return setQuantity(deck, cardId, 0, zone)
}

export function setCommanders(deck, cardIds) {
  return { ...deck, commanders: [...cardIds], updatedAt: new Date().toISOString() }
}

/**
 * The deck a hand-over from the Learn tab starts. An example arrives empty,
 * named and formatted after the list, because its cards go through the
 * importer for the person to review. A commander has nothing to review, so
 * it is seated here, by id: the printing the guide showed is the one the
 * deck holds, not whichever printing its name would look up.
 */
export function deckFromSeed({ example, card } = {}) {
  const deck = createDeck({
    name: example?.name ?? (card?.name ? `${card.name} deck` : 'Untitled deck'),
    formatId: example?.formatId ?? 'commander',
  })
  return !example && card?.id ? setCommanders(deck, [card.id]) : deck
}

/** Total card count, including commanders where the format counts them. */
export function deckSize(deck, format) {
  const main = deck.main.reduce((n, e) => n + e.quantity, 0)
  const commanders = format?.commanderCountsTowardDeck ? deck.commanders.length : 0
  const signature = format?.signatureSpell && deck.signatureSpell ? 1 : 0
  return main + commanders + signature
}

export function sideboardSize(deck) {
  return deck.sideboard.reduce((n, e) => n + e.quantity, 0)
}

/** Every card id in the deck across all zones, including commanders. */
export function allCardIds(deck) {
  const ids = new Set()
  for (const e of deck.main) ids.add(e.cardId)
  for (const e of deck.sideboard) ids.add(e.cardId)
  for (const id of deck.commanders) ids.add(id)
  if (deck.signatureSpell) ids.add(deck.signatureSpell)
  return [...ids]
}

/**
 * Copy counts aggregated across main and sideboard. The four-copy limit applies
 * to the combined deck-and-sideboard total, not to each zone separately — a
 * common and expensive misunderstanding at a tournament table.
 */
export function combinedCounts(deck) {
  const counts = new Map()
  const bump = (id, n) => counts.set(id, (counts.get(id) ?? 0) + n)
  for (const e of deck.main) bump(e.cardId, e.quantity)
  for (const e of deck.sideboard) bump(e.cardId, e.quantity)
  for (const id of deck.commanders) bump(id, 1)
  if (deck.signatureSpell) bump(deck.signatureSpell, 1)
  return counts
}

/**
 * Which game card a printing is, for copy limits: four of one printing and
 * one of another are five Lightning Bolts. Scryfall's oracle id says which
 * printings are one card; a record without one (an older cache, a
 * hand-written fixture) falls back to its name, and a card that has not
 * loaded to its own id, so it is only ever counted with itself.
 */
export function gameCardKey(card, cardId = card?.id) {
  const oracle = oracleIdOf(card)
  if (oracle) return `oracle:${oracle}`
  if (card?.name) return `name:${card.name}`
  return `id:${cardId}`
}

/**
 * Copies per game card rather than per printing: the counts of combinedCounts
 * gathered under gameCardKey, each with the printing ids that make it up, in
 * the deck's order.
 */
export function gameCardCounts(deck, cardsById) {
  const lookup = (id) => (cardsById instanceof Map ? cardsById.get(id) : cardsById?.[id])
  const groups = new Map()
  for (const [cardId, quantity] of combinedCounts(deck)) {
    const key = gameCardKey(lookup(cardId), cardId)
    const group = groups.get(key) ?? { ids: [], quantity: 0 }
    group.ids.push(cardId)
    group.quantity += quantity
    groups.set(key, group)
  }
  return groups
}

const err = (code, message, cardId) => ({ code, severity: 'error', message, cardId })
const warn = (code, message, cardId) => ({ code, severity: 'warning', message, cardId })

/**
 * The two warnings for a card held back only by not being out yet (see
 * legalityStatus). Neither makes a deck illegal.
 */
export const NOT_OUT_CODES = new Set(['not_out_yet', 'legality_pending'])

/**
 * Validates a deck against its format.
 *
 * @param deck       deck object
 * @param cardsById  Map or plain object of cardId -> Scryfall card
 * @param options    { now }: the day to judge release against, 'YYYY-MM-DD'
 * @returns { legal, violations, counts, colorIdentity }
 */
export function validateDeck(deck, cardsById, { now = today() } = {}) {
  const format = getFormat(deck.formatId)
  const violations = []
  if (!format) {
    return {
      legal: false,
      violations: [err('unknown_format', `Unknown format "${deck.formatId}".`)],
      counts: { main: 0, sideboard: 0, total: 0 },
      colorIdentity: [],
    }
  }

  const lookup = (id) =>
    cardsById instanceof Map ? cardsById.get(id) : cardsById?.[id]

  const total = deckSize(deck, format)
  const side = sideboardSize(deck)

  // --- Deck size -----------------------------------------------------------
  if (format.deck.max && total > format.deck.max) {
    violations.push(err('deck_too_large',
      `${format.name} decks must be exactly ${format.deck.max} cards. This deck has ${total}.`))
  }
  if (total < format.deck.min) {
    const shortfall = format.deck.min - total
    violations.push(err('deck_too_small',
      format.deck.max === format.deck.min
        ? `${format.name} decks must be exactly ${format.deck.min} cards. This deck has ${total} — ${shortfall} short.`
        : `${format.name} decks need at least ${format.deck.min} cards. This deck has ${total} — ${shortfall} short.`))
  }
  if (side > format.sideboard.max) {
    violations.push(err('sideboard_too_large',
      format.sideboard.max === 0
        ? `${format.name} does not use a sideboard, but this deck has ${side} cards in one.`
        : `Sideboards are capped at ${format.sideboard.max} cards. This one has ${side}.`))
  }

  // --- Commanders ----------------------------------------------------------
  const commanderCards = deck.commanders.map(lookup).filter(Boolean)
  let identity = []

  if (format.commander?.required) {
    const rules = format.commander
    if (deck.commanders.length < rules.min) {
      violations.push(err('missing_commander',
        rules.requirePlaneswalker
          ? 'This deck needs an Oathbreaker (a planeswalker).'
          : 'This deck needs a commander.'))
    }
    if (deck.commanders.length > rules.max) {
      violations.push(err('too_many_commanders',
        `${format.name} allows at most ${rules.max} commander${rules.max === 1 ? '' : 's'}.`))
    }
    for (const card of commanderCards) {
      const check = canBeCommander(card, format)
      if (!check.ok) {
        violations.push(err('invalid_commander', `${card.name}: ${check.reason}`, card.id))
      }
    }
    identity = unionColorIdentity(commanderCards)
  }

  if (format.signatureSpell?.required) {
    const spell = lookup(deck.signatureSpell)
    if (!spell) {
      violations.push(err('missing_signature_spell',
        'Oathbreaker decks need a signature spell — one instant or sorcery.'))
    } else {
      const type = typeLineOf(spell)
      const ok = format.signatureSpell.types.some((t) => new RegExp(`\\b${t}\\b`).test(type))
      if (!ok) {
        violations.push(err('invalid_signature_spell',
          `${spell.name} cannot be a signature spell — it must be an instant or a sorcery.`, spell.id))
      }
    }
  }

  // --- Per-card checks -----------------------------------------------------
  // Legality and colour identity are read per printing, as each record
  // carries them. The copy limit and a restriction count the game card, all
  // its printings together, and are reported once, at its first printing,
  // with every printing's id, so one breach is one problem however many
  // printings make it up.
  const counts = combinedCounts(deck)
  const groupOf = new Map()
  for (const group of gameCardCounts(deck, cardsById).values()) {
    for (const id of group.ids) groupOf.set(id, group)
  }
  for (const [cardId] of counts) {
    const card = lookup(cardId)
    if (!card) {
      violations.push(warn('card_not_loaded',
        'A card in this deck has not loaded yet, so it has not been checked.', cardId))
      continue
    }
    const group = groupOf.get(cardId)
    const first = group.ids[0] === cardId
    const quantity = group.quantity
    const onGroup = (violation) => ({ ...violation, cardIds: [...group.ids] })

    // A card that is not out yet warns rather than fails: Scryfall has not
    // ruled on it, and the player is never kept from building with it.
    const status = legalityStatus(card, format, now)
    if (status === 'banned') {
      violations.push(err('banned', `${card.name} is banned in ${format.name}.`, cardId))
    } else if (status === 'not_legal') {
      violations.push(err('not_legal', `${card.name} is not in the ${format.name} card pool.`, cardId))
    } else if (status === 'future_legal') {
      violations.push(warn('not_out_yet',
        `${card.name} is not out until ${releaseLabel(notOutUntil(card, now))}. Scryfall's Future Standard lists it, so it is expected to be Standard-legal once out.`, cardId))
    } else if (status === 'pending') {
      violations.push(warn('legality_pending',
        `${card.name} is not out until ${releaseLabel(notOutUntil(card, now))}. Scryfall sets its ${format.name} legality when it is released.`, cardId))
    } else if (status === 'restricted' && first && quantity > 1) {
      violations.push(onGroup(err('restricted',
        `${card.name} is restricted in ${format.name} — only one copy is allowed, but this deck has ${quantity}.`, cardId)))
    } else if (status === 'unknown') {
      violations.push(warn('legality_unknown',
        `Legality data for ${card.name} in ${format.name} is unavailable, so it has not been checked.`, cardId))
    }

    const limit = effectiveCopyLimit(card, format)
    if (first && quantity > limit) {
      violations.push(onGroup(err('too_many_copies',
        format.singleton && limit === 1
          ? `${format.name} is singleton — only one ${card.name}, but this deck has ${quantity}.`
          : `At most ${limit} copies of ${card.name} are allowed, but this deck has ${quantity}.`, cardId)))
    }

    if (format.commander?.colorIdentity && commanderCards.length) {
      const outside = (card.color_identity ?? []).filter((c) => !identity.includes(c))
      if (outside.length) {
        violations.push(err('color_identity',
          `${card.name} is outside your commander's colour identity (${outside.join('')}).`, cardId))
      }
    }
  }

  return {
    legal: violations.every((v) => v.severity !== 'error'),
    violations,
    counts: { main: total - (format.commanderCountsTowardDeck ? deck.commanders.length : 0), sideboard: side, total },
    colorIdentity: identity,
  }
}

/**
 * How many cards in the deck are printings not out yet, in copies, the way
 * the deck's other counts are given: four of one card are four cards. Every
 * copy is counted, main deck, sideboard and command zone, whatever its
 * legality, so the number matches the "Not out until" labels on the rows
 * beside it. A card that has not loaded has no date to read and is not one.
 */
export function notOutCount(deck, cardsById, { now = today() } = {}) {
  const lookup = (id) => (cardsById instanceof Map ? cardsById.get(id) : cardsById?.[id])
  let n = 0
  for (const [cardId, quantity] of combinedCounts(deck)) {
    if (notOutUntil(lookup(cardId), now)) n += quantity
  }
  return n
}

/**
 * The deck's verdict in a few words, for the chip at the top of the editor:
 * its problems when it has any, then how many cards are not out yet, and only
 * then "Legal", since a deck with cards nobody can hold yet is not one the
 * app can call legal to play today. `tone` is the chip's: error, warn or ok.
 */
export function deckVerdict(deck, validation, cardsById, { now = today() } = {}) {
  if (!validation.legal) {
    const errors = validation.violations.filter((v) => v.severity === 'error').length
    return { tone: 'error', text: `${errors} problem${errors === 1 ? '' : 's'}` }
  }
  const notOut = notOutCount(deck, cardsById, { now })
  if (notOut) return { tone: 'warn', text: `${notOut} card${notOut === 1 ? '' : 's'} not out yet` }
  return { tone: 'ok', text: 'Legal' }
}

export function unionColorIdentity(cards) {
  const set = new Set()
  for (const card of cards) for (const c of card?.color_identity ?? []) set.add(c)
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => set.has(c))
}

/** Expands deck entries to a flat array of card objects, one per physical copy. */
export function expandToCards(entries, lookup) {
  const out = []
  for (const { cardId, quantity } of entries) {
    const card = typeof lookup === 'function' ? lookup(cardId) : lookup?.[cardId]
    if (!card) continue
    for (let i = 0; i < quantity; i++) out.push(card)
  }
  return out
}

/**
 * A land for curve and type-breakdown purposes: the front face is a land.
 *
 * Deliberately excludes modal spell // land cards — see isModalLand. Use
 * `countManaSources` when you want "things that can produce mana", which does
 * include them.
 */
export function isLandCard(card) {
  return isTrueLand(card)
}

/**
 * Choosing a different printing of a card you already have.
 *
 * The deck stores a printing id per entry, so this is a straight swap — but
 * if the deck already holds the printing being swapped to, the two entries
 * have to merge, or the deck would list the same card twice and every count
 * in the app would be wrong. Commanders are swapped the same way.
 */
export function swapPrinting(deck, fromId, toId) {
  if (!deck || !fromId || !toId || fromId === toId) return deck
  const main = []
  let merged = false
  for (const entry of deck.main ?? []) {
    const id = entry.cardId === fromId ? toId : entry.cardId
    const at = main.findIndex((e) => e.cardId === id)
    if (at >= 0) {
      main[at] = { ...main[at], quantity: main[at].quantity + entry.quantity }
      merged = true
    } else {
      main.push(entry.cardId === fromId ? { ...entry, cardId: toId } : entry)
    }
  }
  const sideboard = (deck.sideboard ?? []).map((e) => (e.cardId === fromId ? { ...e, cardId: toId } : e))
  const commanders = [...new Set((deck.commanders ?? []).map((id) => (id === fromId ? toId : id)))]
  const touched = merged
    || main.some((e, i) => e !== (deck.main ?? [])[i])
    || sideboard.some((e, i) => e !== (deck.sideboard ?? [])[i])
    || commanders.join() !== (deck.commanders ?? []).join()
  if (!touched) return deck
  // The deck's own chosen art follows the card it was pointing at.
  const artCardId = deck.artCardId === fromId ? toId : deck.artCardId
  return { ...deck, main, sideboard, commanders, artCardId, updatedAt: new Date().toISOString() }
}

export { isBasicLand, isModalLand, isTrueLand, frontTypeLine }
