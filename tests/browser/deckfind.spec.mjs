#!/usr/bin/env node
/**
 * Finding a card in the deck list, in the browser.
 *
 * The bar is pinned, filters as you type, reads names and type lines with
 * accents folded, and narrows to what is still to buy. What it must never do
 * is come back: leaving the List tab and returning has to show the whole
 * deck, because a deck that opens filtered to three cards looks like data
 * loss.
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
  c('jotun', 'Jötun Grunt', 'Creature — Giant Soldier', { color_identity: ['W'], colors: ['W'], mana_cost: '{1}{W}' }),
  c('bolt', 'Lightning Bolt', 'Instant', { prices: { usd: '3.00' }, color_identity: ['R'], colors: ['R'], mana_cost: '{R}' }),
  c('ring', 'Sol Ring', 'Artifact', { prices: { usd: '2.00' }, color_identity: [], colors: [], mana_cost: '{1}' }),
  c('forest', 'Forest', 'Basic Land — Forest', { prices: {}, mana_cost: '' }),
]
// Ten filler creatures so the list is taller than a phone screen and the bar has something to stick over.
for (let i = 1; i <= 10; i++) CARDS.push(c(`bear${i}`, `Grizzly Bear ${i}`, 'Creature — Bear'))

const STATE = {
  version: 3,
  collection: { 'o-forest': 8, 'o-ring': 1 },
  decks: [{
    id: 'd1', name: 'Find Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null, categoryOrder: [],
    main: [
      { cardId: 'elf', quantity: 1 }, { cardId: 'jotun', quantity: 1 }, { cardId: 'bolt', quantity: 1 },
      { cardId: 'ring', quantity: 1 }, { cardId: 'forest', quantity: 8 },
      ...Array.from({ length: 10 }, (_, i) => ({ cardId: `bear${i + 1}`, quantity: 1 })),
    ],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }, {
    // No commander: the hairline has to come from the cards themselves.
    id: 'd2', name: 'Standard Test', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [],
    main: [{ cardId: 'elf', quantity: 4 }, { cardId: 'jotun', quantity: 4 }, { cardId: 'bolt', quantity: 4 }, { cardId: 'ring', quantity: 4 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
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
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() => { location.hash = '#/decks/d1' })
  await page.waitForSelector('.deck-row:not(.deck-row--missing)')
  await page.waitForTimeout(300)
}

const sections = (page) => page.locator('.section-title h2').allInnerTexts()
const rowNames = (page) => page.locator('.deck-row__name').allInnerTexts()
const box = (page) => page.getByLabel('Find a card in this deck')
const status = (page) => page.locator('.deck-find [role="status"]').innerText()

console.log('\nOn a phone')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 640 }, hasTouch: true, isMobile: true })
  await setUp(page)

  check('the bar is there, is a search landmark, and is pinned',
    (await box(page).count()) === 1
    && (await page.locator('.deck-find[role="search"]').count()) === 1
    && (await page.locator('.deck-find').evaluate((el) => getComputedStyle(el).position)) === 'sticky')
  check('the phone keyboard is told what the field is for',
    (await box(page).getAttribute('enterkeyhint')) === 'done'
    && (await box(page).getAttribute('autocomplete')) === 'off'
    && (await box(page).getAttribute('autocapitalize')) === 'off')
  const targets = await page.locator('.deck-find input, .deck-find .chip').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  check('the field and the chip are thumb-sized', targets.every((h) => h >= 44), targets.join(','))
  const placeholder = await box(page).evaluate((e) => getComputedStyle(e, '::placeholder').color)
  check('the placeholder is not the browser\u2019s faint default grey', placeholder !== 'rgb(117, 117, 117)', placeholder)
  check('the hairline shows the commander’s colour identity',
    (await page.locator('.deck-find__identity i').count()) === 1
    && (await page.locator('.deck-find__identity i').getAttribute('data-identity')) === 'G')
  check('the status line is silent while idle', (await status(page)) === '')

  console.log('\nTyping narrows the deck')
  await box(page).fill('bolt')
  await page.waitForTimeout(200)
  check('only the matching card is left', (await rowNames(page)).join(',') === 'Lightning Bolt', (await rowNames(page)).join(','))
  check('sections with no match are gone', (await sections(page)).join(',') === 'Instants', (await sections(page)).join(','))
  const header = await page.locator('.section-title').first().innerText()
  check('the header counts matches and hides the price', /1 of 1/.test(header) && !/\$/.test(header), header)
  check('a screen reader hears the count', (await status(page)) === '1 of 23 cards match', await status(page))
  const clearBox = await page.getByRole('button', { name: 'Clear', exact: true }).boundingBox()
  check('the clear button is thumb-sized too', clearBox.width >= 44 && clearBox.height >= 44, `${clearBox.width}x${clearBox.height}`)

  await box(page).fill('instant')
  await page.waitForTimeout(200)
  check('the type line is searched too', (await rowNames(page)).join(',') === 'Lightning Bolt', (await rowNames(page)).join(','))
  await box(page).fill('jotun')
  await page.waitForTimeout(200)
  check('accents are ignored, as a phone keyboard needs', (await rowNames(page)).join(',') === 'Jötun Grunt', (await rowNames(page)).join(','))
  await box(page).fill('druid elf')
  await page.waitForTimeout(200)
  check('every word must match, in any order', (await rowNames(page)).join(',') === 'Llanowar Elves', (await rowNames(page)).join(','))
  await box(page).fill('bear')
  await page.waitForTimeout(200)
  check('a common word finds all of them', (await rowNames(page)).length === 10, String((await rowNames(page)).length))

  const clipped = await page.locator('.deck-row__name')
    .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
  check('no card name is clipped while searching', clipped.length === 0, clipped.join(', '))
  const wide = await page.evaluate(() => {
    const main = document.querySelector('.app__main')
    return main.scrollWidth > main.clientWidth + 1 || document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  })
  check('nothing scrolls sideways', !wide)
  const strip = page.getByRole('tablist', { name: 'Deck' })
  check('the tab strip scrolls within itself instead',
    (await strip.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'auto')))

  console.log('\nNothing matches')
  await box(page).fill('zzz')
  await page.waitForTimeout(200)
  const empty = page.locator('.deck-find__empty')
  check('it says so plainly, with the words typed',
    (await empty.count()) === 1 && /Nothing in this deck matches “zzz”/.test(await empty.innerText()), await empty.innerText())
  check('and the bar stays so the words can be changed', (await box(page).count()) === 1)
  check('a screen reader hears that too', (await status(page)) === 'No cards match', await status(page))
  await empty.getByRole('button', { name: 'Clear search' }).click()
  await page.waitForTimeout(200)
  check('Clear brings the deck back and keeps focus in the box',
    (await rowNames(page)).length === 16 && (await box(page).evaluate((e) => document.activeElement === e)),
    String((await rowNames(page)).length))

  await box(page).fill('zzz')
  await page.waitForTimeout(200)
  await empty.getByRole('button', { name: /Search all cards for/ }).click()
  await page.waitForTimeout(500)
  const addBox = page.getByLabel('Search cards to add')
  check('a miss turns into a search of every card, on the Add tab, with the same words',
    (await page.getByRole('tab', { name: 'Add cards' }).getAttribute('aria-selected')) === 'true'
    && (await addBox.inputValue()) === 'zzz', await addBox.inputValue().catch(() => 'no box'))

  console.log('\nComing back')
  await page.getByRole('tab', { name: 'List' }).click()
  await page.waitForSelector('.deck-row:not(.deck-row--missing)')
  check('the search is gone: the whole deck shows again',
    (await box(page).inputValue()) === '' && (await rowNames(page)).length === 16, String((await rowNames(page)).length))

  console.log('\nWhat is still to buy')
  await page.getByRole('button', { name: 'Not owned' }).click()
  await page.waitForTimeout(200)
  const need = await rowNames(page)
  check('the chip narrows to cards missing from the collection',
    !need.includes('Forest') && !need.includes('Sol Ring') && need.includes('Lightning Bolt'), need.join(','))
  check('the chip reads as pressed', (await page.getByRole('button', { name: 'Not owned' }).getAttribute('aria-pressed')) === 'true')
  await box(page).fill('ring')
  await page.waitForTimeout(200)
  check('with a search it says what is missing in words',
    /Nothing you still need matches “ring”/.test(await page.locator('.deck-find__empty').innerText()),
    await page.locator('.deck-find__empty').innerText())
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await page.getByRole('button', { name: 'Not owned' }).click()
  await page.waitForTimeout(200)
  check('off again, everything is back', (await rowNames(page)).length === 16)

  console.log('\nOwning all of it')
  await page.locator('.deck-head').getByRole('button', { name: /to get/ }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Not owned' }).click()
  await page.waitForTimeout(200)
  check('the empty state is good news, and the screen reader hears the same',
    /You own every card in this deck/.test(await page.locator('.deck-find__empty').innerText())
    && (await status(page)) === 'You own every card in this deck', await status(page))
  await page.getByRole('button', { name: 'Show all cards' }).click()
  await page.waitForTimeout(200)
  check('Show all cards brings the rows back and keeps focus in the bar',
    (await rowNames(page)).length === 16 && (await box(page).evaluate((e) => document.activeElement === e)))

  console.log('\nIt stays put while the list scrolls')
  const before = (await page.locator('.deck-find').boundingBox()).y
  await page.locator('.app__main').evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(200)
  const after = await page.locator('.deck-find').boundingBox()
  check('scrolled to the bottom, the bar is flush with the top of the screen',
    Math.abs(after.y) <= 1 && after.y < before, `was at ${before}, now at ${after.y}`)
  check('and it is a real surface over the rows, not just text',
    (await page.locator('.deck-find').evaluate((el) => getComputedStyle(el).backdropFilter)) !== 'none')

  console.log('\nGrid view searches too')
  await page.locator('.app__main').evaluate((el) => { el.scrollTop = 0 })
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await page.waitForTimeout(400)
  await box(page).fill('ring')
  await page.waitForTimeout(200)
  check('one tile is left', (await page.locator('.deck-tile').count()) === 1, String(await page.locator('.deck-tile').count()))
  await box(page).fill('')
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.waitForTimeout(300)

  await page.close()
}

console.log('\nAt a desk')
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await setUp(page)

  await page.locator('.section-title').first().click()
  await page.keyboard.press('/')
  await page.waitForTimeout(100)
  check('"/" after clicking on the list focuses the box', await box(page).evaluate((e) => document.activeElement === e))
  await page.getByRole('button', { name: 'Grid', exact: true }).focus()
  await page.keyboard.press('/')
  await page.waitForTimeout(100)
  check('and from a control in the list', await box(page).evaluate((e) => document.activeElement === e))
  await page.locator('.deck-title').blur()
  await page.getByRole('button', { name: '\u2190 Decks' }).focus()
  await page.keyboard.press('/')
  await page.waitForTimeout(100)
  check('but not from outside it: it is not a page-wide shortcut',
    !(await box(page).evaluate((e) => document.activeElement === e)))
  await box(page).focus()
  await page.keyboard.type('bolt')
  await page.waitForTimeout(200)
  check('typing narrows the list', (await rowNames(page)).join(',') === 'Lightning Bolt')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  check('Enter lands on the first match',
    (await page.evaluate(() => document.activeElement?.textContent)) === 'Lightning Bolt',
    await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)))
  await box(page).focus()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Escape clears and keeps focus',
    (await box(page).inputValue()) === '' && (await box(page).evaluate((e) => document.activeElement === e))
    && (await rowNames(page)).length === 16)

  await page.locator('.deck-title').focus()
  await page.keyboard.press('/')
  await page.waitForTimeout(100)
  check('"/" while typing elsewhere is left alone',
    !(await box(page).evaluate((e) => document.activeElement === e))
    && (await page.locator('.deck-title').inputValue()).endsWith('/'))
  await page.locator('.deck-title').fill('Find Test')

  await box(page).fill('zzz')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  check('Enter with no match lands on the way out of the empty state',
    (await page.evaluate(() => document.activeElement?.textContent)) === 'Clear search',
    await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('and that Enter clears it', (await rowNames(page)).length === 16)

  console.log('\nA deck with no commander')
  await page.evaluate(() => { location.hash = '#/decks/d2' })
  await page.waitForSelector('.deck-row:not(.deck-row--missing)')
  await page.waitForTimeout(300)
  const segments = await page.locator('.deck-find__identity i').evaluateAll((els) => els.map((e) => e.dataset.identity))
  check('the hairline comes from the cards, in wheel order', segments.join('') === 'WRG', segments.join(','))
  await page.evaluate(() => { location.hash = '#/decks/d1' })
  await page.waitForSelector('.deck-row:not(.deck-row--missing)')
  await page.waitForTimeout(300)

  console.log('\nText view follows the search')
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.waitForTimeout(400)
  await box(page).fill('ring')
  await page.waitForTimeout(300)
  const preview = page.locator('.deck-preview')
  check('the columns narrow and the panel shows the first match',
    (await page.locator('.text-row').count()) === 1 && /Sol Ring/.test(await preview.innerText()), await preview.innerText())
  await box(page).fill('')
  await page.waitForTimeout(200)
  check('cleared, every line is back', (await page.locator('.text-row').count()) === 16)

  await page.close()
}

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
