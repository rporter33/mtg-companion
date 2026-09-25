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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import useEngineRoom, { SLOW_MS } from '../src/features/game/useEngineRoom.js'
import { ANSWERS, NO_CHOICES } from '../src/lib/engine/choose.js'
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
  /** The connection lost from the other end, as a relay restarting loses it. */
  drop() { this.readyState = 3; this.onclose?.({ code: 1006 }) }
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

const mount = async ({ level = null } = {}) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Probe address="http://relay.test" code="ABCD" name="You" deck={DECK} deckLookup={lookup} cardsReady level={level} />)
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

  it('says it can show a mulligan, so a room deals the opening hands to keep (M4; the owner\'s "mulligans on")', async () => {
    const socket = await mount()
    expect(socket.sent.find((m) => m.op === 'sit').mulligans).toBe(true)
  })

  it('sends the cards put on the bottom with the offer\'s act, as a play\'s choices go', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic' })
    await deliver(socket, { op: 'status', status: { actor: YOU, waiting: 'action', stop: 1, turn: 1, actions: [{ index: 0, type: 'BottomCards', description: 'Put 1 card on the bottom of your library', affordable: true, meaningful: true, mulligans: 1, bottom: 1, candidates: ['e5', 'e6'] }] } })
    await act(async () => { room.act(0, { cards: ['e6'] }) })
    expect(socket.sent.find((m) => m.op === 'act')).toMatchObject({ t: 'engine', op: 'act', stop: 1, index: 0, cards: ['e6'] })
  })
})

describe('what this seat may choose (M4)', () => {
  it('says in its sit which decisions it can show, so the engine asks them rather than answers them', async () => {
    const socket = await mount()
    expect(socket.sent.find((m) => m.op === 'sit').answers).toEqual(ANSWERS)
  })

  it('may choose nothing until the room says after the deal, and then what the room said', async () => {
    const socket = await mount()
    expect(room.can).toBe(NO_CHOICES)
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: null })
    expect(room.can).toBe(NO_CHOICES)
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', choices: { act: ['targets', 'cost'], costs: ['DiscardCard'], decisions: ['ChooseTargets', 'SelectCards'] } })
    expect([...room.can.act]).toEqual(['targets', 'cost'])
    expect(room.can.decisions.has('SelectCards')).toBe(true)
  })

  it('reads a room that says nothing of choices, or something unreadable, as nothing to choose', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null })
    expect(room.can).toBe(NO_CHOICES)
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, choices: 'all of them' })
    expect(room.can).toBe(NO_CHOICES)
  })

  it('sends what was chosen with the play, and a decision\'s answer as it was given', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null }, ...stop(RUN.views[0], 1))
    act(() => { room.act(1, { targets: { 0: ['e1'] }, x: 2 }) })
    expect(socket.sent.at(-1)).toMatchObject({ t: 'engine', op: 'act', stop: 1, index: 1, targets: { 0: ['e1'] }, x: 2 })
    await deliver(socket, { op: 'status', status: { ...RUN.views[1].status, stop: 2 } })
    act(() => { room.decide({ order: ['e7', 'e37'] }) })
    expect(socket.sent.at(-1)).toMatchObject({ t: 'engine', op: 'decide', stop: 2, order: ['e7', 'e37'] })
  })
})

