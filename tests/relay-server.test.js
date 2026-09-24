import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { createRelay } from '../scripts/relay-server.mjs'
import { createEngineRoom, PACE_MS } from '../scripts/relay-engine.mjs'
import { guest, KIND, PROTOCOL } from '../src/lib/board/net.js'
import { relay, rooms as roomsApi } from '../src/lib/board/relay.js'
import { handOf, invariants } from '../src/lib/board/model.js'
import { resolve } from 'node:path'

// This suite runs under jsdom, where import.meta.url is not a file URL, so the path is taken from the repo root.
const FAKE_ENGINE = resolve(process.cwd(), 'tests/fixtures/fake-engine.mjs')

/**
 * The relay, driven over real sockets.
 *
 * What is worth guarding is what Moxgate's creator listed as the things that
 * were not obvious until they broke: a silent socket being dropped so the
 * client reconnects, a restart telling clients to come back, a room surviving
 * the process, and a late joiner getting the whole table from the server. And
 * the one decision the server makes for everyone — whose turn it is — which
 * has to be impossible to take from a client.
 */

const DECK = ['forest', 'forest', 'bear', 'bolt']
const LANES = { forest: 'lands', bear: 'creatures', bolt: null }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (test, ms = 2000) => {
  const start = Date.now()
  while (!test()) {
    if (Date.now() - start > ms) throw new Error('gave up waiting')
    await sleep(10)
  }
}
/** The same, for something only the engine can be asked. */
const untilAsked = async (test, ms = 2000) => {
  const start = Date.now()
  while (!(await test())) {
    if (Date.now() - start > ms) throw new Error('gave up waiting')
    await sleep(10)
  }
}

let dir
let relayServer
let base
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'relay-'))
  relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE })
  await new Promise((resolve) => relayServer.server.listen(0, resolve))
  base = `http://127.0.0.1:${relayServer.server.address().port}`
})
afterEach(async () => {
  await relayServer.shutdown()
  rmSync(dir, { recursive: true, force: true })
})

/** A player at a room, over the real wire, with the real protocol. */
async function sit(code, name, { seat = null, autoPong = true } = {}) {
  const api = roomsApi(base)
  const refusals = []
  const statuses = []
  const wire = relay({
    url: api.socketUrl(code),
    WebSocket: class extends WebSocket { constructor(url) { super(url, { autoPong }) } },
    onStatus: (s) => statuses.push(s),
  })
  const player = guest({ send: wire.send, name, seat, onRefused: (reason) => refusals.push(reason) })
  wire.onMessage((message) => player.receive(message))
  wire.onOpen(() => player.hello())
  await until(() => player.ready)
  return { player, wire, refusals, statuses, leave: () => wire.close() }
}

describe('rooms', () => {
  it('hands out a code, and says what is in a room', async () => {
    const api = roomsApi(base)
    const made = await api.open({ seats: 4 })
    expect(made.code).toMatch(/^[A-Z0-9]{5}$/)
    expect(made.seats).toBe(4)
    const seen = await api.peek(made.code)
    expect(seen.players).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(seen.seats).toEqual([])
    expect(await api.peek('ZZZZZ')).toBe(null)
  })

  it('keeps the seat count between two and six', async () => {
    const api = roomsApi(base)
    expect((await api.open({ seats: 1 })).seats).toBe(2)
    expect((await api.open({ seats: 9 })).seats).toBe(6)
    expect((await api.open({ seats: 'lots' })).seats).toBe(2)
  })

  it('refuses a socket to a room that does not exist', async () => {
    const api = roomsApi(base)
    const code = await new Promise((resolve) => {
      const ws = new WebSocket(api.socketUrl('ZZZZZ'))
      ws.on('error', () => resolve('error'))
      ws.on('unexpected-response', (_, res) => resolve(res.statusCode))
    })
    expect(code).toBe(404)
  })
})

describe('two people, one table', () => {
  it('seats them in order and keeps them in step', async () => {
    const { code } = await roomsApi(base).open()
    const ada = await sit(code, 'Ada')
    const bob = await sit(code, 'Bob')
    expect(ada.player.seat).toBe('p1')
    expect(bob.player.seat).toBe('p2')
    ada.player.do({ type: 'seat', player: 'p1', cards: DECK, lanes: LANES, shuffle: false })
    ada.player.do({ type: 'draw', player: 'p1', count: 2 })
    await until(() => handOf(bob.player.run.board, 'p1').length === 2)
    expect(JSON.stringify(bob.player.run.board)).toBe(JSON.stringify(ada.player.run.board))
    expect(invariants(bob.player.run.board)).toEqual([])
    ada.leave(); bob.leave()
  })

  it('will not let one player move the other’s cards', async () => {
    const { code } = await roomsApi(base).open()
    const ada = await sit(code, 'Ada')
    const bob = await sit(code, 'Bob')
    ada.player.do({ type: 'seat', player: 'p1', cards: DECK, lanes: LANES, shuffle: false })
    ada.player.do({ type: 'draw', player: 'p1', count: 1 })
    await until(() => handOf(bob.player.run.board, 'p1').length === 1)
    const card = handOf(bob.player.run.board, 'p1')[0]
    bob.player.do({ type: 'move', id: card.id, zone: 'graveyard' })
    await until(() => bob.refusals.length === 1)
    expect(bob.refusals[0].code).toBe('notYours')
    expect(handOf(ada.player.run.board, 'p1')).toHaveLength(1)
    ada.leave(); bob.leave()
  })

  it('gives a late joiner the whole table from the server, not from a player', async () => {
    const { code } = await roomsApi(base).open()
    const ada = await sit(code, 'Ada')
    ada.player.do({ type: 'seat', player: 'p1', cards: DECK, lanes: LANES, shuffle: false })
    ada.player.do({ type: 'draw', player: 'p1', count: 3 })
    ada.player.do({ type: 'life', player: 'p1', delta: -5 })
    await until(() => ada.player.run.board.life.p1 === 15)
    ada.leave()
    await sleep(30)
    // Nobody is connected. The table is still there.
    const bob = await sit(code, 'Bob')
    expect(bob.player.seat).toBe('p2')
    expect(handOf(bob.player.run.board, 'p1')).toHaveLength(3)
    expect(bob.player.run.board.life.p1).toBe(15)
    expect(bob.player.seats.map((s) => [s.seat, s.here])).toEqual([['p1', false], ['p2', true]])
    bob.leave()
  })

  it('says every seat is taken when it is', async () => {
    const { code } = await roomsApi(base).open({ seats: 2 })
    const ada = await sit(code, 'Ada')
    const bob = await sit(code, 'Bob')
    const api = roomsApi(base)
    const refused = await new Promise((resolve) => {
      const ws = new WebSocket(api.socketUrl(code))
      ws.on('open', () => ws.send(JSON.stringify({ t: KIND.hello, protocol: PROTOCOL, name: 'Cy' })))
      ws.on('message', (data) => { const m = JSON.parse(String(data)); if (m.t === KIND.refused) { ws.close(); resolve(m.reason.code) } })
    })
    expect(refused).toBe('full')
    ada.leave(); bob.leave()
  })
})

