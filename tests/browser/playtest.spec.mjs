#!/usr/bin/env node
/**
 * Drawing a hand, in the browser.
 *
 * The property worth guarding is arithmetic that is easy to get wrong and
 * invisible when it is: a Commander deck shuffles ninety-nine, not a hundred,
 * because the commander starts in the command zone. Every number this tab
 * produces is wrong by one card if that slips.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const c = (id, name, type_line) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' },
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf'),
  c('forest', 'Forest', 'Basic Land — Forest'),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid'),
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
    id: 'd1', name: 'Hand Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'forest', quantity: 40 }, { cardId: 'elf', quantity: 59 }],
    sideboard: [], categoryOrder: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { deckView: 'list' },
})))
await page.reload({ waitUntil: 'networkidle' })

const openPlaytest = async () => {
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.deck-card__open').first().click()
  await page.waitForTimeout(900)
  await page.getByRole('tab', { name: 'Playtest' }).click()
  await page.waitForTimeout(400)
}
const chips = () => page.locator('.chip').allInnerTexts()
const hand = () => page.locator('.hand-card').count()

await openPlaytest()

console.log('\nThe opening hand')
await page.getByRole('button', { name: 'Draw a hand' }).click()
await page.waitForTimeout(500)
check('seven cards', (await hand()) === 7, String(await hand()))
// 100 cards, one of them the commander, seven in hand: 92 left, not 93.
check('the commander is not in the library', (await chips()).includes('92 left'),
  (await chips()).join(' | '))
check('it says which side of the table', (await chips()).includes('On the play'))
check('and what shape the hand is',
  (await chips()).some((t) => /\d+ lands?, \d+ spells?/.test(t)), (await chips()).join(' | '))

console.log('\nThe London mulligan')
await page.getByRole('button', { name: /Mulligan to 6/ }).click()
await page.waitForTimeout(400)
// London draws seven every time — it is the bottoming that costs you.
check('a mulligan still draws seven', (await hand()) === 7, String(await hand()))
check('and the deck is whole again', (await chips()).includes('92 left'), (await chips()).join(' | '))
check('keeping is blocked until a card is chosen to bottom',
  await page.getByRole('button', { name: /Keep, bottom 1/ }).isDisabled())

await page.locator('.hand-card').first().click()
await page.waitForTimeout(300)
check('choosing one unblocks it',
  !(await page.getByRole('button', { name: /Keep, bottom 1/ }).isDisabled()))

await page.getByRole('button', { name: /Keep, bottom 1/ }).click()
await page.waitForTimeout(400)
check('keeping after one mulligan leaves six', (await hand()) === 6, String(await hand()))
check('and says what went to the bottom',
  /Bottomed:/.test(await page.locator('.app__main').innerText()))

console.log('\nTaking turns')
await page.getByRole('button', { name: 'Next turn' }).click()
await page.waitForTimeout(400)
check('a new turn draws a card', (await hand()) === 7, String(await hand()))
check('and the turn counter moves', (await chips()).includes('Turn 2'), (await chips()).join(' | '))
await page.getByRole('button', { name: 'Draw one' }).click()
await page.waitForTimeout(300)
check('drawing one more works', (await hand()) === 8, String(await hand()))

console.log('\nOn the draw')
// Switching sides has to be reachable once a hand is on the table, not only
// from the intro screen nobody sees again.
await page.getByRole('button', { name: 'On the play' }).click()
await page.waitForTimeout(500)
check('switching sides reshuffles rather than doing nothing',
  (await chips()).includes('On the draw'), (await chips()).join(' | '))
await page.getByRole('button', { name: 'Keep', exact: true }).click()
await page.waitForTimeout(400)
// The player on the draw draws for turn one; that is the whole difference.
check('keeping on the draw gives eight', (await hand()) === 8, String(await hand()))

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
