#!/usr/bin/env node
/**
 * The text view: a whole deck on one screen, with the card under the pointer
 * shown large beside it.
 *
 * Two screens matter. A wide pointer screen gets the columns and the pinned
 * preview; a phone gets the columns alone and the card sheet on a tap. Both
 * are driven here, because the preview is hidden by a media query and a test
 * on one viewport would never notice the other breaking.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

// A real PNG as a data URI, so the preview shows an image rather than the CSS
// face. Not a routed URL: the service worker fetches card images itself, and
// a request from a worker never passes through the page's routes, so a routed
// image errors out and the component quietly falls back to the CSS face.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const c = (id, name, type_line, mana_cost = '{1}{G}', prices = { usd: '1.00', eur: '0.90' }) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost, cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices,
  image_uris: { small: PNG, normal: PNG },
  purchase_uris: { tcgplayer: `https://example.test/buy/${id}` },
})
const CARDS = [
  c('cmdr', 'Text Commander', 'Legendary Creature — Elf', '{2}{G}{G}', { usd: '5.00' }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid', '{G}'),
  c('bolt', 'Lightning Bolt', 'Instant', '{R}', { usd: '3.00' }),
  c('ring', 'Sol Ring', 'Artifact', '{1}', { usd: '2.00' }),
  c('forest', 'Forest', 'Basic Land — Forest', '', {}),
]
const STATE = {
  version: 4, collection: {},
  decks: [{
    id: 'd1', name: 'Text View Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    categoryOrder: [], versions: [],
    main: [{ cardId: 'elf', quantity: 1 }, { cardId: 'bolt', quantity: 1 },
      { cardId: 'ring', quantity: 1 }, { cardId: 'forest', quantity: 8 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
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
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.deck-card__open').first().click()
  await page.waitForTimeout(900)
}

console.log('\nOn a wide screen with a pointer')
{
  // hasTouch false and a mouse: Chromium reports (hover: hover).
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await setUp(page)
  const toggle = page.getByRole('button', { name: 'Text', exact: true })
  check('a Text view is offered beside List and Grid', (await toggle.count()) === 1)
  await toggle.click()
  await page.waitForTimeout(500)

  const rows = page.locator('.text-row')
  check('every card is a single line', (await rows.count()) === 5, String(await rows.count()))
  const first = page.locator('.text-section').first()
  check('sections keep their headings and counts',
    /Commander/.test(await first.locator('.section-title').innerText()), await first.locator('.section-title').innerText())
  const boltRow = rows.filter({ hasText: 'Lightning Bolt' })
  check('a line reads quantity, name, cost',
    (await boltRow.locator('.text-row__qty').innerText()) === '1'
    && (await boltRow.locator('.mana').count()) === 1
    && (await boltRow.locator('.mana').getAttribute('aria-label') || '').includes('red'),
    await boltRow.innerText())
  check('the commander line is marked as one, not numbered',
    (await rows.filter({ hasText: 'Text Commander' }).locator('.text-row__qty').innerText()) === '★')

  const columns = await page.locator('.deck-text').evaluate((el) => getComputedStyle(el).columnWidth)
  check('sections flow into columns rather than one long strip', columns !== 'auto', columns)

  const preview = page.locator('.deck-preview')
  check('the preview panel is present and asks to be pointed at',
    await preview.isVisible() && /Point at a card/.test(await preview.innerText()), await preview.innerText())

  await boltRow.hover()
  await page.waitForTimeout(300)
  check('pointing at a card shows it in the panel',
    (await preview.locator('img[alt="Lightning Bolt"]').count()) === 1 && /Lightning Bolt/.test(await preview.innerText()),
    await preview.innerText())
  check('the panel carries the prices, linked where a shop exists',
    (await preview.locator('.prices a').count()) >= 1 && /\$3\.00/.test(await preview.innerText()),
    await preview.innerText())
  check('the pointed-at line is marked', (await boltRow.getAttribute('class') || '').includes('text-row--previewed'))

  await page.mouse.move(5, 5)
  await page.waitForTimeout(200)
  check('the panel keeps the last card rather than emptying when the pointer leaves',
    (await preview.locator('img[alt="Lightning Bolt"]').count()) === 1)

  // Keyboard: focusing a name previews it too.
  await rows.filter({ hasText: 'Sol Ring' }).locator('.text-row__name').focus()
  await page.waitForTimeout(200)
  check('tabbing to a card shows it as well', (await preview.locator('img[alt="Sol Ring"]').count()) === 1)

  const panelBox = await preview.boundingBox()
  const listBox = await page.locator('.deck-text').boundingBox()
  check('the panel sits beside the list, not above it',
    panelBox && listBox && panelBox.x + panelBox.width <= listBox.x + 1, JSON.stringify({ panelBox, listBox }))

  // The stepper is quiet until the row is pointed at, and works.
  const elfRow = rows.filter({ hasText: 'Llanowar Elves' })
  const quiet = await elfRow.locator('.text-row__edit').evaluate((el) => getComputedStyle(el).opacity)
  check('quantity controls stay quiet on a row nobody is pointing at', quiet === '0', quiet)
  await elfRow.hover()
  await page.waitForTimeout(200)
  await elfRow.getByRole('button', { name: /One more Llanowar/ }).click()
  await page.waitForTimeout(400)
  check('and change the count when used', (await elfRow.locator('.text-row__qty').innerText()) === '2')

  await rows.filter({ hasText: 'Sol Ring' }).locator('.text-row__name').click()
  await page.waitForTimeout(500)
  check('pressing a name opens the card sheet, as everywhere else',
    (await page.getByRole('dialog').count()) >= 1 || (await page.locator('.sheet').count()) >= 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.deck-card__open').first().click()
  await page.waitForTimeout(900)
  check('the view choice is remembered', (await page.locator('.text-row').count()) === 5)
  await page.close()
}

console.log('\nOn a phone')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
  await setUp(page)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.waitForTimeout(500)
  check('the lines are there', (await page.locator('.text-row').count()) === 5)
  check('the preview panel is not, since nothing hovers on a phone',
    !(await page.locator('.deck-preview').isVisible()))
  const clipped = await page.locator('.text-row__name')
    .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
  check('no card name is truncated', clipped.length === 0, clipped.join(', '))
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check('nothing scrolls sideways', wide)
  const edit = await page.locator('.text-row__edit').first().evaluate((el) => getComputedStyle(el).opacity)
  check('quantity controls are always shown, since there is no hover to reveal them', edit === '1', edit)
  await page.locator('.text-row').filter({ hasText: 'Sol Ring' }).locator('.text-row__name').tap()
  await page.waitForTimeout(500)
  check('tapping a name opens the card sheet',
    (await page.getByRole('dialog').count()) >= 1 || (await page.locator('.sheet').count()) >= 1)
  await page.close()
}

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
