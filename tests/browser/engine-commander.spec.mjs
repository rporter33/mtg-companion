#!/usr/bin/env node
/**
 * Commander at the engine's table (HANDOFF.md, M6), on screen: the lobby saying
 * what a Commander deck is dealt as; a deck whose commander the engine does not
 * know saying so, citing the rule, and offering what can be done instead; and a
 * Commander game — 40 life, the commander face up in the command zone, the zone
 * that glows and casts it at a tap and is opened instead by a hold, Shift+Enter
 * or a right-click, the commander on the battlefield saying what it is, the tally
 * of commander damage on the plate, told apart by whose, the question of the command
 * zone with the rule that asks it (903.9a), and the commander tax said when it
 * is cast again (903.8). Every one of those in words as well as on the table,
 * reached by the keyboard, and with nothing axe can find wrong at either width.
 *
 * And a stand-in commander (HANDOFF.md §3 item 19): a deck whose commander the
 * engine does not know, led instead by a legendary creature of its own the rules
 * allow — offered in the gate as the player's choice, the rules cited, chosen by
 * the keyboard; sent as the commander with what it stands in for, which the
 * engine is never told; said to be a stand-in by the log, the command zones, the
 * prompt, the battlefield and both seat lists; the deck on the shelf unchanged;
 * and all of it again after a reload and after the relay restarts on its rooms.
 *
 * The relay runs here with the scripted stand-in (tests/fixtures/fake-engine.mjs),
 * which deals a Commander table of its own making over the captured views, so
 * this runs on any machine and in CI; game-engine.spec.mjs plays a Commander game
 * against the real engine, and tests/engine-live.test.js holds the real engine's
 * Commander rules to account.
 *
 *   node tests/browser/engine-commander.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRelay } from '../../scripts/relay-server.mjs'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
const FAKE_ENGINE = fileURLToPath(new URL('../fixtures/fake-engine.mjs', import.meta.url))
// Pictures go to the system's temporary folder and are named at the end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `engine-commander-${name}.png`)
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (test, ms = 8000) => {
  const start = Date.now()
  while (!(await test())) {
    if (Date.now() - start > ms) return false
    await sleep(100)
  }
  return true
}

// No pace: the stand-in plays no turn of its own worth waiting on. Its rooms are
// kept on disk, so the relay can be restarted on them, as M7's rooms are.
const ROOMS = mkdtempSync(join(tmpdir(), 'engine-commander-'))
const relayOptions = { roomsDir: ROOMS, engineCommand: FAKE_ENGINE, pingMs: 60_000, pace: 0 }
let relayServer = createRelay(relayOptions)
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const PORT = relayServer.server.address().port
const RELAY = `http://127.0.0.1:${PORT}`

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '', cmc: 0, type_line,
  oracle_text: '', color_identity: [], colors: [], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
// Real cards, as Scryfall has them: the commander the stand-in deals, and basics of its colours.
const CARDS = [
  c('rhys', 'Rhys the Redeemed', 'Legendary Creature — Elf Warrior', { mana_cost: '{G/W}', cmc: 1, color_identity: ['G', 'W'], colors: ['G', 'W'], power: '1', toughness: '1', set: 'shm', set_name: 'Shadowmoor', collector_number: '237' }),
  c('forest', 'Forest', 'Basic Land — Forest', { produced_mana: ['G'], color_identity: ['G'], collector_number: '211' }),
  c('plains', 'Plains', 'Basic Land — Plains', { produced_mana: ['W'], color_identity: ['W'], collector_number: '196' }),
  // A commander no engine knows (the stand-in's rule: a name beginning "Made-Up").
  c('madeup', 'Made-Up Legend', 'Legendary Creature — Human', { mana_cost: '{1}{G}', cmc: 2, color_identity: ['G'], colors: ['G'] }),
  // And one in Rhys's colours, so Rhys, a legendary creature of its deck, may stand in for it (§3 item 19).
  c('warden', 'Made-Up Warden', 'Legendary Creature — Elf', { mana_cost: '{G}{W}', cmc: 2, color_identity: ['G', 'W'], colors: ['G', 'W'] }),
]
const deckOf = (id, name, commanders) => ({
  id, name, formatId: 'commander', commanders, signatureSpell: null, categoryOrder: [], versions: [],
  main: [{ cardId: 'forest', quantity: 50 }, { cardId: 'plains', quantity: 49 }], sideboard: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [
    deckOf('d1', 'Selesnya', ['rhys']), deckOf('d2', 'Unknown Legend', ['madeup']),
    { ...deckOf('d3', 'Warden', ['warden']), main: [{ cardId: 'rhys', quantity: 1 }, { cardId: 'forest', quantity: 50 }, { cardId: 'plains', quantity: 48 }] },
    // A Brawl deck and a Duel Commander one (§3 item 20), the second led by a commander no engine knows.
    { ...deckOf('d4', 'Selesnya Brawl', ['rhys']), formatId: 'brawl' },
    { ...deckOf('d5', 'Warden Duel', ['warden']), formatId: 'duel', main: [{ cardId: 'rhys', quantity: 1 }, { cardId: 'forest', quantity: 50 }, { cardId: 'plains', quantity: 48 }] },
  ],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { relayUrl: RELAY, playerName: 'Robin', reduceMotion: true },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
// What the page said in its sit, as the page sent it; and the last tally of commander
// damage a view brought the page, as it came off the wire, so a plate that says none
// is known to have had one to say (found in the review of item 20).
const wire = { sit: null, tally: null }
page.on('websocket', (ws) => {
  ws.on('framesent', ({ payload }) => {
    try { const m = JSON.parse(typeof payload === 'string' ? payload : payload.toString()); if (m?.op === 'sit') wire.sit = m } catch { /* not ours */ }
  })
  ws.on('framereceived', ({ payload }) => {
    try {
      const m = JSON.parse(typeof payload === 'string' ? payload : payload.toString())
      const players = m?.op === 'view' ? (m.state ?? m.delta)?.players : null
      const tally = Array.isArray(players) ? players.flatMap((p) => (Array.isArray(p?.commanderDamage) ? p.commanderDamage.map((d) => ({ ...d, to: p.playerId })) : [])) : []
      if (tally.length) wire.tally = tally
    } catch { /* not ours */ }
  })
})
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
await page.route('**/cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from(PIXEL.split(',')[1], 'base64') }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })

/** What axe finds on the page as it stands, at the levels a11y.spec.mjs holds the app to. */
const axeViolations = async () => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  return result.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join('; ')}`)
}
const axeClean = async () => axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false))
const seats = page.locator('.lobby__seats')
const text = (locator) => locator.textContent().then((t) => t ?? '').catch(() => '')
const logText = () => text(page.locator('.gamelog'))
const prompt = page.locator('.prompt')
const engineAt = (code) => relayServer.rooms.get(code).engine.engine
const tile = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).first()

/** Opens a table the engine holds from the lobby, and returns its code. */
const openTable = async () => {
  await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
  const play = page.getByRole('button', { name: 'Play the engine' })
  await until(() => play.count().then((n) => n === 1))
  await play.click()
  await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash)))
  return page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
}

console.log('\nIn the lobby')
let code = await openTable()
check('the lobby at a Commander table says what a Commander deck is dealt as, each rule by its number',
  await until(() => text(seats).then((t) => t.includes("A Commander deck is dealt as a Commander game, by Argentum's own Commander rules: 40 life each (903.7), each commander in its owner's command zone (903.6), {2} more to cast it from there for each time before (903.8), and 21 combat damage from one commander loses the game (903.10a)."))),
  await text(seats))
check('a Commander deck the engine knows is counted with its commander, a hundred cards',
  await until(() => text(tile('Selesnya')).then((t) => t.includes('The engine knows all 100 cards.'))), await text(tile('Selesnya')))
const unknownTile = () => text(tile('Unknown Legend'))
check('one whose commander it does not know says how much it knows, names the commander, and says why it cannot deal a Commander game with it',
  await until(() => unknownTile().then((t) => t.includes('The engine knows 99 of 100 cards.') && t.includes('Made-Up Legend')
    && t.includes('It does not know the commander, Made-Up Legend, and every Commander deck has one (903.3), so it cannot deal a Commander game with this deck.'))),
  await unknownTile())
check('the lobby has no accessibility violations', await axeClean())

await tile('Unknown Legend').click()
await page.getByRole('button', { name: /Sit down with Unknown Legend/ }).click()
const gate = page.getByRole('dialog', { name: 'The engine does not know every card in Unknown Legend' })
check('sitting with it says so instead, in the house dialog', await until(() => gate.count().then((n) => n === 1)))
check('the commander is named among the cards it does not know, as the commander',
  /1 Made-Up Legend, its commander/.test(await text(gate.getByRole('list', { name: 'Cards the engine does not know' }))), await text(gate))
check('and what playing without it deals: the rest, by the ordinary rules',
  (await text(gate)).includes('Without it, the engine deals the other 99 cards by the ordinary rules: 20 life each, and no command zone.'), await text(gate))
check('each way on is a button that says what it does', await Promise.all(['Play the engine without it', 'Play it alone instead', 'Choose another deck']
  .map((name) => gate.getByRole('button', { name }).count())).then((ns) => ns.every((n) => n === 1)))
check('the dialog has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('gate') })
await gate.getByRole('button', { name: 'Play the engine without it' }).click()
check('played without it, the table opens', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000))
check('the sit asked for Commander and brought no commander', await until(() => Boolean(wire.sit)) && wire.sit.format === 'commander' && !('commander' in wire.sit), JSON.stringify(wire.sit))
check('so the engine was asked for no Commander game', await until(async () => (await engineAt(code).call('lastNew')).request?.players?.length === 2)
  && !('format' in (await engineAt(code).call('lastNew')).request))
check('and the log says why, citing the rule',
  await until(() => logText().then((t) => t.includes('With no commander to deal there is no Commander game, since every Commander deck has one (903.3), so it is played by the ordinary rules: 20 life each, and no command zone.'))),
  await logText())
check('and what was left out', (await logText()).includes('Played without 1 Made-Up Legend'), await logText())

console.log('\nA Commander game')
code = await openTable()
wire.sit = null
await tile('Selesnya').click()
await page.getByRole('button', { name: /Sit down with Selesnya/ }).click()
check('the table opens', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000))
check('the sit asked for Commander, its commander apart from its library, in the printing chosen',
  await until(() => Boolean(wire.sit)) && wire.sit.format === 'commander' && JSON.stringify(wire.sit.commander) === JSON.stringify({ name: 'Rhys the Redeemed', set: 'shm', number: '237' }) && !('Rhys the Redeemed' in wire.sit.deck),
  JSON.stringify(wire.sit))
const openingHand = page.getByRole('group', { name: 'Your opening hand' })
await until(() => openingHand.count().then((n) => n === 1))
await openingHand.getByRole('button', { name: /^Keep this hand/ }).click()
check('the log says once that it is played by the Commander rules, citing them',
  await until(() => logText().then((t) => t.split("Played by the Commander rules: 40 life each (903.7), and each commander begins in its owner's command zone (903.6).").length === 2)),
  await logText())
const yours = page.locator('.plate--you')
const theirs = page.locator('.plate--them')
check('both plates say 40 life', await until(async () => /, 40 life/.test(await yours.getAttribute('aria-label') ?? '') && /, 40 life/.test(await theirs.getAttribute('aria-label') ?? '')),
  `${await yours.getAttribute('aria-label')} | ${await theirs.getAttribute('aria-label')}`)
const command = page.locator('.game__you .ztile[data-zone="command"]')
const CASTS = 'Command zone, 1 card: Rhys the Redeemed, your commander can be cast now: a tap casts it, and a hold, a right-click or Shift+Enter opens the zone'
check('your command zone names the commander in it, glows, and says a tap casts it and how else it is opened',
  await until(async () => (await command.getAttribute('aria-label')) === CASTS
    && (await command.getAttribute('class')).includes('ztile--playable')),
  await command.getAttribute('aria-label'))
check('and while a tap casts, it discloses nothing, and names its key for opening',
  (await command.getAttribute('aria-expanded')) === null && (await command.getAttribute('aria-keyshortcuts')) === 'Shift+Enter')
check('and the prompt says it in words, with its cost', await until(() => text(prompt).then((t) => t.includes('Your commander, Rhys the Redeemed, can be cast from the command zone for {G/W}. Tap the command zone to cast it, or pass.'))), await text(prompt))
// The stand-in names its seat Bot, as the captured run's seat was named.
check('the engine\'s command zone names its commander too, and can be looked through',
  /^Bot's command zone, 1 card: Rhys the Redeemed$/.test(await page.locator('.game__them .ztile[data-zone="command"]').getAttribute('aria-label') ?? '')
  && await page.locator('.game__them button.ztile[data-zone="command"]').count() === 1,
  await page.locator('.game__them .ztile[data-zone="command"]').getAttribute('aria-label'))
check('the table has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('command') })

// Reached and pressed with the keyboard alone, as every control is.
await command.focus()
await page.keyboard.press('Enter')
check('a press on the command zone casts the commander, through the engine\'s offer for it',
  await until(async () => (await engineAt(code).call('lastAct')).request?.index === 1), JSON.stringify((await engineAt(code).call('lastAct')).request))
const onField = page.locator('.game__field .field__slot [aria-label^="Rhys the Redeemed"]').first()
check('and it is on the battlefield, said to be a commander', await until(() => onField.getAttribute('aria-label').then((l) => /, a commander/.test(l ?? '')).catch(() => false)), await onField.getAttribute('aria-label').catch(() => 'none'))
check('its command zone is empty now', await until(() => command.getAttribute('aria-label').then((l) => l === 'Command zone, 0 cards')), await command.getAttribute('aria-label'))
check('and with nothing in it to cast, a press opens it, and it says whether it is open', (await command.getAttribute('aria-expanded')) === 'false' && (await command.getAttribute('aria-keyshortcuts')) === null)

console.log('\nCommander damage, the question of the command zone, and the tax')
const engine = engineAt(code)
await engine.call('commanderDamage', { to: 'e1', from: 'e0', amount: 3 })
// The engine's own commander, a copy of yours by the same name, turned on it: two
// tallies of one name, told apart by whose each is (found in M6's review).
await engine.call('commanderDamage', { to: 'e1', from: 'e1', amount: 2 })
await engine.call('commanderTo', { seat: 'e0', zone: 'graveyard' })
await engine.call('ask', { decision: {
  id: 'q1', type: 'YesNo', player: 'e0', prompt: 'Put Rhys the Redeemed into the command zone instead of leaving it in the graveyard?', source: 'Rhys the Redeemed',
  yesText: 'Command zone', noText: 'Leave in the graveyard', commanderZone: 'graveyard',
} })
// The stand-in's captured stop offers an attack; declining it is the move that brings the next stop.
await until(() => prompt.getByRole('button', { name: 'No attack' }).count().then((n) => n === 1))
await prompt.getByRole('button', { name: 'No attack' }).click()
check('the engine\'s plate says the commander damage it has been dealt, each commander\'s by whose it is, and what the tally counts towards, citing the rule',
  await until(() => text(theirs).then((t) => t.includes("Commander damage: your Rhys the Redeemed 3 of 21 and Bot's Rhys the Redeemed 2 of 21. A player dealt 21 combat damage by one commander loses the game (903.10a)."))), await text(theirs))
check('and its spoken label says it too', /commander damage: your Rhys the Redeemed 3 of 21 and Bot's Rhys the Redeemed 2 of 21/.test(await theirs.getAttribute('aria-label') ?? ''), await theirs.getAttribute('aria-label'))
await page.locator('.game__them').first().screenshot({ path: SHOT('damage') })
check('your plate says none, as none has been dealt you', !(await text(yours)).includes('Commander damage'))
check('the owner is asked where the commander goes, in Argentum\'s words, with the rule that asks it',
  await until(() => text(prompt).then((t) => t.includes('Put Rhys the Redeemed into the command zone instead of leaving it in the graveyard?')
    && t.includes("A commander put into a graveyard or exile may be put into its owner's command zone, a state-based action (903.9a)."))),
  await text(prompt))
check('the table asking it has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('question') })
const home = prompt.getByRole('button', { name: 'Command zone' })
await home.focus()
await page.keyboard.press('Enter')
check('the answer pressed is the one sent', await until(async () => (await engine.call('lastDecide')).request?.yes === true))
check('the commander is back in the command zone, which glows again', await until(() => command.getAttribute('aria-label').then((l) => l === CASTS)), await command.getAttribute('aria-label'))
check('and its cost says the commander tax, by the engine\'s own count (903.8)',
  await until(() => text(prompt).then((t) => t.includes('Your commander, Rhys the Redeemed, can be cast from the command zone for {2}{G/W}: {2} more for the commander tax, as it has been cast from the command zone once before (903.8). Tap the command zone to cast it, or pass.'))),
  await text(prompt))
check('the table has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('tax') })

// The long way in: the command zone opened, rather than cast from — by a hold, by
// the keyboard, and by a right-click. A phone has no right-click, and iOS raises no
// contextmenu from a long press, so the hold is the table's own (found in M6's
// review). It is dispatched here as a touch pointer, as a finger makes one.
const actsBefore = (await engine.call('tally')).acts
const zone = page.locator('section.pile[aria-label="Command zone"]')
const closeZone = async () => { await zone.getByRole('button', { name: 'Close' }).click(); return until(() => zone.count().then((n) => n === 0)) }
const box = await command.boundingBox()
const finger = { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
await command.dispatchEvent('pointerdown', finger)
check('a finger held on the command zone opens it rather than casting', await until(() => zone.count().then((n) => n === 1)) && (await engine.call('tally')).acts === actsBefore)
// What a phone raises around the lift: Android a contextmenu while the finger is down, iOS a click after it.
await command.dispatchEvent('contextmenu', { button: 0 })
await command.dispatchEvent('pointerup', finger)
await command.dispatchEvent('click')
check('and neither the contextmenu nor the click that follow the hold casts, or closes it again',
  (await zone.count()) === 1 && (await engine.call('tally')).acts === actsBefore)
await page.screenshot({ path: SHOT('held') })
check('closed again', await closeZone())
await command.focus()
await page.keyboard.press('Shift+Enter')
check('Shift+Enter on the command zone opens it rather than casting', await until(() => zone.count().then((n) => n === 1)) && (await engine.call('tally')).acts === actsBefore)
check('closed again', await closeZone())
await command.click({ button: 'right' })
check('a right-click on the command zone opens it rather than casting', await until(() => zone.count().then((n) => n === 1)) && (await engine.call('tally')).acts === actsBefore)
const inZone = zone.getByRole('button', { name: /^Rhys the Redeemed/ })
check('where the commander is said to be one, and glows, saying it can be cast from there',
  await until(() => text(inZone).then((t) => t === 'Rhys the Redeemed · a commander · can be cast from the command zone now')) && /pile__card--playable/.test(await inZone.getAttribute('class')),
  await text(inZone))
// And a press on it there casts it, as a tap on a card in hand plays it.
await inZone.click()
check('a press on it there casts it too', await until(async () => (await engine.call('tally')).acts === actsBefore + 1))

console.log('\nAt a phone\'s width')
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(200)
check('the table fits without scrolling sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`))
check('and has no accessibility violations there either', await axeClean())
await page.screenshot({ path: SHOT('phone'), fullPage: true })
await page.setViewportSize({ width: 1280, height: 900 })

