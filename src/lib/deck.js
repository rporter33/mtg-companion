// Deck model and format-aware validation.
//
// A deck stores card *ids* plus quantities; the card objects themselves live in
// the card cache. Validation therefore takes a lookup map so it stays a pure
// function — which is what makes it straightforward to test.

import {
  getFormat, cardLegality, canBeCommander, effectiveCopyLimit,
  typeLineOf, isBasicLand, isTrueLand, isModalLand, frontTypeLine,
} from './formats.js'

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

const err = (code, message, cardId) => ({ code, severity: 'error', message, cardId })
const warn = (code, message, cardId) => ({ code, severity: 'warning', message, cardId })

/**
 * Validates a deck against its format.
 *
 * @param deck       deck object
 * @param cardsById  Map or plain object of cardId -> Scryfall card
 * @returns { legal, violations, counts, colorIdentity }
 */
export function validateDeck(deck, cardsById) {
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
  const counts = combinedCounts(deck)
  for (const [cardId, quantity] of counts) {
    const card = lookup(cardId)
    if (!card) {
      violations.push(warn('card_not_loaded',
        'A card in this deck has not loaded yet, so it has not been checked.', cardId))
      continue
    }

    const status = cardLegality(card, format)
    if (status === 'banned') {
      violations.push(err('banned', `${card.name} is banned in ${format.name}.`, cardId))
    } else if (status === 'not_legal') {
      violations.push(err('not_legal', `${card.name} is not in the ${format.name} card pool.`, cardId))
    } else if (status === 'restricted' && quantity > 1) {
      violations.push(err('restricted',
        `${card.name} is restricted in ${format.name} — only one copy is allowed, but this deck has ${quantity}.`, cardId))
    } else if (status === 'unknown') {
      violations.push(warn('legality_unknown',
        `Legality data for ${card.name} in ${format.name} is unavailable, so it has not been checked.`, cardId))
    }

    const limit = effectiveCopyLimit(card, format)
    if (quantity > limit) {
      violations.push(err('too_many_copies',
        format.singleton && limit === 1
          ? `${format.name} is singleton — only one ${card.name}, but this deck has ${quantity}.`
          : `At most ${limit} copies of ${card.name} are allowed, but this deck has ${quantity}.`, cardId))
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

export { isBasicLand, isModalLand, isTrueLand, frontTypeLine }
