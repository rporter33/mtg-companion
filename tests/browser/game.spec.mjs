#!/usr/bin/env node
/**
 * The rebuilt table at #/game: the lobby, the table, and the wall around them.
 *
 * Three things are checked. That the lobby shows a person's decks and lets
 * them pick one. That the table keeps the two laws in
 * docs/table-rebuild/FRICTION.md — one tap plays a card and one tap taps it,
 * with no confirming tap in between — and remembers itself under its own
 * key. And that the old table at #/table is untouched — same picker, same
 * saved slot, nothing of the new one leaked in — which is the promise this
 * rebuild was made under: nothing that works today breaks while the new
 * thing is half built.
 */

import { chromium } from 'playwright'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
// Where the pictures go, as in game-engine.spec.mjs: the system's own
// temporary folder, so the same path works on every machine. Printed at the
// end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `game-${name}.png`)
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const deck = (id, name, formatId, extra = {}) => ({
  id, name, formatId, commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
  main: [{ cardId: 'elf', quantity: 4 }], sideboard: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
})
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [
    deck('d1', 'Elves Forever', 'commander', { commanders: ['cmdr'], main: [{ cardId: 'elf', quantity: 99 }] }),
    deck('d2', 'Mono Green Stompy', 'standard', { main: [{ cardId: 'elf', quantity: 60 }] }),
    deck('d3', 'Pauper Elves', 'pauper', { main: [{ cardId: 'elf', quantity: 60 }] }),
  ],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
}

/*
 * One green pixel stands in for a painting: what matters is that a deck with
 * a commander shows that commander's art and colours, not what the art is.
 */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
/*
 * A card-shaped face, at Scryfall's own `normal` size, for the one place a
 * pixel will not do: the preview. Its whole job is to show a printing whole,
 * and a preview of a grey dot says nothing about whether it does — neither to
 * a measurement nor to the picture this run leaves behind. So this is drawn
 * like a card, with its text box at the bottom, which is the part a cropped
 * preview cuts away and the part somebody opens a preview to read.
 */
const CARD_FACE = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680">
  <rect width="488" height="680" rx="24" fill="#1d1a16"/>
  <rect x="18" y="18" width="452" height="54" rx="10" fill="#cdc4b4"/>
  <text x="34" y="55" font-family="Georgia, serif" font-size="26" fill="#12100d">Llanowar Elves</text>
  <rect x="18" y="84" width="452" height="330" rx="8" fill="#3b5b3a"/>
  <rect x="18" y="426" width="452" height="56" rx="10" fill="#cdc4b4"/>
  <text x="34" y="464" font-family="Georgia, serif" font-size="22" fill="#12100d">Creature — Elf Druid</text>
  <rect x="18" y="494" width="452" height="168" rx="10" fill="#e6dfd2"/>
  <text x="34" y="542" font-family="Georgia, serif" font-size="22" fill="#12100d">{T}: Add {G}.</text>
  <text x="372" y="640" font-family="Georgia, serif" font-size="30" fill="#12100d">1/1</text>
</svg>`)}`
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over,
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf', {
    color_identity: ['G', 'W'], image_uris: { art_crop: PIXEL, small: PIXEL, normal: CARD_FACE },
  }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid', {
    power: '1', toughness: '1', image_uris: { art_crop: PIXEL, small: PIXEL, normal: CARD_FACE },
  }),
]

/*
 * Tapping a card in the fan by its visible sliver. A rotated card's box has
 * empty corners, so the middle of the box can belong to the neighbour; this
 * scans the slot at mid-height for the first run of points that are actually
 * this card and clicks the middle of it. Same helper as table.spec.mjs.
 */
