#!/usr/bin/env node
/**
 * A table the engine holds, surviving its relay and its engine (HANDOFF.md,
 * M7), through the app itself and against the real engine.
 *
 * A person sits down, keeps the hand and plays a land. The relay is stopped as
 * a deploy stops it — every socket told 1012 — and a new one started on the
 * same rooms: the page says it lost the table, then that the game is coming
 * back and nothing pressed will happen until it has, with nothing offered to
 * press; and then the table is back as it was — the land where it was, the
 * hand as it was, the log saying the relay restarted — and the game goes on.
 * Then the engine itself is killed mid-game: the table says the engine is
 * starting again, comes back the same way, and goes on again. How long each
 * took, from the relay listening again (or the engine gone) to this seat having
 * a play offered again, is printed: it is what a person waits.
 *
 * Since M7's review it holds the table that comes back to the one that went, by
 * name — every card in the hand and on each battlefield, both life totals, and
 * the turn, step and seat the room says the game waits on — in both halves; taps
 * a card while the game is coming back, and opens the actions panel, and finds
 * neither saying whose stop it is not; reloads the page mid-way, and finds the
 * table's place saying the game is coming back; and ends at the lobby of a table
 * whose kept game could not be read back, which says so.
 *
 * Needs the built engine (scripts/engine-build.sh), and says so and passes
 * nothing where there is none, as game-engine.spec.mjs does.
 *
 *   node tests/browser/engine-restart.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRelay } from '../../scripts/relay-server.mjs'
import { findEngine } from '../../scripts/engine-bridge.mjs'

const SHOT = (name) => join(tmpdir(), `engine-${name}.png`)
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
// The corpus loads before an engine's first answer: about 15–20 s on the
// owner's machine (engine/README.md). Every wait that includes an engine
// starting is given this, with room for a slower runner.
const ENGINE_START_MS = 90_000

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (test, ms = 8000) => {
  const start = Date.now()
  while (!(await test())) {
    if (Date.now() - start > ms) return false
    await sleep(100)
  }
  return true
}

const engineCommand = findEngine()
if (!engineCommand) {
  console.log('No engine is built here (scripts/engine-build.sh), so this spec has nothing to drive.')
  console.log('\n0 passed, 0 failed (skipped: no engine)')
  process.exit(0)
}

// The game-engine spec's own seed and pace: seed 1 deals a land to play at the
// first stop, and a pace low enough not to sit through the engine's turn.
const SEED = Number(process.env.ENGINE_SEED) || 1
const PACE = 120
// A heartbeat that never beats during the run: relay.spec.mjs found that a fast
// one, in a process shared with Playwright, can cut a healthy browser.
const PING_MS = 60 * 1000
const dir = mkdtempSync(join(tmpdir(), 'engine-restart-'))
const relayOptions = { roomsDir: dir, engineCommand, pingMs: PING_MS, engineSeed: SEED, pace: PACE }
let relayServer = createRelay(relayOptions)
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const PORT = relayServer.server.address().port
const RELAY = `http://127.0.0.1:${PORT}`

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{R}', cmc: 1, type_line,
  oracle_text: '', color_identity: ['R'], colors: ['R'], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { standard: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
// Portal's own collector numbers, as game-engine.spec.mjs has them.
const CARDS = [
  c('mountain', 'Mountain', 'Basic Land — Mountain', { mana_cost: '', cmc: 0, produced_mana: ['R'], collector_number: '208' }),
  c('goblin', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste', collector_number: '145' }),
  c('bully', 'Goblin Bully', 'Creature — Goblin', { mana_cost: '{1}{R}', cmc: 2, power: '2', toughness: '1', collector_number: '131' }),
  c('hulk', 'Hulking Goblin', 'Creature — Goblin', { mana_cost: '{2}{R}', cmc: 3, power: '2', toughness: '2', collector_number: '135' }),
  c('hammer', 'Volcanic Hammer', 'Sorcery', { mana_cost: '{1}{R}', cmc: 2, oracle_text: 'Volcanic Hammer deals 3 damage to any target.', collector_number: '154' }),
  c('axe', 'Lava Axe', 'Sorcery', { mana_cost: '{4}{R}', cmc: 5, oracle_text: 'Lava Axe deals 5 damage to target player.', collector_number: '137' }),
]
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [{
    id: 'd1', name: 'Goblins', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
    main: [
      { cardId: 'mountain', quantity: 14 }, { cardId: 'goblin', quantity: 6 }, { cardId: 'bully', quantity: 4 },
      { cardId: 'hulk', quantity: 4 }, { cardId: 'hammer', quantity: 4 }, { cardId: 'axe', quantity: 2 },
    ],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { relayUrl: RELAY, playerName: 'Robin', reduceMotion: true },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
// What the room told the page, as the page received it, with when.
const wire = { status: null, me: null, heard: [] }
page.on('websocket', (ws) => ws.on('framereceived', ({ payload }) => {
  let m
  try { m = JSON.parse(typeof payload === 'string' ? payload : payload.toString()) } catch { return }
  if (m?.t !== 'engine') return
  wire.heard.push({
    op: m.op, at: Date.now(),
    ...(m.op === 'restoring' || m.op === 'restored' ? { body: m } : {}),
    ...(m.op === 'refused' || m.op === 'gone' ? { said: m.error ?? m.reason } : {}),
    ...(m.op === 'status' ? { waiting: m.status?.waiting, actor: m.status?.actor, stop: m.status?.stop, turn: m.status?.turn } : {}),
  })
  if (m.op === 'status' && m.status) wire.status = m.status
  if (m.op === 'seated' && m.engineSeat) wire.me = m.engineSeat
}))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
await page.route('**/cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from(PIXEL.split(',')[1], 'base64') }))

