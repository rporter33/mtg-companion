#!/usr/bin/env node
/**
 * Card art as a backdrop: on the deck cards, behind the editor's title, and
 * behind each list row.
 *
 * Three rules are driven here rather than trusted. The face card follows a
 * fixed order (chosen, commander, costliest, first) and the Decks screen
 * shows the same one the editor does. Art never costs readability: it is
 * decoration, hidden from assistive technology, and a painting that cannot
 * load leaves a plain row. And it obeys the person: an Art switch on the
 * list, and the images-off preference everywhere.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const c = (id, name, type_line, prices, art = PNG) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices,
  image_uris: art ? { small: PNG, normal: PNG, art_crop: art } : {},
})
const CARDS = [
  c('cmdr', 'Art Commander', 'Legendary Creature — Elf', { usd: '2.00' }),
  c('cheap', 'Cheap Elf', 'Creature — Elf', { usd: '0.10' }),
  c('pricey', 'Pricey Dragon', 'Creature — Dragon', { usd: '40.00' }),
  c('noart', 'Plain Token', 'Creature — Token', { usd: '99.00' }, null),
  // A painting the browser cannot fetch: the service worker tries and fails.
  c('broken', 'Broken Picture', 'Creature — Ghost', { usd: '0.50' }, 'https://cards.scryfall.io/art_crop/nope.png'),
]
const deck = (id, name, commanders, main) => ({
  id, name, formatId: 'commander', commanders, signatureSpell: null, categoryOrder: [], versions: [],
  main, sideboard: [], createdAt: `2026-01-0${id.slice(-1)}T00:00:00Z`, updatedAt: '2026-02-01T00:00:00Z',
})
const STATE = {
  version: 4, collection: {},
  decks: [
    deck('d1', 'Led Deck', ['cmdr'], [{ cardId: 'cheap', quantity: 1 }, { cardId: 'pricey', quantity: 1 }, { cardId: 'noart', quantity: 1 }, { cardId: 'broken', quantity: 1 }]),
    deck('d2', 'Headless Deck', [], [{ cardId: 'cheap', quantity: 1 }, { cardId: 'pricey', quantity: 1 }]),
  ],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
// The app reads storage once and keeps it; a seed written underneath needs
// a reload to be seen, exactly as a person's fresh open would.
await page.reload({ waitUntil: 'networkidle' })
await page.goto(`${TARGET}#/decks`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

const artOf = (scope) => page.locator(`${scope} .deck-art`).first().getAttribute('data-art-of').catch(() => null)
const openDeck = async (name) => {
  await page.locator('.deck-card', { hasText: name }).locator('.deck-card__open').click()
  await page.waitForTimeout(900)
}
const back = async () => { await page.getByRole('button', { name: '← Decks' }).click(); await page.waitForTimeout(500) }

console.log('\nBefore a deck has ever been opened here')
check('the Decks screen shows no art yet, since no card has been cached',
  (await page.locator('.deck-art').count()) === 0)

console.log('\nIn the editor')
await openDeck('Led Deck')
check('the title sits over the commander\'s painting', (await artOf('.deck-head')) === 'cmdr', await artOf('.deck-head'))
const rowArts = page.locator('.deck-row .deck-art')
await page.waitForTimeout(1500)
check('rows carry their own paintings', (await rowArts.count()) >= 3, String(await rowArts.count()))
check('a card with no art gets a plain row',
  (await page.locator('.deck-row', { hasText: 'Plain Token' }).locator('.deck-art').count()) === 0)
check('a painting that cannot be fetched leaves a plain row rather than a broken frame',
  (await page.locator('.deck-row', { hasText: 'Broken Picture' }).locator('.deck-art').count()) === 0)
check('paintings are decoration: hidden from assistive technology, no alt text',
  await rowArts.first().evaluate((img) => img.getAttribute('aria-hidden') === 'true' && img.getAttribute('alt') === ''))
check('and lazy, so a hundred rows do not fetch a hundred paintings at once',
  (await rowArts.first().getAttribute('loading')) === 'lazy')
const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
check('nothing scrolls sideways on a phone', wide)

console.log('\nThe Art switch')
const artSwitch = page.getByRole('button', { name: 'Art', exact: true })
check('the list offers an Art switch, on by default', (await artSwitch.getAttribute('aria-pressed')) === 'true')
await artSwitch.click()
await page.waitForTimeout(300)
check('off takes the paintings out of the rows', (await rowArts.count()) === 0)
check('but not from the title', (await artOf('.deck-head')) === 'cmdr')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)
check('the choice is remembered', (await page.locator('.deck-row .deck-art').count()) === 0
  && (await page.getByRole('button', { name: 'Art', exact: true }).getAttribute('aria-pressed')) === 'false')
await page.getByRole('button', { name: 'Art', exact: true }).click()
await page.waitForTimeout(300)

console.log('\nIn the grid')
await page.getByRole('button', { name: 'Grid', exact: true }).click()
await page.waitForTimeout(600)
const tileArts = page.locator('.deck-tile .deck-art')
check('tiles carry their painting behind them too', (await tileArts.count()) >= 3, String(await tileArts.count()))
check('a card with no art gets a plain tile',
  (await page.locator('.deck-tile', { hasText: 'Plain Token' }).locator('.deck-art').count()) === 0)
check('the painting sits under the card image, not over it',
  await page.locator('.deck-tile--backed').first().evaluate((tile) => {
    const kids = [...tile.children]
    return kids[0].classList.contains('deck-art') && kids.slice(1).every((k) => getComputedStyle(k).position === 'relative')
  }))
const gridSwitch = page.getByRole('button', { name: 'Art', exact: true })
check('the Art switch is offered on the grid as well', (await gridSwitch.count()) === 1)
await gridSwitch.click()
await page.waitForTimeout(300)
check('and takes the paintings out of the tiles', (await tileArts.count()) === 0)
await gridSwitch.click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'List', exact: true }).click()
await page.waitForTimeout(500)

console.log('\nChoosing the art')
const picker = page.getByLabel('Deck art')
check('the picker says which card is automatic', /automatic \(Art Commander\)/.test(await picker.locator('option').first().innerText()))
await picker.selectOption({ label: 'Art: Pricey Dragon' })
await page.waitForTimeout(400)
check('a chosen card takes over the title', (await artOf('.deck-head')) === 'pricey', await artOf('.deck-head'))
await back()
check('and the Decks screen shows the same painting', (await artOf('.deck-card:has-text("Led Deck")')) === 'pricey',
  await artOf('.deck-card:has-text("Led Deck")'))
await openDeck('Led Deck')
await page.getByLabel('Deck art').selectOption({ value: '' })
await page.waitForTimeout(400)
check('automatic returns to the commander', (await artOf('.deck-head')) === 'cmdr')
await back()

console.log('\nA deck with no commander')
check('on the list, before any edit, the first card stands in',
  (await artOf('.deck-card:has-text("Headless Deck")')) === 'cheap', await artOf('.deck-card:has-text("Headless Deck")'))
await openDeck('Headless Deck')
check('the editor chooses the costliest card', (await artOf('.deck-head')) === 'pricey', await artOf('.deck-head'))
await page.locator('.deck-row', { hasText: 'Cheap Elf' }).getByRole('button', { name: /One more/ }).click()
await page.waitForTimeout(400)
await back()
check('after an edit the list agrees, because the editor recorded its answer',
  (await artOf('.deck-card:has-text("Headless Deck")')) === 'pricey', await artOf('.deck-card:has-text("Headless Deck")'))

console.log('\nImages switched off')
await page.evaluate(() => {
  const root = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  root.prefs = { ...(root.prefs ?? {}), showCardImages: false }
  localStorage.setItem('mtg-companion:v1', JSON.stringify(root))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
check('no painting on the Decks screen', (await page.locator('.deck-art').count()) === 0)
await openDeck('Led Deck')
check('none in the editor, and no Art switch or picker to argue with',
  (await page.locator('.deck-art').count()) === 0
  && (await page.getByRole('button', { name: 'Art', exact: true }).count()) === 0
  && (await page.getByLabel('Deck art').count()) === 0)

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