console.log('\nA stand-in commander (HANDOFF.md §3 item 19)')
// The Warden deck's commander is one no engine knows, and Rhys, a legendary creature
// of the deck in its colours, may lead it instead: offered, chosen, dealt, and said
// everywhere to be a stand-in, through a reload and a restart of the relay.
code = await openTable()
wire.sit = null
const storedDeck = () => page.evaluate(() => localStorage.getItem('mtg-companion:v1:deck:d3'))
const deckBefore = await storedDeck()
const wardenTile = () => text(tile('Warden'))
check('the deck\'s tile says the engine cannot lead it, and what could instead',
  await until(() => wardenTile().then((t) => t.includes('It does not know the commander, Made-Up Warden, and every Commander deck has one (903.3), so it cannot deal a Commander game with this deck.')
    && t.includes('A stand-in can lead it: a legendary creature of its own the engine knows, Rhys the Redeemed.'))),
  await wardenTile())
await tile('Warden').click()
await page.getByRole('button', { name: /Sit down with Warden/ }).click()
const standGate = page.getByRole('dialog', { name: 'The engine does not know every card in Warden' })
check('sitting with it opens the gate', await until(() => standGate.count().then((n) => n === 1)))
const leads = standGate.getByRole('group', { name: 'Or lead it with a stand-in' })
check('which offers the stand-in the rules allow, citing them, and what is dealt with it',
  (await text(leads)).includes("Rhys the Redeemed can lead it instead, as a stand-in: a legendary creature of the deck's own, as a commander is (903.3), that the engine knows, whose colour identity lies within the deck's and holds every card dealt (903.4, 903.5c). It begins in the command zone in Made-Up Warden's place, said throughout to be a stand-in and not the deck's real commander, and the engine deals the other 98 cards with it as a Commander game: 40 life each (903.7), and 99 cards where a Commander deck holds a hundred (903.5a). The deck you keep is not changed."),
  await text(leads))