const axeViolations = async () => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  return result.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join('; ')}`)
}
/** A tap on a hand card, at a point of it no other card covers (game-engine.spec.mjs). */
const tapHand = async (locator) => {
  const card = locator.locator('.bcard').first()
  await card.scrollIntoViewIfNeeded()
  const point = await card.evaluate((el) => {
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
const prompt = page.locator('.prompt')
const banner = page.locator('.game__restoring')
const hand = () => page.locator('.tabletop__handcard .bcard').count()
const tiles = () => page.locator('.game__field .field .bcard--tile').count()
const logText = () => page.locator('.gamelog').textContent().then((t) => t ?? '')
const lives = () => page.locator('.plate__total').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? '').join('/'))
/**
 * The table as a person sees it, by name: the cards in this seat's hand and on
 * each battlefield (each card's label begins with its name), both life totals,
 * and where the room says the game stands — its turn, step and whose it is. Two
 * tables that agree on all of it are the same game at the same stop, where a
 * count of cards would take a different hand of the same size for this one.
 */
const tableNow = async () => {
  const names = (els) => els.map((el) => (el.getAttribute('aria-label') ?? '').split(',')[0]).sort()
  return JSON.stringify({
    hand: await page.locator('.tabletop__handcard .bcard').evaluateAll(names),
    fields: await page.locator('.game__field .field').evaluateAll((els) => els.map((f) => ({
      field: (f.getAttribute('aria-label') ?? '').split(',')[0],
      cards: [...f.querySelectorAll('.bcard')].map((c) => (c.getAttribute('aria-label') ?? '').split(',')[0]).sort(),
    }))),
    lives: await lives(),
    at: wire.status ? { turn: wire.status.turn, step: wire.status.step, actor: wire.status.actor } : null,
  })
}
/**
 * This seat's own stop, with something it may do, in a status the room sent
 * after the `from`th message the page heard: what "playing again" means. Only
 * a status sent after the event counts, since the one before it is still the
 * last the page heard until the room says otherwise.
 */
const myStop = (from, test = () => true) => until(() => {
  const at = wire.heard.findLastIndex((h) => h.op === 'status')
  return at >= from && wire.status.actor === wire.me && wire.status.waiting === 'action' && (wire.status.actions ?? []).length > 0 && test(wire.status)
}, ENGINE_START_MS)
/** The first `restored` the page heard after the `from`th message, and whether a stop of this seat's followed it. */
const cameBack = (from) => {
  const i = wire.heard.findIndex((h, k) => k >= from && h.op === 'restored')
  if (i < 0) return null
  const play = wire.heard.slice(i).find((h) => h.op === 'status' && h.actor === wire.me && h.waiting === 'action')
  return { said: wire.heard[i].body, at: wire.heard[i].at, playing: Boolean(play), playingAt: play?.at ?? null }
}
/**
 * Passes at each of this seat's stops until the table comes back to it in a
 * later turn than `turn`: the engine's own turn played between. A turn can
 * stop this seat more than once — a haste goblin to cast after combat — so one
 * pass is not a turn.
 */
const passToLaterTurn = async (turn) => {
  for (let i = 0; i < 12; i++) {
    const from = wire.heard.length
    await page.getByRole('button', { name: '→ Pass' }).click()
    if (!(await myStop(from))) return false
    if (wire.status.turn > turn) return true
  }
  return false
}
const roomOf = (code) => relayServer.rooms.get(code)?.engine
const keptThrough = (code) => until(() => roomOf(code)?.record().kept?.stop === wire.status?.stop, 10_000)

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })

console.log('\nSitting down, and a land played')
await page.getByRole('button', { name: 'Play the engine' }).click()
await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash)))
const code = await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
await page.getByRole('button', { name: /^Goblins/ }).first().click()
await page.getByRole('button', { name: /Sit down with Goblins/ }).click()
check('the engine deals, and the first thing is the hand to keep', await until(() => page.getByRole('group', { name: 'Your opening hand' }).count().then((n) => n === 1), ENGINE_START_MS))
let heard = wire.heard.length
await page.getByRole('group', { name: 'Your opening hand' }).getByRole('button', { name: /^Keep this hand/ }).click()
check('keeping it begins the game, at a stop with a land to play', await myStop(heard, (s) => s.actions.some((a) => a.type === 'PlayLand')))
const land = page.locator('.tabletop__handcard').filter({ has: page.getByLabel(/^Mountain/) }).first()
heard = wire.heard.length
await tapHand(land)
check('a land is played through the engine', await until(() => tiles().then((n) => n === 1)))
await myStop(heard)
check('the room keeps the stop the table is at', await keptThrough(code), JSON.stringify({ kept: roomOf(code)?.record().kept?.stop, at: wire.status?.stop }))
const before = { hand: await hand(), tiles: await tiles(), table: await tableNow() }
// What is kept of this room on disk, whole: its file, written as the relay writes it.
relayServer.flush()
const file = join(dir, `${code}.json`)
const kept = JSON.parse(readFileSync(file, 'utf8'))
check('the room is on disk, its game gzipped beside it', kept.mode === 'enforced' && typeof kept.room?.kept?.gzip === 'string' && kept.room.kept.stop === wire.status.stop)
console.log(`  (the room's file: ${statSync(file).size} bytes, the game in it ${kept.room.kept.bytes} bytes before gzip)`)

console.log('\nThe relay restarts mid-game')
const heardBefore = wire.heard.length
await relayServer.shutdown()
check('the page says it lost the table and is coming back for it', await until(() => page.getByText('Lost the table for a moment. Reconnecting…').count().then((n) => n > 0), 5000))
relayServer = createRelay(relayOptions)
await new Promise((resolve) => relayServer.server.listen(PORT, resolve))
const relayBack = Date.now()
check('the room is back from disk, its engine loading the game', relayServer.rooms.has(code) && roomOf(code).describe().restoring === 'relay', JSON.stringify(roomOf(code)?.describe().restoring))
check('the table says the game is coming back, and that nothing pressed will happen until it has',
  await until(() => banner.textContent().then((t) => t === 'The relay restarted, and this game is coming back as it was at the last stop. Nothing you press will happen until it is back.').catch(() => false), 15_000),
  await banner.textContent().catch(() => 'no banner'))
check('said as a status, for a screen reader', await banner.getAttribute('role') === 'status')
check('and nothing is offered to press while it is', await prompt.count() === 0 && await page.locator('.bcard--playable').count() === 0)
check('the board it is coming back to stays on screen meanwhile', await tiles() === before.tiles && await hand() === before.hand)
// A tap on a card while there is no stop at all: the kept stop is this
// seat's own, so "It is not your stop." would be untrue (M7's review).
await tapHand(page.locator('.tabletop__handcard').first())
await page.locator('.rail').getByRole('button', { name: 'Actions', exact: true }).click()
const panel = page.locator('section.actions')
check('the actions panel says the game is coming back, not whose stop it is not',
  await until(() => panel.textContent().then((t) => t.includes('coming back') && t.includes('The relay restarted, and this game is coming back as it was at the last stop.') && !/not your stop|not waiting on you/.test(t)).catch(() => false), 5000),
  await panel.textContent().catch(() => 'no panel'))
check('and a tap on a card says nothing of whose stop it is', await page.getByText('It is not your stop.').count() === 0 && await page.getByText('The engine is not waiting on you.').count() === 0)
check('the Pass button says why it cannot be pressed', await page.getByRole('button', { name: '→ Pass' }).getAttribute('title') === 'The relay restarted, and this game is coming back as it was at the last stop. Nothing you press will happen until it is back.')
await panel.getByRole('button', { name: 'Close' }).click()
check('the table coming back has no accessibility violations', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
check('the banner stands still under reduced motion', await banner.evaluate((el) => getComputedStyle(el).animationName === 'none'))
await page.screenshot({ path: SHOT('restart-coming-back') })
// A phone's width, where a banner that runs long would push the table sideways.
await page.setViewportSize({ width: 390, height: 844 })
check('at a phone\'s width the banner wraps, and nothing goes sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await page.screenshot({ path: SHOT('restart-coming-back-phone') })
await page.setViewportSize({ width: 1280, height: 900 })
// The page reloaded while the game comes back: nothing to draw yet, and the
// table's place says why, where it would say it was sitting down.
// With the system asking for reduced motion: the table's place is drawn as a
// sweeping skeleton, which stands still only then, and the accessibility check
// waits for everything to stand still — so without it the check waited until
// the table had come back, and checked that instead.
await page.emulateMedia({ reducedMotion: 'reduce' })
console.log(`  (reloading ${Date.now() - relayBack} ms after the relay was listening again)`)
await page.reload({ waitUntil: 'domcontentloaded' })
const waiting = page.locator('.game--loading .field__empty')
check('a page reloaded meanwhile says the game is coming back, in the table\'s place',
  await until(() => waiting.textContent().then((t) => t === 'The relay restarted, and this game is coming back as it was at the last stop. Nothing you press will happen until it is back.').catch(() => false), 15_000),
  await waiting.textContent().catch(() => 'no placeholder'))
await page.screenshot({ path: SHOT('restart-reloaded') })
check('said as a status there too', await waiting.getAttribute('role').catch(() => null) === 'status')
check('the table\'s place stands still under reduced motion', await page.locator('.game--loading .skeleton').first().evaluate((el) => getComputedStyle(el, '::after').animationName === 'none').catch(() => false))
// Checked while it stands: the table's place, not the table come back.
check('the table\'s place coming back has no accessibility violations', await axeViolations().then(async (v) => (v.length === 0 || (console.log(v.join('\n')), false)) && (await waiting.count() === 1 || (console.log('        the game came back before the check was made'), false))))
await page.emulateMedia({ reducedMotion: null })

const playing = await until(() => Boolean(cameBack(heardBefore)?.playing), ENGINE_START_MS)
check('the seat has a play offered again, once the game is back', playing && await myStop(heardBefore))
const restoredMsg = cameBack(heardBefore)
const playingAt = restoredMsg?.playingAt ?? Date.now()
check('the room said what came back: the relay, at the last stop, nothing lost', restoredMsg?.said?.reason === 'relay' && restoredMsg.said.behind === 0 && !('lost' in restoredMsg.said), JSON.stringify(restoredMsg?.said))
check('the banner is gone once it is back', await until(() => banner.count().then((n) => n === 0), 5000))
// Drawn from the whole view the room sends after the status: waited for.
await until(() => tiles().then((n) => n === before.tiles), 5000)
const afterRelay = await tableNow()
check('the table is as it was, card by card: the hand, each battlefield, the life totals, and the turn, step and seat the game waits on',
  afterRelay === before.table, JSON.stringify({ before: before.table, after: afterRelay }))
check('the log says the relay restarted and where the table is, once',
  await until(() => logText().then((t) => t.split('The relay restarted; the table is as it was at the last stop.').length === 2), 5000), (await logText()).slice(-400))
check('the table back has no accessibility violations', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.screenshot({ path: SHOT('restart-back') })
const relayWait = playingAt - relayBack
console.log(`  (from the relay listening again to a play offered: ${relayWait} ms)`)

console.log('\nAnd the game goes on')
const turnBefore = wire.status.turn
check('passes are taken, the engine plays its turn, and the table comes back to this seat in a later turn',
  await passToLaterTurn(turnBefore), JSON.stringify({ turnBefore, now: wire.status?.turn, waiting: wire.status?.waiting, refused: wire.heard.filter((h) => h.op === 'refused') }))

console.log('\nThe engine stops mid-game')
await keptThrough(code)
const beforeKill = await tableNow()
const heardAtCrash = wire.heard.length
const first = roomOf(code).engine
// The whole tree: on Windows the process the bridge holds is the shell Gradle's
// launcher runs in, and the JVM under it is what has to go.
const killed = Date.now()
await new Promise((resolve) => {
  const k = process.platform === 'win32' ? spawn('taskkill', ['/pid', String(first.pid), '/T', '/F'], { stdio: 'ignore' }) : (process.kill(first.pid, 'SIGKILL'), null)
  if (k) k.on('exit', resolve); else resolve()
})
check('the table says the engine is starting again with the game as it was',
  await until(() => banner.textContent().then((t) => t === 'The engine stopped, and is starting again with this game as it was at the last stop. Nothing you press will happen until it is back.').catch(() => false), 15_000),
  await banner.textContent().catch(() => 'no banner'))
check('and offers nothing meanwhile', await prompt.count() === 0)
await page.screenshot({ path: SHOT('restart-engine') })
const engineBack = await until(() => Boolean(cameBack(heardAtCrash)?.playing), ENGINE_START_MS)
const engineWait = (cameBack(heardAtCrash)?.playingAt ?? Date.now()) - killed
check('the seat has a play offered again, from a new engine', engineBack && await myStop(heardAtCrash) && roomOf(code).engine !== first)
const again = cameBack(heardAtCrash)
check('the room said the engine restarted, at the last stop', again?.said?.reason === 'engine' && again.said.behind === 0, JSON.stringify(again?.said))
check('and the log says so, in the brief\'s words', await until(() => logText().then((t) => t.includes('The engine restarted; the table is as it was at the last stop.')), 5000))
const afterKill = await tableNow()
check('the same game again, card by card, at the same stop', afterKill === beforeKill, JSON.stringify({ before: beforeKill, after: afterKill }))
check('no page or room said the game was gone', await page.locator('[role="alert"]').filter({ hasText: 'The engine has gone' }).count() === 0)
console.log(`  (from the engine killed to a play offered: ${engineWait} ms)`)
check('and the game goes on from there, to a later turn again', await passToLaterTurn(wire.status.turn))
await page.screenshot({ path: SHOT('restart-on') })

console.log('\nA table whose kept game cannot be read back')
await relayServer.shutdown()
// Damaged on disk while no relay runs: what was kept of the game will not unpack.
const damaged = JSON.parse(readFileSync(file, 'utf8'))
writeFileSync(file, JSON.stringify({ ...damaged, room: { ...damaged.room, kept: { ...damaged.room.kept, gzip: 'this is not gzip' } } }))
relayServer = createRelay(relayOptions)
await new Promise((resolve) => relayServer.server.listen(PORT, resolve))
check('no engine is started for a game there is nothing to give', relayServer.rooms.has(code) && roomOf(code).lastStarted === null)
await page.evaluate((c) => { location.hash = `#/game/engine/${c}` }, code)
const goneLine = page.locator('.lobby__notice').first()
const why = 'The relay restarted, and this game could not come back: what was kept of it could not be read back from the disk.'
check('its lobby says the table has gone, and why, in the room\'s words',
  await until(() => goneLine.textContent().then((t) => t === `That table has gone. ${why}`).catch(() => false), 15_000),
  await goneLine.textContent().catch(() => 'no notice'))
check('that lobby has no accessibility violations', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.screenshot({ path: SHOT('restart-gone-lobby') })

check('no errors in the page', errors.length === 0, errors.join('; '))
check('and none in its console', consoleErrors.length === 0, consoleErrors.join('; '))

console.log(`\nPictures: ${['restart-coming-back', 'restart-coming-back-phone', 'restart-reloaded', 'restart-back', 'restart-engine', 'restart-on', 'restart-gone-lobby'].map(SHOT).join(', ')}`)
await browser.close()
await relayServer.shutdown()
rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
