#!/usr/bin/env node
/**
 * Browser checks for a printing Scryfall no longer has.
 *
 * Almost everything in Scryfall's database is additive — but it sometimes finds
 * that a card it listed does not exist, or a digital card is deleted, and then
 * the id it gave goes away. Preview printings are the ones it happens to most,
 * which is exactly what a deck built during a spoiler season holds. Until this
 * was built, such a deck showed a row reading "Card not loaded (a1b2c3d4…)",
 * with no name, no price, no legality and nothing to export.
 *
 * A Modern deck saved on 21 Sep 2026 holds four Darklight Phoenixes in a
 * preview printing, with each card's name stamped on it, as the editor writes
 * them. It is opened on 23 Sep, when Scryfall's collection endpoint lists that
 * printing's id in not_found, three times over:
 *
 * - /migrations says the id was merged: the app follows it, fetches the card at
 *   the new id, writes the new id into the deck, and says so where the deck is
 *   open, attributed to Scryfall.
 * - /migrations says it was deleted: nothing to follow, so the deck is left
 *   exactly as it is, the row and the export read the stamped name, and the
 *   deck says the printing is no longer in Scryfall's records.
 * - /migrations refuses the request: the deck is left exactly as it is and says
 *   the same thing, which is what Scryfall's own not_found already proved; the
 *   failure is not kept as an answer, so the next open asks again — and this
 *   time follows the merge.
 *
 * Then the same deck at the table, where every copy the deck lists is dealt
 * whether a record for it exists or not: the deleted printing is four cards with
 * no face and the merged one is another printing's painting, so the table says
 * which, and says that it writes nothing into the deck itself.
 *
 * The cards are the objects Scryfall sent on 2026-09-21
 * (tests/fixtures/scryfall-unreleased.json) and the clock is held, so this
 * means the same on any day. The migration objects are shaped as
 * api.scryfall.com/migrations?page=1 answered on 2026-09-23.
 */

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/scryfall-unreleased.json', import.meta.url), 'utf8'))
const CARDS = FIXTURE.cards.map((card) => ({
  ...card,
  image_uris: Object.fromEntries(Object.keys(card.image_uris ?? {}).map((size) => [size, PNG])),
}))
const SETS = FIXTURE.sets.map((set) => ({ ...set, icon_svg_uri: '' }))
const print = (set, number) => CARDS.find((c) => c.set === set && c.collector_number === number)

const MOUNTAIN = print('hob', '197')
const BOLT = print('msc', '806')
const PHOENIX = print('fra', '53')
// The record Scryfall merged the preview printing into: the same card, a new
// id, and a collector number of its own.
const PHOENIX_AGAIN = { ...PHOENIX, id: 'fra-53-merged', collector_number: '53b' }

