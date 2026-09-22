/**
 * The browser's end of an enforced room, driven message by message.
 *
 * `useEngineRoom` is where the wire's order becomes the screen's order, and
 * two rules live there that nothing else can check: a delta is applied only
 * where its number follows, and what the engine did *for* the player is said
 * under the view it belongs to rather than over it. Both are about sequence,
 * so both are tested by sending the messages in the order the relay really
 * sends them — a status, then the view it belongs to — against a socket that
 * is this file's own.
 *
 * The views are the captured run (tests/fixtures/engine-views.json), so what
 * arrives here is what the engine really sent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import useEngineRoom from '../src/features/game/useEngineRoom.js'
// Imported rather than read off disk: this file runs in a browser-shaped
// environment, where a path is not a thing there is.
import FIXTURE from './fixtures/engine-views.json'

const RUN = FIXTURE.run
const YOU = RUN.you

/** A socket the test holds both ends of. */
class FakeSocket {
  static live = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    FakeSocket.live.push(this)
    queueMicrotask(() => { this.readyState = 1; this.onopen?.() })
  }

  send(text) { this.sent.push(JSON.parse(text)) }
  close() { this.readyState = 3 }
  /** A message from the room, as the relay would put it on the wire. */
  deliver(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
}

const CARDS = {
  m: { name: 'Mountain', set: 'por', collector_number: '208' },
  g: { name: 'Raging Goblin', set: 'por', collector_number: '134' },
}
const DECK = { id: 'd1', formatId: 'standard', main: [{ cardId: 'm', quantity: 14 }, { cardId: 'g', quantity: 6 }] }
const lookup = (id) => CARDS[id] ?? null

let room = null
let root = null
let container = null
function Probe(props) { room = useEngineRoom(props); return null }

const mount = async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Probe address="http://relay.test" code="ABCD" name="You" deck={DECK} deckLookup={lookup} cardsReady />)
  })
  return FakeSocket.live[FakeSocket.live.length - 1]
}
const deliver = async (socket, ...messages) => {
  await act(async () => { for (const m of messages) socket.deliver({ t: 'engine', ...m }) })
}

/** The relay's own messages for one stop: the status, then the view. */
const stop = (entry, seq) => ([
  { op: 'status', status: { ...entry.status, stop: seq } },
  entry.at === 0 || !entry.delta
    ? { op: 'view', you: YOU, seq, state: entry.state, log: entry.fullLog }
    : { op: 'view', you: YOU, seq, delta: entry.delta, log: entry.log },
])
const said = () => (room.run?.events ?? []).filter((e) => e.type === 'said').map((e) => e.text)
// A line the engine sent carries the engine's own word for what kind it was;
// a line the app wrote itself does not, which is how the two are told apart.
const lines = () => (room.run?.events ?? []).filter((e) => e.type === 'said' && e.engine !== undefined).map((e) => e.text)
const spoken = (log) => log.filter((l) => l.description && l.type !== 'turnChanged').map((l) => l.description)

beforeEach(() => {
  FakeSocket.live = []
  globalThis.WebSocket = FakeSocket
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  root = null; container = null; room = null
})

describe('sitting down at an enforced room', () => {
  it('says it can read a delta, so a room never sends one to a tab that cannot', async () => {
    const socket = await mount()
    const sit = socket.sent.find((m) => m.op === 'sit')
    expect(sit).toMatchObject({ t: 'engine', op: 'sit', name: 'You', deltas: true })
    expect(sit.deck).toEqual({ Mountain: { count: 14, set: 'por', number: '208' }, 'Raging Goblin': { count: 6, set: 'por', number: '134' } })
  })
})

describe('the views arriving', () => {
  it('lays the table from the first whole view and moves it on by deltas', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, { op: 'seats', seats: [] })
    let seq = 0
    for (const entry of RUN.views) {
      seq++
      await deliver(socket, ...stop(entry, seq))
    }
    const end = RUN.views[RUN.views.length - 1]
    expect(room.run.board.turn).toBe(end.state.turnNumber)
    expect(room.run.board.life[YOU]).toBe(end.state.players.find((p) => p.playerId === YOU).life)
    // Every line the engine ever sent, once and in order.
    expect(lines()).toEqual(spoken(end.fullLog))
    expect(socket.sent.some((m) => m.op === 'resync')).toBe(false)
  })

  it('asks for the table whole when a number is skipped, and draws nothing until it comes', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU })
    await deliver(socket, ...stop(RUN.views[0], 1))
    const wasTurn = room.run.board.turn
    const before = said().length

    // The second view never arrives; the third is a delta against it.
    await deliver(socket, ...stop(RUN.views[2], 3))
    expect(socket.sent.filter((m) => m.op === 'resync')).toHaveLength(1)
    expect(room.run.board.turn).toBe(wasTurn)
    expect(said()).toHaveLength(before)

    // A fourth delta while the answer is on its way asks nothing more.
    await deliver(socket, ...stop(RUN.views[3], 4))
    expect(socket.sent.filter((m) => m.op === 'resync')).toHaveLength(1)

    // The room answers with the table whole, at the next number, and the log
    // catches up with every line missed rather than losing them.
    const whole = RUN.views.find((v, i) => i > 3 && v.state)
    await deliver(socket, { op: 'view', you: YOU, seq: 9, state: whole.state, log: whole.fullLog })
    expect(room.run.board.turn).toBe(whole.state.turnNumber)
    expect(lines()).toEqual(spoken(whole.fullLog))
  })
})

