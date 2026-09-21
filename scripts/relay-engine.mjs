/**
 * A rules-enforced room: the relay's other authority.
 *
 * An unenforced room is a table the relay holds (`relay-server.mjs`). An
 * enforced room is a table the engine holds: one engine process per room
 * (engine/README.md), started the moment every human seat has sat down with
 * a deck, and spoken to through `engine-bridge.mjs`. The browser talks to
 * both kinds of room over the same socket; what differs is the messages,
 * all of them `{ t: 'engine', op }` here, and who decides. Nothing in this
 * file knows a rule of Magic either — it knows whose turn the engine says
 * it is, and forwards.
 *
 *   from a client        sit { name, deck: { "Mountain": 14, … }, sideboard?: { … }, seat? }
 *                        act { stop, index, attackers?, blockers? }
 *                        decide { stop, … }        turn
 *   to every client      seats [ … ]               status { … }            gone { reason }
 *   to one client        seated { seat, engineSeat, sideboardLeftOut, unknownPrintings }   view { you, state, log }   refused { error }
 *
 * `stop` is the number of the status a client is answering: an act sent
 * against a stale status is refused rather than landing on a different
 * offer with the same index.
 */
import { startEngine } from './engine-bridge.mjs'

export const OP = {
  sit: 'sit', act: 'act', decide: 'decide', turn: 'turn',
  seated: 'seated', seats: 'seats', status: 'status', view: 'view', refused: 'refused', gone: 'gone',
}

// How long an engine's first answer may take. It loads the whole card corpus
// before it reads a line, which is far slower than any answer after it. An
// allowance rather than a measurement: engine/README.md has the measured load,
// and this is revisited against it.
export const STARTUP_MS = 120_000

// A deck line is a count, or a printing with a count, or a list of those.
const copiesOf = (v) => {
  if (Array.isArray(v)) return v.reduce((sum, x) => sum + copiesOf(x), 0)
  const n = typeof v === 'number' ? v : v?.count
  return Number.isInteger(n) && n > 0 ? n : 0
}
// An engine at protocol 1 reads a deck line only as a count, so it is sent only
// counts: the printings are lost, but the game is dealt rather than refused.
const forProtocol = (protocol, lines) => (!lines || protocol >= 2 ? lines : Object.fromEntries(Object.entries(lines).map(([name, v]) => [name, copiesOf(v)])))

