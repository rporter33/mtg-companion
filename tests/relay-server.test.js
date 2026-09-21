import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createRelay } from '../scripts/relay-server.mjs'
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
  async function join(code, name, { deck = DECK, seat = null } = {}) {
    const api = roomsApi(base)
    const got = []
    const wire = relay({ url: api.socketUrl(code), WebSocket })
    wire.onMessage((m) => got.push(m))
    wire.onOpen(() => wire.send({ t: 'engine', op: 'sit', name, deck, seat }))
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
