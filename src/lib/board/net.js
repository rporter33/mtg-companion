/**
 * Two devices, one table.
 *
 * The board was written for this from the first commit, and almost all of the
 * work is already done: every action is small, serialisable and free of any
 * clock, the only randomness is a seeded shuffle, and which row a card
 * belongs in travels in the action rather than being looked up locally. Two
 * devices applying the same actions in the same order reach the same table.
 * So this file is not a game engine over a network. It is an agreement about
 * order.
 *
 * ONE PLAYER IS THE TABLE. Somebody has to decide what happened when two
 * people reach for the same card, and the alternative — every peer applying
 * its own actions and reconciling afterwards — means writing conflict
 * resolution for a game that has none, and being wrong occasionally in a way
 * nobody can see. So: the host applies actions and numbers them; everyone
 * else sends an intent and waits for the numbered action to come back.
 *
 * A GUEST DOES NOT APPLY ITS OWN ACTIONS EARLY. Optimistic application and
 * rollback would buy a few milliseconds and cost a class of bug where the
 * table flickers back to a state you just left. Peer to peer on a table in
 * one room is a handful of milliseconds; over the internet it is a fraction
 * of what a card takes to move. The simpler thing is also the correct one.
 *
 * WHAT THE PROTOCOL DOES NOT DO is judge the game. The table still enforces
 * nothing. The one thing checked here is whose card it is — you may move what
 * you control, which is exactly the rule at a real table, and is about
 * reaching across someone rather than about the rules of Magic.
 */
import { act, applyAll, snapshot, restore, newRun } from './runner.js'
import { createBoard } from './model.js'

export const PROTOCOL = 1

/** Every message that can cross the wire. Small enough to read in a log. */
export const KIND = {
  hello: 'hello',       // guest -> host: I am here
  welcome: 'welcome',   // host -> guest: your seat, and the table as it stands
  intent: 'intent',     // guest -> host: please do this
  action: 'action',     // host -> all: this happened, and it is number N
  refused: 'refused',   // host -> one guest: it did not, and why
  resync: 'resync',     // guest -> host: I lost my place, send the table again
  seat: 'seat',         // host -> all: who is sitting where
  bye: 'bye',           // either way: I am leaving
}

/** Actions nobody owns: they are about the table, not about a card. */
const PUBLIC = new Set(['arrow', 'clearArrows', 'roll', 'note', 'step', 'setTurn', 'nextTurn', 'setGuided', 'tidy'])

/**
 * Whose action is this, and may they take it?
 *
 * You may move what you control. That is the rule at a real table — nobody
 * reaches across and taps someone else's creature — and it happens to be the
 * same word the rules use when a spell takes control of something, so a
 * stolen creature becomes yours to turn sideways without a special case.
 */
export function mayDo(board, seat, action) {
  if (!action || typeof action.type !== 'string') return false
  if (PUBLIC.has(action.type)) return true
  if (action.player !== undefined) return action.player === seat
  const id = action.id ?? action.from
  const inst = id ? board.cards[id] : null
  if (!inst) return true // seating, dealing, making a token: nothing to own yet
  return inst.controller === seat || inst.owner === seat
}

// --- the host --------------------------------------------------------------

/**
 * The table.
 *
 * Holds the run, applies what it is asked, numbers every action it applies
 * and tells everyone. `send(message, to)` with no `to` is a broadcast.
 */
/**
 * `seat: null` is a table nobody is sitting at — a relay server holding the
 * game for the people who are. `seq` and `seats` are how such a table comes
 * back from disk: the numbering carries on where it stopped, and everyone
 * who was seated is still seated, just not here until they reconnect.
 */
