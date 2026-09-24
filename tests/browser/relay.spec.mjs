#!/usr/bin/env node
/**
 * Two browsers at one table, through the relay.
 *
 * `together.spec.mjs` proves the peer-to-peer wire; this proves the relay,
 * which is the wire the rebuilt table will use. The claims are the ones the
 * relay was built for: two real browsers reach the same board through it, a
 * browser whose socket is cut comes back on its own to the same seat with
 * the same table, and a server restart mid-game is a pause rather than an
 * end. The relay is started in this process on port 0, with a temporary rooms
 * directory, so nothing here depends on anything already running.
 *
 * Its heartbeat is a minute apart, so it never beats during a run. Nothing here
 * rests on it: the cut socket is cut by hand, and relay-server.test.js tests
 * the heartbeat. A fast one did harm. The relay, vite and Playwright share this
 * one process, and a pause in it longer than the beat let the timer run before
 * a waiting pong was read, so a healthy browser was cut. A browser cut just
 * before the restart is between sockets when the 1012 goes out, never hears
 * it, and failed the restart check below.
 *
 *   node tests/browser/relay.spec.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelay } from '../../scripts/relay-server.mjs'

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- the relay and a dev server to import the modules from -----------------

const dir = mkdtempSync(join(tmpdir(), 'relay-spec-'))
// A heartbeat that does not beat during the run (see above).
const PING_MS = 60 * 1000
let relayServer = createRelay({ roomsDir: dir, pingMs: PING_MS })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const PORT = relayServer.server.address().port
const RELAY = `http://127.0.0.1:${PORT}`

const dev = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' })
await dev.listen()
const ORIGIN = dev.resolvedUrls.local[0]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []
const open = async () => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const [net, relay, runner, model] = await Promise.all([
      import('/src/lib/board/net.js'),
      import('/src/lib/board/relay.js'),
      import('/src/lib/board/runner.js'),
      import('/src/lib/board/model.js'),
    ])
    window.board = { ...net, ...relay, ...runner, ...model }
  })
  return page
}

/** Sits a page down at a room and waits for its seat and the table. */
const sit = (page, { code, name, seat = null }) => page.evaluate(async ({ RELAY, code, name, seat }) => {
  const b = window.board
  const api = b.rooms(RELAY)
  window.statuses = []
  // Each time the relay said "back in a moment": the wire marks the
  // reconnect it makes on a 1012 as a restart, and no other.
  window.restarts = 0
  window.refusals = []
  const wire = b.relay({
    url: api.socketUrl(code),
    onStatus: (s, detail) => { window.statuses.push(s); if (detail?.restart) window.restarts++ },
  })
  const guest = b.guest({ send: wire.send, name, seat, onRefused: (r) => window.refusals.push(r) })
  wire.onMessage((m) => guest.receive(m))
  wire.onOpen(() => guest.hello())
  window.guest = guest
  window.wire = wire
  for (let i = 0; i < 100; i++) {
    if (guest.ready) return { ready: true, seat: guest.seat, seq: guest.seq }
    await new Promise((r) => setTimeout(r, 50))
  }
  return { ready: false, status: wire.status }
}, { RELAY, code, name, seat })

/** Waits until a page's table has reached a sequence number. */
const settle = async (page, want) => {
  for (let i = 0; i < 80; i++) {
    const seq = await page.evaluate(() => window.guest?.seq ?? 0)
    if (seq >= want) return seq
    await sleep(50)
  }
  return -1
}
const boardOf = (page) => page.evaluate(() => JSON.stringify(window.guest.run.board))
/**
 * Waits for a page to say something, and gives what it said, or undefined
 * if it never does. What happens on the relay reaches a page as a task of
 * its own, a moment later, so a page is waited on for its own word rather
 * than read the instant something here returns.
 */
const heard = (page, fn) => page.waitForFunction(fn, null, { timeout: 5000 }).then((h) => h.jsonValue(), () => undefined)

const one = await open()
const two = await open()

console.log('\nTwo browsers, one room')
const { code } = await one.evaluate(async (RELAY) => window.board.rooms(RELAY).open({ seats: 2 }), RELAY)
check('the relay hands out a room code', /^[A-Z0-9]{5}$/.test(code ?? ''), String(code))
const ada = await sit(one, { code, name: 'Ada' })
const bob = await sit(two, { code, name: 'Bob' })
check('the first browser is seated first', ada.ready && ada.seat === 'p1', JSON.stringify(ada))
check('and the second is seated second', bob.ready && bob.seat === 'p2', JSON.stringify(bob))

