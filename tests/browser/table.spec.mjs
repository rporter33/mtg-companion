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
  c('forest', 'Forest', 'Basic Land — Forest', { mana_cost: '', cmc: 0, produced_mana: ['G'], finishes: ['nonfoil', 'foil'] }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid', { power: '1', toughness: '1' }),
  c('bolt', 'Lightning Bolt', 'Instant', { mana_cost: '{R}', oracle_text: 'Deal 3 damage to any target.' }),
  c('walker', 'Test Planeswalker', 'Legendary Planeswalker — Test', { loyalty: '4' }),
]
/** A second printing of the Forest, so there is a real choice to make. */
const FOREST_SHOWCASE = c('forest-showcase', 'Forest', 'Basic Land — Forest', {
  mana_cost: '', cmc: 0, produced_mana: ['G'], set: 'shw', set_name: 'Showcase Set',
  collector_number: '272', frame_effects: ['showcase'], finishes: ['nonfoil', 'foil'],
})
const TREASURE = {
  object: 'card', id: 'treasure-token', oracle_id: 'o-treasure', name: 'Treasure',
  type_line: 'Token Artifact — Treasure', oracle_text: '{T}, Sacrifice this: Add one mana of any color.',
  color_identity: [], colors: [], rarity: 'common', set: 'ttst', set_name: 'Tokens',
  collector_number: '9', legalities: {}, prices: {}, layout: 'token',
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1300 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [...CARDS, FOREST_SHOWCASE, TREASURE] }) }))
// Printings and token search both go through /cards/search, so the query says
// which one is being asked for.
await page.route('**/api.scryfall.com/cards/search**', (route) => {
  const query = decodeURIComponent(new URL(route.request().url()).searchParams.get('q') ?? '')
  const data = query.includes('oracleid:o-forest') ? [CARDS[1], FOREST_SHOWCASE]
    : query.includes('t:token') ? [TREASURE]
      : []
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, total_cards: data.length, has_more: false }) })
})

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 4,
  decks: [{
    id: 'd1', name: 'Table Test', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'forest', quantity: 40 }, { cardId: 'elf', quantity: 59 }],
    sideboard: [], categoryOrder: [], versions: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }, {
    // One of each kind, so the playmat has something to sort.
    id: 'd3', name: 'One Of Each', formatId: 'commander', commanders: [], signatureSpell: null,
    main: [
      { cardId: 'forest', quantity: 15 }, { cardId: 'elf', quantity: 15 },
      { cardId: 'bolt', quantity: 15 }, { cardId: 'walker', quantity: 15 },
    ],
    sideboard: [], categoryOrder: [], versions: [],
    createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z',
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
check('the table lists your own decks', (await page.locator('.table-picker__deck').count()) === 3)
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
// Every card in this deck is a land, and with the playmat on a land sits in
// the land row — so these are three places along that one row. Where along
// it is still the player's; which row is the card's.
const LANDS_Y = 0.84
const LEFT = [0.2, LANDS_Y]
const MIDDLE = [0.5, LANDS_Y]
const RIGHT = [0.8, LANDS_Y]
await placeAt(...LEFT)
await placeAt(...MIDDLE)
await placeAt(...RIGHT)
check('three cards, each in its own place', (await page.locator('.field .bcard').count()) === 3)
check('all three in the land row, because that is what they are',
  (await page.locator('.field__slot').evaluateAll((ns) => ns.map((n) => n.style.top))).every((t) => t === '84%'),
  JSON.stringify(await page.locator('.field__slot').evaluateAll((ns) => ns.map((n) => n.style.top))))

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
// An attached card sits on the one underneath rather than in its own row —
// which is the point of attaching — so it is a little down and to the right
// of the host.
await clickAt(0.24, 0.90)
check('the card on top knows it is on something',
  (await page.getByRole('button', { name: 'Take it off' }).count()) === 1)
await page.getByRole('button', { name: 'Take it off' }).click()
await page.waitForTimeout(300)
// Still the card in hand, and no longer on anything. Checked without
// clicking again: a second click would put the card down, and then "no Take
// it off button" would pass for the wrong reason.
check('and once taken off it is a card like any other',
  (await page.locator('.actions').count()) === 1
  && (await page.getByRole('button', { name: 'Take it off' }).count()) === 0)
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

// ---------------------------------------------------------------------------
// Which copy of the card is on the table. Two people can play the same
// decklist and own completely different objects, and that is most of why
// anyone cares about their deck.

console.log('\nChoosing a printing')
await clickAt(...RIGHT)
await page.getByRole('button', { name: 'Another printing…' }).click()
await page.waitForTimeout(700)
check('every printing is offered, with its painting and where it is from',
  (await page.locator('.printings__print').count()) === 2,
  await page.locator('.printings').innerText().catch(() => 'no panel'))
check('and the copy in the deck is marked as the one you have',
  (await page.locator('.printings__print--mine').count()) === 1)
check('a different frame is named rather than guessed at',
  (await page.locator('.printings').innerText()).includes('showcase'))

await page.locator('.printings__print', { hasText: 'Showcase Set' }).click()
await page.waitForTimeout(600)
check('the copies on the table change',
  (await page.locator('.field .bcard--showcase').count()) > 0,
  `${await page.locator('.field .bcard').count()} cards, none showcase`)
check('and so does the deck, so it is still that printing next game',
  await page.evaluate(() => {
    const deck = JSON.parse(localStorage.getItem('mtg-companion:v1:deck:d2') ?? '{}')
    return (deck.main ?? []).every((e) => e.cardId === 'forest-showcase')
  }))

console.log('\nFoils')
// The card is still in hand after choosing its printing — you might want to
// say it is a foil while you are there — so no need to pick it up again.
check('the card stays picked up after choosing its printing',
  (await page.locator('.actions').count()) === 1)
await page.getByRole('button', { name: 'Mine is foil' }).click()
await page.waitForTimeout(300)
check('a foil is drawn as one', (await page.locator('.field .bcard--foil').count()) === 1)
check('and said out loud, because a sheen is not readable to everyone',
  (await page.locator('.field .bcard--foil').getAttribute('aria-label')).includes('foil'))
await page.getByRole('button', { name: 'An ordinary copy' }).click()
await page.waitForTimeout(300)
check('and it can be an ordinary copy again', (await page.locator('.field .bcard--foil').count()) === 0)
await page.getByRole('button', { name: 'Put it down' }).click()
await page.waitForTimeout(200)

console.log('\nTokens and blank cards')
const started = await onField()
await openRail()
await page.getByRole('button', { name: 'Make a token' }).click()
await page.waitForTimeout(300)
await page.getByLabel('Search for a token').fill('treasure')
await page.getByRole('button', { name: 'Find it' }).click()
await page.waitForTimeout(700)
check('a real token is found with its own painting',
  (await page.locator('.tokenmaker__token').count()) === 1,
  await page.locator('.tokenmaker').innerText())
await page.locator('.tokenmaker__token').click()
await page.waitForTimeout(500)
check('and goes onto the table', (await onField()) === started + 1)
check('under its own name',
  (await page.locator('.field .bcard').last().innerText()).includes('Treasure'),
  await page.locator('.field .bcard').last().innerText())

await openRail()
await page.getByRole('button', { name: 'Make a token' }).click()
await page.waitForTimeout(300)
await page.getByLabel('Name', { exact: true }).fill('Zombie')
await page.getByLabel('Power').fill('2')
await page.getByLabel('Toughness').fill('2')
await page.getByRole('button', { name: 'Put it on the table' }).click()
await page.waitForTimeout(500)
check('a blank card with a name on it needs no connection at all',
  (await onField()) === started + 2)
check('and carries the numbers you wrote on it',
  (await page.locator('.field .bcard').last().innerText()).includes('2/2'),
  await page.locator('.field .bcard').last().innerText())

// ---------------------------------------------------------------------------
// The playmat: the rows a printed mat has, and the one rule this table keeps.

console.log('\nThe marked playmat')
await page.goto(`${TARGET}#/table`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.locator('.table-picker__deck', { hasText: 'One Of Each' }).click()
await page.waitForTimeout(1200)
check('the rows are marked and named', (await page.locator('.playmat__lane').count()) === 4)
check('and named in words, not only drawn',
  /lands/i.test(await page.locator('.playmat').innerText()),
  await page.locator('.playmat').innerText())

/** Plays whatever is named from hand, if it is there; returns whether it was. */
const playNamed = async (name) => {
  const held = page.locator('.tabletop__handcard .bcard', { hasText: name }).first()
  if (!await held.count()) return false
  await held.click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'To the battlefield' }).click()
  await page.waitForTimeout(350)
  return true
}
const rowOf = async (name) => page.locator('.field__slot', { hasText: name }).first().evaluate((n) => n.style.top)

