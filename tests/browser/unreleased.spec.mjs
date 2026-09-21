#!/usr/bin/env node
/**
 * Browser checks for printings that are not out yet.
 *
 * Scryfall lists a set's cards from the day they are previewed, and a name on
 * its own gets Scryfall's pick for it, unreleased sets included: on
 * 2026-09-21 a bare "Island" came back as Star Trek's #319, due on 13
 * November. So when Scryfall's pick is not out, the app takes the newest
 * printing that is out on paper; a printing the player typed is kept and
 * labelled, in every view of the deck, the card's own page and search; a
 * Standard deck holding a card from a set not yet out is warned about, not
 * failed, and nothing not out is ever blocked from being added; and a copied
 * list carries each printing.
 *
 * The page's clock is held at a fixed day and the Scryfall answers are the
 * objects Scryfall itself sent on 2026-09-21 (tests/fixtures/
 * scryfall-unreleased.json), so this means the same thing in 2030 as it did
 * the week it was written: first on 21 Sep 2026, with Reality Fracture and
 * Star Trek both still to come, then on 13 Nov 2026, the day Star Trek comes
 * out, when the same printing is simply out.
 */

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

// The captured objects point at Scryfall's image and icon servers. The
// service worker fetches card images itself, and a worker's request never
// passes through the page's routes, so the images are swapped for a local one
// rather than intercepted: a run never leaves the machine.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/scryfall-unreleased.json', import.meta.url), 'utf8'))
const CARDS = FIXTURE.cards.map((card) => ({
  ...card,
  image_uris: Object.fromEntries(Object.keys(card.image_uris ?? {}).map((size) => [size, PNG])),
}))
const SETS = FIXTURE.sets.map((set) => ({ ...set, icon_svg_uri: '' }))
const print = (set, number) => CARDS.find((c) => c.set === set && c.collector_number === number)

// Star Trek's Island is out on 13 Nov 2026, The Hobbit's were out on 14 Aug,
// the Marvel Lightning Bolt on 26 Jun. Darklight Phoenix is new in Reality
// Fracture, out on 2 Oct: Standard not_legal, Future Standard legal.
const TRK_ISLAND = print('trk', '319')
const HOB_ISLAND = print('hob', '195')
const HOB_MOUNTAIN = print('hob', '197')
const MSC_BOLT = print('msc', '806')
const PHOENIX = print('fra', '53')

// Scryfall's pick for a name alone, which is its own choice and not always
// its newest printing. For Island and Lightning Bolt these are what its
// collection endpoint answered on 2026-09-21; every printing of Darklight
// Phoenix is Reality Fracture's.
const PICK = {
  island: TRK_ISLAND,
  'lightning bolt': MSC_BOLT,
  'darklight phoenix': PHOENIX,
}

