#!/usr/bin/env node
/**
 * A table saved by an older build, opened by this one.
 *
 * This is the shape of a bug that took the live app down: a zone was added,
 * the board in somebody's phone had been written a deploy earlier without it,
 * and the Table tab died on the missing one — an error screen, not a table.
 *
 * A unit test covers the restore itself. This covers the thing the player
 * actually did: storage already had that board when the screen opened. Only a
 * browser has storage that survives a reload, so it lives here.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const c = (id, name, type_line, extra = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' },
})
const CARDS = [
  c('forest', 'Forest', 'Basic Land — Forest'),
  c('bear', 'Grizzly Bears', 'Creature — Bear'),
]

/**
 * A board with no stack zone, no lane on any instance and a free-text step:
 * exactly what the build before the playmat wrote.
 */
const OLD_BOARD = {
  version: 1,
  players: ['you'],
  seed: 7,
  turn: 3,
  active: 'you',
  step: null,
  life: { you: 17 },
  counters: { you: {} },
  cards: {
    'you:0:forest': {
      id: 'you:0:forest', cardId: 'forest', owner: 'you', controller: 'you',
      zone: 'battlefield', x: 0.3, y: 0.8, tapped: true, faceDown: false, flipped: false,
      counters: {}, note: '', token: false, custom: null, attachedTo: null,
      finish: 'foil', enteredOnTurn: 1, z: 4,
    },
    'you:1:bear': {
      id: 'you:1:bear', cardId: 'bear', owner: 'you', controller: 'you',
      zone: 'hand', x: 0.5, y: 0.5, tapped: false, faceDown: false, flipped: false,
      counters: {}, note: '', token: false, custom: null, attachedTo: null,
      finish: 'normal', enteredOnTurn: 0, z: 0,
    },
  },
  zones: {
    you: { library: [], hand: ['you:1:bear'], battlefield: ['you:0:forest'], graveyard: [], exile: [], command: [] },
  },
  revealed: [], arrows: [], dice: [], notes: '', log: [], nextZ: 5, seq: 12, events: [],
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((board) => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 4,
  decks: [{
    id: 'd1', name: 'Old Save', formatId: 'commander', commanders: [], signatureSpell: null,
    main: [{ cardId: 'forest', quantity: 30 }, { cardId: 'bear', quantity: 30 }],
    sideboard: [], categoryOrder: [], versions: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], collection: {}, guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  table: { saved: { version: 1, deckId: 'd1', mulligans: 1, savedAt: '2026-09-18T06:00:00Z', board } },
  prefs: { deckView: 'list' },
})), OLD_BOARD)
await page.reload({ waitUntil: 'networkidle' })

console.log('\nThe Table tab, with last week\'s board in storage')
await page.getByRole('button', { name: 'Table', exact: true }).click()
await page.waitForTimeout(400)
check('the in-progress table is offered', (await page.locator('.hero__label', { hasText: 'In progress' }).count()) === 1)
check('and says where it was left', (await page.locator('.hero p').first().innerText()).includes('Turn 3'),
  await page.locator('.hero p').first().innerText().catch(() => '(no hero)'))

await page.getByRole('button', { name: 'Back to the table' }).click()
await page.waitForTimeout(900)

check('no error screen', (await page.getByText('Something broke on this screen').count()) === 0)
check('the table is there', (await page.locator('.tabletop').count()) === 1)
check('the card that was on the battlefield still is', (await page.locator('.field .bcard').count()) === 1)
check('and is still tapped', (await page.locator('.field .bcard--tapped').count()) === 1)
check('the card that was in hand still is', (await page.locator('.tabletop__handcard .bcard').count()) === 1)

console.log('\nAnd it can still be played')
await page.locator('.field .bcard').first().click()
await page.waitForTimeout(250)
check('a card on it answers a press', (await page.locator('.actions').count()) === 1)
await page.getByRole('button', { name: 'Untap', exact: true }).click()
await page.waitForTimeout(300)
check('and an action lands on the old board',
  (await page.locator('.field .bcard--tapped').count()) === 0)

// A restored board is saved again under this build, so the next open is
// ordinary rather than another upgrade.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
check('it survives a reload under the new build', (await page.locator('.field .bcard').count()) === 1)
check('with the stack zone it was missing', await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('mtg-companion:v1')).table.saved
  return Array.isArray(saved.board.zones.you.stack)
}))

check('nothing threw', errors.length === 0, errors.join('\n        '))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
