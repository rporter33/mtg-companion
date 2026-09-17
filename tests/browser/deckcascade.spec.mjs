#!/usr/bin/env node
/**
 * The cascade of section buttons, in the browser.
 *
 * One section open at a time, or every section when nothing is chosen;
 * remembered per deck; never hiding a problem or a shopping list, because
 * the buttons carry both; and a search always sees into a folded section.
 * The subtle case is a card that arrives while the list is not showing:
 * its section has to open, or a card added on the Add tab lands somewhere
 * folded and looks as if it was never added.
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
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over,
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf', { prices: { usd: '5.00' } }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid'),
  c('bolt', 'Lightning Bolt', 'Instant', { prices: { usd: '3.00' }, color_identity: [], colors: [], mana_cost: '{1}' }),
  c('ring', 'Sol Ring', 'Artifact', { prices: { usd: '2.00' }, color_identity: [], colors: [], mana_cost: '{1}' }),
  c('forest', 'Forest', 'Basic Land — Forest', { prices: {}, mana_cost: '' }),
  c('fog', 'Fog', 'Instant'),
  c('wurm', 'Green Wurm', 'Creature — Wurm'),
]
for (let i = 1; i <= 10; i++) CARDS.push(c(`bear${i}`, `Grizzly Bear ${i}`, 'Creature — Bear'))

const STATE = {
  version: 3,
  // Forest and Sol Ring owned; everything else still to get.
  collection: { 'o-forest': 8, 'o-ring': 1 },
  decks: [{
    id: 'd1', name: 'Cascade Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null, categoryOrder: [],
    main: [
      { cardId: 'elf', quantity: 1 }, { cardId: 'bolt', quantity: 1 }, { cardId: 'ring', quantity: 1 },
      { cardId: 'forest', quantity: 8 },
      // Two copies in a singleton format: a legality problem inside Creatures.
      { cardId: 'bear1', quantity: 2 },
      ...Array.from({ length: 9 }, (_, i) => ({ cardId: `bear${i + 2}`, quantity: 1 })),
    ],
    sideboard: [{ cardId: 'fog', quantity: 1 }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: { deckView: 'list' },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []

const setUp = async (page) => {
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
  await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
  await page.route('**/api.scryfall.com/cards/search**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ object: 'list', data: [CARDS.find((x) => x.id === 'wurm')], total_cards: 1, has_more: false }) }))
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() => { location.hash = '#/decks/d1' })
  await page.waitForSelector('.deck-row:not(.deck-row--missing)')
  await page.waitForTimeout(300)
}

const sections = (page) => page.locator('.section-title h2').allInnerTexts()
const buttons = (page) => page.locator('.deck-sections__btn')
const button = (page, name) => page.locator('.deck-sections__btn').filter({ has: page.locator('.deck-sections__name', { hasText: name }) })
const openOnes = (page) => page.locator('.deck-sections__btn--open .deck-sections__name').allInnerTexts()
const expanded = (page) => page.locator('.deck-sections__btn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')))

