#!/usr/bin/env node
/**
 * Deck sections, in the browser.
 *
 * The subtle one is renaming a section nobody made. Nothing says "Creatures"
 * anywhere — those cards simply are creatures — so the rename has to write the
 * new name onto them or it silently does nothing at all.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const c = (id, name, type_line, prices = { usd: '1.00' }) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices,
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf', { usd: '5.00' }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid'),
  c('bolt', 'Lightning Bolt', 'Instant', { usd: '3.00' }),
  c('ring', 'Sol Ring', 'Artifact', { usd: '2.00' }),
  c('forest', 'Forest', 'Basic Land — Forest', {}),
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1200 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))

const openDeck = async () => {
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.deck-card__open').first().click()
  await page.waitForTimeout(900)
}
const sections = () => page.locator('.section-title h2').allInnerTexts()

await page.goto(TARGET, { waitUntil: 'networkidle' })
// Seeded at version 1 on purpose: this is also the migration path in a browser.
await page.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 1,
  decks: [{
    id: 'd1', name: 'Section Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'elf', quantity: 1 }, { cardId: 'bolt', quantity: 1 },
      { cardId: 'ring', quantity: 1 }, { cardId: 'forest', quantity: 8 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
})))
await page.reload({ waitUntil: 'networkidle' })
await openDeck()

console.log('\nSections a deck gets for free')
check('a deck nobody organised still reads by type',
  (await sections()).join(',') === 'Commander,Creatures,Instants,Artifacts,Lands',
  (await sections()).join(','))
check('lands come last, where people look for them',
  (await sections()).at(-1) === 'Lands')
check('each section carries its own total',
  /\$3\.00/.test(await page.locator('.section-title').filter({ hasText: 'Instants' }).innerText()))

console.log('\nA decklist stays readable')
const clipped = await page.locator('.deck-row__name')
  .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
check('no card name is truncated on a phone', clipped.length === 0, clipped.join(', '))

console.log('\nMoving a card')
await page.locator('.deck-row__category').first().selectOption({ label: 'Artifacts' })
await page.waitForTimeout(600)
check('the card moves to the section chosen',
  (await page.locator('.section-title').filter({ hasText: 'Artifacts' }).innerText()).includes('2'),
  await page.locator('.section-title').filter({ hasText: 'Artifacts' }).innerText())
check('a section with nothing left in it disappears',
  !(await sections()).includes('Creatures'), (await sections()).join(','))

console.log('\nRenaming a section nobody made')
const instants = page.locator('section').filter({ has: page.locator('h2', { hasText: 'Instants' }) })
await instants.getByRole('button', { name: /Edit the Instants section/ }).click()
await page.waitForTimeout(200)
await page.getByRole('textbox', { name: /Rename Instants/ }).fill('Interaction')
await page.getByRole('button', { name: 'Rename', exact: true }).click()
await page.waitForTimeout(600)
check('the rename sticks, even though nothing said "Instants"',
  (await sections()).includes('Interaction'), (await sections()).join(','))
check('and the card went with it',
  (await page.locator('section').filter({ has: page.locator('h2', { hasText: 'Interaction' }) })
    .locator('.deck-row__name').innerText()) === 'Lightning Bolt')

console.log('\nIt survives a reload')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await openDeck()
check('the sections are still there after reload',
  (await sections()).includes('Interaction'), (await sections()).join(','))

console.log('\nDissolving it')
const made = page.locator('section').filter({ has: page.locator('h2', { hasText: 'Interaction' }) })
await made.getByRole('button', { name: /Edit the Interaction section/ }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Dissolve' }).click()
await page.waitForTimeout(600)
check('the cards go back to being filed by type',
  (await sections()).includes('Instants') && !(await sections()).includes('Interaction'),
  (await sections()).join(','))

console.log('\nGrid view')
await page.getByRole('button', { name: 'Grid', exact: true }).click()
await page.waitForTimeout(600)
check('the list becomes tiles', (await page.locator('.deck-tile').count()) > 0
  && (await page.locator('.deck-row').count()) === 0,
  `${await page.locator('.deck-tile').count()} tiles, ${await page.locator('.deck-row').count()} rows`)
check('every tile still carries all three prices',
  (await page.locator('.deck-tile .prices__cell').count())
    === (await page.locator('.deck-tile').count()) * 3)
check('the commander is marked rather than counted',
  (await page.locator('.deck-tile__qty').first().innerText()) === '★')

// The badge sat top-left over the card's own name when there was no image —
// "1|anowar Elves" — which is exactly the state an offline player sees.
const covered = await page.locator('.deck-tile').first().evaluate((tile) => {
  const badge = tile.querySelector('.deck-tile__qty')?.getBoundingClientRect()
  const name = tile.querySelector('[class*="name"]')?.getBoundingClientRect()
  if (!badge || !name) return 'missing'
  return !(badge.bottom < name.top || badge.top > name.bottom)
})
check('the quantity badge does not cover the card name', covered === false, String(covered))

check('it stays on grid after a reload', await (async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await openDeck()
  return (await page.locator('.deck-tile').count()) > 0
})())

await page.getByRole('button', { name: 'List', exact: true }).click()
await page.waitForTimeout(500)
check('and back to a list on request', (await page.locator('.deck-row').count()) > 0)

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
