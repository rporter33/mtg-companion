#!/usr/bin/env node
/**
 * The free table, in a browser.
 *
 * Everything here is a property that only exists once a pointer, a layout and
 * a reload are involved, which is why it is not a unit test: a card dealt to
 * the right zone, a card dragged to a position that survives a reload, a
 * mulligan that puts the hand back, and a tapped card that says so in words
 * as well as by being sideways.
 *
 * The table enforces no rules, so there is nothing here about legality. What
 * is being checked is that the table remembers.
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
  ...extra,
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf'),
  c('forest', 'Forest', 'Basic Land — Forest', { mana_cost: '', cmc: 0, produced_mana: ['G'] }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid', { power: '1', toughness: '1' }),
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
  version: 4,
  decks: [{
    id: 'd1', name: 'Table Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'forest', quantity: 40 }, { cardId: 'elf', quantity: 59 }],
    sideboard: [], categoryOrder: [], versions: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], collection: {}, guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { deckView: 'list' },
})))
await page.reload({ waitUntil: 'networkidle' })

const openTable = async () => {
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.waitForTimeout(500)
}
const onField = () => page.locator('.field .bcard').count()
const inHand = () => page.locator('.tabletop__handcard .bcard').count()
const pileCount = async (title) => {
  const text = await page.locator('.pile__title', { hasText: title }).first().innerText()
  return Number(text.match(/(\d+)/)?.[1])
}
const slotStyle = () => page.locator('.field__slot').first().getAttribute('style')

await openTable()

console.log('\nChoosing a deck')
check('the table lists your own decks', (await page.locator('.table-picker__deck').count()) === 1)
check('and says how many cards will be dealt',
  (await page.locator('.table-picker__deck').innerText()).includes('99 cards'),
  await page.locator('.table-picker__deck').innerText())

await page.locator('.table-picker__deck').click()
await page.waitForTimeout(900)

console.log('\nDealing')
check('seven cards open the hand', (await inHand()) === 7, `${await inHand()} in hand`)
check('the rest are in the library', (await pileCount('Library')) === 92, `${await pileCount('Library')} in library`)
check('the commander starts in the command zone, not the library',
  (await pileCount('Command')) === 1, `${await pileCount('Command')} in the command zone`)
check('the battlefield starts empty', (await onField()) === 0)
check('the address names the deck on the table', page.url().includes('#/table/d1'), page.url())

console.log('\nPutting a card on the table')
await page.locator('.tabletop__handcard .bcard').first().click()
await page.waitForTimeout(200)
check('picking a card up offers what a hand can do with it',
  (await page.locator('.actions').count()) === 1)
await page.getByRole('button', { name: 'To the battlefield' }).click()
await page.waitForTimeout(300)
check('it is on the battlefield', (await onField()) === 1)
check('and no longer in hand', (await inHand()) === 6)
check('the action bar closes once the card is put down', (await page.locator('.actions').count()) === 0)

console.log('\nDragging it somewhere')
const before = await slotStyle()
{
  const field = await page.locator('.field').boundingBox()
  const card = await page.locator('.field .bcard').first().boundingBox()
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
  await page.mouse.down()
  await page.mouse.move(field.x + field.width * 0.2, field.y + field.height * 0.8, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}
const after = await slotStyle()
check('the card moved', before !== after, `${before} then ${after}`)
check('a drag does not also pick the card up', (await page.locator('.actions').count()) === 0)

console.log('\nTapping')
await page.locator('.field .bcard').first().click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Tap', exact: true }).click()
await page.waitForTimeout(300)
check('a tapped card says so, not only sits sideways',
  (await page.locator('.field__slot').first().innerText()).toLowerCase().includes('tapped'))
check('and says so to a screen reader too',
  (await page.locator('.field .bcard').first().getAttribute('aria-label')).includes('tapped'))
await page.getByRole('button', { name: 'Untap all' }).click()
await page.waitForTimeout(300)
check('untap all turns it back',
  !(await page.locator('.field__slot').first().innerText()).toLowerCase().includes('tapped'))

console.log('\nThe turn, and drawing')
await page.getByRole('button', { name: 'Draw', exact: true }).click()
await page.waitForTimeout(300)
check('drawing takes one off the library', (await pileCount('Library')) === 91)
check('and puts it in hand', (await inHand()) === 7)
await page.getByRole('button', { name: 'Next turn' }).click()
await page.waitForTimeout(300)
check('the turn counter is the player’s to advance',
  (await page.locator('.tabletop__top').innerText()).includes('Turn 2'))

console.log('\nLooking at the top of the library')
await page.getByRole('button', { name: 'Look at the top 3' }).click()
await page.waitForTimeout(300)
check('three cards, in order', (await page.locator('.peek__card').count()) === 3)
await page.locator('.peek__card').first().getByRole('button', { name: 'Bottom' }).click()
await page.waitForTimeout(300)
check('one goes to the bottom without changing the library size',
  (await pileCount('Library')) === 91, `${await pileCount('Library')}`)
await page.getByRole('button', { name: 'Stop looking' }).click()

console.log('\nLife, and a mulligan')
await page.getByRole('button', { name: 'Lose 5 life' }).click()
await page.waitForTimeout(200)
check('life goes down by five', (await page.locator('.life__total').innerText()) === '15')
await page.getByRole('button', { name: 'Mulligan' }).click()
await page.waitForTimeout(500)
check('a mulligan deals seven again', (await inHand()) === 7, `${await inHand()} in hand`)
check('and every card that was in hand went back',
  (await pileCount('Library')) === 91, `${await pileCount('Library')} in library`)
check('the mulligan is counted, with how many to put on the bottom',
  (await page.locator('.tabletop__top').innerText()).includes('1 mulligan'))

console.log('\nComing back to it')
const kept = await slotStyle()
const life = await page.locator('.life__total').innerText()
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
check('the table is where it was left', (await onField()) === 1, `${await onField()} on the battlefield`)
check('the card is in the same spot', (await slotStyle()) === kept, `${kept} then ${await slotStyle()}`)
check('life is what it was', (await page.locator('.life__total').innerText()) === life)
check('so is the turn', (await page.locator('.tabletop__top').innerText()).includes('Turn 2'))

console.log('\nStarting over')
await page.getByRole('button', { name: 'Deal again' }).click()
await page.waitForTimeout(500)
check('a fresh deal clears the battlefield', (await onField()) === 0)
check('and deals seven', (await inHand()) === 7)
check('and puts the life total back', (await page.locator('.life__total').innerText()) === '20')

check('no console errors throughout', errors.length === 0, errors.join('; '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
