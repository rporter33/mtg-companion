#!/usr/bin/env node
/**
 * The seat opposite at a phone's width: its plate, its hand of backs and its
 * zone tiles side by side, none of them drawn over another.
 *
 * Found 2026-09-25 (PLAN.md, "§3 item 19: a stand-in commander"): at 390 px, once
 * the engine held seven cards, their backs ran over its zone tiles — the backs'
 * right edge at 267 px, the tiles' left at 175 — because the middle column of
 * `.game__them--seated` shrank to nothing and the backs did not. This measures
 * it where it was found and where it was not looked for: at 360, 390 and 430 px
 * wide, with none, seven and twelve cards in the hand opposite, at the engine's
 * table (the relay and the scripted stand-in for the engine, whose `handSize`
 * says how many cards the engine holds) and at a table played by hand (two
 * people through the relay, the second drawing and playing by the rail's own
 * buttons). And the table played alone, whose seat opposite is an empty one
 * with a sentence where the hand would be, at the same widths — where, before the
 * same fix, the sentence took the width and stacked the four tiles in a column.
 *
 * Nothing is taken on trust from a class name: the boxes are measured as the
 * browser drew them. What overlapping means here is two boxes sharing more than
 * half a pixel each way; a back's own neighbours overlap by design, a fan.
 *
 *   node tests/browser/seat-opposite.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelay } from '../../scripts/relay-server.mjs'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
const FAKE_ENGINE = fileURLToPath(new URL('../fixtures/fake-engine.mjs', import.meta.url))
// Pictures go to the system's temporary folder, named at the end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `ui-seat-opposite-${name}.png`)
const shots = []
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

const WIDTHS = [360, 390, 430]
const PHONE_HEIGHT = 844

const dir = mkdtempSync(join(tmpdir(), 'seat-opposite-'))
const relayServer = createRelay({ roomsDir: dir, engineCommand: FAKE_ENGINE, pingMs: 60_000, pace: 0 })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const RELAY = `http://127.0.0.1:${relayServer.server.address().port}`

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{R}', cmc: 1, type_line,
  oracle_text: '', color_identity: ['R'], colors: ['R'], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { standard: 'legal', commander: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
const CARDS = [
  c('mountain', 'Mountain', 'Basic Land — Mountain', { mana_cost: '', cmc: 0, produced_mana: ['R'], collector_number: '208' }),
  c('goblin', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste', collector_number: '145' }),
]
const deck = (id, name) => ({
  id, name, formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
  main: [{ cardId: 'mountain', quantity: 20 }, { cardId: 'goblin', quantity: 20 }],
  sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})
const stateFor = (who) => ({
  version: 4, collection: {}, games: [],
  decks: [deck(`d-${who}`, `${who}'s Goblins`)],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  // Fast, and the question answered: how a person plays is pace.spec.mjs's to test, and
  // the panel it asks in would only push the seat opposite up the page.
  prefs: { relayUrl: RELAY, playerName: who, reduceMotion: true, tablePace: { preset: 'fast', asked: true } },
})

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []
/** A device: its own context and storage, seeded with one deck and the relay's address. */
const device = async (who) => {
  // Service workers blocked, as in every spec that routes *.scryfall.io: the built app's own
  // fetches Scryfall's images past page.route, and the stand-in's faces are Scryfall's links.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`))
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
  await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
  await page.route('**/cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from(PIXEL.split(',')[1], 'base64') }))
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), stateFor(who))
  return page
}

/**
 * The seat opposite as drawn: the plate, what is in the hand's place (each back
 * and the "+n" after twelve, or the words said of an empty hand), and each zone
 * tile, with the seat's own box and whether the page scrolls sideways.
 */
