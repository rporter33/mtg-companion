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
  }, {
    // Nothing but lands, so the opening hand is known and the coach's land
    // note can be triggered on purpose rather than hoped for.
    id: 'd2', name: 'All Forest', formatId: 'commander', commanders: [], signatureSpell: null,
    main: [{ cardId: 'forest', quantity: 60 }],
    sideboard: [], categoryOrder: [], versions: [],
    createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  }],
  games: [], collection: {}, guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { deckView: 'list' },
})))
await page.reload({ waitUntil: 'networkidle' })

const openTable = async () => {
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.waitForTimeout(500)
}
/** Held upright, the piles and the rarer buttons are behind one press. */
const openRail = async () => {
  if (await page.locator('.tabletop__rail--open').count()) return
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.waitForTimeout(300)
}
const onField = () => page.locator('.field .bcard').count()
const inHand = () => page.locator('.tabletop__handcard .bcard').count()
const pileCount = async (title) => {
  await openRail()
  const text = await page.locator('.pile__title', { hasText: title }).first().innerText()
  return Number(text.match(/(\d+)/)?.[1])
}
const slotStyle = () => page.locator('.field__slot').first().getAttribute('style')

await openTable()

console.log('\nChoosing a deck')
check('the table lists your own decks', (await page.locator('.table-picker__deck').count()) === 2)
check('and says how many cards will be dealt',
  (await page.locator('.table-picker__deck').first().innerText()).includes('99 cards'),
  await page.locator('.table-picker__deck').first().innerText())

await page.locator('.table-picker__deck', { hasText: 'Table Test' }).click()
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
  (await page.locator('.tabletop__strip').innerText()).includes('Turn 2'))

console.log('\nLooking at the top of the library')
await openRail()
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
await openRail()
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
check('so is the turn', (await page.locator('.tabletop__strip').innerText()).includes('Turn 2'))

console.log('\nStarting over')
await openRail()
await page.getByRole('button', { name: 'Deal again' }).click()
await page.waitForTimeout(500)
check('a fresh deal clears the battlefield', (await onField()) === 0)
check('and deals seven', (await inHand()) === 7)
check('and puts the life total back', (await page.locator('.life__total').innerText()) === '20')

// ---------------------------------------------------------------------------
// Everything that makes it feel like a table rather than a list: pointing at
// things, putting one card on another, counters, dice, and a coach that can
// be told to be quiet.
//
// Cards are addressed by where they are on the table rather than by their
// position in the DOM, because that is how a player addresses them: click
// the spot, and whatever is on top there is what you get.

