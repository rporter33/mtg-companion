#!/usr/bin/env node
/**
 * Everything the old table proved that the rebuilt one had only wired.
 *
 * The old table's spec is the bar the rebuilt table has to clear before the
 * Table tab can switch to it and the old one can go. These are its systems
 * — pointing, counters, face-down, dice, printings, foils, tokens, the
 * stack, the pile browser, the coach — run through the rebuilt screens,
 * where a tap acts and the rarer things are behind a hold. Same deck of
 * test cards as the old spec, so the two can be read side by side.
 *
 *   node tests/browser/game-parity.spec.mjs http://localhost:4173/
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
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const ART = { small: PIXEL, normal: PIXEL, large: PIXEL, art_crop: PIXEL, border_crop: PIXEL }
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf', { image_uris: ART }),
  c('forest', 'Forest', 'Basic Land — Forest', { mana_cost: '', cmc: 0, produced_mana: ['G'], finishes: ['nonfoil', 'foil'], image_uris: ART }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid', { power: '1', toughness: '1', image_uris: ART }),
  c('bolt', 'Lightning Bolt', 'Instant', { mana_cost: '{R}', oracle_text: 'Deal 3 damage to any target.', image_uris: ART }),
]
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
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [{
    id: 'd1', name: 'Parity', formatId: 'commander', commanders: ['cmdr'], signatureSpell: null, categoryOrder: [], versions: [],
    main: [{ cardId: 'forest', quantity: 45 }, { cardId: 'elf', quantity: 30 }, { cardId: 'bolt', quantity: 24 }], sideboard: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  // Motion off: every check here is about state, and a card mid-flight is
  // a card whose box is not where it will be.
  prefs: { reduceMotion: true },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: [...CARDS, FOREST_SHOWCASE, TREASURE] }) }))
await page.route('**/api.scryfall.com/cards/search**', (route) => {
  const query = decodeURIComponent(new URL(route.request().url()).searchParams.get('q') ?? '')
  const data = query.includes('oracleid:o-forest') ? [CARDS[1], FOREST_SHOWCASE]
    : query.includes('t:token') ? [TREASURE]
      : []
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, total_cards: data.length, has_more: false }) })
})

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(`${TARGET}#/game/d1`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.game').waitFor({ timeout: 5000 })
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Keep hand →' }).click()

// --- helpers ---------------------------------------------------------------

const onField = () => page.locator('.field .bcard--tile').count()
const inHand = () => page.locator('.tabletop__handcard .bcard').count()
const handCard = (name) => page.locator('.tabletop__handcard').filter({ has: page.getByLabel(new RegExp(`^${name}`)) }).locator('.bcard').first()
const tileOf = (name) => page.locator('.field .bcard--tile').filter({ hasText: new RegExp(name, 'i') }).first()
/** Picks a card up the long way: nothing happens to it, its actions open. */
const hold = async (locator) => { await locator.click({ button: 'right' }); await page.waitForTimeout(200) }
const more = async () => {
  if ((await page.locator('.more').count()) === 0) { await page.getByRole('button', { name: 'More' }).click(); await page.waitForTimeout(200) }
}
const tapHand = async (card) => {
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
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(250)
}
/** Draws until the hand holds one of the named card, or gives up. */
const drawUntil = async (name, most = 30) => {
  for (let i = 0; i < most; i++) {
    if (await handCard(name).count()) return true
    await more()
    await page.locator('.more').getByRole('button', { name: 'Draw', exact: true }).click()
    await page.waitForTimeout(120)
  }
  return false
}
/** Plays the named card from hand, drawing until one is there. */
const playOne = async (name) => {
  check(`there is a ${name} to play`, await drawUntil(name))
  const before = await onField()
  await tapHand(handCard(name))
  return (await onField()) === before + 1
}

console.log('\nAn instant does not stay on the battlefield')
{
  check('there is a bolt in hand to try it with', await drawUntil('Lightning Bolt'))
  const before = await onField()
  await hold(handCard('Lightning Bolt'))
  check('the table does not even offer to put it there',
    (await page.getByRole('button', { name: 'To the battlefield' }).count()) === 0, await page.locator('.actions').innerText())
  await page.getByRole('button', { name: 'Close' }).click()
  await tapHand(handCard('Lightning Bolt'))
  check('one tap sends it to the stack instead', (await page.locator('.stackshelf').count()) === 1 && (await onField()) === before)
  check('and the stack says which way it resolves', /Last on, first to happen/.test(await page.locator('.stackshelf').innerText()))
  await page.getByRole('button', { name: /^Resolve/ }).click()
  await page.waitForTimeout(300)
  check('resolving an instant sends it to the graveyard, not the table',
    (await page.getByRole('button', { name: /^Graveyard, 1 card$/ }).count()) === 1 && (await onField()) === before)
  check('and the stack empties', (await page.locator('.stackshelf').count()) === 0)
}

console.log('\nPointing at things')
{
  check('a creature goes onto the table', await playOne('Llanowar Elves'))
  check('and a land', await playOne('Forest'))
  check('and another creature', await playOne('Llanowar Elves'))
  await hold(tileOf('Llanowar'))
  await page.getByRole('button', { name: 'Attacking…' }).click()
  await page.waitForTimeout(200)
  check('the table says what it is waiting for', /attacking/.test(await page.locator('.banner').innerText()))
  check('and every other card is a possible far end', (await page.locator('.field__slot--aimable').count()) === 2)
  await page.getByRole('button', { name: 'Never mind' }).click()
  await page.waitForTimeout(150)
  check('and can change its mind', (await page.locator('.field__arrow').count()) === 0 && (await page.locator('.banner').count()) === 0)
  await hold(tileOf('Llanowar'))
  await page.getByRole('button', { name: 'Attacking…' }).click()
  await page.waitForTimeout(150)
  await tileOf('Forest').click()
  await page.waitForTimeout(200)
  check('an arrow is drawn', (await page.locator('.field__arrow--attack').count()) === 1)
  check('and picking the far end neither taps it nor picks it up',
    (await page.locator('.field .bcard--tapped').count()) === 0 && (await page.locator('.actions').count()) === 0)
  await hold(tileOf('Llanowar'))
  await page.getByRole('button', { name: 'Pointing at…' }).click()
  await page.waitForTimeout(150)
  await page.locator('.field .bcard--tile').last().click()
  await page.waitForTimeout(200)
  check('a second arrow, drawn differently because it means something else', (await page.locator('.field__arrow--target').count()) === 1)
  await more()
  await page.getByRole('button', { name: 'Clear the arrows' }).click()
  await page.waitForTimeout(200)
  check('and both come off at once', (await page.locator('.field__arrow').count()) === 0)
}

console.log('\nCounters and face-down')
{
  const tile = tileOf('Llanowar')
  await hold(tile)
  await page.getByRole('button', { name: '+ +1/+1' }).click()
  await page.waitForTimeout(200)
  check('a counter shows on the tile', /\+1 \+1\/\+1/.test(await tile.innerText()), await tile.innerText())
  await page.getByRole('button', { name: 'One more +1/+1 counter' }).click()
  await page.waitForTimeout(200)
  check('and goes up', /\+2 \+1\/\+1/.test(await tile.innerText()), await tile.innerText())
  for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'One fewer +1/+1 counter' }).click(); await page.waitForTimeout(150) }
  check('a counter at zero is no counter at all', !/\+1\/\+1/.test(await tile.innerText()))
  await page.getByRole('button', { name: 'Turn it face down' }).click()
  await page.waitForTimeout(200)
  const down = page.locator('.field .bcard--down').first()
  check('a face-down tile gives nothing away', (await down.count()) === 1 && /face down/i.test(await down.innerText()) && (await down.getAttribute('aria-label')) === 'A face-down card')
  await page.getByRole('button', { name: 'Turn it up' }).click()
  await page.waitForTimeout(200)
  check('and turns back over', (await page.locator('.field .bcard--down').count()) === 0)
  await page.getByRole('button', { name: 'Close' }).click()
}