const measure = (page, seat = '.game__them') => page.evaluate((selector) => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
  const them = document.querySelector(selector)
  if (!them) return null
  const hand = them.querySelector('.game__theirhand')
  const inHand = hand ? [...hand.querySelectorAll('.back, .backs__more')] : []
  return {
    seat: box(them),
    plate: box(them.querySelector('.plate')),
    hand: inHand.length ? inHand.map(box) : hand?.firstElementChild ? [box(hand.firstElementChild)] : hand ? [box(hand)] : [],
    backs: hand ? hand.querySelectorAll('.back').length : 0,
    label: hand?.getAttribute('aria-label') ?? hand?.textContent ?? '',
    tiles: [...them.querySelectorAll('.ztiles--them .ztile')].map((t) => ({ ...box(t), face: box(t.querySelector('.ztile__face')) })),
    field: them.querySelector('.game__theirfield') ? box(them.querySelector('.game__theirfield')) : null,
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    width: window.innerWidth,
  }
}, seat)

// Two boxes overlap where they share more than half a pixel each way.
const TOLERANCE = 0.5
const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOLERANCE && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOLERANCE
const inside = (a, b) => a.left >= b.left - TOLERANCE && a.right <= b.right + TOLERANCE && a.top >= b.top - TOLERANCE && a.bottom <= b.bottom + TOLERANCE
const px = (b) => `${Math.round(b.left)}–${Math.round(b.right)} × ${Math.round(b.top)}–${Math.round(b.bottom)}`
const span = (boxes) => boxes.length ? px({ left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)), top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) }) : 'nothing'
/** Where each thing was drawn, printed rather than checked, for the record PLAN.md keeps. */
const report = (m) => console.log(`        drawn: seat ${Math.round(m.seat.right - m.seat.left)} px wide; plate ${px(m.plate)}; hand ${span(m.hand)}; tiles ${span(m.tiles)}; ${m.field ? `their field from ${Math.round(m.field.top - m.seat.top)} px below the seat's top` : 'no field'}`)

/** Everything this spec holds a seat opposite to, at one width with one hand. */
const holds = (m, where, count) => {
  const at = `${where}, ${m?.width} px, ${count} in hand`
  if (!m) { check(`${at}: the seat opposite is drawn`, false); return }
  const clash = []
  for (const h of m.hand) {
    if (overlaps(h, m.plate)) clash.push(`hand ${px(h)} over the plate ${px(m.plate)}`)
    for (const t of m.tiles) if (overlaps(h, t)) clash.push(`hand ${px(h)} over a tile ${px(t)}`)
  }
  for (const t of m.tiles) if (overlaps(t, m.plate)) clash.push(`a tile ${px(t)} over the plate ${px(m.plate)}`)
  check(`${at}: nothing in the hand is drawn over the plate or a zone tile, nor a tile over the plate`, clash.length === 0, clash.slice(0, 3).join('; '))
  const out = [m.plate, ...m.hand, ...m.tiles.map((t) => t.face)].filter((b) => !inside(b, m.seat))
  check(`${at}: and all of it inside the seat's own box`, out.length === 0, `${out.map(px).join('; ')} outside ${px(m.seat)}`)
  // Four tiles may wrap into two rows where a plate and four tiles do not fit side by
  // side; stacked any deeper, something has been given their width.
  const rows = new Set(m.tiles.map((t) => Math.round(t.top))).size
  check(`${at}: the tiles in no more than two rows`, rows <= 2, `${rows} rows`)
  check(`${at}: and nothing scrolls sideways`, !m.sideways)
  report(m)
}

/** The page at each phone width, measured, then back to the width it had. */
const atEachWidth = async (page, where, count, test) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: PHONE_HEIGHT })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const m = await measure(page, '.game__them--seated')
    holds(m, where, count)
    if (test) await test(m, width)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}