export function createEngineRoom({ code, seats: seatCount, ai = 'heuristic', engineCommand, seed = null, deliver, onStderr = null }) {
  const humanSeats = Math.max(1, ai ? seatCount - 1 : seatCount)
  const seats = Array.from({ length: seatCount }, (_, i) => ({
    seat: `p${i + 1}`, name: null, here: false, ready: false, socket: null, deck: null, sideboard: null,
    ai: ai && i === seatCount - 1 ? ai : null, engineSeat: null, sideboardLeftOut: [], unknownPrintings: [],
  }))
  const seated = (seat) => ({ seat: seat.seat, engineSeat: seat.engineSeat, sideboardLeftOut: seat.sideboardLeftOut, unknownPrintings: seat.unknownPrintings })
  const sockets = new Map()
  let engine = null
  // The last process this room started, kept even after the room has let it
  // go, so a test can see that one which failed to deal was closed.
  let lastStarted = null
  let status = null
  let stop = 0
  let starting = false
  let gone = null

  const say = (socket, op, body = {}) => deliver(socket, { t: 'engine', op, ...body })
  const tell = (op, body = {}) => { for (const s of sockets.values()) say(s, op, body) }
  const seatList = () => seats.map(({ seat, name, here, ready, ai: bot, engineSeat }) => ({ seat, name, here, ready: ready || Boolean(bot), ai: bot, engineSeat }))

  const publish = async () => {
    if (!engine || !status) return
    stop++
    tell(OP.status, { status: { ...status, stop } })
    for (const seat of seats) {
      if (!seat.socket || !seat.engineSeat) continue
      try {
        const v = await engine.call('view', { viewer: seat.engineSeat })
        say(seat.socket, OP.view, { you: seat.engineSeat, state: v.state, log: v.log ?? [] })
      } catch (e) { /* the engine's death is reported once, by its exit */ }
    }
  }

  const start = async () => {
    if (engine || starting) return
    starting = true
    try {
      engine = startEngine({ command: engineCommand, onStderr })
      lastStarted = engine
      // Asked first and given the long allowance, so that the corpus loading
      // is waited for once, here, and every later call keeps the usual wait.
      const hello = await engine.call('hello', {}, { timeoutMs: STARTUP_MS })
      // The engine's own seat plays the first human's deck: a mirror match,
      // until the lobby lets a deck be chosen for it. It is said so on screen.
      // The mirror is the whole deck, sideboard too, or a wish in it would be
      // a dead card on one side of the table only.
      const first = seats.find((s) => !s.ai && s.deck)
      const player = (s) => {
        const side = forProtocol(hello?.protocol, s.ai ? first?.sideboard : s.sideboard)
        const deck = forProtocol(hello?.protocol, s.ai ? (first?.deck ?? {}) : (s.deck ?? {}))
        return { name: s.name ?? (s.ai ? 'The engine' : s.seat), deck, ...(side ? { sideboard: side } : {}), ai: s.ai, autoPass: !s.ai }
      }
      const reply = await engine.call('new', {
        players: seats.map(player),
        // Absent, the engine picks one and says which in its reply.
        ...(seed == null ? {} : { seed }),
      })
      reply.seats.forEach((es, i) => {
        seats[i].engineSeat = es.id
        if (seats[i].ai) seats[i].name = es.name
        // Read forgivingly: an engine from before the sideboard sends none.
        seats[i].sideboardLeftOut = Array.isArray(es.sideboardLeftOut) ? es.sideboardLeftOut.filter((n) => typeof n === 'string') : []
        seats[i].unknownPrintings = Array.isArray(es.unknownPrintings) ? es.unknownPrintings.filter((n) => typeof n === 'string') : []
      })
      status = reply
      tell(OP.seats, { seats: seatList() })
      for (const seat of seats) if (seat.socket) say(seat.socket, OP.seated, seated(seat))
      await publish()
    } catch (e) {
      gone = e.message
      tell(OP.gone, { reason: e.message })
      // A refused deal leaves the process up and waiting, and one that missed
      // the startup allowance is still loading: either way it holds the whole
      // corpus, and once the room lets go of it nothing else can close it.
      const dead = engine
      engine = null
      dead?.close().catch(() => {})
    } finally {
      starting = false
    }
  }

  const maybeStart = () => {
    const ready = seats.filter((s) => !s.ai && s.ready).length
    if (ready >= humanSeats) start()
  }

  const sit = (socket, { name, seat: wanted, deck, sideboard }) => {
    let seat = wanted ? seats.find((s) => s.seat === wanted && !s.ai) : null
    if (seat?.socket && seat.socket !== socket) { sockets.delete(seat.socket.id); seat.socket.terminate?.() }
    if (!seat) seat = seats.find((s) => !s.ai && !s.here) ?? null
    if (!seat) { say(socket, OP.refused, { error: 'Every seat is taken.' }); return }
    seat.socket = socket; seat.here = true; seat.name = name || seat.name || seat.seat
    if (deck && typeof deck === 'object' && Object.keys(deck).length) {
      seat.deck = deck
      // The sideboard belongs to the deck it came with; a rejoin without a deck keeps both.
      seat.sideboard = sideboard && typeof sideboard === 'object' && !Array.isArray(sideboard) && Object.keys(sideboard).length ? sideboard : null
      seat.ready = true
    }
    socket.seat = seat.seat
    say(socket, OP.seated, seated(seat))
    tell(OP.seats, { seats: seatList() })
    if (gone) { say(socket, OP.gone, { reason: gone }); return }
    if (engine && status) {
      say(socket, OP.status, { status: { ...status, stop } })
      engine.call('view', { viewer: seat.engineSeat }).then((v) => say(socket, OP.view, { you: seat.engineSeat, state: v.state, log: v.log ?? [] })).catch(() => {})
    } else maybeStart()
  }

  const forward = async (socket, op, message) => {
    const seat = seats.find((s) => s.socket === socket)
    if (!seat) { say(socket, OP.refused, { error: 'Sit down first.' }); return }
    if (!engine || !status) { say(socket, OP.refused, { error: gone ?? 'The game has not started.' }); return }
    if (status.actor !== seat.engineSeat) { say(socket, OP.refused, { error: 'It is not you the game is waiting on.' }); return }
    if (message.stop !== undefined && message.stop !== stop) { say(socket, OP.refused, { error: 'The table moved on; look again.', stale: true }); return }
    const { t, op: _op, stop: _stop, ...params } = message
    try {
      status = await engine.call(op, params)
      await publish()
    } catch (e) {
      say(socket, OP.refused, { error: e.message })
      if (engine?.exited) { gone = e.message; tell(OP.gone, { reason: e.message }) }
    }
  }

  return {
    mode: 'enforced',
    get engine() { return engine },
    get lastStarted() { return lastStarted },
    get status() { return status },
    join(socket) { sockets.set(socket.id, socket) },
    leave(socket) {
      sockets.delete(socket.id)
      const seat = seats.find((s) => s.socket === socket)
      if (seat) { seat.socket = null; seat.here = false; tell(OP.seats, { seats: seatList() }) }
    },
    receive(message, socket) {
      if (message?.t !== 'engine') return
      switch (message.op) {
        case OP.sit: sit(socket, message); break
        case OP.act: forward(socket, 'act', message); break
        case OP.decide: forward(socket, 'decide', message); break
        case OP.turn: if (status) say(socket, OP.status, { status: { ...status, stop } }); break
        default: say(socket, OP.refused, { error: `Unknown op "${message.op}".` })
      }
    },
    describe() {
      return { mode: 'enforced', ai, seats: seatList(), started: Boolean(engine), over: Boolean(status?.over) }
    },
    async close() { await engine?.close() },
  }
}