const handPoint = async (card) => {
  await card.scrollIntoViewIfNeeded()
  const point = await card.evaluate((el) => {
    const slot = el.closest('.tabletop__handcard')
    const box = slot.getBoundingClientRect()
    const y = box.top + box.height / 2
    let from = null
    for (let x = box.left + 1; x < box.right; x += 1) {
      const hit = document.elementFromPoint(x, y)
      if (hit && slot.contains(hit)) { if (from === null) from = x }
      else if (from !== null) return { x: (from + x) / 2, y }
    }
    return from === null ? null : { x: (from + box.right) / 2, y }
  })
  if (!point) throw new Error('no part of that hand card is tappable — it is fully covered')
  return point
}
const tapHand = async (card) => { const p = await handPoint(card); await page.mouse.click(p.x, p.y) }
/** Drags from a point to a point with a real pointer, slowly enough to count as a drag. */
const dragTo = async (from, to) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}
const middle = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 430, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const scripts = new Set()
page.on('request', (r) => {
  if (r.resourceType() === 'script') scripts.add(new URL(r.url()).pathname.split('/').pop())
})
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
// Registered after the catch-all so it wins: the shelf fetches its face and
// commander cards in one collection call.
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
// A full load, not a hash change: storage is read once per document and
// cached, so a fragment-only navigation would still see the empty state the
// app started with. This is the trap every spec here has to step around.
await page.reload({ waitUntil: 'networkidle' })

console.log('\nThe lobby is reachable by address, and by nothing else')
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('the address holds', await page.evaluate(() => location.hash) === '#/game')
check('it opens on Solo: Commander, because that is where the decks are',
  /Solo:\s*Commander/.test(await page.locator('.lobby__title').innerText()),
  await page.locator('.lobby__title').innerText())
check('the Table tab opens it', (await page.locator('nav').getByRole('button', { name: 'Table', exact: true }).count()) >= 1)
check('its code is its own chunk, loaded on demand',
  [...scripts].some((s) => s.startsWith('GameView')), [...scripts].join(' '))

console.log('\nFormat tabs carry counts and filter the shelf')
const tabs = page.locator('.lobby__formats .lobby__tab')
check('Commander, Standard and Pauper are up front, then More', (await tabs.count()) === 4,
  String(await tabs.count()))
check('each tab says how many decks are behind it',
  /Commander\s*1/.test(await tabs.nth(0).innerText()) && /Standard\s*1/.test(await tabs.nth(1).innerText()),
  await tabs.allInnerTexts().then((t) => t.join(' | ')))
check('the shelf shows only the current format', (await page.locator('.lobby__deck').count()) === 1)
await page.getByRole('button', { name: /^Standard/ }).click()
await page.waitForTimeout(150)
check('switching tab switches the shelf',
  /Mono Green Stompy/.test(await page.locator('.lobby__shelf').innerText()))
await page.getByRole('button', { name: '▾ More' }).click()
await page.waitForTimeout(150)
check('More reveals the rest of the formats', (await tabs.count()) > 4, String(await tabs.count()))
await page.getByRole('button', { name: /^Commander/ }).click()
await page.waitForTimeout(150)

console.log('\nThe shelf knows its decks')
await page.locator('.lobby__deck .lobby__pips .mana').first().waitFor({ timeout: 5000 })
check('a commander deck shows its colour identity as pips',
  (await page.locator('.lobby__deck .lobby__pips .mana').count()) === 2)
check('and the pips are spoken, not only drawn',
  (await page.locator('.lobby__shelf').getByRole('img', { name: /white/i }).count()) === 1)
check('the commander is named under the deck',
  /Test Commander/.test(await page.locator('.lobby__deckmeta').first().innerText()))
check('and its painting sits behind the name', (await page.locator('.lobby__deck img.deck-art').count()) === 1)
check('a guide deck is offered, and says it rotates',
  /rotates every visit/.test(await page.locator('.lobby__tiles').innerText()))

console.log('\nThe colours filter carries counts')
const colours = page.getByRole('button', { name: /^Colours/ })
check('it exists on a Commander tab', (await colours.count()) === 1)
await colours.click()
await page.waitForTimeout(150)
const facets = page.locator('.lobby__facet')
check('white has one deck behind it', /1\s*$/.test(await facets.nth(0).innerText()), await facets.nth(0).innerText())
check('blue has none', /0\s*$/.test(await facets.nth(1).innerText()), await facets.nth(1).innerText())
await facets.nth(2).click() // black
await page.waitForTimeout(150)
check('asking for black empties the shelf and says so',
  (await page.locator('.lobby__deck').count()) === 0 && /No deck here matches/.test(await page.locator('.lobby__decks').innerText()))