const list = (data) => ({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', total_cards: data.length, has_more: false, data }) })

/**
 * A search typed into the app (the Cards tab, Add cards): the fixture's cards
 * whose name the query contains, Scryfall's pick for each unless a set is
 * named, kept to the format pool the query asks for. Scryfall keeps a card
 * that is not out out of every `legal:` pool, and lists it in Future
 * Standard's; the fixture's legalities say exactly that.
 */
function typedSearch(q) {
  const lower = q.toLowerCase()
  const set = lower.match(/(?:^|[\s(])(?:set|s|e):(\w+)/)?.[1]
  const legal = lower.match(/legal:(\w+)/)?.[1]
  const inPool = (c) => (/legal:future/.test(lower)
    ? c.legalities.standard === 'legal' || c.legalities.future === 'legal'
    : !legal || c.legalities[legal] === 'legal')
  return [...new Set(CARDS.map((c) => c.name.toLowerCase()))]
    .filter((name) => lower.includes(name))
    .map((name) => (set ? CARDS.find((c) => c.name.toLowerCase() === name && c.set === set) : PICK[name]))
    .filter((c) => c && inPool(c))
}

/**
 * Scryfall as it stood on 2026-09-21, answering as of `now`. Only a search's
 * `date<=now` depends on the day; everything else is what Scryfall sent.
 * `searched` records the searches for a printing that is out, `typed` the
 * searches typed into the app.
 */
async function mockScryfall(page, now, searched, typed = []) {
  // Registered first: Playwright tries the route added last first, so this
  // catch-all only answers what nothing below recognises.
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill(list([])))
  await page.route('**/api.scryfall.com/sets', (route) => route.fulfill(list(SETS)))
  await page.route('**/api.scryfall.com/cards/collection', (route) => {
    const { identifiers = [] } = JSON.parse(route.request().postData() ?? '{}')
    const data = []
    const not_found = []
    for (const id of identifiers) {
      const card = id.id ? CARDS.find((c) => c.id === id.id)
        : id.collector_number ? print(id.set, id.collector_number)
          : id.set ? CARDS.find((c) => c.set === id.set && c.name.toLowerCase() === id.name?.toLowerCase())
            : PICK[id.name?.toLowerCase()]
      if (card) data.push(card)
      else not_found.push(id)
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ object: 'list', not_found, data }) })
  })
  await page.route('**/api.scryfall.com/cards/named**', (route) => {
    const params = new URL(route.request().url()).searchParams
    const card = PICK[(params.get('exact') ?? params.get('fuzzy') ?? '').toLowerCase()]
    return card
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(card) })
      : route.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ object: 'error', code: 'not_found', status: 404, details: 'No cards found matching that name.' }) })
  })
  // A misspelt name has close matches, as Scryfall's autocomplete gives them.
  await page.route('**/api.scryfall.com/cards/autocomplete**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ object: 'catalog', data: /^isl/i.test(q) ? ['Island'] : [] }) })
  })
  // The search for a printing that is out: by oracle id, the newest released
  // paper printing of each, which is what `date<=now game:paper prefer:newest
  // unique=cards` returns. Nothing matching is a 404, as it is from Scryfall.
  // The same oracle id with unique=prints is a card's page listing every
  // printing, newest first as order=released sends them, and a search with
  // no oracle id is one typed into the app.
  await page.route('**/api.scryfall.com/cards/search**', (route) => {
    const params = new URL(route.request().url()).searchParams
    const q = params.get('q') ?? ''
    if (!q.includes('oracleid:')) {
      typed.push(q)
      return route.fulfill(list(typedSearch(q)))
    }
    const ids = [...q.matchAll(/oracleid:([\w-]+)/g)].map((m) => m[1])
    if (params.get('unique') === 'prints') {
      return route.fulfill(list(CARDS.filter((c) => ids.includes(c.oracle_id))
        .sort((a, b) => b.released_at.localeCompare(a.released_at))))
    }
    searched.push(q)
    const data = ids.map((id) => CARDS
      .filter((c) => c.oracle_id === id && c.released_at <= now && c.games.includes('paper') && !c.digital)
      .sort((a, b) => b.released_at.localeCompare(a.released_at))[0]).filter(Boolean)
    return data.length
      ? route.fulfill(list(data))
      : route.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ object: 'error', code: 'not_found', status: 404, details: 'Your query didn’t match any cards.' }) })
  })
}

const errors = []
const offsite = new Set()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

/**
 * A fresh browser profile whose clock reads `day`, 10:00 UTC, and moves on
 * from there, with a deck of Mountains already made, Standard unless
 * `formatId` says otherwise. Timers run as they would, so nothing in the app
 * waits on a clock that never moves.
 */
async function openDeck(day, mountains, formatId = 'standard') {
  const context = await browser.newContext({ viewport: { width: 420, height: 1000 } })
  await context.clock.install({ time: new Date(`${day}T10:00:00Z`) })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${day}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // Scryfall answers a name it cannot place with a 404, which the browser
    // logs; the misspelt name below is meant to get exactly that.
    if (/status of 404/.test(m.text()) && /api\.scryfall\.com\/cards\/named\?fuzzy=Islnd/.test(m.location()?.url ?? '')) return
    errors.push(`${day}: ${m.text()} (${m.location()?.url ?? ''})`)
  })
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname
    if (host && !['localhost', '127.0.0.1', 'api.scryfall.com'].includes(host)) offsite.add(host)
  })
  const searched = []
  const typed = []
  await mockScryfall(page, day, searched, typed)

  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate(({ id, quantity, formatId }) => localStorage.setItem('mtg-companion:v1', JSON.stringify({
    version: 4, collection: {},
    decks: [{
      id: 'not-out', name: 'Not Out Yet', formatId, commanders: [], signatureSpell: null,
      categoryOrder: [], versions: [], main: [{ cardId: id, quantity }], sideboard: [],
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    }],
    games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: { deckView: 'list' },
  })), { id: HOB_MOUNTAIN.id, quantity: mountains, formatId })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.deck-card__open').first().click()
  await page.waitForTimeout(900)
  return { context, page, searched, typed }
}