export function host({ run = newRun(createBoard({ players: ['p1'] })), seat = 'p1', send, name = 'Table', seq = 0, seats = null } = {}) {
  const sitting = new Map()
  if (seat) sitting.set(seat, { seat, name, here: true })
  for (const s of seats ?? []) if (s?.seat) sitting.set(s.seat, { seat: s.seat, name: s.name || 'Player', here: false })
  const state = { run, seat, seq, seats: sitting, log: [] }

  /**
   * Applies an action, numbers it, and tells everyone it happened.
   *
   * `id` is the intent it came from, echoed back so the player who asked can
   * stop waiting on it. Everyone else sees an id that means nothing to them,
   * which is cheaper than sending two messages.
   */
  const apply = (action, by = seat, id = null) => {
    const before = state.run
    const next = act(before, action)
    if (next.refusal) return { ok: false, reason: next.refusal }
    state.run = next
    state.seq += 1
    const message = { t: KIND.action, seq: state.seq, action, by, id, protocol: PROTOCOL }
    state.log.push(message)
    // Bounded: a resync sends the whole table anyway, so the log only has to
    // cover a stutter, not a whole game.
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200)
    send?.(message)
    return { ok: true, seq: state.seq }
  }

  /**
   * The seat a newcomer gets. Their own old seat back if they had one and it
   * is empty — a reconnect — otherwise the first free one in order, or null
   * when the board has no more.
   */
  const seatFor = (wanted) => {
    const players = state.run.board.players
    const free = (s) => players.includes(s) && !(state.seats.get(s)?.here)
    if (wanted && free(wanted)) return wanted
    return players.find((s) => !state.seats.has(s)) ?? null
  }

  /** The next seat with somebody in it, in turn order, after the active one. */
  const nextOccupied = () => {
    const players = state.run.board.players
    const i = players.indexOf(state.run.board.active)
    for (let k = 1; k <= players.length; k++) {
      const s = players[(i + k) % players.length]
      if (state.seats.has(s)) return s
    }
    return state.run.board.active
  }

  const table = () => ({
    t: KIND.welcome,
    protocol: PROTOCOL,
    seq: state.seq,
    snapshot: snapshot(state.run),
    seats: [...state.seats.values()],
  })

  /** A message from a guest. Returns nothing; replies go out through `send`. */
  const receive = (message, from) => {
    if (!message || message.protocol !== PROTOCOL) {
      send?.({ t: KIND.refused, reason: { code: 'protocol', message: 'That app is a different version of this one.' } }, from)
      return
    }
    switch (message.t) {
      case KIND.hello: {
        const given = seatFor(message.seat)
        if (!given) {
          send?.({ t: KIND.refused, protocol: PROTOCOL, reason: { code: 'full', message: 'Every seat at this table is taken.' } }, from)
          return
        }
        state.seats.set(given, { seat: given, name: message.name || state.seats.get(given)?.name || 'Player', here: true })
        send?.({ ...table(), seat: given }, from)
        send?.({ t: KIND.seat, protocol: PROTOCOL, seats: [...state.seats.values()] })
        break
      }
      case KIND.resync:
        send?.({ ...table(), seat: message.seat }, from)
        break
      case KIND.intent: {
        if (!mayDo(state.run.board, message.seat, message.action)) {
          send?.({
            t: KIND.refused, id: message.id, protocol: PROTOCOL,
            reason: { code: 'notYours', message: 'That is not your card to move.' },
          }, from)
          return
        }
        let action = message.action
        /*
         * The one thing decided here and nowhere else: whose turn it is.
         * Only the active player may pass, and the table says who is next —
         * the next seat anyone is actually sitting in, so a four-seat table
         * with two people at it does not hand turns to empty chairs. A
         * client's own idea of the next player is ignored, so nobody can pass
         * the turn to themselves. This is the "both players think it is their
         * turn" case, closed the same way Moxgate closes it: in one place.
         */
        if (action.type === 'nextTurn') {
          if (message.seat !== state.run.board.active) {
            send?.({
              t: KIND.refused, id: message.id, protocol: PROTOCOL,
              reason: { code: 'notYourTurn', message: 'Only the player whose turn it is can end it.' },
            }, from)
            return
          }
          action = { type: 'nextTurn', player: nextOccupied() }
        }
        const result = apply(action, message.seat, message.id)
        if (!result.ok) send?.({ t: KIND.refused, id: message.id, protocol: PROTOCOL, reason: result.reason }, from)
        break
      }
      case KIND.bye: {
        const sitting = state.seats.get(message.seat)
        if (sitting) sitting.here = false
        send?.({ t: KIND.seat, protocol: PROTOCOL, seats: [...state.seats.values()] })
        break
      }
      default:
        break
    }
  }

  return {
    get run() { return state.run },
    get seq() { return state.seq },
    get seats() { return [...state.seats.values()] },
    seat,
    isHost: true,
    /** The host's own action: applied straight away, because it is the table. */
    do: (action) => apply(action, seat),
    receive,
    table,
  }
}