await facets.nth(2).click() // black off
await facets.nth(0).click() // white
await page.waitForTimeout(150)
check('asking for white finds the green-white deck', (await page.locator('.lobby__deck').count()) === 1)
await page.getByRole('button', { name: 'Exactly these' }).click()
await page.waitForTimeout(150)
check('but exactly white does not, because it is also green', (await page.locator('.lobby__deck').count()) === 0)
await facets.nth(4).click() // green
await page.waitForTimeout(150)
check('exactly white and green does', (await page.locator('.lobby__deck').count()) === 1)
await page.getByRole('button', { name: /^Standard/ }).click()
await page.waitForTimeout(150)
check('a sixty-card tab has no colours filter, because nothing honest feeds it',
  (await page.getByRole('button', { name: /^Colours/ }).count()) === 0)
await page.getByRole('button', { name: /^Commander/ }).click()
await page.waitForTimeout(150)
check('changing tab lets the colours go', (await page.locator('.lobby__deck').count()) === 1)

console.log('\nChoosing and starting')
check('nothing is chosen at first, so Start is not offered',
  await page.getByRole('button', { name: /^Start game/ }).isDisabled())
await page.locator('.lobby__deck').first().click()
await page.waitForTimeout(150)
check('the chosen deck gets a tick', (await page.locator('.lobby__deck--chosen .lobby__tick').count()) === 1)
check('and the button names what it will do',
  /Start game with Elves Forever/.test(await page.getByRole('button', { name: /^Start game/ }).innerText()),
  await page.getByRole('button', { name: /^Start game/ }).innerText())
check('the seats panel says plainly that there is nobody to play against',
  /Solitaire/.test(await page.locator('.lobby__seats').innerText()))
await page.fill('#lobby-find', 'zzz')
await page.waitForTimeout(150)
check('search that matches nothing says so', /No deck here matches/.test(await page.locator('.lobby__decks').innerText()))
await page.fill('#lobby-find', '')
await page.waitForTimeout(150)
await page.getByRole('button', { name: /^Start game/ }).click()
await page.waitForTimeout(400)
check('starting carries the deck in the address', await page.evaluate(() => location.hash) === '#/game/d1',
  await page.evaluate(() => location.hash))
await page.locator('.game').waitFor({ timeout: 5000 })
check('and lands on the table', (await page.locator('.game').count()) === 1)

console.log('\nThe table, read clockwise')
const inHand = () => page.locator('.tabletop__handcard .bcard').count()
const onField = () => page.locator('.field .bcard--tile').count()
check('the seat opposite is open, and says so',
  /Open seat/i.test(await page.locator('.plate--them').innerText()), await page.locator('.plate--them').innerText())
check('your plate wears the ring for the active seat', (await page.locator('.plate--you.plate--active').count()) === 1)
check('with the phase as a pill', /untap/i.test(await page.locator('.plate--you .plate__status').innerText()))
check('and twenty life', (await page.locator('.plate--you .plate__total').innerText()).trim() === '20')
check('the four zone tiles carry counts',
  (await page.getByRole('button', { name: /^Library, 92 cards/ }).count()) === 1
  && (await page.getByRole('button', { name: /^Command zone, 1 card$/ }).count()) === 1)
check('the rail has the four presses that matter, and undo',
  (await page.locator('.rail .rail__btn').count()) === 5
  && /end turn/i.test(await page.locator('.rail').innerText()) && /undo/i.test(await page.locator('.rail').innerText()))
check('seven cards are fanned in hand', (await inHand()) === 7)

console.log('\nThe opening hand floats on the battlefield')
check('the prompt is over the field, not a modal', (await page.locator('.game__field .prompt').count()) === 1)
check('and names both choices',
  (await page.getByRole('button', { name: /^Mulligan/ }).count()) === 1 && (await page.getByRole('button', { name: 'Keep hand →' }).count()) === 1)
await page.getByRole('button', { name: /^Mulligan/ }).click()
await page.waitForTimeout(300)
check('a mulligan draws seven again', (await inHand()) === 7)
check('and the prompt counts it, and says what is owed',
  /1 mulligan/.test(await page.locator('.prompt').innerText()) && /put 2 on the bottom/.test(await page.locator('.prompt').innerText()),
  await page.locator('.prompt').innerText())