// Draw enough that one of each is in hand.
for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Draw', exact: true }).click()
await page.waitForTimeout(500)

if (await playNamed('Forest')) {
  check('a land goes to the land row', (await rowOf('Forest')) === '84%', await rowOf('Forest'))
}
if (await playNamed('Llanowar')) {
  check('a creature goes to the creature row', (await rowOf('Llanowar')) === '35%', await rowOf('Llanowar'))
}
if (await playNamed('Planeswalker')) {
  check('a planeswalker goes to its own row', (await rowOf('Planeswalker')) === '11%', await rowOf('Planeswalker'))
}

console.log('\nAn instant does not stay on the battlefield')
{
  const bolt = page.locator('.tabletop__handcard .bcard', { hasText: 'Lightning Bolt' }).first()
  check('there is one in hand to try it with', (await bolt.count()) > 0)
  const onField = await page.locator('.field .bcard').count()
  await bolt.click()
  await page.waitForTimeout(200)
  check('the table does not even offer to put it there',
    (await page.getByRole('button', { name: 'To the battlefield' }).count()) === 0,
    await page.locator('.actions').innerText())
  await page.getByRole('button', { name: 'To the stack' }).click()
  await page.waitForTimeout(400)
  check('it goes on the stack instead', (await page.locator('.stackshelf').count()) === 1)
  check('and not onto the battlefield', (await page.locator('.field .bcard').count()) === onField)
  check('the stack says which way it resolves',
    (await page.locator('.stackshelf').innerText()).includes('Last on, first to happen'))
  await page.getByRole('button', { name: /^Resolve/ }).click()
  await page.waitForTimeout(400)
  check('resolving an instant sends it to the graveyard, not the table',
    (await pileCount('Graveyard')) === 1 && (await page.locator('.field .bcard').count()) === onField)
  check('and the stack empties', (await page.locator('.stackshelf').count()) === 0)
}