describe('whose turn it is', () => {
  it('is decided by the server: only the active player may pass, and the next seat with somebody in it is next', async () => {
    const { code } = await roomsApi(base).open({ seats: 4 })
    const ada = await sit(code, 'Ada')
    const bob = await sit(code, 'Bob')
    expect(ada.player.run.board.active).toBe('p1')
    // Bob tries to end Ada's turn — and to hand it to himself.
    bob.player.do({ type: 'nextTurn', player: 'p2' })
    await until(() => bob.refusals.length === 1)
    expect(bob.refusals[0].code).toBe('notYourTurn')
    expect(ada.player.run.board.active).toBe('p1')
    // Ada passes, trying to keep it: the server gives it to Bob.
    ada.player.do({ type: 'nextTurn', player: 'p1' })
    await until(() => bob.player.run.board.active === 'p2')
    expect(ada.player.run.board.active).toBe('p2')
    // Bob passes: seats p3 and p4 are empty, so it comes straight back to Ada.
    bob.player.do({ type: 'nextTurn' })
    await until(() => ada.player.run.board.active === 'p1')
    expect(ada.player.run.board.turn).toBe(2)
    ada.leave(); bob.leave()
  })
})

describe('the wire', () => {
  it('drops a socket that stops answering pings, so its client can come back', async () => {
    const { code } = await roomsApi(base).open()
    const ada = await sit(code, 'Ada')
    const mute = await sit(code, 'Mute', { autoPong: false })
    await until(() => mute.statuses.includes('reconnecting'), 1000)
    // The seat was marked empty while the socket was gone, and is reclaimed
    // by the same player when the wire comes back — same seat, same name.
    await until(() => mute.statuses.filter((s) => s === 'open').length >= 2, 3000)
    await until(() => mute.player.ready && mute.player.seat === 'p2')
    expect(ada.player.seats.find((s) => s.seat === 'p2').name).toBe('Mute')
    ada.leave(); mute.leave()
  })

  it('gets a seat back on reconnect, even before the server noticed the old socket go', async () => {
    const { code } = await roomsApi(base).open()
    const ada = await sit(code, 'Ada')
    // A second socket claiming Ada's seat, while the first is still open.
    const again = await sit(code, 'Ada', { seat: 'p1' })
    expect(again.player.seat).toBe('p1')
    await until(() => ada.wire.status === 'reconnecting' || ada.wire.status === 'open')
    again.leave(); ada.leave()
  })

  it('tells every client 1012 on a restart, and a client treats that as a reason to come back', async () => {
    const { code } = await roomsApi(base).open()
    const ada = await sit(code, 'Ada')
    const codes = []
    // Listen underneath the wire, on the raw socket, for the close code.
    const raw = new WebSocket(roomsApi(base).socketUrl(code))
    raw.on('close', (c) => codes.push(c))
    await new Promise((resolve) => raw.on('open', resolve))
    const port = relayServer.server.address().port
    await relayServer.shutdown()
    // shutdown() waits for the server side of the closing handshake. The
    // client socket learns the code a tick later, so wait for it rather
    // than read `codes` while the frame is still in flight.
    await until(() => codes.length > 0)
    expect(codes).toEqual([1012])
    await until(() => ada.statuses.includes('reconnecting'))
    // Back on the same port, from the same directory: the room is there.
    relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE })
    await new Promise((resolve) => relayServer.server.listen(port, resolve))
    await until(() => ada.wire.status === 'open' && ada.player.ready, 4000)
    expect(ada.player.seat).toBe('p1')
    ada.leave()
  })

  it('lets nobody in once it is going down, and does not wait on a socket that never answers', async () => {
    // A heartbeat slow enough that it does not find the quiet socket first.
    await relayServer.shutdown()
    relayServer = createRelay({ roomsDir: dir, pingMs: 60 * 1000, engineCommand: FAKE_ENGINE })
    await new Promise((resolve) => relayServer.server.listen(0, resolve))
    base = `http://127.0.0.1:${relayServer.server.address().port}`
    const { code } = await roomsApi(base).open()
    const ada = await sit(code, 'Ada')
    // A socket that finished its handshake and then went quiet, the way a
    // phone does when its signal goes: it reads nothing more, so it never
    // answers the close and the goodbye waits out its whole second.
    const { port } = relayServer.server.address()
    const quiet = connect(port, '127.0.0.1')
    quiet.on('error', () => { /* a reset is as good as a close here */ })
    quiet.write([
      `GET /rooms/${code}/ws HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13', '', '',
    ].join('\r\n'))
    expect(String(await new Promise((resolve) => quiet.once('data', resolve)))).toMatch(/^HTTP\/1\.1 101/)
    quiet.pause()
    const from = ada.statuses.length
    // Before, this waited thirty seconds on the quiet socket (ws's own close
    // timeout), and for ever on Ada once she had been let back in: either
    // is far past this test's time limit.
    await relayServer.shutdown()
    expect(relayServer.wss.clients.size).toBe(0)
    // The quiet socket was hung up on, not left for the process to end.
    quiet.resume()
    await new Promise((resolve) => (quiet.readyState === 'closed' ? resolve() : quiet.once('close', resolve)))
    // Ada, told 1012, came back a quarter of a second later, while the relay
    // was still waiting on the quiet socket. She was refused, not seated at
    // a table it had already written to disk.
    const since = ada.statuses.slice(from)
    expect(since[0]).toBe('reconnecting')
    expect(since).toContain('connecting')
    expect(since).not.toContain('open')
    quiet.destroy()
    ada.leave()
  })
})

describe('the disk', () => {
  it('writes a room as JSON and reads it back, table and seats intact', async () => {
    const { code } = await roomsApi(base).open({ seats: 3 })
    const ada = await sit(code, 'Ada')
    ada.player.do({ type: 'seat', player: 'p1', cards: DECK, lanes: LANES, shuffle: false })
    ada.player.do({ type: 'draw', player: 'p1', count: 2 })
    await until(() => handOf(ada.player.run.board, 'p1').length === 2)
    ada.leave()
    relayServer.flush()
    const files = readdirSync(dir)
    expect(files).toEqual([`${code}.json`])
    const saved = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'))
    expect(saved.seq).toBe(2)
    expect(saved.seats).toEqual([{ seat: 'p1', name: 'Ada' }])
    // Nothing but the board: no socket ids, no timers, nothing derived.
    expect(Object.keys(saved).sort()).toEqual(['code', 'seats', 'seq', 'snapshot', 'touchedAt', 'version'])

    await relayServer.shutdown()
    relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE })
    await new Promise((resolve) => relayServer.server.listen(0, resolve))
    base = `http://127.0.0.1:${relayServer.server.address().port}`
    const back = await roomsApi(base).peek(code)
    expect(back.seq).toBe(2)
    expect(back.players).toEqual(['p1', 'p2', 'p3'])
    expect(back.seats).toEqual([{ seat: 'p1', name: 'Ada', here: false }])
    const bob = await sit(code, 'Bob')
    expect(handOf(bob.player.run.board, 'p1')).toHaveLength(2)
    expect(bob.player.seq).toBe(2)
    bob.leave()
  })

  it('drops a room nobody has touched for a week, and keeps one that was', async () => {
    let clock = 1_000_000
    await relayServer.shutdown()
    relayServer = createRelay({ roomsDir: dir, pingMs: 60, idleMs: 1000, now: () => clock })
    await new Promise((resolve) => relayServer.server.listen(0, resolve))
    base = `http://127.0.0.1:${relayServer.server.address().port}`
    const old = (await roomsApi(base).open()).code
    clock += 900
    const fresh = (await roomsApi(base).open()).code
    clock += 200
    relayServer.sweep()
    expect(await roomsApi(base).peek(old)).toBe(null)
    expect((await roomsApi(base).peek(fresh)).code).toBe(fresh)
    relayServer.flush()
    expect(readdirSync(dir)).toEqual([`${fresh}.json`])
  })

  it('leaves a file it cannot read where it is', async () => {
    await relayServer.shutdown()
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'ABCDE.json'), '{ not json')
    writeFileSync(join(dir, 'FUTUR.json'), JSON.stringify({ version: 99, code: 'FUTUR' }))
    relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE })
    await new Promise((resolve) => relayServer.server.listen(0, resolve))
    expect(relayServer.rooms.size).toBe(0)
    expect(readdirSync(dir).sort()).toEqual(['ABCDE.json', 'FUTUR.json'])
  })
})