describe('the level the engine plays at', () => {
  it('goes with the sit, and the log names the one the room says was taken, once', async () => {
    const socket = await mount({ level: 'hard' })
    expect(socket.sent.find((m) => m.op === 'sit')).toMatchObject({ level: 'hard' })
    // The seated that answers the sit comes before the deal and says nothing of it.
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: null })
    expect(room.level).toBeUndefined()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: 'hard' }, ...stop(RUN.views[0], 1))
    expect(room.level).toBe('hard')
    // A reconnect is seated again, and the line is not said twice.
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: 'hard' })
    expect(said().filter((t) => /level/.test(t))).toEqual(['The engine is playing at the hard level.'])
  })

  it('says so when the engine took none, rather than name the one chosen', async () => {
    const socket = await mount({ level: 'easy' })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null }, ...stop(RUN.views[0], 1))
    expect(room.level).toBeNull()
    expect(said().filter((t) => /level/.test(t))).toEqual(["This relay's engine is older than the levels and plays one way only, so it is not playing at the easy level you chose."])
  })

  it('says so when the relay is older than levels and never said', async () => {
    const socket = await mount({ level: 'intermediate' })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    expect(room.level).toBeNull()
    expect(said().filter((t) => /level/.test(t))).toEqual(['This relay is older than the levels, so the engine plays the one way it always has there, not at the intermediate level you chose.'])
  })

  it('says nothing of levels at a table whose engine player is random, or where it fields none', async () => {
    // Both are sent `level: null`, which elsewhere means an engine older than
    // the levels; here it means a player that has no levels to play at.
    for (const ai of ['random', null]) {
      const socket = await mount({ level: 'intermediate' })
      await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai }, ...stop(RUN.views[0], 1))
      expect(room.level).toBeNull()
      expect(said().filter((t) => /level/.test(t))).toEqual([])
      await act(async () => { root.unmount() })
      container.remove()
      root = null
    }
  })

  it('reads the kind of player from the seats where a room from before it does not say', async () => {
    // A room from M3 sends the seats, the engine's with its kind, before the
    // seated after the deal, and no `ai` on the seated itself.
    const socket = await mount({ level: 'hard' })
    await deliver(socket,
      { op: 'seats', seats: [{ seat: 'p1', engineSeat: YOU, ai: null }, { seat: 'p2', engineSeat: 'e1', ai: 'random', level: null }] },
      { op: 'seated', seat: 'p1', engineSeat: YOU, level: null },
      ...stop(RUN.views[0], 1))
    expect(said().filter((t) => /level/.test(t))).toEqual([])
  })

  it('names the level at a heuristic table that says so', async () => {
    const socket = await mount({ level: 'hard' })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: 'hard', ai: 'heuristic' }, ...stop(RUN.views[0], 1))
    expect(said().filter((t) => /level/.test(t))).toEqual(['The engine is playing at the hard level.'])
  })

  it('reads a word it does not know from the room as no level it can name', async () => {
    const socket = await mount({ level: 'hard' })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: 'grandmaster' }, ...stop(RUN.views[0], 1))
    expect(room.level).toBeNull()
    expect(said().filter((t) => /level/.test(t))).toEqual(['The engine is playing at a level this version of the app has no name for.'])
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
    // The views before it arrive first, in order, as they would: a delta
    // follows only the one before it, and one after a gap waits for the table
    // whole. (Since M4's capture the run opens with the hand to keep, so the
    // first such stop is no longer the run's second.)
    for (const v of RUN.views.slice(1, entry.at)) await deliver(socket, ...stop(v, v.at + 1))
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

  it('sends one press at a time, and says so rather than send a second while the first is being answered', async () => {
    // Measured at M3: against hard the engine can take seconds over what
    // follows a move, and a second press sent then used to land on the next
    // stop's offers. The room refuses it too; this spares the trip.
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    const acts = () => socket.sent.filter((m) => m.op === 'act')
    act(() => { room.act(1) })
    expect(room.answering).toBe(true)
    act(() => { room.act(2) })
    expect(acts()).toHaveLength(1)
    expect(room.refusal).toMatchObject({ message: 'The engine is still answering your last move.' })
    // Any status is the answer, whoever's stop it is.
    await deliver(socket, { op: 'status', status: { waiting: 'engine', actor: 'e1', stop: 2, autoPassed: 0, decided: [] } })
    expect(room.answering).toBe(false)
    await deliver(socket, { op: 'status', status: { waiting: 'action', actor: YOU, stop: 3, autoPassed: 0, decided: [] } })
    act(() => { room.act(0) })
    expect(acts()).toHaveLength(2)
    // A refusal is an answer too.
    await deliver(socket, { op: 'refused', error: 'The engine refused that: Must choose 1 card(s) to discard' })
    expect(room.answering).toBe(false)
  })

  it('takes "still answering" down once the answer comes, even at one of the engine\'s own stops', async () => {
    // Any other refusal stands through the engine's paced turn; this one is
    // made untrue by the answer itself. Kept, it said the engine was still
    // answering through every play of the turn the answer began.
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    act(() => { room.act(1) })
    act(() => { room.act(1) })
    expect(room.refusal).toMatchObject({ message: 'The engine is still answering your last move.' })
    await deliver(socket, { op: 'status', status: { waiting: 'engine', actor: 'e1', stop: 2, autoPassed: 0, decided: [] } })
    expect(room.refusal).toBeNull()
    // The room's own refusal of the same kind says so, and goes the same way.
    await deliver(socket, { op: 'refused', error: 'The engine is still answering your last move.', stale: true, answering: true })
    expect(room.refusal?.message).toBe('The engine is still answering your last move.')
    await deliver(socket, { op: 'status', status: { waiting: 'engine', actor: 'e1', stop: 3, autoPassed: 0, decided: [] } })
    expect(room.refusal).toBeNull()
    // A room from before the mark says only the words, and its refusal stands
    // through the engine's turn as any other does.
    await deliver(socket, { op: 'refused', error: 'The engine is still answering your last move.', stale: true })
    await deliver(socket, { op: 'status', status: { waiting: 'engine', actor: 'e1', stop: 4, autoPassed: 0, decided: [] } })
    expect(room.refusal?.message).toBe('The engine is still answering your last move.')
  })

  it('stops saying the engine is thinking when the wire drops under an unanswered press', async () => {
    // An enforced room does not outlive its relay, so the answer to a press
    // outstanding when the wire went will never come on it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const socket = await mount()
      await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
      act(() => { room.act(1) })
      act(() => { vi.advanceTimersByTime(SLOW_MS) })
      expect(room.slow).toBe(true)
      act(() => { socket.drop() })
      expect(room.wireStatus).toBe('reconnecting')
      expect(room.slow).toBe(false)
      expect(room.answering).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('calls an answer slow only once it has been a while coming, so an ordinary press shows nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const socket = await mount()
      await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
      act(() => { room.act(1) })
      act(() => { vi.advanceTimersByTime(SLOW_MS - 1) })
      expect(room.slow).toBe(false)
      // Answered in time: nothing was ever said, and nothing is left to go off.
      await deliver(socket, { op: 'status', status: { waiting: 'action', actor: YOU, stop: 2, autoPassed: 0, decided: [] } })
      act(() => { vi.advanceTimersByTime(SLOW_MS * 10) })
      expect(room.slow).toBe(false)
      // Not answered in time: slow until the answer comes.
      act(() => { room.act(0) })
      act(() => { vi.advanceTimersByTime(SLOW_MS) })
      expect(room.slow).toBe(true)
      await deliver(socket, { op: 'status', status: { waiting: 'engine', actor: 'e1', stop: 3, autoPassed: 0, decided: [] } })
      expect(room.slow).toBe(false)
    } finally {
      vi.useRealTimers()
    }
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
