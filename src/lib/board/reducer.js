/**
 * What you can do at the table.
 *
 * Every action here is physical: move a card, turn it sideways, put it
 * somewhere else, write a number down. None of them consult a rule, so
 * none of them can refuse you for breaking one. The few refusals that do
 * exist are about things that are not physically possible, like drawing
 * from an empty library or moving a card that is not there.
 *
 *   const result = apply(board, action)
 *   // { ok: false, reason: { code, message } }
 *   // { ok: true, board, events }
 *
 * Pure and deterministic: the same board and the same action always give
 * the same result, with no clock and no randomness except a seeded
 * shuffle. That is what makes the action log replayable, which in turn is
 * what makes a reload resume and what will carry the game between two
 * devices.
 */
import { rng, shuffle } from '../goldfish.js'
import { ZONES, ORDERED_ZONES, makeInstance, clampToField, CARD_W, CARD_H } from './model.js'
import { freeSpot, tidy as tidyPositions } from './geometry.js'

const refuse = (code, message) => ({ ok: false, reason: { code, message } })
const clone = (board) => (typeof structuredClone === 'function' ? structuredClone(board) : JSON.parse(JSON.stringify(board)))

export function apply(board, action) {
  if (!action || typeof action.type !== 'string') return refuse('badAction', 'That is not something the table knows how to do.')
  const handler = HANDLERS[action.type]
  if (!handler) return refuse('unknownAction', `The table has no action called "${action.type}".`)
  const next = clone(board)
  next.events = []
  const problem = handler(next, action)
  if (problem) return problem
  next.seq += 1
  const events = next.events
  next.events = []
  return { ok: true, board: next, events }
}

const emit = (board, event) => { board.events.push({ ...event, seq: board.seq + 1 }) }
const list = (board, player, zone) => board.zones[player][zone]

/** Takes a card out of wherever it is. */
function lift(board, id) {
  const inst = board.cards[id]
  if (!inst) return null
  const from = list(board, inst.owner, inst.zone)
  const i = from.indexOf(id)
  if (i >= 0) from.splice(i, 1)
  return inst
}

/**
 * Puts a card into a zone. Leaving the battlefield forgets everything that
 * only meant something there, which is what happens with real cards: a
 * tapped creature that dies is just a card in a graveyard.
 */
function place(board, id, zone, { to = 'top', x, y, owner } = {}) {
  const inst = board.cards[id]
  const player = owner ?? inst.owner
  inst.zone = zone
  if (zone !== 'battlefield') {
    Object.assign(inst, { tapped: false, x: 0.5, y: 0.5, counters: {}, faceDown: zone === 'library' ? false : inst.faceDown, note: '' })
    board.arrows = board.arrows.filter((a) => a.from !== id && a.to !== id)
  } else {
    const others = list(board, player, 'battlefield').map((other) => board.cards[other])
    const wanted = clampToField(x ?? inst.x, y ?? inst.y)
    const spot = x == null && y == null ? freeSpot(wanted, others) : wanted
    Object.assign(inst, spot, { z: board.nextZ++ })
  }
  const into = list(board, player, zone)
  if (to === 'bottom') into.push(id)
  else if (zone === 'library' && to === 'top') into.unshift(id)
  else into.push(id)
  return inst
}

/**
 * Ids come off a counter on the board itself, never a module global, so two
 * devices replaying the same actions invent the same ids for the same tokens.
 */
const freshId = (board, prefix) => {
  board.nextId = (board.nextId ?? 1) + 1
  return `${prefix}-${board.nextId - 1}`
}

