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
import useEngineRoom, { SLOW_MS, agreeToLeaveOut, chooseEngineDeck } from '../src/features/game/useEngineRoom.js'
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

const mount = async ({ level = null, opponent = undefined, deck = DECK } = {}) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Probe address="http://relay.test" code="ABCD" name="You" deck={deck} deckLookup={lookup} cardsReady level={level} opponent={opponent} />)
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

/**
 * What the engine's seat plays (M5). The lobby records the choice with the
 * table when the player sits; the sit carries it; the log says once what the
 * room reports was dealt.
 */
describe('what the engine\'s seat plays (M5)', () => {
  const deckLines = () => said().filter((t) => /deck|copy of yours/.test(t))

  it('asks for a copy where nothing was chosen, and says nothing of it where the relay says nothing', async () => {
    const socket = await mount()
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'mirror' })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic' }, ...stop(RUN.views[0], 1))
    expect(room.engineDeck).toBeNull()
    expect(deckLines()).toEqual([])
  })

  it('asks for a deck of its own from the sets this deck uses, by default, and says once what was built', async () => {
    const socket = await mount({ opponent: { kind: 'own', deckId: null, pool: 'sets' } })
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'own', format: 'standard', sets: ['por'] })
    const report = { asked: 'own', played: 'own', cards: 60, colours: ['R', 'G'], format: 'standard', from: 'sets', sets: [{ code: 'POR', name: 'Portal' }] }
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', engineDeck: report }, ...stop(RUN.views[0], 1))
    // Back again, as a reconnect sits: the line is not said twice.
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', engineDeck: report })
    expect(room.engineDeck).toEqual(report)
    expect(deckLines()).toEqual(["The engine plays a deck of its own, built by Argentum's deck builder: red-green, from Portal."])
  })

  it('asks for the whole format where the switch is on, sending no sets', async () => {
    const socket = await mount({ opponent: { kind: 'own', deckId: null, pool: 'format' } })
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'own', format: 'standard', sets: null })
  })

  it('takes what the lobby recorded for this table over the kept choice, and sends a deck of the player\'s by its checked names', async () => {
    chooseEngineDeck('ABCD', { kind: 'deck', deckId: 'd2', name: 'Elves', deck: { Forest: 20, 'Llanowar Elves': 20 } })
    const socket = await mount({ opponent: { kind: 'own', deckId: null, pool: 'sets' } })
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'deck', name: 'Elves', deck: { Forest: 20, 'Llanowar Elves': 20 } })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', engineDeck: { asked: 'deck', played: 'deck', cards: 40, colours: ['G'], name: 'Elves' } }, ...stop(RUN.views[0], 1))
    expect(deckLines()).toEqual(['The engine plays your deck Elves.'])
  })

  it('says why a deck chosen for the engine went as the copy, and a deck with no names recorded is never sent as nothing', async () => {
    chooseEngineDeck('ABCD', { kind: 'mirror', instead: 'short', name: 'Elves' })
    let socket = await mount()
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'mirror' })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', engineDeck: { asked: 'mirror', played: 'mirror', cards: 20, colours: ['R'] } }, ...stop(RUN.views[0], 1))
    expect(deckLines()).toEqual(['The engine does not know every card in Elves, so it plays a copy of yours.', 'The engine plays a copy of your deck.'])
    await act(async () => { root.unmount() }); container.remove(); root = null
    localStorage.clear()
    // Kept as "one of your decks", with nothing recorded for this table: no names to send.
    socket = await mount({ opponent: { kind: 'deck', deckId: 'd2', pool: 'sets' } })
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'mirror' })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', engineDeck: { asked: 'mirror', played: 'mirror' } }, ...stop(RUN.views[0], 1))
    expect(deckLines()[0]).toBe("The deck chosen for the engine was not sent from this device's lobby, so it plays a copy of yours.")
  })

  it('reads a record written by another build forgivingly', async () => {
    chooseEngineDeck('ABCD', { kind: 'deck', deck: 'Elves' })
    const socket = await mount()
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'mirror' })
  })

  it('says a relay older than the choice dealt the copy where something else was asked', async () => {
    const socket = await mount({ opponent: { kind: 'own', deckId: null, pool: 'sets' } })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic' }, ...stop(RUN.views[0], 1))
    expect(deckLines()).toEqual(["This relay is older than the choice of the engine's deck, so the engine plays a copy of yours."])
  })

  it('says nothing of the engine\'s deck at a table where the engine plays no seat', async () => {
    const socket = await mount({ opponent: { kind: 'own', deckId: null, pool: 'sets' } })
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: null }, ...stop(RUN.views[0], 1))
    expect(deckLines()).toEqual([])
  })
})

/**
 * A Commander game (M6). A Commander deck's sit asks for one and brings the
 * commander apart from the library; the log says once which game the room
 * reports was dealt, and a sixty-card deck's sit says nothing new at all.
 */
