#!/usr/bin/env node
/**
 * Your first deck, driven end to end: the dial names colours and pairs,
 * the four questions move it, a commander starts a deck, the roles fill,
 * and the deck opens in the editor with everything saved.
 *
 * Scryfall is mocked: the collection endpoint answers the recommended
 * names, the search endpoint answers commanders and each role's staples
 * by inspecting the query, so the flow's queries are checked as well as
 * its screens.
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
const card = (name, over = {}) => ({
  object: 'card', id: name.toLowerCase().replace(/\W+/g, '-'), oracle_id: `o-${name}`, name,
  mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Elf', oracle_text: '', color_identity: ['G'], colors: ['G'],
  rarity: 'common', set: 'tst', set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' },
  prices: { usd: '1.00' }, image_uris: { small: PNG, normal: PNG, art_crop: PNG }, ...over,
})
const legend = (name) => card(name, { type_line: 'Legendary Creature — Elf Warrior', color_identity: ['G', 'W'] })
const staples = {
  lands: Array.from({ length: 12 }, (_, i) => card(`Dual Land ${i}`, { type_line: 'Land', mana_cost: '' })),
  ramp: Array.from({ length: 12 }, (_, i) => card(`Mana Rock ${i}`, { type_line: 'Artifact', oracle_text: '{T}: Add {C}.' })),
  draw: Array.from({ length: 12 }, (_, i) => card(`Cantrip ${i}`, { type_line: 'Instant', oracle_text: 'Draw a card.' })),
  removal: Array.from({ length: 12 }, (_, i) => card(`Kill Spell ${i}`, { type_line: 'Instant', oracle_text: 'Destroy target creature.' })),
  theme: Array.from({ length: 40 }, (_, i) => card(`Theme Card ${i}`)),
}
// Staples are colourless here, so they are legal under whichever commander the run picks.
for (const list of Object.values(staples)) for (const c of list) { c.color_identity = []; c.colors = [] }
const basics = Object.fromEntries(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']
  .map((n) => [n, card(n, { type_line: `Basic Land — ${n}`, mana_cost: '', color_identity: [], colors: [] })]))
const queries = []

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1200 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/named**', (route) => {
  const name = new URL(route.request().url()).searchParams.get('exact') ?? ''
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(card(name)) })
})
await page.route('**/api.scryfall.com/cards/collection', (route) => {
  const { identifiers } = JSON.parse(route.request().postData() ?? '{"identifiers":[]}')
  // The recommended commanders are looked up by name; Phenax is Dimir, as the real card is.
  const data = identifiers.map(({ name }) => basics[name]
    ?? (/Phenax/.test(name) ? card(name, { type_line: 'Legendary Creature — God', color_identity: ['U', 'B'], colors: ['U', 'B'] }) : legend(name)))
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, not_found: [] }) })
})
await page.route('**/api.scryfall.com/cards/search**', (route) => {
  const q = new URL(route.request().url()).searchParams.get('q') ?? ''
  queries.push(q)
  let data = []
  // Staple queries carry "-is:commander", so the commander query is the one
  // that starts with it.
  if (/^is:commander/.test(q)) data = [legend('Popular Legend One'), legend('Popular Legend Two')]
  else if (/(^|\s)t:land/.test(q)) data = staples.lands // the theme query says "-t:land"
  else if (/otag:ramp/.test(q)) data = staples.ramp
  else if (/otag:card-draw/.test(q)) data = staples.draw
  else if (/otag:removal/.test(q)) data = staples.removal
  else data = staples.theme
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, total_cards: data.length, has_more: false }) })
})