describe('what the engine did for you', () => {
  it('is said under the view it belongs to, not over it', async () => {
    // The status arrives before the view, so said as it arrived the note would
    // sit above the land that was played before those windows were passed.
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU })
    await deliver(socket, ...stop(RUN.views[0], 1))

    const entry = RUN.views.find((v, i) => i > 0 && v.status.autoPassed > 0 && v.log.some((l) => l.description))
    expect(entry, 'the capture holds a stop with passed windows and lines').toBeTruthy()
    const before = said().length
    await deliver(socket, ...stop(entry, entry.at + 1))
    const fresh = said().slice(before)
    expect(fresh.length).toBeGreaterThan(1)
    expect(fresh[fresh.length - 1]).toBe(`The engine passed ${entry.status.autoPassed} priority window${entry.status.autoPassed === 1 ? '' : 's'} for you: nothing was affordable.`)
    expect(fresh.slice(0, -1)).toEqual(spoken(entry.log))
  })

  it('is said anyway when the view it belonged to never came', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU })
    await deliver(socket, ...stop(RUN.views[0], 1))
    await deliver(socket, { op: 'status', status: { waiting: 'action', actor: YOU, stop: 2, autoPassed: 7, decided: [] } })
    expect(said().some((t) => /passed 7 priority windows/.test(t))).toBe(false)
    // The next status flushes what the one before it held.
    await deliver(socket, { op: 'status', status: { waiting: 'action', actor: YOU, stop: 3, autoPassed: 0, decided: [] } })
    expect(said().some((t) => /passed 7 priority windows/.test(t))).toBe(true)
  })

  it('names what was decided on your behalf, after the view too', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU })
    await deliver(socket, ...stop(RUN.views[0], 1))
    const second = RUN.views[1]
    await deliver(socket,
      { op: 'status', status: { ...second.status, stop: 2, decided: [{ prompt: 'Assign combat damage', source: 'Raging Goblin' }] } },
      { op: 'view', you: YOU, seq: 2, delta: second.delta, log: second.log })
    expect(said()[said().length - 1]).toBe('Decided for you — Assign combat damage (Raging Goblin).')
  })
})

describe('the status on the way through', () => {
  it('keeps the room\'s own behaviour: the stop it is answering, refusals and the engine going', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    act(() => { room.act(2) })
    expect(socket.sent[socket.sent.length - 1]).toMatchObject({ op: 'act', index: 2, stop: 1 })
    await deliver(socket, { op: 'refused', error: 'It is not you the game is waiting on.' })
    expect(room.refusal.message).toBe('It is not you the game is waiting on.')
    await deliver(socket, { op: 'gone', reason: 'The engine has gone.' })
    expect(room.gone).toBe('The engine has gone.')
  })

  it('keeps a refusal on screen through the engine\'s turn, and clears it at your next stop', async () => {
    // A paced room publishes a status for each of the engine's own plays, one
    // every few hundred milliseconds. None of them is an answer to anything
    // this seat pressed, and clearing on them would take the banner away
    // inside a pace — too fast to read, and for a screen reader a live region
    // cut off mid-sentence.
    const socket = await mount()
    const paused = RUN.views.find((v) => v.status.waiting === 'engine')
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    await deliver(socket, { op: 'refused', error: 'It is not your stop.' })
    expect(room.refusal.message).toBe('It is not your stop.')
    await deliver(socket, ...stop(paused, paused.at + 1))
    expect(room.refusal?.message).toBe('It is not your stop.')
    await deliver(socket, { op: 'status', status: { waiting: 'action', actor: YOU, stop: 9, autoPassed: 0, decided: [] } })
    expect(room.refusal).toBeNull()
  })

  it('carries the engine\'s own paused stop through, so the plate can say so', async () => {
    const socket = await mount()
    const paused = RUN.views.find((v) => v.status.waiting === 'engine')
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    await deliver(socket, ...stop(paused, paused.at + 1))
    expect(room.status.waiting).toBe('engine')
    expect(room.status.actor).not.toBe(YOU)
  })
})