await page.getByRole('button', { name: 'Keep hand →' }).click()
await page.waitForTimeout(200)
check('keeping puts the prompt away', (await page.locator('.prompt').count()) === 0)
check('and the debt is still written down', /put 1 on the bottom/.test(await page.locator('.game__hand').innerText()))

console.log('\nLaw 2: one tap does the thing')
/** Script-made animations only: the ones useTravel makes, not CSS transitions. */
const travelling = () => page.evaluate(() => document.getAnimations().filter((a) => a.constructor.name === 'Animation').length)
await tapHand(page.locator('.tabletop__handcard .bcard').last())
const travelled = await page.waitForFunction(
  () => document.getAnimations().some((a) => a.constructor.name === 'Animation'), null, { timeout: 1000 },
).then(() => true).catch(() => false)
await page.waitForTimeout(300)
check('one tap on a card in hand plays it', (await onField()) === 1 && (await inHand()) === 6)
check('and the card travels there rather than appearing', travelled)
check('with no confirming panel in between', (await page.locator('.actions').count()) === 0)
const tile = page.locator('.field .bcard--tile').first()
check('the permanent is a tile: a name strip and its kind',
  /LLANOWAR/i.test(await tile.locator('.bcard__name').innerText()) && /creature/i.test(await tile.locator('.bcard__kind').innerText()))
check('and glows for having arrived this turn', (await page.locator('.field .bcard--tile-arrived').count()) === 1)
await tile.click()
await page.waitForTimeout(300)
check('one tap on the tile taps it', (await page.locator('.field .bcard--tapped').count()) === 1)
check('and says so in words as well as by the glyph',
  /tapped/.test(await tile.getAttribute('aria-label')) && (await tile.locator('.bcard__tapglyph').count()) === 1,
  await tile.getAttribute('aria-label'))
await page.getByRole('button', { name: /undo/i }).click()
await page.waitForTimeout(200)
check('undo is on the rail, and undoes it', (await page.locator('.field .bcard--tapped').count()) === 0)

console.log('\nA finger resting on a card')
{
  await page.locator('.field').first().scrollIntoViewIfNeeded()
  const before = await page.locator('.field .bcard--tapped').count()
  // A touch pointer, held still: neither a tap nor a drag.
  await page.locator('.field .bcard--tile').first().evaluate((el) => {
    const box = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, isPrimary: true, button: 0 }))
  })
  await page.waitForTimeout(650)
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 7 })))
  await page.waitForTimeout(150)
  check('picks it up without tapping it', (await page.locator('.actions').count()) === 1 && (await page.locator('.field .bcard--tapped').count()) === before)
  check('and the panel is about that card', /Llanowar Elves/.test(await page.locator('.actions').innerText()))
  await page.getByRole('button', { name: 'Close' }).click()
}

await tile.click({ button: 'right' })
await page.waitForTimeout(200)
check('holding a card opens the rarer actions without doing anything to it',
  (await page.locator('.actions').count()) === 1 && (await page.locator('.field .bcard--tapped').count()) === 0)
check('and they are about that card', /Llanowar Elves/.test(await page.locator('.actions').innerText()))
await page.getByRole('button', { name: 'To the graveyard' }).click()
const ghosted = await page.waitForFunction(() => document.querySelector('.ghost'), null, { timeout: 1000 }).then(() => true).catch(() => false)
await page.waitForTimeout(200)
check('a card going to a pile leaves a ghost that shrinks into its tile', ghosted)
check('a move from the panel lands, and the tile count says so',
  (await onField()) === 0 && (await page.getByRole('button', { name: /^Graveyard, 1 card$/ }).count()) === 1)

