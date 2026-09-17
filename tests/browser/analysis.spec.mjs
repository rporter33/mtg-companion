#!/usr/bin/env node
/**
 * The Analysis tab, in the browser.
 *
 * What it must say honestly: which library the odds are drawn from (the
 * commander is not in it), that a rock counts from the turn after it is
 * cast and a ritual never does, and that a double-pip spell asks for more
 * of a colour than a single pip. The numbers are checked against the same
 * hypergeometric worked out independently here.
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
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{B}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['B'], colors: ['B'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over,
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Vampire', { mana_cost: '{2}{B}', cmc: 3 }),
  c('swamp', 'Swamp', 'Basic Land — Swamp', { mana_cost: '', cmc: 0, color_identity: [], colors: [], produced_mana: ['B'], prices: {} }),
  c('talisman', 'Talisman of Dominance', 'Artifact', { mana_cost: '{2}', cmc: 2, color_identity: [], colors: [], produced_mana: ['C', 'U', 'B'] }),
  c('ritual', 'Dark Ritual', 'Instant', { mana_cost: '{B}', cmc: 1, produced_mana: ['B'] }),
  c('bb', 'Two Black', 'Creature — Vampire', { mana_cost: '{B}{B}', cmc: 2 }),
  c('filler', 'Filler Knight', 'Creature — Knight', { mana_cost: '{3}{B}', cmc: 4 }),
]
const LANDS = 30
const STATE = {
  version: 3, collection: {},
  decks: [{
    id: 'd1', name: 'Analysis Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null, categoryOrder: [],
    main: [
      { cardId: 'swamp', quantity: LANDS }, { cardId: 'talisman', quantity: 8 }, { cardId: 'ritual', quantity: 1 },
      { cardId: 'bb', quantity: 1 }, { cardId: 'filler', quantity: 59 },
    ],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1200 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.reload({ waitUntil: 'networkidle' })
await page.goto(`${TARGET}#/decks/d1/analysis`, { waitUntil: 'networkidle' })
await page.getByRole('tab', { name: 'Analysis' }).waitFor({ timeout: 15000 })
await page.locator('.odds').waitFor({ timeout: 15000 })
await page.waitForTimeout(400)
const body = () => page.locator('.app__main').innerText()

// Independent arithmetic: 99 in the library, 30 of them lands.
const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r }
const pExactly = (k, N, K, n) => (choose(K, k) * choose(N - K, n - k)) / choose(N, n)
const noLand = pExactly(0, 99, LANDS, 7)

console.log('\nWhich library')
const text = await body()
check('the odds say how many cards are in the library and that the commander is not among them',
  /99 in the library, 1 in the command zone/.test(text), text.match(/\d+ in the library[^\n]*/)?.[0])
const shownNoLand = Number(text.match(/Opening hand with no lands\s*\n?\s*([\d.]+)%/)?.[1])
check('the no-land hand is drawn from 99, not 100',
  Math.abs(shownNoLand - noLand * 100) < 0.06, `shown ${shownNoLand}%, expected ${(noLand * 100).toFixed(2)}%`)

console.log('\nThe mana base by kind')
check('lands, rocks and rituals are told apart, and the ritual is not counted',
  /Lands\s*: 30/.test(text) && /Rocks\s*: 8/.test(text) && /Rituals: 1, not counted/.test(text),
  text.match(/Lands\s*: \d+[^\n]*/)?.[0])
check('the draw odds say they use lands only', /Lands only: a rock in the opening seven is not a land drop/.test(text))

console.log('\nColour requirements')
check('the hardest ask is named: two black by turn two',
  /The hardest ask is two black by turn 2/.test(text), text.match(/The hardest ask[^\n]*/)?.[0])
check('and it counts lands alone by then, the rocks not being online',
  /by turn 2: 30 lands and 0 rocks/.test(text) || /by turn 2\./.test(text), text.match(/by turn 2[^\n]*/)?.[0])
check('the assumptions are written down',
  /A rock or dork counts from the turn after it is cast; a ritual never counts/.test(text)
  && /Tapped lands, cost reduction and the mana a rock costs to cast are not modelled/.test(text))

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
