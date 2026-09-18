/**
 * Putting one of the app's decks onto the board.
 *
 * The deck builder already knows what a deck is: entries with quantities, a
 * commander list kept apart, a format. This turns that into the one action
 * that deals a table, and nothing else — so a deck built on the phone in a
 * shop is the deck that appears on the table at home.
 *
 * Commanders go to the command zone, never the library. A commander shuffled
 * into the ninety-nine is a different deck, and it is the mistake every
 * hand-rolled playtester makes first.
 */
import { OPENING_HAND } from '../goldfish.js'

/** Every card id in the deck's main list, one per copy, commanders removed. */
export function libraryOf(deck) {
  const commanders = new Set(deck?.commanders ?? [])
  const out = []
  for (const { cardId, quantity } of deck?.main ?? []) {
    if (commanders.has(cardId)) continue
    for (let i = 0; i < Math.max(0, quantity); i++) out.push(cardId)
  }
  return out
}

/** The action that deals this deck to a seat. */
export function dealAction(deck, { player = 'you', seed } = {}) {
  return {
    type: 'seat',
    player,
    cards: libraryOf(deck),
    command: [...new Set(deck?.commanders ?? [])],
    seed,
  }
}

/**
 * Dealing and the opening hand as one list of actions, so a new game is a
 * replay of the same log that a reload would replay.
 */
export function openingActions(deck, { player = 'you', seed, hand = OPENING_HAND } = {}) {
  const actions = [dealAction(deck, { player, seed })]
  if (hand > 0 && libraryOf(deck).length) actions.push({ type: 'draw', player, count: hand })
  return actions
}

/**
 * A London mulligan, as actions: the hand goes back, the library is shuffled,
 * and a full seven come off the top again. Putting cards on the bottom is the
 * player's own job afterwards, which is exactly how it works in paper — and
 * the count of how many they owe is the only thing worth keeping.
 */
export function mulliganActions(board, { player = 'you', seed } = {}) {
  const hand = board.zones[player]?.hand ?? []
  const actions = hand.map((id) => ({ type: 'move', id, zone: 'library', to: 'bottom' }))
  actions.push({ type: 'shuffle', player, zone: 'library', seed })
  actions.push({ type: 'draw', player, count: Math.min(OPENING_HAND, board.zones[player]?.library?.length + hand.length || 0) })
  return actions
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

export { OPENING_HAND }