// --- a guest ---------------------------------------------------------------

/**
 * Somebody else's table, on your screen.
 *
 * Applies what the host says happened, in the order the host says it
 * happened. A gap in the numbering means a message was lost, and rather than
 * guessing, it asks for the table again — which is cheap, because a table is
 * one snapshot and not a game's worth of history.
 */
export function guest({ send, seat = null, name = 'Player', onRefused = null, onSeats = null } = {}) {
  const state = { run: null, seat, seq: 0, seats: [], waiting: new Map(), ready: false }

  const hello = () => send?.({ t: KIND.hello, protocol: PROTOCOL, seat: state.seat, name })

  const receive = (message) => {
    if (!message || message.protocol !== PROTOCOL) return
    switch (message.t) {
      case KIND.welcome: {
        const run = restore(message.snapshot)
        if (!run) return
        state.run = run
        state.seq = message.seq
        state.seat = message.seat ?? state.seat
        state.seats = message.seats ?? []
        state.ready = true
        onSeats?.(state.seats)
        break
      }
      case KIND.seat:
        state.seats = message.seats ?? []
        onSeats?.(state.seats)
        break
      case KIND.action: {
        if (!state.ready) return
        if (message.seq <= state.seq) return // already applied; a repeat is harmless
        if (message.seq !== state.seq + 1) { send?.({ t: KIND.resync, protocol: PROTOCOL, seat: state.seat }); return }
        const next = act(state.run, message.action)
        // A refusal here means the two tables have drifted, which should be
        // impossible and is worth recovering from rather than living with.
        if (next.refusal) { send?.({ t: KIND.resync, protocol: PROTOCOL, seat: state.seat }); return }
        state.run = next
        state.seq = message.seq
        if (message.id) state.waiting.delete(message.id)
        break
      }
      case KIND.refused: {
        const pending = state.waiting.get(message.id)
        state.waiting.delete(message.id)
        onRefused?.(message.reason, pending)
        break
      }
      default:
        break
    }
  }

  let counter = 0
  /** Asks for something to happen. Nothing changes here until it comes back. */
  const propose = (action) => {
    const id = `${state.seat ?? 'p'}-${++counter}`
    state.waiting.set(id, action)
    send?.({ t: KIND.intent, protocol: PROTOCOL, id, seat: state.seat, action })
    return id
  }

  return {
    get run() { return state.run },
    get seq() { return state.seq },
    get seat() { return state.seat },
    get seats() { return state.seats },
    get ready() { return state.ready },
    get pending() { return state.waiting.size },
    isHost: false,
    do: propose,
    receive,
    hello,
    leave: () => send?.({ t: KIND.bye, protocol: PROTOCOL, seat: state.seat }),
  }
}

// --- transports ------------------------------------------------------------

/**
 * Wires for tests: a hub and any number of endpoints, delivering messages
 * synchronously. Everything the protocol does can be checked through this
 * without a browser, a server or a network.
 */
export function loopback() {
  const peers = new Map()
  let hubReceive = null
  return {
    hub: {
      send: (message, to) => {
        const copy = () => JSON.parse(JSON.stringify(message))
        if (to) peers.get(to)?.(copy())
        else for (const deliver of peers.values()) deliver(copy())
      },
      onMessage: (handler) => { hubReceive = handler },
    },
    connect: (id) => ({
      send: (message) => hubReceive?.(JSON.parse(JSON.stringify(message)), id),
      onMessage: (handler) => { peers.set(id, handler) },
      close: () => peers.delete(id),
    }),
    drop: (id) => peers.delete(id),
  }
}

export { snapshot, restore, applyAll }
