#!/usr/bin/env node
/**
 * The app, the relay and the engine at one address (HANDOFF.md, M8).
 *
 * The image (deploy/Dockerfile) serves the built app from the relay itself, and
 * the build it serves says only `same-origin` for where its relay is: nobody
 * types an address. This opens the app from the relay's own address, with no
 * address saved anywhere, and plays the engine to one land on the battlefield —
 * the lobby finding the engine, the deck checked, a seat taken, the hand kept, a
 * Mountain tapped into play. Then, from a page at another origin as the GitHub
 * Pages app would be, the relay's rooms, its deck check and a seat, which is the
 * other way the owner may use it. Then the service worker (public/sw.js), allowed
 * this time: served from the relay, the app shares its origin with /health and
 * /rooms/<code>, and the worker must never answer those from its cache.
 *
 *   node tests/browser/hosted.spec.mjs                          # a relay started here, serving a build made for it
 *   node tests/browser/hosted.spec.mjs http://localhost:4173/   # the same: the suite's preview is not a relay
 *   node tests/browser/hosted.spec.mjs http://localhost:8788/   # against the relay already there: the image (image.yml)
 *
 * What the address is decides what is tested. One that answers /health as a
 * relay is the target, the image in CI and on the owner's machine. One that
 * answers but is not a relay — the preview every spec in the suite is given — is
 * not, and a relay is started here instead, serving the app built as the image
 * builds it, with VITE_RELAY_URL=same-origin, into a folder of its own (the
 * suite's own build has no relay address, as the Pages build must not). One that
 * does not answer at all is a failure, never a reason to test something else.
 *
 * Only a relay on this machine, and one that can be thrown away: the image in CI,
 * one started by hand, or the desktop client (M10). Never a deployed relay, whose
 * address this refuses before asking it anything. A run leaves two tables the
 * engine holds, played no further than a land, and nothing can end them over the
 * wire: a relay keeps such a room, and its engine JVM of 0.7–0.8 GB, for seven
 * days with nobody in it (IDLE_MS in scripts/relay-server.mjs), and starts every
 * one of them again each time it restarts (HANDOFF.md §3 item 21). On a deployed
 * relay sized for one engine game, one run would fill it.
 *
 * Needs the engine, and without one skips as game-engine.spec.mjs does; where
 * ENGINE_REQUIRED says there is one, none is a failure. Kept to itself — no helper
 * shared with another spec — so the desktop client's smoke test (M10) can run it
 * against whatever address the client serves on this machine.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRelay } from '../../scripts/relay-server.mjs'
import { findEngine, engineRequired } from '../../scripts/engine-bridge.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// Where the pictures go: the system's own temporary folder, as every spec here.
const SHOT = (name) => join(tmpdir(), `hosted-${name}.png`)
// The corpus loads before an engine's first answer: 25-30 s on the owner's
// machine (PLAN.md, M8), and a hosted relay may be slower. A room's engine and
// the relay's checker each load it, and may load it at once.
const ENGINE_START_MS = 120_000

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (test, ms = 8000) => {
  const start = Date.now()
  while (!(await test())) {
    if (Date.now() - start > ms) return false
    await sleep(100)
  }
  return true
}
const ended = (line, code) => { console.log(`\n${line}`); process.exit(code) }

// --- which relay --------------------------------------------------------------

/** What an address says to /health: the relay's answer, 'not a relay', or null where nothing answered. */
const healthOf = async (origin) => {
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10_000) })
    const body = await res.json().catch(() => null)
    return res.ok && body?.ok === true ? body : 'not a relay'
  } catch {
    return null
  }
}

const given = process.argv[2] ? new URL(process.argv[2]).origin : null
// This machine's own names for itself, as a URL spells them; anything else is
// somebody's relay, which a run would leave holding two engine rooms (above).
const THIS_MACHINE = new Set(['localhost', '127.0.0.1', '[::1]'])
if (given && !THIS_MACHINE.has(new URL(given).hostname)) {
  console.log(`${given} is not on this machine. This spec leaves two tables the engine holds, and their JVMs, on the relay it is run against, for a week; run it against a relay that can be thrown away: the image, or one started by hand.`)
  ended('0 passed, 1 failed (not a relay on this machine)', 1)
}
const answer = given ? await healthOf(given) : 'not a relay'
if (answer === null) {
  console.log(`Nothing answers at ${given}; a relay that is not there is not a reason to test another.`)
  ended('0 passed, 1 failed (no relay at the address given)', 1)
}
const hosted = answer !== 'not a relay'

