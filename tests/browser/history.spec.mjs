#!/usr/bin/env node
/**
 * Deck history, in the browser.
 *
 * Two properties matter. A restore has to be reversible — the list you leave
 * must be one restore away — and an import has to checkpoint the list it is
 * about to overwrite, because that is the one edit a player cannot undo by
 * editing back.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const c = (id, name, type_line, usd = '1.00') => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' },
  prices: { usd }, purchase_uris: {},
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf', '25.00'),
  c('ring', 'Sol Ring', 'Artifact', '2.00'),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid', '1.00'),
  c('bolt', 'Lightning Bolt', 'Instant', '3.00'),
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1300 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', async (route) => {
  // Serves both the id lookup the editor makes and the name lookup an import makes.
  const body = JSON.parse(route.request().postData() ?? '{"identifiers":[]}')
  const wanted = body.identifiers.map((i) => i.id ?? i.name)
  const data = CARDS.filter((card) => wanted.includes(card.id) || wanted.includes(card.name))
  const not_found = wanted.filter((w) => !data.some((card) => card.id === w || card.name === w)).map((name) => ({ name }))
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, not_found }) })
})

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 3, collection: {},
  decks: [{
    id: 'd1', name: 'History Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'ring', quantity: 1 }, { cardId: 'elf', quantity: 4 }],
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
const tab = async (name) => { await page.getByRole('tab', { name }).click(); await page.waitForTimeout(400) }
const versions = () => page.locator('.version').count()
const rowFor = (name) => page.locator('.deck-row').filter({ has: page.locator('.deck-row__name', { hasText: name }) })

await openDeck()

console.log('\nMigration into a deck with no history')
check('the history tab exists', (await page.getByRole('tab', { name: 'History' }).count()) === 1)
await tab('History')
check('a deck from before versions existed has an empty history, not a crash',
  (await versions()) === 0 && /No versions yet/.test(await page.locator('.app__main').innerText()))

console.log('\nSaving a version')
await page.getByLabel('Version label').fill('Before cutting elves')
await page.getByRole('button', { name: 'Save version' }).click()
await page.waitForTimeout(500)
check('the version appears', (await versions()) === 1)
check('with its label', /Before cutting elves/.test(await page.locator('.version').first().innerText()))
check('and is marked as the current list', /current/.test(await page.locator('.version').first().innerText()))
check('saving again with no change is refused, not duplicated',
  await page.getByRole('button', { name: /No changes since last version/ }).isDisabled())

console.log('\nEditing, then comparing')
await tab('List')
await rowFor('Llanowar Elves').getByRole('button', { name: /One fewer Llanowar Elves/ }).click()
await page.waitForTimeout(300)
await rowFor('Llanowar Elves').getByRole('button', { name: /One fewer Llanowar Elves/ }).click()
await page.waitForTimeout(300)
await rowFor('Sol Ring').getByRole('button', { name: /Remove Sol Ring/ }).click()
await page.waitForTimeout(400)
await tab('History')
check('the saved version is no longer current',
  !/current/.test(await page.locator('.version').first().innerText()))
await page.getByRole('button', { name: 'Compare to now' }).click()
await page.waitForTimeout(400)
const diff = await page.locator('.diff').first().innerText()
check('the diff names what went out', /−\s*Sol Ring/.test(diff), diff.replace(/\n/g, ' | '))
check('and a quantity change as a change, not an add and a remove', /±\s*Llanowar Elves[\s\S]*4 → 2/.test(diff), diff.replace(/\n/g, ' | '))
// Before: 2 + 4 = 6. After: 2 elves = 2. Minus four dollars.
check('and prices the difference', /\$6\.00 → \$2\.00/.test(diff) && /−\$4\.00/.test(diff), diff.replace(/\n/g, ' | '))

console.log('\nRestoring')
await page.getByRole('button', { name: 'Restore', exact: true }).first().click()
await page.waitForTimeout(600)
check('restore checkpoints the list it is leaving, automatically', (await versions()) === 2
  && /Before restore/.test(await page.locator('.version').first().innerText())
  && /auto/.test(await page.locator('.version').first().innerText()),
  String(await versions()))
await tab('List')
check('the old list is back',
  /×?4/.test(await rowFor('Llanowar Elves').innerText()) && (await rowFor('Sol Ring').count()) === 1,
  await page.locator('.deck-rows').first().innerText().then((t) => t.replace(/\n/g, ' | ')))
await tab('History')
await page.locator('.version').first().getByRole('button', { name: 'Restore', exact: true }).click()
await page.waitForTimeout(600)
await tab('List')
check('and restoring the checkpoint undoes the restore', (await rowFor('Sol Ring').count()) === 0)

console.log('\nImporting checkpoints first')
await tab('History')
const before = await versions()
await tab('Import / export')
await page.locator('textarea').first().fill('1 Lightning Bolt')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Review import' }).click()
await page.getByRole('button', { name: /Add \d+ cards/ }).waitFor({ timeout: 15000 })
await page.getByRole('button', { name: /Add \d+ cards/ }).click()
await page.waitForTimeout(700)
await tab('History')
check('an import saves the list it overwrote', (await versions()) === before + 1
  && /Before import/.test(await page.locator('.version').first().innerText()), String(await versions()))

console.log('\nIt survives a reload')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await openDeck()
await tab('History')
check('history is persisted', (await versions()) === before + 1, String(await versions()))

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
