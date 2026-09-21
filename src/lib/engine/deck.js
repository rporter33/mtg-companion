// The deck as the engine takes it.
//
// One function builds what a seat sends, so that the lobby's check and the
// sit itself cannot disagree about what the deck is: the check asks about
// exactly the map the sit will send.
import { FORMATS } from '../formats.js'

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

/** Name to copies, and how many copies had no name to go by because their card has not loaded. */
function countNames(entries, lookup) {
  const out = {}
  let total = 0
  let unloaded = 0
  for (const entry of Array.isArray(entries) ? entries : []) {
    const copies = entry?.quantity ?? 1
    total += copies
    const name = engineName(lookup?.(entry?.cardId))
    if (!name) { unloaded += copies; continue }
    out[name] = (out[name] ?? 0) + copies
  }
  return { out, total, unloaded }
}

/**
 * A deck made ready to sit with at the engine's table.
 *
 * `deck` maps each card's name, as Scryfall spells it, to how many copies;
 * the engine resolves the names (engine/README.md). `total` counts every copy
 * in the main deck. `unloaded` counts the main-deck copies whose card has not
 * arrived from Scryfall yet. Those have no name to send, and a deck sent
 * without them is a different deck, so a caller must not sit while `unloaded`
 * is above zero rather than quietly leave them out.
 *
 * `sideboard` is the same map for the cards the player owns outside the game,
 * which only a wish reaches. It is sent only for a format that has one: the
 * Commander family's is 0 cards, and what a Commander deck keeps there is
 * usually its maybeboard, not cards for the game. A sideboard card that has
 * not loaded is counted in `sideboardUnloaded` and left out, as a sideboard
 * card the engine does not know is (the owner's choice, 2026-09-21).
 */
export function seatDeck(deck, lookup) {
  const main = countNames(deck?.main, lookup)
  const allowed = FORMATS[deck?.formatId]?.sideboard?.max > 0
  const side = allowed ? countNames(deck?.sideboard, lookup) : { out: {}, unloaded: 0 }
  return { deck: main.out, sideboard: side.out, total: main.total, unloaded: main.unloaded, sideboardUnloaded: side.unloaded }
}

/**
 * The seat without the named cards, and what was left out with its counts.
 * Used when a player chose, in the lobby, to play the engine without the
 * cards it does not know; a name the deck does not hold is ignored.
 */
export function leaveOut(seat, names) {
  const deck = { ...seat.deck }
  const left = []
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name !== 'string' || !(deck[name] > 0)) continue
    left.push({ name, count: deck[name] })
    delete deck[name]
  }
  const gone = left.reduce((sum, l) => sum + l.count, 0)
  return { seat: { ...seat, deck, total: seat.total - gone }, left }
}

/**
 * What the engine's answer about a deck means, read forgivingly: the engine is
 * another program, and the lobby should never meet a shape it has to guard
 * against. The unknown names are laid against the deck's own counts, in the
 * deck's own order, and a name the deck does not hold is dropped rather than
 * shown. A deck is complete only when the engine knows every card and every
 * card loaded. `reply` null means the relay cannot check at all.
 */
export function verdictOf(seat, reply) {
  const base = { total: seat.total, unloaded: seat.unloaded }
  if (reply === null) return { state: 'cannot-check', ...base }
  if (!Array.isArray(reply?.unknown)) return { state: 'unreadable', ...base }
  const lines = (held, named) => {
    const asked = new Set(Array.isArray(named) ? named.filter((n) => typeof n === 'string') : [])
    return Object.keys(held ?? {}).filter((name) => asked.has(name)).map((name) => ({ name, count: held[name] }))
  }
  const unknown = lines(seat.deck, reply.unknown)
  const missing = unknown.reduce((sum, u) => sum + u.count, 0)
  return {
    state: unknown.length || seat.unloaded ? 'short' : 'complete',
    ...base,
    known: seat.total - seat.unloaded - missing,
    unknown,
    unknownSideboard: lines(seat.sideboard, reply.unknownSideboard),
  }
}

/** A few names, as a sentence says them: "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function nameList(names, max = 3) {
  if (names.length <= 1) return names.join('')
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}