console.log('\nDice')
{
  await more()
  await page.getByRole('button', { name: 'Flip a coin' }).click()
  await page.waitForTimeout(200)
  check('a coin comes up one way or the other', /heads|tails/.test(await page.locator('.dice').innerText()), await page.locator('.dice').innerText())
  await page.getByRole('button', { name: 'Roll a d20' }).click()
  await page.waitForTimeout(200)
  check('and a d20 keeps the coin beneath it', (await page.locator('.dice__roll').count()) === 2)
  check('and the log says what was rolled', /rolled \d+ on a d20/.test(await page.locator('.gamelog').innerText()))
}

console.log('\nChoosing a printing')
{
  await hold(tileOf('Forest'))
  await page.getByRole('button', { name: 'Another printing…' }).click()
  await page.waitForTimeout(600)
  check('every printing is offered, with where it is from', (await page.locator('.printings__print').count()) === 2, await page.locator('.printings').innerText().catch(() => 'no panel'))
  check('and the copy in the deck is marked as the one you have', (await page.locator('.printings__print--mine').count()) === 1)
  check('a different frame is named rather than guessed at', /showcase/.test(await page.locator('.printings').innerText()))
  await page.locator('.printings__print', { hasText: 'Showcase Set' }).click()
  await page.waitForTimeout(500)
  check('choosing one returns to the card, still picked up', (await page.locator('.actions').count()) === 1)
  check('and the deck now carries that printing, so it is the copy next game too',
    await page.evaluate(() => {
      const deck = JSON.parse(localStorage.getItem('mtg-companion:v1:deck:d1') ?? '{}')
      return (deck.main ?? []).some((e) => e.cardId === 'forest-showcase') && !(deck.main ?? []).some((e) => e.cardId === 'forest')
    }))
  await page.getByRole('button', { name: 'Another printing…' }).click()
  await page.waitForTimeout(500)
  check('and the marked copy has moved to it', /Showcase Set/.test(await page.locator('.printings__print--mine').innerText()))
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForTimeout(200)
  check('done with the printings returns to the card', (await page.locator('.actions').count()) === 1)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(200)
}

