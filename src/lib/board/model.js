/**
 * The board: a table, not a judge.
 *
 * This model holds where every card is and what has been done to it. It
 * never holds what a card *does*. That one restriction is what lets any
 * card in Scryfall be played the moment it is fetched, including cards
 * whose rules text nothing here could parse. The player enforces the
 * rules, exactly as they do on a kitchen table; the app moves the cards
 * and remembers the state.
 *
 * The teaching engine in `src/lib/table/` is the opposite: it knows a few
 * cards completely and refuses anything illegal. They share patterns and
 * nothing else, on purpose.
 *
 * Positions are fractions of the battlefield, so a board laid out on a
 * phone reads the same on a desktop. See `geometry.js`.
 */
import { clampToField, CARD_W, CARD_H } from './geometry.js'
import { FINISHES } from './art.js'
import { FIRST_STEP } from '../../data/turn-structure.js'

export const ZONES = ['library', 'hand', 'battlefield', 'stack', 'graveyard', 'exile', 'command']
export const ZONE_LABELS = {
  library: 'Library', hand: 'Hand', battlefield: 'Battlefield', stack: 'The stack',
  graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone',
}
/** Zones whose order is secret or meaningful. A shuffle only makes sense for the library. */
export const ORDERED_ZONES = ['library', 'graveyard', 'exile']

export const DEFAULT_COUNTERS = ['+1/+1', '-1/-1', 'loyalty', 'charge', 'other']

/**
 * A card on the table. `cardId` is the Scryfall id of the printing, so two
 * copies of the same card are two instances of one printing, and swapping
 * the printing later changes the art without disturbing the game.
 *
 * `token` marks something created during the game rather than dealt from a
 * deck: it ceases to exist when it leaves the battlefield, the way a real
 * token does, and the board says so rather than filing it in a graveyard.
 */
export function makeInstance({ id, cardId, owner = 'you', zone = 'library', token = false, custom = null }) {
  return {
    id,
    cardId,
    owner,
    controller: owner,
    zone,
    x: 0.5,
    y: 0.5,
    tapped: false,
    faceDown: false,
    flipped: false,
    counters: {},
    note: '',
    attachedTo: null, // an aura on a creature, an equipment on one: position, not rules
    finish: 'normal', // which copy of the printing this is: normal, foil, etched
    /*
     * Which row of the playmat this card belongs in, or null for a card that
     * never stays on the battlefield at all. Worked out from the type line by
     * placement.js and stamped here when the card is dealt, so the reducer can
     * keep the playmat honest without ever learning what a card does — and so
     * that two devices replaying the same actions reach the same table.
     */
    lane: 'other',
    token,
    custom, // a made-up card: { name, typeLine, power, toughness, colors, art }
    enteredOnTurn: 0,
    z: 0,
  }
}

export function createBoard({ players = ['you'], seed = 1, turn = 1, active = 'you', guided = true, step = FIRST_STEP } = {}) {
  const byPlayer = (value) => Object.fromEntries(players.map((p) => [p, typeof value === 'function' ? value() : value]))
  return {
    version: 1,
    players,
    seed,
    turn,
    active,
    step, // where in the turn we are: an id from src/data/turn-structure.js
    /*
     * A marked playmat, or a bare table.
     *
     * Guided: cards sit in the row their type belongs to and an instant may
     * not be left on the battlefield, which is what a printed playmat and the
     * rules respectively say. Unguided: the table judges nothing, which is
     * where this screen started and what it falls back to for a card whose
     * type line nothing can parse, a house rule, or a silver-bordered card.
     */
    guided,
    life: byPlayer(20),
    counters: byPlayer(() => ({})), // poison, energy, experience, anything named
    cards: {},
    zones: byPlayer(() => Object.fromEntries(ZONES.map((z) => [z, []]))),
    revealed: [], // instance ids shown to everyone, whatever zone they are in
    arrows: [], // { id, from, to, kind } drawn between cards or players
    dice: [],
    notes: '',
    log: [],
    nextZ: 1,
    nextId: 1, // tokens and arrows take their ids from here, so a replay invents the same ones
    seq: 0,
    events: [],
  }
}

// --- questions -------------------------------------------------------------