describe('a Commander game (M6)', () => {
  const COMMANDER = {
    id: 'c1', formatId: 'commander', commanders: ['rhys'],
    main: [{ cardId: 'f', quantity: 50 }, { cardId: 'p', quantity: 49 }],
  }
  CARDS.rhys = { name: 'Rhys the Redeemed', set: 'shm', collector_number: '237' }
  CARDS.f = { name: 'Forest', set: 'por', collector_number: '211' }
  CARDS.p = { name: 'Plains', set: 'por', collector_number: '196' }
  const gameLines = () => said().filter((t) => /rules|Commander/.test(t))
  const seated = (extra = {}) => ({ op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', ...extra })

  it('asks for one, with the commander apart from the library and its printing named', async () => {
    const socket = await mount({ deck: COMMANDER })
    const sit = socket.sent.find((m) => m.op === 'sit')
    expect(sit).toMatchObject({ format: 'commander', commander: { name: 'Rhys the Redeemed', set: 'shm', number: '237' } })
    expect(Object.keys(sit.deck)).toEqual(['Forest', 'Plains'])
  })

  it('says once that it was dealt by the Commander rules, citing them', async () => {
    const socket = await mount({ deck: COMMANDER })
    await deliver(socket, seated({ format: { asked: 'commander', played: 'commander' } }), ...stop(RUN.views[0], 1))
    await deliver(socket, seated({ format: { asked: 'commander', played: 'commander' } }))
    expect(room.game).toEqual({ asked: 'commander', played: 'commander' })
    expect(gameLines()).toEqual(["Played by the Commander rules: 40 life each (903.7), and each commander begins in its owner's command zone (903.6)."])
  })

  it('says why the ordinary game was dealt instead: an engine older than Commander, or no commander to deal', async () => {
    let socket = await mount({ deck: COMMANDER })
    await deliver(socket, seated({ format: { asked: 'commander', played: 'standard', fellBack: 'engine' } }), ...stop(RUN.views[0], 1))
    expect(gameLines()).toEqual(["This relay's engine is older than Commander, so the game is played by the ordinary rules: 20 life each, and no commander dealt."])
    await act(async () => { root.unmount() }); container.remove(); root = null
    socket = await mount({ deck: COMMANDER })
    await deliver(socket, seated({ format: { asked: 'commander', played: 'standard', fellBack: 'commander' } }), ...stop(RUN.views[0], 1))
    expect(gameLines()[0]).toMatch(/^With no commander to deal there is no Commander game, since every Commander deck has one \(903\.3\)/)
  })

  it('says a relay older than Commander dealt the ordinary game', async () => {
    const socket = await mount({ deck: COMMANDER })
    await deliver(socket, seated(), ...stop(RUN.views[0], 1))
    expect(room.game).toBeNull()
    expect(gameLines()).toEqual(['This relay is older than Commander, so the game is played by the ordinary rules: 20 life each, and no commander dealt.'])
  })

  it('sends a deck with two commanders with neither, and says the engine deals one', async () => {
    CARDS.sythis = { name: "Sythis, Harvest's Hand", set: 'mh2', collector_number: '214' }
    const socket = await mount({ deck: { ...COMMANDER, commanders: ['rhys', 'sythis'] } })
    const sit = socket.sent.find((m) => m.op === 'sit')
    expect(sit.format).toBe('commander')
    expect(sit).not.toHaveProperty('commander')
    await deliver(socket, seated({ format: { asked: 'commander', played: 'standard', fellBack: 'commander' } }), ...stop(RUN.views[0], 1))
    expect(gameLines()).toEqual(['The engine deals one commander, and this deck has two, so the game is played by the ordinary rules: 20 life each, and no command zone.'])
  })

  it('says why a Commander deck of the engine\'s own was not built where the deck was played without its commander', async () => {
    // The lobby's gate: the commander the engine does not know left out, and the rest played by the ordinary rules.
    agreeToLeaveOut('ABCD', 'c1', ['Rhys the Redeemed'])
    const socket = await mount({ deck: COMMANDER, opponent: { kind: 'own', deckId: null, pool: 'format' } })
    const sit = socket.sent.find((m) => m.op === 'sit')
    expect(sit).toMatchObject({ format: 'commander', engineDeck: { kind: 'own', format: 'commander', sets: null } })
    expect(sit).not.toHaveProperty('commander')
    await deliver(socket, seated({
      format: { asked: 'commander', played: 'standard', fellBack: 'commander' },
      engineDeck: { asked: 'own', played: 'mirror', cards: 99, colours: ['W', 'G'], format: 'commander', formatName: 'Commander', fellBack: 'format', why: 'A "commander" deck of its own is built only for a Commander game.' },
    }), ...stop(RUN.views[0], 1))
    // Not "builds no Commander deck of its own", which stopped being true at protocol 8.
    const why = 'The engine builds a Commander deck of its own only for a Commander game, and this one is played by the ordinary rules, so it plays a copy of yours.'
    expect(said()).toContain(why)
    expect(said().some((t) => /builds no Commander deck/.test(t))).toBe(false)
    // A deck with two commanders sits the same way, with neither, and is told the same.
    await act(async () => { root.unmount() }); container.remove(); root = null
    localStorage.clear()
    CARDS.sythis = { name: "Sythis, Harvest's Hand", set: 'mh2', collector_number: '214' }
    const again = await mount({ deck: { ...COMMANDER, commanders: ['rhys', 'sythis'] }, opponent: { kind: 'own', deckId: null, pool: 'format' } })
    expect(again.sent.find((m) => m.op === 'sit')).not.toHaveProperty('commander')
    await deliver(again, seated({
      format: { asked: 'commander', played: 'standard', fellBack: 'commander' },
      engineDeck: { asked: 'own', played: 'mirror', cards: 99, colours: ['W', 'G'], format: 'commander', formatName: 'Commander', fellBack: 'format', why: 'A "commander" deck of its own is built only for a Commander game.' },
    }), ...stop(RUN.views[0], 1))
    expect(said()).toContain(why)
    expect(said()).toContain('The engine deals one commander, and this deck has two, so the game is played by the ordinary rules: 20 life each, and no command zone.')
  })

  it('sends another Commander deck of the player\'s with its commander, as the lobby recorded it', async () => {
    chooseEngineDeck('ABCD', { kind: 'deck', deckId: 'd2', name: 'Enchantress', deck: { Forest: 99 }, commander: { name: "Sythis, Harvest's Hand" } })
    const socket = await mount({ deck: COMMANDER })
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'deck', name: 'Enchantress', deck: { Forest: 99 }, commander: { name: "Sythis, Harvest's Hand" } })
    await deliver(socket, seated({ engineDeck: { asked: 'deck', played: 'deck', cards: 100, colours: ['W', 'G'], name: 'Enchantress', commander: "Sythis, Harvest's Hand" } }), ...stop(RUN.views[0], 1))
    expect(said()).toContain("The engine plays your deck Enchantress, led by Sythis, Harvest's Hand.")
  })

  it('says nothing new of a sixty-card deck\'s game, and its sit asks for the ordinary rules', async () => {
    const socket = await mount()
    const sit = socket.sent.find((m) => m.op === 'sit')
    // Said, not left out: a sit naming no game left a room's earlier Commander request standing (M6's review).
    expect(sit.format).toBe('standard')
    expect(sit).not.toHaveProperty('commander')
    await deliver(socket, seated({ format: { asked: 'standard', played: 'standard' } }), ...stop(RUN.views[0], 1))
    expect(gameLines()).toEqual([])
  })
})