const rhysRadio = leads.getByRole('radio', { name: /^Rhys the Redeemed/ })
check('as a choice of the player\'s, none chosen for them, and no button to play it until one is',
  await rhysRadio.count() === 1 && !(await rhysRadio.isChecked()) && await standGate.getByRole('button', { name: /^Play the engine led by/ }).count() === 0)
check('the ways on M6 offered are still there', await Promise.all(['Play the engine without it', 'Play it alone instead', 'Choose another deck']
  .map((name) => standGate.getByRole('button', { name }).count())).then((ns) => ns.every((n) => n === 1)))
await rhysRadio.focus()
await page.keyboard.press('Space')
const playLed = standGate.getByRole('button', { name: 'Play the engine led by Rhys the Redeemed' })
check('chosen by the keyboard, the button that plays it names it', await until(() => playLed.count().then((n) => n === 1)) && await rhysRadio.isChecked())
check('the gate with a stand-in offered has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('standin-gate') })
await playLed.click()
check('played, the table opens', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000))
check('the sit brings the stand-in as the commander, out of the library, naming the real one',
  await until(() => Boolean(wire.sit)) && wire.sit.format === 'commander'
    && JSON.stringify(wire.sit.commander) === JSON.stringify({ name: 'Rhys the Redeemed', set: 'shm', number: '237', standsFor: 'Made-Up Warden' })
    && !('Rhys the Redeemed' in wire.sit.deck) && !('Made-Up Warden' in wire.sit.deck),
  JSON.stringify(wire.sit))