const axeClean = async (page) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  const found = result.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join('; ')}`)
  if (found.length) console.log(found.join('\n'))
  return found.length === 0
}
const shoot = async (page, name) => { const path = SHOT(name); await page.screenshot({ path }); shots.push(path) }

// ---------------------------------------------------------------------------

console.log('\nAt the engine\'s table')
const robin = await device('Robin')
await robin.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await robin.reload({ waitUntil: 'networkidle' })
const playEngine = robin.getByRole('button', { name: 'Play the engine' })
check('the lobby offers the engine', await until(() => playEngine.count().then((n) => n === 1)))
await playEngine.click()
check('a table the engine holds is opened', await until(() => robin.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash))), robin.url())
const code = await robin.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
await robin.getByRole('button', { name: /^Robin's Goblins/ }).first().click()
await robin.getByRole('button', { name: /Sit down with Robin's Goblins/ }).click()
check('the table opens, the engine opposite', await until(() => robin.locator('.game:not(.game--loading) .game__them--seated').count().then((n) => n === 1), 20_000))
const engineSeat = relayServer.rooms.get(code)?.engine?.engine
check('the stand-in for the engine can be reached', Boolean(engineSeat))

for (const size of [7, 0, 12]) {
  const said = await engineSeat.call('handSize', { seat: 'e1', size })
  // A reload asks the room for this seat's view whole, which carries the hand as it now is.
  await robin.reload({ waitUntil: 'networkidle' })
  const label = `Bot's hand, ${size} card${size === 1 ? '' : 's'}`
  check(`the engine holds ${size}, and the seat opposite says so`,
    said?.size === size && await until(() => robin.locator('.game__them--seated .game__theirhand').getAttribute('aria-label').then((l) => l === label).catch(() => false), 10_000),
    await robin.locator('.game__them--seated .game__theirhand').getAttribute('aria-label').catch(() => 'none'))
  check(`with ${Math.min(size, 12)} backs drawn${size > 12 ? ', and the rest counted' : ''}`, await robin.locator('.game__them--seated .back').count() === Math.min(size, 12))
  await atEachWidth(robin, 'the engine\'s table', size, size === 12 ? async (m, width) => { if (width !== 430) await shoot(robin, `engine-12-${width}`) } : null)
}

console.log('\nAt the engine\'s table, wide')
const wide = await measure(robin, '.game__them--seated')
holds(wide, 'the engine\'s table', 12)
check('at 1280 px the backs sit between the plate and the tiles, on one row with them',
  wide && wide.hand.every((h) => h.left >= wide.plate.right && h.right <= Math.min(...wide.tiles.map((t) => t.left)) && h.top < wide.plate.bottom),
  wide && `plate to ${Math.round(wide.plate.right)}, backs ${px(wide.hand[0])} to ${Math.round(wide.hand.at(-1).right)}, tiles from ${Math.round(Math.min(...wide.tiles.map((t) => t.left)))}`)
await shoot(robin, 'engine-12-1280')
await robin.setViewportSize({ width: 390, height: PHONE_HEIGHT })
check('the engine\'s table with twelve cards opposite has no accessibility violations at a phone\'s width', await axeClean(robin))
await robin.setViewportSize({ width: 1280, height: 900 })

// ---------------------------------------------------------------------------