const list = (data) => ({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', total_cards: data.length, has_more: false, data }) })

const migrationList = (data) => ({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', has_more: true, next_page: 'https://api.scryfall.com/migrations?page=2', data }) })

const MERGE = {
  object: 'migration',
  id: '6697b38a-ee19-455c-b24b-d0a659782d8b',
  uri: 'https://api.scryfall.com/migrations/6697b38a-ee19-455c-b24b-d0a659782d8b',
  performed_at: '2026-09-23',
  migration_strategy: 'merge',
  old_scryfall_id: PHOENIX.id,
  new_scryfall_id: PHOENIX_AGAIN.id,
  note: 'Duplicate preview record',
  metadata: { id: PHOENIX.id, name: PHOENIX.name, set_code: 'fra', collector_number: '53' },
}

const DELETION = {
  object: 'migration',
  id: '645d119f-58b3-4cdd-8014-7fc34e9a45b8',
  uri: 'https://api.scryfall.com/migrations/645d119f-58b3-4cdd-8014-7fc34e9a45b8',
  performed_at: '2026-09-22',
  migration_strategy: 'delete',
  old_scryfall_id: PHOENIX.id,
  note: 'Preview card that was never printed',
  metadata: { id: PHOENIX.id, name: PHOENIX.name, set_code: 'fra', collector_number: '53' },
}

/** Scryfall's collection endpoint answering ids from `cards`; the rest not_found. */
function collection(cards, asked) {
  return async (route) => {
    const { identifiers = [] } = JSON.parse(route.request().postData() ?? '{}')
    asked.push(identifiers.map((i) => i.id ?? JSON.stringify(i)))
    const data = identifiers.map((i) => cards.find((c) => c.id === i.id)).filter(Boolean)
    const not_found = identifiers.filter((i) => !cards.some((c) => c.id === i.id))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', not_found, data }) })
  }
}

/** Polls `test` until it holds or `ms` pass, by the real clock, not the page's. */
async function until(test, ms = 10000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test().catch(() => false)) return true
    await sleep(100)
  }
  return false
}

const errors = []
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

/** A fresh profile whose clock reads 23 Sep 2026, with Scryfall's set list routed. */
async function profile() {
  const context = await browser.newContext({ viewport: { width: 420, height: 1000 } })
  await context.clock.install({ time: new Date('2026-09-23T12:00:00Z') })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  // A route this spec deliberately answers with a 503 makes the browser log the
  // failed fetch itself. That is the browser's line, not the app's, so it is
  // left out; anything the app logs as an error still counts.
  page.on('console', (m) => {
    if (m.type() !== 'error' || /Failed to load resource/.test(m.text())) return
    errors.push(`${m.text()} (${m.location()?.url ?? ''})`)
  })
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill(list([])))
  await page.route('**/api.scryfall.com/sets', (route) => route.fulfill(list(SETS)))
  return { context, page }
}

/**
 * The deck as it was saved on 21 Sep 2026: four Phoenixes in the preview
 * printing, with the name of every card stamped on its entry, as the editor
 * writes them on every save.
 */
const DECK = {
  id: 'rift-burn', name: 'Rift Burn', formatId: 'modern', commanders: [], signatureSpell: null,
  categoryOrder: [], versions: [],
  main: [
    { cardId: MOUNTAIN.id, quantity: 52, name: MOUNTAIN.name },
    { cardId: BOLT.id, quantity: 4, name: BOLT.name },
    { cardId: PHOENIX.id, quantity: 4, name: PHOENIX.name },
  ],
  sideboard: [], createdAt: '2026-09-21T09:00:00Z', updatedAt: '2026-09-21T09:00:00Z',
}

const storedDeck = (page, id) => page.evaluate((id) => JSON.parse(localStorage.getItem(`mtg-companion:v1:deck:${id}`) ?? 'null'), id)

/** Saves the deck as the device's only one and opens it in the editor. */
async function saveAndOpen(page, deck) {
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate((deck) => localStorage.setItem('mtg-companion:v1', JSON.stringify({
    version: 4, collection: {}, decks: [deck], games: [],
    guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: { deckView: 'list' },
  })), deck)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.locator('.deck-card__open').first().click()
  await page.locator('.deck-title').waitFor()
  await page.waitForTimeout(900)
}

/** Every banner on the deck, as one string. */
const banners = async (page) => (await page.locator('.banner').allInnerTexts()).join(' | ').replace(/\s+/g, ' ')

/** The Phoenix's row, however it is drawn. */
async function phoenixRow(page) {
  const named = page.locator('.deck-row').filter({ has: page.locator('.deck-row__name', { hasText: /Darklight Phoenix/ }) })
  return {
    count: await named.count(),
    text: (await named.first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
    missing: /deck-row--missing/.test((await named.first().getAttribute('class').catch(() => '')) ?? ''),
  }
}

/**
 * axe-core over the whole page, held to the bar tests/browser/a11y.spec.mjs
 * holds — once the page has stopped moving. A card the deck has just gained is
 * ringed for 2.4 seconds and its section folds in over 180ms from `opacity: 0`,
 * and axe reads the colour of half-faded text as a contrast failure, which is a
 * fact about the animation and not about the design. So the sweep waits for the
 * ring to go; the fold is long over by then.
 */
async function axe(page, label) {
  await page.locator('.deck-row--arrived').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(250)
  await page.addScriptTag({ path: AXE })
  const { violations } = await page.evaluate(() => window.axe.run(document, {
    resultTypes: ['violations'],
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }))
  const blocking = violations.filter((v) => v.impact !== 'minor')
  check(`axe finds nothing critical, serious or moderate in ${label}`, blocking.length === 0,
    blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`).join('; '))
  for (const v of violations.filter((x) => x.impact === 'minor')) console.log(`        minor: ${v.id}`)
}

console.log('\nScryfall has merged the preview printing into another record')
{
  const { context, page } = await profile()
  const asked = []
  const migrations = []
  await page.route('**/api.scryfall.com/cards/collection', collection([MOUNTAIN, BOLT, PHOENIX_AGAIN], asked))
  await page.route('**/api.scryfall.com/migrations**', (route) => {
    migrations.push(route.request().url())
    return route.fulfill(migrationList([MERGE]))
  })
  await saveAndOpen(page, DECK)

  const followed = await until(async () => (await storedDeck(page, DECK.id))?.main?.some((e) => e.cardId === PHOENIX_AGAIN.id))
  const saved = await storedDeck(page, DECK.id)
  check('the deck now holds the printing Scryfall points at, in place of the one it discarded',
    followed && saved.main.find((e) => e.cardId === PHOENIX_AGAIN.id)?.quantity === 4
      && !saved.main.some((e) => e.cardId === PHOENIX.id),
    JSON.stringify(saved?.main))
  check('and nothing else about the deck changed',
    saved.main.length === 3 && saved.main.find((e) => e.cardId === MOUNTAIN.id)?.quantity === 52
      && saved.main.find((e) => e.cardId === BOLT.id)?.quantity === 4 && saved.name === 'Rift Burn',
    JSON.stringify(saved?.main))
  check("the new printing's name is stamped on the deck with it",
    saved.main.find((e) => e.cardId === PHOENIX_AGAIN.id)?.name === 'Darklight Phoenix',
    JSON.stringify(saved?.main))

  const said = await banners(page)
  check('the deck says what was done and whose word it acted on',
    said.includes('Scryfall has replaced its record of Darklight Phoenix: this deck now holds its new printing.'), said)
  check('and does not also report the card as one that could not be loaded',
    !/could not be loaded/.test(said) && !/no longer has a record/.test(said), said)

  const row = await phoenixRow(page)
  check('the row is a card again, with its name and not an id', row.count === 1 && !row.missing && /Darklight Phoenix/.test(row.text), JSON.stringify(row))
  check('the migrations were asked for once, and only page one',
    migrations.length === 1 && /migrations\?page=1$/.test(migrations[0]), migrations.join(' | '))
  check('the replacement card was fetched by its id',
    asked.some((ids) => ids.includes(PHOENIX_AGAIN.id)), JSON.stringify(asked))
  await axe(page, 'the deck editor after a printing was replaced')
  await context.close()
}

console.log('\nScryfall has deleted the preview printing, with nothing to replace it')
{
  const { context, page } = await profile()
  const asked = []
  const migrations = []
  await page.route('**/api.scryfall.com/cards/collection', collection([MOUNTAIN, BOLT], asked))
  await page.route('**/api.scryfall.com/migrations**', (route) => {
    migrations.push(route.request().url())
    return route.fulfill(migrationList([DELETION]))
  })
  await saveAndOpen(page, DECK)
  await until(async () => /no longer has a record/.test(await banners(page)))

  const said = await banners(page)
  check('the deck says the printing is no longer in Scryfall’s records, and that it keeps it',
    said.includes('Scryfall no longer has a record of the printing of Darklight Phoenix in this deck, so its price and legality cannot be read. The deck keeps it under the name saved with it.'),
    said)
  check('and claims nothing was replaced', !/has replaced its record/.test(said), said)
  // "Has not loaded yet" invites waiting for something that is never coming, and
  // the sentence above has already said what happened.
  check('and does not also say the card has not loaded yet, beside the sentence that explains it',
    !/has not loaded yet/.test(said), said)
  check('the sentence is announced, since it arrives long after the page has painted',
    (await page.locator('.banner[role="status"]', { hasText: /no longer has a record/ }).count()) === 1,
    await page.locator('.banner').evaluateAll((els) => els.map((e) => `${e.className}[${e.getAttribute('role')}]`).join(' | ')))

  const saved = await storedDeck(page, DECK.id)
  check('the deck is left exactly as it was: the entry, its quantity and its name all stay',
    JSON.stringify(saved.main) === JSON.stringify(DECK.main), JSON.stringify(saved.main))

  const row = await phoenixRow(page)
  check('the row shows the name the deck saved, and says the card did not load',
    row.count === 1 && row.missing && /Darklight Phoenix — not loaded/.test(row.text), JSON.stringify(row))

  await page.getByRole('tab', { name: 'Import / export' }).click()
  await page.waitForTimeout(400)
  const exported = await page.getByLabel('This deck as a plain text list').inputValue()
  check('the export writes it by name, with no printing it cannot know, and no id',
    /^4 Darklight Phoenix$/m.test(exported) && !/unloaded/.test(exported) && /^4 Lightning Bolt \(MSC\) 806$/m.test(exported),
    exported.split('\n').filter(Boolean).join(' | '))
  await page.getByRole('tab', { name: 'List' }).click()
  await page.waitForTimeout(300)
  await axe(page, 'the deck editor holding a printing Scryfall has dropped')

  // The grid, where the card has no painting to show and its name is the whole
  // tile. Swept as well as read: the name used to sit at the faintest text
  // token, which is the one thing on the tile worth reading.
  await page.getByRole('group', { name: 'How to show the deck' }).getByRole('button', { name: 'Grid' }).click()
  await page.waitForTimeout(300)
  const tile = page.locator('.deck-tile--missing')
  check('the grid draws the tile under the name the deck saved', (await tile.count()) === 1
    && /Darklight Phoenix/.test((await tile.first().innerText()).replace(/\s+/g, ' ')),
    (await tile.first().innerText().catch(() => '')).replace(/\s+/g, ' '))
  const colours = await tile.first().evaluate((el) => ({
    name: getComputedStyle(el.querySelector('.deck-tile__name')).color,
    aside: getComputedStyle(el.querySelector('.faint')).color,
  }))
  check('and not at the same faint token as the words beside it',
    colours.name !== colours.aside, JSON.stringify(colours))
  check('and the words "not loaded" are not set as code',
    (await tile.locator('.mono').count()) === 0,
    (await tile.first().innerHTML()).replace(/\s+/g, ' '))
  await axe(page, 'the deck editor in grid view holding a printing Scryfall has dropped')
  await page.getByRole('group', { name: 'How to show the deck' }).getByRole('button', { name: 'List' }).click()
  await page.waitForTimeout(250)

  // Opened again that evening: still no request for the migrations, because the
  // answer is on the device, and still the same deck.
  const before = migrations.length
  await page.clock.setSystemTime(new Date('2026-09-23T20:00:00Z'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.deck-title').waitFor()
  await page.waitForTimeout(900)
  check('the migrations are read once and kept, not asked for again the same day',
    migrations.length === before, `${before} then ${migrations.length}`)
  check('and the deck still says so, from what it saved', /no longer has a record/.test(await banners(page)), await banners(page))
  await context.close()
}

console.log('\nThe migrations cannot be read')
{
  const { context, page } = await profile()
  const asked = []
  let migrations = 0
  let answer = { status: 503, contentType: 'application/json', body: '{"object":"error","status":503}' }
  await page.route('**/api.scryfall.com/cards/collection', collection([MOUNTAIN, BOLT], asked))
  await page.route('**/api.scryfall.com/migrations**', (route) => { migrations++; return route.fulfill(answer) })
  await saveAndOpen(page, DECK)
  await until(async () => migrations > 0)
  await page.waitForTimeout(600)

  check('the migrations are asked for once and not retried: nobody is waiting on them',
    migrations === 1, String(migrations))
  const saved = await storedDeck(page, DECK.id)
  check('the deck is left exactly as it was: no id rewritten on a guess',
    JSON.stringify(saved.main) === JSON.stringify(DECK.main), JSON.stringify(saved.main))
  const said = await banners(page)
  check('the deck says the printing is no longer in Scryfall’s records, which is what Scryfall itself said',
    /no longer has a record of the printing of Darklight Phoenix/.test(said) && !/has replaced its record/.test(said), said)
  const row = await phoenixRow(page)
  check('and the row shows the name the deck saved', row.count === 1 && /Darklight Phoenix — not loaded/.test(row.text), JSON.stringify(row))

  // Nothing was kept from the failure, so the next open asks again — and this
  // time Scryfall answers, and the merge is followed.
  answer = migrationList([MERGE])
  await page.route('**/api.scryfall.com/cards/collection', collection([MOUNTAIN, BOLT, PHOENIX_AGAIN], asked))
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.deck-title').waitFor()
  const followed = await until(async () => (await storedDeck(page, DECK.id))?.main?.some((e) => e.cardId === PHOENIX_AGAIN.id))
  check('a failure is not remembered as an answer: asked again, and then followed',
    followed && migrations === 2, `${migrations} request(s); ${JSON.stringify((await storedDeck(page, DECK.id))?.main)}`)
  await context.close()
}

/*
 * The table deals what the deck lists, whether a record for a card exists or
 * not, so a printing Scryfall has dropped is four faceless cards on the
 * battlefield — and one it has merged is another printing's painting, its set
 * and its collector number, sent to the rules engine. Neither is in `missing`,
 * so the table's own "could not be loaded" banner says nothing about either.
 */
console.log('\nAt the table, with a printing Scryfall no longer has')
{
  const { context, page } = await profile()
  const asked = []
  await page.route('**/api.scryfall.com/cards/collection', collection([MOUNTAIN, BOLT], asked))
  await page.route('**/api.scryfall.com/migrations**', (route) => route.fulfill(migrationList([DELETION])))
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate((deck) => localStorage.setItem('mtg-companion:v1', JSON.stringify({
    version: 4, collection: {}, decks: [deck], games: [],
    guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
  })), DECK)
  // A hash change alone does not reload, so the deck just written would not be
  // read: the address is set and then the page is loaded at it.
  await page.goto(`${TARGET}#/game/${DECK.id}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.game').waitFor()
  await until(async () => /no longer has a record/.test(await banners(page)))

  const said = await banners(page)
  check('the table says which printing Scryfall has dropped, and why those cards have no face',
    said.includes("Scryfall no longer has a record of this deck's printing of Darklight Phoenix, so its copies are on the table with no painting and no printed face."),
    said)
  check('and it is announced, since it arrives after the deal',
    (await page.locator('.banner[role="status"]', { hasText: /no longer has a record/ }).count()) === 1, said)
  check('the deal happened all the same: the deck is dealt whether a record exists or not',
    (await page.locator('.tabletop__handcard').count()) > 0,
    String(await page.locator('.tabletop__handcard').count()))
  await axe(page, 'the table holding a printing Scryfall has dropped')
  await context.close()
}

console.log('\nAt the table, with a printing Scryfall has replaced')
{
  const { context, page } = await profile()
  const asked = []
  await page.route('**/api.scryfall.com/cards/collection', collection([MOUNTAIN, BOLT, PHOENIX_AGAIN], asked))
  await page.route('**/api.scryfall.com/migrations**', (route) => route.fulfill(migrationList([MERGE])))
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate((deck) => localStorage.setItem('mtg-companion:v1', JSON.stringify({
    version: 4, collection: {}, decks: [deck], games: [],
    guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
  })), DECK)
  // A hash change alone does not reload, so the deck just written would not be
  // read: the address is set and then the page is loaded at it.
  await page.goto(`${TARGET}#/game/${DECK.id}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.game').waitFor()
  await until(async () => /has replaced its record/.test(await banners(page)))

  const said = await banners(page)
  check('the table says the printing it is playing is the one Scryfall now points at, and that the deck is unchanged',
    said.includes('Scryfall has replaced its record of Darklight Phoenix: this table is playing its new printing. The deck still holds the old one until you open it in the editor.'),
    said)
  const saved = await storedDeck(page, DECK.id)
  check('and the table itself rewrites nothing: only the editor, where there is a save to hang it on',
    JSON.stringify(saved.main) === JSON.stringify(DECK.main), JSON.stringify(saved.main))
  await axe(page, 'the table holding a printing Scryfall has replaced')
  await context.close()
}

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