check('and the engine is dealt it as the commander it is, told nothing of what it stands in for',
  await until(async () => (await engineAt(code).call('lastNew')).request?.format === 'commander')
    && JSON.stringify((await engineAt(code).call('lastNew')).request.players.map((p) => p.commander)) === JSON.stringify([{ name: 'Rhys the Redeemed', set: 'shm', number: '237' }, { name: 'Rhys the Redeemed', set: 'shm', number: '237' }]),
  JSON.stringify((await engineAt(code).call('lastNew')).request?.players?.map((p) => p.commander)))
const handToKeep = page.getByRole('group', { name: 'Your opening hand' })
await until(() => handToKeep.count().then((n) => n === 1))
await handToKeep.getByRole('button', { name: /^Keep this hand/ }).click()
const STAND_IN_LOG = "Rhys the Redeemed leads your deck as a stand-in, as you chose: the engine does not know the deck's real commander, Made-Up Warden, and a Commander game needs one (903.3)."
const COPY_LOG = 'The engine plays a copy of your deck, led as yours is by Rhys the Redeemed, a stand-in for Made-Up Warden.'
check('the log says once that it is a stand-in, not the real commander, and why; and that the engine\'s copy is led by it too',
  await until(() => logText().then((t) => t.split(STAND_IN_LOG).length === 2 && t.split(COPY_LOG).length === 2)), await logText())