console.log('\nReading a card without picking it up')
{
  const p = await handPoint(page.locator('.tabletop__handcard .bcard').last())
  await page.mouse.move(p.x, p.y)
  await page.waitForTimeout(150)
  check('nothing shows the instant the pointer arrives', (await page.locator('.facepeek').count()) === 0)
  await page.waitForTimeout(450)
  check('resting on a card shows its printed face beside it', (await page.locator('.facepeek img').count()) === 1)
  const box = await page.locator('.facepeek').boundingBox()
  check('and not under the pointer', box && (box.x > p.x + 8 || box.x + box.width < p.x - 8), JSON.stringify(box))
  // The whole card, not the top left corner of it: the face is drawn at the
  // size of the preview, never at the image's own, which the box would clip.
  const face = await page.locator('.facepeek img').boundingBox()
  check('the whole card is in the preview, not a corner of it',
    face && box && Math.abs(face.width - box.width) <= 1 && Math.abs(face.height - box.height) <= 1,
    `face ${JSON.stringify(face)} in ${JSON.stringify(box)}`)
  // The box being right is not the card being right. `object-fit` makes the
  // element box the container's whatever is inside it, so a preview showing
  // the art crop — 626 by 457, a quarter of a card — would measure exactly as
  // well as this one. What is measured here is the picture: that it loaded at
  // all, and that what was loaded has a card's own proportions.
  const drawn = await page.locator('.facepeek img').evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight }))
  check('and it is a printing, at the proportions of a card rather than a crop of one',
    drawn.w > 1 && box && Math.abs(drawn.w / drawn.h - box.width / box.height) < 0.01,
    `the image is ${drawn.w} by ${drawn.h} in a ${box?.width} by ${box?.height} box`)
  // The measurement above is what fails when the face is unsized, but the
  // fault the owner reported was seen and not measured — a preview with its
  // text box cut away, in a test run. So the run leaves a picture of it, of a
  // card-shaped face rather than a flat grey rectangle, since a picture that
  // could not show the fault is no answer to somebody who saw it.
  await page.screenshot({ path: SHOT('peek') })
  await page.mouse.move(5, 5)
  await page.waitForTimeout(100)
  check('moving away puts it away', (await page.locator('.facepeek').count()) === 0)
  const q = await handPoint(page.locator('.tabletop__handcard .bcard').first())
  await page.mouse.move(q.x, q.y)
  await page.keyboard.down('z')
  await page.waitForTimeout(60)
  check('Z shows it at once', (await page.locator('.facepeek').count()) === 1)
  await page.keyboard.up('z')
  await page.mouse.move(5, 5)
  await page.waitForTimeout(100)
}

console.log('\nDropping: the most specific thing under the pointer wins')
{
  const field = await page.locator('.field').boundingBox()
  await dragTo(await handPoint(page.locator('.tabletop__handcard .bcard').last()), { x: field.x + field.width * 0.3, y: field.y + field.height * 0.35 })
  check('a card dragged from hand onto the table lands there', (await onField()) === 1 && (await inHand()) === 5)
  const host = await page.locator('.field .field__slot').first().boundingBox()
  await dragTo(await handPoint(page.locator('.tabletop__handcard .bcard').last()), middle(host))
  check('one dragged onto a permanent is put on it, not just beside it',
    (await onField()) === 2 && /attached/.test(await page.locator('.gamelog').innerText()), (await page.locator('.gamelog').innerText()).slice(0, 200))
  // The inner column scrolls, and a box read on something scrolled out of
  // view is a box the pointer cannot reach: the field goes back in view first.
  await page.locator('.field').first().scrollIntoViewIfNeeded()
  const rider = await page.locator('.field .field__slot').last().boundingBox()
  const gy = await page.getByRole('button', { name: /^Graveyard, 1 card$/ }).boundingBox()
  await dragTo(middle(rider), middle(gy))
  check('one dragged onto a zone tile goes to that zone',
    (await onField()) === 1 && (await page.getByRole('button', { name: /^Graveyard, 2 cards$/ }).count()) === 1,
    `field ${await onField()}, hand ${await inHand()}, tiles ${(await page.locator('.game__you .ztile').allInnerTexts()).join(' ').replace(/\n/g, ' ')}, banner ${await page.locator('.banner').allInnerTexts()}`)
  await page.locator('.field').first().scrollIntoViewIfNeeded()
  const left = await page.locator('.field .field__slot').first().boundingBox()
  const handBox = await page.locator('.game__hand').boundingBox()
  await dragTo(middle(left), { x: handBox.x + handBox.width * 0.5, y: handBox.y + handBox.height * 0.6 })
  check('and one dragged back onto the hand comes to hand', (await onField()) === 0 && (await inHand()) === 5,
    `field ${await onField()}, hand ${await inHand()}`)
}

