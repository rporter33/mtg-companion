#!/usr/bin/env node
/**
 * Drawing a hand, in the browser.
 *
 * The property worth guarding is arithmetic that is easy to get wrong and
 * invisible when it is: a Commander deck shuffles ninety-nine, not a hundred,
 * because the commander starts in the command zone. Every number this tab
 * produces is wrong by one card if that slips.
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
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf'),
  { ...c('forest', 'Forest', 'Basic Land — Forest'), mana_cost: '', cmc: 0, produced_mana: ['G'] },
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid'),
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
  version: 2,
  decks: [{
    id: 'd1', name: 'Hand Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'forest', quantity: 40 }, { cardId: 'elf', quantity: 59 }],
    sideboard: [], categoryOrder: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { deckView: 'list' },
})))
await page.reload({ waitUntil: 'networkidle' })

const openPlaytest = async () => {
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.deck-card__open').first().click()
  await page.waitForTimeout(900)
  await page.getByRole('tab', { name: 'Playtest' }).click()
  await page.waitForTimeout(400)
}
const chips = () => page.locator('.chip').allInnerTexts()
const hand = () => page.locator('.hand-card').count()

await openPlaytest()

console.log('\nWhat the intro promises')
// Independent of the app's own helper: P(at least two lands in seven) from
// 99 cards holding 40 lands, straight from the hypergeometric distribution.
const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r }
const pLands = (k) => (choose(40, k) * choose(59, 7 - k)) / choose(99, 7)
const expected = Math.round((1 - pLands(0) - pLands(1)) * 100)
const intro = await page.locator('.app__main').innerText()
const shown = Math.round(Number(intro.match(/holds at least two about ([\d.]+)%/)?.[1]))
check('the odds of two lands in the opening seven are the real ones, not their complement',
  Math.abs(shown - expected) <= 1, `shown ${shown}%, expected ${expected}%`)
check('a Commander deck assumes a pod of three or more',
  (await page.getByRole('button', { name: 'Three or more' }).getAttribute('aria-pressed')) === 'true')
// The rest of this file is written for the two-player rule.
await page.getByRole('button', { name: 'Two players' }).click()

console.log('\nThe opening hand')
await page.getByRole('button', { name: 'Draw a hand' }).click()
await page.waitForTimeout(500)
check('seven cards', (await hand()) === 7, String(await hand()))
// 100 cards, one of them the commander, seven in hand: 92 left, not 93.
check('the commander is not in the library', (await chips()).includes('92 left'),
  (await chips()).join(' | '))
check('it says which side of the table', (await chips()).includes('On the play'))
check('and what shape the hand is',
  (await chips()).some((t) => /\d+ lands?, \d+ spells?/.test(t)), (await chips()).join(' | '))

console.log('\nThe London mulligan')
await page.getByRole('button', { name: /Mulligan to 6/ }).click()
await page.waitForTimeout(400)
// London draws seven every time — it is the bottoming that costs you.
check('a mulligan still draws seven', (await hand()) === 7, String(await hand()))
check('and the deck is whole again', (await chips()).includes('92 left'), (await chips()).join(' | '))
check('keeping is blocked until a card is chosen to bottom',
  await page.getByRole('button', { name: /Keep, bottom 1/ }).isDisabled())

await page.locator('.hand-card').first().click()
await page.waitForTimeout(300)
check('choosing one unblocks it',
  !(await page.getByRole('button', { name: /Keep, bottom 1/ }).isDisabled()))

await page.getByRole('button', { name: /Keep, bottom 1/ }).click()
await page.waitForTimeout(400)
check('keeping after one mulligan leaves six', (await hand()) === 6, String(await hand()))
check('and says what went to the bottom',
  /Bottomed:/.test(await page.locator('.app__main').innerText()))

console.log('\nTaking turns')
await page.getByRole('button', { name: 'Next turn' }).click()
await page.waitForTimeout(400)
check('a new turn draws a card', (await hand()) === 7, String(await hand()))
check('and the turn counter moves', (await chips()).includes('Turn 2'), (await chips()).join(' | '))
await page.getByRole('button', { name: 'Draw one' }).click()
await page.waitForTimeout(300)
check('drawing one more works', (await hand()) === 8, String(await hand()))

console.log('\nOn the draw')
// Switching sides has to be reachable once a hand is on the table, not only
// from the intro screen nobody sees again.
await page.getByRole('button', { name: 'On the play' }).click()
await page.waitForTimeout(500)
check('switching sides reshuffles rather than doing nothing',
  (await chips()).includes('On the draw'), (await chips()).join(' | '))
await page.getByRole('button', { name: 'Keep', exact: true }).click()
await page.waitForTimeout(400)
// The player on the draw draws for turn one; that is the whole difference.
check('keeping on the draw gives eight', (await hand()) === 8, String(await hand()))

console.log('\nIn a pod')
await page.getByRole('button', { name: 'On the draw' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Two players' }).click()
await page.waitForTimeout(500)
check('switching to three or more reshuffles and says so',
  (await chips()).includes('Three or more') && (await chips()).includes('On the play'), (await chips()).join(' | '))
await page.getByRole('button', { name: 'Keep', exact: true }).click()
await page.waitForTimeout(400)
check('on the play in a pod, the first player still draws: eight', (await hand()) === 8, String(await hand()))

console.log('\nWhat the hand says')
const reading = page.getByRole('region', { name: 'What this hand says' })
check('a drawn hand is read back as observations',
  (await reading.count()) === 1 && /\d+ lands?, making green|No lands|All lands/.test(await reading.innerText()), await reading.innerText())
check('and this deck, with lands enough for its curve, is offered no change',
  /Nothing to suggest/.test(await page.getByRole('region', { name: 'Try a change' }).innerText()))

console.log('\nTrying a change on a land-light list')
{
  // 28 lands and 71 two-drops: short of the sources this curve wants, so the
  // proposal is a Forest for an elf, judged by the same arithmetic as the intro.
  const thin = await browser.newPage({ viewport: { width: 430, height: 1300 } })
  await thin.route('**/api.scryfall.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
  await thin.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
  await thin.goto(TARGET, { waitUntil: 'networkidle' })
  await thin.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
    version: 3, collection: {},
    decks: [{
      id: 'd2', name: 'Thin Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null, categoryOrder: [],
      main: [{ cardId: 'forest', quantity: 28 }, { cardId: 'elf', quantity: 71 }],
      sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }],
    games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: { deckView: 'list' },
  })))
  await thin.reload({ waitUntil: 'networkidle' })
  await thin.goto(`${TARGET}#/decks/d2/hand`, { waitUntil: 'networkidle' })
  await thin.getByRole('button', { name: 'Draw a hand' }).waitFor({ timeout: 15000 })
  await thin.waitForTimeout(300)
  const panel = thin.getByRole('region', { name: 'Try a change' })
  const text = await panel.innerText()
  check('one change is proposed, a basic for the costliest spell', /Try a change: \+1 Forest, \u22121 Llanowar Elves/.test(text), text.split('\n')[0])
  const now = Number(text.match(/Two lands in the opening seven\s*\n?\s*(\d+)%\s*\n?\s*(\d+)%/)?.[1])
  const after = Number(text.match(/Two lands in the opening seven\s*\n?\s*(\d+)%\s*\n?\s*(\d+)%/)?.[2])
  check('with the odds before and after, and the assumptions written down',
    after >= now && /only lands count toward these odds/.test(text) && /99 cards the commander is not among/.test(text), `${now}% -> ${after}%`)
  await panel.getByRole('button', { name: 'Make this change' }).click()
  // The change lands once the card lookup behind it answers, and the client
  // holds those requests to Scryfall's spacing, so wait for the save itself.
  const readCounts = () => thin.evaluate(() => {
    const deck = JSON.parse(localStorage.getItem('mtg-companion:v1:deck:d2'))
    return Object.fromEntries(deck.main.map((e) => [e.cardId, e.quantity]))
  })
  let counts = await readCounts()
  for (let i = 0; i < 40 && counts.forest !== 29; i++) { await thin.waitForTimeout(100); counts = await readCounts() }
  check('making it changes the list one for one', counts.forest === 29 && counts.elf === 70, JSON.stringify(counts))
  await thin.getByRole('tab', { name: 'History' }).click()
  await thin.waitForTimeout(500)
  check('and the list before it is kept in History, one restore away',
    /Before: \+1 Forest, \u22121 Llanowar Elves/.test(await thin.locator('.app__main').innerText()),
    (await thin.locator('.app__main').innerText()).match(/Before[^\n]*/)?.[0])
  await thin.close()
}