/**
 * Duel Commander and Brawl (HANDOFF.md §3 item 20). A deck of either sits asking
 * for its own game, its commander apart as a Commander deck's is; the log says
 * once which game the room reports was dealt, at its own numbers, or why the
 * ordinary one was; and a Brawl deck of the engine's own is asked for as Brawl.
 */
describe('a Duel Commander or a Brawl game (§3 item 20)', () => {
  CARDS.rhys = { name: 'Rhys the Redeemed', set: 'shm', collector_number: '237' }
  CARDS.f = { name: 'Forest', set: 'por', collector_number: '211' }
  CARDS.p = { name: 'Plains', set: 'por', collector_number: '196' }
  const deckIn = (formatId) => ({ id: `${formatId}1`, formatId, commanders: ['rhys'], main: [{ cardId: 'f', quantity: 50 }, { cardId: 'p', quantity: 49 }] })
  const gameLines = () => said().filter((t) => /rules|Commander|Brawl/.test(t))
  const seated = (extra = {}) => ({ op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', ...extra })

  it.each([
    ['duel', 20, "Played by the Duel Commander rules, for two: 20 life each (Duel Commander rules, 300.1a), each commander begins in its owner's command zone (903.6), and commander damage loses nobody the game (Duel Commander rules, 506.1a)."],
    ['brawl', 25, "Played by the Brawl rules, for two: 25 life each (903.12f), each commander begins in its owner's command zone (903.6), and commander damage loses nobody the game (903.12h). Brawl's first mulligan is free (903.12g), and not here: the engine makes a first mulligan free only at a table of more than two, so each counts."],
  ])('asks for %s with the commander apart, and says once that it was dealt at its own numbers', async (formatId, life, line) => {
    const socket = await mount({ deck: deckIn(formatId) })
    const sit = socket.sent.find((m) => m.op === 'sit')
    expect(sit).toMatchObject({ format: formatId, commander: { name: 'Rhys the Redeemed', set: 'shm', number: '237' } })
    expect(Object.keys(sit.deck)).toEqual(['Forest', 'Plains'])
    const format = { asked: formatId, played: formatId, rules: { life, deckSize: 100, commanderDamage: null } }
    await deliver(socket, seated({ format }), ...stop(RUN.views[0], 1))
    await deliver(socket, seated({ format }))
    expect(room.game).toEqual(format)
    expect(gameLines()).toEqual([line])
  })

  it('says why the ordinary game was dealt instead, each way the room says', async () => {
    const cases = [
      ['engine', "This relay's engine deals no Brawl game, so it is played by the ordinary rules: 20 life each, and no commander dealt."],
      ['players', 'This table has more than two players, and the engine deals Brawl only to two, at 25 life each (903.12f; more begin at 30), so it is played by the ordinary rules: 20 life each, and no commander dealt.'],
    ]
    for (const [fellBack, line] of cases) {
      const socket = await mount({ deck: deckIn('brawl') })
      await deliver(socket, seated({ format: { asked: 'brawl', played: 'standard', fellBack } }), ...stop(RUN.views[0], 1))
      expect(gameLines()).toEqual([line])
      await act(async () => { root.unmount() }); container.remove(); root = null
    }
    // A relay from before item 20 reads the word as no game, and says the ordinary rules were asked.
    const socket = await mount({ deck: deckIn('duel') })
    await deliver(socket, seated({ format: { asked: 'standard', played: 'standard' } }), ...stop(RUN.views[0], 1))
    expect(gameLines()).toEqual(['This relay deals no Duel Commander game, so it is played by the ordinary rules: 20 life each, and no commander dealt.'])
  })

  it('asks for a Brawl deck of the engine\'s own as Brawl, and a Duel Commander one as asked, which the engine answers with the copy', async () => {
    let socket = await mount({ deck: deckIn('brawl'), opponent: { kind: 'own', deckId: null, pool: 'format' } })
    expect(socket.sent.find((m) => m.op === 'sit').engineDeck).toEqual({ kind: 'own', format: 'brawl', sets: null })
    await deliver(socket, seated({
      format: { asked: 'brawl', played: 'brawl', rules: { life: 25, deckSize: 100, commanderDamage: null } },
      engineDeck: { asked: 'own', played: 'own', cards: 100, colours: ['W', 'G'], commander: "Sythis, Harvest's Hand", format: 'brawl', formatName: 'Brawl', from: 'format' },
    }), ...stop(RUN.views[0], 1))
    expect(said()).toContain("The engine plays a deck of its own, built by Argentum's deck builder: green-white, from the whole of Brawl, led by Sythis, Harvest's Hand.")
    await act(async () => { root.unmount() }); container.remove(); root = null
    socket = await mount({ deck: deckIn('duel'), opponent: { kind: 'own', deckId: null, pool: 'format' } })
    await deliver(socket, seated({
      format: { asked: 'duel', played: 'duel', rules: { life: 20, deckSize: 100, commanderDamage: null } },
      engineDeck: { asked: 'own', played: 'mirror', cards: 100, colours: ['W', 'G'], commander: 'Rhys the Redeemed', format: 'duel', fellBack: 'format', why: 'The engine builds no "duel" deck of its own.' },
    }), ...stop(RUN.views[0], 1))
    expect(said()).toContain('The engine builds no Duel Commander deck of its own, so it plays a copy of yours.')
  })

  it('sends an Oathbreaker deck as every deck of the family went before M6, asking for the ordinary rules', async () => {
    CARDS.o = { name: 'Some Oathbreaker', set: 'x', collector_number: '1' }
    const socket = await mount({ deck: { id: 'o1', formatId: 'oathbreaker', commanders: ['o'], main: [{ cardId: 'f', quantity: 58 }] } })
    const sit = socket.sent.find((m) => m.op === 'sit')
    expect(sit.format).toBe('standard')
    expect(sit).not.toHaveProperty('commander')
  })
})

/**
 * A stand-in commander (HANDOFF.md §3 item 19). Where the lobby recorded that the
 * player chose one of the deck's own legendary creatures to lead it in place of a
 * commander the engine does not know, the sit brings it as the commander, out of
 * the library, naming the real one; the log says once that it is a stand-in, the
 * board marks it, and a reload of the table sits the same way.
 */
describe('a stand-in commander (§3 item 19)', () => {
  // Real cards as Scryfall has them, led by a commander no engine knows (a name beginning "Made-Up").
  CARDS.sw = { name: 'Made-Up Warden', type_line: 'Legendary Creature — Elf', color_identity: ['G', 'W'] }
  CARDS.sr = { name: 'Rhys the Redeemed', type_line: 'Legendary Creature — Elf Warrior', color_identity: ['G', 'W'], set: 'shm', collector_number: '237' }
  CARDS.sf = { name: 'Forest', type_line: 'Basic Land — Forest', color_identity: ['G'], set: 'por', collector_number: '211' }
  CARDS.sp = { name: 'Plains', type_line: 'Basic Land — Plains', color_identity: ['W'], set: 'por', collector_number: '196' }
  CARDS.sm = { name: 'Made-Up Card', type_line: 'Creature — Elf', color_identity: ['G'] }
  const WARDEN = { id: 'w1', formatId: 'commander', commanders: ['sw'], main: [{ cardId: 'sr', quantity: 1 }, { cardId: 'sm', quantity: 1 }, { cardId: 'sf', quantity: 49 }, { cardId: 'sp', quantity: 48 }] }
  const LEFT = ['Made-Up Warden', 'Made-Up Card']
  const LEAD = { name: 'Rhys the Redeemed', for: 'Made-Up Warden' }
  const seated = (extra = {}) => ({ op: 'seated', seat: 'p1', engineSeat: YOU, level: null, ai: 'heuristic', ...extra })
  const dealt = { format: { asked: 'commander', played: 'commander', standIn: LEAD }, engineDeck: { asked: 'mirror', played: 'mirror', cards: 98, colours: ['W', 'G'], commander: 'Rhys the Redeemed', standsFor: 'Made-Up Warden' } }
  const standInLines = () => said().filter((t) => /stand-in/.test(t))
  /** The captured first view with this seat's commander in its command zone, as the engine deals one. */
  const withCommander = () => {
    const state = RUN.views[0].state
    const other = state.players.find((p) => p.playerId !== YOU).playerId
    const commander = (id, owner) => ({ id, name: 'Rhys the Redeemed', typeLine: 'Legendary Creature — Elf Warrior', ownerId: owner, controllerId: owner, zone: { ownerId: owner, zoneType: 'Command' }, isCommander: true })
    return {
      other,
      view: {
        op: 'view', you: YOU, seq: 1, log: RUN.views[0].fullLog,
        state: {
          ...state,
          cards: { ...state.cards, c0: commander('c0', YOU), c1: commander('c1', other) },
          zones: [...state.zones, { zoneId: { ownerId: YOU, zoneType: 'Command' }, cardIds: ['c0'], size: 1, isVisible: true }, { zoneId: { ownerId: other, zoneType: 'Command' }, cardIds: ['c1'], size: 1, isVisible: true }],
        },
      },
    }
  }

  it('sits with the stand-in the lobby recorded as the commander, out of the library, naming the real one; the rest as agreed', async () => {
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    const socket = await mount({ deck: WARDEN })
    const sit = socket.sent.find((m) => m.op === 'sit')
    expect(sit.format).toBe('commander')
    expect(sit.commander).toEqual({ name: 'Rhys the Redeemed', set: 'shm', number: '237', standsFor: 'Made-Up Warden' })
    expect(Object.keys(sit.deck)).toEqual(['Forest', 'Plains'])
    // Recorded with the table, never in the deck, which is as it was.
    expect(JSON.parse(localStorage.getItem('mtg-companion:engine:ABCD')).standIn).toEqual({ deckId: 'w1', name: 'Rhys the Redeemed' })
    expect(WARDEN.main[0]).toEqual({ cardId: 'sr', quantity: 1 })
  })

  it('says once that it is a stand-in and not the deck\'s real commander, and that the engine\'s copy is led by it too', async () => {
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    const socket = await mount({ deck: WARDEN })
    await deliver(socket, seated(dealt), ...stop(RUN.views[0], 1))
    await deliver(socket, seated(dealt))
    expect(standInLines()).toEqual([
      'The engine plays a copy of your deck, led as yours is by Rhys the Redeemed, a stand-in for Made-Up Warden.',
      "Rhys the Redeemed leads your deck as a stand-in, as you chose: the engine does not know the deck's real commander, Made-Up Warden, and a Commander game needs one (903.3).",
    ])
    expect(said()).toContain("Played by the Commander rules: 40 life each (903.7), and each commander begins in its owner's command zone (903.6).")
    expect(room.leads).toEqual({ own: LEAD, engine: LEAD })
  })

  it('marks the stand-in on the board, its own and the engine\'s copy, for the table to say', async () => {
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    const socket = await mount({ deck: WARDEN })
    const { other, view } = withCommander()
    await deliver(socket, { op: 'seats', seats: [{ seat: 'p1', engineSeat: YOU }, { seat: 'p2', ai: 'heuristic', engineSeat: other }] }, seated(dealt), { op: 'status', status: { ...RUN.views[0].status, stop: 1 } }, view)
    expect(room.run.board.cards.c0).toMatchObject({ commander: true, standsFor: 'Made-Up Warden' })
    expect(room.run.board.cards.c1).toMatchObject({ commander: true, standsFor: 'Made-Up Warden' })
  })

  it('says it from what it sent where a relay older than stand-ins says nothing of one, the engine\'s copy too', async () => {
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    const socket = await mount({ deck: WARDEN })
    await deliver(socket, seated({ format: { asked: 'commander', played: 'commander' }, engineDeck: { asked: 'mirror', played: 'mirror', cards: 98, colours: ['W', 'G'], commander: 'Rhys the Redeemed' } }), ...stop(RUN.views[0], 1))
    expect(standInLines()).toHaveLength(2)
    expect(room.leads).toEqual({ own: LEAD, engine: LEAD })
    expect(room.engineDeck.standsFor).toBe('Made-Up Warden')
  })

  it('says in a game dealt by the ordinary rules that the stand-in leads nothing, and that it is back in the library, where the room says it put it there', async () => {
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    const socket = await mount({ deck: WARDEN })
    await deliver(socket, seated({ format: { asked: 'commander', played: 'standard', fellBack: 'engine', inLibrary: LEAD } }), ...stop(RUN.views[0], 1))
    expect(standInLines()).toEqual(['Rhys the Redeemed, chosen to lead this deck as a stand-in for Made-Up Warden, leads nothing in a game dealt by the ordinary rules, so it is dealt in your library with the rest of the deck.'])
    expect(room.leads).toEqual({ own: null, engine: null })
  })

  it('says the deck is played without it where a room from before that says nothing, having taken it out of the library to send it', async () => {
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    for (const format of [{ asked: 'commander', played: 'standard', fellBack: 'engine' }, undefined]) {
      const socket = await mount({ deck: WARDEN })
      await deliver(socket, seated(format ? { format } : {}), ...stop(RUN.views[0], 1))
      expect(standInLines()).toEqual(['Rhys the Redeemed, chosen to lead this deck as a stand-in for Made-Up Warden, leads nothing in a game dealt by the ordinary rules, and this relay did not put it back in the library, so the deck is played without it.'])
      expect(room.leads).toEqual({ own: null, engine: null })
      await act(async () => { root.unmount() }); container.remove(); root = null
    }
  })

  it('knows a stand-in of two faces on the engine\'s copy, which the engine names by its front, where the room says nothing of it', async () => {
    // Edgar, Charmed Groom transforms; the sit sends Scryfall's name for both faces, and the engine names its front.
    CARDS.se = { name: "Edgar, Charmed Groom // Edgar Markov's Coffin", layout: 'transform', type_line: 'Legendary Creature — Vampire Noble // Legendary Artifact', color_identity: ['W', 'B'], card_faces: [{ name: 'Edgar, Charmed Groom', type_line: 'Legendary Creature — Vampire Noble' }, { name: "Edgar Markov's Coffin", type_line: 'Legendary Artifact' }] }
    CARDS.sv = { name: 'Made-Up Vampire', type_line: 'Legendary Creature — Vampire', color_identity: ['W', 'B'] }
    const VAMPIRE = { id: 'v1', formatId: 'commander', commanders: ['sv'], main: [{ cardId: 'se', quantity: 1 }, { cardId: 'sp', quantity: 98 }] }
    agreeToLeaveOut('ABCD', 'v1', ['Made-Up Vampire'], CARDS.se.name)
    const socket = await mount({ deck: VAMPIRE })
    expect(socket.sent.find((m) => m.op === 'sit').commander).toEqual({ name: CARDS.se.name, standsFor: 'Made-Up Vampire' })
    await deliver(socket, seated({ format: { asked: 'commander', played: 'commander' }, engineDeck: { asked: 'mirror', played: 'mirror', cards: 99, colours: ['W', 'B'], commander: 'Edgar, Charmed Groom' } }), ...stop(RUN.views[0], 1))
    expect(room.engineDeck.standsFor).toBe('Made-Up Vampire')
    expect(room.leads).toEqual({ own: { name: CARDS.se.name, for: 'Made-Up Vampire' }, engine: { name: 'Edgar, Charmed Groom', for: 'Made-Up Vampire' } })
    expect(said()).toContain('The engine plays a copy of your deck, led as yours is by Edgar, Charmed Groom, a stand-in for Made-Up Vampire.')
  })

  it('sits as the lobby left it on a reload, the stand-in still leading', async () => {
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    const first = await mount({ deck: WARDEN })
    const sat = first.sent.find((m) => m.op === 'sit')
    await act(async () => { root.unmount() }); container.remove(); root = null
    const again = await mount({ deck: WARDEN })
    const resat = again.sent.find((m) => m.op === 'sit')
    expect(resat.commander).toEqual(sat.commander)
    expect(resat.deck).toEqual(sat.deck)
    // After the deal the room's word is said, whatever this device remembered: one that
    // remembers nothing sits with the deck as it is, and is told what leads it.
    localStorage.clear()
    await act(async () => { root.unmount() }); container.remove(); root = null
    const elsewhere = await mount({ deck: WARDEN })
    expect(elsewhere.sent.find((m) => m.op === 'sit').commander).toEqual({ name: 'Made-Up Warden' })
    await deliver(elsewhere, seated(dealt), ...stop(RUN.views[0], 1))
    expect(room.leads.own).toEqual(LEAD)
    expect(standInLines()).toHaveLength(2)
  })

  it('lets go of a stand-in that can no longer lead the deck, and says so, sending no commander', async () => {
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    const gone = { ...WARDEN, main: WARDEN.main.filter((e) => e.cardId !== 'sr') }
    const socket = await mount({ deck: gone })
    const sit = socket.sent.find((m) => m.op === 'sit')
    expect(sit.format).toBe('commander')
    expect(sit).not.toHaveProperty('commander')
    await deliver(socket, seated({ format: { asked: 'commander', played: 'standard', fellBack: 'commander' } }), ...stop(RUN.views[0], 1))
    expect(said()).toContain('Rhys the Redeemed, chosen in the lobby to lead this deck as a stand-in, can no longer lead it, so the deck is sent with no commander.')
  })

  it('reads a record that says nothing it can use as no stand-in, and a later sit without one clears it', async () => {
    for (const standIn of [{ deckId: 'w1', name: 7 }, { deckId: 'other', name: 'Rhys the Redeemed' }, 'Rhys', null]) {
      localStorage.setItem('mtg-companion:engine:ABCD', JSON.stringify({ without: { deckId: 'w1', names: LEFT }, standIn }))
      const socket = await mount({ deck: WARDEN })
      expect(socket.sent.find((m) => m.op === 'sit')).not.toHaveProperty('commander')
      await act(async () => { root.unmount() }); container.remove(); root = null
    }
    agreeToLeaveOut('ABCD', 'w1', LEFT, 'Rhys the Redeemed')
    agreeToLeaveOut('ABCD', 'w1', LEFT)
    expect(JSON.parse(localStorage.getItem('mtg-companion:engine:ABCD')).standIn).toBeNull()
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
    // The answer to a press outstanding when the wire went never comes on that
    // wire: a room that comes back is at the stop it last saved, and says so (M7).
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

describe('a game that comes back (M7)', () => {
  /** The whole table again, as a room that has taken the game back sends it: the stop the game was kept at, numbered on. */
  const whole = (entry, seq) => ([
    { op: 'status', status: { ...entry.status, stop: seq } },
    { op: 'view', you: YOU, seq, state: entry.state, log: entry.fullLog },
  ])

  it('lets go of the stop while the game comes back, so nothing can be pressed, and says under the table what came back, once', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    expect(room.status).not.toBeNull()
    await deliver(socket, { op: 'restoring', reason: 'relay' })
    expect(room.restoring).toBe('relay')
    expect(room.status).toBeNull()
    // No status, no press: the send is refused here rather than reach a room with no engine.
    let sent
    act(() => { sent = room.act(0) })
    expect(sent).toBe(false)
    expect(socket.sent.some((m) => m.op === 'act')).toBe(false)
    const before = said().length
    await deliver(socket, { op: 'restored', reason: 'relay', behind: 0 }, { op: 'seated', seat: 'p1', engineSeat: YOU })
    // Held until the table it is about has been drawn: the status after it says nothing yet.
    await deliver(socket, whole(RUN.views[0], 2)[0])
    expect(said()).toHaveLength(before)
    await deliver(socket, whole(RUN.views[0], 2)[1])
    expect(room.restoring).toBe(null)
    expect(room.status.stop).toBe(2)
    expect(said().at(-1)).toBe('The relay restarted; the table is as it was at the last stop.')
    expect(said().filter((t) => /restarted/.test(t))).toHaveLength(1)
    // The notes said at the first deal are not said again for the same seat.
    expect(said().filter((t) => /levels|level\./.test(t)).length).toBeLessThanOrEqual(1)
  })

  it('says an engine that restarted as the engine\'s, and tells the person whose answer was lost that the question is put again, and why the same answer may end the game', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    await deliver(socket, { op: 'restoring', reason: 'engine' })
    expect(room.restoring).toBe('engine')
    await deliver(socket, { op: 'restored', reason: 'engine', behind: 1, lost: 'decide' }, ...whole(RUN.views[0], 2))
    expect(said().slice(-2)).toEqual([
      'The engine restarted; the table is as it was one stop before the last you saw, the last one it had saved.',
      'The engine stopped while it was taking your last answer, so the question is put to you again. If it stops again before the game has gone on, the game ends there, so giving the same answer again may end it.',
    ])
  })

  it('does not invite a move that stopped the engine to be made again as though it were safe', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    await deliver(socket, { op: 'restoring', reason: 'engine' }, { op: 'restored', reason: 'engine', behind: 0, lost: 'act', at: 2 }, ...whole(RUN.views[0], 2))
    expect(said().at(-1)).toBe('The engine stopped while it was answering your last move, so the table is as it was before it. If it stops again before the game has gone on, the game ends there, so making the same move again may end it.')
  })

  it('takes any status as the game back, so a `restored` lost on a socket that died unnoticed does not leave the table saying nothing will happen', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    await deliver(socket, { op: 'restoring', reason: 'relay' })
    expect(room.restoring).toBe('relay')
    // No `restored`: it went to a socket that was no longer there.
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...whole(RUN.views[0], 2))
    expect(room.restoring).toBe(null)
    expect(room.status.stop).toBe(2)
  })

  it('says a coming back once where the room says it again on the socket that took the old one\'s place', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    await deliver(socket, { op: 'restoring', reason: 'relay' }, { op: 'restored', reason: 'relay', behind: 0, at: 2 }, ...whole(RUN.views[0], 2))
    // The wire drops, and the seat sits again on a new one: the room could not be
    // sure the first was heard, and says it again, with the same number.
    await deliver(socket, { op: 'restored', reason: 'relay', behind: 0, at: 2 }, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...whole(RUN.views[0], 3))
    expect(said().filter((t) => /restarted/.test(t))).toEqual(['The relay restarted; the table is as it was at the last stop.'])
    // Another coming back, later, is another line.
    await deliver(socket, { op: 'restoring', reason: 'engine' }, { op: 'restored', reason: 'engine', behind: 0, at: 4 }, ...whole(RUN.views[0], 4))
    expect(said().filter((t) => /restarted/.test(t))).toEqual(['The relay restarted; the table is as it was at the last stop.', 'The engine restarted; the table is as it was at the last stop.'])
  })

  it('draws the table it went back to, and keeps the log it had, where the game came back a stop behind what was seen', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU })
    // The hand to keep, then the mulligan taken: another seven in hand.
    await deliver(socket, ...stop(RUN.views[0], 1), ...stop(RUN.views[1], 2))
    const handOf = (view) => view.zones.find((z) => z.zoneId?.zoneType === 'Hand' && z.zoneId?.ownerId === YOU).cardIds
    const first = handOf(RUN.views[0].state)
    expect(room.run.board.zones[YOU].hand).not.toEqual(first)
    const logBefore = room.run.events.map((e) => e.text ?? e.type)
    // The mulligan was never kept: the game comes back to the hand before it.
    await deliver(socket, { op: 'restoring', reason: 'relay' }, { op: 'restored', reason: 'relay', behind: 1, lost: 'act', at: 3 }, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...whole(RUN.views[0], 3))
    expect(room.run.board.zones[YOU].hand).toEqual(first)
    expect(room.status.actions.map((a) => a.type)).toEqual(['KeepHand', 'TakeMulligan'])
    // The log keeps what it said, says nothing of the table twice, and ends with what came back.
    const logAfter = room.run.events.map((e) => e.text ?? e.type)
    expect(logAfter.slice(0, logBefore.length)).toEqual(logBefore)
    expect(logAfter.slice(logBefore.length).filter((t) => t !== 'stepped' && t !== 'turnBegan')).toEqual([
      'The relay restarted; the table is as it was one stop before the last you saw, the last one it had saved.',
      'Your last move was not saved in time, so the table is as it was before it: make it again if you still want to.',
    ])
    expect(socket.sent.some((m) => m.op === 'resync')).toBe(false)
  })

  it('lets go of a press still waiting when the game went, and does not say twice a press refused as crossing it', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    act(() => { room.act(1) })
    expect(room.answering).toBe(true)
    await deliver(socket, { op: 'restoring', reason: 'relay' })
    expect(room.answering).toBe(false)
    await deliver(socket, { op: 'refused', error: 'The table is coming back; nothing can be played until it is.', stale: true, restoring: true })
    // The table already says it is coming back; a banner saying so again would be the same words twice.
    expect(room.refusal).toBe(null)
    expect(room.restoring).toBe('relay')
    await deliver(socket, { op: 'restored', reason: 'relay', behind: 0, lost: 'act' }, ...whole(RUN.views[0], 2))
    expect(said().at(-1)).toBe('Your last move was not saved in time, so the table is as it was before it: make it again if you still want to.')
  })

  it('reads a room of any age forgivingly, and says what came back even where the game then goes', async () => {
    const socket = await mount()
    await deliver(socket, { op: 'seated', seat: 'p1', engineSeat: YOU }, ...stop(RUN.views[0], 1))
    await deliver(socket, { op: 'restoring', reason: 'a word from a newer relay' })
    expect(room.restoring).toBe('relay')
    await deliver(socket, { op: 'restored', behind: 'x', lost: 'fly' })
    await deliver(socket, { op: 'gone', reason: 'The engine stopped again before the game could go on, so it was not started a third time: the engine stopped (exit 3).' })
    expect(room.restoring).toBe(null)
    expect(room.gone).toMatch(/not started a third time/)
    expect(said().at(-1)).toBe('The relay restarted; the table is as it was at the last stop.')
  })
})
