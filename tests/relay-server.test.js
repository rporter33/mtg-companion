import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createRelay } from '../scripts/relay-server.mjs'
import { guest, KIND, PROTOCOL } from '../src/lib/board/net.js'
import { relay, rooms as roomsApi } from '../src/lib/board/relay.js'
import { handOf, invariants } from '../src/lib/board/model.js'

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
  relayServer = createRelay({ roomsDir: dir, pingMs: 60 })
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
    expect(codes).toEqual([1012])
    await until(() => ada.statuses.includes('reconnecting'))
    // Back on the same port, from the same directory: the room is there.
    relayServer = createRelay({ roomsDir: dir, pingMs: 60 })
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
    relayServer = createRelay({ roomsDir: dir, pingMs: 60 })
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
    relayServer = createRelay({ roomsDir: dir, pingMs: 60 })
    await new Promise((resolve) => relayServer.server.listen(0, resolve))
    expect(relayServer.rooms.size).toBe(0)
    expect(readdirSync(dir).sort()).toEqual(['ABCDE.json', 'FUTUR.json'])
  })
})
