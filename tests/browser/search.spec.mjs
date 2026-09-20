#!/usr/bin/env node
/**
 * Browser checks for search filters, sorting and paging.
 *
 * Scryfall is intercepted, and every request is recorded. What matters is not
 * what the UI displays but what it actually *asked for* — a filter chip that
 * looks active while the query went out without it is the failure mode this
 * whole design exists to prevent.
 *
 *   node tests/browser/search.spec.mjs [url]
 */

import { chromium } from 'playwright'

// Not named URL: that would shadow the global URL constructor used below.
const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const card = (i, over = {}) => ({
  object: 'card', id: `card-${i}`, oracle_id: `o-${i}`, name: `Test Card ${i}`,
  mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Bear', oracle_text: '',
  color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst', set_name: 'Test Set',
  legalities: { modern: 'legal', commander: 'legal' }, prices: { usd: '1.00' },
  image_uris: { normal: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' },
  ...over,
})

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
const page = await ctx.newPage()
const errors = []
const requests = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**/api.scryfall.com/cards/search**', (route) => {
  const url = new URL(route.request().url())
  const params = url.searchParams
  requests.push({ q: params.get('q'), order: params.get('order'), dir: params.get('dir'), page: params.get('page') })
  const pageNum = Number(params.get('page') ?? 1)
  route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      object: 'list',
      data: Array.from({ length: 3 }, (_, i) => card(pageNum * 10 + i)),
      total_cards: 9, has_more: pageNum < 3,
    }),
  })
})
await page.route('**/api.scryfall.com/sets', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [] }) }))

const lastQuery = () => requests[requests.length - 1]?.q ?? ''
/**
 * Does something that searches, and waits for the search to leave the page.
 * The client holds searches half a second apart, the spacing Scryfall asks
 * for, so a fixed wait after a click races the queue and reads the request
 * before it. Waiting for the request itself, then a beat for the render,
 * does not.
 */
const search = async (act, list = requests) => {
  const was = list.length
  await act()
  const t0 = Date.now()
  while (list.length === was && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50))
  await new Promise((r) => setTimeout(r, 250))
}
const queryBox = () => page.getByLabel('Search cards')

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Cards', exact: true }).click()
await page.waitForTimeout(300)

console.log('\nFilters compose into the query')
await queryBox().fill('bolt')
await search(() => page.getByRole('button', { name: 'Search' }).click())
check('a plain search sends the text', lastQuery() === 'bolt', lastQuery())

await page.getByRole('button', { name: /^Filters/ }).click()
await page.waitForTimeout(200)
await search(() => page.getByRole('button', { name: 'Red', exact: true }).first().click())
check('picking red rewrites the query', lastQuery() === 'bolt c>=r', lastQuery())
check('the box shows the composed query', (await queryBox().inputValue()) === 'bolt c>=r',
  await queryBox().inputValue())

await search(() => page.getByRole('button', { name: 'Green', exact: true }).first().click())
check('a second colour is added in WUBRG order', lastQuery() === 'bolt c>=rg', lastQuery())

await search(() => page.getByRole('button', { name: 'Exactly' }).first().click())
check('changing the mode changes the operator', lastQuery() === 'bolt c=rg', lastQuery())

console.log('\nHand-edited queries flow back into the controls')
await queryBox().fill('t:goblin c<=ur is:commander')
await search(() => page.getByRole('button', { name: 'Search' }).click())
check('blue and red read as pressed',
  (await page.getByRole('button', { name: 'Blue', exact: true }).first().getAttribute('aria-pressed')) === 'true'
  && (await page.getByRole('button', { name: 'Red', exact: true }).first().getAttribute('aria-pressed')) === 'true')
check('"At most" reads as selected',
  (await page.getByRole('button', { name: 'At most' }).first().getAttribute('class')).includes('chip--active'))

// The property the whole design rests on.
await search(() => page.getByRole('button', { name: 'White', exact: true }).first().click())
check('an unmodelled operator survives a filter change',
  lastQuery().includes('is:commander'), lastQuery())
check('the typed type filter survives too', lastQuery().includes('t:goblin'), lastQuery())

console.log('\nSorting re-queries the server')
const before = requests.length
await search(() => page.getByLabel('Sort results by').selectOption('usd'))
check('changing sort issues a request', requests.length > before)
check('it asks Scryfall to sort, not the client',
  requests[requests.length - 1].order === 'usd', JSON.stringify(requests[requests.length - 1]))

