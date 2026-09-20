#!/usr/bin/env node
/**
 * The rebuilt table's lobby, at #/game — and the wall around it.
 *
 * Two things are checked, and the second matters more than the first. That
 * the lobby shows a person's decks and lets them pick one is the feature.
 * That the old table at #/table is untouched — same picker, same chunk, no
 * new script pulled in — is the promise this rebuild was made under: nothing
 * that works today breaks while the new thing is half built.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const deck = (id, name, formatId, extra = {}) => ({
  id, name, formatId, commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
  main: [{ cardId: 'elf', quantity: 4 }], sideboard: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
})
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [
    deck('d1', 'Elves Forever', 'commander', { commanders: ['cmdr'], main: [{ cardId: 'elf', quantity: 99 }] }),
    deck('d2', 'Mono Green Stompy', 'standard', { main: [{ cardId: 'elf', quantity: 60 }] }),
    deck('d3', 'Pauper Elves', 'pauper', { main: [{ cardId: 'elf', quantity: 60 }] }),
  ],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
}

/*
 * One green pixel stands in for a painting: what matters is that a deck with
 * a commander shows that commander's art and colours, not what the art is.
 */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over,
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf', {
    color_identity: ['G', 'W'], image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL },
  }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid'),
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const scripts = new Set()
page.on('request', (r) => {
  if (r.resourceType() === 'script') scripts.add(new URL(r.url()).pathname.split('/').pop())
})
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
// Registered after the catch-all so it wins: the shelf fetches its face and
// commander cards in one collection call.
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
// A full load, not a hash change: storage is read once per document and
// cached, so a fragment-only navigation would still see the empty state the
// app started with. This is the trap every spec here has to step around.
await page.reload({ waitUntil: 'networkidle' })

console.log('\nThe lobby is reachable by address, and by nothing else')
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('the address holds', await page.evaluate(() => location.hash) === '#/game')
check('it opens on Solo: Commander, because that is where the decks are',
  /Solo:\s*Commander/.test(await page.locator('.lobby__title').innerText()),
  await page.locator('.lobby__title').innerText())
check('there is no tab for it in the bar', (await page.getByRole('button', { name: 'Game', exact: true }).count()) === 0)
check('its code is its own chunk, loaded on demand',
  [...scripts].some((s) => s.startsWith('GameView')), [...scripts].join(' '))

console.log('\nFormat tabs carry counts and filter the shelf')
const tabs = page.locator('.lobby__formats .lobby__tab')
check('Commander, Standard and Pauper are up front, then More', (await tabs.count()) === 4,
  String(await tabs.count()))
check('each tab says how many decks are behind it',
  /Commander\s*1/.test(await tabs.nth(0).innerText()) && /Standard\s*1/.test(await tabs.nth(1).innerText()),
  await tabs.allInnerTexts().then((t) => t.join(' | ')))
check('the shelf shows only the current format', (await page.locator('.lobby__deck').count()) === 1)
await page.getByRole('button', { name: /^Standard/ }).click()
await page.waitForTimeout(150)
check('switching tab switches the shelf',
  /Mono Green Stompy/.test(await page.locator('.lobby__shelf').innerText()))
await page.getByRole('button', { name: '▾ More' }).click()
await page.waitForTimeout(150)
check('More reveals the rest of the formats', (await tabs.count()) > 4, String(await tabs.count()))
await page.getByRole('button', { name: /^Commander/ }).click()
await page.waitForTimeout(150)

console.log('\nThe shelf knows its decks')
await page.locator('.lobby__deck .lobby__pips .mana').first().waitFor({ timeout: 5000 })
check('a commander deck shows its colour identity as pips',
  (await page.locator('.lobby__deck .lobby__pips .mana').count()) === 2)
check('and the pips are spoken, not only drawn',
  (await page.locator('.lobby__shelf').getByRole('img', { name: /white/i }).count()) === 1)
check('the commander is named under the deck',
  /Test Commander/.test(await page.locator('.lobby__deckmeta').first().innerText()))
check('and its painting sits behind the name', (await page.locator('.lobby__deck img.deck-art').count()) === 1)
check('a guide deck is offered, and says it rotates',
  /rotates every visit/.test(await page.locator('.lobby__tiles').innerText()))

