#!/usr/bin/env node
/**
 * The engine on screen, through the app itself.
 *
 * engine-live.test.js proves the wire; this proves the screens on top of
 * it: from the lobby, a person opens a table the engine holds, sits down
 * with a deck, and plays — a land by tapping it, a pass from the rail, an
 * attack by tapping a creature and pressing Attack — against the engine's
 * own player, with the log saying what the engine did on their behalf.
 * Then a reload, which has to land back in the same seat at the same table.
 *
 * Needs the built engine (scripts/engine-build.sh). Where there is none
 * this says so and passes nothing, rather than pretending: a JVM is not
 * something the browser suite may demand of every machine.
 *
 *   node tests/browser/game-engine.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { createRelay } from '../../scripts/relay-server.mjs'
import { findEngine } from '../../scripts/engine-bridge.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Where the pictures go: the system's own temporary folder, so the same path
// works on every machine rather than only where /tmp exists. Printed at the
// end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `engine-${name}.png`)

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

const relayServer = createRelay({ engineCommand, pingMs: 300 })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const RELAY = `http://127.0.0.1:${relayServer.server.address().port}`

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{R}', cmc: 1, type_line,
  oracle_text: '', color_identity: ['R'], colors: ['R'], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { standard: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
const CARDS = [
  c('mountain', 'Mountain', 'Basic Land — Mountain', { mana_cost: '', cmc: 0, produced_mana: ['R'] }),
  c('goblin', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste' }),
  c('bully', 'Goblin Bully', 'Creature — Goblin', { mana_cost: '{1}{R}', cmc: 2, power: '2', toughness: '1' }),
  c('hulk', 'Hulking Goblin', 'Creature — Goblin', { mana_cost: '{2}{R}', cmc: 3, power: '2', toughness: '2' }),
  c('hammer', 'Volcanic Hammer', 'Sorcery', { mana_cost: '{1}{R}', cmc: 2, oracle_text: 'Volcanic Hammer deals 3 damage to any target.' }),
  c('axe', 'Lava Axe', 'Sorcery', { mana_cost: '{4}{R}', cmc: 5, oracle_text: 'Lava Axe deals 5 damage to target player.' }),
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
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
// The engine's image links point at Scryfall's image host, which this
// sandbox cannot reach; a pixel stands in so the printed face falls back
// to the drawn one, as it does offline.
await page.route('**/cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from(PIXEL.split(',')[1], 'base64') }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })

console.log('\nFrom the lobby')
const playEngine = page.getByRole('button', { name: 'Play the engine' })
check('the lobby offers the engine when the relay has one', await until(() => playEngine.count().then((n) => n === 1)))
await playEngine.click()
check('opening a table the engine holds changes the address', await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash))), page.url())
const code = await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
check('the lobby says the rules are enforced', await until(() => page.locator('.lobby__mode').textContent().then((t) => /Rules enforced/.test(t ?? ''))))
check('the seats panel names the engine as the seat opposite', await until(() => page.locator('.lobby__seats').textContent().then((t) => /The engine/.test(t ?? ''))))
await page.getByRole('button', { name: /^Goblins/ }).first().click()
await page.getByRole('button', { name: /Sit down with Goblins/ }).click()

console.log('\nAt the table')
check('the table opens for that deck', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20000))
const prompt = page.locator('.prompt')
check('the engine deals and stops at the first thing worth stopping for', await until(() => prompt.count().then((n) => n === 1), 20000))
const hand = () => page.locator('.tabletop__handcard .bcard').count()
check('seven cards in hand', (await hand()) === 7, String(await hand()))
check('the seat opposite is the engine', /The engine/.test(await page.locator('.game__them').textContent()))
check('the plate says whose stop it is', /Your stop|Your attack|The engine asks/.test(await prompt.getAttribute('aria-label')))
const land = page.locator('.tabletop__handcard').filter({ has: page.getByLabel(/^Mountain/) }).first()
check('a land is in hand to play', (await land.count()) === 1)

// A tap on a card in hand plays it through the engine's offer for it.
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
await tapHand(land)
check('tapping a land plays it: the engine put it on the battlefield', await until(() => page.locator('.game__field .field .bcard--tile').count().then((n) => n === 1)))
check('and the hand is one lighter', await until(() => hand().then((n) => n === 6)))
check('the tile is in the lands row', await until(() => page.locator('.game__field .field .bcard--tile').first().textContent().then((t) => /mountain/i.test(t ?? ''))))