const HANDLERS = {
  /**
   * Deals a deck out. The only way cards get onto the table.
   *
   * `command` is dealt to the command zone rather than the library, because a
   * commander is not one of the ninety-nine and a shuffled-in commander would
   * be a different deck.
   */
  seat(board, { player = 'you', cards = [], command = [], shuffle: doShuffle = true, seed }) {
    if (!board.players.includes(player)) return refuse('noSuchPlayer', 'There is no such seat at this table.')
    const gone = new Set()
    for (const zone of ZONES) for (const id of list(board, player, zone)) { gone.add(id); delete board.cards[id] }
    for (const zone of ZONES) board.zones[player][zone] = []
    board.arrows = board.arrows.filter((a) => !gone.has(a.from) && !gone.has(a.to))
    board.revealed = board.revealed.filter((id) => !gone.has(id))
    const order = doShuffle ? shuffle(cards, rng(seed ?? board.seed)) : [...cards]
    const deal = (cardId, zone, i) => {
      const id = `${player}:${zone === 'command' ? 'c' : ''}${i}:${cardId}`
      board.cards[id] = makeInstance({ id, cardId, owner: player, zone })
      board.zones[player][zone].push(id)
    }
    order.forEach((cardId, i) => deal(cardId, 'library', i))
    command.forEach((cardId, i) => deal(cardId, 'command', i))
    emit(board, { type: 'seated', player, count: order.length, command: command.length })
    return null
  },

  draw(board, { player = 'you', count = 1 }) {
    const library = list(board, player, 'library')
    if (!library.length) return refuse('emptyLibrary', 'The library is empty. In a real game, that is how you lose.')
    const n = Math.min(count, library.length)
    for (let i = 0; i < n; i++) {
      const id = library[0]
      lift(board, id)
      place(board, id, 'hand')
      emit(board, { type: 'drew', player, instanceId: id })
    }
    if (n < count) emit(board, { type: 'libraryEmpty', player })
    return null
  },

  /** Moves a card to a zone, optionally to a spot on the battlefield. */
  move(board, { id, zone, to = 'top', x, y, player }) {
    const inst = board.cards[id]
    if (!inst) return refuse('noSuchCard', 'That card is not on this table.')
    if (!ZONES.includes(zone)) return refuse('noSuchZone', 'There is no such zone.')
    const from = inst.zone
    // A token that leaves the battlefield ceases to exist, as it does in paper.
    if (inst.token && from === 'battlefield' && zone !== 'battlefield') {
      lift(board, id)
      delete board.cards[id]
      board.arrows = board.arrows.filter((a) => a.from !== id && a.to !== id)
      emit(board, { type: 'tokenGone', instanceId: id, player: inst.owner })
      return null
    }
    lift(board, id)
    place(board, id, zone, { to, x, y, owner: player })
    // Arriving from anywhere else is arriving this turn, which is the only
    // thing the board knows about summoning sickness. Sliding a card around
    // the battlefield is not an arrival.
    if (zone === 'battlefield' && from !== 'battlefield') inst.enteredOnTurn = board.turn
    if (from !== zone) emit(board, { type: 'moved', instanceId: id, from, to: zone, player: inst.owner })
    else emit(board, { type: 'slid', instanceId: id, x: inst.x, y: inst.y })
    return null
  },

  /** Turns a card sideways, or back. `value` sets it outright, for untap-all. */
  tap(board, { id, value }) {
    const inst = board.cards[id]
    if (!inst) return refuse('noSuchCard', 'That card is not on this table.')
    if (inst.zone !== 'battlefield') return refuse('notOnBattlefield', 'Only a card on the battlefield can be tapped.')
    inst.tapped = value === undefined ? !inst.tapped : Boolean(value)
    emit(board, { type: inst.tapped ? 'tapped' : 'untapped', instanceId: inst.id })
    return null
  },

  untapAll(board, { player = 'you' }) {
    let n = 0
    for (const inst of list(board, player, 'battlefield').map((id) => board.cards[id])) {
      if (inst.tapped) { inst.tapped = false; n++ }
    }
    emit(board, { type: 'untappedAll', player, count: n })
    return null
  },

  /** Face down, for morphs, for a card set aside, or for hiding something. */
  flip(board, { id, value }) {
    const inst = board.cards[id]
    if (!inst) return refuse('noSuchCard', 'That card is not on this table.')
    inst.faceDown = value === undefined ? !inst.faceDown : Boolean(value)
    emit(board, { type: inst.faceDown ? 'turnedDown' : 'turnedUp', instanceId: inst.id })
    return null
  },

  counter(board, { id, name = '+1/+1', delta = 1 }) {
    const inst = board.cards[id]
    if (!inst) return refuse('noSuchCard', 'That card is not on this table.')
    const next = (inst.counters[name] ?? 0) + delta
    if (next === 0) delete inst.counters[name]
    else inst.counters[name] = next
    emit(board, { type: 'countered', instanceId: inst.id, name, value: next })
    return null
  },

  life(board, { player = 'you', delta = 0, value }) {
    if (!board.players.includes(player)) return refuse('noSuchPlayer', 'There is no such seat at this table.')
    board.life[player] = value === undefined ? board.life[player] + delta : value
    emit(board, { type: 'life', player, value: board.life[player], delta: value === undefined ? delta : null })
    return null
  },

  playerCounter(board, { player = 'you', name = 'poison', delta = 1 }) {
    if (!board.players.includes(player)) return refuse('noSuchPlayer', 'There is no such seat at this table.')
    const next = (board.counters[player][name] ?? 0) + delta
    if (next <= 0) delete board.counters[player][name]
    else board.counters[player][name] = next
    emit(board, { type: 'playerCountered', player, name, value: next })
    return null
  },

  shuffle(board, { player = 'you', zone = 'library', seed }) {
    if (!ORDERED_ZONES.includes(zone)) return refuse('cannotShuffle', 'Only a pile with a hidden or meaningful order can be shuffled.')
    const cards = list(board, player, zone)
    board.zones[player][zone] = shuffle(cards, rng(seed ?? board.seed + board.seq))
    emit(board, { type: 'shuffled', player, zone, count: cards.length })
    return null
  },

  /** Puts the top cards of the library somewhere: mill, scry, dig. */
  fromTop(board, { player = 'you', count = 1, zone = 'graveyard', to = 'top' }) {
    const library = list(board, player, 'library')
    if (!library.length) return refuse('emptyLibrary', 'The library is empty.')
    const n = Math.min(count, library.length)
    const moved = []
    for (let i = 0; i < n; i++) {
      const id = library[0]
      lift(board, id)
      place(board, id, zone, { to })
      moved.push(id)
    }
    emit(board, { type: 'fromTop', player, zone, count: n, instanceIds: moved })
    return null
  },

  /** Shows a card to everyone, wherever it is. Reveal again to hide it. */
  reveal(board, { id, value }) {
    const inst = board.cards[id]
    if (!inst) return refuse('noSuchCard', 'That card is not on this table.')
    const on = value === undefined ? !board.revealed.includes(id) : Boolean(value)
    board.revealed = on ? [...new Set([...board.revealed, id])] : board.revealed.filter((r) => r !== id)
    emit(board, { type: on ? 'revealed' : 'hidden', instanceId: id, player: inst.owner })
    return null
  },

  /** A token, or a blank card you name yourself. */
  makeToken(board, { player = 'you', cardId = null, custom = null, x, y, count = 1 }) {
    if (!cardId && !custom?.name) return refuse('needsACard', 'A token needs a card to copy or a name of its own.')
    for (let i = 0; i < Math.max(1, count); i++) {
      const id = freshId(board, `${player}:token`)
      board.cards[id] = makeInstance({ id, cardId, owner: player, zone: 'battlefield', token: true, custom })
      board.cards[id].enteredOnTurn = board.turn
      list(board, player, 'battlefield').push(id)
      const others = list(board, player, 'battlefield').filter((o) => o !== id).map((o) => board.cards[o])
      Object.assign(board.cards[id], freeSpot(clampToField(x ?? 0.5, y ?? 0.4), others), { z: board.nextZ++ })
      emit(board, { type: 'tokenMade', instanceId: id, player })
    }
    return null
  },

  /** An arrow from a card to a card or a player: what is attacking what, what a spell is pointed at. */
  arrow(board, { from, to, kind = 'target' }) {
    const known = (end) => Boolean(board.cards[end]) || board.players.includes(end)
    if (!known(from) || !known(to)) return refuse('noSuchEnd', 'An arrow has to run between two things on the table.')
    if (from === to) return refuse('sameEnd', 'An arrow has to point at something else.')
    const existing = board.arrows.find((a) => a.from === from && a.to === to)
    if (existing) {
      board.arrows = board.arrows.filter((a) => a !== existing)
      emit(board, { type: 'arrowRemoved', from, to })
      return null
    }
    board.arrows.push({ id: freshId(board, 'arrow'), from, to, kind })
    emit(board, { type: 'arrowDrawn', from, to, kind })
    return null
  },

  clearArrows(board) {
    const n = board.arrows.length
    board.arrows = []
    emit(board, { type: 'arrowsCleared', count: n })
    return null
  },

  roll(board, { sides = 6, seed, label = '' }) {
    const random = rng(seed ?? board.seed + board.seq)
    const value = 1 + Math.floor(random() * Math.max(2, sides))
    board.dice = [{ id: freshId(board, 'die'), sides, value, label }, ...board.dice].slice(0, 6)
    emit(board, { type: 'rolled', sides, value, label })
    return null
  },

  /** Straightens the board into rows, the way a player tidies mid-game. */
  tidy(board, { player = 'you', lands = [] }) {
    const cards = list(board, player, 'battlefield').map((id) => board.cards[id])
    const isLand = (c) => lands.includes(c.id)
    for (const placed of tidyPositions(cards, { isLand })) Object.assign(board.cards[placed.id], { x: placed.x, y: placed.y })
    emit(board, { type: 'tidied', player, count: cards.length })
    return null
  },

  /** The turn counter and the step label are the player's to set. The board never advances them. */
  setTurn(board, { turn, active, step }) {
    if (turn !== undefined) board.turn = Math.max(1, Math.round(turn))
    if (active !== undefined && board.players.includes(active)) board.active = active
    if (step !== undefined) board.step = step
    for (const inst of Object.values(board.cards)) if (inst.zone === 'battlefield' && inst.enteredOnTurn === 0) inst.enteredOnTurn = board.turn
    emit(board, { type: 'turnSet', turn: board.turn, active: board.active, step: board.step })
    return null
  },

  nextTurn(board, { player }) {
    const i = board.players.indexOf(board.active)
    const next = player ?? board.players[(i + 1) % board.players.length]
    if (board.players.indexOf(next) <= i || board.players.length === 1) board.turn += 1
    board.active = next
    board.step = null
    emit(board, { type: 'turnBegan', turn: board.turn, active: next })
    return null
  },

  note(board, { id, text = '' }) {
    if (id) {
      const inst = board.cards[id]
      if (!inst) return refuse('noSuchCard', 'That card is not on this table.')
      inst.note = String(text).slice(0, 120)
      emit(board, { type: 'noted', instanceId: id })
      return null
    }
    board.notes = String(text).slice(0, 2000)
    emit(board, { type: 'noted' })
    return null
  },
}

/** Marks a card as having arrived this turn, which is all the board knows about sickness. */
export function markEntered(board, id) {
  const inst = board.cards[id]
  if (inst) inst.enteredOnTurn = board.turn
  return board
}

export { CARD_W, CARD_H }
