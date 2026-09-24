#!/usr/bin/env node
/**
 * A deck stored with a format this build does not know, as a newer build or
 * a hand-edited backup leaves one. It has no format rules here: it opens,
 * lists, searches and takes cards, with no format scope, no legality chips
 * and no commander button; the editor shows the unknown format and lets the
 * player choose one, saying first that the choice replaces it for good; and
 * the formatId is never rewritten until they do. The first-deck flow forgets
 * such a deck rather than build it by Commander's rules, and the lobby opens
 * on a format it knows. Nothing reaches the screen as a thrown error — not
 * the deck list, the editor's tabs, the card sheet, the lobby or the table.
 *
 * On the way it checks a fault that is not this format's: a card added from
 * the card sheet, with the deck's editor open underneath, survives the
 * editor's next saves (a rename, and choosing the format).
 *
 * Two decks are seeded as deck documents, the way this build writes one: one
 * naming a format from a newer build, one naming "constructor", which every
 * JavaScript object inherits and which a plain lookup took for a format. Each
 * has a commander, a sideboard and a card Scryfall calls banned in Commander,
 * so no Commander rule can sneak back in unseen, and search offers a second
 * legendary creature. Scryfall is mocked, every search's q is recorded, and
 * the page's clock is held on 24 Sep 2026, so this means the same on any day.
 */

import { chromium } from 'playwright'
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
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line, oracle_text: '',
  color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst', set_name: 'Test', collector_number: id,
  released_at: '2020-01-01', legalities: { commander: 'legal', modern: 'legal' }, prices: { usd: '0.50' },
  image_uris: { small: PNG, normal: PNG, art_crop: PNG }, ...over,
})
const CMDR = c('cmdr', 'Strange Commander', 'Legendary Creature — Elf')
const ELF = c('elf', 'Llanowar Elves', 'Creature — Elf Druid', { oracle_text: '{T}: Add {G}.' })
const BEAR = c('bear', 'Cheap Bear', 'Creature — Bear')
// Banned wherever Scryfall has a word for it: in a format with no rules here,
// that word is not the app's to apply.
const BANNED = c('banned', 'Banned Wurm', 'Creature — Wurm', { legalities: { commander: 'banned', modern: 'banned' } })
// A second legendary creature, which Commander's rules would offer as a
// commander (it allows two), so "no commander button" means no rules and not
// merely no card that could be one.
const LEGEND = c('legend', 'Other Legend', 'Legendary Creature — Elf')
const CARDS = [CMDR, ELF, BEAR, BANNED, LEGEND]

// The first-deck flow remembers building the deck in a format from a newer
// build, as it would after a restore from that build's backup.
const ROOT = {
  version: 4, collection: {},
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { deckView: 'list', firstDeck: { deckId: 'strange', step: 'list' } },
}
const deckDoc = (id, name, formatId) => ({
  id, name, formatId, commanders: ['cmdr'], signatureSpell: null, categoryOrder: [], versions: [],
  main: [{ cardId: 'elf', quantity: 3, name: ELF.name }], sideboard: [{ cardId: 'bear', quantity: 2, name: BEAR.name }],
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
})
const stored = (page, id) => page.evaluate((id) => JSON.parse(localStorage.getItem(`mtg-companion:v1:deck:${id}`) ?? 'null'), id)
const storedPrefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1') ?? 'null')?.prefs ?? null)

/** Polls `test` until it holds or `ms` pass, by the real clock, not the page's. */
async function until(test, ms = 10000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test().catch(() => false)) return true
    await sleep(100)
  }
  return false
}

