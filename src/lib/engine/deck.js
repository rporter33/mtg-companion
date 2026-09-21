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
export function seatDeck(deck, lookup) {
  const out = {}
  let total = 0
  let unloaded = 0
  for (const entry of deck?.main ?? []) {
    const copies = entry.quantity ?? 1
    total += copies
    const name = lookup?.(entry.cardId)?.name
    if (!name) { unloaded += copies; continue }
    out[name] = (out[name] ?? 0) + copies
  }
  return { deck: out, sideboard: {}, total, unloaded }
}
