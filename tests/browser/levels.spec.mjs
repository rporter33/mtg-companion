#!/usr/bin/env node
/**
 * How strongly the engine plays, chosen in the lobby (HANDOFF.md, M3).
 *
 * The choice is the lobby's and the level is the room's, so this drives both
 * through the app itself: the three levels offered beside the engine's seat,
 * intermediate chosen for a first game, each with the app's own line about it
 * and the measured sentence under them, nothing axe can find wrong at either
 * width, the choice remembered across a reload, and the level travelling with
 * the sit to the engine and coming back into the log and the seat list.
 *
 * The relay runs here with the scripted stand-in for the engine
 * (tests/fixtures/fake-engine.mjs), so this runs on any machine and in CI,
 * where there is no JVM; game-engine.spec.mjs plays a level against the real
 * one where there is.
 *
 *   node tests/browser/levels.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { WebSocket } from 'ws'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelay } from '../../scripts/relay-server.mjs'
import { LEVEL_LINES, LEVELS_MEASURED } from '../../src/lib/engine/levels.js'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
const FAKE_ENGINE = fileURLToPath(new URL('../fixtures/fake-engine.mjs', import.meta.url))
// Pictures go to the system's temporary folder and are named at the end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `levels-${name}.png`)
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

// No pace: the stand-in plays no turn of its own worth waiting on.
const relayServer = createRelay({ engineCommand: FAKE_ENGINE, pingMs: 60_000, pace: 0 })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const RELAY = `http://127.0.0.1:${relayServer.server.address().port}`
const peek = async (code) => (await fetch(`${RELAY}/rooms/${code}`)).json()

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{R}', cmc: 1, type_line,
  oracle_text: '', color_identity: ['R'], colors: ['R'], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { standard: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
const CARDS = [
  c('mountain', 'Mountain', 'Basic Land — Mountain', { mana_cost: '', cmc: 0, produced_mana: ['R'], collector_number: '208' }),
  c('goblin', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste', collector_number: '145' }),
]
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [{
    id: 'd1', name: 'Goblins', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
    main: [{ cardId: 'mountain', quantity: 20 }, { cardId: 'goblin', quantity: 20 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  // No level kept: this is somebody's first game against the engine.
  prefs: { relayUrl: RELAY, playerName: 'Robin', reduceMotion: true },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
// Service workers blocked, as in game-engine.spec.mjs: the built app's own
// fetches every *.scryfall.io image past page.route, so the stand-in engine's
// card faces (real Scryfall links) would not be the pixel routed below.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
await page.route('**/cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from(PIXEL.split(',')[1], 'base64') }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })

/** What axe finds on the page as it stands, at the levels a11y.spec.mjs holds the app to. */
const axeViolations = async () => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  return result.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join('; ')}`)
}
const keptLevel = () => page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1') ?? '{}').prefs?.engineLevel ?? null)

console.log('\nThe choice, in the lobby')
const playEngine = page.getByRole('button', { name: 'Play the engine' })
check('the lobby offers the engine when the relay has one', await until(() => playEngine.count().then((n) => n === 1)))
await playEngine.click()
check('opening a table the engine holds changes the address', await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash))), page.url())
const code = await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
const group = page.getByRole('group', { name: 'How the engine plays' })
check('beside the engine\'s seat, the lobby asks how the engine plays', await until(() => group.count().then((n) => n === 1)))
const radio = (name) => group.getByRole('radio', { name: new RegExp(`^${name}`) })
check('it offers three levels, as radios a keyboard and a screen reader can use', await group.getByRole('radio').count() === 3)
check('a first game is intermediate, the owner\'s choice', await radio('Intermediate').isChecked() && !(await radio('Easy').isChecked()) && !(await radio('Hard').isChecked()))
check('and nothing is kept until the player chooses', (await keptLevel()) === null)
const groupText = (await group.textContent()) ?? ''
check('each level has the app\'s own line about it', Object.values(LEVEL_LINES).every((line) => groupText.includes(line)), groupText)
check('and the lines say they are the app\'s own, with what was measured and when', groupText.includes(`These descriptions are this app's own. ${LEVELS_MEASURED}`), groupText)
check('the room was opened at the level the lobby showed', (await peek(code)).level === 'intermediate', JSON.stringify(await peek(code)))
check('the lobby with the choice has no accessibility violations', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.locator('.lobby__seats').screenshot({ path: SHOT('lobby') })

await radio('Hard').check()
check('choosing hard marks it chosen', await radio('Hard').isChecked() && !(await radio('Intermediate').isChecked()))
check('and marks it by its border as well as by the dot', await group.locator('.lobby__level--on').textContent().then((t) => /^Hard/.test(t ?? '')) && await group.locator('.lobby__level--on').count() === 1)
check('the choice is kept with the player\'s other table preferences', (await keptLevel()) === 'hard')
await radio('Hard').focus()
await page.keyboard.press('ArrowUp')
check('the arrow keys move between levels, as radios do', await radio('Intermediate').isChecked())
await page.keyboard.press('ArrowDown')
check('and back', await radio('Hard').isChecked() && (await keptLevel()) === 'hard')

await page.reload({ waitUntil: 'networkidle' })
check('a reload remembers the level chosen', await until(() => radio('Hard').isChecked().catch(() => false)))

console.log('\nAt a phone\'s width')
await page.setViewportSize({ width: 390, height: 844 })
await group.scrollIntoViewIfNeeded()
check('the choice fits without scrolling sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`))
check('and has no accessibility violations there either', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.setViewportSize({ width: 1280, height: 900 })

console.log('\nThe level travels to the engine, and comes back')
await page.getByRole('button', { name: /^Goblins/ }).first().click()
await page.getByRole('button', { name: /Sit down with Goblins/ }).click()
check('the table opens', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000))
const engine = relayServer.rooms.get(code)?.engine?.engine
const sent = engine ? (await engine.call('lastNew')).request : null
check('the sit carried the level to the room, which asked the engine for it for its own seat', sent?.players?.[1]?.level === 'hard' && !('level' in (sent?.players?.[0] ?? {})), JSON.stringify(sent?.players?.map((p) => ({ ai: p.ai, level: p.level }))))
check('the room says the engine took it', await peek(code).then((r) => r.played === 'hard'), JSON.stringify(await peek(code)))
const log = page.locator('.gamelog')
check('the log names the level once, as the room said it', await until(() => log.textContent().then((t) => (t ?? '').split('The engine is playing at the hard level.').length === 2)), await log.textContent())
check('and the seat list names it beside the engine', await until(() => page.locator('.game__seats').textContent().then((t) => /· Hard/.test(t ?? ''))), await page.locator('.game__seats').textContent())
await page.screenshot({ path: SHOT('table') })

console.log('\nA slow answer')
// Measured at M3: hard, with a deck of instants, took up to 9.7 s to answer a
// move. The stand-in is told to hold its next answer until this spec lets it
// go, so the answer is slow for as long as the checks need it to be and no
// longer, whatever the machine.
await engine.call('holdActs')
const prompt = page.locator('.prompt')
const plate = page.locator('.game__them .plate__status')
const pressed = prompt.getByRole('button').last()
const label = (await pressed.textContent())?.trim()
await pressed.click()
await pressed.click().catch(() => {})
check('a second press while the first is being answered is not sent, and the table says why',
  await until(() => page.locator('.banner').textContent().then((t) => /The engine is still answering your last move\./.test(t ?? '')).catch(() => false), 1000),
  `pressed ${label}`)
// That an ordinary wait shows nothing is held with a fake clock in
// tests/engine-room.test.jsx; here the table's own wait is real.
check('once the answer is slow, the plate says the engine is thinking, in words', await until(() => plate.textContent().then((t) => /The engine is thinking…/.test(t ?? '')), 3000))
check('and the prompt steps aside while it does, as at one of the engine\'s own stops', (await prompt.count()) === 0)
await page.screenshot({ path: SHOT('slow') })
await engine.call('release')
check('the answer comes, and the plate stops saying so', await until(() => plate.textContent().then((t) => !/thinking/i.test(t ?? '')), 5000))
check('and "still answering" goes with it, since the answer has come', await until(() => page.locator('.banner', { hasText: 'still answering' }).count().then((n) => n === 0), 3000))
check('and the engine was sent the one press, not two', (await engine.call('tally')).acts === 1)

await page.goto(`${TARGET}#/game/engine/${code}`, { waitUntil: 'networkidle' })
check('back in that table\'s lobby, the game\'s level is said, not offered again',
  await until(() => page.locator('.lobby__seats').textContent().then((t) => /under way at the hard level/.test(t ?? ''))) && (await group.count()) === 0,
  await page.locator('.lobby__seats').textContent())

console.log('\nA table still dealing')
// The engine loads its whole corpus before it deals — seconds, against the real
// one — and the lobby for that table said all the while that its game was under
// way and its engine played one way only (found in M3's review). The stand-in
// holds its first answer here until the spec lets it go; somebody else sits
// down at the table, and this page looks at its lobby meanwhile.
process.env.FAKE_HOLD_HELLO = '1'
const dealing = await (await fetch(`${RELAY}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seats: 2, enforced: true, ai: 'heuristic', level: 'easy' }) })).json()
const sitter = new WebSocket(`${RELAY.replace(/^http/, 'ws')}/rooms/${dealing.code}/ws`)
await new Promise((resolve) => sitter.once('open', resolve))
sitter.send(JSON.stringify({ t: 'engine', op: 'sit', name: 'Sam', deck: { Mountain: 20, 'Raging Goblin': 20 } }))
await until(() => Boolean(relayServer.rooms.get(dealing.code)?.engine?.engine))
delete process.env.FAKE_HOLD_HELLO
await page.goto(`${TARGET}#/game/engine/${dealing.code}`, { waitUntil: 'networkidle' })
const lobbyText = () => page.locator('.lobby__seats').textContent().then((t) => t ?? '')
check('the lobby of a table still dealing says so, at the level it was asked for, and offers no other',
  await until(() => lobbyText().then((t) => /The engine is dealing this table's game, asked to play at the easy level\./.test(t))) && (await group.count()) === 0,
  await lobbyText())
check('rather than that its game is under way, one way only', !/under way|one way only/.test(await lobbyText()), await lobbyText())
check('and has no accessibility violations while it says it', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await relayServer.rooms.get(dealing.code).engine.engine.call('release')
check('once dealt, it says the game is under way at the level the engine took', await until(() => lobbyText().then((t) => /under way at the easy level/.test(t)), 8000), await lobbyText())
sitter.close()

check('no uncaught errors', errors.length === 0, errors.join('; '))

console.log(`\nPictures: ${SHOT('lobby')}, ${SHOT('table')}, ${SHOT('slow')}`)
await browser.close()
await relayServer.shutdown()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