console.log('\nThe colours filter carries counts')
const colours = page.getByRole('button', { name: /^Colours/ })
check('it exists on a Commander tab', (await colours.count()) === 1)
await colours.click()
await page.waitForTimeout(150)
const facets = page.locator('.lobby__facet')
check('white has one deck behind it', /1\s*$/.test(await facets.nth(0).innerText()), await facets.nth(0).innerText())
check('blue has none', /0\s*$/.test(await facets.nth(1).innerText()), await facets.nth(1).innerText())
await facets.nth(2).click() // black
await page.waitForTimeout(150)
check('asking for black empties the shelf and says so',
  (await page.locator('.lobby__deck').count()) === 0 && /No deck here matches/.test(await page.locator('.lobby__decks').innerText()))
await facets.nth(2).click() // black off
await facets.nth(0).click() // white
await page.waitForTimeout(150)
check('asking for white finds the green-white deck', (await page.locator('.lobby__deck').count()) === 1)
await page.getByRole('button', { name: 'Exactly these' }).click()
await page.waitForTimeout(150)
check('but exactly white does not, because it is also green', (await page.locator('.lobby__deck').count()) === 0)
await facets.nth(4).click() // green
await page.waitForTimeout(150)
check('exactly white and green does', (await page.locator('.lobby__deck').count()) === 1)
await page.getByRole('button', { name: /^Standard/ }).click()
await page.waitForTimeout(150)
check('a sixty-card tab has no colours filter, because nothing honest feeds it',
  (await page.getByRole('button', { name: /^Colours/ }).count()) === 0)
await page.getByRole('button', { name: /^Commander/ }).click()
await page.waitForTimeout(150)
check('changing tab lets the colours go', (await page.locator('.lobby__deck').count()) === 1)

console.log('\nChoosing and starting')
check('nothing is chosen at first, so Start is not offered',
  await page.getByRole('button', { name: /^Start game/ }).isDisabled())
await page.locator('.lobby__deck').first().click()
await page.waitForTimeout(150)
check('the chosen deck gets a tick', (await page.locator('.lobby__deck--chosen .lobby__tick').count()) === 1)
check('and the button names what it will do',
  /Start game with Elves Forever/.test(await page.getByRole('button', { name: /^Start game/ }).innerText()),
  await page.getByRole('button', { name: /^Start game/ }).innerText())
check('the seats panel says plainly that there is nobody to play against',
  /Solitaire/.test(await page.locator('.lobby__seats').innerText()))
await page.fill('#lobby-find', 'zzz')
await page.waitForTimeout(150)
check('search that matches nothing says so', /No deck here matches/.test(await page.locator('.lobby__decks').innerText()))
await page.fill('#lobby-find', '')
await page.waitForTimeout(150)
await page.getByRole('button', { name: /^Start game/ }).click()
await page.waitForTimeout(400)
check('starting carries the deck in the address', await page.evaluate(() => location.hash) === '#/game/d1',
  await page.evaluate(() => location.hash))
check('and lands on an honest placeholder, not a fake table',
  /not built yet/i.test(await page.locator('main').innerText()))
await page.getByRole('button', { name: '← Lobby' }).click()
await page.waitForTimeout(300)
check('Lobby goes back to the lobby', await page.evaluate(() => location.hash) === '#/game')

console.log('\nA deck that is gone')
await page.goto(`${TARGET}#/game/nope`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
check('says so rather than throwing', /not on this device/.test(await page.locator('main').innerText()))
check('and offers the way back', (await page.getByRole('button', { name: 'Back to the lobby' }).count()) === 1)

console.log('\nThe wall: the old table is untouched')
await page.goto(`${TARGET}#/table`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('#/table still shows its own picker', (await page.locator('.table-picker').count()) === 1)
check('with all three decks, as before', (await page.locator('.table-picker__deck').count()) === 3)
check('and nothing of the lobby leaked into it', (await page.locator('.lobby').count()) === 0)

console.log()
check('no console errors throughout', errors.length === 0, errors.join('\n'))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