console.log('\nWhere you are in the turn')
{
  // The heading is styled uppercase, so read it without caring.
  const where = () => page.locator('.turns .pile__title').innerText()
  const at = async (name) => new RegExp(name, 'i').test(await where())
  check('the turn starts at the untap step', await at('Untap'), await where())
  check('and says nobody gets priority there',
    (await page.locator('.turns').innerText()).includes('Nobody gets priority'))
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Next step' }).click()
    await page.waitForTimeout(250)
  }
  check('three steps on is the first main phase', await at('Precombat main'), await where())
  check('which is where a land may be played',
    (await page.locator('.turns').innerText()).includes('A land and sorceries may be played here'))
  await page.getByRole('button', { name: 'The whole turn' }).click()
  await page.waitForTimeout(300)
  check('the whole turn can be read at once', (await page.locator('.turns__step').count()) === 13)
  check('and it cites the rules rather than asserting them',
    (await page.locator('.turns__all').innerText()).includes('510.4'))
  await page.locator('.turns__step', { hasText: 'Declare attackers' }).click()
  await page.waitForTimeout(300)
  check('any step can be jumped to', await at('Declare attackers'), await where())
  // Attackers, then blockers, then damage — with the first-strike step
  // between them skipped, because nothing in this combat has first strike.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Next step' }).click()
    await page.waitForTimeout(250)
  }
  check('and first-strike damage is skipped when nothing in combat has it',
    await at('Combat damage') && !(await at('First-strike')), await where())
  await page.getByRole('button', { name: 'Close' }).click()
}

