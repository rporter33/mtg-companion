#!/usr/bin/env node
/**
 * The lobby's shelf and what this app reads of each deck on it (lib/deck-reading.js):
 * the plan most of its cards fit, as a tag, and on the Commander tab the lowest
 * bracket its Game Changers allow, as a badge; the Archetype and Bracket filters
 * with a count on every chip, as the colours filter has; and every reading said,
 * on screen and to a screen reader, to be this app's and not the deck's.
 *
 * The cards are Scryfall's shape, served by a route that answers only the ids it
 * is asked for, so a deck with a card Scryfall does not answer is a deck that
 * cannot be read, as it would be in somebody's phone.
 *
 *   node tests/browser/shelf.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BRACKET_LINE, PLAN_LINE, READING_LINE, UNREAD_SENTENCE, planSentence, shelfLine } from '../../src/lib/deck-reading.js'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
// Pictures go to the system's temporary folder, named at the end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `ui-shelf-${name}.png`)
const shots = []
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (test, ms = 5000) => {
  const start = Date.now()
  while (!(await test())) {
    if (Date.now() - start > ms) return false
    await sleep(100)
  }
  return true
}

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}', cmc: 1, type_line,
  oracle_text: '', color_identity: [], colors: [], rarity: 'common', set: 'tst', set_name: 'Test', collector_number: '1',
  legalities: { commander: 'legal', standard: 'legal' }, prices: { usd: '1.00' }, game_changer: false,
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
const CARDS = [
  // Three commanders, one of each colour the decks are.
  c('cmd-w', 'Captain of Soldiers', 'Legendary Creature — Human Soldier', { color_identity: ['W'], power: '2', toughness: '2' }),
  c('cmd-u', 'Sage of Tides', 'Legendary Creature — Merfolk Wizard', { color_identity: ['U'], power: '1', toughness: '3' }),
  c('cmd-g', 'Titan of the Wilds', 'Legendary Creature — Giant', { color_identity: ['G'], power: '6', toughness: '6' }),
  c('alarm', 'Raise the Alarm', 'Instant', { color_identity: ['W'], oracle_text: 'Create two 1/1 white Soldier creature tokens.' }),
  c('sprite', 'Cloud Sprite', 'Creature — Faerie', { color_identity: ['U'], oracle_text: 'Flying\nCloud Sprite can block only creatures with flying.', power: '1', toughness: '1' }),
  c('bear', 'Grizzly Bears', 'Creature — Bear', { color_identity: ['G'], power: '2', toughness: '2' }),
  c('giant', 'Craw Wurm', 'Creature — Wurm', { color_identity: ['G'], power: '6', toughness: '4' }),
  c('sol', 'Sol Ring', 'Artifact', { oracle_text: '{T}: Add {C}{C}.' }),
  c('plains', 'Plains', 'Basic Land — Plains', { produced_mana: ['W'] }),
  c('island', 'Island', 'Basic Land — Island', { produced_mana: ['U'] }),
  c('forest', 'Forest', 'Basic Land — Forest', { produced_mana: ['G'] }),
  // Game Changers, as Scryfall flags them.
  c('study', 'Rhystic Study', 'Enchantment', { color_identity: ['U'], oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.', game_changer: true }),
  c('gc1', 'Natural Order', 'Sorcery', { color_identity: ['G'], game_changer: true }),
  c('gc2', 'Worldly Tutor', 'Instant', { color_identity: ['G'], game_changer: true }),
  c('gc3', "Gaea's Cradle", 'Legendary Land', { game_changer: true }),
  c('gc4', 'Survival of the Fittest', 'Enchantment', { color_identity: ['G'], game_changer: true }),
]
const deck = (id, name, formatId, main, over = {}) => ({
  id, name, formatId, commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
  main: main.map(([cardId, quantity]) => ({ cardId, quantity })), sideboard: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
})
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [
    deck('soldiers', 'Soldiers', 'commander', [['alarm', 30], ['sol', 1], ['plains', 68]], { commanders: ['cmd-w'] }),
    deck('study', 'Study Hall', 'commander', [['sprite', 30], ['study', 1], ['island', 68]], { commanders: ['cmd-u'] }),
    deck('stompy', 'Big Stompy', 'commander', [['giant', 30], ['gc1', 1], ['gc2', 1], ['gc3', 1], ['gc4', 1], ['forest', 65]], { commanders: ['cmd-g'] }),
    // One of its cards is one Scryfall does not answer: this deck cannot be read.
    deck('unread', 'Half Arrived', 'commander', [['bear', 30], ['gone', 1], ['forest', 68]], { commanders: ['cmd-g'] }),
    deck('sixty', 'Sixty Soldiers', 'standard', [['alarm', 20], ['plains', 40]]),
    // Read, and fitting none of the app's plans.
    deck('bears', 'Sixty Bears', 'standard', [['bear', 20], ['forest', 40]]),
  ],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
// Answers the ids asked for and no others, and lists the rest as not found, as Scryfall does.
await page.route('**/api.scryfall.com/cards/collection', (route) => {
  const asked = (route.request().postDataJSON()?.identifiers ?? []).map((i) => i.id)
  const data = CARDS.filter((card) => asked.includes(card.id))
  const notFound = asked.filter((id) => !data.some((card) => card.id === id)).map((id) => ({ id }))
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, not_found: notFound }) })
})

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })

const axeClean = async () => {
  await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  const found = result.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join('; ')}`)
  if (found.length) console.log(found.join('\n'))
  return found.length === 0
}
const shoot = async (name) => { const path = SHOT(name); await page.screenshot({ path, fullPage: true }); shots.push(path) }
const tile = (name) => page.locator('.lobby__deck').filter({ has: page.locator('.lobby__deckname', { hasText: new RegExp(`^${name}$`) }) })
const tags = (name) => tile(name).locator('.lobby__tag').allInnerTexts().then((t) => t.map((s) => s.trim().toLowerCase()))
const shelfNames = () => page.locator('.lobby__deckname').allInnerTexts()
const said = (name) => tile(name).locator('.sr-only').innerText().catch(() => '')

console.log('\nWhat the shelf reads of each deck, on the Commander tab')
check('the lobby opens on the Commander tab, four decks on the shelf', await until(() => page.locator('.lobby__deck').count().then((n) => n === 4)))
check('each deck read carries its plan as a tag, once its cards have arrived',
  await until(async () => (await tags('Soldiers')).includes('tokens') && (await tags('Study Hall')).includes('flyers') && (await tags('Big Stompy')).includes('big creatures')),
  JSON.stringify({ soldiers: await tags('Soldiers'), study: await tags('Study Hall'), stompy: await tags('Big Stompy') }))
check('and the lowest bracket its Game Changers allow as a badge: none, one, four',
  (await tags('Soldiers')).includes('b1+') && (await tags('Study Hall')).includes('b3+') && (await tags('Big Stompy')).includes('b4+'))
check('a deck with a card that never arrived is not read at all, rather than read from part of itself, and says so on its tile',
  (await tile('Half Arrived').count()) === 1 && JSON.stringify(await tags('Half Arrived')) === JSON.stringify(['not read'])
  && (await tile('Half Arrived').locator('.lobby__tag').getAttribute('title')) === UNREAD_SENTENCE
  && (await said('Half Arrived')) === UNREAD_SENTENCE, JSON.stringify(await tags('Half Arrived')))
check('the shelf says, on screen, that these are this app\'s reading and not the deck\'s, naming the Bracket filter where there is one',
  (await page.locator('.lobby__readnote').innerText()).trim() === shelfLine({ brackets: true }), await page.locator('.lobby__readnote').innerText().catch(() => 'none'))
check('a screen reader hears each tag as the sentence it stands for, the app\'s reading said',
  (await said('Study Hall')) === "Reads as Flyers, this app's reading: 30 of its 100 cards fit. Bracket 3 or higher, this app's reading: one Game Changer, Rhystic Study.",
  await said('Study Hall'))
check('and the tile\'s own name carries it, the tags themselves hidden from it so nothing is said twice',
  await page.getByRole('button', { name: /^Big Stompy.*Reads as Big creatures, this app's reading: 31 of its 100 cards fit\. Bracket 4 or higher, this app's reading: 4 Game Changers, Gaea's Cradle, Natural Order, Survival of the Fittest and Worldly Tutor\./ }).count() === 1
  && await tile('Big Stompy').locator('.lobby__tag[aria-hidden="true"]').count() === 2)
check('the bracket badge says its words to a pointer resting on it, and the plan tag how many cards fit it',
  (await tile('Study Hall').locator('.lobby__tag--bracket').getAttribute('title')) === 'Bracket 3 or higher'
  && (await tile('Study Hall').locator('.lobby__tag:not(.lobby__tag--bracket)').getAttribute('title')) === "Reads as Flyers, this app's reading: 30 of its 100 cards fit.")
check('the shelf has no accessibility violations', await axeClean())
await shoot('1280')

console.log('\nThe Archetype filter carries counts')
const archetype = page.getByRole('button', { name: /^Archetype ·/ })
check('it is offered, closed', await archetype.count() === 1 && (await archetype.getAttribute('aria-expanded')) === 'false')
await archetype.click()
const planChips = page.getByRole('group', { name: 'Archetype' }).locator('.lobby__facet')
// A chip's name and count are two items of a flex box, which innerText says on two lines.
const chipTexts = (chips) => chips.allInnerTexts().then((t) => t.map((s) => s.replace(/\s+/g, ' ').trim()))
check('opening it says it is open', (await archetype.getAttribute('aria-expanded')) === 'true')
check('a chip for each plan a deck reads as, each with how many decks are behind it, in the vocabulary\'s order between equals',
  JSON.stringify(await chipTexts(planChips)) === JSON.stringify(['Tokens 1', 'Flyers 1', 'Big creatures 1']),
  JSON.stringify(await chipTexts(planChips)))
const planGroup = page.getByRole('group', { name: 'Archetype' })
const howPlan = planGroup.getByRole('button', { name: 'How this is read' })
check('and under them one line, that they are this app\'s reading, with how it read them behind a disclosure, closed',
  (await planGroup.locator('.lobby__facetnote').first().innerText()).trim() === `${READING_LINE} How this is read`
  && (await howPlan.getAttribute('aria-expanded')) === 'false' && !(await planGroup.getByText(PLAN_LINE).isVisible()),
  await planGroup.locator('.lobby__facetnote').first().innerText())
await howPlan.click()
check('opened, it says how', (await howPlan.getAttribute('aria-expanded')) === 'true' && await planGroup.getByText(PLAN_LINE).isVisible()
  && await page.evaluate((id) => document.getElementById(id)?.innerText.trim(), await howPlan.getAttribute('aria-controls')) === PLAN_LINE)
await howPlan.click()
await page.getByRole('button', { name: /^Flyers/ }).click()
check('choosing Flyers leaves the deck that reads as Flyers', JSON.stringify(await shelfNames()) === JSON.stringify(['Study Hall']), JSON.stringify(await shelfNames()))
check('and the chip says it is chosen', (await page.getByRole('button', { name: /^Flyers/ }).getAttribute('aria-pressed')) === 'true')
check('the counts stay as they were: a chip says how many decks are behind it, not how many are left',
  JSON.stringify(await chipTexts(planChips)) === JSON.stringify(['Tokens 1', 'Flyers 1', 'Big creatures 1']))
check('the button says what is chosen', /^Archetype · Flyers$/.test((await archetype.innerText()).trim()), await archetype.innerText())
check('and the shelf says a deck is not shown because it has not been read',
  /One deck is not shown because not all its cards have arrived, so this app has not read it\./.test(await page.locator('.lobby__decks').innerText()))
await page.getByRole('button', { name: /^Tokens/ }).click()
check('two chips mean either, as a deck reads as one plan', JSON.stringify((await shelfNames()).sort()) === JSON.stringify(['Soldiers', 'Study Hall']), JSON.stringify(await shelfNames()))
await page.getByRole('button', { name: /^Tokens/ }).click()
await page.getByRole('button', { name: /^Flyers/ }).click()
check('and with none chosen every deck is back', (await page.locator('.lobby__deck').count()) === 4)
await archetype.click()

console.log('\nThe Bracket filter carries counts')
const bracket = page.getByRole('button', { name: /^Bracket ·/ })
check('it is offered on the Commander tab', await bracket.count() === 1)
await bracket.click()
const floorChips = page.getByRole('group', { name: 'Bracket' }).locator('.lobby__facet')
// Named by what each keeps, the decks at that floor alone: "B3 or higher" was true of the
// B4+ deck too, which it did not keep, and "B1 or higher" of every deck (found in review).
check('a chip for each floor the Game Changers set, named by the Game Changers that set it, each with a count',
  JSON.stringify(await chipTexts(floorChips)) === JSON.stringify(['B1+ · no Game Changers 1', 'B3+ · 1–3 Game Changers 1', 'B4+ · 4 or more Game Changers 1']),
  JSON.stringify(await chipTexts(floorChips)))
const bracketGroup = page.getByRole('group', { name: 'Bracket' })
await bracketGroup.getByRole('button', { name: 'How this is read' }).click()
check('and under them, behind its own disclosure, how this app read them and what it did not read', await bracketGroup.getByText(BRACKET_LINE).isVisible())
await bracketGroup.getByRole('button', { name: 'How this is read' }).click()
await page.getByRole('button', { name: /^B3\+/ }).click()
check('choosing B3+ keeps the deck with one Game Changer, and not the one with four', JSON.stringify(await shelfNames()) === JSON.stringify(['Study Hall']), JSON.stringify(await shelfNames()))
await page.getByRole('button', { name: /^B3\+/ }).click()
await page.getByRole('button', { name: /^B4\+/ }).click()
check('choosing the fourth leaves the deck with four Game Changers', JSON.stringify(await shelfNames()) === JSON.stringify(['Big Stompy']), JSON.stringify(await shelfNames()))
check('the button says the floor chosen', /^Bracket · B4\+$/.test((await bracket.innerText()).trim()), await bracket.innerText())
await archetype.click()
await page.getByRole('button', { name: /^Tokens/ }).click()
check('with an archetype as well, both must hold, and a shelf left empty says so',
  (await page.locator('.lobby__deck').count()) === 0 && /No deck here matches/.test(await page.locator('.lobby__decks').innerText()))
check('the lobby with both filters open has no accessibility violations', await axeClean())

console.log('\nAt a phone\'s width')
await page.getByRole('button', { name: /^Tokens/ }).click()
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(150)
check('nothing scrolls sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`))
check('and axe is clean there too', await axeClean())
await shoot('390')
await page.setViewportSize({ width: 1280, height: 900 })