console.log('\nThe tiles open their zones')
await page.getByRole('button', { name: /^Library, 92 cards/ }).click()
await page.waitForTimeout(200)
check('the library tile opens the library beside the log', (await page.locator('.game__side').getByRole('button', { name: 'Shuffle' }).count()) === 1)
await page.locator('.game__side').getByRole('button', { name: 'Draw', exact: true }).click()
await page.waitForTimeout(200)
check('drawing from it draws', (await inHand()) === 6 && (await page.getByRole('button', { name: /^Library, 91 cards/ }).count()) === 1)
await page.getByRole('button', { name: /end turn/i }).click()
await page.waitForTimeout(300)
check('end turn is one press, and the log shows the new turn', /turn 2/i.test(await page.locator('.gamelog').innerText()))

console.log('\nIt remembers itself, under its own key')
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.game').waitFor({ timeout: 5000 })
await page.waitForTimeout(400)
check('the game comes back after a reload',
  (await page.getByRole('button', { name: /^Graveyard, 2 cards$/ }).count()) === 1 && (await inHand()) === 6)
check('with the opening hand already kept', (await page.locator('.prompt').count()) === 0)
const slots = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  return { game: state.game?.saved?.deckId ?? null, table: state.table?.saved ?? null }
})
check('saved under game, not under the old table\'s slot', slots.game === 'd1' && slots.table === null, JSON.stringify(slots))
await page.getByRole('button', { name: 'More' }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: '← Lobby' }).click()
await page.waitForTimeout(300)
check('Lobby goes back to the lobby', await page.evaluate(() => location.hash) === '#/game')

console.log('\nWith motion reduced')
// Leave the table first: it writes its game on the way out, and a slot
// cleared while it is still mounted would be filled straight back in.
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.waitForTimeout(200)
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  state.prefs = { ...(state.prefs ?? {}), reduceMotion: true }
  state.game = { saved: null }
  localStorage.setItem('mtg-companion:v1', JSON.stringify(state))
})
await page.reload({ waitUntil: 'networkidle' })
await page.goto(`${TARGET}#/game/d1`, { waitUntil: 'networkidle' })
await page.locator('.game').waitFor({ timeout: 5000 })
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Keep hand →' }).click()
await tapHand(page.locator('.tabletop__handcard .bcard').last())
await page.waitForTimeout(80)
check('a card simply is where it is: nothing travels', (await onField()) === 1 && (await travelling()) === 0)

console.log('\nA question with its consequence in it')
await page.getByRole('button', { name: 'More' }).click()
await page.getByRole('button', { name: 'Deal again' }).click()
await page.waitForTimeout(250)
const dialog = page.getByRole('dialog')
check('dealing again asks first, and the title is the situation', (await dialog.count()) === 1 && /Deal again/.test(await dialog.getAttribute('aria-label')))
check('the body is the consequence', /This game ends here/.test(await dialog.innerText()))
check('and the buttons say what they do, never OK or Cancel',
  (await dialog.getByRole('button', { name: 'Deal a new hand' }).count()) === 1 && (await dialog.getByRole('button', { name: 'Keep playing' }).count()) === 1
  && (await dialog.getByRole('button', { name: /^(OK|Cancel|Yes|No)$/ }).count()) === 0)
await dialog.getByRole('button', { name: 'Keep playing' }).click()
await page.waitForTimeout(200)
check('keeping playing keeps the game', (await page.getByRole('dialog').count()) === 0 && (await onField()) === 1)
await page.getByRole('button', { name: 'Deal again' }).click()
await page.waitForTimeout(250)
await page.getByRole('dialog').getByRole('button', { name: 'Deal a new hand' }).click()
await page.waitForTimeout(400)
check('dealing a new hand deals one', (await onField()) === 0 && (await inHand()) === 7 && (await page.locator('.prompt').count()) === 1)

