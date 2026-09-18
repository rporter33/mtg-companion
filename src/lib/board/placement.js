/**
 * Where a card belongs on the table, and what may sit on the battlefield.
 *
 * A printed playmat has areas marked on it: lands nearest you, creatures in
 * front of them, everything else beside. None of that is in the rules — the
 * Comprehensive Rules say nothing about board layout — but it is how every
 * table is actually laid out, and a new player whose permanents are in one
 * heap cannot read their own board. So the field is marked into lanes and a
 * card goes to the lane its type belongs to.
 *
 * One thing here *is* a rule, and it is the one beginners get wrong most
 * often: an instant or a sorcery never stays on the battlefield. It is cast,
 * it goes on the stack, it resolves, and then it goes to the graveyard. A
 * table that lets you leave a Lightning Bolt sitting next to your creatures
 * has taught you something false.
 *
 * Everything here reads Scryfall's type line and nothing else, so it works
 * for every card ever printed without a list to maintain.
 */
import { typeLineOf } from '../formats.js'

/**
 * The lanes, back of the table to front. `y` is the middle of the band as a
 * fraction of the field; `band` is how tall it is.
 *
 * Lands are nearest the player because that is where a hand reaches most
 * often, and creatures are in front of them because that is the row that
 * attacks and blocks.
 */
export const LANES = [
  { id: 'siege', name: 'Planeswalkers and battles', short: 'Planeswalkers', y: 0.11, band: 0.2 },
  { id: 'creatures', name: 'Creatures', short: 'Creatures', y: 0.35, band: 0.24 },
  { id: 'other', name: 'Artifacts and enchantments', short: 'Artifacts and enchantments', y: 0.60, band: 0.22 },
  { id: 'lands', name: 'Lands', short: 'Lands', y: 0.84, band: 0.24 },
]

export const laneById = (id) => LANES.find((lane) => lane.id === id) ?? null

/** A type line, whichever face carries it. */
const lineOf = (card, inst) => inst?.custom?.typeLine ?? typeLineOf(card ?? {})
const has = (line, word) => new RegExp(`\\b${word}\\b`, 'i').test(line)

/**
 * The lane a card belongs in, or null if it does not belong on the
 * battlefield at all.
 *
 * The order of these tests is the whole content of the function. A land that
 * is also a creature — Dryad Arbor, a creature-land that has been animated —
 * is a land first, because that is where its owner will look for it. A
 * planeswalker or a battle that is somehow also a creature is still the
 * thing that gets attacked, so it sits with them.
 */
export function laneFor(card, inst = null) {
  const line = lineOf(card, inst)
  // A card nothing can identify still has to go somewhere: the middle lane,
  // where an unknown permanent is least in the way.
  if (!line) return 'other'
  if (has(line, 'Land')) return 'lands'
  if (has(line, 'Planeswalker') || has(line, 'Battle')) return 'siege'
  if (has(line, 'Creature')) return 'creatures'
  if (has(line, 'Instant') || has(line, 'Sorcery')) return null
  return 'other'
}

/** Does this card stay on the battlefield once it has resolved? */
export const isPermanent = (card, inst = null) => laneFor(card, inst) !== null

/**
 * Why a card may not be put on the battlefield, in words, or null when it
 * may. The message is the teaching: it says what happens instead.
 */
export function refuseBattlefield(card, inst = null) {
  const line = lineOf(card, inst)
  if (!line) return null
  if (has(line, 'Instant')) {
    return 'An instant does not stay on the battlefield. Cast it: it goes on the stack, and to the graveyard once it has resolved.'
  }
  if (has(line, 'Sorcery')) {
    return 'A sorcery does not stay on the battlefield. Cast it in a main phase while the stack is empty; it goes to the graveyard once it has resolved.'
  }
  return null
}

/**
 * A spot inside a lane: the x where it was dropped, snapped to the lane's
 * row. Dropping is still free across the table — you choose the order your
 * creatures sit in — it is only the row that is decided by what the card is.
 */
export function snapToLane(laneId, { x = 0.5, y = null } = {}) {
  const lane = laneById(laneId)
  if (!lane) return { x, y: y ?? 0.5 }
  return { x, y: lane.y }
}

/** Which lane a point falls in, for showing the person where a drop will land. */
export function laneAt(y) {
  let best = LANES[0]
  for (const lane of LANES) {
    if (Math.abs(lane.y - y) < Math.abs(best.y - y)) best = lane
  }
  return best.id
}

/**
 * Where a card should go when it is played from hand: the battlefield for a
 * permanent, the stack for anything else. The stack is the honest answer —
 * it is where a spell actually goes — and it is the step this app most wants
 * a new player to notice.
 */
export function zoneWhenPlayed(card, inst = null) {
  return isPermanent(card, inst) ? 'battlefield' : 'stack'
}