async function review(page, text) {
  await page.getByRole('tab', { name: 'Import / export' }).click()
  await page.waitForTimeout(300)
  await page.getByLabel('Decklist to import').fill(text)
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Review import' }).click()
  await page.getByRole('button', { name: /Add \d+ cards/ }).waitFor({ timeout: 15000 })
  return (await page.locator('.import-line').allInnerTexts()).map((l) => l.replace(/\s+/g, ' ').trim())
}

async function listTab(page) {
  await page.getByRole('tab', { name: 'List' }).click()
  await page.waitForTimeout(600)
}

/** A deck row by its card's name and quantity, with the label beside it, if any. */
async function rows(page, name) {
  const found = page.locator('.deck-row').filter({ has: page.locator('.deck-row__name', { hasText: new RegExp(`^${name}$`) }) })
  const out = []
  for (let i = 0; i < await found.count(); i++) {
    const row = found.nth(i)
    out.push({
      quantity: Number(await row.locator('.deck-row__qty').first().innerText()),
      label: await row.locator('.not-out').count() ? await row.locator('.not-out').innerText() : '',
    })
  }
  return out
}

/** The deck's verdict chip, beside the way back to the shelf. */
async function verdict(page) {
  const chip = page.locator('.row').filter({ has: page.locator('button', { hasText: '← Decks' }) }).locator('.chip').first()
  return { text: (await chip.innerText()).trim(), className: (await chip.getAttribute('class')) ?? '' }
}

/** Chooses how the deck is shown: List, Grid or Text. */
async function showAs(page, name) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForTimeout(500)
}

/** A located element's text and box, or nothing when it is not there. */
async function labelOf(locator) {
  if (!(await locator.count())) return { label: '', box: null }
  return { label: (await locator.first().innerText()).trim(), box: await locator.first().boundingBox() }
}

/** Whether two boxes share any area: a label goes beside an image, never on it. */
const overlaps = (a, b) => !!a && !!b
  && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** The grid's tiles for a card, each with its quantity, its label and the card image's box. */
async function tiles(page, name) {
  const out = []
  for (const tile of await page.locator('.deck-tile').filter({ has: page.locator(`.deck-tile__art img[alt="${name}"]`) }).all()) {
    const { label, box } = await labelOf(tile.locator('.not-out'))
    out.push({
      quantity: (await tile.locator('.deck-tile__qty').textContent()).trim(),
      label, chip: box,
      image: await tile.locator('.deck-tile__art .cardimage img').boundingBox(),
    })
  }
  return out
}

/** The text view's lines for a card, each with its quantity and label. */
async function textRows(page, name) {
  const out = []
  for (const row of await page.locator('.text-row').filter({ has: page.locator('.text-row__name', { hasText: new RegExp(`^${name}$`) }) }).all()) {
    out.push({ row, quantity: (await row.locator('.text-row__qty').textContent()).trim(), label: (await labelOf(row.locator('.not-out'))).label })
  }
  return out
}

/** Opens a card's page from a button bearing its name, and returns the sheet. */
async function openCard(page, button, name) {
  await button.click()
  const sheet = page.getByRole('dialog', { name })
  await sheet.waitFor()
  await page.waitForTimeout(300)
  return sheet
}

async function sheetTab(sheet, name) {
  await sheet.getByRole('tab', { name, exact: true }).click()
  await sheet.page().waitForTimeout(400)
}

async function closeSheet(page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(300)
}

/** One fact from a card page's Details tab, or null when it is not shown. */
async function fact(sheet, label) {
  await sheetTab(sheet, 'Details')
  const found = sheet.locator('.fact').filter({ has: sheet.page().locator('dt', { hasText: new RegExp(`^${label}$`) }) })
  return (await found.count()) ? (await found.locator('dd').textContent()).trim() : null
}

