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

export const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']
export const ZONE_LABELS = {
  library: 'Library', hand: 'Hand', battlefield: 'Battlefield',
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
    token,
    custom, // a made-up card: { name, typeLine, power, toughness, colors, art }
    enteredOnTurn: 0,
    z: 0,
  }
}

export function createBoard({ players = ['you'], seed = 1, turn = 1, active = 'you' } = {}) {
  const byPlayer = (value) => Object.fromEntries(players.map((p) => [p, typeof value === 'function' ? value() : value]))
  return {
    version: 1,
    players,
    seed,
    turn,
    active,
    step: null, // a label the player sets; the board never advances it on its own
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
  }
  for (const arrow of board.arrows) {
    if (!board.cards[arrow.from] && !board.players.includes(arrow.from)) problems.push(`an arrow starts nowhere`)
    if (!board.cards[arrow.to] && !board.players.includes(arrow.to)) problems.push(`an arrow ends nowhere`)
  }
  return problems
}

export { clampToField, CARD_W, CARD_H }