export const instanceOf = (board, id) => board.cards[id] ?? null
export const zoneOf = (board, player, zone) => (board.zones[player]?.[zone] ?? []).map((id) => board.cards[id]).filter(Boolean)
export const battlefield = (board, player) => zoneOf(board, player, 'battlefield')
export const handOf = (board, player) => zoneOf(board, player, 'hand')
export const librarySize = (board, player) => (board.zones[player]?.library ?? []).length
/** Everything attached to a card, and everything attached to those. */
export function attachedTo(board, id, seen = new Set()) {
  const out = []
  for (const inst of Object.values(board.cards)) {
    if (inst.attachedTo !== id || seen.has(inst.id)) continue
    seen.add(inst.id)
    out.push(inst, ...attachedTo(board, inst.id, seen))
  }
  return out
}
/** The card this one is on, if any. */
export const hostOf = (board, id) => {
  const inst = board.cards[id]
  return inst?.attachedTo ? board.cards[inst.attachedTo] ?? null : null
}
export const isRevealed = (board, id) => board.revealed.includes(id)

/** The name to show, which for a made-up card is whatever it was called. */
export function nameOf(board, id, lookup) {
  const inst = board.cards[id]
  if (!inst) return 'a card'
  if (inst.custom?.name) return inst.custom.name
  return lookup?.(inst.cardId)?.name ?? 'a card'
}

/** Every instance in play order for a zone, so the render and the hit test agree. */
export function stacked(board, player, zone = 'battlefield') {
  return zoneOf(board, player, zone).slice().sort((a, b) => a.z - b.z)
}

/**
 * Things that must always hold. Checked in tests after every action: a
 * failure is a bug in the reducer, never something the player did, because
 * the player cannot do anything wrong on this table.
 */
export function invariants(board) {
  const problems = []
  const seen = new Map()
  for (const player of board.players) {
    for (const zone of ZONES) {
      for (const id of board.zones[player][zone]) {
        if (seen.has(id)) problems.push(`${id} is in ${seen.get(id)} and ${player}/${zone}`)
        seen.set(id, `${player}/${zone}`)
        const inst = board.cards[id]
        if (!inst) problems.push(`${player}/${zone} lists unknown ${id}`)
        else if (inst.zone !== zone) problems.push(`${id} says ${inst.zone} but sits in ${zone}`)
      }
    }
    if (!Number.isFinite(board.life[player])) problems.push(`${player} has a life total that is not a number`)
  }
  for (const id of Object.keys(board.cards)) if (!seen.has(id)) problems.push(`${id} is in no zone`)
  for (const inst of Object.values(board.cards)) {
    if (inst.zone === 'battlefield') {
      if (inst.x < 0 || inst.x > 1 || inst.y < 0 || inst.y > 1) problems.push(`${inst.id} is off the field`)
    } else if (inst.tapped || inst.x !== 0.5 || inst.y !== 0.5) {
      problems.push(`${inst.id} carries battlefield state in the ${inst.zone}`)
    }
    for (const [name, n] of Object.entries(inst.counters)) if (!Number.isFinite(n) || n === 0) problems.push(`${inst.id} has a ${name} counter of ${n}`)
    if (inst.finish && !FINISHES.includes(inst.finish)) problems.push(`${inst.id} has a finish of ${inst.finish}`)
    if (board.guided && inst.zone === 'battlefield' && inst.lane === null) {
      problems.push(`${inst.id} is on the battlefield but belongs in no row`)
    }
    if (inst.attachedTo) {
      const host = board.cards[inst.attachedTo]
      if (!host) problems.push(`${inst.id} is attached to nothing`)
      else if (host.zone !== 'battlefield' || inst.zone !== 'battlefield') problems.push(`${inst.id} is attached outside the battlefield`)
      if (inst.attachedTo === inst.id) problems.push(`${inst.id} is attached to itself`)
    }
  }
  // A chain of attachments has to end somewhere, or moving one would never stop.
  for (const inst of Object.values(board.cards)) {
    const seen = new Set([inst.id])
    let at = inst.attachedTo
    while (at) {
      if (seen.has(at)) { problems.push(`${inst.id} is in a loop of attachments`); break }
      seen.add(at)
      at = board.cards[at]?.attachedTo ?? null
    }
  }
  for (const arrow of board.arrows) {
    if (!board.cards[arrow.from] && !board.players.includes(arrow.from)) problems.push(`an arrow starts nowhere`)
    if (!board.cards[arrow.to] && !board.players.includes(arrow.to)) problems.push(`an arrow ends nowhere`)
  }
  return problems
}

export { clampToField, CARD_W, CARD_H, FINISHES }
