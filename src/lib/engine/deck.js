// The deck as the engine takes it.
//
// One function builds what a seat sends, so that the lobby's check and the
// sit itself cannot disagree about what the deck is: the check asks about
// exactly the map the sit will send.

/**
 * A deck made ready to sit with at the engine's table.
 *
 * `deck` maps each card's name, as Scryfall spells it, to how many copies;
 * the engine resolves the names (engine/README.md). `total` counts every copy
 * in the main deck. `unloaded` counts the copies whose card has not arrived
 * from Scryfall yet. Those have no name to send, and a deck sent without them
 * is a different deck, so a caller must not sit while `unloaded` is above
 * zero rather than quietly leave them out.
 */
/**
 * The name to send for a card: Scryfall's own, except for a reversible card.
 * Scryfall names one "X // X", the same shape as an art-series card, which is
 * not a card a deck may hold, and the engine refuses that shape rather than
 * guess which it is. So a reversible card goes by its single name.
 */
export function engineName(card) {
  if (card?.layout === 'reversible_card' && card.card_faces?.[0]?.name) return card.card_faces[0].name
  return card?.name ?? null
}

export function seatDeck(deck, lookup) {
  const out = {}
  let total = 0
  let unloaded = 0
  for (const entry of deck?.main ?? []) {
    const copies = entry.quantity ?? 1
    total += copies
    const name = engineName(lookup?.(entry.cardId))
    if (!name) { unloaded += copies; continue }
    out[name] = (out[name] ?? 0) + copies
  }
  return { deck: out, sideboard: {}, total, unloaded }
}