/** The printings on a card's page, in the order shown, each with its label. */
async function printingRows(sheet) {
  await sheetTab(sheet, 'Printings')
  await sheet.locator('.printing').first().waitFor()
  const out = []
  for (const row of await sheet.locator('.printing').all()) {
    out.push({
      set: (await row.locator('.printing__set').textContent()).trim(),
      showing: (await row.getAttribute('aria-current')) === 'true',
      label: (await labelOf(row.locator('.not-out'))).label,
    })
  }
  return out
}

/** A card page's Legality tab: each format's status as written, and the note under it. */
async function legality(sheet) {
  await sheetTab(sheet, 'Legality')
  const statuses = {}
  for (const row of await sheet.locator('.legality').all()) {
    const [format, status] = (await row.locator('span').allTextContents()).map((t) => t.trim())
    statuses[format] = status
  }
  const note = sheet.locator('.legality-grid + p')
  return { statuses, note: (await note.count()) ? (await note.innerText()).replace(/\s+/g, ' ').trim() : '' }
}

/** axe-core over the whole page, held to the bar tests/browser/a11y.spec.mjs holds. */
async function axe(page, label) {
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

console.log('\nOn 21 Sep 2026, importing a bare name, a typed printing and a new card')
const first = await openDeck('2026-09-21', 35)
{
  const { page, searched } = first
  const lines = await review(page, '20 Island\n1 Island (TRK) 319\n4 Darklight Phoenix')
  check('the review has one line per card', lines.length === 3, lines.join(' | '))
  check("a bare Island lands on The Hobbit's #195, the newest that is out, not Star Trek's",
    /^20 Island The Hobbit #195\b/.test(lines[0]) && !/Not out until/.test(lines[0]), lines[0])
  check("the review says Scryfall's pick for the name is not out until 13 Nov 2026, and calls it no more than its pick",
    lines[0]?.includes("Scryfall's pick for the name, Star Trek, is not out until 13 Nov 2026, so the app took the newest paper printing that is out.")
      && !/newest printing,/.test(lines[0]),
    lines[0])
  check('a typed Star Trek Island is kept as typed, labelled, with no note',
    /^1 Island Star Trek #319 Not out until 13 Nov 2026$/.test(lines[1] ?? ''), lines[1])
  check('a new card with no printing out keeps its preview, labelled, and says why',
    /^4 Darklight Phoenix Reality Fracture #53 Not out until 2 Oct 2026\b/.test(lines[2] ?? '')
      && lines[2].includes('Scryfall lists no paper printing of it that is out yet.'), lines[2])
  const q = searched[0] ?? ''
  check('both picks that are not out are asked about in one search, by oracle id, with no style filter',
    searched.length === 1 && q.includes(`oracleid:${HOB_ISLAND.oracle_id}`) && q.includes(`oracleid:${PHOENIX.oracle_id}`)
      && /date<=now/.test(q) && !/is:default|universesbeyond|not:ub|is:ub/.test(q) && [...q].length <= 1000,
    searched.join(' | '))
  const body = await page.locator('body').innerText()
  check('the review counts every card and the one exact printing',
    /25 cards found/.test(body) && /1 exact printing\b/.test(body), body.match(/\d+ cards found[^\n]*/)?.[0])
  await axe(page, 'the import review')

  await page.getByRole('button', { name: 'Add 25 cards' }).click()
  await page.waitForTimeout(700)
  await listTab(page)

  const islands = await rows(page, 'Island')
  const typed = islands.find((r) => r.quantity === 1)
  const chosen = islands.find((r) => r.quantity === 20)
  check('the two Islands stay two rows', islands.length === 2, JSON.stringify(islands))
  check('the typed Star Trek Island\'s row shows "Not out until 13 Nov 2026"',
    typed?.label === 'Not out until 13 Nov 2026', JSON.stringify(typed))
  check("The Hobbit's Islands carry no label", chosen && chosen.label === '', JSON.stringify(chosen))
  const [phoenix] = await rows(page, 'Darklight Phoenix')
  check('the Reality Fracture card is in the deck, labelled', phoenix?.label === 'Not out until 2 Oct 2026', JSON.stringify(phoenix))
  const [mountains] = await rows(page, 'Mountain')
  check('a card that is out has no label', mountains?.label === '', JSON.stringify(mountains))

  console.log('\nA Standard deck holding a card that is not out')
  const body2 = await page.locator('body').innerText()
  check('the deck is otherwise complete', /\b60\/60\b/.test(body2))
  const v = await verdict(page)
  check('the verdict is a warning, not an error', /\bchip--warn\b/.test(v.className) && !/\bchip--error\b/.test(v.className),
    `${v.text} [${v.className}]`)
  // Four Phoenixes and the typed Star Trek Island: every copy labelled "Not
  // out until" on its row, the Island though Scryfall already calls it legal.
  check('the verdict is not plain "Legal", and counts every copy labelled not out',
    v.text !== 'Legal' && v.text === '5 cards not out yet', v.text)
  check('there is no error banner', (await page.locator('.banner--error').count()) === 0,
    await page.locator('.banner--error').innerText().catch(() => ''))
  const warning = page.locator('.banner--warn', { hasText: 'Darklight Phoenix' })
  check("the warning names the card, its date and Scryfall's Future Standard",
    (await warning.count()) === 1 && /Darklight Phoenix is not out until 2 Oct 2026\. Scryfall's Future Standard lists it/.test(await warning.innerText()),
    await warning.innerText().catch(() => 'no warning'))
  await axe(page, 'the deck editor')

  console.log('\nThe label in the printing picker and every view of the deck, beside the image, never on it')
  const islandRow = (quantity) => page.locator('.deck-row')
    .filter({ has: page.locator('.deck-row__name', { hasText: /^Island$/ }) })
    .filter({ has: page.locator('.deck-row__qty', { hasText: new RegExp(`^${quantity}$`) }) })
  await islandRow(20).getByRole('button', { name: 'Choose which printing of Island is in this deck' }).click()
  const picker = page.locator('section.printings')
  await picker.locator('.printings__print').first().waitFor()
  const offered = []
  for (const row of await picker.locator('.printings__print').all()) {
    offered.push({ set: (await row.locator('strong').textContent()).trim(), label: (await labelOf(row.locator('.not-out'))).label })
  }
  check("the picker offers The Hobbit's Island, the deck's, unlabelled, then Star Trek's, labelled",
    offered.length === 2 && offered[0].set === 'The Hobbit' && offered[0].label === ''
      && offered[1].set === 'Star Trek' && offered[1].label === 'Not out until 13 Nov 2026', JSON.stringify(offered))
  await picker.getByRole('button', { name: 'Done' }).click()
  await page.waitForTimeout(300)

  await showAs(page, 'Grid')
  const islandTiles = await tiles(page, 'Island')
  const trkTile = islandTiles.find((t) => t.quantity === '1')
  const hobTile = islandTiles.find((t) => t.quantity === '20')
  check("in the grid, the Star Trek Island's tile is labelled and The Hobbit's is not",
    trkTile?.label === 'Not out until 13 Nov 2026' && hobTile?.label === '',
    JSON.stringify(islandTiles.map(({ quantity, label }) => ({ quantity, label }))))
  check('the label sits beside the card image, not on it',
    trkTile?.image?.width > 0 && trkTile?.chip && !overlaps(trkTile.chip, trkTile.image),
    JSON.stringify({ chip: trkTile?.chip, image: trkTile?.image }))
  const [phoenixTile] = await tiles(page, 'Darklight Phoenix')
  check('the Reality Fracture tile is labelled too, off its image',
    phoenixTile?.label === 'Not out until 2 Oct 2026' && !overlaps(phoenixTile.chip, phoenixTile.image), JSON.stringify(phoenixTile))

  await showAs(page, 'Text')
  const islandLines = await textRows(page, 'Island')
  const trkLine = islandLines.find((l) => l.quantity === '1')
  const hobLine = islandLines.find((l) => l.quantity === '20')
  check("in the text view, the Star Trek Island's line is labelled and The Hobbit's is not",
    trkLine?.label === 'Not out until 13 Nov 2026' && hobLine?.label === '',
    JSON.stringify(islandLines.map(({ quantity, label }) => ({ quantity, label }))))
  // The panel beside the text view is there only on a wide screen with a pointer.
  await page.setViewportSize({ width: 1200, height: 1000 })
  await page.waitForTimeout(400)
  const panel = page.locator('.deck-preview')
  await trkLine.row.hover()
  await page.waitForTimeout(300)
  const pointed = await labelOf(panel.locator('.not-out'))
  check('pointing at the Star Trek Island shows it in the panel, labelled beside its image',
    (await panel.locator('img[alt="Island"]').count()) === 1 && pointed.label === 'Not out until 13 Nov 2026'
      && !overlaps(pointed.box, await panel.locator('.cardimage img').boundingBox()), pointed.label)
  await hobLine.row.hover()
  await page.waitForTimeout(300)
  check("pointing at The Hobbit's shows it with no label", (await panel.locator('.not-out').count()) === 0)
  await page.setViewportSize({ width: 420, height: 1000 })
  await showAs(page, 'List')

  console.log("\nA card's own page")
  const trkPage = await openCard(page, islandRow(1).locator('.deck-row__name'), 'Island')
  check('the Star Trek Island says when it releases, not that it was released',
    (await fact(trkPage, 'Releases')) === '13 Nov 2026' && (await fact(trkPage, 'Released')) === null)
  const trkPrints = await printingRows(trkPage)
  check("its printings list it first, as the one showing, labelled, and The Hobbit's after it with no label",
    trkPrints.length === 2 && trkPrints[0].set === 'trk' && trkPrints[0].showing && trkPrints[0].label === 'Not out until 13 Nov 2026'
      && trkPrints[1].set === 'hob' && trkPrints[1].label === '', JSON.stringify(trkPrints))
  await closeSheet(page)
  const hobPage = await openCard(page, islandRow(20).locator('.deck-row__name'), 'Island')
  check("The Hobbit's Island says it was released",
    (await fact(hobPage, 'Released')) === '2026-08-14' && (await fact(hobPage, 'Releases')) === null)
  const hobPrints = await printingRows(hobPage)
  check('its printings list it first with no label, and label only the Star Trek one',
    hobPrints.length === 2 && hobPrints[0].set === 'hob' && hobPrints[0].showing && hobPrints[0].label === ''
      && hobPrints[1].set === 'trk' && hobPrints[1].label === 'Not out until 13 Nov 2026', JSON.stringify(hobPrints))
  await closeSheet(page)

  console.log('\nThe copied decklist')
  await page.getByRole('tab', { name: 'Import / export' }).click()
  await page.waitForTimeout(300)
  const exported = await page.getByLabel('This deck as a plain text list').inputValue()
  check('every line carries (SET) and collector number',
    /^35 Mountain \(HOB\) 197$/m.test(exported) && /^20 Island \(HOB\) 195$/m.test(exported)
      && /^1 Island \(TRK\) 319$/m.test(exported) && /^4 Darklight Phoenix \(FRA\) 53$/m.test(exported),
    exported.replace(/\n/g, ' | '))
  const again = await review(page, exported)
  check('pasted back, every line is an exact printing again, and nothing is re-picked',
    again.length === 4 && /4 exact printings/.test(await page.locator('body').innerText()) && searched.length === 1,
    again.join(' | '))
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(300)

  console.log('\nA pick that is out is kept, whatever its set')
  const [bolt] = await review(page, '4 Lightning Bolt')
  check("a bare Lightning Bolt keeps Scryfall's pick, the Marvel printing, with no note and no label",
    bolt === '4 Lightning Bolt Marvel Super Heroes Commander #806', bolt)
  check('and nothing is searched for it', searched.length === 1, searched.join(' | '))
  await page.getByRole('button', { name: 'Cancel' }).click()

  console.log('\nA name picked from the close matches follows the same rule')
  const misspelt = await review(page, '4 Islnd')
  const suggestion = page.getByRole('button', { name: 'Island', exact: true })
  check('a misspelt name finds nothing, and the card it meant is offered',
    misspelt.length === 0 && (await suggestion.count()) === 1, misspelt.join(' | '))
  await suggestion.click()
  await page.locator('.import-line').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
  const [picked] = (await page.locator('.import-line').allInnerTexts()).map((l) => l.replace(/\s+/g, ' ').trim())
  check("picking it lands on The Hobbit's Island, the newest paper printing out, and says why",
    /^4 Island The Hobbit #195\b/.test(picked ?? '')
      && picked.includes("Scryfall's pick for the name, Star Trek, is not out until 13 Nov 2026, so the app took the newest paper printing that is out.")
      && (await page.locator('.import-line .not-out').count()) === 0, picked)
  check('by one more search, as any name gets', searched.length === 2, searched.join(' | '))
  check('and its four cards are ready to add', (await page.getByRole('button', { name: 'Add 4 cards' }).count()) === 1)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await first.context.close()
}

console.log('\nOn 21 Sep 2026, adding a card that is not out from search and from its page')
{
  const { context, page, typed } = await openDeck('2026-09-21', 60)
  await page.getByRole('tab', { name: 'Add cards' }).click()
  await page.waitForTimeout(400)
  await page.getByLabel('Search cards to add').fill('Darklight Phoenix')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('.results-line').waitFor({ timeout: 15000 })
  const result = page.locator('.search-row').filter({ has: page.locator('.deck-row__name', { hasText: /^Darklight Phoenix$/ }) })
  check("a search scoped to Standard takes in Scryfall's Future Standard, and finds the card",
    typed.some((q) => q.includes('Darklight Phoenix') && q.includes('(legal:standard or legal:future)'))
      && (await result.count()) === 1, typed.join(' | '))
  check('the card comes back labelled with its date', (await labelOf(result.locator('.not-out'))).label === 'Not out until 2 Oct 2026')
  check('it is not called illegal, and its + is not held back',
    (await result.count()) === 1 && (await result.locator('.chip--error').count()) === 0
      && await result.getByRole('button', { name: 'Add Darklight Phoenix' }).isEnabled(),
    await result.innerText().catch(() => 'no result'))

  // Its page, opened from the Cards tab as anyone browsing would.
  await page.locator('.app__nav button', { hasText: 'Cards' }).click()
  await page.waitForTimeout(400)
  const cardSearch = page.getByLabel('Search cards', { exact: true })
  await cardSearch.fill('Darklight Phoenix')
  await cardSearch.press('Enter')
  const phoenixTile = page.locator('.card-tile').filter({ has: page.locator('img[alt="Darklight Phoenix"]') })
  await phoenixTile.first().waitFor({ timeout: 15000 })
  const sheet = await openCard(page, phoenixTile.locator('.cardimage'), 'Darklight Phoenix')
  const { statuses, note } = await legality(sheet)
  check('its Legality tab reads Not out yet in Standard and in Commander, not Not in pool',
    statuses.Standard === 'Not out yet' && statuses.Commander === 'Not out yet', JSON.stringify(statuses))
  check("and says only what Scryfall says: the date, its Future Standard, and that it rules on the rest at release",
    note.startsWith("Not out until 2 Oct 2026. Scryfall's Future Standard lists it.")
      && note.includes('when it is released'), note)
  const toDeck = sheet.locator('.detail-layout__art button', { hasText: 'Standard' })
  check('adding it to the Standard deck is offered, marked not out yet, not illegal',
    (await toDeck.locator('.not-out').innerText().catch(() => '')).trim() === 'not out yet'
      && (await toDeck.locator('.chip--error').count()) === 0, await toDeck.innerText().catch(() => 'no deck row'))
  await toDeck.click()
  await page.waitForTimeout(300)
  const added = await sheet.locator('.banner--warn').innerText().catch(() => '')
  check('pressing it adds the card, and says why it is not plainly legal yet',
    added.startsWith("Added to Not Out Yet. Darklight Phoenix is not out until 2 Oct 2026. Scryfall's Future Standard lists it"), added)
  await closeSheet(page)

  console.log('\nThe Cards tab')
  await cardSearch.fill('Island')
  await cardSearch.press('Enter')
  const tile = page.locator('.card-tile').filter({ has: page.locator('img[alt="Island"]') })
  await tile.first().waitFor({ timeout: 15000 })
  const chip = await labelOf(tile.locator('.not-out'))
  check("Scryfall's pick for Island is labelled in the results, beside its image and not on it",
    chip.label === 'Not out until 13 Nov 2026' && !overlaps(chip.box, await tile.locator('.cardimage img').boundingBox()), chip.label)
  await context.close()
}

console.log('\nOn 21 Sep 2026, searching for a card that is not out in a Commander deck')
{
  const { context, page, typed } = await openDeck('2026-09-21', 35, 'commander')
  await page.getByRole('tab', { name: 'Add cards' }).click()
  await page.waitForTimeout(400)
  const box = page.getByLabel('Search cards to add')
  const hint = page.getByText('Looking for cards that are not out yet?')
  await box.fill('Darklight Phoenix')
  await box.press('Enter')
  await page.getByText('No cards matched.').waitFor({ timeout: 15000 })
  check('the scoped search asks for the Commander pool, which holds nothing not out',
    typed.at(-1)?.includes('legal:commander'), typed.at(-1))
  check('an empty result asks whether a card not out is wanted, and says how to see one',
    (await hint.count()) === 1 && /turn off “Legal in Commander” to see them/.test(await hint.innerText()), await hint.innerText().catch(() => 'no hint'))
  await page.getByLabel('Legal in Commander').uncheck()
  const result = page.locator('.search-row').filter({ has: page.locator('.deck-row__name', { hasText: /^Darklight Phoenix$/ }) })
  await result.waitFor({ timeout: 15000 })
  check('unscoped, the card is found, labelled, and can be added',
    (await labelOf(result.locator('.not-out'))).label === 'Not out until 2 Oct 2026'
      && (await result.locator('.chip--error').count()) === 0
      && await result.getByRole('button', { name: 'Add Darklight Phoenix' }).isEnabled(), await result.innerText())
  check('and the question goes, with the scope off', (await hint.count()) === 0)
  await page.getByLabel('Legal in Commander').check()
  await page.getByText('No cards matched.').waitFor({ timeout: 15000 })
  await box.fill('Island set:hob')
  await box.press('Enter')
  await page.locator('.search-row').filter({ has: page.locator('.deck-row__name', { hasText: /^Island$/ }) })
    .waitFor({ timeout: 15000 })
  await page.waitForTimeout(200)
  check('a search naming a set asks the same, though it found cards',
    (await page.locator('.search-row').count()) === 1 && (await hint.count()) === 1,
    `${await page.locator('.search-row').count()} rows, hint ${await hint.count()}`)
  await context.close()
}

console.log('\nOn 13 Nov 2026, the day Star Trek comes out')
{
  const { context, page, searched } = await openDeck('2026-11-13', 55)
  const lines = await review(page, '1 Island (TRK) 319\n4 Island')
  check('the typed Star Trek Island has no label in the review', lines[0] === '1 Island Star Trek #319', lines[0])
  check("a bare Island keeps Scryfall's pick now that it is out, with no note",
    lines[1] === '4 Island Star Trek #319' && searched.length === 0, `${lines[1]} (${searched.length} searches)`)
  await page.getByRole('button', { name: 'Add 5 cards' }).click()
  await page.waitForTimeout(700)
  await listTab(page)
  const islands = await rows(page, 'Island')
  check('the same Star Trek Island shows no chip in the deck',
    islands.length === 1 && islands[0].quantity === 5 && islands[0].label === ''
      && (await page.locator('.not-out').count()) === 0, JSON.stringify(islands))
  const v = await verdict(page)
  check('and the verdict is plain "Legal"', v.text === 'Legal' && /\bchip--ok\b/.test(v.className), `${v.text} [${v.className}]`)

  await showAs(page, 'Grid')
  check('no tile in the grid is labelled',
    (await tiles(page, 'Island')).length === 1 && (await page.locator('.not-out').count()) === 0)
  await showAs(page, 'Text')
  check('no line in the text view is labelled',
    (await textRows(page, 'Island')).length === 1 && (await page.locator('.not-out').count()) === 0)
  await showAs(page, 'List')
  const trkPage = await openCard(page, page.locator('.deck-row__name', { hasText: /^Island$/ }), 'Island')
  check('its page says it was released, on the day it came out',
    (await fact(trkPage, 'Released')) === '2026-11-13' && (await fact(trkPage, 'Releases')) === null)
  const prints = await printingRows(trkPage)
  check('and none of its printings is labelled', prints.length === 2 && prints.every((p) => p.label === '')
    && (await trkPage.locator('.not-out').count()) === 0, JSON.stringify(prints))
  await closeSheet(page)
  await context.close()
}

check('nothing was fetched from anywhere but the app and the mocked Scryfall', offsite.size === 0, [...offsite].join(', '))
check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