console.log('\nOn a phone')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 640 }, hasTouch: true, isMobile: true })
  await setUp(page)

  const names = await page.locator('.deck-sections__name').allInnerTexts()
  check('one button per section, in the deck’s order, sideboard last, no commander',
    names.join(',') === 'Creatures,Instants,Artifacts,Lands,Sideboard', names.join(','))
  check('the buttons live in the pinned bar', (await page.locator('.deck-find .deck-sections').count()) === 1)
  check('the row scrolls sideways within itself', await page.locator('.deck-sections').evaluate((el) => getComputedStyle(el).overflowX === 'auto'))
  const heights = await buttons(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  check('every button is thumb-sized', heights.every((h) => h >= 44), heights.join(','))
  check('each carries its count, by copies', /12/.test(await button(page, 'Creatures').innerText()) && /8/.test(await button(page, 'Lands').innerText()),
    await button(page, 'Creatures').innerText())
  check('a section holding a legality problem shows a dot',
    (await button(page, 'Creatures').locator('.deck-sections__dot').count()) === 1
    && (await button(page, 'Lands').locator('.deck-sections__dot').count()) === 0)
  check('and how many of its cards are still to buy',
    (await button(page, 'Creatures').locator('.deck-sections__need').innerText()) === '11'
    && (await button(page, 'Lands').locator('.deck-sections__need').count()) === 0
    && (await button(page, 'Artifacts').locator('.deck-sections__need').count()) === 0)
  check('a screen reader hears the count, the problem and the shopping list',
    (await page.getByRole('button', { name: /^Creatures\s*12 cards\s*,\s*1 problem,\s*11 to get\s*$/ }).count()) === 1,
    await page.locator('.deck-sections').ariaSnapshot())
  check('everything starts open, and every button says so',
    (await sections(page)).length === 6 && (await expanded(page)).every((v) => v === 'true') && (await openOnes(page)).length === 0)
  const wide = await page.evaluate(() => {
    const main = document.querySelector('.app__main')
    return main.scrollWidth > main.clientWidth + 1
  })
  check('nothing scrolls sideways', !wide)

  console.log('\nOne at a time')
  await button(page, 'Lands').click()
  await page.waitForTimeout(350)
  check('tap Lands: only the commander and Lands remain', (await sections(page)).join(',') === 'Commander,Lands', (await sections(page)).join(','))
  check('the button reads as open and the others as folded',
    (await openOnes(page)).join() === 'Lands' && (await expanded(page)).join() === 'false,false,false,true,false', (await expanded(page)).join())
  await button(page, 'Creatures').click()
  await page.waitForTimeout(350)
  check('tap Creatures: it takes over', (await sections(page)).join(',') === 'Commander,Creatures', (await sections(page)).join(','))
  const bar = await page.locator('.deck-find').boundingBox()
  const top = (await page.locator('section[data-section="Creatures"]').boundingBox()).y
  check('the opened section snaps under the bar', bar.y <= 1 && top >= bar.y + bar.height - 2 && top <= bar.y + bar.height + 24,
    `bar ${Math.round(bar.y)}..${Math.round(bar.y + bar.height)}, section top ${Math.round(top)}`)
  await button(page, 'Creatures').click()
  await page.waitForTimeout(350)
  check('tap it again: the whole deck is back', (await sections(page)).length === 6 && (await openOnes(page)).length === 0)

  console.log('\nRemembered per deck')
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1:deck:d1')).updatedAt)
  await button(page, 'Instants').click()
  await page.waitForTimeout(350)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.deck-row:not(.deck-row--missing)')
  await page.waitForTimeout(300)
  check('Instants is still the open section after a reload', (await sections(page)).join(',') === 'Commander,Instants', (await sections(page)).join(','))
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1:deck:d1')).updatedAt)
  check('folding is not an edit: the deck’s updatedAt did not move', before === after, `${before} -> ${after}`)
  check('and it lives in prefs under the deck’s id',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1')).prefs.deckOpen?.d1)) === 'Instants')

  console.log('\nRename and dissolve follow the open section')
  const instants = page.locator('section[data-section="Instants"]')
  await instants.getByRole('button', { name: /Edit the Instants section/ }).click()
  await page.waitForTimeout(200)
  await page.getByRole('textbox', { name: /Rename Instants/ }).fill('Interaction')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.waitForTimeout(500)
  check('renamed, it stays open under the new name',
    (await sections(page)).join(',') === 'Commander,Interaction' && (await openOnes(page)).join() === 'Interaction', (await sections(page)).join(','))
  const made = page.locator('section[data-section="Interaction"]')
  await made.getByRole('button', { name: /Edit the Interaction section/ }).click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Dissolve' }).click()
  await page.waitForTimeout(500)
  check('dissolved, everything is open again', (await sections(page)).length === 6 && (await openOnes(page)).length === 0, (await sections(page)).join(','))

  console.log('\nA search sees into a fold')
  await button(page, 'Lands').click()
  await page.waitForTimeout(350)
  const box = page.getByLabel('Find a card in this deck')
  await box.fill('bolt')
  await page.waitForTimeout(250)
  check('typing shows the match even though its section was folded', (await sections(page)).join(',') === 'Instants', (await sections(page)).join(','))
  check('the buttons count matches and dim the sections with none',
    /1 of 1/.test(await button(page, 'Instants').innerText())
    && (await button(page, 'Lands').getAttribute('aria-disabled')) === 'true'
    && (await button(page, 'Instants').getAttribute('aria-disabled')) === null,
    await button(page, 'Instants').innerText())
  await box.fill('')
  await page.waitForTimeout(250)
  check('cleared, the fold comes back untouched', (await sections(page)).join(',') === 'Commander,Lands', (await sections(page)).join(','))

  console.log('\nMoving a card keeps your place')
  await button(page, 'Creatures').click()
  await page.waitForTimeout(350)
  const row = page.locator('.deck-row').filter({ has: page.locator('.deck-row__name', { hasText: 'Llanowar Elves' }) })
  await row.locator('.deck-row__category--closed').click()
  await page.waitForTimeout(100)
  await page.locator('select.deck-row__category').selectOption({ label: 'Artifacts' })
  await page.waitForTimeout(500)
  check('Creatures stays open; the card left it', (await sections(page)).join(',') === 'Commander,Creatures'
    && (await page.locator('.deck-row__name', { hasText: 'Llanowar Elves' }).count()) === 0, (await sections(page)).join(','))
  check('and the Artifacts button counted it in', /2/.test(await button(page, 'Artifacts').innerText()), await button(page, 'Artifacts').innerText())

  console.log('\nA card added elsewhere is shown where it landed')
  await page.getByRole('tab', { name: 'Add cards' }).click()
  await page.getByLabel('Search cards to add').waitFor()
  await page.getByLabel('Search cards to add').fill('wurm')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.search-row', { hasText: 'Green Wurm' }).waitFor()
  await page.locator('.search-row', { hasText: 'Green Wurm' }).getByRole('button', { name: /Add Green Wurm/ }).click()
  await page.waitForTimeout(300)
  // Fold somewhere else first, so the arrival has to open its section.
  await page.getByRole('tab', { name: 'List' }).click()
  await page.waitForSelector('.deck-row:not(.deck-row--missing)')
  await page.waitForTimeout(400)
  check('back on the list, the section that received the card is open', (await sections(page)).join(',') === 'Commander,Creatures', (await sections(page)).join(','))
  const arrivedRow = page.locator('.deck-row').filter({ has: page.locator('.deck-row__name', { hasText: 'Green Wurm' }) })
  check('and the new row is marked for a moment', (await arrivedRow.count()) === 1 && /deck-row--arrived/.test(await arrivedRow.getAttribute('class') || ''),
    await arrivedRow.getAttribute('class'))

  console.log('\nGrid and text fold too')
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await page.waitForTimeout(400)
  check('the grid shows only the open section’s tiles', (await page.locator('.deck-tile').count()) === 1 + 11, String(await page.locator('.deck-tile').count()))
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.waitForTimeout(400)
  check('so does the text view', (await page.locator('.text-section').count()) === 2, String(await page.locator('.text-section').count()))
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.waitForTimeout(300)

  await page.close()
}

console.log('\nAt a desk, by keyboard')
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await setUp(page)
  await button(page, 'Lands').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(350)
  check('Enter on a button opens its section', (await sections(page)).join(',') === 'Commander,Lands', (await sections(page)).join(','))
  check('focus stays on the button', await button(page, 'Lands').evaluate((e) => document.activeElement === e))
  await page.keyboard.press('Space')
  await page.waitForTimeout(350)
  check('Space on it again reopens everything', (await sections(page)).length === 6)
  await page.close()
}

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