/**
 * The relay's other authority: a room the engine holds. Driven against the
 * scripted stand-in engine (tests/fixtures/fake-engine.mjs), which answers
 * from views captured off the real one, so what is tested here is the
 * relay's part — seating, starting, who may act, stale offers, and what
 * each seat is told — and not the rules.
 */
describe('an enforced room', () => {
  const DECK = { Mountain: 14, 'Raging Goblin': 6 }

  /** A client at an enforced room: the raw messages, kept. */
  async function join(code, name, { deck = DECK, seat = null, sideboard = null, deltas = false } = {}) {
    const api = roomsApi(base)
    const got = []
    const wire = relay({ url: api.socketUrl(code), WebSocket })
    wire.onMessage((m) => got.push(m))
    wire.onOpen(() => wire.send({ t: 'engine', op: 'sit', name, deck, seat, ...(sideboard ? { sideboard } : {}), ...(deltas ? { deltas: true } : {}) }))
    const last = (op) => [...got].reverse().find((m) => m.t === 'engine' && m.op === op) ?? null
    await until(() => last('seated'))
    return { got, wire, last, send: (m) => wire.send({ t: 'engine', ...m }), leave: () => wire.close() }
  }

  it('is opened on request, and says so', async () => {
    const api = roomsApi(base)
    const made = await api.open({ seats: 2, enforced: true })
    expect(made).toMatchObject({ mode: 'enforced', seats: 2 })
    const seen = await api.peek(made.code)
    expect(seen).toMatchObject({ mode: 'enforced', ai: 'heuristic', started: false })
    expect(seen.seats.map((s) => s.ai)).toEqual([null, 'heuristic'])
    expect((await api.health()).engine).toBe(true)
  })

  it('cannot be opened on a relay with no engine', async () => {
    const bare = createRelay({ engineCommand: null })
    await new Promise((resolve) => bare.server.listen(0, resolve))
    const api = roomsApi(`http://127.0.0.1:${bare.server.address().port}`)
    await expect(api.open({ seats: 2, enforced: true })).rejects.toThrow(/no engine/)
    expect((await api.health()).engine).toBe(false)
    await bare.shutdown()
  })

  it('starts the game once the human seat has sat down with a deck, and tells each seat its view', async () => {
    const api = roomsApi(base)
    const { code } = await api.open({ seats: 2, enforced: true })
    const you = await join(code, 'Robin')
    await until(() => you.last('view'), 5000)
    expect(you.last('seated')).toMatchObject({ seat: 'p1', engineSeat: 'e0' })
    const status = you.last('status').status
    expect(status).toMatchObject({ waiting: 'action', actor: 'e0', stop: 1 })
    expect(status.actions.length).toBeGreaterThan(0)
    const view = you.last('view')
    expect(view.you).toBe('e0')
    expect(view.state.viewingPlayerId).toBe('e0')
    const seats = you.last('seats').seats
    expect(seats[1]).toMatchObject({ ai: 'heuristic', ready: true })
    expect((await api.peek(code)).started).toBe(true)
    you.leave()
  })

  it('deals the sideboard too, mirrors it to the engine\'s seat, and says which card was left out of it', async () => {
    const api = roomsApi(base)
    const { code } = await api.open({ seats: 2, enforced: true })
    const sideboard = { 'Lava Axe': 2, 'Made-Up Wish': 1 }
    const you = await join(code, 'Robin', { sideboard })
    // The first seated comes at once; the one after the deal carries what the engine left out.
    await until(() => you.got.some((m) => m.op === 'seated' && m.sideboardLeftOut?.includes('Made-Up Wish')), 5000)
    const sent = (await relayServer.rooms.get(code).engine.engine.call('lastNew')).request
    expect(sent.players[0].sideboard).toEqual(sideboard)
    // The engine's seat plays a mirror of the deck, and a mirror is the whole of it.
    expect(sent.players[1]).toMatchObject({ ai: 'heuristic', deck: DECK, sideboard })
    you.leave()
  })

  it('passes printings through to an engine that reads them, and only counts to one that does not', async () => {
    const deck = { Mountain: { count: 14, set: 'por', number: '208' }, 'Raging Goblin': [{ count: 4, set: 'por', number: '145' }, { count: 2 }] }
    const current = await roomsApi(base).open({ seats: 2, enforced: true })
    const a = await join(current.code, 'Robin', { deck })
    await until(() => a.last('view'), 5000)
    expect((await relayServer.rooms.get(current.code).engine.engine.call('lastNew')).request.players[0].deck).toEqual(deck)
    a.leave()
    // An engine built before printings reads a deck line only as a count. The
    // environment is read when the relay starts that room's engine, at the sit.
    process.env.FAKE_PROTOCOL = '1'
    try {
      const older = await roomsApi(base).open({ seats: 2, enforced: true })
      const b = await join(older.code, 'Robin', { deck })
      await until(() => b.last('view'), 5000)
      const sent = (await relayServer.rooms.get(older.code).engine.engine.call('lastNew')).request
      expect(sent.players[0].deck).toEqual({ Mountain: 14, 'Raging Goblin': 6 })
      expect(sent.players[1].deck).toEqual({ Mountain: 14, 'Raging Goblin': 6 })
      b.leave()
    } finally {
      delete process.env.FAKE_PROTOCOL
    }
  })

  it('tells a seat which of its printings the engine has not got', async () => {
    const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
    const you = await join(code, 'Robin', { deck: { Mountain: 14, 'Raging Goblin': { count: 6, set: 'por', number: '9999' } } })
    await until(() => you.got.some((m) => m.op === 'seated' && m.unknownPrintings?.includes('Raging Goblin')), 5000)
    you.leave()
  })

  it('sends no sideboard for a deck that has none', async () => {
    const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
    const you = await join(code, 'Robin')
    await until(() => you.last('view'), 5000)
    const sent = (await relayServer.rooms.get(code).engine.engine.call('lastNew')).request
    expect(sent.players.every((p) => !('sideboard' in p))).toBe(true)
    you.leave()
  })

  it('lets the seat the engine is waiting on act, refuses the rest, and refuses a stale offer', async () => {
    const api = roomsApi(base)
    const { code } = await api.open({ seats: 3, enforced: true })
    const you = await join(code, 'Robin')
    const them = await join(code, 'Sam')
    await until(() => you.last('view') && them.last('view'), 5000)
    const { stop } = you.last('status').status
    them.send({ op: 'act', stop, index: 0 })
    await until(() => them.last('refused'))
    expect(them.last('refused').error).toMatch(/not you/)

    you.send({ op: 'act', stop, index: 0 })
    await until(() => you.last('status').status.stop === stop + 1, 5000)
    await until(() => them.last('status').status.stop === stop + 1, 5000)
    // The new status and the new view are separate messages, and the status
    // can land first, so wait for the view instead of counting it in flight.
    await until(() => you.got.filter((m) => m.op === 'view').length >= 2, 5000)
    expect(you.got.filter((m) => m.op === 'view').length).toBeGreaterThanOrEqual(2)
    // Their view is theirs: the engine was asked for it by their seat.
    expect(them.last('view').you).toBe('e1')

    you.send({ op: 'act', stop, index: 0 })
    await until(() => you.last('refused'))
    expect(you.last('refused')).toMatchObject({ stale: true })
    you.leave(); them.leave()
  })

  it('gives a seat back to someone who comes back for it, with the table as it stands', async () => {
    const api = roomsApi(base)
    const { code } = await api.open({ seats: 2, enforced: true })
    const first = await join(code, 'Robin')
    await until(() => first.last('view'), 5000)
    first.leave()
    const again = await join(code, 'Robin', { seat: 'p1', deck: null })
    await until(() => again.last('view'), 5000)
    expect(again.last('seated')).toMatchObject({ seat: 'p1', engineSeat: 'e0' })
    expect(again.last('status').status.waiting).toBe('action')
    again.leave()
  })

  /**
   * Watching the engine take its turn (HANDOFF.md, M2). A paced table stops
   * after each of the engine's own plays and the room takes the next step at
   * its pace, so what arrives on the wire is the turn happening rather than
   * the turn having happened. The stand-in engine plays as many as a test says
   * with `plays`: the captured shots are the player's stops alone.
   */
  describe('watching the engine play', () => {
    /** A room of the relay's, opened with a pace of its own. */
    const openPaced = async (pace, { seats = 2 } = {}) => {
      const res = await fetch(`${base}/rooms`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seats, enforced: true, pace }),
      })
      return res.json()
    }
    const engineAt = (code) => relayServer.rooms.get(code).engine.engine
    const views = (client) => client.got.filter((m) => m.op === 'view')
    const stops = (client) => client.got.filter((m) => m.op === 'status')

    it('takes the engine\'s turn a step at a time, and publishes a view after each', async () => {
      const { code } = await openPaced(20)
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const engine = engineAt(code)
      await engine.call('plays', { count: 3 })
      const seen = views(you).length
      const { stop } = you.last('status').status
      you.send({ op: 'act', stop, index: 0 })
      await until(() => you.last('status').status.stop === stop + 4, 5000)
      // Three of the engine's plays, each its own stop, each saying whose it
      // was and offering nothing; then the table is the player's again.
      expect(you.last('status').status.waiting).toBe('action')
      const engineStops = stops(you).filter((m) => m.status.waiting === 'engine')
      expect(engineStops).toHaveLength(3)
      expect(engineStops.every((m) => m.status.actor === 'e1')).toBe(true)
      expect(engineStops.every((m) => !m.status.actions && !m.status.decision)).toBe(true)
      expect(you.last('status').status.stop).toBe(stop + 4)
      // A status and the view it belongs to are two messages, and the status
      // is sent first, so the last view is waited for rather than counted
      // while it is still in flight.
      await until(() => views(you).length === seen + 4, 5000)
      // One continue a step, and not one more.
      expect((await engine.call('tally')).continues).toBe(3)
      you.leave()
    })

    it('waits the room\'s own pace between steps, and six hundred milliseconds where a room has none', async () => {
      // The waiting itself is faked: what is under test is how long the room
      // asks for, not that a test can sit through it.
      const runOne = async (paceMs) => {
        const waits = []
        const sent = []
        const socket = { id: 's1', seat: null }
        const room = createEngineRoom({
          code: 'PACED', seats: 2, ai: 'heuristic', engineCommand: FAKE_ENGINE,
          deliver: (_socket, m) => sent.push(m), wait: async (ms) => { waits.push(ms) },
          ...(paceMs === undefined ? {} : { paceMs }),
        })
        const last = (op) => [...sent].reverse().find((m) => m.op === op) ?? null
        room.join(socket)
        room.receive({ t: 'engine', op: 'sit', name: 'Robin', deck: DECK }, socket)
        await until(() => last('view'), 5000)
        await room.engine.call('plays', { count: 2 })
        const { stop } = last('status').status
        room.receive({ t: 'engine', op: 'act', stop, index: 0 }, socket)
        // The act's own stop, then one for each of the engine's two plays.
        await until(() => last('status').status.stop === stop + 3, 5000)
        await room.close()
        return waits
      }
      expect(await runOne(25)).toEqual([25, 25])
      expect(await runOne(undefined)).toEqual([PACE_MS, PACE_MS])
      // The number itself, not only that the room fell back to it: read from
      // the module under test, the line above holds for any default at all,
      // including one that left each of the engine's plays standing for five
      // seconds. Six hundred milliseconds is the pace M2 chose.
      expect(PACE_MS).toBe(600)
    })

    it('sends the table whole once, then deltas, numbered, each carrying only the log lines added since', async () => {
      const { code } = await openPaced(20)
      const you = await join(code, 'Robin', { deltas: true })
      await until(() => you.last('view'), 5000)
      const first = views(you)[0]
      expect(first.seq).toBe(1)
      expect(first.state).toBeTruthy()
      expect(first.delta).toBeUndefined()
      await engineAt(code).call('plays', { count: 2 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => views(you).length === 4, 5000)
      const after = views(you).slice(1)
      expect(after.map((m) => m.seq)).toEqual([2, 3, 4])
      expect(after.every((m) => m.delta && !m.state)).toBe(true)
      // The delta is Argentum's own: players whole, the log beside it rather
      // than inside it, and nothing said for what did not change.
      expect(after.every((m) => Array.isArray(m.delta.players))).toBe(true)
      expect(after.every((m) => m.delta.newLogEntries === undefined)).toBe(true)
      // Each line of the log arrives once, in order, across the deltas.
      expect(after.flatMap((m) => m.log.map((l) => l.description))).toEqual([
        'Something happened (1)', 'Something happened (2)', 'Something happened (3)', 'Something happened (4)',
      ])
      you.leave()
    })

    it('sends whole views to a client that never said it could apply a delta', async () => {
      const { code } = await openPaced(20)
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await engineAt(code).call('plays', { count: 2 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => views(you).length === 4, 5000)
      expect(views(you).every((m) => m.state && !m.delta)).toBe(true)
      expect(views(you).map((m) => m.seq)).toEqual([1, 2, 3, 4])
      // Whole means whole: the log comes with it every time, not in pieces.
      expect(views(you)[3].log.map((l) => l.description)).toEqual([
        'Something happened (1)', 'Something happened (2)', 'Something happened (3)', 'Something happened (4)',
      ])
      you.leave()
    })

    it('answers a resync with the table whole, numbered on from the view that was missed', async () => {
      const { code } = await openPaced(20)
      const you = await join(code, 'Robin', { deltas: true })
      await until(() => you.last('view'), 5000)
      await engineAt(code).call('plays', { count: 0 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => views(you).length === 2, 5000)
      expect(views(you)[1].delta).toBeTruthy()
      you.send({ op: 'resync' })
      await until(() => views(you).length === 3, 5000)
      const whole = views(you)[2]
      expect(whole.seq).toBe(3)
      expect(whole.state).toBeTruthy()
      expect(whole.delta).toBeUndefined()
      // And the whole log with it, so a client that missed a delta replaces
      // what it held rather than appending to a log with a hole in it.
      expect(whole.log.map((l) => l.description)).toEqual(['Something happened (1)'])
      you.leave()
    })

    it('stops when the last socket goes, and takes the turn up again when somebody sits back down', async () => {
      const { code } = await openPaced(40)
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const engine = engineAt(code)
      await engine.call('plays', { count: 6 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => you.last('status').status.waiting === 'engine', 5000)
      you.leave()
      await until(() => relayServer.rooms.get(code).sockets.size === 0, 2000)
      const stopped = (await engine.call('tally')).continues
      await sleep(200)
      expect((await engine.call('tally')).continues).toBe(stopped)
      const again = await join(code, 'Robin', { seat: 'p1', deck: null })
      await untilAsked(async () => (await engine.call('tally')).continues > stopped, 5000)
      await until(() => again.last('status')?.status.waiting === 'action', 5000)
      again.leave()
    })

    it('stops when the last seat is empty, even with a socket still in the room', async () => {
      // A socket is in the room from the moment it connects, seat or no seat,
      // and a sit refused for want of one leaves it there. It can be sent no
      // view — `sendView` has no seat to send one to — so a turn driven for it
      // is a turn nobody watches and a round trip a step for nothing.
      const { code } = await openPaced(40)
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const spare = await new Promise((resolve) => {
        const got = []
        const wire = relay({ url: roomsApi(base).socketUrl(code), WebSocket })
        wire.onMessage((m) => { got.push(m); if (m.op === 'refused') resolve({ got, leave: () => wire.close() }) })
        wire.onOpen(() => wire.send({ t: 'engine', op: 'sit', name: 'Sam', deck: DECK }))
      })
      expect(spare.got.some((m) => m.op === 'refused' && /Every seat is taken/.test(m.error))).toBe(true)
      const engine = engineAt(code)
      await engine.call('plays', { count: 6 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => you.last('status').status.waiting === 'engine', 5000)
      you.leave()
      await until(() => relayServer.rooms.get(code).sockets.size === 1, 2000)
      const stopped = (await engine.call('tally')).continues
      await sleep(250)
      expect((await engine.call('tally')).continues).toBe(stopped)
      spare.leave()
    })

    it('takes the chain up again when a view never reaches a seat, rather than leaving a hole in it', async () => {
      // The engine moves a seat on as it builds the reply — its own last view
      // for that seat, and its count of the lines sent — so a view the room
      // never got has still advanced it, and the delta after it would be
      // against a view nobody holds. The numbers would stay consecutive, and
      // the client would see nothing wrong.
      const { code } = await openPaced(20)
      const you = await join(code, 'Robin', { deltas: true })
      await until(() => you.last('view'), 5000)
      const engine = engineAt(code)
      await engine.call('dropViews', { count: 1 })
      await engine.call('plays', { count: 2 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => views(you).length === 3, 5000)
      const after = views(you).slice(1)
      // The lost one is not sent at all, and what follows it is the table
      // whole: a delta chain that has a hole in it is started again.
      expect(after[0].state).toBeTruthy()
      expect(after[0].delta).toBeUndefined()
      // With the whole log, so not one line went with the view that was lost.
      expect(after[0].log.map((l) => l.description)).toEqual([
        'Something happened (1)', 'Something happened (2)', 'Something happened (3)',
      ])
      // And deltas again from there.
      expect(after[1].delta).toBeTruthy()
      expect(after[1].log.map((l) => l.description)).toEqual(['Something happened (4)'])
      you.leave()
    })

    it('gives up on a turn the engine will not take, and says so rather than leave the table thinking', async () => {
      const { code } = await openPaced(20)
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const engine = engineAt(code)
      await engine.call('plays', { count: 6 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => you.last('status').status.waiting === 'engine', 5000)
      // Alive, still saying the turn is its own, and refusing every step of
      // it: a call that timed out looks exactly like this from the room.
      await engine.call('sulk')
      await until(() => you.last('gone'), 5000)
      expect(you.last('gone').reason).toMatch(/stopped taking its turn/)
      // Bounded: it tried a few times and then stopped, rather than asking a
      // broken engine once a pace for the rest of the game.
      const tried = (await engine.call('tally')).continues
      await sleep(200)
      expect((await engine.call('tally')).continues).toBe(tried)
      you.leave()
    })

    it('takes up one loop only when somebody rejoins a seat mid-turn', async () => {
      // A sit takes the turn up again — whoever came back mid-turn is who the
      // pace was waiting for — and without the guard that is a second loop on
      // the same room: two steps asked for per pace, two publishes to the same
      // seats, and view numbers handed out against views fetched out of order.
      // An act mid-turn cannot start one (it is refused before it reaches
      // `drive`), so a rejoin is the only way in. Counted rather than timed:
      // the room's own wait is faked, and what is watched is how many of them
      // are outstanding at once, which is one loop or two and nothing else.
      const sent = []
      let waiting = 0
      let atOnce = 0
      const first = { id: 's1', seat: null }
      const back = { id: 's2', seat: null }
      const room = createEngineRoom({
        code: 'REJOIN', seats: 2, ai: 'heuristic', engineCommand: FAKE_ENGINE, paceMs: 5,
        deliver: (socket, m) => sent.push({ socket, ...m }),
        wait: async () => { waiting++; atOnce = Math.max(atOnce, waiting); await sleep(5); waiting-- },
      })
      const last = (op) => [...sent].reverse().find((m) => m.op === op) ?? null
      room.join(first)
      room.receive({ t: 'engine', op: 'sit', name: 'Robin', deck: DECK, deltas: true }, first)
      await until(() => last('view'), 5000)
      await room.engine.call('plays', { count: 8 })
      room.receive({ t: 'engine', op: 'act', stop: last('status').status.stop, index: 0 }, first)
      await until(() => last('status').status.waiting === 'engine', 5000)
      room.join(back)
      room.receive({ t: 'engine', op: 'sit', name: 'Robin', seat: 'p1', deck: null, deltas: true }, back)
      await until(() => last('status').status.waiting === 'action', 5000)
      expect(atOnce).toBe(1)
      // One step a play, and not one more.
      expect((await room.engine.call('tally')).continues).toBe(8)
      // The rejoin ends the first socket from inside `sit`, so the numbers are
      // read from the one that took the seat: consecutive, none twice.
      const seqs = sent.filter((m) => m.op === 'view' && m.socket === back).map((m) => m.seq)
      expect(seqs.length).toBeGreaterThan(1)
      expect(seqs.slice(1).every((n, i) => n === seqs[i] + 1)).toBe(true)
      const numbers = sent.filter((m) => m.op === 'status' && m.socket === back).map((m) => m.status.stop)
      expect(new Set(numbers).size).toBe(numbers.length)
      await room.close()
    })

    it('refuses a player who acts while the engine is mid-turn, and the turn goes on without a second loop', async () => {
      const { code } = await openPaced(30)
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const engine = engineAt(code)
      await engine.call('plays', { count: 3 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => you.last('status').status.waiting === 'engine', 5000)
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => you.last('refused'), 5000)
      expect(you.last('refused').error).toMatch(/not you/)
      await until(() => you.last('status').status.waiting === 'action', 5000)
      expect((await engine.call('tally')).continues).toBe(3)
      you.leave()
    })

    it('reports an engine that dies mid-turn, as it reports one that dies at any other time', async () => {
      const { code } = await openPaced(40)
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const engine = engineAt(code)
      await engine.call('plays', { count: 6 })
      you.send({ op: 'act', stop: you.last('status').status.stop, index: 0 })
      await until(() => you.last('status').status.waiting === 'engine', 5000)
      await engine.call('die').catch(() => {})
      await until(() => you.last('gone'), 5000)
      // Whichever way round it happened — the step in flight when the process
      // went, or the one asked for after — the room says so in the engine's
      // own words, once, exactly as it does for an act that finds it dead.
      expect(you.last('gone').reason).toMatch(/The engine (stopped|is not running)/)
      you.leave()
    })

    it('never asks an older engine for a pace, a continue or a delta', async () => {
      // The environment is read when the relay starts that room's engine, at the sit.
      process.env.FAKE_PROTOCOL = '2'
      try {
        const { code } = await openPaced(20)
        const you = await join(code, 'Robin', { deltas: true })
        await until(() => you.last('view'), 5000)
        const engine = engineAt(code)
        expect('pace' in (await engine.call('lastNew')).request).toBe(false)
        expect(relayServer.rooms.get(code).engine.describe().paced).toBe(false)
        // It would stop, if it had been asked to and could be continued.
        await engine.call('plays', { count: 3 })
        const { stop } = you.last('status').status
        you.send({ op: 'act', stop, index: 0 })
        await until(() => you.last('status').status.stop === stop + 1, 5000)
        await sleep(150)
        expect((await engine.call('tally')).continues).toBe(0)
        expect(you.got.some((m) => m.op === 'status' && m.status.waiting === 'engine')).toBe(false)
        // And its views come whole, because its deltas carry a log this relay
        // would append twice.
        expect(views(you).every((m) => m.state && !m.delta)).toBe(true)
        you.leave()
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
    })
  })

  it('is not written to disk, and its engine goes when the relay does', async () => {
    const api = roomsApi(base)
    const { code } = await api.open({ seats: 2, enforced: true })
    const you = await join(code, 'Robin')
    await until(() => you.last('view'), 5000)
    relayServer.flush()
    expect(readdirSync(dir).some((f) => f.startsWith(code))).toBe(false)
    const room = relayServer.rooms.get(code)
    const pid = room.engine.engine.pid
    expect(pid).toBeGreaterThan(0)
    you.leave()
    await relayServer.shutdown()
    await until(() => room.engine.engine.exited, 3000)
    relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE })
    await new Promise((resolve) => relayServer.server.listen(0, resolve))
    base = `http://127.0.0.1:${relayServer.server.address().port}`
  })
})

describe('a deck checked before any room exists', () => {
  const DECK = { Mountain: 14, 'Raging Goblin': 6 }
  const post = (body, init = {}) => fetch(`${base}/engine/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, ...init })
  // The fake engine's hello, as the relay passes it on: codes as the engine
  // gives them, and without the engine's own release dates.
  const ENGINE_SETS = [
    { code: 'POR', name: 'Portal', incomplete: false },
    { code: 'TRC', name: 'Star Trek Commander', incomplete: true },
    { code: 'HOB', name: 'The Hobbit', incomplete: false },
  ]

  it('answers which cards the engine knows, naming the rest, and opens no room to do it', async () => {
    const answer = await roomsApi(base).check({ ...DECK, 'Made-Up Card': 2 })
    expect(answer).toEqual({ known: 20, total: 22, unknown: ['Made-Up Card'], unknownSideboard: [], engineSets: ENGINE_SETS })
    expect(relayServer.rooms.size).toBe(0)
  })

  it('reads a deck pinned to printings as well as a plain one, and its sideboard', async () => {
    const answer = await roomsApi(base).check(
      { Mountain: { count: 14, set: 'por', number: '1' }, 'Raging Goblin': [{ count: 4, set: 'por', number: '2' }, { count: 2 }] },
      { sideboard: { 'Made-Up Wish': 1 } },
    )
    expect(answer).toEqual({ known: 20, total: 20, unknown: [], unknownSideboard: ['Made-Up Wish'], engineSets: ENGINE_SETS })
  })

  it('passes on the sets the engine says it holds, incomplete ones marked, and never their dates', async () => {
    const res = await post(JSON.stringify({ deck: DECK }))
    const body = await res.json()
    expect(body.engineSets).toEqual(ENGINE_SETS)
    expect(JSON.stringify(body)).not.toMatch(/released|\d{4}-\d{2}-\d{2}/)
  })

  it('an engine that lists no sets sends none, and the client reads that as no list', async () => {
    // The environment is read when the relay starts its checking engine, at the first check.
    process.env.FAKE_NO_SETS = '1'
    try {
      const res = await post(JSON.stringify({ deck: DECK }))
      expect('engineSets' in (await res.json())).toBe(false)
      expect((await roomsApi(base).check(DECK)).engineSets).toBeNull()
    } finally {
      delete process.env.FAKE_NO_SETS
    }
  })

  it('reads a list from the reply forgivingly, keeping it as the relay sent it for the lobby to read', async () => {
    let reply = { known: 1, total: 1, unknown: [], engineSets: 'POR' }
    const odd = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply)) })
    await new Promise((resolve) => odd.listen(0, resolve))
    const api = roomsApi(`http://127.0.0.1:${odd.address().port}`)
    expect((await api.check(DECK)).engineSets).toBeNull()
    reply = { ...reply, engineSets: [{ code: 'POR' }, null, 7] }
    expect((await api.check(DECK)).engineSets).toEqual([{ code: 'POR' }, null, 7])
    await new Promise((resolve) => odd.close(resolve))
  })

  it('starts one engine only when asked, and keeps it for every check after', async () => {
    expect(relayServer.checker).toBeNull()
    const answers = await Promise.all(Array.from({ length: 5 }, () => roomsApi(base).check(DECK)))
    expect(answers.every((a) => a.known === 20)).toBe(true)
    expect(relayServer.checkersStarted).toBe(1)
    const pid = relayServer.checker.pid
    await roomsApi(base).check(DECK)
    expect(relayServer.checker.pid).toBe(pid)
  })

  it('replaces an engine that died, rather than asking a dead one', async () => {
    await roomsApi(base).check(DECK)
    const first = relayServer.checker
    await first.call('die').catch(() => {})
    expect((await roomsApi(base).check(DECK)).known).toBe(20)
    expect(relayServer.checkersStarted).toBe(2)
    expect(relayServer.checker.pid).not.toBe(first.pid)
  })

  it('lets an idle engine go', async () => {
    const quick = createRelay({ engineCommand: FAKE_ENGINE, checkIdleMs: 50 })
    await new Promise((resolve) => quick.server.listen(0, resolve))
    await roomsApi(`http://127.0.0.1:${quick.server.address().port}`).check(DECK)
    const held = quick.checker
    await until(() => quick.checker === null)
    await until(() => held.exited)
    await quick.shutdown()
  })

  it('refuses what is not a deck, and a body too large to be one', async () => {
    for (const body of ['not json', '{}', JSON.stringify({ deck: [] })]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(typeof (await res.json()).error).toBe('string')
    }
    const big = await post(JSON.stringify({ deck: { ['x'.repeat(70 * 1024)]: 1 } }))
    expect(big.status).toBe(413)
  })

  it('says so when the relay has no engine, and starts nothing', async () => {
    const bare = createRelay({ engineCommand: null })
    await new Promise((resolve) => bare.server.listen(0, resolve))
    const asking = roomsApi(`http://127.0.0.1:${bare.server.address().port}`).check(DECK)
    await expect(asking).rejects.toThrow(/no engine/)
    await expect(asking).rejects.toMatchObject({ status: 503 })
    expect(bare.checkersStarted).toBe(0)
    await bare.shutdown()
  })

  it('answers a page served from another origin', async () => {
    const pre = await fetch(`${base}/engine/check`, { method: 'OPTIONS' })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-methods')).toMatch(/POST/)
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/content-type/)
    expect((await post(JSON.stringify({ deck: DECK }))).headers.get('access-control-allow-origin')).toBe('*')
  })

  it('an older relay cannot check, and the client says so rather than throwing', async () => {
    const old = createServer((req, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not found"}') })
    await new Promise((resolve) => old.listen(0, resolve))
    expect(await roomsApi(`http://127.0.0.1:${old.address().port}`).check(DECK)).toBeNull()
    await new Promise((resolve) => old.close(resolve))
  })

  it('agrees with the deal: what the check names, starting the game refuses', async () => {
    const api = roomsApi(base)
    const deck = { Mountain: 14, 'Made-Up Card': 2 }
    expect((await api.check(deck)).unknown).toEqual(['Made-Up Card'])
    const { code } = await api.open({ seats: 2, enforced: true })
    const got = []
    const wire = relay({ url: api.socketUrl(code), WebSocket })
    wire.onMessage((m) => got.push(m))
    wire.onOpen(() => wire.send({ t: 'engine', op: 'sit', name: 'Robin', deck }))
    await until(() => got.some((m) => m.op === 'gone'), 5000)
    expect(got.find((m) => m.op === 'gone').reason).toMatch(/Made-Up Card/)
    // The engine that refused the deal is closed, not left holding the corpus.
    await until(() => relayServer.rooms.get(code).engine.lastStarted?.exited)
    wire.close()
  })

  it('reads a name whose letters are split between two chunks of the body', async () => {
    const body = Buffer.from(JSON.stringify({ deck: { 'Made-Up Æther': 1 } }), 'utf8')
    const at = body.indexOf(Buffer.from('Æ', 'utf8')) + 1 // inside the two bytes of Æ
    const answer = await new Promise((resolve, reject) => {
      const req = request(`${base}/engine/check`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length } }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      })
      req.on('error', reject)
      req.write(body.subarray(0, at))
      setTimeout(() => req.end(body.subarray(at)), 50)
    })
    expect(answer.unknown).toEqual(['Made-Up Æther'])
  })

  it("says why the engine could not check a deck, in the engine's words alone", async () => {
    const res = await post(JSON.stringify({ deck: { 'Made-Up Crash': 1 } }))
    expect(res.status).toBe(502)
    const { error } = await res.json()
    expect(error).toMatch(/stopped/)
    // The lobby puts "The engine could not check this deck:" in front itself.
    expect(error).not.toMatch(/could not check/)
  })

  it('an answer that cannot be read is said to be one, not taken for a deck the engine knows', async () => {
    let reply = '{"known":'
    const odd = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(reply) })
    await new Promise((resolve) => odd.listen(0, resolve))
    const api = roomsApi(`http://127.0.0.1:${odd.address().port}`)
    await expect(api.check(DECK)).rejects.toBeInstanceOf(SyntaxError)
    reply = '{}'
    await expect(api.check(DECK)).rejects.toBeInstanceOf(SyntaxError)
    await new Promise((resolve) => odd.close(resolve))
  })

  it('closes its engine with the relay', async () => {
    await roomsApi(base).check(DECK)
    const held = relayServer.checker
    await relayServer.shutdown()
    expect(held.exited).toBeTruthy()
    relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE })
    await new Promise((resolve) => relayServer.server.listen(0, resolve))
    base = `http://127.0.0.1:${relayServer.server.address().port}`
  })
})