/**
 * axe-core over the whole page, held to the bar tests/browser/a11y.spec.mjs
 * holds, once a card just added has stopped being ringed: axe reads the colour
 * of half-faded text as a contrast failure (see moved.spec.mjs).
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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 430, height: 1200 } })
await context.clock.install({ time: new Date('2026-09-24T12:00:00Z') })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} (${m.location()?.url ?? ''})`) })
const requests = []
// The catch-all first: Playwright gives precedence to the route registered last.
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => {
  const { identifiers = [] } = JSON.parse(route.request().postData() ?? '{}')
  const data = identifiers.map((i) => CARDS.find((card) => card.id === i.id)).filter(Boolean)
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, not_found: [] }) })
})
await page.route('**/api.scryfall.com/cards/search**', (route) => {
  requests.push(new URL(route.request().url()).searchParams.get('q'))
  const data = [BEAR, BANNED, LEGEND]
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, total_cards: data.length, has_more: false }) })
})

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate(({ ROOT, docs }) => {
  localStorage.setItem('mtg-companion:v1', JSON.stringify(ROOT))
  for (const doc of docs) localStorage.setItem(`mtg-companion:v1:deck:${doc.id}`, JSON.stringify(doc))
}, { ROOT, docs: [deckDoc('strange', 'From a Newer Build', 'made-up-format'), deckDoc('inherited', 'Hand Edited', 'constructor')] })
await page.reload({ waitUntil: 'networkidle' })
const main = () => page.locator('main').innerText()
const search = async (act) => {
  const was = requests.length
  await act()
  await until(async () => requests.length > was, 4000)
  await page.waitForTimeout(300)
}

let doc

console.log('\nThe deck list')
await page.goto(`${TARGET}#/decks`, { waitUntil: 'networkidle' })
const tile = page.locator('.deck-card', { hasText: 'From a Newer Build' })
await tile.waitFor({ timeout: 15000 })
check('the deck is listed, under the format it names', /made-up-format/.test(await tile.innerText()), await tile.innerText())
check('with its card count and no size borrowed from another format', /\b3 cards\b/.test(await tile.innerText()) && !/\/\d/.test(await tile.innerText()), await tile.innerText())
const inherited = page.locator('.deck-card', { hasText: 'Hand Edited' })
check('a format named after an inherited property is listed the same way',
  /constructor/.test(await inherited.innerText()) && /\b3 cards\b/.test(await inherited.innerText()), await inherited.innerText())
check('the first deck it was building is not offered back, as the flow would not take it up',
  !/Continue building/.test(await main()), (await main()).slice(0, 300))