await search(() => page.getByRole('button', { name: /Sort (ascending|descending)/ }).click())
check('direction is sent', ['asc', 'desc'].includes(requests[requests.length - 1].dir),
  JSON.stringify(requests[requests.length - 1]))

console.log('\nPaging')
await queryBox().fill('bears')
await search(() => page.getByRole('button', { name: 'Search' }).click())
const firstCount = await page.locator('.card-grid > *').count()
check('first page renders', firstCount === 3, String(firstCount))

await search(() => page.getByRole('button', { name: /Load more/ }).click())
check('load more appends rather than replacing',
  (await page.locator('.card-grid > *').count()) === 6,
  String(await page.locator('.card-grid > *').count()))
check('it requests the next page', requests[requests.length - 1].page === '2',
  JSON.stringify(requests[requests.length - 1]))
check('load more keeps the same sort order',
  requests[requests.length - 1].order === 'usd', JSON.stringify(requests[requests.length - 1]))

console.log('\nClearing')
// Set something to clear first: the button only exists while a control is on,
// which is itself the correct behaviour.
await queryBox().fill('bears c=g t:creature is:commander')
await search(() => page.getByRole('button', { name: 'Search' }).click())
check('"Clear filters" appears once a control is set',
  (await page.getByRole('button', { name: 'Clear filters' }).count()) === 1)

await search(() => page.getByRole('button', { name: 'Clear filters' }).click())
check('clearing drops the colour filter', !lastQuery().includes('c='), lastQuery())
check('clearing drops the type filter', !lastQuery().includes('t:creature'), lastQuery())
check('clearing keeps the free text', lastQuery().includes('bears'), lastQuery())
check('clearing keeps unmodelled operators, which no control owns',
  lastQuery().includes('is:commander'), lastQuery())

console.log('\nDeck search scopes to the commander')
// A fresh context, because the query cache would otherwise serve repeats and
// there would be no request to inspect.
const deckCtx = await browser.newContext({ viewport: { width: 420, height: 900 } })
const deckPage = await deckCtx.newPage()
const deckRequests = []
deckPage.on('pageerror', (e) => errors.push(e.message))

const commander = card(99, {
  id: 'cmdr', name: 'Test Commander', type_line: 'Legendary Creature — Elf',
  color_identity: ['G', 'U'], colors: ['G', 'U'], legalities: { commander: 'legal' },
})
await deckPage.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: [commander] }) }))
await deckPage.route('**/api.scryfall.com/cards/search**', (route) => {
  deckRequests.push(new URL(route.request().url()).searchParams.get('q'))
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ object: 'list', data: [], total_cards: 0, has_more: false }) })
})
await deckPage.route('**/api.scryfall.com/sets', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [] }) }))

await deckPage.goto(TARGET, { waitUntil: 'networkidle' })
await deckPage.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 1,
  decks: [{ id: 'd1', name: 'Simic Deck', formatId: 'commander', commanders: ['cmdr'],
    signatureSpell: null, main: [], sideboard: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { currency: 'usd', showCardImages: true, lastFormat: 'commander', sortId: 'name', sortDir: null },
})))
await deckPage.reload({ waitUntil: 'networkidle' })
await deckPage.getByRole('button', { name: 'Decks', exact: true }).click()
await deckPage.waitForTimeout(400)
await deckPage.locator('.deck-card__open').first().click()
await deckPage.waitForTimeout(700)
await deckPage.getByRole('tab', { name: 'Add cards' }).click()
await deckPage.waitForTimeout(400)

const chip = await deckPage.locator('.scope-chip').textContent().catch(() => null)
check('a visible chip says the search is scoped', /Test Commander/.test(chip ?? ''), chip)

await deckPage.getByLabel('Search cards to add').fill('ramp')
await search(() => deckPage.getByRole('button', { name: 'Search' }).click(), deckRequests)
check('the commander\'s colour identity is applied',
  deckRequests.at(-1) === 'ramp legal:commander id<=ug', deckRequests.at(-1))

await search(() => deckPage.locator('.scope-chip button').click(), deckRequests)
check('removing the chip re-runs without the identity scope',
  deckRequests.at(-1) === 'ramp legal:commander', deckRequests.at(-1))

// Toggling format scope proves the identity setting survived the round trip:
// a stale closure here would send the value the user just changed away from.
await search(() => deckPage.getByLabel(/Legal in Commander/).uncheck(), deckRequests)
check('unchecking format scope re-runs immediately, without a stale value',
  deckRequests.at(-1) === 'ramp', deckRequests.at(-1))

await deckCtx.close()

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