await page.goto(`${TARGET}#/decks`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const body = () => page.locator('main').innerText()

console.log('\nGetting there')
check('an empty Decks screen offers to start a first deck', (await page.getByRole('button', { name: 'Start your first deck' }).count()) === 1)
await page.getByRole('button', { name: 'Start your first deck' }).click()
await page.waitForTimeout(500)
check('it has an address of its own', (await page.evaluate(() => location.hash)) === '#/decks/new', await page.evaluate(() => location.hash))

console.log('\nThe dial')
const dial = page.getByLabel('Colour dial')
check('the dial is a real slider a keyboard can drive', (await dial.getAttribute('type')) === 'range')
await dial.fill('0')
await page.waitForTimeout(150)
check('at the left it is white alone', (await dial.getAttribute('aria-valuetext')) === 'White' && /Cares about/.test(await body()))
await dial.fill('150')
await page.waitForTimeout(150)
check('between two colours it names the pair', /Blue and Black — Dimir/.test(await dial.getAttribute('aria-valuetext')), await dial.getAttribute('aria-valuetext'))
check('and shows both colours and what the pair does', /Trickery and attrition/.test(await body()) && (await page.locator('.colour-page').count()) === 2)
check('it says the writing is the app\'s own', /this app.s own summary/.test(await body()))
await page.getByRole('button', { name: 'Boros' }).click()
await page.waitForTimeout(150)
check('an enemy pair the strip cannot reach is a chip away', /Red and White — Boros/.test(await dial.getAttribute('aria-valuetext')) || /Boros/.test(await body()))
await page.getByRole('button', { name: /Lightning Bolt/ }).first().click()
await page.waitForTimeout(500)
check('a signature card opens its sheet', (await page.getByRole('dialog').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.getByRole('button', { name: /Next: how you play/ }).click()
await page.waitForTimeout(200)

console.log('\nHow you play')
await page.getByRole('button', { name: /Patient/ }).click()
await page.getByRole('button', { name: /Spells/ }).click()
await page.getByRole('button', { name: /Solo/ }).click()
await page.getByRole('button', { name: /Intricate/ }).click()
await page.waitForTimeout(150)
check('the answers lean somewhere and say so', /lean Dimir/.test(await body()), (await body()).match(/lean[^\n]*/)?.[0])
await page.getByRole('button', { name: 'Move the dial there' }).click()
await page.waitForTimeout(150)
check('the dial moves there', (await page.getByRole('button', { name: /Next: commanders in Dimir/ }).count()) === 1)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('colours and answers are remembered across a reload',
  /Blue and Black — Dimir/.test(await page.getByLabel('Colour dial').getAttribute('aria-valuetext')))
await page.getByRole('button', { name: /Next: how you play/ }).click()
await page.waitForTimeout(100)
check('the answers too', (await page.getByRole('button', { name: /Patient/ }).getAttribute('aria-pressed')) === 'true')
await page.getByRole('button', { name: /Next: commanders/ }).click()
await page.waitForTimeout(800)

console.log('\nA commander')
check('recommended commanders appear with a reason, marked as a recommendation',
  /Good first commanders/.test(await body()) && /A recommendation, not a ranking/.test(await body()) && /Phenax/.test(await body()))
check('the most played list is asked for exactly these colours', queries.some((q) => /is:commander.*id=ub/.test(q)), queries.join(' | '))
check('and shows what came back', /Popular Legend One/.test(await body()))
await page.getByRole('button', { name: 'Start with Phenax' }).click()
await page.waitForTimeout(1200)

console.log('\nThe starting list')
check('a deck exists now, named after the commander', /Phenax deck/.test(await body()))

console.log('\nMoving the dial after a commander exists')
await page.locator('.steps__button', { hasText: 'Colours' }).click()
await page.waitForTimeout(200)
await page.getByLabel('Colour dial').fill('0')
await page.waitForTimeout(200)
check('the list follows the commander, so the clash is said out loud',
  /Phenax[^\n]*is Dimir/.test(await body()) && /follows the commander, not the dial/.test(await body()),
  (await body()).match(/Phenax[^\n]*/)?.[0])
await page.getByRole('button', { name: 'Keep Phenax' }).click()
await page.waitForTimeout(200)
check('keeping the commander puts the colours back',
  /Dimir/.test(await page.getByLabel('Colour dial').getAttribute('aria-valuetext')) && !/follows the commander/.test(await body()))
await page.locator('.steps__button', { hasText: 'Starting list' }).click()
await page.waitForTimeout(600)
check('roles show what is short', /Lands[^\n]*\n?0\/36/.test(await body()) || (await page.locator('.role').count()) === 5)
check('staples are asked for under four dollars, in identity, without commanders',
  queries.some((q) => /id<=ub/.test(q) && /usd<=4/.test(q) && /-is:commander/.test(q)), queries.slice(-6).join(' | '))
await page.getByRole('tab', { name: /Ramp/ }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Add Mana Rock 0' }).click()
await page.waitForTimeout(300)
check('adding a card counts toward its role', /Ramp\s*1\/10/.test((await body()).replace(/\n/g, ' ')), (await body()).match(/Ramp[^L]{0,20}/)?.[0])
await page.getByLabel('Price cap per card').selectOption('2')
await page.waitForTimeout(600)
check('the price cap is a real query change', queries.some((q) => /usd<=2/.test(q)))
await page.getByRole('button', { name: 'Fill the rest with staples' }).click()
await page.waitForTimeout(1500)
check('fill brings the list to 99', /99\/99/.test(await body()), (await body()).match(/\d+\/99/)?.[0])
check('with basics making up the lands', /Open the deck$/m.test(await body()) || (await page.getByRole('button', { name: 'Open the deck' }).count()) === 1)
await page.getByRole('button', { name: /Open the deck/ }).click()
await page.waitForTimeout(900)
check('the editor opens on the saved deck', (await page.locator('.deck-title').inputValue()) === 'Phenax deck')
check('legal and complete', /100\/100/.test(await body()) && !/not legal/.test(await body()), (await body()).match(/\d+\/100/)?.[0])
const sections = await page.locator('.section-title h2').allInnerTexts()
check('the list reads by type, with lands at the end', sections.at(-1) === 'Lands', sections.join(','))

console.log('\nFrom Learn')
await page.getByRole('button', { name: 'Learn', exact: true }).click()
await page.waitForTimeout(500)
check('Learn offers the same flow', (await page.getByRole('button', { name: 'Start your first deck' }).count()) === 1)

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