console.log('\nLooking through a pile')
await openRail()
{
  // Put something in the graveyard to look through.
  const inHand = page.locator('.tabletop__handcard .bcard').first()
  await inHand.click()
  await page.waitForTimeout(200)
  const toYard = page.getByRole('button', { name: 'To the graveyard' })
  if (await toYard.count()) { await toYard.click(); await page.waitForTimeout(350) }
  await openRail()
  const yard = page.locator('.pile').filter({ has: page.locator('.pile__title', { hasText: 'Graveyard' }) }).first()
  const look = yard.getByRole('button', { name: 'Look' })
  if (await look.count()) {
    await look.click()
    await page.waitForTimeout(300)
    check('a pile opens into a browser', (await yard.locator('.zonebrowse').count()) === 1)
    check('grouped by type with a count', (await yard.locator('.zonebrowse__head').count()) > 0)
    const hint = await yard.locator('.zonebrowse__find').getAttribute('placeholder')
    check('and the box teaches its own syntax', /t:/.test(hint) && /o:/.test(hint), hint)
  }

  // The library is the one an enforced game will not let you look through.
  await page.getByRole('button', { name: 'Search the library' }).click()
  await page.waitForTimeout(300)
  const lib = page.locator('.pile').filter({ has: page.locator('.pile__title', { hasText: 'Library' }) }).first()
  check('the library can be searched at all', (await lib.locator('.zonebrowse').count()) === 1)
  const before = await lib.locator('.pile__card').count()
  check('and shows what is in it', before > 0, `${before} cards`)

  await lib.locator('.zonebrowse__find').fill('t:creature')
  await page.waitForTimeout(350)
  const creatures = await lib.locator('.pile__card').count()
  check('a t: search narrows it', creatures > 0 && creatures < before, `${creatures} of ${before}`)

  const creatureNames = (await lib.locator('.pile__card').allInnerTexts()).join(',')
  await lib.locator('.zonebrowse__find').fill('t:land')
  await page.waitForTimeout(350)
  const lands = await lib.locator('.pile__card').count()
  const landNames = (await lib.locator('.pile__card').allInnerTexts()).join(',')
  check('and finds a different set for a different type',
    lands > 0 && landNames !== creatureNames, `${lands} lands vs ${creatures} creatures`)

  await lib.locator('.zonebrowse__find').fill('zzzznothing')
  await page.waitForTimeout(350)
  check('an empty result says so rather than showing nothing at all',
    (await lib.getByText('Nothing here matches.').count()) === 1)

  await lib.locator('.zonebrowse__find').fill('')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Close the library' }).click()
  await page.waitForTimeout(200)
  check('and it closes again', (await lib.locator('.zonebrowse').count()) === 0)
}

console.log('\nThe game log')
await openRail()
{
  const log = page.locator('.gamelog')
  check('the log is in the rail', (await log.count()) === 1)
  const items = await page.locator('.gamelog__item').count()
  check('and has entries in it by now', items > 0, `${items} entries`)
  const said = (await page.locator('.gamelog__said').allInnerTexts()).join(' | ')
  check('which read as sentences about cards', /You (drew|put|tapped|untapped|moved|exiled|rolled)/i.test(said), said.slice(0, 160))
  // The table has no notion of casting, so the log must never claim one.
  check('and never claim a card was cast', !/\bcast\b/i.test(said), said.slice(0, 160))
  check('turns are headed', (await page.locator('.gamelog__turn').count()) > 0)
  const steps = await page.locator('.gamelog__steps').count()
  check('and the steps that passed are collapsed into their own lines', steps > 0, `${steps} step lines`)
  await page.locator('.gamelog__toggle').click()
  await page.waitForTimeout(250)
  check('the log folds away', (await page.locator('.gamelog__items').count()) === 0)
  await page.locator('.gamelog__toggle').click()
  await page.waitForTimeout(250)
  check('and comes back', (await page.locator('.gamelog__items').count()) > 0)
}

