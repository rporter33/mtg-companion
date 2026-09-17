#!/usr/bin/env node
/**
 * Keeping your data, in the browser.
 *
 * There are no accounts, so the only copy of a person's decks is the one in
 * this browser. The things worth guarding: that a backup can be taken and put
 * back whole, that the app asks for one when it should and not otherwise, and
 * that a save the browser refuses is rescued and said so — not lost quietly.
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
const CARDS = [c('cmdr', 'Test Commander', 'Legendary Creature — Elf'), c('elf', 'Llanowar Elves', 'Creature — Elf Druid')]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 430, height: 1300 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))

const seed = (extra = {}) => page.evaluate((extra) => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 4, collection: {},
  decks: [{
    id: 'd1', name: 'Kept Deck', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'elf', quantity: 4, category: 'Ramp' }], sideboard: [], categoryOrder: ['Ramp'],
    versions: [{ id: 'v1', at: '2026-02-01T00:00:00Z', label: 'first', auto: false, main: [{ cardId: 'elf', quantity: 4 }], sideboard: [], commanders: ['cmdr'], signatureSpell: null, categoryOrder: [] }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { deckView: 'list', ...extra },
})), extra)

const goDecks = async () => { await page.getByRole('button', { name: 'Decks', exact: true }).click(); await page.waitForTimeout(400) }
const openData = async () => { await page.getByRole('button', { name: 'Your data' }).click(); await page.waitForTimeout(600) }
const body = () => page.locator('.app__main').innerText()

await page.goto(TARGET, { waitUntil: 'networkidle' })
await seed()
await page.reload({ waitUntil: 'networkidle' })
await goDecks()

console.log('\nAsking for a backup when it should')
check('a deck with no backup ever is flagged on the Decks screen', /no backup yet/.test(await body()), (await body()).slice(0, 200))
await openData()
check('the screen states the size and the assumed limit', /KB of about 5\.00 MB|B of about 5\.00 MB/.test(await body()), (await body()).match(/.{0,40}of about.{0,20}/)?.[0])
// Fact labels are upper-cased by CSS and innerText reflects it.
check('and breaks it down by what it is spent on', /Deck history[\s\S]*1 versions/i.test(await body()))
check('it says where the data lives', /saved in this browser/.test(await body()))

console.log('\nTaking one')
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Download a backup' }).click(),
])
const file = await download.path()
const text = (await import('node:fs')).readFileSync(file, 'utf8')
const parsed = JSON.parse(text)
check('the file is the whole store', parsed.decks?.[0]?.name === 'Kept Deck' && Array.isArray(parsed.decks[0].versions) && 'collection' in parsed)
check('including the fields added since version 1',
  parsed.decks[0].main[0].category === 'Ramp' && parsed.decks[0].categoryOrder[0] === 'Ramp' && parsed.decks[0].versions[0].label === 'first')
await page.waitForTimeout(300)
check('the nudge is satisfied once a backup is taken', /nothing has changed since/.test(await body()), (await body()).match(/.{0,60}backup.{0,60}/)?.[0])
await page.getByRole('button', { name: '← Decks' }).click()
await page.waitForTimeout(400)
check('and gone from the Decks screen', !/no backup yet/.test(await body()))

console.log('\nPutting it back')
await page.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({ version: 4, decks: [], collection: {}, games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {} })))
await page.reload({ waitUntil: 'networkidle' })
await goDecks()
check('starting from nothing', !/Kept Deck/.test(await body()))
await openData()
await page.locator('input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) })
await page.waitForTimeout(400)
check('a chosen file asks merge or replace before touching anything', /merge it into what is here, or replace everything/.test(await body()))
await page.getByRole('button', { name: 'Replace everything' }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '← Decks' }).click()
await page.waitForTimeout(400)
check('the deck is back', /Kept Deck/.test(await body()))
await page.locator('.deck-card__open').first().click()
await page.waitForTimeout(800)
await page.getByRole('tab', { name: 'History' }).click()
await page.waitForTimeout(400)
check('with its history', /first/.test(await body()) && (await page.locator('.version').count()) === 1)

console.log('\nA file that could not be read')
await page.evaluate(() => localStorage.setItem('mtg-companion:v1:corrupt', '{"decks":[{"name":"half a dec'))
await page.reload({ waitUntil: 'networkidle' })
await goDecks()
await openData()
check('is offered back rather than hidden', /could not be read/.test(await body()) && (await page.getByRole('button', { name: 'Download it' }).count()) === 1)
await page.getByRole('button', { name: 'Discard it' }).click()
await page.waitForTimeout(300)
check('and can be let go of', !/could not be read/.test(await body()))

console.log('\nA save the browser refuses')
await page.getByRole('button', { name: '← Decks' }).click()
await page.waitForTimeout(300)
// Two things a refusal test has to get right. The write must GROW the store:
// a quantity of 4 becoming 5 is an identical-length string, and browsers
// replace a key at the same size without complaint. And the ballast that
// fills storage has to be topped up finely, or the leftover headroom is
// bigger than the write and nothing is refused. Saving a labelled version
// is a real action that grows the store by a whole version.
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  // The current list must differ from the newest version, or "Save version"
  // is correctly disabled as a duplicate and there is nothing to squeeze in.
  raw.decks[0].main[0].quantity = 3
  raw.decks[0].versions = [
    ...raw.decks[0].versions,
    // Under MAX_VERSIONS (30) on purpose. At the cap, captureVersion's own
    // pruning drops a fat checkpoint while adding a small version — a net
    // shrink the browser accepts — and the refusal this tests never happens.
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `auto${i}`, at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`, label: '', auto: true,
      main: Array.from({ length: 40 }, (_, j) => ({ cardId: `filler-${j}`, quantity: 1 })), sideboard: [], commanders: [],
    })),
  ]
  localStorage.setItem('mtg-companion:v1', JSON.stringify(raw))
  const fill = (size, prefix) => {
    for (let i = 0; i < 4000; i++) {
      try { localStorage.setItem(`${prefix}-${i}`, 'x'.repeat(size)) } catch { return }
    }
  }
  fill(256 * 1024, 'big'); fill(4 * 1024, 'mid'); fill(64, 'small')
})
await page.reload({ waitUntil: 'networkidle' })
await goDecks()
await page.locator('.deck-card__open').first().click()
await page.waitForTimeout(800)
await page.getByRole('tab', { name: 'History' }).click()
await page.waitForTimeout(400)
const versionsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1')).decks[0].versions.length)
await page.getByLabel('Version label').fill('Squeezed in when storage was full')
await page.getByRole('button', { name: 'Save version' }).click()
await page.waitForTimeout(900)
const after = await body()
const rescued = /checkpoints? (was|were) dropped to make room/.test(after)
const refused = /could not be saved/.test(after)
check('the refusal is either rescued by thinning history or announced — never silent', rescued || refused, after.slice(0, 240).replace(/\n/g, ' | '))
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1')))
if (rescued) {
  check('the new version itself was saved', stored.decks[0].versions.some((v) => v.label === 'Squeezed in when storage was full'))
  // Adding one and ending with no more than before means at least one went.
  check('room was made by dropping automatic checkpoints, not labelled ones',
    stored.decks[0].versions.length <= versionsBefore && stored.decks[0].versions.some((v) => v.label === 'first'),
    `${versionsBefore} before, ${stored.decks[0].versions.length} after`)
} else {
  check('and a refused save leaves what was stored untouched', stored.decks[0].versions.length === versionsBefore)
}
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^(big|mid|small)-/.test(k)) localStorage.removeItem(k) })

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
