// What you own, and what a deck still needs.
//
// KEYED BY ORACLE ID, NOT PRINTING. Owning a card means owning that card, not
// one particular printing of it. A player with a Commander 2021 Sol Ring and a
// deck listing the Battlebond one owns a Sol Ring; keying on printing id would
// tell them to buy a second, which makes the whole feature useless.
//
// The cost of that choice is real and worth stating: this cannot tell you the
// value of what you own, because it does not know which printings they are. It
// answers "what do I still need", which is the question people ask when
// building, and refuses to pretend it answers the other one.
//
// COUNTS ARE PER DECK, NOT ALLOCATED ACROSS DECKS. One Sol Ring covers a Sol
// Ring in every deck you own, because you own a Sol Ring. Splitting a
// collection between decks is a different feature — a proxy for "can I sleeve
// all of these at once" — and pretending this is that would quietly overstate
// what you are missing.

import { priceFor } from './prices.js'

/** The key a card is owned under. */
export const keyOf = (card) => card?.oracle_id ?? card?.id ?? null

export function ownedOf(collection, card) {
  const key = keyOf(card)
  return key ? (collection?.[key] ?? 0) : 0
}

/**
 * Records a count. Zero removes the entry rather than storing a zero, so the
 * collection stays a list of what you have rather than a list of everything
 * you have ever looked at.
 */
export function setOwned(collection, card, count) {
  const key = keyOf(card)
  if (!key) return collection ?? {}
  const next = { ...(collection ?? {}) }
  const value = Math.max(0, Math.floor(Number(count) || 0))
  if (value === 0) delete next[key]
  else next[key] = value
  return next
}

/** How many distinct cards are recorded, and how many pieces of cardboard. */
export function collectionSize(collection) {
  const values = Object.values(collection ?? {})
  return {
    distinct: values.length,
    total: values.reduce((n, v) => n + v, 0),
  }
}

/**
 * What this deck still needs.
 *
 * Commanders count: a deck you cannot lead is a deck you cannot play. The
 * sideboard counts too — it is part of what you have to bring.
 */
export function missingFor(deck, lookup, collection) {
  const wanted = new Map()
  const add = (cardId, quantity) => {
    const card = lookup(cardId)
    if (!card) return
    const key = keyOf(card)
    if (!key) return
    const entry = wanted.get(key) ?? { card, quantity: 0 }
    entry.quantity += quantity
    wanted.set(key, entry)
  }

  for (const cardId of deck?.commanders ?? []) add(cardId, 1)
  if (deck?.signatureSpell) add(deck.signatureSpell, 1)
  for (const { cardId, quantity } of deck?.main ?? []) add(cardId, quantity)
  for (const { cardId, quantity } of deck?.sideboard ?? []) add(cardId, quantity)

  const missing = []
  for (const [key, { card, quantity }] of wanted) {
    const owned = collection?.[key] ?? 0
    const need = quantity - owned
    if (need > 0) missing.push({ card, quantity: need, wanted: quantity, owned })
  }
  return missing.sort((a, b) => a.card.name.localeCompare(b.card.name))
}

/** What the missing cards would cost, and how many could not be priced. */
export function missingCost(missing, marketId = 'usd') {
  let total = 0
  let priced = 0
  let unpriced = 0
  for (const { card, quantity } of missing) {
    const { value } = priceFor(card, marketId)
    if (value === null) { unpriced += quantity; continue }
    total += value * quantity
    priced += quantity
  }
  return { total, priced, unpriced, marketId }
}

/** Marks every card in a deck as owned — "I have this deck in a box". */
export function ownEverythingIn(collection, deck, lookup) {
  let next = collection ?? {}
  for (const { card, wanted } of missingFor(deck, lookup, {})) {
    next = setOwned(next, card, Math.max(wanted, ownedOf(next, card)))
  }
  return next
}