console.log('\nThe counters beside you')
await openRail()
{
  const box = page.locator('.counters')
  check('the counters are in the rail', (await box.count()) === 1)
  const labels = (await box.locator('.counters__label').allInnerTexts()).map((t) => t.toLowerCase())
  check('poison is among them', labels.includes('poison'), labels.join(', '))
  check('and so are the newer ones', labels.includes('storm') && labels.includes('speed'), labels.join(', '))

  const poison = box.locator('.counters__one', { hasText: 'Poison' }).first()
  await poison.getByRole('button', { name: 'One more Poison counter' }).click()
  await page.waitForTimeout(250)
  check('a counter goes up', (await poison.locator('.counters__value').innerText()) === '1')
  const headline = await page.locator('.pile__title', { hasText: 'Your counters' }).first().innerText()
  check('and the heading says so', /1 poison/i.test(headline), JSON.stringify(headline))
  await poison.getByRole('button', { name: 'One fewer Poison counter' }).click()
  await page.waitForTimeout(250)
  check('and comes back down', (await poison.locator('.counters__value').innerText()) === '0')
  check('but never below nothing',
    await poison.getByRole('button', { name: 'One fewer Poison counter' }).isDisabled())

  // A counter the list has never heard of is the point of the field.
  await page.locator('#counter-name').fill('lore')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.waitForTimeout(300)
  const mine = (await page.locator('.counters__label').allInnerTexts()).map((t) => t.toLowerCase())
  check('a counter of your own can be added', mine.includes('lore'), mine.join(', '))

  // It has to survive a reload, or it is not worth typing. The table saves a
  // moment after things settle, so give it that moment before reloading.
  await page.waitForTimeout(2500)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await openRail()
  const after = (await page.locator('.counters__label').allInnerTexts()).map((t) => t.toLowerCase())
  check('and is still there after a reload', after.includes('lore'), after.join(', '))

  // The board is saved; the log is not. Saying "nothing has happened yet" to
  // somebody looking at their own board from yesterday would be a lie.
  const empty = await page.locator('.gamelog__empty').innerText().catch(() => '')
  check('and the log admits it did not keep the history',
    empty === '' || /picked up where you left off/i.test(empty), JSON.stringify(empty))
}

console.log('\nWhat is untapped, and what a card costs')
{
  const costs = await page.locator('.tabletop__cost').count()
  check('hand cards carry their cost above them', costs > 0, `${costs} costs`)
  const pool = page.locator('.pool')
  check('and the strip says what is still untapped', (await pool.count()) === 1)
  const before = await pool.locator('.pool__count').innerText()
  check('with a count on it', /^[0-9]+$/.test(before.trim()), before)
  check('and the colours between them', (await pool.locator('.mana').count()) > 0)
  // Tapping a land has to move the number, or it is not reading the board.
  const land = page.locator('.field .bcard').first()
  await land.click()
  await page.waitForTimeout(200)
  const tap = page.getByRole('button', { name: 'Tap', exact: true })
  if (await tap.count()) {
    await tap.click()
    await page.waitForTimeout(350)
    const after = await pool.locator('.pool__count').innerText().catch(() => '0')
    check('tapping a source takes it out of the count', Number(after) === Number(before) - 1, `${before} then ${after}`)
    await page.getByRole('button', { name: 'Untap all' }).click()
    await page.waitForTimeout(300)
  }
  // It counts cards, not mana, so the wording must not promise mana.
  const label = await pool.locator('.pool__label').innerText()
  check('and it is labelled untapped rather than available', /untapped/i.test(label), label)
}

console.log('\nThe bare table is still there')
await openRail()
await page.getByRole('button', { name: /^Playmat/ }).click()
await page.waitForTimeout(400)
check('the rows come off', (await page.locator('.playmat__lane').count()) === 0)
{
  const bolt = page.locator('.tabletop__handcard .bcard', { hasText: 'Lightning Bolt' }).first()
  if (await bolt.count()) {
    await bolt.click()
    await page.waitForTimeout(200)
    check('and an instant may sit wherever you like again',
      (await page.getByRole('button', { name: 'To the battlefield' }).count()) === 1)
    await page.getByRole('button', { name: 'Put it down' }).click()
  }
}
await openRail()
await page.getByRole('button', { name: /^Playmat/ }).click()
await page.waitForTimeout(400)

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
