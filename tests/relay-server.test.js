import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { createRelay } from '../scripts/relay-server.mjs'
import { clause, createEngineRoom, PACE_MS, RESTORING, TRIED_AGAIN, savedRoomOf } from '../scripts/relay-engine.mjs'
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
  async function join(code, name, { deck = DECK, seat = null, sideboard = null, deltas = false, level = null, answers = null, mulligans = false, engineDeck = undefined, format = undefined, commander = undefined } = {}) {
    const api = roomsApi(base)
    const got = []
    const wire = relay({ url: api.socketUrl(code), WebSocket })
    wire.onMessage((m) => got.push(m))
    wire.onOpen(() => wire.send({ t: 'engine', op: 'sit', name, deck, seat, ...(sideboard ? { sideboard } : {}), ...(deltas ? { deltas: true } : {}), ...(level ? { level } : {}), ...(answers ? { answers } : {}), ...(mulligans ? { mulligans: true } : {}), ...(engineDeck !== undefined ? { engineDeck } : {}), ...(format !== undefined ? { format } : {}), ...(commander !== undefined ? { commander } : {}) }))
    const last = (op) => [...got].reverse().find((m) => m.t === 'engine' && m.op === op) ?? null
    await until(() => last('seated'))
    return { got, wire, last, send: (m) => wire.send({ t: 'engine', ...m }), leave: () => wire.close() }
  }

  /**
   * A move, and the room's whole answer to it: the status, and then the view it
   * sends after the status. The room keeps its one-move guard up until that view
   * is out (M3), so a next move sent on the status alone can land inside the
   * guard and be refused — which, beside a JVM, it did (found at M4).
   */
  async function moved(who, message) {
    const views = who.got.filter((m) => m.op === 'view').length
    who.send(message)
    await until(() => who.last('status')?.status.stop === message.stop + 1 && who.got.filter((m) => m.op === 'view').length > views, 5000)
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

  describe('how strongly the engine plays', () => {
    /** The seated after the deal: the one with an engine seat in it. */
    const dealtSeat = (who) => [...who.got].reverse().find((m) => m.op === 'seated' && m.engineSeat) ?? null
    const engineAt = (code) => relayServer.rooms.get(code).engine.engine

    it('is a setting of the room, asked of the engine for its own seat at the deal, and said once taken', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true, level: 'hard' })
      const before = await api.peek(code)
      expect(before).toMatchObject({ level: 'hard', started: false })
      expect(before).not.toHaveProperty('played')
      expect(before.seats[1]).toMatchObject({ ai: 'heuristic', level: 'hard' })
      const you = await join(code, 'Robin')
      // The seated that answers the sit comes before any deal and names no level.
      expect(you.got.find((m) => m.op === 'seated')).not.toHaveProperty('level')
      await until(() => dealtSeat(you), 5000)
      expect(dealtSeat(you).level).toBe('hard')
      const sent = (await engineAt(code).call('lastNew')).request
      expect(sent.players[1]).toMatchObject({ ai: 'heuristic', level: 'hard' })
      // The person's seat is not the engine's to play, so it is asked no level.
      expect(sent.players[0]).not.toHaveProperty('level')
      const after = await api.peek(code)
      expect(after).toMatchObject({ level: 'hard', played: 'hard', profile: 'production-candidate-expiring', started: true })
      expect(after.seats[1].level).toBe('hard')
      you.leave()
    })

    it('takes the level a sit brings until the deal, and keeps the game\'s after it', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      expect((await api.peek(code)).level).toBeNull()
      const you = await join(code, 'Robin', { level: 'easy' })
      await until(() => dealtSeat(you), 5000)
      expect((await engineAt(code).call('lastNew')).request.players[1].level).toBe('easy')
      expect(dealtSeat(you).level).toBe('easy')
      you.leave()
      // Back with another level chosen since: the game is the one it was dealt as.
      const again = await join(code, 'Robin', { seat: 'p1', level: 'hard' })
      await until(() => dealtSeat(again), 5000)
      expect(dealtSeat(again).level).toBe('easy')
      expect(await api.peek(code)).toMatchObject({ level: 'easy', played: 'easy' })
      again.leave()
    })

    it('reads a level it does not know as none, and a room asked for none asks the engine for none', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true, level: 'grandmaster' })
      expect((await api.peek(code)).level).toBeNull()
      const you = await join(code, 'Robin', { level: 'expert' })
      await until(() => dealtSeat(you), 5000)
      // A tab from before levels asks for none, and plays as it always did.
      expect((await engineAt(code).call('lastNew')).request.players[1]).not.toHaveProperty('level')
      expect(dealtSeat(you).level).toBeNull()
      you.leave()
    })

    it('never asks an older engine for a level, and says it is playing at none', async () => {
      // The environment is read when the relay starts that room's engine, at the sit.
      process.env.FAKE_PROTOCOL = '3'
      try {
        const api = roomsApi(base)
        const { code } = await api.open({ seats: 2, enforced: true, level: 'hard' })
        const you = await join(code, 'Robin', { level: 'hard' })
        await until(() => dealtSeat(you), 5000)
        expect((await engineAt(code).call('lastNew')).request.players[1]).not.toHaveProperty('level')
        expect(dealtSeat(you).level).toBeNull()
        expect(await api.peek(code)).toMatchObject({ level: 'hard', played: null })
        expect((await api.peek(code)).seats[1].level).toBeNull()
        you.leave()
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
    })

    it('asks no level for a seat played at random, which has none, and says which kind of player it fields', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true, ai: 'random', level: 'hard' })
      const you = await join(code, 'Robin')
      await until(() => dealtSeat(you), 5000)
      expect((await engineAt(code).call('lastNew')).request.players[1]).toMatchObject({ ai: 'random' })
      expect((await engineAt(code).call('lastNew')).request.players[1]).not.toHaveProperty('level')
      // A null level here is not "an engine older than the levels": a random
      // player has none, and the seated says which kind the room fields.
      expect(dealtSeat(you)).toMatchObject({ level: null, ai: 'random' })
      you.leave()
    })

    it('says a heuristic engine player is one in the seated after the deal', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true, level: 'easy' })
      const you = await join(code, 'Robin')
      await until(() => dealtSeat(you), 5000)
      expect(dealtSeat(you)).toMatchObject({ level: 'easy', ai: 'heuristic' })
      // The seated before the deal says nothing of either.
      expect(you.got.find((m) => m.op === 'seated')).not.toHaveProperty('ai')
      you.leave()
    })

    it('tells a room whose engine is still loading from one that has dealt', async () => {
      // The stand-in holds its first hello, as the real engine takes seconds to
      // load the corpus before it answers. A lobby that read "started" as "under
      // way" said the game was being played, one way only, in that time.
      process.env.FAKE_HOLD_HELLO = '1'
      try {
        const api = roomsApi(base)
        const { code } = await api.open({ seats: 2, enforced: true, level: 'hard' })
        const you = await join(code, 'Robin')
        await until(() => relayServer.rooms.get(code).engine.engine, 5000)
        const loading = await api.peek(code)
        expect(loading).toMatchObject({ started: true, dealt: false, level: 'hard' })
        expect(loading).not.toHaveProperty('played')
        await engineAt(code).call('release')
        await until(() => dealtSeat(you), 5000)
        expect(await api.peek(code)).toMatchObject({ started: true, dealt: true, level: 'hard', played: 'hard' })
        you.leave()
      } finally {
        delete process.env.FAKE_HOLD_HELLO
      }
    })
  })

  /**
   * What the engine's seat plays (HANDOFF.md, M5, the owner's answer of
   * 2026-09-25): a copy of the person's deck, one of their decks, or one the
   * engine builds, from the sets the person's deck uses or from the whole
   * format. The sit asks, the room keeps the ask until the deal, and every
   * seated after it says what was dealt — and never a card of it.
   */
  describe('what the engine\'s seat plays', () => {
    const dealtSeat = (who) => [...who.got].reverse().find((m) => m.op === 'seated' && m.engineSeat) ?? null
    const engineAt = (code) => relayServer.rooms.get(code).engine.engine
    const sentFor = async (code) => (await engineAt(code).call('lastNew')).request.players
    const ELVES = { Forest: 20, 'Llanowar Elves': 20 }

    it('deals a copy of the person\'s deck where nothing is asked, as every room did, and says so after the deal', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { sideboard: { 'Lava Axe': 2 } })
      // The seated that answers the sit comes before any deal and says nothing of it.
      expect(you.got.find((m) => m.op === 'seated')).not.toHaveProperty('engineDeck')
      await until(() => dealtSeat(you), 5000)
      const [person, bot] = await sentFor(code)
      expect(bot).toMatchObject({ ai: 'heuristic', deck: DECK, sideboard: { 'Lava Axe': 2 } })
      expect(person.deck).toEqual(DECK)
      expect(dealtSeat(you).engineDeck).toEqual({ asked: 'mirror', played: 'mirror', cards: 20, colours: ['R'] })
      expect((await api.peek(code)).engineDeck).toEqual(dealtSeat(you).engineDeck)
      you.leave()
    })

    it('deals one of the person\'s other decks by its names, and says it by its name', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { engineDeck: { kind: 'deck', name: 'Elves', deck: ELVES, sideboard: { Naturalize: 2 } } })
      // Asked, and not yet dealt: the room says what it was asked.
      expect((await api.peek(code)).engineDeck).toMatchObject({ asked: 'deck', name: 'Elves' })
      await until(() => dealtSeat(you), 5000)
      const [person, bot] = await sentFor(code)
      expect(bot).toMatchObject({ deck: ELVES, sideboard: { Naturalize: 2 } })
      expect(person.deck).toEqual(DECK)
      expect(dealtSeat(you).engineDeck).toEqual({ asked: 'deck', played: 'deck', cards: 40, colours: ['R'], name: 'Elves' })
      you.leave()
    })

    it('asks the engine to build a deck of its own from the sets asked, to the format, and says what it built without a card of it', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { engineDeck: { kind: 'own', format: 'legacy', sets: ['por', 'sld'] } })
      // Said with the format asked, so a lobby can say the copy while the engine deals where it builds none.
      expect((await api.peek(code)).engineDeck).toEqual({ asked: 'own', pool: 'sets', format: 'legacy' })
      await until(() => dealtSeat(you), 5000)
      const [person, bot] = await sentFor(code)
      expect(bot).toEqual({ name: 'The engine', deck: 'own', format: 'legacy', sets: ['por', 'sld'], ai: 'heuristic', autoPass: false })
      expect(person.deck).toEqual(DECK)
      const said = dealtSeat(you).engineDeck
      expect(said).toEqual({
        asked: 'own', played: 'own', cards: 60, colours: ['R', 'G'], format: 'legacy', formatName: 'Legacy',
        from: 'sets', sets: [{ code: 'POR', name: 'Portal' }], missingSets: ['sld'],
      })
      expect((await api.peek(code)).engineDeck).toEqual(said)
      you.leave()
    })

    it('asks for the whole format where the switch says so, sending no sets at all', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { engineDeck: { kind: 'own', format: 'standard', sets: null } })
      await until(() => dealtSeat(you), 5000)
      expect((await sentFor(code))[1]).not.toHaveProperty('sets')
      expect(dealtSeat(you).engineDeck).toMatchObject({ played: 'own', from: 'format', format: 'standard' })
      expect(dealtSeat(you).engineDeck).not.toHaveProperty('fellBack')
      you.leave()
    })

    // One room each: a room is an engine started, and several in one test
    // outran its time beside the JVM of the live suite (found in M5's run).
    it.each([
      ['a format it builds none to', { kind: 'own', format: 'brawl', sets: ['por'] }, { asked: 'own', played: 'mirror', format: 'brawl', fellBack: 'format', why: 'The engine builds no "brawl" deck of its own.' }],
      ['a Commander deck of its own, at a table dealt by the ordinary rules', { kind: 'own', format: 'commander', sets: ['por'] }, { asked: 'own', played: 'mirror', format: 'commander', fellBack: 'format', why: 'A "commander" deck of its own is built only for a Commander game.' }],
      ['sets too thin to build from', { kind: 'own', format: 'standard', sets: ['trc'] }, { asked: 'own', played: 'own', from: 'format', fellBack: 'thin', why: 'The deck came to 12 cards, short of 60.' }],
      ['sets it has not got', { kind: 'own', format: 'standard', sets: ['zzz'] }, { asked: 'own', played: 'own', from: 'format', fellBack: 'sets', missingSets: ['zzz'] }],
      ['a deck with no set to go by', { kind: 'own', format: 'standard', sets: [] }, { asked: 'own', played: 'own', from: 'format', fellBack: 'sets' }],
    ])('passes on the engine\'s fallback and its reason: %s', async (_, engineDeck, expected) => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { engineDeck })
      await until(() => dealtSeat(you), 5000)
      expect(dealtSeat(you).engineDeck).toMatchObject(expected)
      you.leave()
    })

    it('passes on only what a client may be told of the engine\'s deck, whatever else the engine says', async () => {
      // The stand-in says its cards by name, a count that is no count, colours as
      // a word, sets it cannot name, and a fallback and a commander that are not
      // words at all; the room keeps what it can read and drops the rest.
      process.env.FAKE_DECK_REPORT = 'noisy'
      try {
        const api = roomsApi(base)
        const { code } = await api.open({ seats: 2, enforced: true })
        const you = await join(code, 'Robin', { engineDeck: { kind: 'own', format: 'legacy', sets: ['por'] } })
        await until(() => dealtSeat(you), 5000)
        const said = dealtSeat(you).engineDeck
        expect(said).toEqual({ asked: 'own', played: 'own', colours: [], format: 'legacy', formatName: 'Legacy', from: 'sets', sets: [{ code: 'POR', name: 'Portal' }] })
        expect((await api.peek(code)).engineDeck).toEqual(said)
        you.leave()
      } finally {
        delete process.env.FAKE_DECK_REPORT
      }
    })

    it('deals an older engine the copy, since it cannot build one, and says that is why', async () => {
      // The environment is read when the relay starts that room's engine, at the sit.
      process.env.FAKE_PROTOCOL = '6'
      try {
        const api = roomsApi(base)
        const { code } = await api.open({ seats: 2, enforced: true })
        const you = await join(code, 'Robin', { engineDeck: { kind: 'own', format: 'standard', sets: ['por'] } })
        await until(() => dealtSeat(you), 5000)
        // Names, which an engine at 6 reads, where "own" it would refuse as no deck at all.
        expect((await sentFor(code))[1].deck).toEqual(DECK)
        expect(dealtSeat(you).engineDeck).toEqual({ asked: 'own', played: 'mirror', colours: [], format: 'standard', fellBack: 'engine' })
        you.leave()
        // One of the person's decks goes as names, which it can read.
        const other = await api.open({ seats: 2, enforced: true })
        const again = await join(other.code, 'Robin', { engineDeck: { kind: 'deck', name: 'Elves', deck: ELVES } })
        await until(() => dealtSeat(again), 5000)
        expect((await sentFor(other.code))[1].deck).toEqual(ELVES)
        expect(dealtSeat(again).engineDeck).toMatchObject({ asked: 'deck', played: 'deck', name: 'Elves' })
        again.leave()
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
    }, 15_000)

    it('takes the ask a sit brings until the deal, and keeps the game\'s after it', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { engineDeck: { kind: 'own', format: 'legacy', sets: ['por'] } })
      await until(() => dealtSeat(you), 5000)
      you.leave()
      const again = await join(code, 'Robin', { seat: 'p1', engineDeck: { kind: 'deck', name: 'Elves', deck: ELVES } })
      await until(() => dealtSeat(again), 5000)
      expect(dealtSeat(again).engineDeck).toMatchObject({ asked: 'own', played: 'own', from: 'sets' })
      expect((await sentFor(code))[1].deck).toBe('own')
      again.leave()
    }, 15_000)

    it.each([
      ['a bare word', 'own'],
      ['a deck that is not a list', { kind: 'deck', deck: [] }],
      ['a deck with no cards', { kind: 'deck' }],
      ['a kind it has no word for', { kind: 'someday' }],
      ['a list', [1, 2]],
    ])('reads an ask it cannot make sense of as none, and deals the copy: %s', async (_, engineDeck) => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { engineDeck })
      await until(() => dealtSeat(you), 5000)
      expect((await sentFor(code))[1].deck).toEqual(DECK)
      expect(dealtSeat(you).engineDeck).toMatchObject({ asked: 'mirror', played: 'mirror' })
      you.leave()
    })

    it('says nothing of an engine\'s deck at a table where the engine plays no seat', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true, ai: null })
      const a = await join(code, 'Robin', { engineDeck: { kind: 'own', format: 'standard', sets: null } })
      const b = await join(code, 'Sam', { deck: ELVES })
      await until(() => dealtSeat(a) && dealtSeat(b), 5000)
      expect(dealtSeat(a)).not.toHaveProperty('engineDeck')
      expect(await api.peek(code)).not.toHaveProperty('engineDeck')
      expect((await sentFor(code)).map((p) => p.deck)).toEqual([DECK, ELVES])
      a.leave(); b.leave()
    })
  })

  /**
   * A Commander game (HANDOFF.md, M6). A sit with a Commander deck says so and
   * brings its commander; the room asks the engine for the game where the engine
   * deals one and every person brought a commander, gives the engine's seat one
   * too, and says after the deal which game it dealt and why.
   */
  describe('a Commander game', () => {
    const dealtSeat = (who) => [...who.got].reverse().find((m) => m.op === 'seated' && m.engineSeat) ?? null
    const engineAt = (code) => relayServer.rooms.get(code).engine.engine
    const lastNew = async (code) => (await engineAt(code).call('lastNew')).request
    const LIBRARY = { Forest: 50, Plains: 49 }
    const RHYS = { name: 'Rhys the Redeemed', set: 'shm', number: '237' }
    const sitCommander = (extra = {}) => ({ deck: LIBRARY, format: 'commander', commander: RHYS, ...extra })

    it('asks the engine for one, the person\'s commander with their deck and the copy\'s with its, and says so after the deal', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', sitCommander())
      // Asked, not yet dealt: the room says what it was asked.
      expect((await api.peek(code)).format).toMatchObject({ asked: 'commander' })
      await until(() => dealtSeat(you), 5000)
      const sent = await lastNew(code)
      expect(sent.format).toBe('commander')
      expect(sent.players[0]).toMatchObject({ deck: LIBRARY, commander: RHYS })
      // The copy is the whole of what the person brought, commander and all.
      expect(sent.players[1]).toMatchObject({ ai: 'heuristic', deck: LIBRARY, commander: RHYS })
      expect(dealtSeat(you).format).toEqual({ asked: 'commander', played: 'commander' })
      // The engine's commander is said by name: it begins face up in the command zone.
      expect(dealtSeat(you).engineDeck).toEqual({ asked: 'mirror', played: 'mirror', cards: 100, colours: ['R'], commander: 'Rhys the Redeemed' })
      expect(await api.peek(code)).toMatchObject({ format: { asked: 'commander', played: 'commander' } })
      you.leave()
    })

    it('passes the offer from the command zone, its tax, and the tally of commander damage through untouched', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', sitCommander())
      await until(() => you.last('view'), 5000)
      const cast = you.last('status').status.actions.find((a) => a.from === 'command')
      expect(cast).toMatchObject({ type: 'CastSpell', card: 'cmd-e0', manaCost: '{G/W}', commanderTax: { casts: 0, generic: 0 } })
      const view = you.last('view').state
      expect(view.zones.find((z) => z.zoneId.zoneType === 'Command' && z.zoneId.ownerId === 'e0').cardIds).toEqual(['cmd-e0'])
      expect(view.cards['cmd-e0']).toMatchObject({ name: 'Rhys the Redeemed', isCommander: true })
      expect(view.players.map((p) => p.life)).toEqual([40, 40])
      await engineAt(code).call('commanderDamage', { to: 'e1', from: 'e0', amount: 3 })
      you.send({ op: 'resync' })
      await until(() => you.last('view')?.state?.players?.[1]?.commanderDamage, 5000)
      expect(you.last('view').state.players[1].commanderDamage).toEqual([{ commanderId: 'cmd-e0', commanderName: 'Rhys the Redeemed', controllerId: 'e0', amount: 3, threshold: 21 }])
      you.leave()
    })

    it('deals another of the person\'s decks with its own commander, and the copy where it came without one', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const SYTHIS = { name: "Sythis, Harvest's Hand" }
      const you = await join(code, 'Robin', sitCommander({ engineDeck: { kind: 'deck', name: 'Enchantress', deck: LIBRARY, commander: SYTHIS } }))
      await until(() => dealtSeat(you), 5000)
      expect((await lastNew(code)).players[1]).toMatchObject({ deck: LIBRARY, commander: SYTHIS })
      expect(dealtSeat(you).engineDeck).toMatchObject({ asked: 'deck', played: 'deck', name: 'Enchantress', commander: "Sythis, Harvest's Hand" })
      you.leave()
      const other = await api.open({ seats: 2, enforced: true })
      const again = await join(other.code, 'Robin', sitCommander({ engineDeck: { kind: 'deck', name: 'Leaderless', deck: LIBRARY } }))
      await until(() => dealtSeat(again), 5000)
      expect((await lastNew(other.code)).players[1]).toMatchObject({ deck: LIBRARY, commander: RHYS })
      expect(dealtSeat(again).engineDeck).toMatchObject({ asked: 'deck', played: 'mirror', name: 'Leaderless', fellBack: 'commander', commander: 'Rhys the Redeemed' })
      again.leave()
    }, 15_000)

    it('asks for a Commander deck of the engine\'s own, and passes on the commander it chose', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', sitCommander({ engineDeck: { kind: 'own', format: 'commander', sets: null } }))
      await until(() => dealtSeat(you), 5000)
      const bot = (await lastNew(code)).players[1]
      expect(bot).toMatchObject({ deck: 'own', format: 'commander' })
      expect(bot).not.toHaveProperty('commander')
      expect(dealtSeat(you).engineDeck).toMatchObject({ asked: 'own', played: 'own', cards: 100, format: 'commander', from: 'format', commander: "Sythis, Harvest's Hand" })
      you.leave()
    })

    it('deals the ordinary game where a person brought no commander, and says why', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      // Played without the cards the engine does not know, the commander among them,
      // as the lobby's gate offers; a deck with two commanders sits the same way.
      const you = await join(code, 'Robin', { deck: LIBRARY, format: 'commander' })
      await until(() => dealtSeat(you), 5000)
      const sent = await lastNew(code)
      expect(sent).not.toHaveProperty('format')
      expect(sent.players.every((p) => !('commander' in p))).toBe(true)
      expect(dealtSeat(you).format).toEqual({ asked: 'commander', played: 'standard', fellBack: 'commander' })
      expect(dealtSeat(you).engineDeck).not.toHaveProperty('commander')
      you.leave()
    })

    it('passes on why a Commander deck of the engine\'s own was not built at the ordinary game dealt instead', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { deck: LIBRARY, format: 'commander', engineDeck: { kind: 'own', format: 'commander', sets: null } })
      await until(() => dealtSeat(you), 5000)
      expect((await lastNew(code)).players[1]).toMatchObject({ deck: 'own', format: 'commander' })
      // The engine's reason and the room's go out together, which is how the table tells this from an engine that builds none.
      expect(dealtSeat(you).format).toEqual({ asked: 'commander', played: 'standard', fellBack: 'commander' })
      expect(dealtSeat(you).engineDeck).toMatchObject({ asked: 'own', played: 'mirror', format: 'commander', fellBack: 'format', why: 'A "commander" deck of its own is built only for a Commander game.' })
      you.leave()
    })

    it('never asks an engine older than Commander for one, and says that is why', async () => {
      process.env.FAKE_PROTOCOL = '7'
      try {
        const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
        const you = await join(code, 'Robin', sitCommander())
        await until(() => dealtSeat(you), 5000)
        const sent = await lastNew(code)
        expect(sent).not.toHaveProperty('format')
        // The deck as every room before Commander sent it: the library alone.
        expect(sent.players.map((p) => p.deck)).toEqual([LIBRARY, LIBRARY])
        expect(sent.players.every((p) => !('commander' in p))).toBe(true)
        expect(dealtSeat(you).format).toEqual({ asked: 'commander', played: 'standard', fellBack: 'engine' })
        you.leave()
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
    })

    it('keeps the ordinary game for a sit that asks for none, as every room did, and says so', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      expect((await api.peek(code)).format).toEqual({ asked: 'standard' })
      // A commander sent with no Commander game asked for is not read.
      const you = await join(code, 'Robin', { commander: RHYS })
      await until(() => dealtSeat(you), 5000)
      const sent = await lastNew(code)
      expect(sent).not.toHaveProperty('format')
      expect(sent.players.every((p) => !('commander' in p))).toBe(true)
      expect(dealtSeat(you).format).toEqual({ asked: 'standard', played: 'standard' })
      you.leave()
    })

    it('takes the game a sit brings until the deal, and keeps the game\'s after it', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', sitCommander())
      await until(() => dealtSeat(you), 5000)
      you.leave()
      const again = await join(code, 'Robin', { seat: 'p1', format: 'standard' })
      await until(() => dealtSeat(again), 5000)
      expect(dealtSeat(again).format).toEqual({ asked: 'commander', played: 'commander' })
      again.leave()
    }, 15_000)

    it('takes the game from the decks the people sit with, so a sit again with a sixty-card deck no longer asks for Commander', async () => {
      // Found in M6's review: the room kept the last game a sit named, and a sit
      // naming none — as a sixty-card deck's did — left a Commander request standing.
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 3, enforced: true })
      const first = await join(code, 'Robin', sitCommander())
      expect((await api.peek(code)).format).toEqual({ asked: 'commander' })
      // Waiting for Sam, Robin sits again with a sixty-card deck, from a tab that names no game at all.
      const again = await join(code, 'Robin', { seat: 'p1' })
      expect((await api.peek(code)).format).toEqual({ asked: 'standard' })
      const sam = await join(code, 'Sam', { format: 'standard' })
      await until(() => dealtSeat(again) && dealtSeat(sam), 5000)
      expect(await lastNew(code)).not.toHaveProperty('format')
      expect(dealtSeat(sam).format).toEqual({ asked: 'standard', played: 'standard' })
      expect((await api.peek(code)).format).toEqual({ asked: 'standard', played: 'standard' })
      first.leave(); again.leave(); sam.leave()
    }, 15_000)

    it.each([
      ['a bare name', 'Rhys the Redeemed', { name: 'Rhys the Redeemed' }],
      ['a printing with half its number', { name: 'Rhys the Redeemed', set: 'shm' }, { name: 'Rhys the Redeemed' }],
      ['no name', { set: 'shm', number: '237' }, null],
      ['a list', ['Rhys the Redeemed'], null],
    ])('reads a commander forgivingly: %s', async (_, commander, expected) => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { deck: LIBRARY, format: 'commander', commander })
      await until(() => dealtSeat(you), 5000)
      const sent = await lastNew(code)
      if (expected) expect(sent.players[0].commander).toEqual(expected)
      else expect(dealtSeat(you).format).toMatchObject({ played: 'standard', fellBack: 'commander' })
      you.leave()
    })

    it('reads a game it has no word for as none, and deals the ordinary one', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', sitCommander({ format: 'brawl' }))
      await until(() => dealtSeat(you), 5000)
      expect(await lastNew(code)).not.toHaveProperty('format')
      expect(dealtSeat(you).format).toEqual({ asked: 'standard', played: 'standard' })
      you.leave()
    })
  })

  /**
   * What a person may choose (HANDOFF.md, M4). The client says in its sit which
   * decisions it can show; the room passes that to the deal for that seat, and
   * after the deal tells the seat what its `act` may carry and which decisions
   * it will be asked — only where the engine said, so a client told nothing
   * holds back what it cannot send.
   */
  describe('what a person may choose', () => {
    const dealtSeat = (who) => [...who.got].reverse().find((m) => m.op === 'seated' && m.engineSeat) ?? null
    const engineAt = (code) => relayServer.rooms.get(code).engine.engine
    const ANSWERS = ['SelectCards', 'OrderObjects', 'Distribute', 'CombatResolution']

    it('passes the decisions a client can show to the deal for its seat alone, and says after it what the seat may choose', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { answers: [...ANSWERS, 42, 'x'.repeat(80)] })
      await until(() => dealtSeat(you), 5000)
      const sent = (await engineAt(code).call('lastNew')).request
      // Read forgivingly: what is not a short word is dropped on the way.
      expect(sent.players[0].answers).toEqual(ANSWERS)
      expect(sent.players[1]).not.toHaveProperty('answers')
      const { choices } = dealtSeat(you)
      // `cards` since protocol 6: the cards put on the bottom after a mulligan.
      expect(choices.act).toEqual(['targets', 'x', 'damage', 'cost', 'auto', 'cards'])
      expect(choices.costs).toContain('DiscardCard')
      // The decisions are the ones the engine said it will ask this seat.
      expect(choices.decisions).toEqual(['ChooseTargets', 'YesNo', 'ChooseOption', ...ANSWERS])
      // The seated that answers the sit, before any deal, says nothing of it.
      expect(you.got.find((m) => m.op === 'seated')).not.toHaveProperty('choices')
      you.leave()
    })

    it('sends a client that said nothing no answers, and tells it only what every engine asks', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => dealtSeat(you), 5000)
      expect((await engineAt(code).call('lastNew')).request.players[0]).not.toHaveProperty('answers')
      expect(dealtSeat(you).choices.decisions).toEqual(['ChooseTargets', 'YesNo', 'ChooseOption'])
      you.leave()
    })

    it('never tells a seat it may choose where the engine is older than choosing, nor sends it answers', async () => {
      // An engine at 4 would drop a target sent with a play and refuse the cast.
      process.env.FAKE_PROTOCOL = '4'
      try {
        const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
        const you = await join(code, 'Robin', { answers: ANSWERS })
        await until(() => dealtSeat(you), 5000)
        expect((await engineAt(code).call('lastNew')).request.players[0]).not.toHaveProperty('answers')
        expect(dealtSeat(you)).not.toHaveProperty('choices')
        you.leave()
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
    })

    it('carries what the person chose to the engine, with the play and with an answer', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { answers: ANSWERS })
      await until(() => you.last('view'), 5000)
      const { stop } = you.last('status').status
      const chosen = { targets: { 0: ['e1'] }, x: 2, damage: { e1: 2, e0: 1 }, cost: ['e30'] }
      await moved(you, { op: 'act', stop, index: 0, ...chosen })
      expect((await engineAt(code).call('lastAct')).request).toMatchObject({ op: 'act', index: 0, ...chosen })
      await moved(you, { op: 'decide', stop: stop + 1, edges: { 'e27->e71': 2 } })
      expect((await engineAt(code).call('lastDecide')).request).toMatchObject({ op: 'decide', edges: { 'e27->e71': 2 } })
      you.leave()
    })

    it('sends the faces of cards a decision shows only to the seat it asks', async () => {
      // Two people and the engine: a scry shows the deciding seat the top of
      // its library, and the other person is sent the same question without it.
      const { code } = await roomsApi(base).open({ seats: 3, enforced: true })
      const you = await join(code, 'Robin', { answers: ANSWERS })
      const them = await join(code, 'Sam', { answers: ANSWERS })
      await until(() => you.last('view') && them.last('view'), 5000)
      const decision = { id: 'r0', type: 'SelectCards', player: 'e0', prompt: 'Choose up to 2 cards', source: 'Magma Jet', min: 0, max: 2, options: ['e37', 'e7'], cards: { e37: { name: 'Magma Jet' }, e7: { name: 'Mountain' } } }
      await engineAt(code).call('ask', { decision })
      const { stop } = you.last('status').status
      you.send({ op: 'act', stop, index: 0 })
      await until(() => you.last('status').status.stop === stop + 1 && them.last('status').status.stop === stop + 1, 5000)
      expect(you.last('status').status.decision).toEqual(decision)
      const { cards, ...question } = decision
      expect(them.last('status').status.decision).toEqual(question)
      // And the same when that seat asks for the table again.
      const statuses = them.got.filter((m) => m.op === 'status').length
      them.send({ op: 'turn' })
      await until(() => them.got.filter((m) => m.op === 'status').length > statuses, 5000)
      expect(them.last('status').status.decision).toEqual(question)
      you.leave(); them.leave()
    })
  })

  describe('the opening hand', () => {
    const engineAt = (code) => relayServer.rooms.get(code).engine.engine
    const offered = (who) => (who.last('status')?.status.actions ?? []).map((a) => a.type)

    it('is dealt to keep where the client can show a mulligan, and what the person chose goes to the engine', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { mulligans: true })
      await until(() => you.last('view'), 5000)
      expect((await engineAt(code).call('lastNew')).request.mulligans).toBe(true)
      expect(await api.peek(code)).toMatchObject({ dealt: true, mulligans: true })
      expect(offered(you)).toEqual(['KeepHand', 'TakeMulligan'])
      let { stop } = you.last('status').status
      await moved(you, { op: 'act', stop, index: 1 })
      expect(you.last('status').status.actions[0]).toMatchObject({ type: 'KeepHand', mulligans: 1, bottom: 1 })
      await moved(you, { op: 'act', stop: ++stop, index: 0 })
      const bottom = you.last('status').status.actions[0]
      expect(bottom).toMatchObject({ type: 'BottomCards', bottom: 1 })
      // The cards chosen travel with the act, untouched, as a play's targets do.
      await moved(you, { op: 'act', stop: ++stop, index: 0, cards: [bottom.candidates[0]] })
      expect((await engineAt(code).call('lastAct')).request).toMatchObject({ op: 'act', index: 0, cards: [bottom.candidates[0]] })
      // And the game begins where it would have.
      expect(offered(you)).not.toContain('KeepHand')
      expect(offered(you)).not.toContain('BottomCards')
      you.leave()
    })

    it('keeps every hand where the client did not say it can show a mulligan, as every room before did', async () => {
      const api = roomsApi(base)
      const { code } = await api.open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      expect((await engineAt(code).call('lastNew')).request).not.toHaveProperty('mulligans')
      expect(await api.peek(code)).toMatchObject({ dealt: true, mulligans: false })
      expect(offered(you)).not.toContain('KeepHand')
      you.leave()
    })

    it('keeps every hand where one person at the table cannot be shown a mulligan, since the game would wait on them for good', async () => {
      const { code } = await roomsApi(base).open({ seats: 3, enforced: true })
      const you = await join(code, 'Robin', { mulligans: true })
      const them = await join(code, 'Sam')
      await until(() => you.last('view') && them.last('view'), 5000)
      expect((await engineAt(code).call('lastNew')).request).not.toHaveProperty('mulligans')
      you.leave(); them.leave()
    })

    it('never asks an engine older than mulligans for one', async () => {
      // An engine at 5 ignores the key and deals every hand kept; the room reads its reply rather than assume.
      process.env.FAKE_PROTOCOL = '5'
      try {
        const api = roomsApi(base)
        const { code } = await api.open({ seats: 2, enforced: true })
        const you = await join(code, 'Robin', { mulligans: true })
        await until(() => you.last('view'), 5000)
        expect((await engineAt(code).call('lastNew')).request).not.toHaveProperty('mulligans')
        expect(await api.peek(code)).toMatchObject({ mulligans: false })
        expect(offered(you)).not.toContain('KeepHand')
        you.leave()
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
    })
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

  it('takes one move at a time: a second press while the engine is still answering the first is refused, not sent', async () => {
    // Measured at M3: against hard, with a deck of instants, the engine took up
    // to 9.7 s to answer a move. The stop a press answers does not change until
    // that answer comes, so a second press in the meantime used to pass the
    // stale check and reach the engine, which then applied it to whatever it
    // offered next — a play nobody chose.
    // The stand-in holds the first act unanswered until this test lets it go,
    // so the second press is certain to arrive while the first is outstanding
    // rather than inside a window of real time a loaded machine could miss.
    const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
    const you = await join(code, 'Robin')
    await until(() => you.last('view'), 5000)
    const engine = relayServer.rooms.get(code).engine.engine
    await engine.call('holdActs')
    const { stop } = you.last('status').status
    you.send({ op: 'act', stop, index: 0 })
    you.send({ op: 'act', stop, index: 0 })
    await until(() => you.last('refused'), 5000)
    // Marked as the guard's, which the answer on its way makes untrue.
    expect(you.last('refused')).toMatchObject({ error: 'The engine is still answering your last move.', stale: true, answering: true })
    expect(you.last('status').status.stop).toBe(stop)
    await engine.call('release')
    await until(() => you.last('status').status.stop === stop + 1, 5000)
    expect((await engine.call('tally')).acts).toBe(1)
    // And once it has answered, the next press is taken as usual.
    you.send({ op: 'act', stop: stop + 1, index: 0 })
    await until(() => you.last('status').status.stop === stop + 2, 5000)
    expect((await engine.call('tally')).acts).toBe(2)
    you.leave()
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

    it('reports an engine that keeps no game and dies mid-turn, as it reports one that dies at any other time', async () => {
      // Since M7 an engine that stops mid-game is started again from the last
      // stop kept ("a room that survives the relay", below). One from before
      // protocol 9 keeps nothing to start again from, and is reported as gone.
      process.env.FAKE_PROTOCOL = '8'
      try {
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
        expect(you.got.filter((m) => m.op === 'gone')).toHaveLength(1)
        expect(you.got.some((m) => m.op === 'restoring')).toBe(false)
        you.leave()
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
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

  /**
   * A room that survives the relay (HANDOFF.md, M7). The room keeps the
   * engine's snapshot of the game after every stop, the relay writes it beside
   * the room, and a relay that comes back starts an engine for the room and has
   * it take the game back; an engine that stops mid-game is started again the
   * same way. The stand-in's snapshot carries a 64-bit number as the real one's
   * does, and it refuses a text whose number came back as another, so a relay
   * that read the text as JSON would fail here.
   */
  describe('a room that survives the relay', () => {
    const roomOf = (code) => relayServer.rooms.get(code).engine
    // `resolve`, since `join` in this describe is the test's own client.
    const fileOf = (code) => resolve(dir, `${code}.json`)
    const readRoom = (code) => JSON.parse(readFileSync(fileOf(code), 'utf8'))
    const writeRoom = (code, saved) => writeFileSync(fileOf(code), JSON.stringify(saved))
    const textOf = (saved) => gunzipSync(Buffer.from(saved.room.kept.gzip, 'base64')).toString('utf8')
    /**
     * What two tables at one stop agree on, whatever it is numbered: where the
     * game stands and what is offered or asked. The first status after a deal or
     * a restore also carries that reply's own keys (`seats`, `seed`, `restored`).
     */
    const at = (s) => JSON.stringify({ over: s.over, winner: s.winner, turn: s.turn, phase: s.phase, step: s.step, actor: s.actor, waiting: s.waiting, actions: s.actions ?? null, decision: s.decision ?? null })
    /** Once the room has kept the stop its seat last saw, which is what a restart comes back to. */
    const keptThrough = (code, client) => untilAsked(async () => roomOf(code).record().kept?.stop === client.last('status')?.status.stop, 5000)
    /**
     * The relay stopped as a deploy stops it, and a new one started on the same
     * rooms; `between` is done to the disk while neither is running.
     */
    const restart = async ({ between = null, ...options } = {}) => {
      await relayServer.shutdown()
      between?.()
      relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE, ...options })
      await new Promise((resolve) => relayServer.server.listen(0, resolve))
      base = `http://127.0.0.1:${relayServer.server.address().port}`
    }
    /**
     * The relay killed rather than stopped — an out-of-memory kill, a host
     * rebooting — so it writes nothing more and says no goodbye. What the next
     * relay finds is the disk as it is at this moment: it is copied now, and the
     * next relay starts on the copy, while the old one is let go on a directory
     * nothing reads again.
     */
    const crash = async (options = {}) => {
      const disk = mkdtempSync(resolve(tmpdir(), 'relay-'))
      cpSync(dir, disk, { recursive: true })
      const old = dir
      dir = disk
      await relayServer.shutdown()
      rmSync(old, { recursive: true, force: true })
      relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE, ...options })
      await new Promise((resolve) => relayServer.server.listen(0, resolve))
      base = `http://127.0.0.1:${relayServer.server.address().port}`
    }
    const DAY = 24 * 60 * 60 * 1000
    /** Once the game is back and playable: an engine holding it, and nothing coming back. */
    const cameBack = (code) => untilAsked(async () => Boolean(roomOf(code).status) && !roomOf(code).describe().restoring, 5000)
    const count = (client, op) => client.got.filter((m) => m.op === op).length

    it('is written to disk from the moment it opens, and once dealt with the engine\'s own text of the game, gzipped, and no deck', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      // Written at once, so a code handed out before anybody sits still works after a restart.
      relayServer.flush()
      let saved = readRoom(code)
      expect(saved).toMatchObject({ version: 1, code, mode: 'enforced', room: { seats: 2, ai: 'heuristic', pace: PACE_MS } })
      expect(saved.room.dealt).toBeUndefined()
      expect(saved.room.kept).toBeUndefined()
      const you = await join(code, 'Robin', { deltas: true })
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      relayServer.flush()
      saved = readRoom(code)
      expect(saved.room).toMatchObject({ dealt: true, stop: 1, kept: { stop: 1 } })
      expect(saved.room.seated.map((s) => [s.seat, s.engineSeat])).toEqual([['p1', 'e0'], ['p2', 'e1']])
      // The engine's own text, byte for byte, with its generator's 64-bit state as digits.
      const text = textOf(saved)
      expect(text).toBe((await roomOf(code).engine.call('snapshot')).snapshot)
      expect(text.endsWith(',"rng":9007199254740993}')).toBe(true)
      expect(saved.room.kept.bytes).toBe(Buffer.byteLength(text))
      expect(saved.room.kept.gzip.length).toBeLessThan(text.length)
      // The room keeps no deck of its own: a dealt game's decks are in the engine's text.
      expect(JSON.stringify({ ...saved.room, kept: null })).not.toMatch(/Raging Goblin|Mountain/)
      you.leave()
    })

    it('comes back when the relay restarts: an engine started for it takes the game back, and the seat plays on from the same stop', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { deltas: true })
      await until(() => you.last('view'), 5000)
      await moved(you, { op: 'act', stop: 1, index: 0 })
      const before = you.last('status').status
      const seq = you.last('view').seq
      await keptThrough(code, you)
      const text = roomOf(code).record().kept.text
      you.leave()
      await restart()
      expect(relayServer.rooms.has(code)).toBe(true)
      const back = await join(code, 'Robin', { seat: 'p1', deck: null, deltas: true })
      await until(() => back.last('view'), 5000)
      // Told what came back, before the table: the relay restarted, at the stop
      // last seen, and the number that stop comes back as, which names this restart.
      expect(back.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'relay', behind: 0, at: before.stop + 1 })
      const ops = back.got.map((m) => m.op)
      expect(ops.indexOf('restored')).toBeLessThan(ops.lastIndexOf('status'))
      // The same stop, numbered on from where the room was, and the table sent whole.
      const now = back.last('status').status
      expect(at(now)).toBe(at(before))
      expect(now.stop).toBe(before.stop + 1)
      expect(back.last('view').state).toBeDefined()
      expect(back.last('view').seq).toBe(seq + 1)
      expect(back.last('seated')).toMatchObject({ seat: 'p1', engineSeat: 'e0' })
      // What the engine was given back is what was kept, the digits untouched.
      expect((await roomOf(code).engine.call('lastRestore')).snapshot).toBe(text)
      // And the game goes on.
      await moved(back, { op: 'act', stop: now.stop, index: 0 })
      expect(back.last('status').status.stop).toBe(now.stop + 1)
      back.leave()
    })

    it('says while it comes back that it is, refuses a press that crossed that on the wire, and says it as dealt', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      you.leave()
      // The new engine is held at its first answer, as a real one is while the corpus loads.
      process.env.FAKE_HOLD_HELLO = '1'
      try {
        await restart()
      } finally {
        delete process.env.FAKE_HOLD_HELLO
      }
      expect(await roomsApi(base).peek(code)).toMatchObject({ dealt: true, restoring: 'relay' })
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('restoring'))
      expect(back.last('restoring')).toEqual({ t: 'engine', op: 'restoring', reason: 'relay' })
      expect(back.last('status')).toBe(null)
      back.send({ op: 'act', stop: 1, index: 0 })
      await until(() => back.last('refused'))
      expect(back.last('refused')).toMatchObject({ error: RESTORING, stale: true, restoring: true })
      back.send({ op: 'turn' })
      await until(() => back.got.filter((m) => m.op === 'restoring').length === 2)
      await roomOf(code).engine.call('release')
      await until(() => back.last('view'), 5000)
      expect(back.last('restored')).toMatchObject({ reason: 'relay', behind: 0 })
      expect((await roomsApi(base).peek(code)).restoring).toBeUndefined()
      back.leave()
    })

    it('comes back mid-way through a paced turn of the engine\'s, and the room watches the rest of it', async () => {
      const res = await fetch(`${base}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seats: 2, enforced: true, pace: 10_000 }) })
      const { code } = await res.json()
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await roomOf(code).engine.call('plays', { count: 3 })
      you.send({ op: 'act', stop: 1, index: 0 })
      // The first of the engine's three plays is published, and the next is ten seconds away.
      await until(() => you.last('status')?.status.waiting === 'engine', 5000)
      await keptThrough(code, you)
      you.leave()
      // The room's pace is on disk with it; brought down here so the turn is not sat through.
      await restart({ between: () => { const saved = readRoom(code); writeRoom(code, { ...saved, room: { ...saved.room, pace: 20 } }) } })
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('status')?.status.waiting === 'action', 5000)
      const statuses = back.got.filter((m) => m.op === 'status').map((m) => m.status)
      // Back at the engine's stop, then the rest of its turn, a play at a time, then the person's.
      expect(statuses[0]).toMatchObject({ waiting: 'engine', actor: 'e1' })
      expect(statuses.map((s) => s.waiting)).toEqual(['engine', 'engine', 'engine', 'action'])
      expect((await roomOf(code).engine.call('tally')).continues).toBe(3)
      back.leave()
    })

    it('lets go of a move still being answered when the relay went, and tells the person who made it, and nobody else, that it did not happen', async () => {
      const { code } = await roomsApi(base).open({ seats: 3, enforced: true })
      const you = await join(code, 'Robin')
      const them = await join(code, 'Sam')
      await until(() => you.last('view') && them.last('view'), 5000)
      const first = you.last('status').status
      await keptThrough(code, you)
      await roomOf(code).engine.call('holdActs')
      you.send({ op: 'act', stop: first.stop, index: 0 })
      await untilAsked(async () => roomOf(code).record().inFlight?.op === 'act')
      relayServer.flush()
      expect(readRoom(code).room.inFlight).toEqual({ seat: 'p1', op: 'act' })
      you.leave(); them.leave()
      await restart()
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      const also = await join(code, 'Sam', { seat: 'p2', deck: null })
      await until(() => back.last('view') && also.last('view'), 5000)
      expect(back.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'relay', behind: 0, lost: 'act', at: first.stop + 1 })
      expect(also.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'relay', behind: 0, at: first.stop + 1 })
      // The table is the stop before the move, which the engine never finished answering.
      expect(at(back.last('status').status)).toBe(at(first))
      expect((await roomOf(code).engine.call('tally')).acts).toBe(0)
      // And once written again, nothing is in flight any more.
      relayServer.flush()
      expect(readRoom(code).room.inFlight).toBeUndefined()
      back.leave(); also.leave()
    })

    it('comes back a stop behind where the relay went while the engine was still writing down the last one, and says so', async () => {
      // The relay's grace for a snapshot being taken, cut short: it is never
      // given here, and the relay goes down when the grace runs out.
      await restart({ keepGraceMs: 20 })
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const first = you.last('status').status
      await keptThrough(code, you)
      await roomOf(code).engine.call('holdSnapshot')
      await moved(you, { op: 'act', stop: first.stop, index: 0 })
      // Published and seen, and not kept: the snapshot is held until the relay has gone.
      expect(roomOf(code).record()).toMatchObject({ stop: first.stop + 1, kept: { stop: first.stop }, inFlight: { seat: 'p1', op: 'act' } })
      you.leave()
      await restart()
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('view'), 5000)
      expect(back.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'relay', behind: 1, lost: 'act', at: first.stop + 2 })
      expect(at(back.last('status').status)).toBe(at(first))
      back.leave()
    })

    it('waits, going down, for a snapshot being taken, writes the room once it is kept, and writes nothing after', async () => {
      // The grace is long here, and never runs out: what ends the wait is the
      // snapshot being given. Without the wait, the relay would go down with the
      // stop unkept, and the room come back a stop behind.
      await restart({ keepGraceMs: 30_000 })
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const first = you.last('status').status
      await keptThrough(code, you)
      const engine = roomOf(code).engine
      await engine.call('holdSnapshot')
      await moved(you, { op: 'act', stop: first.stop, index: 0 })
      const moveTo = you.last('status').status
      expect(roomOf(code).record()).toMatchObject({ stop: moveTo.stop, kept: { stop: first.stop } })
      you.leave()
      const going = relayServer.shutdown()
      // Going down, and waiting: the snapshot is given while it waits.
      await engine.call('release')
      await going
      const written = readFileSync(fileOf(code), 'utf8')
      expect(JSON.parse(written).room).toMatchObject({ stop: moveTo.stop, kept: { stop: moveTo.stop } })
      // The move is in the stop kept, so it is no longer in flight.
      expect(JSON.parse(written).room.inFlight).toBeUndefined()
      // Down, it writes nothing more, whatever asks it to.
      relayServer.flush()
      expect(readFileSync(fileOf(code), 'utf8')).toBe(written)
      relayServer = createRelay({ roomsDir: dir, pingMs: 60, engineCommand: FAKE_ENGINE })
      await new Promise((resolve) => relayServer.server.listen(0, resolve))
      base = `http://127.0.0.1:${relayServer.server.address().port}`
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('view'), 5000)
      // Nothing behind and nothing lost: the stop the move led to came back.
      expect(back.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'relay', behind: 0, at: moveTo.stop + 1 })
      expect(at(back.last('status').status)).toBe(at(moveTo))
      back.leave()
    })

    it('takes the next move while the last stop is still being written down, and keeps each move in flight until its own stop is kept', async () => {
      // The one-move guard is there so two moves are never answered at once; the
      // snapshot is no answer anybody waits on. Held up behind it (found in M7's
      // own run of the suite), a move sent on the new status was refused.
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      await roomOf(code).engine.call('holdSnapshot')
      await moved(you, { op: 'act', stop: 1, index: 0 })
      expect(roomOf(code).record()).toMatchObject({ kept: { stop: 1 }, inFlight: { seat: 'p1', op: 'act' } })
      // Taken, and sent on to the engine, which answers it after the snapshot it
      // is still holding: the room marks it in flight, a mark of its own. Refused,
      // the mark would stay the first move's, and stop 3 would never come.
      const first = roomOf(code).record().inFlight
      you.send({ op: 'act', stop: 2, index: 0 })
      await until(() => roomOf(code).record().inFlight !== first || you.last('refused'), 5000)
      expect(you.last('refused')).toBe(null)
      await roomOf(code).engine.call('release')
      await until(() => you.last('status')?.status.stop === 3, 5000)
      expect(you.got.some((m) => m.op === 'refused')).toBe(false)
      await keptThrough(code, you)
      expect(roomOf(code).record().kept.stop).toBe(3)
      expect(roomOf(code).record().inFlight).toBeUndefined()
      expect((await roomOf(code).engine.call('tally')).acts).toBe(2)
      you.leave()
    })

    it('comes back to the hand to keep, with the mulligans taken still taken', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { mulligans: true })
      await until(() => you.last('view'), 5000)
      const offers = () => you.last('status').status.actions.map((a) => a.type)
      expect(offers()).toEqual(['KeepHand', 'TakeMulligan'])
      await moved(you, { op: 'act', stop: 1, index: 1 })
      const taken = you.last('status').status
      expect(taken.actions[0]).toMatchObject({ type: 'KeepHand', mulligans: 1 })
      await keptThrough(code, you)
      you.leave()
      await restart()
      const back = await join(code, 'Robin', { seat: 'p1', deck: null, mulligans: true })
      await until(() => back.last('view'), 5000)
      expect(at(back.last('status').status)).toBe(at(taken))
      // Keeping it now asks for the card owed to the bottom, as it would have.
      const stop = back.last('status').status.stop
      await moved(back, { op: 'act', stop, index: 0 })
      expect(back.last('status').status.actions[0]).toMatchObject({ type: 'BottomCards', bottom: 1 })
      expect((await roomsApi(base).peek(code)).mulligans).toBe(true)
      back.leave()
    })

    it('comes back to a question put to a person as the same question, and takes its answer', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin', { answers: ['SelectCards'] })
      await until(() => you.last('view'), 5000)
      const question = { id: 'q-1', type: 'YesNo', player: 'e0', prompt: 'Keep it?', yesText: 'Yes', noText: 'No' }
      await roomOf(code).engine.call('ask', { decision: question })
      await moved(you, { op: 'act', stop: 1, index: 0 })
      const asked = you.last('status').status
      expect(asked).toMatchObject({ waiting: 'decision', decision: question })
      await keptThrough(code, you)
      you.leave()
      await restart()
      const back = await join(code, 'Robin', { seat: 'p1', deck: null, answers: ['SelectCards'] })
      await until(() => back.last('view'), 5000)
      expect(at(back.last('status').status)).toBe(at(asked))
      // What this seat may choose is as it was dealt.
      expect(back.last('seated').choices.decisions).toEqual(expect.arrayContaining(['SelectCards', 'YesNo']))
      await moved(back, { op: 'decide', stop: back.last('status').status.stop, yes: true })
      expect(back.last('status').status.waiting).toBe('action')
      back.leave()
    })

    it('starts an engine that stopped mid-game again from the last stop kept, and every seat is told', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await moved(you, { op: 'act', stop: 1, index: 0 })
      const before = you.last('status').status
      await keptThrough(code, you)
      const first = roomOf(code).engine
      await first.call('die').catch(() => {})
      await until(() => you.last('restored'), 5000)
      await until(() => you.last('status').status.stop === before.stop + 1, 5000)
      expect(you.got.find((m) => m.op === 'restoring')).toEqual({ t: 'engine', op: 'restoring', reason: 'engine' })
      expect(you.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'engine', behind: 0, at: before.stop + 1 })
      expect(roomOf(code).engine).not.toBe(first)
      expect(roomOf(code).engine.pid).not.toBe(first.pid)
      expect(at(you.last('status').status)).toBe(at(before))
      expect(you.got.some((m) => m.op === 'gone')).toBe(false)
      await moved(you, { op: 'act', stop: before.stop + 1, index: 0 })
      you.leave()
    })

    it('starts it again each time the game has gone on since, and not a third time where it stops again before it has', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const restoredCount = () => you.got.filter((m) => m.op === 'restored').length
      await roomOf(code).engine.call('die').catch(() => {})
      await until(() => restoredCount() === 1, 5000)
      await until(() => you.last('view') && you.last('status').status.stop === 2, 5000)
      // The game goes on, and the next stop is kept: a second stop is worth a second start.
      await moved(you, { op: 'act', stop: 2, index: 0 })
      await keptThrough(code, you)
      await roomOf(code).engine.call('die').catch(() => {})
      await until(() => restoredCount() === 2, 5000)
      await until(() => you.last('status').status.stop === 4, 5000)
      // Stopped again before anything happened: the same crash is most likely waiting where it was.
      await roomOf(code).engine.call('die').catch(() => {})
      await until(() => you.last('gone'), 5000)
      expect(you.last('gone').reason).toBe('The engine stopped again before the game could go on, so it was not started a third time: the engine stopped (exit 3).')
      expect(restoredCount()).toBe(2)
      you.leave()
    })

    it('does not count a relay restart as the engine stopping: an engine that stops after one is started again', async () => {
      // Found in M7's own reading over: a room that came back after its relay
      // restarted treated the first real crash after it as the second, and gave up.
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      you.leave()
      await restart()
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('restored'), 5000)
      await until(() => back.last('view'), 5000)
      await keptThrough(code, back)
      await roomOf(code).engine.call('die').catch(() => {})
      await until(() => back.got.filter((m) => m.op === 'restored').length === 2, 5000)
      expect(back.last('restored')).toMatchObject({ reason: 'engine', behind: 0 })
      expect(back.got.some((m) => m.op === 'gone')).toBe(false)
      back.leave()
    })

    it('still tells the person whose move was lost when the relay goes down again while the game is coming back', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      await roomOf(code).engine.call('holdActs')
      you.send({ op: 'act', stop: 1, index: 0 })
      await untilAsked(async () => roomOf(code).record().inFlight?.op === 'act')
      you.leave()
      // Down again while the first relay after it is still loading its engine.
      process.env.FAKE_HOLD_HELLO = '1'
      try {
        await restart()
      } finally {
        delete process.env.FAKE_HOLD_HELLO
      }
      expect(roomOf(code).describe().restoring).toBe('relay')
      await restart()
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('view'), 5000)
      expect(back.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'relay', behind: 0, lost: 'act', at: 2 })
      back.leave()
    })

    it('says in words why a game could not come back — an engine that takes none back, a text it cannot read, a number that came back as another — and leaves its file for a relay that can', async () => {
      const codes = []
      for (let i = 0; i < 3; i++) {
        const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
        const you = await join(code, 'Robin')
        await until(() => you.last('view'), 5000)
        await keptThrough(code, you)
        you.leave()
        codes.push(code)
      }
      const [unread, rounded, whole] = codes
      const tamper = (code, text) => { const s = readRoom(code); writeRoom(code, { ...s, room: { ...s.room, kept: { ...s.room.kept, gzip: gzipSync(text).toString('base64') } } }) }
      const said = async (code) => {
        const back = await join(code, 'Robin', { seat: 'p1', deck: null })
        await until(() => back.last('gone'), 5000)
        back.leave()
        return back.last('gone').reason
      }
      // The engines a relay starts for its rooms are started as it comes up, and
      // these read an environment that plays an engine from before keeping a game.
      process.env.FAKE_PROTOCOL = '8'
      try {
        await restart({
          between: () => {
            tamper(unread, 'not a game at all')
            // What a relay that read the text as JSON would have handed back: the last digit is lost.
            tamper(rounded, textOf(readRoom(rounded)).replace('"rng":9007199254740993}', '"rng":9007199254740992}'))
          },
        })
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
      // Each says that it is not the end of it: what refused it was this relay's
      // engine, and the next relay tries again (M7's review).
      expect(await said(whole)).toBe(`The relay restarted, and the game could not come back: its engine takes no game back (protocol 8; that came with 9). ${TRIED_AGAIN}`)
      await restart()
      expect(await said(unread)).toMatch(/^The relay restarted, and the game could not come back: that snapshot could not be read: .+\. The relay tries again each time it restarts\.$/)
      expect(await said(rounded)).toBe(`The relay restarted, and the game could not come back: that game's random number generator came back as 9007199254740992, where it was kept as 9007199254740993. ${TRIED_AGAIN}`)
      // The one left as it was comes back to a relay whose engine can take it.
      const back = await join(whole, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('view'), 5000)
      expect(back.last('restored')).toMatchObject({ reason: 'relay', behind: 0 })
      back.leave()
      for (const code of codes) expect(existsSync(fileOf(code))).toBe(true)
    })

    it('says a game that was dealt and never kept could not come back: an engine too old to keep one, or a copy the disk cannot give back', async () => {
      process.env.FAKE_PROTOCOL = '8'
      let old
      try {
        ;({ code: old } = await roomsApi(base).open({ seats: 2, enforced: true }))
        const you = await join(old, 'Robin')
        await until(() => you.last('view'), 5000)
        await untilAsked(async () => Boolean(roomOf(old).record().unkept))
        you.leave()
      } finally {
        delete process.env.FAKE_PROTOCOL
      }
      const { code: spoilt } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(spoilt, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(spoilt, you)
      you.leave()
      await restart({ between: () => { const s = readRoom(spoilt); writeRoom(spoilt, { ...s, room: { ...s.room, kept: { ...s.room.kept, gzip: 'this is not gzip' } } }) } })
      const said = async (code) => {
        const back = await join(code, 'Robin', { seat: 'p1', deck: null })
        await until(() => back.last('gone'))
        back.leave()
        return back.last('gone').reason
      }
      expect(await said(old)).toBe('The relay restarted, and this game could not come back: the engine it was played on keeps no game (protocol 8; keeping one came with 9).')
      expect(await said(spoilt)).toBe('The relay restarted, and this game could not come back: what was kept of it could not be read back from the disk.')
      // No engine was started for either: there was nothing to give one.
      expect(roomOf(old).lastStarted).toBe(null)
      expect(roomOf(spoilt).lastStarted).toBe(null)
    })

    it('will not take back a game whose seats are not the ones this table dealt, and says so', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      you.leave()
      await restart({ between: () => { const s = readRoom(code); writeRoom(code, { ...s, room: { ...s.room, seated: s.room.seated.map((x, i) => ({ ...x, engineSeat: `e${i + 7}` })) } }) } })
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('gone'), 5000)
      expect(back.last('gone').reason).toBe(`The relay restarted, and the game could not come back: the game the engine took back is not the one this table was playing. ${TRIED_AGAIN}`)
      expect(back.got.some((m) => m.op === 'status')).toBe(false)
      back.leave()
    })

    it('comes back as a table waiting for its seats where it had not dealt, and deals when they sit', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true, level: 'hard' })
      await restart()
      expect(await roomsApi(base).peek(code)).toMatchObject({ mode: 'enforced', started: false, dealt: false, level: 'hard' })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      expect(you.got.some((m) => m.op === 'restoring' || m.op === 'restored')).toBe(false)
      expect((await roomsApi(base).peek(code)).dealt).toBe(true)
      you.leave()
    })

    it('is left on disk by a relay with no engine, for one that has', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      you.leave()
      await restart({ engineCommand: null })
      expect(relayServer.rooms.has(code)).toBe(false)
      expect(await roomsApi(base).peek(code)).toBe(null)
      await restart()
      const back = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => back.last('view'), 5000)
      expect(back.last('restored')).toMatchObject({ reason: 'relay' })
      back.leave()
    })

    it('is swept with its file and its engine once nobody has touched it for a week', async () => {
      let clock = 1_000_000
      await restart({ idleMs: 1000, now: () => clock })
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      you.leave()
      await until(() => relayServer.rooms.get(code).sockets.size === 0)
      const engine = roomOf(code).engine
      relayServer.flush()
      expect(existsSync(fileOf(code))).toBe(true)
      clock += 2000
      relayServer.sweep()
      expect(relayServer.rooms.has(code)).toBe(false)
      expect(existsSync(fileOf(code))).toBe(false)
      await until(() => engine.exited, 3000)
    })

    it('reads a record forgivingly: what makes no sense brings back a table, or one that says its game is gone, never a thrown error', async () => {
      const touchedAt = Date.now()
      await restart({
        between: () => {
          writeRoom('NNNNN', { version: 1, code: 'NNNNN', mode: 'enforced', touchedAt, room: 'nonsense' })
          writeRoom('MMMMM', { version: 1, code: 'MMMMM', mode: 'enforced', touchedAt, room: { seats: 99, ai: 7, pace: 'soon', level: 'expert', dealt: true, stop: -4, seated: [null, 5, { seat: 3 }], kept: { gzip: 12 }, inFlight: { seat: [], op: 'fly' } } })
          writeRoom('PPPPP', { version: 1, code: 'PPPPP', mode: 'enforced', touchedAt, room: { dealt: true, kept: { text: 'not a game', stop: 'x' }, seated: [{ seat: 'p1', engineSeat: 'e0' }, { seat: 'p2', engineSeat: 'e1' }] } })
          // Kept, as something that is not a kept game at all: damaged, not never kept.
          writeRoom('QQQQQ', { version: 1, code: 'QQQQQ', mode: 'enforced', touchedAt, room: { dealt: true, kept: 'a game, honestly' } })
        },
      })
      expect(await roomsApi(base).peek('NNNNN')).toMatchObject({ mode: 'enforced', dealt: false, seats: [{ seat: 'p1' }, { seat: 'p2', ai: 'heuristic' }] })
      expect((await roomsApi(base).peek('MMMMM')).seats).toHaveLength(6)
      const gone = async (code) => {
        const back = await join(code, 'Robin', { seat: 'p1', deck: null })
        await until(() => back.last('gone'), 5000)
        back.leave()
        return back.last('gone').reason
      }
      expect(await gone('MMMMM')).toBe('The relay restarted, and this game could not come back: what was kept of it could not be read back from the disk.')
      expect(await gone('PPPPP')).toMatch(/^The relay restarted, and the game could not come back: that snapshot could not be read: /)
      expect(await gone('QQQQQ')).toBe('The relay restarted, and this game could not come back: what was kept of it could not be read back from the disk.')
      // A room whose game could not come back says so to a lobby that asks, rather than look open.
      expect((await roomsApi(base).peek('QQQQQ')).gone).toBe('The relay restarted, and this game could not come back: what was kept of it could not be read back from the disk.')
      // And the table nobody could make sense of is one that deals.
      const you = await join('NNNNN', 'Robin')
      await until(() => you.last('view'), 5000)
      you.leave()
      expect(savedRoomOf(undefined)).toMatchObject({ dealt: false, kept: null, seated: [] })
      // A record from before a game's end or a room's end was written reads as neither.
      expect(savedRoomOf({ dealt: true, over: 'yes', gone: 7 })).toMatchObject({ over: false, gone: null })
    })

    /*
     * What M7's review found in how a room is written down and read back.
     */

    it('does not count a game coming back as somebody touching its room: a relay that restarts keeps the room\'s clock, and drops it a week after the last move', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      you.leave()
      // Last touched six days before now, by the clock the next relays keep.
      let clock = Date.parse('2026-09-25T12:00:00Z')
      const touchedAt = clock - 6 * DAY
      await restart({ now: () => clock, between: () => writeRoom(code, { ...readRoom(code), touchedAt }) })
      // The game is taken back, and the room written with it — its clock as it was.
      await cameBack(code)
      relayServer.flush()
      expect(readRoom(code).touchedAt).toBe(touchedAt)
      expect(relayServer.rooms.get(code).touchedAt).toBe(touchedAt)
      // And again: a restart a day is not a room kept for ever.
      await restart({ now: () => clock })
      await cameBack(code)
      relayServer.flush()
      expect(readRoom(code).touchedAt).toBe(touchedAt)
      // Two days on, a week and a day since anybody did anything there.
      clock += 2 * DAY
      relayServer.sweep()
      expect(relayServer.rooms.has(code)).toBe(false)
      expect(existsSync(fileOf(code))).toBe(false)
    })

    it('counts somebody at the table as touching it, and writes that', async () => {
      let clock = Date.parse('2026-09-25T12:00:00Z')
      await restart({ now: () => clock, flushMs: 5 })
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      clock += DAY
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await until(() => readRoom(code).touchedAt === clock, 5000)
      you.leave()
    })

    it('keeps a game the room ended for good ended through a restart, and starts no engine for it', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await roomOf(code).engine.call('die').catch(() => {})
      await until(() => count(you, 'restored') === 1 && you.last('status')?.status.stop === 2, 5000)
      // Stopped again before the game went on: ended, and said why.
      await roomOf(code).engine.call('die').catch(() => {})
      await until(() => you.last('gone'), 5000)
      const reason = you.last('gone').reason
      expect(reason).toMatch(/not started a third time/)
      you.leave()
      await restart()
      // Not taken back: no engine loads the corpus for it, and the lobby says why it went.
      expect(roomOf(code).lastStarted).toBe(null)
      expect(await roomsApi(base).peek(code)).toMatchObject({ dealt: true, gone: reason })
      const again = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => again.last('gone'))
      expect(again.last('gone').reason).toBe(reason)
      expect(again.got.some((m) => m.op === 'restoring' || m.op === 'restored' || m.op === 'status')).toBe(false)
      expect(roomOf(code).lastStarted).toBe(null)
      again.leave()
    })

    it('does not take a game that had ended back as the relay comes up, and takes it back for somebody who sits down to look at it', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      // The stand-in's game is two moves long.
      await moved(you, { op: 'act', stop: 1, index: 0 })
      await moved(you, { op: 'act', stop: 2, index: 0 })
      const end = you.last('status').status
      expect(end.over).toBe(true)
      await keptThrough(code, you)
      you.leave()
      await restart()
      expect(roomOf(code).lastStarted).toBe(null)
      // Said as a game that was dealt and is over, not as a table to be dealt.
      const seen = await roomsApi(base).peek(code)
      expect(seen).toMatchObject({ started: true, dealt: true, over: true })
      expect(seen.restoring).toBeUndefined()
      const again = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => again.last('view'), 5000)
      expect(again.got.find((m) => m.op === 'restoring')).toEqual({ t: 'engine', op: 'restoring', reason: 'relay' })
      expect(again.last('restored')).toMatchObject({ reason: 'relay', behind: 0 })
      expect(at(again.last('status').status)).toBe(at(end))
      // Never dealt again: the engine took the kept game back, and was asked for no new one.
      expect((await roomOf(code).engine.call('lastRestore')).restores).toBe(1)
      again.leave()
    })

    it('writes a room beside its file and then over it, so a write that fails leaves the last record whole, and the next relay clears what was left beside it', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const first = you.last('status').status
      await keptThrough(code, you)
      relayServer.flush()
      const was = readFileSync(fileOf(code), 'utf8')
      expect(existsSync(`${fileOf(code)}.tmp`)).toBe(false)
      // Somewhere the next record cannot be written: a directory where it would go.
      mkdirSync(`${fileOf(code)}.tmp`)
      await moved(you, { op: 'act', stop: first.stop, index: 0 })
      await keptThrough(code, you)
      relayServer.flush()
      // The last record stands, whole.
      expect(readFileSync(fileOf(code), 'utf8')).toBe(was)
      you.leave()
      await restart({
        between: () => {
          // What a relay that died mid-write leaves beside the room's file.
          rmSync(`${fileOf(code)}.tmp`, { recursive: true, force: true })
          writeFileSync(`${fileOf(code)}.tmp`, '{"version":1,"code":"')
        },
      })
      expect(existsSync(`${fileOf(code)}.tmp`)).toBe(false)
      const again = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => again.last('view'), 5000)
      // Back from the last whole record: the stop before the move.
      expect(at(again.last('status').status)).toBe(at(first))
      again.leave()
    })

    it('has the stop it publishes, and a move being answered, on disk before anybody hears of either, so a relay killed comes back no further on than what was seen', async () => {
      // Nothing is written at the relay's leisure in this test, only what is written at once.
      await restart({ flushMs: 60_000 })
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const first = you.last('status').status
      // The deal's stop, on disk as it was published.
      expect(readRoom(code).room).toMatchObject({ dealt: true, stop: first.stop })
      await keptThrough(code, you)
      await roomOf(code).engine.call('holdActs')
      you.send({ op: 'act', stop: first.stop, index: 0 })
      await untilAsked(async () => roomOf(code).record().inFlight?.op === 'act')
      // The move, on disk before the engine has answered it.
      expect(readRoom(code).room).toMatchObject({ stop: first.stop, kept: { stop: first.stop }, inFlight: { seat: 'p1', op: 'act' } })
      await roomOf(code).engine.call('release')
      await until(() => you.last('status')?.status.stop === first.stop + 1, 5000)
      // The stop it led to, on disk by the time it was heard; its snapshot, kept
      // since, would be written at leisure, and has not been.
      expect(readRoom(code).room).toMatchObject({ stop: first.stop + 1, kept: { stop: first.stop }, inFlight: { seat: 'p1', op: 'act' } })
      await keptThrough(code, you)
      you.leave()
      await crash()
      const again = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => again.last('view'), 5000)
      // A stop behind what was seen, and said; the move lost with it, and said;
      // and the stop that comes back numbered after every one anybody saw.
      expect(again.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'relay', behind: 1, lost: 'act', at: first.stop + 2 })
      expect(at(again.last('status').status)).toBe(at(first))
      again.leave()
    })

    it('writes the game kept after every stop without being asked, so a relay killed comes back to it', async () => {
      await restart({ flushMs: 5 })
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await moved(you, { op: 'act', stop: 1, index: 0 })
      const now = you.last('status').status
      // Read off the disk as the next relay would, never flushed by hand.
      await until(() => { const r = readRoom(code).room; return r.kept?.stop === now.stop && !r.inFlight }, 5000)
      you.leave()
      await crash()
      const again = await join(code, 'Robin', { seat: 'p1', deck: null })
      await until(() => again.last('view'), 5000)
      expect(again.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'relay', behind: 0, at: now.stop + 1 })
      expect(at(again.last('status').status)).toBe(at(now))
      again.leave()
    })

    it('does not start an engine again for ever where it stops each time building the same stop: once the game has not gone on, it is not started a third time', async () => {
      // An engine that answers and then stops before the stop is kept — a reply
      // it cannot write, tied to the position — used to count as the game going
      // on, and was started again at the same place, every sixteen seconds, for
      // good (found in M7's review).
      const res = await fetch(`${base}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seats: 2, enforced: true, pace: 20 }) })
      const { code } = await res.json()
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await roomOf(code).engine.call('plays', { count: 3 })
      await roomOf(code).engine.call('fragile')
      you.send({ op: 'act', stop: 1, index: 0 })
      await until(() => you.last('gone'), 5000)
      expect(you.last('gone').reason).toBe('The engine stopped again before the game could go on, so it was not started a third time: the engine stopped (exit 3).')
      // Started again once, where the game was last kept, and not after.
      expect(count(you, 'restored')).toBe(1)
      expect(count(you, 'restoring')).toBe(1)
      await sleep(100)
      expect(count(you, 'restoring')).toBe(1)
      you.leave()
    })

    it('starts an engine killed while it was answering a move again, and tells the person the move was not saved, and nothing else', async () => {
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      const first = you.last('status').status
      await keptThrough(code, you)
      const engine = roomOf(code).engine
      await engine.call('holdActs')
      you.send({ op: 'act', stop: first.stop, index: 0 })
      await untilAsked(async () => roomOf(code).record().inFlight?.op === 'act')
      const views = count(you, 'view')
      // Killed from outside, as an out-of-memory killer would: a `die` would wait behind the held move.
      process.kill(engine.pid)
      await until(() => you.last('restored') && count(you, 'view') > views, 5000)
      expect(you.got.find((m) => m.op === 'restoring')).toEqual({ t: 'engine', op: 'restoring', reason: 'engine' })
      expect(you.last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'engine', behind: 0, lost: 'act', at: first.stop + 1 })
      expect(at(you.last('status').status)).toBe(at(first))
      // The move's own failure is not said beside it: the engine that failed it was replaced.
      expect(you.got.some((m) => m.op === 'refused' || m.op === 'gone')).toBe(false)
      expect(roomOf(code).engine).not.toBe(engine)
      expect((await roomOf(code).engine.call('tally')).acts).toBe(0)
      you.leave()
    })

    it('takes a paced turn back whose engine was killed in the middle of it, and watches the rest of it on the new engine', async () => {
      const sent = []
      // The room's pace, held by the test: each wait is let go by hand, so the
      // engine is killed while the room is waiting to ask for the next play.
      const gates = []
      const you = { id: 's1', seat: null }
      const room = createEngineRoom({
        code: 'PACED', seats: 2, ai: 'heuristic', engineCommand: FAKE_ENGINE, paceMs: 5,
        deliver: (socket, m) => sent.push(m), wait: () => new Promise((go) => gates.push(go)),
      })
      const last = (op) => sent.filter((m) => m.op === op).at(-1) ?? null
      room.join(you)
      room.receive({ t: 'engine', op: 'sit', name: 'Robin', deck: DECK }, you)
      await until(() => last('view'), 5000)
      await room.engine.call('plays', { count: 3 })
      room.receive({ t: 'engine', op: 'act', stop: 1, index: 0 }, you)
      // The first of the engine's plays, published and kept, and the room waiting its pace.
      await until(() => last('status')?.status.waiting === 'engine' && gates.length === 1, 5000)
      const shown = last('status').status
      await untilAsked(async () => room.record().kept?.stop === shown.stop, 5000)
      const first = room.engine
      process.kill(first.pid)
      await until(() => last('restored'), 5000)
      expect(last('restored')).toEqual({ t: 'engine', op: 'restored', reason: 'engine', behind: 0, at: shown.stop + 1 })
      expect(at(last('status').status)).toBe(at(shown))
      const from = sent.length
      // The loop that was watching the old engine lets go, and the turn is
      // taken up on the new one, a play a pace, until it is the person's.
      for (let i = 0; i < 10 && last('status').status.waiting === 'engine'; i++) {
        await until(() => gates.length > 0, 5000)
        gates.shift()()
        await until(() => gates.length > 0 || last('status').status.waiting === 'action', 5000)
      }
      expect(sent.slice(from).filter((m) => m.op === 'status').map((m) => m.status.waiting)).toEqual(['engine', 'engine', 'action'])
      expect(room.engine).not.toBe(first)
      // Every play left was asked of the new engine, one each, and none of the old.
      expect((await room.engine.call('tally')).continues).toBe(3)
      expect(sent.some((m) => m.op === 'refused' || m.op === 'gone')).toBe(false)
      await room.close()
    })

    it('tells a person again what came back where the socket it was said to may not have heard it, and not where it has spoken since', async () => {
      // A phone that changed networks while the game came back: its socket stays
      // open to the relay until the heartbeat finds it, and nothing said on it arrives.
      const sent = []
      const deaf = new Set()
      const room = createEngineRoom({
        code: 'TOLD', seats: 2, ai: 'heuristic', engineCommand: FAKE_ENGINE, paceMs: 0,
        deliver: (socket, m) => { if (!deaf.has(socket)) sent.push({ socket, ...m }) },
      })
      const to = (socket, op) => sent.filter((m) => m.socket === socket && m.op === op)
      const phone = { id: 's1', seat: null }
      room.join(phone)
      room.receive({ t: 'engine', op: 'sit', name: 'Robin', deck: DECK }, phone)
      await until(() => to(phone, 'view').length, 5000)
      await untilAsked(async () => room.record().kept?.stop === 1, 5000)
      deaf.add(phone)
      await room.engine.call('die').catch(() => {})
      await untilAsked(async () => Boolean(room.status) && !room.describe().restoring, 5000)
      // Said to the phone's old socket, where it went nowhere.
      expect(to(phone, 'restored')).toHaveLength(0)
      const again = { id: 's2', seat: null }
      room.join(again)
      room.receive({ t: 'engine', op: 'sit', name: 'Robin', seat: 'p1', deck: null }, again)
      await until(() => to(again, 'view').length, 5000)
      expect(to(again, 'restored')).toEqual([{ socket: again, t: 'engine', op: 'restored', reason: 'engine', behind: 0, at: 2 }])
      // Told on a socket that had just sat: once is enough.
      const third = { id: 's3', seat: null }
      room.join(third)
      room.receive({ t: 'engine', op: 'sit', name: 'Robin', seat: 'p1', deck: null }, third)
      await until(() => to(third, 'view').length, 5000)
      expect(to(third, 'restored')).toHaveLength(0)
      // The game goes on and is kept, and the engine stops again: told to a
      // socket that then speaks, which was there to hear it.
      room.receive({ t: 'engine', op: 'act', stop: 2, index: 0 }, third)
      await untilAsked(async () => room.record().kept?.stop === 3, 5000)
      await room.engine.call('die').catch(() => {})
      await until(() => to(third, 'restored').length === 1, 5000)
      await untilAsked(async () => Boolean(room.status) && !room.describe().restoring, 5000)
      room.receive({ t: 'engine', op: 'turn' }, third)
      const fourth = { id: 's4', seat: null }
      room.join(fourth)
      room.receive({ t: 'engine', op: 'sit', name: 'Robin', seat: 'p1', deck: null }, fourth)
      await until(() => to(fourth, 'view').length, 5000)
      expect(to(fourth, 'restored')).toHaveLength(0)
      await room.close()
    })

    it('keeps the capital of a name at the head of an engine\'s reason, and lowers only the first letter of a sentence', async () => {
      // A reason the engine did not expect is the name of what was thrown (Server.kt).
      expect(clause('IllegalStateException: the stack was not empty')).toBe('IllegalStateException: the stack was not empty')
      expect(clause('That snapshot could not be read: no.')).toBe('that snapshot could not be read: no.')
      expect(clause('A player has no deck.')).toBe('a player has no deck.')
      expect(clause('')).toBe('no reason was given.')
      expect(clause(undefined)).toBe('no reason was given.')
      // As the room says it, of a snapshot the engine could not take.
      const { code } = await roomsApi(base).open({ seats: 2, enforced: true })
      const you = await join(code, 'Robin')
      await until(() => you.last('view'), 5000)
      await keptThrough(code, you)
      await roomOf(code).engine.call('failSnapshot', { error: 'IllegalStateException: the stack was not empty' })
      await moved(you, { op: 'act', stop: 1, index: 0 })
      await untilAsked(async () => Boolean(roomOf(code).record().unkept), 5000)
      expect(roomOf(code).record().unkept).toBe('the engine could not keep it: IllegalStateException: the stack was not empty')
      // The last stop kept stands.
      expect(roomOf(code).record().kept.stop).toBe(1)
      you.leave()
    })
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