let relayServer = null
let TARGET
let cleanup = () => {}
if (hosted) {
  TARGET = given
  console.log(`Against the relay at ${TARGET}: ${answer.rooms} room(s), engine ${answer.engine ? 'configured' : 'none'}`)
  if (!answer.engine && engineRequired()) {
    console.log('ENGINE_REQUIRED is set, and the relay at that address has no engine.')
    ended('0 passed, 1 failed (no engine, where one is required)', 1)
  }
  if (!answer.engine) {
    console.log('The relay at that address has no engine, so this spec has nothing to drive.')
    ended('0 passed, 0 failed (skipped: no engine)', 0)
  }
} else {
  const engineCommand = findEngine()
  if (!engineCommand && engineRequired()) {
    console.log('ENGINE_REQUIRED is set, and there is no engine where findEngine looks (scripts/engine-build.sh builds one).')
    ended('0 passed, 1 failed (no engine, where one is required)', 1)
  }
  if (!engineCommand) {
    console.log('No engine is built here (scripts/engine-build.sh), so this spec has nothing to drive.')
    ended('0 passed, 0 failed (skipped: no engine)', 0)
  }
  // The app as the image builds it: its relay is the address it came from.
  const scratch = mkdtempSync(join(tmpdir(), 'hosted-spec-'))
  const dist = join(scratch, 'dist')
  const built = Date.now()
  const vite = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: ROOT, env: { ...process.env, VITE_RELAY_URL: 'same-origin' }, encoding: 'utf8',
  })
  if (vite.status !== 0) {
    console.log(vite.stdout, vite.stderr)
    ended('0 passed, 1 failed (the app would not build)', 1)
  }
  relayServer = createRelay({ engineCommand, staticDir: dist, roomsDir: join(scratch, 'rooms') })
  await new Promise((r) => relayServer.server.listen(0, r))
  TARGET = `http://127.0.0.1:${relayServer.server.address().port}`
  cleanup = () => rmSync(scratch, { recursive: true, force: true })
  console.log(`Against a relay started here at ${TARGET}, serving the app built with VITE_RELAY_URL=same-origin (${((Date.now() - built) / 1000).toFixed(1)} s to build)`)
}
const HOST = new URL(TARGET).host

// --- the deck -------------------------------------------------------------------

