#!/usr/bin/env node
/**
 * Browser checks for deck import and the commanders browser.
 *
 * The important assertion is a negative one: pasting a Moxfield link must not
 * cause a request to Moxfield. The app has no backend and Moxfield publishes no
 * browser-readable API, so the honest behaviour is to explain the Export route
 * rather than attempt something that cannot work.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const card = (name, over = {}) => ({
  object: 'card', id: name.toLowerCase().replace(/\W+/g, '-'), oracle_id: `o-${name}`,
  name, mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Bear', oracle_text: '',
  color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'fra', set_name: 'Reality Fracture',
  legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over,
})

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } })
const errors = []
const requestedHosts = new Set()
page.on('pageerror', (e) => errors.push(e.message))
page.on('request', (r) => {
  try { requestedHosts.add(new URL(r.url()).hostname) } catch { /* ignore */ }
})

await page.route('**/api.scryfall.com/sets', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', data: [
    { code: 'fra', name: 'Reality Fracture', released_at: '2026-10-02', set_type: 'expansion',
      icon_svg_uri: '', card_count: 291, digital: false },
    { code: 'hob', name: 'The Hobbit', released_at: '2026-08-14', set_type: 'expansion',
      icon_svg_uri: '', card_count: 281, digital: false },
  ] }) }))
await page.route('**/api.scryfall.com/cards/search**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', total_cards: 2, has_more: false, data: [
    card('Test Commander One', { type_line: 'Legendary Creature — Elf' }),
    card('Test Commander Two', { type_line: 'Legendary Creature — Bear' }),
  ] }) }))
await page.route('**/api.scryfall.com/cards/named**', (route) => {
  const name = new URL(route.request().url()).searchParams.get('fuzzy')
    ?? new URL(route.request().url()).searchParams.get('exact')
  if (/nonexistent/i.test(name ?? '')) {
    return route.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ object: 'error', status: 404, details: 'No card found' }) })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(card(name)) })
})
await page.route('**/api.scryfall.com/cards/autocomplete**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: ['Nonexistent Suggestion A', 'Nonexistent Suggestion B'] }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

console.log('\nCommanders browser')
check('it lists commanders from the newest sets',
  (await page.locator('.commander').count()) >= 2,
  String(await page.locator('.commander').count()))
const setChips = await page.locator('.commander-grid').count()
check('both the upcoming and current set are offered',
  (await page.getByRole('button', { name: 'Reality Fracture' }).count()) >= 1
  && (await page.getByRole('button', { name: 'The Hobbit' }).count()) >= 1)
check('it says no example lists ship yet rather than pretending',
  /No example decklists are shipped yet/.test(await page.locator('body').innerText()))

console.log('\nStarting a deck from a commander')
await page.locator('.commander .btn').first().click()
await page.waitForTimeout(700)
check('it creates a deck and opens it',
  (await page.locator('.deck-title').count()) === 1,
  await page.locator('.deck-title').inputValue().catch(() => 'no title field'))

console.log('\nPasting a Moxfield link')
await page.getByRole('tab', { name: 'Import / export' }).click()
await page.waitForTimeout(300)
const box = page.locator('textarea').first()
await box.fill('https://moxfield.com/decks/JAJNhQHxg0qfdq4ULGcj5g')
await page.waitForTimeout(300)
const body = await page.locator('body').innerText()
check('it names the site and says why it cannot read it',
  /Moxfield does not let other sites read decks/.test(body), body.slice(0, 200))
check('it says exactly which button to press instead', /Export/.test(body))
check('the import button is disabled rather than failing on press',
  await page.getByRole('button', { name: /Review import|Fetch this deck/ }).isDisabled())
check('no request was made to moxfield',
  ![...requestedHosts].some((h) => /moxfield/.test(h)),
  [...requestedHosts].join(', '))

console.log('\nPreview before anything is written')
await box.fill('2 Test Card\n1 Nonexistent Card')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Review import' }).click()
await page.waitForTimeout(1200)
check('it shows what will land before writing', /Before anything is added/.test(await page.locator('body').innerText()))
check('it reports the card it could not find',
  (await page.locator('.chip--warn').filter({ hasText: 'not found' }).count()) === 1)
check('it offers close matches for the failure',
  (await page.getByRole('button', { name: /Nonexistent Suggestion/ }).count()) >= 1)

const before = await page.locator('.deck-row').count()
check('nothing has been added to the deck yet', before === 0, String(before))

await page.getByRole('button', { name: /Add \d+ cards/ }).click()
await page.waitForTimeout(600)
await page.getByRole('tab', { name: 'List' }).click()
await page.waitForTimeout(400)
check('confirming adds the cards', (await page.locator('.deck-row').count()) > 0)

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