console.log('\nFoils')
{
  const tile = tileOf('Forest')
  await hold(tile)
  await page.getByRole('button', { name: 'Mine is foil' }).click()
  await page.waitForTimeout(200)
  check('a foil tile has its sheen', (await page.locator('.field .bcard--foil .bcard__sheen').count()) === 1)
  check('and is said out loud, because a sheen is not readable to everyone', /foil/.test(await page.locator('.field .bcard--foil').getAttribute('aria-label')))
  await page.getByRole('button', { name: 'An ordinary copy' }).click()
  await page.waitForTimeout(200)
  check('and it can be an ordinary copy again', (await page.locator('.field .bcard--foil').count()) === 0)
  await page.getByRole('button', { name: 'Close' }).click()
}

console.log('\nTokens and blank cards')
{
  const started = await onField()
  await more()
  await page.getByRole('button', { name: 'Make a token' }).click()
  await page.waitForTimeout(200)
  await page.getByLabel('Search for a token').fill('treasure')
  await page.getByRole('button', { name: 'Find it' }).click()
  await page.waitForTimeout(600)
  check('a real token is found', (await page.locator('.tokenmaker__token').count()) === 1, await page.locator('.tokenmaker').innerText())
  await page.locator('.tokenmaker__token').click()
  await page.waitForTimeout(300)
  check('and goes onto the table as a tile under its own name', (await onField()) === started + 1 && (await tileOf('Treasure').count()) === 1)
  await more()
  await page.getByRole('button', { name: 'Make a token' }).click()
  await page.waitForTimeout(200)
  await page.getByLabel('Name', { exact: true }).fill('Zombie')
  await page.getByLabel('Power').fill('2')
  await page.getByLabel('Toughness').fill('2')
  await page.getByRole('button', { name: 'Put it on the table' }).click()
  await page.waitForTimeout(300)
  check('a blank card with a name on it needs no connection at all', (await onField()) === started + 2)
  check('and carries the numbers you wrote on it', /2\/2/.test(await tileOf('Zombie').innerText()), await tileOf('Zombie').innerText())
  await hold(tileOf('Zombie'))
  await page.getByRole('button', { name: 'To the graveyard' }).click()
  await page.waitForTimeout(300)
  check('a token that leaves the table ceases to exist rather than filling the graveyard',
    (await onField()) === started + 1 && (await page.getByRole('button', { name: /^Graveyard, 1 card$/ }).count()) === 1)
  await page.getByRole('button', { name: 'Close' }).click().catch(() => {})
}

