#!/usr/bin/env node
/**
 * Two browsers, one table, over a real peer connection.
 *
 * Everything the protocol promises is unit-tested over a wire in memory. This
 * is the other half: that the wire can actually be a WebRTC data channel
 * between two browsers that found each other through the signalling service,
 * and that nothing about the game went through that service on the way.
 *
 * It runs against the dev server rather than the built preview, because it
 * imports `src/lib/board/*` directly into each page — there is no interface
 * for any of this yet, and a test that waits for one would be a test that
 * never gets written.
 *
 *   node tests/browser/together.spec.mjs
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { server as signalServer } from '../../scripts/signal-server.mjs'

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

// --- the signalling service, and a dev server to import the modules from ---

await new Promise((resolve) => signalServer.listen(0, resolve))
const SIGNAL = `http://127.0.0.1:${signalServer.address().port}`

const dev = spawn('npx', ['vite', '--port', '4199', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
const ready = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://127.0.0.1:4199/')).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
const up = await ready()
if (!up) {
  console.log('  FAIL  the dev server did not start')
  dev.kill()
  signalServer.close()
  process.exit(1)
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []
const open = async () => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:4199/', { waitUntil: 'domcontentloaded' })
  return page
}

const one = await open()
const two = await open()

/** Loads the board modules into a page and leaves them on `window.board`. */
const load = (page) => page.evaluate(async () => {
  const [net, webrtc, runner, model] = await Promise.all([
    import('/src/lib/board/net.js'),
    import('/src/lib/board/webrtc.js'),
    import('/src/lib/board/runner.js'),
    import('/src/lib/board/model.js'),
  ])
  window.board = { ...net, ...webrtc, ...runner, ...model }
  return typeof window.RTCPeerConnection === 'function'
})

console.log('\nTwo browsers finding each other')
check('both pages have WebRTC at all', (await load(one)) && (await load(two)))

// The host opens a room and waits; the guest joins with the code.
const code = await one.evaluate(async (SIGNAL) => {
  const b = window.board
  const service = b.signalling(SIGNAL)
  const code = await service.open()
  const wire = b.peer({ role: 'host', code, signal: service })
  const table = b.host({
    run: b.newRun(b.createBoard({ players: ['p1', 'p2'], seed: 5 })),
    seat: 'p1',
    send: (m) => wire.send(m),
    name: 'Table',
  })
  wire.onMessage((m) => table.receive(m, 'guest'))
  window.table = table
  window.wire = wire
  await wire.start()
  return code
}, SIGNAL)
check('the service hands out a room code', typeof code === 'string' && code.length === 5, String(code))

const joined = await two.evaluate(async ({ SIGNAL, code }) => {
  const b = window.board
  const service = b.signalling(SIGNAL)
  const wire = b.peer({ role: 'guest', code, signal: service })
  const guest = b.guest({ send: (m) => wire.send(m), name: 'Ada' })
  wire.onMessage((m) => guest.receive(m))
  window.guest = guest
  window.wire = wire
  await wire.start()
  guest.hello()
  // Wait for the channel to open and the table to arrive.
  for (let i = 0; i < 100; i++) {
    if (guest.ready) return { ready: true, seat: guest.seat, state: wire.state }
    await new Promise((r) => setTimeout(r, 100))
  }
  return { ready: false, state: wire.state }
}, { SIGNAL, code })

check('the two peers connect to each other', joined.ready, JSON.stringify(joined))
check('and the guest is given a seat', joined.seat === 'p2', JSON.stringify(joined))

if (joined.ready) {
  console.log('\nOne table, on two screens')
  await one.evaluate(() => {
    window.table.do({ type: 'seat', player: 'p1', cards: ['forest', 'forest', 'bear'], lanes: { forest: 'lands', bear: 'creatures' }, shuffle: false })
    window.table.do({ type: 'seat', player: 'p2', cards: ['island', 'island', 'bear'], lanes: { island: 'lands', bear: 'creatures' }, shuffle: false })
    window.table.do({ type: 'draw', player: 'p1', count: 2 })
  })
  const settle = async (page, want) => {
    for (let i = 0; i < 60; i++) {
      const seq = await page.evaluate(() => window.guest?.seq ?? window.table?.seq ?? 0)
      if (seq >= want) return seq
      await new Promise((r) => setTimeout(r, 100))
    }
    return -1
  }
  const hostSeq = await one.evaluate(() => window.table.seq)
  check('what the host does reaches the guest', (await settle(two, hostSeq)) === hostSeq)

  const boards = async () => [
    await one.evaluate(() => JSON.stringify(window.table.run.board)),
    await two.evaluate(() => JSON.stringify(window.guest.run.board)),
  ]
  const [a, b] = await boards()
  check('and the two tables are the same table', a === b)

  // Now the other direction, and a card the guest does not own.
  await two.evaluate(() => {
    window.refused = []
    window.guest.do({ type: 'draw', player: 'p2', count: 3 })
  })
  await settle(two, hostSeq + 1)
  const [a2, b2] = await boards()
  check('what the guest asks for happens on both', a2 === b2 && JSON.parse(a2).zones.p2.hand.length === 3,
    `${JSON.parse(a2).zones.p2.hand.length} in hand`)

  console.log('\nWhat the service saw')
  const relayed = await fetch(`${SIGNAL}/rooms/${code}/to/guest?since=0`).then((r) => r.json()).catch(() => ({ messages: [] }))
  const text = JSON.stringify(relayed)
  check('the signalling service never saw a card, a deck or a board',
    !/forest|island|bear|battlefield|library/i.test(text), text.slice(0, 200))
}

check('no console errors in either page', errors.length === 0, errors.join('; '))

await browser.close()
dev.kill()
signalServer.closeAllConnections?.()
signalServer.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
