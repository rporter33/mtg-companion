// Deck categories.
//
// A card's section is either one the player chose or one derived from its type.
// Derived is the default and costs nothing to store: a deck nobody has
// organised still reads as Creatures / Lands / Artifacts, and a deck somebody
// has organised keeps exactly what they wrote.
//
// THE RENAME PROBLEM. Rename a derived section — "Creatures" to "Beaters" — and
// there is nothing to rename, because no card says "Creatures" anywhere; they
// simply are creatures. So renaming a derived section writes the new name onto
// the cards currently in it, turning them into chosen ones. Without that the
// rename silently does nothing, which is the kind of bug that makes a feature
// feel broken rather than missing.

import { typeGroupOf, TYPE_LABELS } from './grouping.js'
import { totalFor } from './prices.js'

export const COMMANDER_CATEGORY = 'Commander'

/** The section a card belongs to: the one it was given, or the one it implies. */
export function categoryOf(entry, card) {
  const chosen = entry?.category
  if (typeof chosen === 'string' && chosen.trim()) return chosen.trim()
  return card ? typeGroupOf(card).label : 'Other'
}

/** Is this section one somebody typed, or one the card types imply? */
export function isChosen(deck, name) {
  return allEntries(deck).some((entry) => entry.category?.trim() === name)
}

function allEntries(deck) {
  return [...(deck?.main ?? []), ...(deck?.sideboard ?? [])]
}

const mapZone = (list, cardId, fn) => (list ?? []).map(
  (entry) => (entry.cardId === cardId ? fn(entry) : entry),
)

/**
 * Puts one card in a section. A null name clears the choice, so the card goes
 * back to being filed by its type rather than into a section called "null".
 */
export function setCategory(deck, cardId, name) {
  const clean = typeof name === 'string' && name.trim() ? name.trim() : null
  const apply = (entry) => {
    if (clean === null) {
      const { category, ...rest } = entry
      return rest
    }
    return { ...entry, category: clean }
  }
  return {
    ...deck,
    main: mapZone(deck.main, cardId, apply),
    sideboard: mapZone(deck.sideboard, cardId, apply),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Renames a section.
 *
 * `cardsIn` is how the caller says which cards are currently showing under the
 * old name — including the ones only there because of their type, which is what
 * makes renaming a derived section work at all.
 */
export function renameCategory(deck, from, to, cardsIn = []) {
  const clean = to?.trim()
  if (!clean || clean === from) return deck

  const ids = new Set(cardsIn)
  const rename = (entry) => (
    entry.category?.trim() === from || ids.has(entry.cardId)
      ? { ...entry, category: clean }
      : entry
  )

  return {
    ...deck,
    main: (deck.main ?? []).map(rename),
    sideboard: (deck.sideboard ?? []).map(rename),
    categoryOrder: (deck.categoryOrder ?? []).map((name) => (name === from ? clean : name)),
    updatedAt: new Date().toISOString(),
  }
}

/** Dissolves a section: its cards go back to being filed by type. */
export function clearCategory(deck, name) {
  const drop = (entry) => {
    if (entry.category?.trim() !== name) return entry
    const { category, ...rest } = entry
    return rest
  }
  return {
    ...deck,
    main: (deck.main ?? []).map(drop),
    sideboard: (deck.sideboard ?? []).map(drop),
    categoryOrder: (deck.categoryOrder ?? []).filter((n) => n !== name),
    updatedAt: new Date().toISOString(),
  }
}

/** Every section name currently in use, chosen ones first. */
export function categoryNames(deck, lookup) {
  const chosen = []
  const derived = new Set()
  for (const entry of allEntries(deck)) {
    const name = categoryOf(entry, lookup?.(entry.cardId))
    if (entry.category?.trim()) {
      if (!chosen.includes(name)) chosen.push(name)
    } else derived.add(name)
  }
  return [...chosen, ...[...derived].filter((n) => !chosen.includes(n))]
}

/** Moves a section up or down in the order the deck is shown in. */
export function moveCategory(deck, name, delta, known = []) {
  const order = (deck.categoryOrder ?? []).length
    ? [...deck.categoryOrder]
    : known.filter((n) => n !== COMMANDER_CATEGORY)
  if (!order.includes(name)) order.push(name)

  const at = order.indexOf(name)
  const to = at + delta
  if (to < 0 || to >= order.length) return deck

  order.splice(to, 0, ...order.splice(at, 1))
  return { ...deck, categoryOrder: order, updatedAt: new Date().toISOString() }
}

/**
 * The deck, split into sections ready to render.
 *
 * Commander leads always. After that, a section the player positioned sits
 * where they put it; everything else follows in a stable order so a deck does
 * not rearrange itself between renders.
 */
export function deckSections(deck, lookup, { marketId = 'usd', typeOrder = TYPE_LABELS } = {}) {
  const buckets = new Map()
  const push = (name, entry) => {
    if (!buckets.has(name)) buckets.set(name, { name, entries: [], chosen: false })
    buckets.get(name).entries.push(entry)
  }

  for (const cardId of deck?.commanders ?? []) {
    push(COMMANDER_CATEGORY, { cardId, quantity: 1, card: lookup(cardId), zone: 'main', isCommander: true })
  }
  if (deck?.signatureSpell) {
    push(COMMANDER_CATEGORY, {
      cardId: deck.signatureSpell, quantity: 1, card: lookup(deck.signatureSpell), zone: 'main', isCommander: true,
    })
  }

  for (const zone of ['main', 'sideboard']) {
    for (const entry of deck?.[zone] ?? []) {
      const card = lookup(entry.cardId)
      const name = zone === 'sideboard' ? 'Sideboard' : categoryOf(entry, card)
      push(name, { ...entry, card, zone })
      if (entry.category?.trim() && buckets.has(name)) buckets.get(name).chosen = true
    }
  }

  const order = deck?.categoryOrder ?? []
  const rank = (name) => {
    if (name === COMMANDER_CATEGORY) return -2
    if (name === 'Sideboard') return 1e6
    const placed = order.indexOf(name)
    if (placed !== -1) return placed
    const typed = typeOrder.indexOf(name)
    return typed === -1 ? 1e5 : 1000 + typed
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      count: bucket.entries.reduce((n, e) => n + (e.quantity ?? 1), 0),
      price: totalFor(bucket.entries.filter((e) => e.card), marketId),
    }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
}
