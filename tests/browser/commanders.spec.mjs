#!/usr/bin/env node
/**
 * The Commanders guide on Learn hands a commander to a new deck: "Build with
 * this" makes a Commander deck with that card already seated, in the
 * printing the guide showed, opened on its list, and the hand-over is spent
 * so nothing else picks it up.
 *
 * Scryfall is mocked. The set list names one released set with no curated
 * theme, its commander search answers a single legend in a showcase
 * printing, and a lookup by name would answer a different printing, so a
 * deck that came to hold the card by name rather than by id shows it.
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
const NAME = 'Guide Test Legend'
const printing = (id, over = {}) => ({
  object: 'card', id, oracle_id: 'o-guide-test-legend', name: NAME,
  mana_cost: '{2}{G}{W}', cmc: 4, type_line: 'Legendary Creature — Elf Warrior', oracle_text: '',
  color_identity: ['G', 'W'], colors: ['G', 'W'], rarity: 'mythic', set: 'tcr', set_name: 'Test Commanders',
  legalities: { commander: 'legal' }, prices: { usd: '3.00' },
  image_uris: { small: PNG, normal: PNG, art_crop: PNG }, ...over,
})
const SHOWCASE = printing('guide-legend-showcase', { collector_number: '301', frame_effects: ['showcase'] })
const PLAIN = printing('guide-legend-plain', { collector_number: '12' })

const byName = []
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1200 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

// Registered first on purpose: Playwright gives precedence to the route added
// last, so a catch-all at the bottom would swallow every specific mock above it.
await page.route('**/api.scryfall.com/**', (route) => json(route, { object: 'list', data: [] }))
await page.route('**/api.scryfall.com/sets', (route) => json(route, { object: 'list', data: [
  { code: 'tcr', name: 'Test Commanders', released_at: '2020-01-01', set_type: 'expansion', icon_svg_uri: '', card_count: 1, digital: false },
] }))
await page.route('**/api.scryfall.com/cards/search**', (route) => {
  const q = new URL(route.request().url()).searchParams.get('q') ?? ''
  const data = /^set:tcr is:commander/.test(q) ? [SHOWCASE] : []
  return json(route, { object: 'list', data, total_cards: data.length, has_more: false })
})
await page.route('**/api.scryfall.com/cards/named**', (route) => {
  byName.push(route.request().url())
  return json(route, PLAIN)
})
await page.route('**/api.scryfall.com/cards/collection', (route) => {
  const { identifiers } = JSON.parse(route.request().postData() ?? '{"identifiers":[]}')
  const all = [SHOWCASE, PLAIN]
  const data = []
  const notFound = []
  for (const want of identifiers) {
    if (want.name) byName.push(want.name)
    const hit = all.find((c) => c.id === want.id) ?? (want.name === NAME ? PLAIN : null)
    if (hit) data.push(hit)
    else notFound.push(want)
  }
  return json(route, { object: 'list', data, not_found: notFound })
})

const body = () => page.locator('main').innerText()
const hash = () => page.evaluate(() => location.hash)
const decks = () => page.evaluate(() => Object.keys(localStorage)
  .filter((k) => k.startsWith('mtg-companion:v1:deck:') && !k.endsWith(':corrupt'))
  .map((k) => JSON.parse(localStorage.getItem(k))))

await page.goto(`${TARGET}#/guide`, { waitUntil: 'networkidle' })
const build = page.getByRole('button', { name: 'Build with this' })
await build.waitFor({ timeout: 10000 }).catch(() => {})

console.log('\nThe guide')
check('the Commanders guide shows the set\'s commander with a way to build around it',
  (await build.count()) === 1 && /Guide Test Legend/.test(await body()), (await body()).slice(0, 300))
check('no deck exists yet', (await decks()).length === 0, String((await decks()).length))

await build.click()
await page.waitForTimeout(1200)

console.log('\nThe deck it makes')
const made = await decks()
check('one Commander deck exists, named after the commander',
  made.length === 1 && made[0].formatId === 'commander' && made[0].name === `${NAME} deck`,
  JSON.stringify(made.map((d) => [d.name, d.formatId])))
check('the commander is seated, in the printing the guide showed',
  JSON.stringify(made[0]?.commanders) === JSON.stringify([SHOWCASE.id]), JSON.stringify(made[0]?.commanders))
check('and nothing else was added with it', made[0]?.main?.length === 0 && made[0]?.sideboard?.length === 0,
  JSON.stringify({ main: made[0]?.main, sideboard: made[0]?.sideboard }))
check('it opens on the list, not on Import / export', new RegExp(`^#/decks/${made[0]?.id}$`).test(await hash()), await hash())
check('the List tab is the one selected',
  (await page.getByRole('tab', { name: 'List', exact: true }).getAttribute('aria-selected')) === 'true')
check('the editor holds the new deck', (await page.locator('.deck-title').inputValue()) === `${NAME} deck`)
const seat = page.locator('section[data-section="Commander"]')
check('the list leads with the commander, loaded',
  (await seat.count()) === 1 && /Guide Test Legend/.test(await seat.innerText()) && !/Card not loaded/.test(await seat.innerText()),
  (await seat.count()) ? await seat.innerText() : (await body()).slice(0, 400))
check('the deck is not told it needs a commander', !/needs a commander/.test(await body()),
  (await body()).match(/[^\n]*needs a commander[^\n]*/)?.[0])
check('the card was never looked up by name', byName.length === 0, byName.join(' | '))

console.log('\nThe hand-over is spent')
await page.getByRole('tab', { name: 'Import / export' }).click()
await page.waitForTimeout(600)
check('Import / export has nothing waiting in it',
  !/Loaded "/.test(await body()) && (await page.getByLabel('Decklist to import').inputValue()) === '',
  (await body()).match(/Loaded "[^\n]*/)?.[0])
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
check('a reload keeps the commander and makes no second deck',
  (await decks()).length === 1 && JSON.stringify((await decks())[0].commanders) === JSON.stringify([SHOWCASE.id]),
  JSON.stringify((await decks()).map((d) => [d.name, d.commanders])))
await page.getByRole('button', { name: 'Learn', exact: true }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Decks', exact: true }).click()
await page.waitForTimeout(600)
check('going back to Decks makes no second deck either', (await decks()).length === 1, String((await decks()).length))

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
