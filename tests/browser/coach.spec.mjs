#!/usr/bin/env node
/**
 * Browser checks for the deck coach.
 *
 * The scoring is covered by unit tests. What this verifies is the loop that
 * makes the coach useful: it must name a gap, hand you a search that actually
 * finds cards for that gap, and then notice when you have filled it.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const CMDR = {
  object: 'card', id: 'cmdr', oracle_id: 'ocmdr', name: 'Test Commander',
  mana_cost: '{2}{G}{U}', cmc: 4, type_line: 'Legendary Creature — Elf',
  oracle_text: '', color_identity: ['G', 'U'], colors: ['G', 'U'], rarity: 'mythic',
  set: 'tst', set_name: 'Test', legalities: { commander: 'legal' }, prices: { usd: '5.00' },
}
const FOREST = {
  object: 'card', id: 'forest', oracle_id: 'oforest', name: 'Forest',
  mana_cost: '', cmc: 0, type_line: 'Basic Land — Forest', oracle_text: '',
  color_identity: [], colors: [], produced_mana: ['G'], rarity: 'common',
  set: 'tst', set_name: 'Test', legalities: { commander: 'legal' }, prices: {},
}
// Ten DISTINCT removal spells. Commander is singleton, so the add button
// correctly refuses a second copy of the same card — adding ten of one is not
// a thing the app should ever allow.
const REMOVAL = Array.from({ length: 10 }, (_, i) => ({
  object: 'card', id: `kill-${i}`, oracle_id: `okill-${i}`, name: `Test Kill Spell ${i + 1}`,
  mana_cost: '{1}{U}', cmc: 2, type_line: 'Instant',
  oracle_text: 'Destroy target creature.', color_identity: ['U'], colors: ['U'],
  rarity: 'common', set: 'tst', set_name: 'Test',
  legalities: { commander: 'legal' }, prices: { usd: '0.50' },
}))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } })
const errors = []
const searches = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [CMDR, FOREST, ...REMOVAL] }) }))
await page.route('**/api.scryfall.com/cards/search**', (route) => {
  const q = new URL(route.request().url()).searchParams.get('q')
  searches.push(q)
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ object: 'list', data: REMOVAL, total_cards: REMOVAL.length, has_more: false }) })
})
await page.route('**/api.scryfall.com/sets', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [] }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 1,
  decks: [{ id: 'd1', name: 'Coach Test', formatId: 'commander', commanders: ['cmdr'],
    signatureSpell: null, main: [{ cardId: 'forest', quantity: 30 }], sideboard: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { currency: 'usd', showCardImages: true, lastFormat: 'commander', sortId: 'name', sortDir: null },
})))
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Decks', exact: true }).click()
await page.waitForTimeout(400)
await page.locator('.deck-card__open').first().click()
await page.waitForTimeout(700)
await page.getByRole('tab', { name: 'Coach' }).click()
await page.waitForTimeout(400)

console.log('\nIt reports on the deck')
const labels = await page.locator('.coach__label').allTextContents()
for (const expected of ['Deck size', 'Mana sources', 'Answers', 'Card draw', 'Ramp', 'Creatures']) {
  check(`checks ${expected.toLowerCase()}`, labels.includes(expected), labels.join(', '))
}
check('a headline summarises the state',
  ((await page.locator('.coach__headline').textContent()) ?? '').length > 10)

console.log('\nIt explains rather than just scoring')
await page.locator('.coach__row').filter({ hasText: 'Answers' }).click()
await page.waitForTimeout(250)
const why = await page.locator('.coach__why').first().textContent()
check('opening a check gives a reason', /loses to the first threat/.test(why ?? ''), why)

console.log('\nIt hands you a search that finds the right cards')
await page.getByRole('button', { name: /Find answers to add/ }).click()
await page.waitForTimeout(600)
check('it switches to the card search',
  (await page.getByRole('tab', { name: 'Add cards' }).getAttribute('aria-selected')) === 'true')
const last = searches.at(-1) ?? ''
check('the search looks for removal', /destroy target/.test(last), last)
check('the search is scoped to the format', /legal:commander/.test(last), last)
check("the search is scoped to the commander's colours", /id<=/.test(last), last)
check('results are shown', (await page.locator('.deck-row').count()) > 0)

console.log('\nIt notices when the gap is filled')
// Add all ten, one each. The button disables after the first copy of any card,
// which is the singleton rule doing its job.
const addButtons = page.locator('.deck-row .btn--primary')
const available = await addButtons.count()
check('every suggested card can be added once', available >= 10, String(available))
for (let i = 0; i < 10; i++) {
  await addButtons.nth(i).click()
  await page.waitForTimeout(80)
}
check('a second copy is refused in a singleton format',
  await addButtons.first().isDisabled())
await page.getByRole('tab', { name: 'Coach' }).click()
await page.waitForTimeout(500)
await page.locator('.coach__row').filter({ hasText: 'Answers' }).click()
await page.waitForTimeout(250)
const message = await page.locator('.coach__message').first().textContent()
check('the answers check now passes', /Plenty/.test(message ?? ''), message)

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