const standCommand = page.locator('.game__you .ztile[data-zone="command"]')
check('your command zone names it as a stand-in, not the deck\'s real commander, in its label',
  await until(() => standCommand.getAttribute('aria-label').then((l) => (l ?? '').startsWith("Command zone, 1 card: Rhys the Redeemed, a stand-in for Made-Up Warden, not the deck's real commander"))),
  await standCommand.getAttribute('aria-label'))
check('and in a word on the tile', (await text(standCommand.locator('.ztile__standin'))) === 'stand-in')
check('and the prompt says the commander that can be cast is a stand-in',
  await until(() => text(prompt).then((t) => t.includes('Your commander, Rhys the Redeemed, a stand-in for Made-Up Warden, can be cast from the command zone for {G/W}. Tap the command zone to cast it, or pass.'))),
  await text(prompt))
check('the engine\'s command zone says the same of its copy',
  /^Bot's command zone, 1 card: Rhys the Redeemed, a stand-in for Made-Up Warden, not the deck's real commander$/.test(await page.locator('.game__them .ztile[data-zone="command"]').getAttribute('aria-label') ?? '')
    && (await text(page.locator('.game__them .ztile__standin'))) === 'stand-in',
  await page.locator('.game__them .ztile[data-zone="command"]').getAttribute('aria-label'))