console.log('\nA deck that is gone')
await page.goto(`${TARGET}#/game/nope`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
check('says so rather than throwing', /not on this device/.test(await page.locator('main').innerText()))
check('and offers the way back', (await page.getByRole('button', { name: 'Back to the lobby' }).count()) === 1)

console.log('\nThe old address, and a game left at the old table')
await page.goto(`${TARGET}#/table`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
check('#/table still opens the table: the lobby', (await page.locator('.lobby').count()) === 1)
// A game with d1 left at the first table, in the shape that table saved,
// and nothing saved for d1 here. Set while no table is mounted, so nothing
// writes over it on the way out.
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  state.game = { saved: null }
  state.table = { saved: {
    version: 1, deckId: 'd1', deckName: 'Elves Forever', mulligans: 0, savedAt: '2026-09-18T06:00:00Z',
    board: {
      version: 1, players: ['you'], seed: 7, turn: 3, active: 'you', step: null,
      life: { you: 17 }, counters: { you: {} },
      cards: {
        'you:0:elf': { id: 'you:0:elf', cardId: 'elf', owner: 'you', controller: 'you', zone: 'battlefield', x: 0.3, y: 0.35, tapped: true, faceDown: false, flipped: false, counters: {}, note: '', token: false, custom: null, attachedTo: null, finish: 'normal', enteredOnTurn: 1, z: 4 },
        'you:1:elf': { id: 'you:1:elf', cardId: 'elf', owner: 'you', controller: 'you', zone: 'hand', x: 0.5, y: 0.5, tapped: false, faceDown: false, flipped: false, counters: {}, note: '', token: false, custom: null, attachedTo: null, finish: 'normal', enteredOnTurn: 0, z: 0 },
      },
      zones: { you: { library: [], hand: ['you:1:elf'], battlefield: ['you:0:elf'], graveyard: [], exile: [], command: [] } },
      revealed: [], arrows: [], dice: [], notes: '', log: [], nextZ: 5, seq: 12, events: [],
    },
  } }
  localStorage.setItem('mtg-companion:v1', JSON.stringify(state))
})
await page.reload({ waitUntil: 'networkidle' })
await page.goto(`${TARGET}#/table/d1`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('the old address with a deck opens that deck here', await page.evaluate(() => location.hash) === '#/table/d1' && (await page.locator('.game').count()) === 1)
{
  const ask = page.getByRole('dialog')
  check('and a game left at the old table is offered, not taken', (await ask.count()) === 1 && /Pick up where you left off/.test(await ask.getAttribute('aria-label') ?? ''))
  await ask.getByRole('button', { name: 'Continue that game' }).click()
  await page.waitForTimeout(500)
  check('continuing brings it here as it stood: the tapped card, the life, the hand',
    (await page.locator('.field .bcard--tapped').count()) === 1 && (await inHand()) === 1 && (await page.locator('.plate--you .plate__total').innerText()).trim() === '17',
    `field ${await onField()} hand ${await inHand()}`)
  const slots = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mtg-companion:v1'))
    return { old: state.table?.saved ?? null, here: state.game?.saved?.deckId ?? null }
  })
  check('and the old slot is let go, so it is never asked twice', slots.old === null && slots.here === 'd1', JSON.stringify(slots))
}

console.log('\nDeleting a deck asks the same way')
await page.goto(`${TARGET}#/decks`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Delete Pauper Elves' }).click()
await page.waitForTimeout(250)
{
  const ask = page.getByRole('dialog')
  check('the title names the deck', /Delete Pauper Elves/.test(await ask.getAttribute('aria-label') ?? ''))
  check('and the confirming button names it too', (await ask.getByRole('button', { name: 'Delete Pauper Elves' }).count()) === 1)
  await ask.getByRole('button', { name: 'Keep it' }).click()
  await page.waitForTimeout(200)
  check('keeping it keeps it', (await page.getByRole('button', { name: 'Delete Pauper Elves' }).count()) === 1)
  await page.getByRole('button', { name: 'Delete Pauper Elves' }).click()
  await page.waitForTimeout(250)
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Pauper Elves' }).click()
  await page.waitForTimeout(300)
  check('and deleting deletes', (await page.getByRole('button', { name: 'Delete Pauper Elves' }).count()) === 0)
}

console.log()
check('no console errors throughout', errors.length === 0, errors.join('\n'))
console.log(`\nScreenshot: ${SHOT('peek')}`)

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
