#!/usr/bin/env node
/**
 * Owning cards, in the browser.
 *
 * Two properties are worth guarding here. Ownership is keyed by card, not by
 * printing, so a Sol Ring you own covers a Sol Ring your deck lists whatever
 * set it came from. And ownership is edited in two places — on a card and on a
 * deck — which have to agree the moment either changes, or it reads as the app
 * having failed to save.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const c = (id, oracle, name, type_line, usd) => ({
  object: 'card', id, oracle_id: oracle, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' },
  prices: { usd }, purchase_uris: {},
})
// The deck lists the Battlebond Sol Ring; the collection will record the oracle
// card. They must be understood as the same thing.
const CARDS = [
  c('cmdr', 'o-cmdr', 'Test Commander', 'Legendary Creature — Elf', '25.00'),
  c('ring-bbd', 'o-ring', 'Sol Ring', 'Artifact', '2.00'),
  c('elf', 'o-elf', 'Llanowar Elves', 'Creature — Elf Druid', '1.00'),
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1300 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 2,
  decks: [{
    id: 'd1', name: 'Own Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'ring-bbd', quantity: 1 }, { cardId: 'elf', quantity: 4 }],
    sideboard: [], categoryOrder: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { deckView: 'list' },
})))
await page.reload({ waitUntil: 'networkidle' })

const openDeck = async () => {
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.deck-card__open').first().click()
  await page.waitForTimeout(900)
}
const buyChip = async () => (await page.locator('.chip').allInnerTexts()).find((t) => /to get|own this deck/i.test(t)) ?? ''
const needs = () => page.locator('.deck-row__need').allInnerTexts()

await openDeck()

console.log('\nA deck you own none of')
check('says how many cards are still needed', /6 to get/.test(await buyChip()), await buyChip())
// 25 + 2 + 4 x 1
check('and what they would cost', /\$31\.00/.test(await buyChip()), await buyChip())
check('every row shows its shortfall', (await needs()).join(',') === 'need 1,need 4,need 1',
  (await needs()).join(','))

console.log('\nMarking cards owned on the card itself')
await page.locator('.deck-row__name', { hasText: 'Llanowar Elves' }).click()
await page.waitForTimeout(700)
await page.getByRole('tab', { name: 'Details' }).click()
await page.waitForTimeout(400)
const control = page.locator('.panel.row').filter({ hasText: 'In your collection' })
check('the card page offers a count', (await control.count()) === 1)
check('it starts at none', /\b0\b/.test(await control.innerText()), await control.innerText())
check('you cannot own fewer than none',
  await page.getByRole('button', { name: /One fewer Llanowar Elves owned/ }).isDisabled())

for (let i = 0; i < 2; i++) {
  await page.getByRole('button', { name: /One more Llanowar Elves owned/ }).click()
  await page.waitForTimeout(250)
}
check('the count goes up', /\b2\b/.test(await control.innerText()), await control.innerText())

await page.keyboard.press('Escape')
await page.waitForTimeout(700)
// Two copies of the same state would leave the deck still asking for four.
check('the open deck updates at once, without a reload',
  (await needs()).join(',') === 'need 1,need 2,need 1', (await needs()).join(','))
check('and so does the total', /4 to get/.test(await buyChip()) && /\$29\.00/.test(await buyChip()),
  await buyChip())

console.log('\nIt is remembered')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await openDeck()
check('ownership survives a reload', /4 to get/.test(await buyChip()), await buyChip())

console.log('\nOwning the whole deck')
await page.locator('.chip', { hasText: /to get/ }).click()
await page.waitForTimeout(700)
check('nothing is left to buy', /own this deck/i.test(await buyChip()), await buyChip())
check('and no row asks for anything', (await needs()).length === 0, (await needs()).join(','))

console.log('\nPrintings')
// The deck lists ring-bbd; owning it was recorded against the oracle card, so
// a different printing of Sol Ring has to count as the same card.
const otherPrinting = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  return Object.keys(raw.collection ?? {})
})
check('ownership is stored per card, not per printing',
  otherPrinting.includes('o-ring') && !otherPrinting.includes('ring-bbd'),
  otherPrinting.join(', '))

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