// Pass to the next stop, and on until the turn is over; the engine takes
// its turn, and the log says what was passed for us on the way.
const passBtn = page.getByRole('button', { name: '→ Pass' })
const logText = () => page.locator('.gamelog').textContent().then((t) => t ?? '')
await passBtn.click()
check('after a pass the engine comes back to the next stop', await until(() => prompt.count().then((n) => n === 1), 20000))
check('the log says how many windows the engine passed for you', await until(() => logText().then((t) => /passed \d+ priority window/.test(t)), 20000))
for (let i = 0; i < 6 && !/Turn [23]/i.test(await logText()); i++) {
  if (await passBtn.isEnabled()) { await passBtn.click(); await until(() => prompt.count().then((n) => n === 1), 20000); await sleep(150) }
  else if ((await prompt.getAttribute('aria-label')) === 'Your attack') await page.getByRole('button', { name: 'No attack' }).click()
  else break
}
check('passing through the turn hands it to the engine, which plays and hands it back', await until(() => logText().then((t) => /Your turn\s*·\s*Turn 3/i.test(t)), 20000), (await logText()).slice(0, 200))

console.log('\nAn attack')
// Play what can be played and pass until the engine asks who attacks, then
// tap a creature and press Attack. A goblin has haste, so this comes soon.
let attacked = false
for (let i = 0; i < 24 && !attacked; i++) {
  // The engine's own turn takes it a moment: wait for the next stop rather
  // than spinning through the loop while there is nothing on screen to do.
  await until(() => prompt.count().then((n) => n === 1), 20000)
  const label = (await prompt.count()) ? await prompt.getAttribute('aria-label') : null
  if (label === 'Game over') break
  if (label === 'Your attack') {
    const attacker = page.locator('.game__field .field .bcard--tile').filter({ hasText: /goblin/i }).first()
    if (!(await attacker.count())) { await page.getByRole('button', { name: 'No attack' }).click(); continue }
    await attacker.click()
    check('tapping a creature draws its attack as an arrow', await until(() => page.locator('.game__field .field__arrow--attack').count().then((n) => n === 1)))
    await page.screenshot({ path: SHOT('attack') })
    await page.getByRole('button', { name: /Attack with 1/ }).click()
    // The engine may block, so damage is not promised; the attack being
    // declared is, and the log says so in the engine's words.
    check('the attack is declared and the game moves past it', await until(() => Promise.all([prompt.getAttribute('aria-label').catch(() => null), logText()]).then(([l, t]) => l !== 'Your attack' && /attack/i.test(t)), 20000), (await logText()).slice(0, 200))
    attacked = true
    break
  }
  if (label === 'The engine asks') { await page.getByRole('button', { name: /Let the engine choose|Yes/ }).first().click(); continue }
  const playable = page.locator('.tabletop__handcard').filter({ has: page.getByLabel(/^(Mountain|Raging Goblin|Goblin Bully|Hulking Goblin)/) })
  if (await playable.count()) {
    const before = await hand()
    await tapHand(playable.first())
    // Either it played (hand smaller) or the engine refused it (a banner): move on either way.
    await until(() => Promise.all([hand(), page.locator('.banner--info').count()]).then(([n, b]) => n < before || b > 0), 4000)
    if ((await hand()) < before) continue
  }
  if (await passBtn.isEnabled()) { await passBtn.click(); await until(() => prompt.count().then((n) => n === 1), 20000); await sleep(150) }
}
check('an attack was declared within a few turns', attacked)

console.log('\nComing back')
await page.reload({ waitUntil: 'networkidle' })
check('a reload lands back in the same seat', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20000))
check('at the same table', await until(() => page.evaluate(() => location.hash).then((h) => h.includes(code))))
check('with the game where it was', await until(() => page.locator('.game__field .field .bcard--tile').count().then((n) => n >= 1), 10000))
check('the engine\'s table is not on the More panel\'s menu of things to do by hand', await (async () => {
  await page.getByRole('button', { name: 'More' }).click()
  return until(() => page.locator('.more').textContent().then((t) => /the engine's here/.test(t ?? '')))
})())
check('undo is not offered', await page.getByRole('button', { name: '↶ Undo' }).isDisabled())

check('no console errors throughout', errors.length === 0, errors.join('\n'))
await page.screenshot({ path: SHOT('table') })
console.log(`\nScreenshots: ${SHOT('attack')} and ${SHOT('table')}`)
await browser.close()
await relayServer.shutdown()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