const seatRows = page.locator('.game__seats')
check('the table\'s seat list says it of both seats',
  await until(() => text(seatRows).then((t) => t.split('led by Rhys the Redeemed, a stand-in for Made-Up Warden').length === 3)), await text(seatRows))
check('the table with a stand-in has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('standin-table') })
// Opened rather than cast from, the command zone's pile says it too, card by card.
const standActs = (await engineAt(code).call('tally')).acts
await standCommand.focus()
await page.keyboard.press('Shift+Enter')
const standInPile = zone.getByRole('button', { name: /^Rhys the Redeemed/ })
check('opened, the command zone says the card in it is a commander standing in for the real one, and can be cast from there',
  await until(() => text(standInPile).then((t) => t === 'Rhys the Redeemed · a commander, standing in for Made-Up Warden · can be cast from the command zone now')),
  await text(standInPile))
check('closed again, nothing cast', await closeZone() && (await engineAt(code).call('tally')).acts === standActs)
// Cast from the command zone, it is said to be a stand-in on the battlefield too.
await standCommand.click()
const standOnField = page.locator('.game__field .field__slot [aria-label^="Rhys the Redeemed"]').first()
check('cast, it is on the battlefield, said to be a commander standing in for the real one',
  await until(() => standOnField.getAttribute('aria-label').then((l) => /, a commander, standing in for Made-Up Warden/.test(l ?? '')).catch(() => false)),
  await standOnField.getAttribute('aria-label').catch(() => 'none'))
check('the deck on the shelf is as it was', (await storedDeck()) === deckBefore)

console.log('\nA stand-in, through a reload and a restart')
wire.sit = null
await page.reload({ waitUntil: 'networkidle' })
check('after a reload the sit brings the same stand-in', await until(() => Boolean(wire.sit), 20_000) && wire.sit.commander?.standsFor === 'Made-Up Warden', JSON.stringify(wire.sit?.commander))
check('and the log and the command zone say it again',
  await until(() => logText().then((t) => t.includes(STAND_IN_LOG)), 20_000)
    && await until(() => page.locator('.game__them .ztile[data-zone="command"]').getAttribute('aria-label').then((l) => /a stand-in for Made-Up Warden/.test(l ?? ''))),
  await logText())
check('and the field', await until(() => standOnField.getAttribute('aria-label').then((l) => /standing in for Made-Up Warden/.test(l ?? '')).catch(() => false)))
// The relay stopped as a deploy stops it, and started again on the same rooms (M7).
await relayServer.shutdown()
relayServer = createRelay(relayOptions)
await new Promise((resolve) => relayServer.server.listen(PORT, resolve))
check('after the relay restarts, the game comes back and the log says so',
  await until(() => logText().then((t) => /The relay restarted/.test(t)), 30_000), await logText())
check('and the stand-in is still said, on the field and of the engine\'s command zone',
  await until(() => standOnField.getAttribute('aria-label').then((l) => /standing in for Made-Up Warden/.test(l ?? '')).catch(() => false), 20_000)
    && /a stand-in for Made-Up Warden/.test(await page.locator('.game__them .ztile[data-zone="command"]').getAttribute('aria-label') ?? ''))
check('and by the room, which kept it', await fetch(`${RELAY}/rooms/${code}`).then((r) => r.json()).then((r) => r.seats?.[0]?.standIn?.for === 'Made-Up Warden' && r.engineDeck?.standsFor === 'Made-Up Warden'))
// The lobby's seats panel, at the same table, says it of both seats.
await page.goto(`${TARGET}#/game/engine/${code}`, { waitUntil: 'networkidle' })
check('the lobby\'s seats panel says it of your seat and of the engine\'s',
  await until(() => text(seats).then((t) => t.includes('You, once you sit · led by Rhys the Redeemed, a stand-in for Made-Up Warden')
    && t.includes('The engine, with a copy of your deck, led by Rhys the Redeemed, a stand-in for Made-Up Warden'))),
  await text(seats))
check('the lobby saying it has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('standin-seats') })
await page.goto(`${TARGET}#/game/engine/${code}/d3`, { waitUntil: 'networkidle' })

console.log('\nA stand-in at a phone\'s width')
await page.setViewportSize({ width: 390, height: 844 })
check('back at the table, the engine\'s command zone says its stand-in in a word',
  await until(() => text(page.locator('.game__them .ztile__standin')).then((t) => t === 'stand-in'), 20_000))
await page.waitForTimeout(200)
check('the word is no wider than the tile\'s face, so the tile keeps the size it had', await page.evaluate(() => {
  const zone = document.querySelector('.game__them .ztile[data-zone="command"]')
  const face = zone?.querySelector('.ztile__face')?.getBoundingClientRect().width ?? 0
  return face > 0 && zone.querySelector('.ztile__standin').getBoundingClientRect().width <= face + 0.5 && zone.getBoundingClientRect().width <= face + 0.5
}))
await page.locator('.game__them').first().screenshot({ path: SHOT('standin-them-phone') })
check('the table with a stand-in fits without scrolling sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`))
check('and has no accessibility violations there either', await axeClean())
await page.screenshot({ path: SHOT('standin-phone'), fullPage: true })
await page.setViewportSize({ width: 1280, height: 900 })

console.log('\nA Brawl game (HANDOFF.md §3 item 20)')
// Dealt as a Commander game at Brawl's own numbers, for two: 25 life, the commander
// in the command zone, and commander damage losing nobody, so the plate keeps no
// tally of it (903.12h). The stand-in engine deals it as the real one does.
const formatTab = async (name) => {
  await page.getByRole('button', { name: /More/ }).click()
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
}
code = await openTable()
wire.sit = null
await formatTab('Brawl')
check('the lobby at a Brawl table says what a Brawl deck is dealt as, each rule by its number, and where the table does not follow Brawl\'s own',
  await until(() => text(seats).then((t) => t.includes("A Brawl deck is dealt as a Commander game for two, by Argentum's own Commander rules at Brawl's numbers: 25 life each (903.12f), each commander in its owner's command zone (903.6), {2} more to cast it from there for each time before (903.8), and commander damage loses nobody the game (903.12h).")
    && t.includes("Brawl's first mulligan is free (903.12g), and not here") && t.includes("where the Comprehensive Rules' Brawl holds sixty (903.12d)"))),
  await text(seats))
check('a Brawl deck the engine knows is counted with its commander, a hundred cards',
  await until(() => text(tile('Selesnya Brawl')).then((t) => t.includes('The engine knows all 100 cards.'))), await text(tile('Selesnya Brawl')))
check('the Brawl lobby has no accessibility violations', await axeClean())
await seats.screenshot({ path: SHOT('brawl-lobby') })
await tile('Selesnya Brawl').click()
await page.getByRole('button', { name: /Sit down with Selesnya Brawl/ }).click()
check('the table opens', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000))
check('the sit asked for Brawl, its commander apart from its library',
  await until(() => Boolean(wire.sit)) && wire.sit.format === 'brawl' && wire.sit.commander?.name === 'Rhys the Redeemed' && !('Rhys the Redeemed' in wire.sit.deck), JSON.stringify(wire.sit))
check('and the engine was asked for a Brawl game', await until(async () => (await engineAt(code).call('lastNew')).request?.format === 'brawl'))
const brawlHand = page.getByRole('group', { name: 'Your opening hand' })
await until(() => brawlHand.count().then((n) => n === 1))
await brawlHand.getByRole('button', { name: /^Keep this hand/ }).click()
const BRAWL_LOG = "Played by the Brawl rules, for two: 25 life each (903.12f), each commander begins in its owner's command zone (903.6), and commander damage loses nobody the game (903.12h). Brawl's first mulligan is free (903.12g), and not here: the engine makes a first mulligan free only at a table of more than two, so each counts."
check('the log says once that it is played by the Brawl rules, citing them, and the one it does not follow',
  await until(() => logText().then((t) => t.split(BRAWL_LOG).length === 2)), await logText())
check('both plates say 25 life', await until(async () => /, 25 life/.test(await yours.getAttribute('aria-label') ?? '') && /, 25 life/.test(await theirs.getAttribute('aria-label') ?? '')),
  `${await yours.getAttribute('aria-label')} | ${await theirs.getAttribute('aria-label')}`)
check('your command zone holds your commander and says a tap casts it',
  await until(async () => (await command.getAttribute('aria-label')) === CASTS), await command.getAttribute('aria-label'))
// Argentum keeps the tally in a Brawl game too, towards a threshold no game reaches; the plate says none of it.
wire.tally = null
await engineAt(code).call('commanderDamage', { to: 'e1', from: 'e0', amount: 7 })
await command.click()
check('cast from the command zone, it is on the battlefield', await until(() => onField.getAttribute('aria-label').then((l) => /, a commander/.test(l ?? '')).catch(() => false)))
// The tally is on the wire to the page first, 7 against the engine's seat towards Argentum's
// threshold past reach, and drawn once the page has painted after it; only then is the plate's
// silence about it worth anything.
const brawlTally = () => wire.tally?.some((d) => d.to === 'e1' && d.amount === 7 && d.threshold === 2147483647)
check('the tally Argentum keeps reached the page, 7 towards a threshold past reach, and the plate says nothing of it, since it loses nobody the game',
  await until(() => brawlTally())
    && await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
    && !(await text(theirs)).includes('Commander damage') && !/commander damage/i.test(await theirs.getAttribute('aria-label') ?? ''),
  `${JSON.stringify(wire.tally)} | ${await text(theirs)}`)
check('the room says it dealt a Brawl game, at the engine\'s numbers',
  await fetch(`${RELAY}/rooms/${code}`).then((r) => r.json()).then((r) => r.format?.played === 'brawl' && r.format?.rules?.life === 25 && r.format.rules.commanderDamage === null))
check('the Brawl table has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('brawl') })

console.log('\nA Duel Commander deck led by a stand-in (HANDOFF.md §3 items 19 and 20)')
code = await openTable()
wire.sit = null
await formatTab('Duel Commander')
check('the lobby at a Duel Commander table says what a Duel Commander deck is dealt as, the numbers its own rules committee\'s',
  await until(() => text(seats).then((t) => t.includes('A Duel Commander deck is dealt as a Commander game for two') && t.includes('20 life each (Duel Commander rules, 300.1a)') && t.includes('(Duel Commander rules, 506.1a)'))),
  await text(seats))
check('a Duel Commander deck whose commander the engine does not know says so in its own game\'s words, and what could lead it',
  await until(() => text(tile('Warden Duel')).then((t) => t.includes('It does not know the commander, Made-Up Warden, and every Duel Commander deck has one (Duel Commander rules, 402.1b), so it cannot deal a Duel Commander game with this deck.')
    && t.includes('A stand-in can lead it: a legendary creature of its own the engine knows, Rhys the Redeemed.'))),
  await text(tile('Warden Duel')))
await tile('Warden Duel').click()
await page.getByRole('button', { name: /Sit down with Warden Duel/ }).click()
const duelGate = page.getByRole('dialog', { name: 'The engine does not know every card in Warden Duel' })
check('sitting with it opens the gate', await until(() => duelGate.count().then((n) => n === 1)))
const duelLeads = duelGate.getByRole('group', { name: 'Or lead it with a stand-in' })
check('which offers the stand-in by Duel Commander\'s own rules for a commander, which defer to 903, and what is dealt with it at Duel Commander\'s numbers',
  (await text(duelLeads)).includes("a legendary creature of the deck's own, as a commander is (Duel Commander rules, 403.1a, which defers to 903.3), that the engine knows, whose colour identity lies within the deck's and holds every card dealt (Duel Commander rules, 103.4b and 403.1a, which defer to 903.4 and 903.5c).")
    && (await text(duelLeads)).includes("the engine deals the other 98 cards with it as a Duel Commander game: 20 life each (Duel Commander rules, 300.1a), and 99 cards where a Duel Commander deck holds a hundred (Duel Commander rules, 402.1b). The deck you keep is not changed."),
  await text(duelLeads))
check('the Duel Commander gate has no accessibility violations', await axeClean())
await duelLeads.getByRole('radio', { name: /^Rhys the Redeemed/ }).check()
await duelGate.getByRole('button', { name: 'Play the engine led by Rhys the Redeemed' }).click()
check('played, the table opens', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000))
check('the sit asked for Duel Commander, led by the stand-in, naming the real one',
  await until(() => Boolean(wire.sit)) && wire.sit.format === 'duel' && wire.sit.commander?.standsFor === 'Made-Up Warden', JSON.stringify(wire.sit))
const duelHand = page.getByRole('group', { name: 'Your opening hand' })
await until(() => duelHand.count().then((n) => n === 1))
await duelHand.getByRole('button', { name: /^Keep this hand/ }).click()
check('the log says it is played by the Duel Commander rules, and that the stand-in leads it in a Duel Commander game',
  await until(() => logText().then((t) => t.includes("Played by the Duel Commander rules, for two: 20 life each (Duel Commander rules, 300.1a), each commander begins in its owner's command zone (903.6), and commander damage loses nobody the game (Duel Commander rules, 506.1a).")
    && t.includes("Rhys the Redeemed leads your deck as a stand-in, as you chose: the engine does not know the deck's real commander, Made-Up Warden, and a Duel Commander game needs one (Duel Commander rules, 402.1b)."))),
  await logText())
check('both plates say 20 life', await until(async () => /, 20 life/.test(await yours.getAttribute('aria-label') ?? '') && /, 20 life/.test(await theirs.getAttribute('aria-label') ?? '')))
check('and the command zone says the stand-in', await until(() => command.getAttribute('aria-label').then((l) => (l ?? '').startsWith('Command zone, 1 card: Rhys the Redeemed, a stand-in for Made-Up Warden'))), await command.getAttribute('aria-label'))
check('the Duel Commander table has no accessibility violations', await axeClean())
await page.screenshot({ path: SHOT('duel') })

check('no uncaught errors', errors.length === 0, errors.join('; '))
check('nothing written to the console as an error', consoleErrors.length === 0, consoleErrors.join('; '))

console.log(`\nPictures: ${['gate', 'command', 'damage', 'question', 'tax', 'held', 'phone', 'standin-gate', 'standin-table', 'standin-seats', 'standin-phone', 'brawl-lobby', 'brawl', 'duel'].map(SHOT).join(', ')}`)
await browser.close()
await relayServer.shutdown()
rmSync(ROOMS, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