console.log('\nOn a sixty-card tab')
await page.getByRole('button', { name: /^Standard/ }).click()
check('changing tab lets the filters go', await until(() => page.locator('.lobby__deck').count().then((n) => n === 2)) && /^Archetype ·$/.test((await page.getByRole('button', { name: /^Archetype ·/ }).innerText()).trim()))
check('a sixty-card deck is read for its plan', await until(async () => (await tags('Sixty Soldiers')).includes('tokens')), JSON.stringify(await tags('Sixty Soldiers')))
check('but carries no bracket, and there is no bracket filter: the brackets are Commander\'s',
  !(await tags('Sixty Soldiers')).some((t) => /^b\d\+$/.test(t)) && (await page.getByRole('button', { name: /^Bracket ·/ }).count()) === 0)
check('so the line above the shelf names no bracket and no Bracket filter',
  (await page.locator('.lobby__readnote').innerText()).trim() === shelfLine({ brackets: false }), await page.locator('.lobby__readnote').innerText())
// Read, and fitting none of the plans: the Archetype filter's "No plan" chip is behind it,
// so its tile says so where a sighted player can see it, in the chip's own words.
check('a deck read as fitting no plan says "No plan" on its tile, in the chip\'s own words, and how many cards were read to its title',
  await until(async () => JSON.stringify(await tags('Sixty Bears')) === JSON.stringify(['no plan']))
  && (await tile('Sixty Bears').locator('.lobby__tag').getAttribute('title')) === planSentence({ top: [], most: 0, cards: 60 }),
  JSON.stringify(await tags('Sixty Bears')))
await page.getByRole('button', { name: /^Archetype ·/ }).click()
await page.getByRole('button', { name: /^No plan/ }).click()
check('and the "No plan" chip keeps that deck', JSON.stringify(await shelfNames()) === JSON.stringify(['Sixty Bears']), JSON.stringify(await shelfNames()))
check('the Standard tab has no accessibility violations', await axeClean())
await page.getByRole('button', { name: /^No plan/ }).click()

check('no console errors', errors.length === 0, errors.join('; '))

await browser.close()
console.log(`\nPictures, to be looked at:\n${shots.map((s) => `  ${s}`).join('\n')}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
