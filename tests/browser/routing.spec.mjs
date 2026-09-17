#!/usr/bin/env node
/**
 * Where you are is in the URL.
 *
 * The things a person expects from a web page and did not get before: a deck
 * has a link, a reload keeps the screen, the back button retraces steps, and
 * a card sheet closes on back. Each is driven here through the real address
 * bar, because a router that is only tested by its parse function has not
 * been tested at the one thing it is for.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over,
})
const CARDS = [
  c('cmdr', 'Route Commander', 'Legendary Creature — Elf'),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid'),
]
const BOLT = c('bolt', 'Lightning Bolt', 'Instant', { mana_cost: '{R}', colors: ['R'], color_identity: ['R'] })
const STATE = {
  version: 4, collection: {},
  decks: [{
    id: 'd1', name: 'Routed Deck', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    categoryOrder: [], versions: [],
    main: [{ cardId: 'elf', quantity: 1 }], sideboard: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []
const mock = async (page) => {
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
  await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
  await page.route('**/api.scryfall.com/cards/search**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ object: 'list', data: [BOLT], total_cards: 1, has_more: false }) }))
  await page.route('**/api.scryfall.com/cards/elf', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(CARDS[1]) }))
}
const hash = (page) => page.evaluate(() => location.hash)
const context = await browser.newContext({ viewport: { width: 430, height: 1100 } })
const page = await context.newPage()
await mock(page)
await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

console.log('\nA fresh open lands somewhere that is written down')
check('with decks saved, the app opens on Decks and says so in the address bar',
  (await hash(page)) === '#/decks', await hash(page))

console.log('\nA deck has a link')
await page.locator('.deck-card__open').first().click()
await page.waitForTimeout(700)
check('opening a deck puts it in the URL', (await hash(page)) === '#/decks/d1', await hash(page))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
check('a reload keeps the deck open', (await page.locator('.deck-title').count()) === 1
  && (await page.locator('.deck-title').inputValue()) === 'Routed Deck')

await page.getByRole('tab', { name: 'Analysis' }).click()
await page.waitForTimeout(300)
check('the tab inside a deck is in the URL too', (await hash(page)) === '#/decks/d1/analysis', await hash(page))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
check('and survives a reload', (await page.getByRole('tab', { name: 'Analysis' }).getAttribute('aria-selected')) === 'true')

console.log('\nThe back button means back')
await page.goBack()
await page.waitForTimeout(500)
check('back from a deck returns to the deck list, not to the previous tab inside it',
  (await hash(page)) === '#/decks' && (await page.locator('.deck-card__open').count()) === 1, await hash(page))
await page.goForward()
await page.waitForTimeout(500)
check('forward reopens it', (await page.locator('.deck-title').count()) === 1)

console.log('\nThe card sheet is an overlay')
await page.getByRole('tab', { name: 'List' }).click()
await page.waitForTimeout(300)
await page.locator('.deck-row__name').first().click()
await page.waitForTimeout(500)
check('opening a card adds it to the URL without leaving the deck',
  /^#\/decks\/d1\?card=/.test(await hash(page)) && (await page.getByRole('dialog').count()) === 1, await hash(page))
await page.goBack()
await page.waitForTimeout(500)
check('back closes the sheet and drops the parameter',
  (await page.getByRole('dialog').count()) === 0 && (await hash(page)) === '#/decks/d1', await hash(page))
await page.locator('.deck-row__name').first().click()
await page.waitForTimeout(500)
await page.getByRole('dialog').getByRole('button', { name: /close/i }).first().click().catch(() => page.keyboard.press('Escape'))
await page.waitForTimeout(500)
check('closing from the sheet does the same, and leaves no extra history entry behind',
  (await page.getByRole('dialog').count()) === 0 && (await hash(page)) === '#/decks/d1', await hash(page))

console.log('\nPressing the tab you are on goes home')
await page.getByRole('button', { name: 'Decks', exact: true }).click()
await page.waitForTimeout(400)
check('Decks from inside a deck returns to the list', (await hash(page)) === '#/decks' && (await page.locator('.deck-card__open').count()) === 1)

console.log('\nDeep links')
{
  const fresh = await context.newPage()
  await mock(fresh)
  await fresh.goto(`${TARGET}#/decks/d1/coach`, { waitUntil: 'networkidle' })
  await fresh.waitForTimeout(800)
  check('a link to a deck tab opens exactly that',
    (await fresh.locator('.deck-title').count()) === 1
    && (await fresh.getByRole('tab', { name: 'Coach' }).getAttribute('aria-selected')) === 'true')
  await fresh.close()

  const sheet = await browser.newPage({ viewport: { width: 430, height: 1100 } })
  await mock(sheet)
  // A new browser context: no card cache, so the card comes from Scryfall.
  await sheet.goto(TARGET, { waitUntil: 'networkidle' })
  await sheet.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
  await sheet.goto(`${TARGET}#/decks/d1?card=elf`, { waitUntil: 'networkidle' })
  await sheet.waitForTimeout(1200)
  check('a link with a card opens the sheet on that card, fetched if need be',
    (await sheet.getByRole('dialog').count()) === 1 && /Llanowar Elves/.test(await sheet.getByRole('dialog').innerText()),
    await sheet.getByRole('dialog').innerText().catch(() => 'no dialog'))
  await sheet.close()

  const search = await context.newPage()
  await mock(search)
  await search.goto(`${TARGET}#/cards?q=t%3Ainstant`, { waitUntil: 'networkidle' })
  await search.waitForTimeout(1000)
  check('a link with a search runs it', /Lightning Bolt/.test(await search.locator('main').innerText()))
  check('and keeps it in the URL', (await hash(search)) === '#/cards?q=t%3Ainstant', await hash(search))
  await search.close()

  const missing = await context.newPage()
  await mock(missing)
  await missing.goto(`${TARGET}#/decks/nope`, { waitUntil: 'networkidle' })
  await missing.waitForTimeout(700)
  check('a link to a deck that does not exist lands on the list',
    (await hash(missing)) === '#/decks' && (await missing.locator('.deck-card__open').count()) === 1, await hash(missing))
  await missing.close()

  const junk = await context.newPage()
  await mock(junk)
  await junk.goto(`${TARGET}#/what/is/this`, { waitUntil: 'networkidle' })
  await junk.waitForTimeout(600)
  check('junk in the address bar falls back to the default screen', (await hash(junk)) === '#/decks', await hash(junk))
  await junk.close()
}

console.log('\nOther tabs')
await page.getByRole('button', { name: 'Play', exact: true }).click()
await page.waitForTimeout(300)
check('the tab bar writes the URL', (await hash(page)) === '#/play', await hash(page))
await page.getByRole('button', { name: 'Learn', exact: true }).click()
await page.waitForTimeout(300)
check('every tab has an address', (await hash(page)) === '#/guide', await hash(page))

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
