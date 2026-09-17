#!/usr/bin/env node
/**
 * The Add cards tab, as a builder uses it: what the deck still needs, quick
 * filters that write into the query, sorting by what is played and what it
 * costs, and rows that show the value of a pick before it is added.
 *
 * Scryfall is mocked and every request's q, order and dir are recorded, so
 * the chips are checked by what they send, not by what they look like.
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
const c = (id, name, type_line, usd, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line, oracle_text: '',
  color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst', set_name: 'Test', collector_number: '1',
  legalities: { commander: 'legal' }, prices: { usd }, image_uris: { small: PNG, normal: PNG, art_crop: PNG }, ...over,
})
const CMDR = c('cmdr', 'Needs Commander', 'Legendary Creature — Elf', '3.00')
const IN_DECK = c('elf', 'Llanowar Elves', 'Creature — Elf Druid', '0.50', { oracle_text: '{T}: Add {G}.' })
const RESULTS = [
  c('r1', 'Cheap Bear', 'Creature — Bear', '0.25'),
  c('r2', 'Pricey Wurm', 'Creature — Wurm', '12.00'),
  IN_DECK,
  c('r3', 'Owned Ox', 'Creature — Ox', '1.10', { oracle_id: 'o-owned' }),
]
const STATE = {
  version: 4, collection: { 'o-owned': 2 },
  decks: [{
    id: 'd1', name: 'Needs Deck', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null, categoryOrder: [], versions: [],
    main: [{ cardId: 'elf', quantity: 1 }], sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
}
const requests = []

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1200 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: [CMDR, IN_DECK], not_found: [] }) }))
await page.route('**/api.scryfall.com/cards/search**', (route) => {
  const u = new URL(route.request().url())
  requests.push({ q: u.searchParams.get('q'), order: u.searchParams.get('order'), dir: u.searchParams.get('dir') })
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: RESULTS, total_cards: RESULTS.length, has_more: false }) })
})
await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((s) => localStorage.setItem('mtg-companion:v1', JSON.stringify(s)), STATE)
// Reload so the seed is read, then deep-link into the tab. Linking first sends
// the app to the list, rightly, because the deck is not in what it has read.
await page.reload({ waitUntil: 'networkidle' })
await page.goto(`${TARGET}#/decks/d1/add`, { waitUntil: 'networkidle' })
const body = () => page.locator('main').innerText()
const last = () => requests.at(-1) ?? {}

console.log('\nWhat the deck needs')
const needs = page.getByRole('group', { name: 'What this deck still needs' })
// Wait for the editor to be up rather than guessing how long a loaded machine takes.
await page.getByRole('tab', { name: 'Add cards' }).waitFor({ timeout: 15000 })
await needs.waitFor({ timeout: 15000 })
await page.waitForTimeout(300)
check('a strip says where the deck stands by role', /Lands 0\/36/.test(await needs.innerText()) && /Ramp 1\/10/.test(await needs.innerText()), await needs.innerText())
await needs.getByRole('button', { name: /Ramp 1\/10/ }).click()
await page.waitForTimeout(400)
check('pressing a role searches for that role, in the coach\'s wording, scoped to the deck',
  /o:"add \{"/.test(last().q) && /legal:commander/.test(last().q) && /id<=g/.test(last().q), last().q)
check('and the box shows the query it ran, so nothing is hidden', /add \{/.test(await page.getByLabel('Search cards to add').inputValue()))

console.log('\nSorting')
check('results are sorted by how played they are unless asked otherwise', last().order === 'edhrec' && last().dir === 'asc', JSON.stringify(last()))
check('and the results line says so', /sorted by most played/.test(await body()))
await page.getByLabel('Sort results').selectOption('usd')
await page.waitForTimeout(300)
check('choosing price re-runs the search sorted by price', last().order === 'usd' && last().dir === 'asc', JSON.stringify(last()))
await page.getByRole('button', { name: /Sort direction/ }).click()
await page.waitForTimeout(300)
check('the direction button flips it', last().order === 'usd' && last().dir === 'desc', JSON.stringify(last()))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
check('the sort is remembered', (await page.getByLabel('Sort results').inputValue()) === 'usd')

console.log('\nRows show value')
await page.getByLabel('Search cards to add').fill('bear')
await page.getByRole('button', { name: 'Search' }).click()
await page.waitForTimeout(400)
const wurm = page.locator('.search-row', { hasText: 'Pricey Wurm' })
check('each row carries its price', /\$12\.00/.test(await wurm.innerText()), await wurm.innerText())
check('and its type', /Creature — Wurm/.test(await wurm.innerText()))
check('a card already in the deck says so', /1 in deck/.test(await page.locator('.search-row', { hasText: 'Llanowar Elves' }).innerText()))
check('a card you own says so', /own 2/.test(await page.locator('.search-row', { hasText: 'Owned Ox' }).innerText()))
check('the results line totals what is shown', /4 shown/.test(await body()) && /\$13\.85 shown in total/.test(await body()), (await body()).match(/\d+ shown[^\n]*/)?.[0])

console.log('\nQuick filters write into the query')
await page.getByRole('button', { name: 'Creature', exact: true }).click()
await page.waitForTimeout(300)
check('a type chip adds t:creature to the query and re-runs', /t:creature/.test(last().q) && /t:creature/.test(await page.getByLabel('Search cards to add').inputValue()), last().q)
await page.getByRole('button', { name: '≤ $4' }).click()
await page.waitForTimeout(300)
check('a price chip adds the cap', /usd<=4/.test(last().q), last().q)
await page.getByRole('button', { name: '≤ $4' }).click()
await page.waitForTimeout(300)
// The query without the cap was searched a moment ago, so this one is served
// from the cache and no request goes out: the box is the thing to check.
check('pressing it again removes it', !/usd<=/.test(await page.getByLabel('Search cards to add').inputValue()), await page.getByLabel('Search cards to add').inputValue())
const before = requests.length
await page.getByRole('button', { name: 'Not in deck' }).click()
await page.waitForTimeout(200)
check('Not in deck hides the row without another request', (await page.locator('.search-row', { hasText: 'Llanowar Elves' }).count()) === 0 && requests.length === before)
check('and says how many it hid', /1 hidden by Not in deck or Owned/.test(await body()))
await page.getByRole('button', { name: 'Owned', exact: true }).click()
await page.waitForTimeout(200)
check('Owned narrows to your collection', (await page.locator('.search-row').count()) === 1 && /Owned Ox/.test(await body()))
await page.getByRole('button', { name: 'Owned', exact: true }).click()
await page.getByRole('button', { name: 'Not in deck' }).click()

console.log('\nAdding moves the needle')
await page.locator('.search-row', { hasText: 'Cheap Bear' }).getByRole('button', { name: /Add Cheap Bear/ }).click()
await page.waitForTimeout(400)
check('the needs strip updates as cards go in', /Does your thing 1\/33/.test(await needs.innerText()), await needs.innerText())
check('and the total', /3\/100/.test(await needs.innerText()))
check('the added row now says it is in the deck', /1 in deck/.test(await page.locator('.search-row', { hasText: 'Cheap Bear' }).innerText()))
const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
check('nothing scrolls sideways on a phone', wide)

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