// Card records as Scryfall gives them, answered by a route: the app looks a
// deck's cards up by name before it sends them. Portal's own printings, which the
// engine has (game-engine.spec.mjs checked them against both, 2026-09-21).
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const card = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{R}', cmc: 1, type_line,
  oracle_text: '', color_identity: ['R'], colors: ['R'], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { standard: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
const CARDS = [
  card('mountain', 'Mountain', 'Basic Land — Mountain', { mana_cost: '', cmc: 0, produced_mana: ['R'], collector_number: '208' }),
  card('goblin', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste', collector_number: '145' }),
]
// The game is not seeded: a relay in an image deals as it deals. So the deck
// makes the one claim that hangs on the deal all but certain: with 26 Mountains in
// 34 cards, an opening hand holds none only if it is 7 of the 8 goblins, which is
// 8 hands in C(34,7) = 5,379,616, about one deal in 670,000.
const DECK = { Mountain: 26, 'Raging Goblin': 8 }
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [{
    id: 'd1', name: 'Mountains', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
    main: [{ cardId: 'mountain', quantity: DECK.Mountain }, { cardId: 'goblin', quantity: DECK['Raging Goblin'] }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  // No relayUrl: nobody typed one. Fast, and the question answered, as the engine's
  // other specs keep it: stopped only where there is something to play (Law 1).
  prefs: { playerName: 'Robin', reduceMotion: true, tablePace: { preset: 'fast', asked: true } },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

// --- one land, at one address ---------------------------------------------------------

console.log('\nThe app, from the relay\'s own address')
// Service workers blocked here, as in every spec that answers Scryfall's images by a
// route: the app's worker fetches every *.scryfall.io image itself, past page.route
// (HANDOFF.md §5). The worker has a part of its own below.
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
// Every request the page made of a relay, and every socket it opened: all of them
// must be at the address it came from.
const relayAsked = []
page.on('request', (r) => { const u = new URL(r.url()); if (/^\/(health|rooms|engine)(\/|$)/.test(u.pathname)) relayAsked.push(u.host) })
const sockets = []
const wire = { status: null, me: null }
page.on('websocket', (ws) => {
  sockets.push(ws.url())
  ws.on('framereceived', ({ payload }) => {
    let m
    try { m = JSON.parse(typeof payload === 'string' ? payload : payload.toString()) } catch { return }
    if (m?.t !== 'engine') return
    if (m.op === 'status' && m.status) wire.status = m.status
    if (m.op === 'seated' && m.engineSeat) wire.me = m.engineSeat
  })
})
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
await page.route('**/cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from(PIXEL.split(',')[1], 'base64') }))

await page.goto(`${TARGET}/`, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(`${TARGET}/#/game`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })

const playEngine = page.getByRole('button', { name: 'Play the engine' })
check('the lobby finds the relay and its engine with no address given', await until(() => playEngine.count().then((n) => n === 1), 15_000))
check('and asks for none', await page.getByLabel('Relay address').count() === 0)
await page.screenshot({ path: SHOT('lobby') })
await playEngine.click()
check('opening a table the engine holds changes the address', await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash))), page.url())
const code = await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
check('the room is the relay\'s at this address', await fetch(`${TARGET}/rooms/${code}`).then((r) => r.json()).then((r) => r.mode === 'enforced').catch(() => false))

const tile = page.getByRole('button', { name: /^Mountains/ }).first()
// The first check starts the relay's checking engine, which loads the corpus first.
check('the relay\'s engine checks the deck', await until(() => tile.textContent().then((t) => /The engine knows all 34 cards\./.test(t ?? '')), ENGINE_START_MS), await tile.textContent())
await tile.click()
await page.getByRole('button', { name: /Sit down with Mountains/ }).click()
const sat = Date.now()
const keep = page.getByRole('group', { name: 'Your opening hand' })
check('the engine deals, and asks whether to keep the hand', await until(() => keep.count().then((n) => n === 1), ENGINE_START_MS))
console.log(`        (from Sit to the hand to keep: ${Date.now() - sat} ms)`)
await keep.getByRole('button', { name: /^Keep this hand/ }).click()

// A tap on a card in hand, at a point of it no other card covers.
const tapHand = async (locator) => {
  const cardEl = locator.locator('.bcard').first()
  await cardEl.scrollIntoViewIfNeeded()
  const point = await cardEl.evaluate((el) => {
    const slot = el.closest('.tabletop__handcard')
    const box = slot.getBoundingClientRect()
    const y = box.top + box.height / 2
    let from = null
    for (let x = box.left + 1; x < box.right; x += 1) {
      const hit = document.elementFromPoint(x, y)
      if (hit && slot.contains(hit)) { if (from === null) from = x } else if (from !== null) return { x: (from + x) / 2, y }
    }
    return from === null ? null : { x: (from + box.right) / 2, y }
  })
  if (!point) throw new Error('that hand card is fully covered')
  await page.mouse.click(point.x, point.y)
}
const mine = page.locator('.game__field .field .bcard--tile')
const land = page.locator('.tabletop__handcard').filter({ has: page.getByLabel(/^Mountain/) }).first()
// Whoever goes first, the table stops for this seat once it has a land to play.
check('the table stops with a land to play', await until(() => wire.status?.actor === wire.me && wire.status?.waiting === 'action'
  && (wire.status.actions ?? []).some((a) => a.type === 'PlayLand'), 90_000) && await land.count() === 1)
const before = await mine.count()
await tapHand(land)
check('tapping it plays it: the engine put a Mountain on the battlefield', await until(() => mine.count().then((n) => n === before + 1), 20_000)
  && /mountain/i.test(await mine.last().textContent() ?? ''))
check('and the log says so', await until(() => page.locator('.gamelog').textContent().then((t) => /Your Mountain entered the battlefield/.test(t ?? '')), 10_000))
// The picture once the table has settled round the land: the plate under it
// counts its mana from the view that follows the play.
await page.waitForTimeout(1000)
await page.locator('.game__you').scrollIntoViewIfNeeded()
await page.screenshot({ path: SHOT('land') })

check('every question the page asked a relay went to the address it came from', relayAsked.length > 0 && relayAsked.every((h) => h === HOST), JSON.stringify([...new Set(relayAsked)]))
check('and its room\'s socket too', sockets.length > 0 && sockets.every((u) => new URL(u).host === HOST && /\/rooms\/[A-Z0-9]{5}\/ws$/.test(u)), JSON.stringify(sockets))
check('and no address was saved for it', await page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1'))?.prefs?.relayUrl ?? null) === null)
check('no errors thrown', errors.length === 0, errors.join('\n'))
await context.close()

// --- from another origin, as the Pages app would ask ---------------------------------------

console.log('\nThe same relay, from a page at another origin')
// An empty page served from an origin of its own. The relay answers every origin
// (access-control-allow-origin: *), and a JSON body makes the browser ask first
// (the preflight), so this is the Pages app's own position.
const elsewhere = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>elsewhere</title>') })
await new Promise((r) => elsewhere.listen(0, '127.0.0.1', r))
const ELSEWHERE = `http://127.0.0.1:${elsewhere.address().port}`
const other = await browser.newContext({ serviceWorkers: 'block' })
const away = await other.newPage()
await away.goto(`${ELSEWHERE}/`)
const asked = await away.evaluate(async ({ relay, deck }) => {
  const json = { 'content-type': 'application/json' }
  const opened = await fetch(`${relay}/rooms`, { method: 'POST', headers: json, body: JSON.stringify({ seats: 2, enforced: true, ai: 'heuristic', level: 'easy' }) }).then((r) => r.json())
  const peek = await fetch(`${relay}/rooms/${opened.code}`).then((r) => r.json())
  const checked = await fetch(`${relay}/engine/check`, { method: 'POST', headers: json, body: JSON.stringify({ deck }) }).then((r) => r.json())
  const seated = await new Promise((done) => {
    const ws = new WebSocket(`${relay.replace(/^http/, 'ws')}/rooms/${opened.code}/ws`)
    const timer = setTimeout(() => { ws.close(); done(null) }, 110_000)
    ws.onopen = () => ws.send(JSON.stringify({ t: 'engine', op: 'sit', name: 'Pat', deck }))
    // Seated at once, and again once the engine has dealt, with the engine's own
    // name for the seat; a refusal ends the wait with its reason.
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.t === 'engine' && ((m.op === 'seated' && m.engineSeat) || m.op === 'refused')) { clearTimeout(timer); ws.close(); done(m) }
    }
    ws.onerror = () => { clearTimeout(timer); done(null) }
  })
  return { origin: location.origin, opened, peek, checked, seated }
}, { relay: TARGET, deck: DECK })
check('the page is at another origin', asked.origin === ELSEWHERE && asked.origin !== TARGET)
check('it opens a room there', /^[A-Z0-9]{5}$/.test(asked.opened?.code ?? '') && asked.opened.mode === 'enforced', JSON.stringify(asked.opened))
check('and reads it back', asked.peek?.code === asked.opened.code, JSON.stringify(asked.peek))
check('the relay\'s engine checks a deck for it', asked.checked?.known === 34 && asked.checked?.total === 34, JSON.stringify(asked.checked))
check('and it sits down at the table, which the engine deals', asked.seated?.op === 'seated' && typeof asked.seated.seat === 'string' && typeof asked.seated.engineSeat === 'string', JSON.stringify(asked.seated))
await other.close()
await new Promise((r) => elsewhere.close(r))

// --- the service worker, allowed ---------------------------------------------------------

console.log('\nThe service worker, served from the relay')
// A browser of its own, which cannot reach Scryfall at all: with the worker on,
// page.route cannot stand in for Scryfall's images (§5), so they are not fetched.
// Nothing here needs a card.
const NO_SCRYFALL = '--host-resolver-rules=MAP *.scryfall.io ~NOTFOUND, MAP *.scryfall.com ~NOTFOUND, MAP scryfall.com ~NOTFOUND'
const walled = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: [NO_SCRYFALL] })
const workerContext = await walled.newContext({ serviceWorkers: 'allow' })
const app = await workerContext.newPage()
await app.goto(`${TARGET}/`, { waitUntil: 'load' })
if (!await until(() => app.evaluate(() => Boolean(navigator.serviceWorker?.controller)), 15_000)) await app.reload({ waitUntil: 'load' })
check('the app\'s worker controls the page', await until(() => app.evaluate(() => Boolean(navigator.serviceWorker?.controller)), 15_000))
const health = () => app.evaluate(() => fetch('/health').then((r) => r.json()))
const first = await health()
// A room opened behind the page's back: the relay's answer changes.
const opened = await fetch(`${TARGET}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"seats":2}' }).then((r) => r.json())
const second = await health()
check('the relay\'s /health is asked afresh, not answered from the cache', second.rooms === first.rooms + 1, `${first.rooms} then ${second.rooms}`)
const peeked = await app.evaluate((c) => fetch(`/rooms/${c}`).then((r) => r.json()), opened.code)
check('and a room\'s own address answers', peeked.code === opened.code)
// A tab opened on the relay's JSON is a navigation, which the worker answers too.
const tab = await workerContext.newPage()
await tab.goto(`${TARGET}/health`)
await tab.close()
const cached = await app.evaluate(async (c) => {
  const keys = []
  for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) keys.push(new URL(r.url).pathname)
  const shell = await caches.match('./index.html').then((r) => r?.text() ?? null)
  return { keys, relay: keys.filter((k) => k === '/health' || k.startsWith('/rooms')), shellIsPage: /<div id="root"/.test(shell ?? ''), c }
}, opened.code)
check('the worker keeps the app\'s own files', cached.keys.some((k) => /^\/assets\/.+\.js$/.test(k)), JSON.stringify(cached.keys.slice(0, 8)))
check('and none of the relay\'s answers', cached.relay.length === 0, JSON.stringify(cached.relay))
check('and the page it keeps for offline is still the app, not /health\'s JSON', cached.shellIsPage)
await walled.close()

await browser.close()
if (relayServer) await relayServer.shutdown()
cleanup()
console.log(`\nScreenshots: ${SHOT('lobby')} and ${SHOT('land')}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