console.log('\nLooking through a pile')
{
  await page.getByRole('button', { name: /^Library/ }).click()
  await page.waitForTimeout(200)
  await page.locator('.game__side').getByRole('button', { name: 'Search' }).click()
  await page.waitForTimeout(300)
  const lib = page.locator('.game__side')
  check('the library can be searched at all, which an enforced game would not allow', (await lib.locator('.zonebrowse').count()) === 1)
  const before = await lib.locator('.pile__card').count()
  check('and shows what is in it', before > 0, `${before} cards`)
  await lib.locator('.zonebrowse__find').fill('t:creature')
  await page.waitForTimeout(300)
  const creatures = await lib.locator('.pile__card').count()
  check('a t: search narrows it', creatures > 0 && creatures < before, `${creatures} of ${before}`)
  await lib.locator('.zonebrowse__find').fill('zzzznothing')
  await page.waitForTimeout(300)
  check('an empty result says so rather than showing nothing at all', (await lib.getByText('Nothing here matches.').count()) === 1)
  check('and the reminder to shuffle afterwards is there, as it would be in paper', /Shuffle when you are done/.test(await lib.innerText()))
  await page.getByRole('button', { name: /^Graveyard, 1 card$/ }).click()
  await page.waitForTimeout(200)
  check('the graveyard tile opens the graveyard', (await lib.locator('.zonebrowse').count()) === 1 && (await lib.locator('.pile__card').count()) === 1)
  await page.getByRole('button', { name: 'Close' }).click()
}

console.log('\nThe coach, and telling it to be quiet')
{
  // A creature that arrived this turn, tapped: the one thing a new player
  // gets wrong most, and the note the coach exists for.
  await page.locator('.field .bcard--tile').filter({ hasText: /Llanowar/i }).last().click()
  await page.waitForTimeout(200)
  check('the coach speaks up about a creature tapped the turn it arrived',
    (await page.locator('.tablecoach').count()) === 1 && /arrived this turn/.test(await page.locator('.tablecoach').innerText()),
    await page.locator('.tablecoach').innerText().catch(() => 'no notes at all'))
  await page.getByRole('button', { name: 'Quiet, please' }).click()
  await page.waitForTimeout(200)
  check('the whole coach can be silenced in one press', (await page.locator('.tablecoach').count()) === 0)
  await more()
  check('and the switch says so', /off/.test(await page.getByRole('button', { name: /^Notes/ }).innerText()))
  await page.getByRole('button', { name: /^Notes/ }).click()
  await page.waitForTimeout(200)
  check('it comes back when asked', (await page.locator('.tablecoach').count()) === 1)
}

console.log('\nWhat is untapped')
{
  check('the plate counts the untapped sources Scryfall says make mana', /Untapped/i.test(await page.locator('.plate--you').innerText()) && /\b1\b/.test(await page.locator('.plate__mana').innerText()), await page.locator('.plate__mana').innerText())
  await tileOf('Forest').click()
  await page.waitForTimeout(200)
  check('and tapping the land takes it out of the count', /None untapped/.test(await page.locator('.plate__mana').innerText()), await page.locator('.plate__mana').innerText())
}

console.log()
check('no console errors throughout', errors.length === 0, errors.join('\n'))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