console.log('\nThe first-deck flow, remembering a deck in a format it does not know')
// The bare address resumes a deck being built. This one has no format here
// to build it by, so it is forgotten, and the flow starts at the colours
// rather than at its starting list under Commander's rules.
await page.goto(`${TARGET}#/decks/new`)
await until(async () => /#\/decks\/new\/\w+/.test(page.url()), 15000)
await page.getByRole('heading', { name: 'Your first deck' }).waitFor({ timeout: 15000 })
await page.waitForTimeout(300)
check('it starts at the colours, not at the remembered deck\'s list', /#\/decks\/new\/colours$/.test(page.url()), page.url())
check('with no word that the deck is of another format, and no format to keep',
  !/is a\s+deck/.test(await main()) && (await page.getByRole('button', { name: /^Keep / }).count()) === 0, (await main()).slice(0, 400))
check('the flow no longer remembers the deck', (await storedPrefs(page))?.firstDeck?.deckId === null, JSON.stringify((await storedPrefs(page))?.firstDeck))
doc = await stored(page, 'strange')
check('and the deck is as it was, in the format it named', doc.formatId === 'made-up-format' && doc.main.length === 1, JSON.stringify(doc))

console.log('\nThe lobby, while every deck is in a format it does not know')
// A hash change alone does not reload, and the lobby reads the decks once, so
// the address is set and then loaded.
await page.goto(`${TARGET}#/game`)
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.lobby').waitFor({ timeout: 15000 })
let title = await page.locator('.lobby__title').innerText()
check('the lobby opens on a format it knows, not on either format these decks name',
  /Commander/.test(title) && !/constructor|made-up-format|Object/.test(title), title)
check('and no deck in a format it does not know is on a shelf (an open question in the brief)',
  !/From a Newer Build|Hand Edited/.test(await page.locator('.lobby').innerText()), (await page.locator('.lobby').innerText()).slice(0, 400))

console.log('\nThe editor')
await page.goto(`${TARGET}#/decks/strange/list`, { waitUntil: 'networkidle' })
await page.getByRole('tab', { name: 'Add cards' }).waitFor({ timeout: 15000 })
await until(async () => (await page.locator('.deck-row__name', { hasText: 'Llanowar Elves' }).count()) > 0)
check('the deck opens', /From a Newer Build/.test(await page.getByLabel('Deck name').inputValue()))
check('its list shows its cards', (await page.locator('.deck-row__name', { hasText: 'Llanowar Elves' }).count()) > 0, await main())
check('the head names the format as the deck gives it, and no size', /made-up-format/.test(await page.locator('.deck-head').innerText())
  && /\b3 cards\b/.test(await page.locator('.deck-head').innerText()), await page.locator('.deck-head').innerText())
check('the unknown format is shown as the deck\'s problem', /Unknown format "made-up-format"\./.test(await main()), await main())
check('and why nothing is checked', /cannot check this deck against format rules/.test(await main()))
check('with no claim that the deck is illegal in a format', !/not legal in/.test(await main()), (await main()).slice(0, 400))
check('with a format to choose', (await page.getByLabel('Format for this deck').count()) === 1)
check('the choice needs a press, not just a pick', await page.getByRole('button', { name: 'Use this format' }).isDisabled())
check('and says, before the press, that choosing replaces the format it names for good',
  /Choosing one replaces "made-up-format" on this deck for good: History keeps a deck's cards, not its format\./.test(await main()), (await main()).slice(0, 600))
doc = await stored(page, 'strange')
check('opening it rewrote nothing about its format', doc.formatId === 'made-up-format', doc.formatId)
await axe(page, 'the deck editor with a format it does not know')

console.log('\nSearching and adding')
await page.getByRole('tab', { name: 'Add cards' }).click()
const box = page.getByLabel('Search cards to add')
await box.waitFor({ timeout: 10000 })
check('the search box names no format', (await box.getAttribute('placeholder')) === 'Search cards', await box.getAttribute('placeholder'))
check('there is no "Legal in" scope to offer', (await page.getByText(/^Legal in/).count()) === 0)
await box.fill('creature')
await search(() => page.getByRole('button', { name: 'Search', exact: true }).click())
check('the search goes out with no format scope, and nothing standing in for one',
  requests.length > 0 && !/legal:/.test(requests.at(-1)) && !/null|undefined/.test(requests.at(-1)), requests.at(-1))
check('the results are listed', (await page.locator('.search-row').count()) === 3, await main())
const banned = page.locator('.search-row', { hasText: 'Banned Wurm' })
check('no legality chip is shown for a card Scryfall bans elsewhere', !/banned|not legal/.test(await banned.innerText()), await banned.innerText())
check('and it can be added', await banned.getByRole('button', { name: 'Add Banned Wurm' }).isEnabled())
const legendRow = page.locator('.search-row', { hasText: 'Other Legend' })
check('no commander button, with no commander rules, even for a legendary creature',
  (await legendRow.getByTitle('Set as commander').count()) === 0 && (await page.getByTitle('Set as commander').count()) === 0,
  await legendRow.innerText())
const bearRow = page.locator('.search-row', { hasText: 'Cheap Bear' })
check('a card in the sideboard counts as in the deck', /2 in deck/.test(await bearRow.innerText()), await bearRow.innerText())
await bearRow.getByRole('button', { name: 'Add Cheap Bear' }).click()
await until(async () => /3 in deck/.test(await bearRow.innerText()), 4000)
check('the added card counts up, with no copy limit to stop it', /3 in deck/.test(await bearRow.innerText()) && await bearRow.getByRole('button', { name: 'Add Cheap Bear' }).isEnabled(), await bearRow.innerText())
doc = await stored(page, 'strange')
check('the card is saved to the deck', doc.main.some((e) => e.cardId === 'bear' && e.quantity === 1), JSON.stringify(doc.main))
check('and the format it named is kept', doc.formatId === 'made-up-format', doc.formatId)
await axe(page, 'card search in a deck with a format it does not know')

console.log('\nAdding from the card sheet')
const sheet = page.getByRole('dialog')
await legendRow.locator('.deck-row__name').click()
await sheet.getByText('Add to a deck').waitFor({ timeout: 10000 })
check('a legendary creature\'s sheet offers no commander button beside the deck either',
  (await sheet.getByTitle('Set as commander').count()) === 0 && /From a Newer Build/.test(await sheet.innerText()), (await sheet.innerText()).slice(0, 400))
await page.keyboard.press('Escape')
await sheet.waitFor({ state: 'hidden', timeout: 5000 })
await page.locator('.search-row', { hasText: 'Banned Wurm' }).locator('.deck-row__name').click()
await sheet.getByText('Add to a deck').waitFor({ timeout: 10000 })
const sheetRow = sheet.getByRole('button', { name: /From a Newer Build/ })
check('the deck is offered under the format it names', /made-up-format/.test(await sheetRow.innerText()), await sheetRow.innerText())
check('without calling the card illegal there', !/illegal/.test(await sheetRow.innerText()), await sheetRow.innerText())
check('and saying, where it can be seen, that the format is not known', /format not known/.test(await sheetRow.innerText()), await sheetRow.innerText())
check('with no commander button beside it', (await sheet.getByTitle('Set as commander').count()) === 0)
await axe(page, 'the card sheet offering a deck with a format it does not know')
await sheetRow.click()
await until(async () => /Added to From a Newer Build\./.test(await sheet.innerText()), 4000)
check('adding says it was added', /Added to From a Newer Build\./.test(await sheet.innerText()), await sheet.innerText())
doc = await stored(page, 'strange')
check('and it was', doc.main.some((e) => e.cardId === 'banned'), JSON.stringify(doc.main))
check('with the format it named still kept', doc.formatId === 'made-up-format', doc.formatId)
await page.keyboard.press('Escape')
await sheet.waitFor({ state: 'hidden', timeout: 5000 })

console.log('\nThe open editor, after the card sheet saved to its deck')
// The editor was open under the sheet the whole time. It used to hold the deck
// as it had read it, so its next save, a rename included, put the old list back.
check('the editor has the card the sheet added, with no reload', /1 in deck/.test(await banned.innerText()), await banned.innerText())
const nameBox = page.getByLabel('Deck name')
await nameBox.press('End')
await nameBox.pressSequentially('!')
await until(async () => (await stored(page, 'strange'))?.name === 'From a Newer Build!', 4000)
doc = await stored(page, 'strange')
check('renaming the deck keeps the card the sheet added', doc.name === 'From a Newer Build!'
  && doc.main.map((e) => `${e.cardId}:${e.quantity}`).join() === 'elf:3,bear:1,banned:1', JSON.stringify(doc))
await nameBox.fill('From a Newer Build')
await until(async () => (await stored(page, 'strange'))?.name === 'From a Newer Build', 4000)
doc = await stored(page, 'strange')
check('and so does renaming it back', doc.main.some((e) => e.cardId === 'banned'), JSON.stringify(doc.main))

console.log('\nEvery other tab')
for (const [tab, expect] of [['Coach', /does not know this deck.s format/], ['Analysis', null], ['Playtest', null], ['History', null], ['Import / export', null], ['List', /Banned Wurm/]]) {
  await page.getByRole('tab', { name: tab }).click()
  await page.waitForTimeout(700)
  const text = await main()
  // The ErrorBoundary's own words, which a thrown error puts on the screen.
  check(`${tab} opens`, !/Something broke on this screen/.test(text) && (!expect || expect.test(text)), text.slice(0, 300))
}
doc = await stored(page, 'strange')
check('after all of it, the format it named is still kept', doc.formatId === 'made-up-format', doc.formatId)

console.log('\nChoosing a format')
await page.getByLabel('Format for this deck').selectOption('commander')
await page.getByRole('button', { name: 'Use Commander' }).click()
await until(async () => (await stored(page, 'strange'))?.formatId === 'commander', 4000)
doc = await stored(page, 'strange')
check('the chosen format is saved', doc.formatId === 'commander', doc.formatId)
// The card from the sheet among them: the choice is a save the editor builds
// on the deck it holds, as a rename is.
check('and nothing else about the deck changed', doc.main.map((e) => `${e.cardId}:${e.quantity}`).join() === 'elf:3,bear:1,banned:1'
  && doc.sideboard.map((e) => `${e.cardId}:${e.quantity}`).join() === 'bear:2'
  && doc.commanders.join() === 'cmdr' && doc.name === 'From a Newer Build', JSON.stringify(doc))
check('and the deck is checked by it', !/Unknown format/.test(await main()) && /not legal in Commander/.test(await main()), (await main()).slice(0, 400))
check('the Commander rules are back: the banned card is called banned', /Banned Wurm is banned in Commander/.test(await main()), (await main()).slice(0, 600))
const focused = await page.evaluate(() => ({ role: document.activeElement?.getAttribute('role'), text: document.activeElement?.textContent?.replace(/\s+/g, ' ').trim() }))
check('the button pressed has gone, so focus is on a line saying what changed, and what the deck named before',
  focused.role === 'status' && focused.text === 'This deck is now checked against Commander. It named "made-up-format" before.', JSON.stringify(focused))
await axe(page, 'the deck editor once a format is chosen')

console.log('\nCommander\'s rules, now there are some')
// The same legendary creature, which had no commander button while the deck's
// format was unknown: the check above could have failed.
await page.getByRole('tab', { name: 'Add cards' }).click()
await box.waitFor({ timeout: 10000 })
await box.fill('creature')
await search(() => page.getByRole('button', { name: 'Search', exact: true }).click())
check('a legendary creature now has a commander button, as the deck has room for a second',
  (await legendRow.getByTitle('Set as commander').count()) === 1, await legendRow.innerText())
await legendRow.locator('.deck-row__name').click()
await sheet.getByText('Add to a deck').waitFor({ timeout: 10000 })
check('and its sheet offers one beside the deck', (await sheet.getByTitle('Set as commander').count()) === 1, (await sheet.innerText()).slice(0, 400))
await page.keyboard.press('Escape')
await sheet.waitFor({ state: 'hidden', timeout: 5000 })

console.log('\nA format named after an inherited property')
await page.goto(`${TARGET}#/decks/inherited/list`, { waitUntil: 'networkidle' })
await page.getByRole('tab', { name: 'Add cards' }).waitFor({ timeout: 15000 })
await page.waitForTimeout(500)
check('opens as a format this build does not know', /Unknown format "constructor"\./.test(await main()), (await main()).slice(0, 300))
check('and names no format it took from Object', !/\bObject\b|\bFunction\b/.test(await page.locator('.deck-head').innerText()), await page.locator('.deck-head').innerText())

console.log('\nThe lobby and the table')
// A hash change alone does not reload, so each address is set and then loaded.
await page.goto(`${TARGET}#/game`)
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.lobby').waitFor({ timeout: 15000 })
title = await page.locator('.lobby__title').innerText()
check('the lobby opens on a format it knows, not on the inherited name', /Commander/.test(title) && !/constructor|Object/.test(title), title)
check('and the deck in the chosen format is on its shelf', /From a Newer Build/.test(await page.locator('.lobby').innerText()),
  (await page.locator('.lobby').innerText()).slice(0, 400))
await page.goto(`${TARGET}#/game/inherited`)
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.game').waitFor({ timeout: 15000 })
await until(async () => (await page.locator('.tabletop__handcard').count()) > 0)
check('a deck in a format it does not know is dealt at the table all the same',
  (await page.locator('.tabletop__handcard').count()) > 0 && !/Something broke on this screen/.test(await main()),
  String(await page.locator('.tabletop__handcard').count()))
doc = await stored(page, 'inherited')
check('and still names the format it named', doc.formatId === 'constructor', doc.formatId)

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