console.log('\nWhile cards are still loading')
{
  // The library is built from cards that have loaded. Dealing before they all
  // have would shuffle a deck missing whatever is still in flight — and a hand
  // short of lands is the exact thing this tab exists to notice.
  const slow = await browser.newPage({ viewport: { width: 430, height: 1300 } })
  await slow.route('**/api.scryfall.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
  let release
  const held = new Promise((r) => { release = r })
  await slow.route('**/api.scryfall.com/cards/collection', async (route) => {
    await held
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) })
  })
  // A new page is a new context: nothing seeded above is in its storage.
  await slow.goto(TARGET, { waitUntil: 'domcontentloaded' })
  await slow.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
    version: 2,
    decks: [{
      id: 'd1', name: 'Hand Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
      main: [{ cardId: 'forest', quantity: 40 }, { cardId: 'elf', quantity: 59 }],
      sideboard: [], categoryOrder: [],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }],
    games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
    prefs: { deckView: 'list' },
  })))
  await slow.reload({ waitUntil: 'domcontentloaded' })
  await slow.waitForTimeout(300)
  await slow.getByRole('button', { name: 'Decks', exact: true }).click()
  await slow.waitForTimeout(300)
  await slow.locator('.deck-card__open').first().click()
  await slow.waitForTimeout(500)
  await slow.getByRole('tab', { name: 'Playtest' }).click()
  await slow.waitForTimeout(300)
  const btn = slow.getByRole('button', { name: /Loading cards|Draw a hand/ })
  check('drawing is blocked until every card has loaded', await btn.isDisabled(), await btn.innerText())
  check('and says what it is waiting for', /Loading cards… 0\/99/.test(await btn.innerText()), await btn.innerText())
  release()
  await slow.waitForTimeout(900)
  check('then unblocks', !(await btn.isDisabled()) && /Draw a hand/.test(await btn.innerText()), await btn.innerText())
  await slow.close()
}

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
