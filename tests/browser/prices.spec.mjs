#!/usr/bin/env node
/**
 * Prices, in the browser.
 *
 * Two of the bugs this covers were invisible to unit tests and obvious on
 * screen: the euro placeholder rendered as "$----", a dollar sign in front of a
 * euro column, and the deck list threw "market is not defined" because the
 * state lived in one component and the rows in another — which only showed up
 * once a deck had a row in it, so an empty deck looked fine.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const card = (id, name, prices, extra = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{2}{R}', cmc: 3,
  type_line: 'Creature — Human Warrior', oracle_text: 'Haste', color_identity: ['R'],
  colors: ['R'], rarity: 'rare', set: 'tst', set_name: 'Test', collector_number: '1',
  legalities: { commander: 'legal' }, prices,
  purchase_uris: { tcgplayer: 'https://tcg.example/x', cardmarket: 'https://cm.example/x', cardhoarder: 'https://ch.example/x' },
  ...extra,
})

const PRICED = card('priced', 'Priced Card', { usd: '7.49', eur: '7.17', tix: '0.03' })
const UNPRICED = card('unpriced', 'Unpriced Card', {})
const FOIL = card('foil', 'Foil Only Card', { usd: null, usd_foil: '199.00', eur: '150.00' })
const CMDR = card('cmdr', 'Test Commander', { usd: '5.00' }, {
  type_line: 'Legendary Creature — Elf', color_identity: ['G'], colors: ['G'],
})

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// Catch-all first: Playwright gives precedence to the route registered last.
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [] }) }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [CMDR, PRICED, UNPRICED, FOIL] }) }))
await page.route('**/api.scryfall.com/cards/search**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', total_cards: 3, has_more: false, data: [PRICED, UNPRICED, FOIL] }) }))

console.log('\nPrices under a card in search')
await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.locator('.app__nav button', { hasText: 'Cards' }).click()
await page.waitForTimeout(400)
await page.getByLabel('Search cards').fill('warrior')
await page.getByRole('button', { name: 'Search' }).click()
await page.waitForTimeout(900)

const rows = page.locator('.card-tile .prices')
check('every card carries all three markets', (await rows.count()) === 3,
  `${await rows.count()} price rows`)

const priced = (await rows.nth(0).innerText()).replace(/\n/g, ' ')
check('a priced card shows each market in its own currency',
  /\$7\.49/.test(priced) && /7,17/.test(priced) && /0\.03 tix/.test(priced), priced)

const none = (await rows.nth(1).innerText()).replace(/\n/g, ' ')
// "$0.00" would claim the card is free, which is how a $199 card once read.
check('an unpriced card shows dashes, never a zero', /----/.test(none) && !/0\.00/.test(none), none)
check('the euro placeholder does not wear a dollar sign',
  !/EUR \$/.test(none), none)

const foil = (await rows.nth(2).innerText()).replace(/\n/g, ' ')
check('a foil-only price is shown and marked as such', /199\.00/.test(foil) && /✦/.test(foil), foil)

const heights = await rows.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
check('every price row is the same height, so the grid scans',
  new Set(heights).size === 1, heights.join(', '))

const hrefs = await rows.nth(0).locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
check('each price links to where you would buy it',
  hrefs.length === 3 && hrefs.every((h) => /example/.test(h)), hrefs.join(' '))
check('and opens it safely in a new tab',
  (await rows.nth(0).locator('a[rel~="noopener"][target="_blank"]').count()) === 3)

console.log('\nPrices in a deck that has cards in it')
// The "market is not defined" crash only appeared once a row rendered, so an
// empty deck is not a sufficient test.
await page.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 1,
  decks: [{
    id: 'd1', name: 'Price Test', formatId: 'commander', commanders: ['cmdr'],
    signatureSpell: null,
    main: [{ cardId: 'priced', quantity: 2 }, { cardId: 'unpriced', quantity: 3 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { showCardImages: true, lastFormat: 'commander' },
})))
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Decks', exact: true }).click()
await page.waitForTimeout(400)
await page.locator('.deck-card__open').first().click()
await page.waitForTimeout(900)

check('the deck list renders rather than hitting the error boundary',
  (await page.getByRole('tab', { name: 'List' }).count()) === 1,
  (await page.locator('.app__main').innerText()).slice(0, 120))

const header = await page.locator('.app__main').innerText()
// 2 x 7.49 + commander 5.00 = 19.98, and the three unpriced are not in it.
check('the header totals what it can price', /\$19\.98/.test(header), header.slice(0, 200))
check('and says how many it could not price, rather than dropping them',
  /3 unpriced/.test(header), header.slice(0, 200))

const rowPrices = await page.locator('.deck-row__price').allInnerTexts()
check('each row shows its own price', rowPrices.some((t) => /\$7\.49/.test(t)), rowPrices.join(' '))
check('an unpriced row shows dashes', rowPrices.some((t) => /----/.test(t)), rowPrices.join(' '))

console.log('\nSwitching market')
await page.getByLabel('Price in').selectOption('eur')
await page.waitForTimeout(500)
const afterSwitch = await page.locator('.app__main').innerText()
check('the deck total switches currency', /€/.test(afterSwitch) && !/\$19\.98/.test(afterSwitch),
  afterSwitch.slice(0, 200))

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.getByRole('button', { name: 'Decks', exact: true }).click()
await page.waitForTimeout(400)
await page.locator('.deck-card__open').first().click()
await page.waitForTimeout(900)
check('the choice survives a reload', (await page.getByLabel('Price in').inputValue()) === 'eur')

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