// Buttons in the rail are below the fold on a phone, so pressing one scrolls
// the table out of view. Every click on the table starts from the top.
const toTop = async () => {
  // The page itself does not scroll — the app's main column does — so bring
  // the table into view rather than guessing which element to scroll.
  await page.locator('.field').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(150)
}
const field = async () => { await toTop(); return page.locator('.field').boundingBox() }
const clickAt = async (fx, fy) => {
  const box = await field()
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(250)
}
/** Plays the first card in hand and drags it to a spot of its own. */
const placeAt = async (fx, fy) => {
  await page.locator('.tabletop__handcard .bcard').first().click()
  await page.waitForTimeout(150)
  await page.getByRole('button', { name: 'To the battlefield' }).click()
  await page.waitForTimeout(250)
  const box = await field()
  const card = await page.locator('.field .bcard').last().boundingBox()
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

await page.goto(`${TARGET}#/table`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.locator('.table-picker__deck', { hasText: 'All Forest' }).click()
await page.waitForTimeout(1000)
const LEFT = [0.2, 0.3]
const MIDDLE = [0.5, 0.3]
const RIGHT = [0.8, 0.3]
await placeAt(...LEFT)
await placeAt(...MIDDLE)
await placeAt(...RIGHT)
check('three cards, each in its own place', (await page.locator('.field .bcard').count()) === 3)

console.log('\nPointing at things')
await clickAt(...LEFT)
await page.getByRole('button', { name: 'Attacking…' }).click()
await page.waitForTimeout(200)
check('the table says what it is waiting for', (await page.locator('.banner').innerText()).includes('attacking'))
check('and every other card is a possible far end',
  (await page.locator('.field__slot--aimable').count()) === 2)
await clickAt(0.5, 0.95)
check('pointing at the empty table is how you change your mind',
  (await page.locator('.field__arrow').count()) === 0 && (await page.locator('.banner').count()) === 0)

await clickAt(...LEFT)
await page.getByRole('button', { name: 'Attacking…' }).click()
await page.waitForTimeout(200)
await clickAt(...RIGHT)
check('an arrow is drawn', (await page.locator('.field__arrow--attack').count()) === 1)
check('and picking the far end does not also pick that card up',
  (await page.locator('.actions').count()) === 0)

await clickAt(...LEFT)
await page.getByRole('button', { name: 'Pointing at…' }).click()
await clickAt(...MIDDLE)
check('a second arrow, drawn differently because it means something else',
  (await page.locator('.field__arrow--target').count()) === 1)
await openRail()
await page.getByRole('button', { name: 'Clear the arrows' }).click()
await page.waitForTimeout(300)
check('and both come off at once', (await page.locator('.field__arrow').count()) === 0)

console.log('\nOne card on another')
await clickAt(...MIDDLE)
await page.getByRole('button', { name: 'Put it on…' }).click()
await clickAt(...LEFT)
check('nothing was added or lost by stacking them',
  (await page.locator('.field .bcard').count()) === 3)
// Whatever is on top of the left-hand spot now is the card that was moved there.
await clickAt(0.24, 0.38)
check('the card on top knows it is on something',
  (await page.getByRole('button', { name: 'Take it off' }).count()) === 1)
await page.getByRole('button', { name: 'Take it off' }).click()
await page.waitForTimeout(300)
await clickAt(0.24, 0.38)
check('and once taken off it is a card like any other',
  (await page.getByRole('button', { name: 'Take it off' }).count()) === 0)
await page.getByRole('button', { name: 'Put it down' }).click()
await page.waitForTimeout(200)

console.log('\nCounters and face-down')
await clickAt(...RIGHT)
await page.getByRole('button', { name: '+ +1/+1' }).click()
await page.waitForTimeout(250)
// The card that is picked up, wherever it has ended up in the stacking order.
const heldCard = () => page.locator('.field__slot:has(.bcard--selected)').innerText()
check('a counter shows on the card', (await heldCard()).includes('+1/+1'), await heldCard())
await page.getByRole('button', { name: 'One more +1/+1 counter' }).click()
await page.waitForTimeout(250)
check('and goes up', (await heldCard()).includes('2'), await heldCard())
for (let i = 0; i < 2; i++) {
  await page.getByRole('button', { name: 'One fewer +1/+1 counter' }).click()
  await page.waitForTimeout(200)
}
check('a counter at zero is no counter at all', !(await heldCard()).includes('+1/+1'), await heldCard())

await page.getByRole('button', { name: 'Turn it face down' }).click()
await page.waitForTimeout(300)
check('a face-down card gives nothing away', (await heldCard()).includes('Face down'), await heldCard())
await page.getByRole('button', { name: 'Turn it up' }).click()
await page.waitForTimeout(250)
check('and turns back over', !(await heldCard()).includes('Face down'))
await page.getByRole('button', { name: 'Put it down' }).click()
await page.waitForTimeout(200)

console.log('\nDice')
await openRail()
await page.getByRole('button', { name: 'Flip a coin' }).click()
await page.waitForTimeout(300)
check('a coin comes up one way or the other',
  /heads|tails/.test(await page.locator('.dice').innerText()), await page.locator('.dice').innerText())
await page.getByRole('button', { name: 'Roll a d20' }).click()
await page.waitForTimeout(300)
check('and a d20 keeps the coin above it', (await page.locator('.dice__roll').count()) === 2)

console.log('\nThe coach, and telling it to be quiet')
check('more than one land this turn is worth a note',
  (await page.locator('.tablecoach').count()) === 1
  && (await page.locator('.tablecoach').innerText()).includes('lands this turn'),
  await page.locator('.tablecoach').innerText().catch(() => 'no notes at all'))
await page.getByRole('button', { name: 'Quiet, please' }).click()
await page.waitForTimeout(300)
check('the whole coach can be silenced in one press', (await page.locator('.tablecoach').count()) === 0)
await openRail()
check('and the switch says so', (await page.getByRole('button', { name: /^Notes/ }).innerText()).includes('off'))
await page.getByRole('button', { name: /^Notes/ }).click()
await page.waitForTimeout(300)
check('it comes back when asked', (await page.locator('.tablecoach').count()) === 1)

const notes = await page.locator('.tablecoach__note').count()
await page.locator('.tablecoach__note button').first().click()
await page.waitForTimeout(250)
check('and a single note can be waved away on its own',
  (await page.locator('.tablecoach__note').count()) === notes - 1)

await openRail()
check('sound is off until it is asked for',
  (await page.getByRole('button', { name: /^Sound/ }).getAttribute('aria-pressed')) === 'false')
await page.getByRole('button', { name: /^Sound/ }).click()
await page.waitForTimeout(200)
check('and stays on once it is',
  (await page.getByRole('button', { name: /^Sound/ }).getAttribute('aria-pressed')) === 'true')

// A phone turned sideways is the shape this layout wants: the table on the
// left at the height of the screen, hand and piles beside it, and nothing
// folded away. What is being checked is that turning the phone is enough —
// no scrolling to reach the piles, and the table does not shrink to a strip.
console.log('\nHeld sideways')
await page.setViewportSize({ width: 874, height: 402 })
await page.waitForTimeout(600)
{
  const box = await page.locator('.field').boundingBox()
  check('the table is still square', Math.abs(box.width - box.height) < 2, `${box.width} by ${box.height}`)
  check('and as tall as the screen allows', box.height > 260, `${box.height} tall in 402`)
  check('the piles are beside it, not folded away',
    (await page.locator('.tabletop__rail').isVisible()) && !(await page.locator('.tabletop__more').isVisible()))
  const rail = await page.locator('.tabletop__rail').boundingBox()
  check('and genuinely beside it', rail.x > box.x + box.width - 4, `field ends ${box.x + box.width}, rail starts ${rail.x}`)
  check('your hand is beside the table too',
    (await page.locator('.tabletop__hand').boundingBox()).x > box.x + box.width - 4)
}
await page.setViewportSize({ width: 430, height: 1300 })
await page.waitForTimeout(500)
check('and upright the fold is back', await page.locator('.tabletop__more').isVisible())
await page.getByRole('button', { name: 'Fewer', exact: true }).click()
await page.waitForTimeout(300)
check('and closing it leaves the table and your hand', !(await page.locator('.tabletop__rail').isVisible()))

check('no console errors throughout', errors.length === 0, errors.join('; '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
