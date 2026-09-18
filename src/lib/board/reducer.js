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
import { ZONES, ORDERED_ZONES, makeInstance, clampToField, attachedTo, CARD_W, CARD_H } from './model.js'
import { FINISHES } from './art.js'
import { snapToLane, laneById } from './placement.js'
import { nextStep as stepAfter, STEPS, FIRST_STEP } from '../../data/turn-structure.js'
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
    Object.assign(inst, { tapped: false, x: 0.5, y: 0.5, counters: {}, faceDown: zone === 'library' ? false : inst.faceDown, note: '', attachedTo: null })
    board.arrows = board.arrows.filter((a) => a.from !== id && a.to !== id)
    // Whatever was on it falls off, which is what happens when the thing
    // underneath leaves the table.
    for (const other of Object.values(board.cards)) if (other.attachedTo === id) other.attachedTo = null
  } else {
    const others = list(board, player, 'battlefield').map((other) => board.cards[other])
    const wanted = clampToField(x ?? inst.x, y ?? inst.y)
    /*
     * On a marked playmat the row is decided by what the card is and the
     * place along it is still yours: you choose the order your creatures
     * stand in, not which row they stand in. A free spot is only searched
     * for on a bare table, where nothing decides the row.
     */
    let spot
    if (board.guided && inst.lane) {
      spot = snapToLane(inst.lane, { x: wanted.x })
    } else {
      spot = x == null && y == null ? freeSpot(wanted, others) : wanted
    }
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
  seat(board, { player = 'you', cards = [], command = [], lanes = {}, shuffle: doShuffle = true, seed }) {
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
      // `lanes` comes in with the action rather than being looked up here, so
      // the reducer still knows nothing about what a card is, and a replay on
      // another device reaches the same table.
      if (Object.prototype.hasOwnProperty.call(lanes, cardId)) board.cards[id].lane = lanes[cardId]
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
    // The one rule this table keeps: a card that does not stay on the
    // battlefield may not be left there. The screen says which card and what
    // happens to it instead; the code only knows it has no row to sit in.
    if (board.guided && zone === 'battlefield' && inst.lane === null) {
      return refuse('notAPermanent', 'That card does not stay on the battlefield.')
    }
    const from = inst.zone
    // A token that leaves the battlefield ceases to exist, as it does in paper.
    if (inst.token && from === 'battlefield' && zone !== 'battlefield') {
      lift(board, id)
      delete board.cards[id]
      board.arrows = board.arrows.filter((a) => a.from !== id && a.to !== id)
      // Anything sitting on it, and anything it was sitting on, comes apart:
      // the card it pointed at is not there any more to point at.
      for (const other of Object.values(board.cards)) if (other.attachedTo === id) other.attachedTo = null
      emit(board, { type: 'tokenGone', instanceId: id, player: inst.owner })
      return null
    }
    // An aura goes where the creature goes. Working out the shift before the
    // card moves is what makes a pile stay a pile.
    const riders = from === 'battlefield' && zone === 'battlefield' ? attachedTo(board, id) : []
    const was = { x: inst.x, y: inst.y }
    lift(board, id)
    place(board, id, zone, { to, x, y, owner: player })
    for (const rider of riders) {
      const spot = clampToField(rider.x + (inst.x - was.x), rider.y + (inst.y - was.y))
      Object.assign(board.cards[rider.id], spot, { z: board.nextZ++ })
    }
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

  /**
   * Which copy of the printing this is. Not a rule and not a property of the
   * card: two people with the same decklist can have one foil Sol Ring
   * between them, and the one who has it wants to see it.
   */
  finish(board, { id, value = 'normal' }) {
    const inst = board.cards[id]
    if (!inst) return refuse('noSuchCard', 'That card is not on this table.')
    if (!FINISHES.includes(value)) return refuse('noSuchFinish', 'Cards come in ordinary, foil and etched.')
    inst.finish = value
    emit(board, { type: 'finished', instanceId: id, value })
    return null
  },

  /**
   * Swapping every copy of one printing for another, which is what happens
   * when someone opens a nicer version and puts it in the deck. Identity,
   * position and everything done to a card are untouched: it is the same
   * card in different clothes.
   */
  reprint(board, { from, to, finish }) {
    if (!from || !to) return refuse('needsACard', 'A swap needs a printing to change from and one to change to.')
    let n = 0
    for (const inst of Object.values(board.cards)) {
      if (inst.cardId !== from) continue
      inst.cardId = to
      if (finish && FINISHES.includes(finish)) inst.finish = finish
      n += 1
    }
    if (!n) return refuse('noSuchCard', 'No copy of that printing is on this table.')
    emit(board, { type: 'reprinted', from, to, count: n })
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
  makeToken(board, { player = 'you', cardId = null, custom = null, lane = 'creatures', x, y, count = 1 }) {
    if (!cardId && !custom?.name) return refuse('needsACard', 'A token needs a card to copy or a name of its own.')
    if (board.guided && lane === null) return refuse('notAPermanent', 'A token has to be something that stays on the battlefield.')
    for (let i = 0; i < Math.max(1, count); i++) {
      const id = freshId(board, `${player}:token`)
      board.cards[id] = makeInstance({ id, cardId, owner: player, zone: 'battlefield', token: true, custom })
      board.cards[id].enteredOnTurn = board.turn
      board.cards[id].lane = lane
      list(board, player, 'battlefield').push(id)
      const others = list(board, player, 'battlefield').filter((o) => o !== id).map((o) => board.cards[o])
      const wanted = clampToField(x ?? 0.5, y ?? 0.4)
      const spot = board.guided && lane ? snapToLane(lane, { x: wanted.x }) : freeSpot(wanted, others)
      Object.assign(board.cards[id], spot, { z: board.nextZ++ })
      emit(board, { type: 'tokenMade', instanceId: id, player })
    }
    return null
  },

  /**
   * Putting one card on another: an aura on a creature, an equipment on one,
   * a counter card under a permanent. The board does not know what any of
   * that means — only that the two travel together and come apart when
   * either leaves the table.
   */
  attach(board, { id, to }) {
    const inst = board.cards[id]
    const host = board.cards[to]
    if (!inst || !host) return refuse('noSuchCard', 'That card is not on this table.')
    if (id === to) return refuse('sameEnd', 'A card cannot be put on itself.')
    if (inst.zone !== 'battlefield' || host.zone !== 'battlefield') return refuse('notOnBattlefield', 'Both cards have to be on the battlefield.')
    // Following the chain up from the host: if it comes back here, this would
    // be two cards each sitting on the other.
    let at = host.attachedTo
    while (at) {
      if (at === id) return refuse('wouldLoop', 'Those two are already holding each other up.')
      at = board.cards[at]?.attachedTo ?? null
    }
    // Down and to the right by about a third of a card, the way a player lays
    // an aura so that the creature's name and numbers still read; a second
    // one goes further down again.
    const depth = attachedTo(board, to).filter((c) => c.attachedTo === to).length
    inst.attachedTo = to
    const spot = clampToField(host.x + CARD_W * 0.3, host.y + CARD_H * (0.45 + depth * 0.3))
    Object.assign(inst, spot, { z: board.nextZ++ })
    emit(board, { type: 'attached', instanceId: id, to, player: inst.owner })
    return null
  },

  detach(board, { id }) {
    const inst = board.cards[id]
    if (!inst) return refuse('noSuchCard', 'That card is not on this table.')
    if (!inst.attachedTo) return refuse('notAttached', 'That card is not on anything.')
    const host = inst.attachedTo
    inst.attachedTo = null
    Object.assign(inst, clampToField(inst.x, inst.y + CARD_H * 0.6), { z: board.nextZ++ })
    emit(board, { type: 'detached', instanceId: id, from: host, player: inst.owner })
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

  /**
   * Straightens the board into rows, the way a player tidies mid-game.
   * Attached cards are not laid out on their own — they follow whatever they
   * are sitting on, or tidying would take every aura off its creature.
   */
  tidy(board, { player = 'you', lands = [] }) {
    const all = list(board, player, 'battlefield').map((id) => board.cards[id])
    const loose = all.filter((c) => !c.attachedTo)

    // On a marked playmat, tidying means spacing each row out along its own
    // line — the rows are already decided, so there is nothing to sort.
    if (board.guided) {
      const byLane = new Map()
      for (const inst of loose) {
        const lane = inst.lane ?? 'other'
        if (!byLane.has(lane)) byLane.set(lane, [])
        byLane.get(lane).push(inst)
      }
      for (const [lane, cards] of byLane) {
        const gap = Math.min(CARD_W * 1.5, (1 - CARD_W) / Math.max(1, cards.length - 1))
        const width = gap * (cards.length - 1)
        cards.forEach((inst, i) => {
          const spot = snapToLane(lane, { x: clampToField(0.5 - width / 2 + i * gap, 0.5).x })
          const shift = { x: spot.x - inst.x, y: spot.y - inst.y }
          Object.assign(board.cards[inst.id], spot)
          for (const rider of attachedTo(board, inst.id)) {
            Object.assign(board.cards[rider.id], clampToField(rider.x + shift.x, rider.y + shift.y))
          }
        })
      }
      emit(board, { type: 'tidied', player, count: all.length })
      return null
    }

    const isLand = (c) => lands.includes(c.id)
    for (const placed of tidyPositions(loose, { isLand })) {
      const inst = board.cards[placed.id]
      const shift = { x: placed.x - inst.x, y: placed.y - inst.y }
      Object.assign(inst, { x: placed.x, y: placed.y })
      for (const rider of attachedTo(board, placed.id)) {
        Object.assign(board.cards[rider.id], clampToField(rider.x + shift.x, rider.y + shift.y))
      }
    }
    emit(board, { type: 'tidied', player, count: all.length })
    return null
  },

  /**
   * Where in the turn we are.
   *
   * The board walks the phases and steps of `src/data/turn-structure.js` but
   * resolves nothing on the player's behalf: it is a tracker, not a judge. It
   * skips the first-strike damage step unless the caller says something in
   * combat has first strike, which is what the rules do (510.4) and what
   * saves pressing past a step that almost never happens.
   */
  step(board, { to = null, hasFirstStrike = false }) {
    const before = board.step
    if (to) {
      if (!STEPS.some((s) => s.id === to)) return refuse('noSuchStep', 'There is no such step in a turn.')
      board.step = to
      emit(board, { type: 'stepped', from: before, to, turn: board.turn })
      return null
    }
    const { step, wrapped } = stepAfter(before ?? FIRST_STEP, { hasFirstStrike })
    board.step = step.id
    if (wrapped) {
      const i = board.players.indexOf(board.active)
      const next = board.players[(i + 1) % board.players.length]
      if (board.players.indexOf(next) <= i || board.players.length === 1) board.turn += 1
      board.active = next
      emit(board, { type: 'turnBegan', turn: board.turn, active: next })
    }
    emit(board, { type: 'stepped', from: before, to: step.id, turn: board.turn })
    return null
  },

  /** A marked playmat, or a bare table. The player's to choose, either way. */
  setGuided(board, { value = true }) {
    board.guided = Boolean(value)
    emit(board, { type: 'guided', value: board.guided })
    return null
  },

  /** The turn counter and the step label are the player's to set. The board never advances them. */
  setTurn(board, { turn, active, step }) {
    if (turn !== undefined) board.turn = Math.max(1, Math.round(turn))
    if (active !== undefined && board.players.includes(active)) board.active = active
    if (step !== undefined && (step === null || STEPS.some((s) => s.id === step))) board.step = step
    for (const inst of Object.values(board.cards)) if (inst.zone === 'battlefield' && inst.enteredOnTurn === 0) inst.enteredOnTurn = board.turn
    emit(board, { type: 'turnSet', turn: board.turn, active: board.active, step: board.step })
    return null
  },

  nextTurn(board, { player }) {
    const i = board.players.indexOf(board.active)
    const next = player ?? board.players[(i + 1) % board.players.length]
    if (board.players.indexOf(next) <= i || board.players.length === 1) board.turn += 1
    board.active = next
    board.step = FIRST_STEP
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