console.log('\nAt a table played by hand, two people through the relay')
const ada = await device('Ada')
const bob = await device('Bob')
await ada.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await ada.reload({ waitUntil: 'networkidle' })
await until(() => ada.getByRole('button', { name: 'Invite a friend' }).count().then((n) => n === 1))
await ada.getByRole('button', { name: 'Invite a friend' }).click()
check('a room is opened', await until(async () => /^#\/game\/room\/[A-Z0-9]{5}$/.test(await ada.evaluate(() => location.hash))))
const room = (await ada.evaluate(() => location.hash)).split('/').pop()
await ada.locator('.lobby__deck').first().click()
await ada.getByRole('button', { name: /^Sit down with/ }).click()
await until(() => ada.getByRole('button', { name: 'Keep hand →' }).count().then((n) => n === 1))
await ada.getByRole('button', { name: 'Keep hand →' }).click()
await bob.goto(`${TARGET}#/game/room/${room}`, { waitUntil: 'networkidle' })
await bob.reload({ waitUntil: 'networkidle' })
await until(() => bob.locator('.lobby__deck').count().then((n) => n > 0))
await bob.locator('.lobby__deck').first().click()
await bob.getByRole('button', { name: /^Sit down with/ }).click()
await until(() => bob.getByRole('button', { name: 'Keep hand →' }).count().then((n) => n === 1))
await bob.getByRole('button', { name: 'Keep hand →' }).click()
const backs = () => ada.locator('.game__them--seated .back').count()
check('the second person sits opposite, holding seven', await until(() => backs().then((n) => n === 7)))
await atEachWidth(ada, 'the table played by hand', 7, async (m, width) => { if (width === 390) await shoot(ada, 'hand-7-390') })

/** Taps a card in Bob's fan by its visible sliver; see game-room.spec.mjs. */
const tapHand = async (page, card) => {
  await card.scrollIntoViewIfNeeded()
  const point = await card.evaluate((el) => {
    const slot = el.closest('.tabletop__handcard')
    const r = slot.getBoundingClientRect()
    const y = r.top + r.height / 2
    let from = null
    for (let x = r.left + 1; x < r.right; x += 1) {
      const hit = document.elementFromPoint(x, y)
      if (hit && slot.contains(hit)) { if (from === null) from = x }
      else if (from !== null) return { x: (from + x) / 2, y }
    }
    return from === null ? null : { x: (from + r.right) / 2, y }
  })
  if (!point) throw new Error('no part of that hand card is tappable — it is fully covered')
  await page.mouse.click(point.x, point.y)
}
// One tap plays a card (FRICTION.md, Law 2), so seven taps empty the hand.
for (let left = 7; left > 0; left--) {
  await tapHand(bob, bob.locator('.tabletop__handcard .bcard').last())
  await until(() => bob.locator('.tabletop__handcard .bcard').count().then((n) => n === left - 1))
}
check('the second person plays every card in hand, and the first sees an empty hand opposite',
  await until(() => backs().then((n) => n === 0)) && /Nothing in hand/.test(await ada.locator('.game__them--seated .game__theirhand').innerText()))
await atEachWidth(ada, 'the table played by hand', 0, async (m, width) => { if (width === 360) await shoot(ada, 'hand-0-360') })

// Twelve drawn with the rail's More, whose panel keeps Draw at a table played by hand.
await bob.getByRole('button', { name: 'More', exact: true }).click()
const draw = bob.getByRole('button', { name: 'Draw', exact: true })
await until(() => draw.count().then((n) => n === 1))
for (let n = 1; n <= 12; n++) {
  await draw.click()
  await until(() => bob.locator('.tabletop__handcard .bcard').count().then((k) => k === n))
}
check('the second person draws twelve, and the first sees twelve backs opposite', await until(() => backs().then((n) => n === 12)), String(await backs()))
await atEachWidth(ada, 'the table played by hand', 12, async (m, width) => { if (width === 390) await shoot(ada, 'hand-12-390') })
const handWide = await measure(ada, '.game__them--seated')
holds(handWide, 'the table played by hand', 12)
await shoot(ada, 'hand-12-1280')

// ---------------------------------------------------------------------------

console.log('\nAt a table played alone, the seat opposite empty')
const solo = await device('Sol')
await solo.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await solo.evaluate(() => {
  // No relay: a table played alone, as a person with no relay set plays it.
  const state = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  delete state.prefs.relayUrl
  localStorage.setItem('mtg-companion:v1', JSON.stringify(state))
})
await solo.reload({ waitUntil: 'networkidle' })
await until(() => solo.locator('.lobby__deck').count().then((n) => n > 0))
await solo.locator('.lobby__deck').first().click()
await solo.getByRole('button', { name: /^Start game with/ }).click()
check('the table opens with nobody opposite', await until(() => solo.locator('.game__them .plate--them').count().then((n) => n === 1)))
for (const width of WIDTHS) {
  await solo.setViewportSize({ width, height: PHONE_HEIGHT })
  await solo.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  holds(await measure(solo, '.game__them'), 'the table played alone', 0)
}

check('no console errors on any device', errors.length === 0, errors.join('; '))

await browser.close()
await relayServer.shutdown()
rmSync(dir, { recursive: true, force: true })
console.log(`\nPictures, to be looked at:\n${shots.map((s) => `  ${s}`).join('\n')}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
