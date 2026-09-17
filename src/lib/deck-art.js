/**
 * Which card's art stands for a deck.
 *
 * A deck is recognised by a painting long before by its name, and every card
 * on Scryfall carries an "art crop": the painting alone, no frame or text,
 * about 40 KB. The order here is a decision, not a heuristic: a card the
 * person chose, else the commander, else the costliest card in the list,
 * else the first card. Only a card that actually has art qualifies at each
 * step, so a token or a card with no image never blanks the banner when a
 * later choice would do.
 */
import { costliest } from './prices.js'

/** The painting alone, front face for a double-faced card; null when none. */
export function artUrl(card) {
  if (!card) return null
  return card.card_faces?.[0]?.image_uris?.art_crop ?? card.image_uris?.art_crop ?? null
}

/**
 * The face card, given a way to resolve ids to cards. `lookup` is the
 * editor's function; it returns undefined for a card not yet loaded, which
 * counts as "no art" and falls through.
 */
export function faceCardFor(deck, lookup, marketId = 'usd') {
  if (!deck) return null
  const withArt = (id) => {
    const card = id ? lookup?.(id) : null
    return card && artUrl(card) ? card : null
  }
  const chosen = withArt(deck.artCardId)
  if (chosen) return chosen
  for (const id of deck.commanders ?? []) {
    const card = withArt(id)
    if (card) return card
  }
  const resolved = (deck.main ?? [])
    .map((entry) => ({ ...entry, card: withArt(entry.cardId) }))
    .filter((entry) => entry.card)
  const [top] = costliest(resolved, marketId, 1)
  if (top) return top.card
  return resolved[0]?.card ?? null
}

/**
 * The id to try first when no cards are loaded — the Decks screen, which
 * lists every deck and cannot load a hundred cards for each. The derived
 * `faceCardId` is stamped by the editor on save (see stampFace), so a deck
 * that has been opened since this existed carries its own answer; older
 * decks fall back to the commander, then the first card.
 */
export function faceIdFor(deck) {
  return deck?.artCardId ?? deck?.faceCardId ?? deck?.commanders?.[0] ?? deck?.main?.[0]?.cardId ?? null
}

/** Chooses a card's art for the deck; null returns to automatic. */
export function setDeckArt(deck, cardId) {
  const { artCardId: _old, ...rest } = deck
  const next = cardId ? { ...rest, artCardId: cardId } : rest
  return { ...next, updatedAt: new Date().toISOString() }
}

/**
 * Records the automatic answer on the deck, so screens without the cards
 * loaded can show the same art the editor does. Returns the very same object
 * when nothing changed, because storage writes a deck by identity.
 */
export function stampFace(deck, lookup, marketId = 'usd') {
  const face = faceCardFor(deck, lookup, marketId)
  const id = face?.id ?? null
  if ((deck.faceCardId ?? null) === id) return deck
  if (id === null) {
    const { faceCardId: _drop, ...rest } = deck
    return rest
  }
  return { ...deck, faceCardId: id }
}