console.log('\nOne table, on two screens')
await one.evaluate(() => {
  window.guest.do({ type: 'seat', player: 'p1', cards: ['forest', 'forest', 'bear'], lanes: { forest: 'lands', bear: 'creatures' }, shuffle: false })
  window.guest.do({ type: 'draw', player: 'p1', count: 2 })
})
await two.evaluate(() => {
  window.guest.do({ type: 'seat', player: 'p2', cards: ['island', 'island', 'bear', 'island', 'bear'], lanes: { island: 'lands', bear: 'creatures' }, shuffle: false })
  window.guest.do({ type: 'draw', player: 'p2', count: 3 })
})
check('everything both of them did reaches both', (await settle(one, 4)) === 4 && (await settle(two, 4)) === 4)
check('and the two tables are the same table', (await boardOf(one)) === (await boardOf(two)))
const hands = JSON.parse(await boardOf(two)).zones
check('with each hand where it should be', hands.p1.hand.length === 2 && hands.p2.hand.length === 3)

console.log('\nWhose turn it is')
await two.evaluate(() => window.guest.do({ type: 'nextTurn', player: 'p2' }))
const refusal = await heard(two, () => window.refusals[0]?.code)
check('the second player cannot end the first player’s turn', refusal === 'notYourTurn', String(refusal))
await one.evaluate(() => window.guest.do({ type: 'nextTurn' }))
await settle(two, 5)
check('the first player can, and the turn goes to the second', JSON.parse(await boardOf(two)).active === 'p2')

console.log('\nA browser whose socket is cut')
// The server drops the second browser's socket, the way a proxy would.
for (const socket of relayServer.wss.clients) if (socket.seat === 'p2') socket.terminate()
const back = await two.evaluate(async () => {
  for (let i = 0; i < 100; i++) {
    if (window.statuses.includes('reconnecting') && window.wire.status === 'open' && window.guest.ready) break
    await new Promise((r) => setTimeout(r, 50))
  }
  return { statuses: window.statuses, seat: window.guest.seat, ready: window.guest.ready }
})
check('comes back on its own', back.statuses.includes('reconnecting') && back.ready, JSON.stringify(back))
check('to the same seat', back.seat === 'p2', String(back.seat))
await one.evaluate(() => window.guest.do({ type: 'life', player: 'p1', delta: -3 }))
// Both: the first browser's own change reaches it only when the relay says so.
await settle(one, 6)
await settle(two, 6)
check('and is in step again', (await boardOf(one)) === (await boardOf(two)) && JSON.parse(await boardOf(two)).life.p1 === 17)

console.log('\nThe server restarts mid-game')
await relayServer.shutdown()
// shutdown() returns once the relay's side of every goodbye is done, and a
// browser can be a few milliseconds behind it: Chromium hands the close from
// its network process to the page as a task of its own. Read at once, a
// browser still said "open" in two restarts of 450 under load. The 1012 is
// what is claimed, so it is what is waited for.
const told = await Promise.all([one, two].map((page) => heard(page, () => window.restarts > 0)))
check('every browser is told to come back', told.every(Boolean),
  JSON.stringify(await Promise.all([one, two].map((page) => page.evaluate(() => ({ restarts: window.restarts, statuses: window.statuses }))))))
relayServer = createRelay({ roomsDir: dir, pingMs: PING_MS })
await new Promise((resolve) => relayServer.server.listen(PORT, resolve))
check('the room is back from disk', relayServer.rooms.has(code))
const resumed = await Promise.all([one, two].map((page) => page.evaluate(async () => {
  for (let i = 0; i < 200; i++) {
    if (window.wire.status === 'open' && window.guest.ready) return { seat: window.guest.seat, seq: window.guest.seq }
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
})))
check('both browsers are seated again where they were',
  resumed[0]?.seat === 'p1' && resumed[1]?.seat === 'p2' && resumed[0]?.seq === 6, JSON.stringify(resumed))
await two.evaluate(() => window.guest.do({ type: 'draw', player: 'p2', count: 1 }))
await settle(one, 7)
await settle(two, 7)
const after = [JSON.parse(await boardOf(one)), JSON.parse(await boardOf(two))]
check('and the game carries on from where it was', (await boardOf(one)) === (await boardOf(two)) && after[0].zones.p2.hand.length === 4,
  `hands ${after.map((b) => b.zones.p2.hand.length).join('/')}, seqs ${await one.evaluate(() => window.guest.seq)}/${await two.evaluate(() => window.guest.seq)}, refusals ${await two.evaluate(() => JSON.stringify(window.refusals))}`)

check('no console errors in either page', errors.length === 0, errors.join('; '))

await browser.close()
await dev.close()
await relayServer.shutdown()
rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
