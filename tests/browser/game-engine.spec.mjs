#!/usr/bin/env node
/**
 * The engine on screen, through the app itself.
 *
 * engine-live.test.js proves the wire; this proves the screens on top of
 * it: from the lobby, a person opens a table the engine holds, sits down
 * with a deck, keeps the opening hand, and plays — a land by tapping it, a
 * pass from the rail, an attack by tapping a creature and pressing Attack —
 * against the engine's own player, with the log saying what the engine did on
 * their behalf. Then a reload, which has to land back in the same seat at the
 * same table; and at a table of its own, a mulligan taken and a card put on
 * the bottom, by the keyboard. And Commander (M6): the app's four example
 * Commander decks checked by the real engine, which knows none of their
 * commanders at the pin and says so, and a Commander game with a deck made from
 * one of them, its commander cast from the command zone by a tap.
 *
 * Needs the built engine (scripts/engine-build.sh). Where there is none
 * this says so and passes nothing, rather than pretending: a JVM is not
 * something the browser suite may demand of every machine.
 *
 *   node tests/browser/game-engine.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { createRelay } from '../../scripts/relay-server.mjs'
import { findEngine } from '../../scripts/engine-bridge.mjs'
import { EXAMPLE_DECKS } from '../../src/data/example-decks.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Where the pictures go: the system's own temporary folder, so the same path
// works on every machine rather than only where /tmp exists. Printed at the
// end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `engine-${name}.png`)
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))

// An engine process loads the whole card corpus before its first answer: about
// 15 s on the owner's machine (engine/README.md). A room's engine starts when the
// seat is taken and the lobby's checker when a deck is first asked about, so
// the waits that include one starting cover that, with room for a slower
// runner; every other wait is after it.
const ENGINE_START_MS = 60_000

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
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

const engineCommand = findEngine()
if (!engineCommand) {
  console.log('No engine is built here (scripts/engine-build.sh), so this spec has nothing to drive.')
  console.log('\n0 passed, 0 failed (skipped: no engine)')
  process.exit(0)
}

// One game, the same every run. Left to shuffle, the engine deals a different
// game each time, and this spec's claims (a land to play and a stop after it,
// an attack within a few turns, a hand card that can be reached) hold for some
// deals and not others. That looked like flakiness on a first Windows run and
// was not. Seeds 1 to 5 give it everything it looks for; 6, 7 and 8 do not.
// In 6 the hand is not one lighter after the land and no attack comes (most
// likely no one-drop, so play runs on to the next turn and a card is drawn);
// in 7 the first goblin tapped is not offered as an attacker; in 8 no attack
// comes in time. Those are the deals for making the spec sturdier.
// ENGINE_SEED plays another.
const SEED = Number(process.env.ENGINE_SEED) || 1
// The pace a play of the engine's stands for before the room asks for the next
// one (HANDOFF.md, M2). Low, but never zero: at zero the room stops pacing
// altogether and the engine's turn arrives in one jump again, so the very
// thing this spec watches would not exist. The room's own default is 600 ms,
// which is right for a person and would have this suite sitting through whole
// seconds of every engine turn — a dozen turns of it before the attack comes.
const PACE = 120
const relayServer = createRelay({ engineCommand, pingMs: 300, engineSeed: SEED, pace: PACE })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const RELAY = `http://127.0.0.1:${relayServer.server.address().port}`

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{R}', cmc: 1, type_line,
  oracle_text: '', color_identity: ['R'], colors: ['R'], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { standard: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
// Portal's own collector numbers, the same in Scryfall and in Argentum (both
// checked 2026-09-21): the app sends a card's printing with it, and the engine
// deals that printing when it has it.
const CARDS = [
  c('mountain', 'Mountain', 'Basic Land — Mountain', { mana_cost: '', cmc: 0, produced_mana: ['R'], collector_number: '208' }),
  c('goblin', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste', collector_number: '145' }),
  c('bully', 'Goblin Bully', 'Creature — Goblin', { mana_cost: '{1}{R}', cmc: 2, power: '2', toughness: '1', collector_number: '131' }),
  c('hulk', 'Hulking Goblin', 'Creature — Goblin', { mana_cost: '{2}{R}', cmc: 3, power: '2', toughness: '2', collector_number: '135' }),
  c('hammer', 'Volcanic Hammer', 'Sorcery', { mana_cost: '{1}{R}', cmc: 2, oracle_text: 'Volcanic Hammer deals 3 damage to any target.', collector_number: '154' }),
  c('axe', 'Lava Axe', 'Sorcery', { mana_cost: '{4}{R}', cmc: 5, oracle_text: 'Lava Axe deals 5 damage to target player.', collector_number: '137' }),
  // A creature whose arrival asks its controller for a target: the one way a
  // targets decision reaches this table today (PLAN.md, M2). Ravnica's own
  // printing, which the engine has (checked 2026-09-24).
  c('spark', 'Sparkmage Apprentice', 'Creature — Human Wizard', {
    mana_cost: '{1}{R}', cmc: 2, power: '1', toughness: '1', oracle_text: 'When this creature enters, it deals 1 damage to any target.',
    set: 'rav', set_name: 'Ravnica: City of Guilds', collector_number: '144',
  }),
  // No such cards exist, so the engine cannot know them: the deck gate's cases.
  c('madeup', 'Made-Up Goblin', 'Creature — Goblin', { power: '1', toughness: '1' }),
  c('madewish', 'Made-Up Wish', 'Sorcery'),
  // A real card in a printing Portal never had: the engine knows the card, not the printing.
  c('goblin9999', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste', collector_number: '9999' }),
  // Made-up cards of a made-up set, whose code no real set could have, so the
  // lobby's reason for them holds whatever sets the engine comes to have.
  c('rift', 'Made-Up Rift', 'Sorcery', { set: 'made-up', set_name: 'Made-Up Expansion' }),
  c('riftwalker', 'Made-Up Rift Walker', 'Creature — Goblin', { power: '1', toughness: '1', set: 'made-up', set_name: 'Made-Up Expansion' }),
]
const GOBLINS = [
  { cardId: 'mountain', quantity: 14 }, { cardId: 'goblin', quantity: 6 }, { cardId: 'bully', quantity: 4 },
  { cardId: 'hulk', quantity: 4 }, { cardId: 'hammer', quantity: 4 }, { cardId: 'axe', quantity: 2 },
]
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [{
    id: 'd1', name: 'Goblins', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
    main: GOBLINS,
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }, {
    // Its name does not start with "Goblins", so selectors for d1 still find d1 alone.
    id: 'd2', name: 'Mixed Goblins', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
    main: [...GOBLINS.map((e) => (e.cardId === 'goblin' ? { ...e, cardId: 'goblin9999' } : e)), { cardId: 'madeup', quantity: 2 }],
    // A sideboard card the engine does not know is left out and said, not a reason to stop.
    sideboard: [{ cardId: 'axe', quantity: 2 }, { cardId: 'madewish', quantity: 1 }], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }, {
    // Two cards of a set the engine does not list: one reason, said once.
    id: 'd3', name: 'Rift Goblins', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
    main: [...GOBLINS, { cardId: 'rift', quantity: 2 }, { cardId: 'riftwalker', quantity: 1 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }, {
    // Dealt from the same seed, this deck's fifth turn casts a Sparkmage
    // Apprentice with creatures on both sides of the table, and its arrival
    // asks for a target among them and the two players. Played the same way
    // each time — the first play the engine lists, else a pass — so it is the
    // same game; tried against the engine directly before it was written here.
    id: 'd4', name: 'Sparks', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
    main: [{ cardId: 'mountain', quantity: 14 }, { cardId: 'spark', quantity: 12 }, { cardId: 'goblin', quantity: 8 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { relayUrl: RELAY, playerName: 'Robin', reduceMotion: true },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
// Not the same thing as a thrown error: a view applied wrongly, a delta the
// hook could not take or a socket message it did not understand is written to
// the console and the screen carries on. A paced turn is a message every few
// hundred milliseconds, so this is where such a thing would show.
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
// What the room told the page, as the page received it: the latest status, the
// seats, and which engine seat is this one. The glows are held against the
// engine's own offers, read here off the wire, rather than against this spec's
// idea of which cards ought to be playable (HANDOFF.md, M1b).
const wire = { status: null, seats: [], me: null, choices: null }
page.on('websocket', (ws) => ws.on('framereceived', ({ payload }) => {
  let m
  try { m = JSON.parse(typeof payload === 'string' ? payload : payload.toString()) } catch { return }
  if (m?.t !== 'engine') return
  if (m.op === 'status' && m.status) wire.status = m.status
  if (m.op === 'seats' && Array.isArray(m.seats)) wire.seats = m.seats
  if (m.op === 'seated' && m.engineSeat) { wire.me = m.engineSeat; wire.choices = m.choices ?? null }
}))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
// The engine's image links point at Scryfall's image host, which this
// sandbox cannot reach; a pixel stands in so the printed face falls back
// to the drawn one, as it does offline.
await page.route('**/cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from(PIXEL.split(',')[1], 'base64') }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), STATE)
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })

console.log('\nFrom the lobby')
check('a lobby that is not the engine\'s asks nothing about its decks', await page.locator('.lobby__deckcheck').count() === 0)
const playEngine = page.getByRole('button', { name: 'Play the engine' })
check('the lobby offers the engine when the relay has one', await until(() => playEngine.count().then((n) => n === 1)))
await playEngine.click()
check('opening a table the engine holds changes the address', await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash))), page.url())
const code = await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
check('the lobby says the rules are enforced', await until(() => page.locator('.lobby__mode').textContent().then((t) => /Rules enforced/.test(t ?? ''))))
check('the seats panel names the engine as the seat opposite', await until(() => page.locator('.lobby__seats').textContent().then((t) => /The engine/.test(t ?? ''))))
// How strongly it plays (HANDOFF.md, M3). levels.spec.mjs holds the choice
// itself to account; here it is the real engine that has to take it. Easy is
// chosen because easy is the engine every seeded claim below was written
// against — the same Argentum profile the engine played before there were
// levels — so the game dealt from SEED is the one it always was.
const levels = page.getByRole('group', { name: 'How the engine plays' })
check('the lobby offers three levels, intermediate for a first game', await until(() => levels.getByRole('radio').count().then((n) => n === 3))
  && await levels.getByRole('radio', { name: /^Intermediate/ }).isChecked())
check('and the room was opened at it', await fetch(`${RELAY}/rooms/${code}`).then((r) => r.json()).then((r) => r.level === 'intermediate'))
await levels.getByRole('radio', { name: /^Easy/ }).check()

console.log('\nThe deck gate')
/** What axe finds on the page as it stands, at the WCAG levels a11y.spec.mjs holds the app to. */
const axeViolations = async () => {
  // A dialog rises in from 60% opacity over 0.2 s (sheet.css), and contrast
  // measured mid-rise is the contrast of half-faded text. Wait for stillness.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  return result.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join('; ')}`)
}
const tile = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).first()
// The first check starts the relay's checking engine, which loads the corpus first.
check('a deck the engine fully knows says so on its tile', await until(() => tile('Goblins').textContent().then((t) => /The engine knows all 34 cards\./.test(t ?? '')), ENGINE_START_MS))
// Made-Up Goblin is dealt as a Portal card, and the engine lists Portal as
// complete (engine-live.test.js), so the reason is that it has the set and not the card.
check('a deck it does not says how much it knows, and names what it does not, with why', await until(() => tile('Mixed Goblins').textContent().then((t) => /The engine knows 34 of 36 cards\./.test(t ?? '') && /The rules engine does not know this card: Made-Up Goblin\./.test(t ?? '')), ENGINE_START_MS))
check('cards of a set the engine does not list are one reason, said once', await until(() => tile('Rift Goblins').textContent().then((t) => /The engine knows 34 of 37 cards\./.test(t ?? '')
  && /The rules engine has no Made-Up Expansion cards yet: Made-Up Rift and Made-Up Rift Walker\./.test(t ?? '')
  && (t ?? '').split('The rules engine').length === 2), ENGINE_START_MS), await tile('Rift Goblins').textContent())
check('and no date of the engine\'s own is shown', !/\d{4}-\d{2}-\d{2}|\d{1,2} [A-Z][a-z]{2} \d{4}/.test(await page.locator('.lobby__shelf').textContent() ?? ''))
check('and says a sideboard card it does not know will be left out', /Left out of the sideboard, as the engine does not know it: Made-Up Wish\./.test(await tile('Mixed Goblins').textContent() ?? ''))
check('the lobby at the engine\'s table has no accessibility violations', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await tile('Mixed Goblins').click()
await page.getByRole('button', { name: /Sit down with Mixed Goblins/ }).click()
const gate = page.getByRole('dialog', { name: 'The engine does not know every card in Mixed Goblins' })
check('sitting with it says so instead, in the house dialog', await until(() => gate.count().then((n) => n === 1)))
check('the dialog names every card it does not know, with how many', /2 Made-Up Goblin/.test(await gate.textContent() ?? ''))
check('under the reason the tile gives', /The rules engine does not know this card:\s*2 Made-Up Goblin/.test(await gate.getByRole('list', { name: 'Cards the engine does not know' }).textContent() ?? ''))
check('and offers both ways on, and a way back', await Promise.all([
  gate.getByRole('button', { name: 'Play the engine without them' }).count(),
  gate.getByRole('button', { name: 'Play it alone instead' }).count(),
  gate.getByRole('button', { name: 'Choose another deck' }).count(),
]).then((ns) => ns.every((n) => n === 1)))
check('the dialog has no accessibility violations', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.screenshot({ path: SHOT('gate') })
await gate.getByRole('button', { name: 'Choose another deck' }).click()
check('choosing another deck closes it, and nothing was sat down with', await until(() => gate.count().then((n) => n === 0)) && /#\/game\/engine\/[A-Z0-9]{5}$/.test(await page.evaluate(() => location.hash)))

await tile('Rift Goblins').click()
await page.getByRole('button', { name: /Sit down with Rift Goblins/ }).click()
const riftGate = page.getByRole('dialog', { name: 'The engine does not know every card in Rift Goblins' })
await until(() => riftGate.count().then((n) => n === 1))
const riftList = riftGate.getByRole('list', { name: 'Cards the engine does not know' })
check('the dialog gives the reason once, with each card and its count under it', await riftList.textContent().then((t) => (t ?? '').split('The rules engine').length === 2
  && /The rules engine has no Made-Up Expansion cards yet:\s*2 Made-Up Rift\s*1 Made-Up Rift Walker/.test(t ?? '')), await riftList.textContent())
// The dialog rises in over 0.2 s (sheet.css); a picture taken mid-rise shows the shelf through it.
await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
await page.screenshot({ path: SHOT('gate-reasons') })
await riftGate.getByRole('button', { name: 'Choose another deck' }).click()
await until(() => riftGate.count().then((n) => n === 0))

await page.getByRole('button', { name: /^Goblins/ }).first().click()
await page.getByRole('button', { name: /Sit down with Goblins/ }).click()

console.log('\nAt the table')
check('the table opens for that deck', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), ENGINE_START_MS))
const prompt = page.locator('.prompt')
check('the engine deals and stops at the first thing worth stopping for', await until(() => prompt.count().then((n) => n === 1), ENGINE_START_MS))
const hand = () => page.locator('.tabletop__handcard .bcard').count()
check('seven cards in hand', (await hand()) === 7, String(await hand()))
check('the seat opposite is the engine', /The engine/.test(await page.locator('.game__them').textContent()))
// The owner's "mulligans on" (HANDOFF.md §3 item 3; M4): the first stop is the
// hand to keep. Kept here, and the engine keeps its own from this seed, so the
// game from here on is the very one this spec was written against — the live
// test holds a seeded game to that. "A mulligan", below, takes one.
const openingHand = page.getByRole('group', { name: 'Your opening hand' })
check('and the first thing is the hand to keep, the rule it is dealt by named', await until(() => openingHand.count().then((n) => n === 1))
  && /London mulligan \(103\.5\)/.test(await openingHand.textContent() ?? ''), await prompt.textContent())
check('the room dealt the game with the hands to keep', await fetch(`${RELAY}/rooms/${code}`).then((r) => r.json()).then((r) => r.mulligans === true))
await openingHand.getByRole('button', { name: /^Keep this hand/ }).click()
check('keeping it begins the game', await until(() => prompt.getAttribute('aria-label').then((l) => l !== 'Your opening hand').catch(() => false), 20000))
const dealtAt = await fetch(`${RELAY}/rooms/${code}`).then((r) => r.json())
check('the engine took the level chosen in the lobby, as the profile it names', dealtAt.played === 'easy' && dealtAt.profile === 'v0', JSON.stringify({ played: dealtAt.played, profile: dealtAt.profile }))
check('the log names it once, at the start', await page.locator('.gamelog').textContent().then((t) => (t ?? '').split('The engine is playing at the easy level.').length === 2), await page.locator('.gamelog').textContent())
check('and the seat list beside the engine', /· Easy/.test(await page.locator('.game__seats').textContent() ?? ''))
check('the plate says whose stop it is', /Your stop|Your attack|The engine asks/.test(await prompt.getAttribute('aria-label')))
const land = page.locator('.tabletop__handcard').filter({ has: page.getByLabel(/^Mountain/) }).first()
check('a land is in hand to play', (await land.count()) === 1)

// A tap on a card in hand plays it through the engine's offer for it.
const tapHand = async (locator) => {
  const card = locator.locator('.bcard').first()
  await card.scrollIntoViewIfNeeded()
  const point = await card.evaluate((el) => {
    const slot = el.closest('.tabletop__handcard')
    const box = slot.getBoundingClientRect()
    const y = box.top + box.height / 2
    let from = null
    for (let x = box.left + 1; x < box.right; x += 1) {
      const hit = document.elementFromPoint(x, y)
      if (hit && slot.contains(hit)) { if (from === null) from = x } else if (from !== null) return { x: (from + x) / 2, y }
    }
    return from === null ? null : { x: (from + box.right) / 2, y }
  })
  if (!point) throw new Error('that hand card is fully covered')
  await page.mouse.click(point.x, point.y)
}

/**
 * Which cards glow, and how, read off the screen: each glowing card's id (from
 * the slot it sits in, in hand or on the battlefield) and its spoken label,
 * and the plates that glow as targets.
 */
const glowing = () => page.evaluate(() => {
  const read = (selector) => [...document.querySelectorAll(selector)].map((el) => ({
    id: el.closest('[data-id]')?.dataset.id ?? null,
    zone: el.closest('.tabletop__handcard') ? 'hand' : el.closest('.field__slot') ? 'battlefield' : 'elsewhere',
    label: el.getAttribute('aria-label') ?? '',
  }))
  return {
    playable: read('.bcard--playable'),
    target: read('.bcard--target:not(.bcard--chosen)'),
    chosen: read('.bcard--chosen'),
    plates: [...document.querySelectorAll('.plate--target')].map((el) => ({ you: el.classList.contains('plate--you'), label: el.getAttribute('aria-label') ?? '' })),
  }
})
const sameIds = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
/** The offers a tap plays at once at this table: meaningful, affordable, not mana, and needing nothing aimed. */
const offeredPlays = (status) => (status?.actions ?? []).filter((a) => typeof a.card === 'string' && a.affordable && a.meaningful && !a.mana && !a.requiresTargets)
/**
 * The offers that glow: every meaningful, affordable play that is not mana.
 * Since M4 a spell that needs a target is one of them, at a seat whose engine
 * takes a target with the play (this spec's, which is the built engine).
 */
const litPlays = (status) => (status?.actions ?? []).filter((a) => typeof a.card === 'string' && a.affordable && a.meaningful && !a.mana)

/**
 * A glow's motion, read off a real glowing card in each state that matters:
 * the app's own reduced-motion setting (on in this spec's saved preferences,
 * so on the table's root), then without it, with the system's setting off and
 * then on. Put back as it was after.
 */
const glowMotion = (selector) => page.evaluate(async (sel) => {
  const el = document.querySelector(sel)
  const root = document.querySelector('.game')
  if (!el || !root) return null
  const name = () => getComputedStyle(el).animationName
  const app = name()
  root.classList.remove('game--still')
  const without = name()
  root.classList.add('game--still')
  return { app, without }
}, selector)
const glowMotionEverywhere = async (selector) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const free = await glowMotion(selector)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const system = await glowMotion(selector)
  await page.emulateMedia({ reducedMotion: null })
  return { app: free?.app, moving: free?.without, system: system?.without }
}

/**
 * Every card in hand looked at in turn, with Z held so the preview shows at
 * once, and what the preview kept clear of each time: the prompt, its Pass,
 * the rail and the pointer itself. Read after the card has lifted out of the
 * fan, which the preview measures again when it settles.
 */
const previewEveryHandCard = async () => {
  const cards = page.locator('.tabletop__handcard')
  const seen = []
  // The table is taller than the window here, and a point off the screen hits
  // nothing: the hand is brought into view, and with it the prompt above it.
  await page.locator('.game__hand').scrollIntoViewIfNeeded()
  await page.keyboard.down('z')
  for (let i = 0; i < await cards.count(); i++) {
    // Off the hand first, so the card just read has settled back into the fan
    // and is not covering the one after it.
    await page.mouse.move(5, 5)
    await page.waitForTimeout(200)
    const p = await cards.nth(i).locator('.bcard').first().evaluate((el) => {
      const slot = el.closest('.tabletop__handcard')
      const box = slot.getBoundingClientRect()
      const y = box.top + box.height / 2
      let from = null
      for (let x = box.left + 1; x < box.right; x += 1) {
        const hit = document.elementFromPoint(x, y)
        if (hit && slot.contains(hit)) { if (from === null) from = x } else if (from !== null) return { x: (from + x) / 2, y }
      }
      return from === null ? null : { x: (from + box.right) / 2, y }
    })
    if (!p) continue
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(250)
    seen.push(await page.evaluate((pointer) => {
      const box = (el) => { const b = el?.getBoundingClientRect(); return b ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null }
      const peek = document.querySelector('.facepeek')
      return {
        pointer,
        peek: box(peek),
        side: peek?.dataset.side ?? null,
        prompt: box(document.querySelector('.prompt')),
        pass: box([...document.querySelectorAll('.prompt button, .rail button')].find((b) => /Pass/.test(b.textContent ?? ''))),
        rail: box(document.querySelector('.rail')),
      }
    }, p))
  }
  await page.keyboard.up('z')
  await page.mouse.move(5, 5)
  return seen
}
/** The next stop that is this seat's, once the room has published one after `before`. */
const nextStop = (before) => until(() => {
  const s = wire.status
  return Boolean(s) && s.stop !== before && (s.over || (s.actor === wire.me && s.waiting !== 'engine'))
}, 20000)
const overlaps = (a, b) => Boolean(a && b) && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const under = (box, p) => Boolean(box) && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom
console.log('\nThe cards the engine will take glow')
// The status arrives before the view it belongs to, so the screen is read
// until it has caught up with the wire, then held to it exactly.
const handIds = () => page.locator('.tabletop__handcard').evaluateAll((els) => els.map((el) => el.dataset.id))
const firstPlays = () => litPlays(wire.status).map((a) => a.card)
check('exactly the cards the engine offers a play for glow, and no others',
  await until(async () => { const g = await glowing(); return firstPlays().length > 0 && sameIds(g.playable.map((x) => x.id), firstPlays()) && !g.target.length && !g.chosen.length }),
  JSON.stringify({ glowing: await glowing(), offered: firstPlays() }))
check('every one of them a card in hand', await Promise.all([glowing(), handIds()]).then(([g, hand]) => g.playable.every((x) => x.zone === 'hand' && hand.includes(x.id))))
check('and each says so in words, not only in light', (await glowing()).playable.every((x) => /, playable now$/.test(x.label)), JSON.stringify((await glowing()).playable.map((x) => x.label)))
check('the prompt says what the glow means', /you can play glow/.test(await prompt.textContent() ?? ''), await prompt.textContent())
await page.locator('.game__hand').scrollIntoViewIfNeeded()
// A picture of the glow round a card still loading is a picture of black
// rectangles; the faces are given a moment, and the pictures are taken either way.
await page.waitForFunction(() => [...document.querySelectorAll('.tabletop__handcard img')].every((img) => img.complete), null, { timeout: 5000 }).catch(() => {})
await page.screenshot({ path: SHOT('playable') })
const glowColour = await page.evaluate(() => {
  const card = document.querySelector('.bcard--playable')
  const probe = document.createElement('span')
  probe.style.color = 'var(--accent)'
  card.parentElement.appendChild(probe)
  const accent = getComputedStyle(probe).color
  probe.remove()
  return { accent, shadow: getComputedStyle(card).boxShadow }
})
check('the glow is the accent', glowColour.shadow.startsWith(glowColour.accent), JSON.stringify(glowColour))
// The season's shell put on by hand rather than waited for, so this holds
// whatever the date: Reality Fracture's theme makes the accent its cyan
// (tokens.css, --rf-cyan), and the glow goes with it.
const seasonGlow = await page.evaluate(() => {
  const root = document.documentElement
  const was = root.getAttribute('data-theme-set')
  root.setAttribute('data-theme-set', 'fra')
  const shadow = getComputedStyle(document.querySelector('.bcard--playable')).boxShadow
  return { shadow, was }
})
await page.screenshot({ path: SHOT('playable-season') })
await page.evaluate((was) => { const root = document.documentElement; if (was === null) root.removeAttribute('data-theme-set'); else root.setAttribute('data-theme-set', was) }, seasonGlow.was)
check('which the season turns cyan', seasonGlow.shadow.startsWith('rgb(119, 228, 239)'), seasonGlow.shadow)
const playableMotion = await glowMotionEverywhere('.bcard--playable')
check('it breathes, and stands still under the app\'s reduced motion and the system\'s',
  playableMotion.moving === 'bcard-playable' && playableMotion.app === 'none' && playableMotion.system === 'none', JSON.stringify(playableMotion))
check('the table has no accessibility violations with the cards glowing', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
check('the credit line names Scryfall, and at the engine\'s table the engine and its licence',
  /Card data and imagery from Scryfall\./.test(await page.locator('.game__credit').textContent() ?? '')
  && /Rules-enforced play is powered by Argentum, an independent open-source rules engine, used under the MIT licence\./.test(await page.locator('.game__credit').textContent() ?? ''),
  await page.locator('.game__credit').textContent())

console.log('\nThe preview never covers Pass')
// Every card in hand, with the prompt and its Pass showing just above the
// hand: the case the brief was written for (HANDOFF.md, M1b).
const previews = await previewEveryHandCard()
check('a preview shows for every card in hand', previews.length === 7 && previews.every((p) => p.peek), JSON.stringify(previews.map((p) => p.peek)))
check('and none covers the prompt, or its Pass', previews.every((p) => p.prompt && !overlaps(p.peek, p.prompt) && !overlaps(p.peek, p.pass)),
  JSON.stringify(previews.filter((p) => overlaps(p.peek, p.prompt)).map(({ peek, prompt: at }) => ({ peek, prompt: at }))))
check('nor the rail beside the hand, with its own', previews.every((p) => !overlaps(p.peek, p.rail)), JSON.stringify(previews.filter((p) => overlaps(p.peek, p.rail))))
check('nor sits under the pointer', previews.every((p) => !under(p.peek, p.pointer)))
console.log(`  (placed ${Object.entries(previews.reduce((n, p) => ({ ...n, [p.side]: (n[p.side] ?? 0) + 1 }), {})).map(([side, n]) => `${side} ${n}`).join(', ')} of the hand's seven)`)
{
  // The picture of it: the middle card of the hand, being read, with the prompt beside it.
  await page.locator('.game__hand').scrollIntoViewIfNeeded()
  const middle = page.locator('.tabletop__handcard').nth(3)
  const box = await middle.boundingBox()
  await page.keyboard.down('z')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  await page.screenshot({ path: SHOT('peek-prompt') })
  await page.keyboard.up('z')
  await page.mouse.move(5, 5)
}

await tapHand(land)
check('tapping a land plays it: the engine put it on the battlefield', await until(() => page.locator('.game__field .field .bcard--tile').count().then((n) => n === 1)))
check('and the hand is one lighter', await until(() => hand().then((n) => n === 6)))
check('the tile is in the lands row', await until(() => page.locator('.game__field .field .bcard--tile').first().textContent().then((t) => /mountain/i.test(t ?? ''))))

// Pass to the next stop, and on until the turn is over; the engine takes
// its turn, and the log says what was passed for us on the way.
const passBtn = page.getByRole('button', { name: '→ Pass' })
const logText = () => page.locator('.gamelog').textContent().then((t) => t ?? '')
check('every printing the deck names is one the engine has, so the log does not say otherwise', !/does not have your printing/.test(await logText()))

// The engine's turn arrives a play at a time now (HANDOFF.md, M2), each one
// left standing for the room's pace. That is whole seconds of screen, but a
// poll can still fall between two of them, so the page itself watches: every
// time anything changes, it writes down whether the opponent's plate says the
// engine is thinking, and what else was on screen while it did.
await page.addScriptTag({ path: AXE })
const errorsBeforeTheTurn = consoleErrors.length
await page.evaluate(() => {
  window.__thinking = []
  window.__thinkingAxe = null
  const look = () => {
    const pill = document.querySelector('.game__them .plate__status')
    if (!pill || !/thinking/i.test(pill.textContent ?? '')) return
    const style = getComputedStyle(pill)
    const plate = pill.closest('.plate')
    window.__thinking.push({
      text: pill.textContent,
      label: plate?.getAttribute('aria-label') ?? '',
      classes: pill.className,
      prompt: Boolean(document.querySelector('.prompt')),
      colour: `${style.color} on ${style.backgroundColor}`,
      // The rest of the table at that moment, which is what "watching" means:
      // whose turn the plate says it is, what stands on their own side of the
      // table, and how much the log has said. The engine's land has to appear
      // on their side while they still hold the turn, and the log has to fill
      // in as it goes — not both at the end, in one jump (HANDOFF.md, M2).
      theirTurn: Boolean(plate?.classList.contains('plate--active')),
      theirTiles: document.querySelectorAll('.game__theirfield .bcard--tile').length,
      logLines: document.querySelectorAll('.gamelog__item').length,
      // Which turn the log is showing at the top of itself. "A play at a
      // time" is a claim about one turn of the engine's, and a count taken
      // over the whole game is satisfied by one play in each of a dozen
      // turns — which is the jump M2 exists to end. So the moments are
      // grouped by the turn they happened in, and the claim is made of one.
      turnHead: document.querySelector('.gamelog__turns > li .gamelog__turn')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
      at: performance.now(),
    })
    if (window.__thinkingAxe === null && window.axe) {
      window.__thinkingAxe = 'running'
      // The whole page, the way a11y.spec.mjs sweeps every other state: the
      // thinking table is a state of its own — a plate that says something no
      // other state says, and no prompt panel at all — and a sweep of the seat
      // opposite alone would not notice what its absence left behind.
      window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
        .then((r) => { window.__thinkingAxe = r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join('; ')}`) })
        .catch((e) => { window.__thinkingAxe = [`axe could not run: ${e.message}`] })
    }
  }
  new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true })
  look()
})

console.log('\nSpace passes')
{
  const stopBefore = wire.status?.stop
  // Not in a field, where Space is a letter: the search over a pile is one.
  const graveyard = page.getByRole('button', { name: /^Graveyard, \d+ cards?$/ })
  await graveyard.click()
  const find = page.locator('#find-graveyard')
  await find.focus()
  await page.keyboard.press('Space')
  await sleep(600)
  check('in a field Space is a letter, and nothing is passed',
    wire.status?.stop === stopBefore && (await find.inputValue()) === ' ' && (await prompt.count()) === 1,
    `stop ${stopBefore} then ${wire.status?.stop}, the field holds ${JSON.stringify(await find.inputValue())}`)
  await graveyard.click()
  await page.evaluate(() => document.activeElement?.blur())
  check('the prompt says so, once, on its Pass', /or press Space/.test(await prompt.getByRole('button', { name: /Pass/ }).textContent() ?? ''))
  check('and both buttons that pass say which key does it', await page.locator('[aria-keyshortcuts="Space"]').count() === 2)
  await page.keyboard.press('Space')
  check('anywhere else Space passes: the engine takes the pass and moves on', await until(() => wire.status?.stop !== stopBefore, 8000),
    `stop ${stopBefore} then ${wire.status?.stop}`)
  // Should it not have, the pass is made by hand so the game below still happens.
  if (wire.status?.stop === stopBefore) await passBtn.click()
}
check('after a pass the engine comes back to the next stop', await until(() => prompt.count().then((n) => n === 1), 20000))
check('the log says how many windows the engine passed for you', await until(() => logText().then((t) => /passed \d+ priority window/.test(t)), 20000))
// The status arrives before the view it belongs to, so said as it arrived a
// note would sit above the lines of the view it belongs to — above the deal
// itself for the first one, and above the land for the one after the pass.
//
// Read inside one turn's block rather than across the log, and against the
// lines above the note as well as below it. The log is newest turn first, so
// a search of the whole of it forward from the land is satisfied by any note
// in any older turn, which renders below that point whatever the order within
// a turn; and a note said too early still lands after the land, because the
// land was said at the stop before. What only the fix makes true is that the
// first note falls under the deal's own lines instead of over them.
const landBlock = () => page.evaluate(() => {
  const li = [...document.querySelectorAll('.gamelog__turns > li')]
    .find((el) => /Your Mountain entered the battlefield/.test(el.innerText))
  return li ? { head: li.querySelector('.gamelog__turn')?.innerText.replace(/\s+/g, ' ').trim() ?? '', text: li.innerText } : null
})
const noteIsUnderItsView = (block) => {
  if (!block) return false
  const dealt = block.text.indexOf('You shuffled your library')
  const land = block.text.indexOf('Your Mountain entered the battlefield')
  const first = block.text.search(/passed \d+ priority window/)
  // The lines of the first view, then its note; and a note after the land too.
  return dealt >= 0 && land >= 0 && first > dealt && block.text.slice(land).search(/passed \d+ priority window/) >= 0
}
check('and says it under the view it belongs to, not over it',
  await until(async () => noteIsUnderItsView(await landBlock()), 20000),
  JSON.stringify(await landBlock()).slice(0, 600))
for (let i = 0; i < 6 && !/Turn [23]/i.test(await logText()); i++) {
  if (await passBtn.isEnabled()) { await passBtn.click(); await until(() => prompt.count().then((n) => n === 1), 20000); await sleep(150) }
  else if ((await prompt.getAttribute('aria-label')) === 'Your attack') await page.getByRole('button', { name: 'No attack' }).click()
  else break
}
check('passing through the turn hands it to the engine, which plays and hands it back', await until(() => logText().then((t) => /Your turn\s*·\s*Turn 3/i.test(t)), 20000), (await logText()).slice(0, 200))
// Until M1's run in a browser the engine's lines reached the table without
// their words, and its whole turn went by unsaid.
check('the land you played is said', /Your Mountain entered the battlefield/.test(await logText()), (await logText()).slice(0, 400))
check('the engine\'s turn has a place of its own in the log', /The engine\s*·\s*Turn 2/i.test(await logText()), (await logText()).slice(0, 400))
check('its draw is said in its draw step, without the card', /The engine's draw\s*Opponent drew a card/i.test(await logText()), (await logText()).slice(0, 400))
check('and nothing in its hand or library is named', !/Opponent's [^.]*? went to (hand|library)/.test(await logText()))
check('the engine\'s own turn marks become headers, not lines', !/--- Turn/.test(await logText()))

console.log('\nAn attack')
// Play what can be played and pass until the engine asks who attacks, then
// tap a creature and press Attack. A goblin has haste, so this comes soon.
let attacked = false
for (let i = 0; i < 24 && !attacked; i++) {
  // The engine's own turn takes it a moment: wait for the next stop rather
  // than spinning through the loop while there is nothing on screen to do.
  await until(() => prompt.count().then((n) => n === 1), 20000)
  const label = (await prompt.count()) ? await prompt.getAttribute('aria-label') : null
  if (label === 'Game over') break
  if (label === 'Your attack') {
    const attacker = page.locator('.game__field .field .bcard--tile').filter({ hasText: /goblin/i }).first()
    if (!(await attacker.count())) { await page.getByRole('button', { name: 'No attack' }).click(); continue }
    // What may attack is the engine's list, and exactly that glows.
    const valid = (wire.status?.actions ?? []).find((a) => a.type === 'DeclareAttackers')?.validAttackers ?? []
    check('the creatures that may attack glow, and nothing else does',
      await until(async () => { const g = await glowing(); return valid.length > 0 && sameIds(g.target.map((x) => x.id), valid) && !g.playable.length && !g.chosen.length }),
      JSON.stringify({ glowing: await glowing(), valid }))
    check('each saying it can attack', (await glowing()).target.every((x) => /, can attack$/.test(x.label)), JSON.stringify((await glowing()).target))
    const targetMotion = await glowMotionEverywhere('.bcard--target')
    check('that glow breathes too, and stands still under either reduced-motion setting',
      targetMotion.moving === 'bcard-target' && targetMotion.app === 'none' && targetMotion.system === 'none', JSON.stringify(targetMotion))
    const picked = await attacker.evaluate((el) => el.closest('[data-id]')?.dataset.id ?? null)
    await attacker.click()
    check('tapping a creature draws its attack as an arrow', await until(() => page.locator('.game__field .field__arrow--attack').count().then((n) => n === 1)))
    check('and it stays lit, more strongly, saying it is attacking',
      await until(async () => { const g = await glowing(); return g.chosen.length === 1 && g.chosen[0].id === picked && /, attacking$/.test(g.chosen[0].label) }),
      JSON.stringify(await glowing()))
    check('standing still even where motion is free, since a choice made is not asking for anything',
      await glowMotionEverywhere('.bcard--chosen').then((m) => m.moving === 'none'))
    check('while the rest still glow as able to', sameIds((await glowing()).target.map((x) => x.id), valid.filter((id) => id !== picked)))
    // Where the keyboard is, on a glowing card (found in M3's review): the
    // plain focus ring was the accent 2–4 px out, drawn over the glow in the
    // glow's own colour, and all but vanished. The chosen attacker is reached
    // with the keyboard and its ring read, against the accent and against the
    // same card unfocused.
    const ringOf = () => page.evaluate((id) => {
      const el = document.querySelector(`.game__field .field__slot[data-id="${id}"] .bcard`)
      if (!el) return null
      const style = getComputedStyle(el)
      const after = getComputedStyle(el, '::after')
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent)'
      el.parentElement.appendChild(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      return {
        focused: el === document.activeElement && el.matches(':focus-visible'),
        outline: `${style.outlineStyle} ${style.outlineColor}`, offset: style.outlineOffset, accent,
        outer: after.content !== 'none' ? `${after.borderTopStyle} ${after.borderTopColor}` : null,
      }
    }, picked)
    const unfocused = await ringOf()
    await attacker.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const focusedRing = await ringOf()
    await page.screenshot({ path: SHOT('attack-focus') })
    check('a chosen attacker the keyboard is on wears a ring outside its glow, in two tones and not the accent',
      focusedRing?.focused && focusedRing.offset === '6px' && focusedRing.outline !== unfocused?.outline
      && !focusedRing.outline.includes(focusedRing.accent) && /^solid rgb\(27, 20, 8\)/.test(focusedRing.outline)
      && /^solid rgb\(253, 246, 227\)/.test(focusedRing.outer ?? '') && !unfocused?.outer,
      JSON.stringify({ unfocused, focused: focusedRing }))
    await page.evaluate(() => document.activeElement?.blur())
    // Changing the emulated motion setting above starts the log's own fade-in
    // over again, and a picture taken inside it shows the log half faded.
    await sleep(300)
    await page.screenshot({ path: SHOT('attack') })
    await page.getByRole('button', { name: /Attack with 1/ }).click()
    // The engine may block, so damage is not promised; the attack being
    // declared is, and the log says so in the engine's words.
    check('the attack is declared and the game moves past it', await until(() => Promise.all([prompt.getAttribute('aria-label').catch(() => null), logText()]).then(([l, t]) => l !== 'Your attack' && /attack/i.test(t)), 20000), (await logText()).slice(0, 200))
    attacked = true
    break
  }
  if (label === 'The engine asks') { await page.getByRole('button', { name: /Let the engine choose|Yes/ }).first().click(); continue }
  const playable = page.locator('.tabletop__handcard').filter({ has: page.getByLabel(/^(Mountain|Raging Goblin|Goblin Bully|Hulking Goblin)/) })
  if (await playable.count()) {
    const before = await hand()
    await tapHand(playable.first())
    // Either it played (hand smaller) or the engine refused it (a banner): move on either way.
    await until(() => Promise.all([hand(), page.locator('.banner--info').count()]).then(([n, b]) => n < before || b > 0), 4000)
    if ((await hand()) < before) continue
  }
  if (await passBtn.isEnabled()) { await passBtn.click(); await until(() => prompt.count().then((n) => n === 1), 20000); await sleep(150) }
}
check('an attack was declared within a few turns', attacked)

// A picture of the milestone itself: the table while the engine is playing.
// Never a check — the state lasts the room's pace and a screenshot takes about
// as long, so catching one is luck — but a picture when one can be caught.
let thinkingShot = false
const thinkingPill = page.locator('.game__them .plate__status--thinking')
for (let i = 0; i < 3 && !thinkingShot; i++) {
  // The attack above may have left the engine mid-turn, and there is nothing
  // to press while it is: wait for the stop to come back first.
  await until(() => prompt.count().then((n) => n === 1), 20000)
  if ((await prompt.getAttribute('aria-label').catch(() => null)) === 'Game over') break
  if (await passBtn.isEnabled().catch(() => false)) await passBtn.click()
  else if (await page.getByRole('button', { name: 'No attack' }).isEnabled().catch(() => false)) await page.getByRole('button', { name: 'No attack' }).click()
  else break
  if (await thinkingPill.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) {
    // The table scrolls inside itself, so a picture taken where play left it
    // starts below the seat opposite — and the plate that says the engine is
    // thinking is the thing being photographed. Bring it into view first.
    await page.evaluate(() => document.querySelector('.game__them')?.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await page.screenshot({ path: SHOT('thinking') })
    thinkingShot = true
  }
}

console.log('\nWatching the engine play')
// A paced turn has to end somewhere, and where it ends is back at the player:
// the plate stops saying the engine is thinking and the prompt panel returns.
// Waited for before anything is read, so that the newest moment recorded is a
// finished one — read mid-turn, it could be a status whose view is still in
// flight, and the checks below would be racing the wire rather than reading it.
const handedBack = await until(async () =>
  (await page.locator('.game__them .plate__status--thinking').count()) === 0 && (await prompt.count()) === 1, 20000)
const thinking = await page.evaluate(() => window.__thinking ?? [])
check('the engine\'s turn is watched a play at a time, and the plate says so in words', thinking.length > 0)
check('in the words M2 asked for', thinking.every((t) => t.text === 'The engine is thinking…'), thinking[0]?.text)
check('said in the plate\'s own label, so it is read and not only seen', thinking.every((t) => /The engine is thinking…/.test(t.label)), thinking[0]?.label)
check('and marked, so nothing rests on the colour alone', thinking.every((t) => /plate__status--thinking/.test(t.classes)), thinking[0]?.classes)
check('the prompt panel says nothing while it thinks, as Moxgate\'s does', thinking.every((t) => !t.prompt), JSON.stringify(thinking.find((t) => t.prompt) ?? {}))

// What was on the table at each of those moments. A stop of the engine's is
// taken only for a play of its own (engine/README.md, pacing), so the stops
// themselves fall inside its own turn — which is what makes "the land appears
// while the turn is still its own" mean during their turn, not between turns.
const watched = thinking.filter((t) => t.theirTurn)
check('the engine is watched inside its own turn, with the plate saying whose turn it is', watched.length > 0,
  `${watched.length} of ${thinking.length} moments were inside its turn`)
// A stop is two messages and the status comes first (scripts/relay-engine.mjs),
// so at the first render of a stop the plate already says the engine is
// thinking while the board still shows the turn as yours. It is the wire's own
// latency — the relay asking the engine for the view — and it closes when that
// view lands; measured here rather than assumed, because a view that stopped
// following would leave the table saying the turn was still yours through the
// whole of the engine's, which is the fault M2 exists to end.
//
// Measured to the next moment where the board has caught up, not to the next
// moment of any kind: a status can render twice before its view arrives, and
// that is the same one message of lag, not two faults. A board that never
// catches up counts as forever, which the bound below is what fails on.
const behind = thinking
  .map((t, i) => ({ t, caught: thinking.slice(i + 1).find((n) => n.theirTurn) }))
  .filter(({ t }) => !t.theirTurn)
const seam = Math.max(0, ...behind.map(({ t, caught }) => (caught ? caught.at - t.at : Infinity)))
// A second, against a 120 ms pace: this is not a measure of smoothness but a
// guard against a view that never arrives, which would be seconds or never.
check('a board a message behind the plate catches up, in well under a second, so no turn is watched on a stale one',
  seam < 1000, `${behind.length} of ${thinking.length} moments were behind; the worst waited ${Math.round(seam)} ms`)
console.log(`  (${thinking.length} moments over the engine's turns at a ${PACE} ms pace; the board at most ${Math.round(seam)} ms behind the plate)`)
const span = (of) => watched.map(of).reduce((r, n) => ({ low: Math.min(r.low, n), high: Math.max(r.high, n) }), { low: Infinity, high: -Infinity })
const tiles = span((t) => t.theirTiles)
check('the engine\'s land appears on its own side while the turn is still its own', tiles.high > 0 && tiles.high > tiles.low,
  `${tiles.low} to ${tiles.high} tiles on their side while thinking`)
const lines = span((t) => t.logLines)
check('and the log fills in as it goes, not all at the end', lines.high > lines.low,
  `${lines.low} to ${lines.high} log lines while thinking`)

// The same claim, made of one turn rather than of the game: counted across the
// game, "many thinking moments" is satisfied by one play in each of a dozen
// turns, which is the jump M2 exists to end, and a drive() narrowed back to one
// stop a turn would leave every check above green.
//
// Grouped by the turn the log was showing, one growth of the log *inside* a
// turn of the engine's is already two views inside it, and so two stops. The
// turn's first stop does not count towards it: its status arrives before its
// view (the seam measured above), so that moment is recorded while the log
// still shows the player's turn and groups under that. With one stop a turn
// the only moments inside the engine's turn are renders of the one view it
// sent, all reading the same log, and the count is zero.
const byTurn = new Map()
for (const t of thinking) byTurn.set(t.turnHead, [...(byTurn.get(t.turnHead) ?? []), t])
const grew = (moments, of) => moments.filter((m, i) => i > 0 && of(m) > of(moments[i - 1])).length
// The first stop of an engine turn is recorded while the log still shows the
// player's (the status arrives before its view, the seam measured above), so
// that moment groups under the player's turn and is not counted here.
const engineTurns = [...byTurn.entries()].filter(([head]) => head && !/Your turn/.test(head))
const plays = (ms) => grew(ms, (m) => m.logLines)
const mostPlays = Math.max(0, ...engineTurns.map(([, ms]) => plays(ms)))
check('one turn of the engine\'s arrived as two stops or more, not in one jump', mostPlays >= 1,
  engineTurns.map(([head, ms]) => `${head}: the log grew ${plays(ms)} times over ${ms.length} moments`).join(' | ') || 'no moment fell inside a turn of the engine\'s')
console.log(`  (${engineTurns.map(([head, ms]) => `${head.replace(' · ', ' ')}: ${plays(ms)} over ${ms.length} moments`).join(', ') || 'no moment fell inside a turn of the engine\'s'})`)
check('the turn ends back at your stop, with nobody thinking', handedBack)
const thinkingAxe = await page.evaluate(() => window.__thinkingAxe)
check('and the table has no accessibility violations while it thinks', Array.isArray(thinkingAxe) && thinkingAxe.length === 0, JSON.stringify(thinkingAxe))

// Nothing animates without a reduced-motion path. The pill's border breathes
// on a 1.8 s loop, and for somebody who has asked for stillness it must not.
// Read off the real plate opposite with the modifier the app puts on it, at
// the player's own stop, rather than caught mid-turn: the pill stands for the
// room's pace, and two reads either side of a media change do not fit inside
// 120 ms often enough for a check to rest on it. The plate matters as much as
// the pill — it is a `.plate--them`, the only place the pill is ever drawn,
// and the one case the reduced-motion rule used to be outweighed in.
const breath = await (async () => {
  const wear = (on) => page.evaluate((add) => {
    const pill = document.querySelector('.game__them .plate__status')
    pill?.classList[add ? 'add' : 'remove']('plate__status--thinking')
    return Boolean(pill)
  }, on)
  const reads = async () => page.evaluate(() => {
    const pill = document.querySelector('.game__them .plate__status--thinking')
    return pill ? getComputedStyle(pill).animationName : null
  })
  const found = await wear(true)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const moving = await reads()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const still = await reads()
  await page.emulateMedia({ reducedMotion: null })
  await wear(false)
  return { found, moving, still }
})()
check('the thinking pill breathes, and stops for somebody who asked for stillness',
  breath.found && breath.moving === 'plate-thinking' && breath.still === 'none', JSON.stringify(breath))
check('no console error through a paced turn', consoleErrors.length === errorsBeforeTheTurn,
  consoleErrors.slice(errorsBeforeTheTurn).join('\n'))

console.log('\nA spell cast at a target')
// Until M4 this table could not send a target with a play, so Volcanic Hammer
// was held back: no glow, a tap that said why, a button that would not press
// (M1b). An engine at protocol 5 takes the target with the cast, and the room
// says so after the deal (`choices`), so the Hammer is a play like any other:
// it glows, a tap begins aiming it, the legal targets glow, and "Aim at the
// engine" casts it — and the engine's life falls by three when it resolves.
// Found by playing whatever else is offered and passing on, until a stop of
// the player's offers the Hammer from hand.
check('the room said this seat may choose targets, and which decisions it will be asked',
  Array.isArray(wire.choices?.act) && wire.choices.act.includes('targets') && Array.isArray(wire.choices?.decisions) && wire.choices.decisions.includes('SelectCards'),
  JSON.stringify(wire.choices))
let aimedAt = null
for (let i = 0; i < 40 && !aimedAt; i++) {
  await until(() => prompt.count().then((n) => n === 1), 20000)
  const s = wire.status
  if (!s || s.over) break
  const offer = (s.actions ?? []).find((a) => a.description === 'Cast Volcanic Hammer' && a.affordable && typeof a.card === 'string')
  if (s.actor === wire.me && s.waiting === 'action' && offer && await page.locator(`.tabletop__handcard[data-id="${offer.card}"]`).count()) { aimedAt = { offer, status: s }; break }
  const label = await prompt.getAttribute('aria-label').catch(() => null)
  const others = offeredPlays(s).filter((a) => !/^Declare/.test(a.type))
  const other = others.length ? page.locator(`.tabletop__handcard[data-id="${others[0].card}"]`) : null
  if (label === 'Your attack') await page.getByRole('button', { name: 'No attack' }).click()
  else if (label === 'Their attack') await page.getByRole('button', { name: /No blocks/ }).click()
  else if (label === 'The engine asks') await page.getByRole('button', { name: /Let the engine choose|Yes/ }).first().click()
  else if (other && await other.count()) await tapHand(other)
  else if (await passBtn.isEnabled().catch(() => false)) await passBtn.click()
  else break
  await nextStop(s.stop)
}
check('a stop of yours comes with Volcanic Hammer affordable in hand', Boolean(aimedAt), JSON.stringify(wire.status).slice(0, 300))
if (aimedAt) {
  const card = page.locator(`.tabletop__handcard[data-id="${aimedAt.offer.card}"]`)
  check('it glows, since a tap can now cast it', await until(() => card.locator('.bcard--playable').count().then((n) => n === 1)))
  const stopBefore = wire.status?.stop
  const inHand = await hand()
  await tapHand(card)
  check('a tap begins aiming it: the prompt names it and says what the glow means',
    await until(() => prompt.getAttribute('aria-label').then((l) => l === 'Choosing for Volcanic Hammer'))
    && /Tap what Volcanic Hammer is aimed at: the legal targets glow/.test(await prompt.textContent() ?? ''),
    await prompt.textContent())
  const legal = aimedAt.offer.targetRequirements?.[0]?.legal ?? []
  const seatIds = wire.seats.map((s) => s.engineSeat).filter(Boolean)
  const legalCards = legal.filter((id) => !seatIds.includes(id))
  check('exactly the legal targets glow, and the seats among them by their plates',
    await until(async () => {
      const g = await glowing()
      return sameIds(g.target.map((x) => x.id), legalCards) && !g.playable.length && g.plates.length === legal.filter((id) => seatIds.includes(id)).length
    }),
    JSON.stringify({ glowing: await glowing(), legal }))
  check('each saying so in words', (await glowing()).target.every((x) => /, a legal target$/.test(x.label)))
  check('and each seat offered by name, since a plate is not a card to tap',
    await page.getByRole('button', { name: 'Aim at the engine' }).count() === 1)
  check('with a way to let the engine choose and a way to let the play go', await prompt.getByRole('button', { name: /Let the engine choose/ }).count() === 1
    && await prompt.getByRole('button', { name: 'Never mind' }).count() === 1)
  check('nothing has gone to the engine yet: the same stop, the card still in hand', wire.status?.stop === stopBefore && (await hand()) === inHand)
  // A tap on something the Hammer cannot be aimed at says why, rather than
  // doing nothing or sending it to be refused (Table.jsx, `answerTap`): a
  // Mountain, which is no legal target. The one in hand, since at this width
  // the prompt sits over the battlefield's row of lands.
  const mountain = page.locator('.tabletop__handcard').filter({ has: page.getByLabel(/^Mountain/) }).first()
  check('a Mountain is in hand, and not among the targets', (await mountain.count()) === 1 && !legal.includes(await mountain.getAttribute('data-id')))
  await tapHand(mountain)
  check('a tap on it says it is no legal target, and the aim goes on at the same stop',
    await until(() => page.locator('.banner--info').textContent().then((t) => t === 'Mountain is not a legal target for Volcanic Hammer.').catch(() => false))
    && wire.status?.stop === stopBefore && await prompt.getAttribute('aria-label') === 'Choosing for Volcanic Hammer',
    await page.locator('.banner--info').textContent().catch(() => 'no banner'))
  // Space passes at a stop, but not while a play is being aimed: it would throw the aim away.
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Space')
  await sleep(500)
  check('Space does not pass while it is being aimed', wire.status?.stop === stopBefore && await prompt.getAttribute('aria-label') === 'Choosing for Volcanic Hammer')
  check('the table has no accessibility violations while a spell is aimed', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
  await page.locator('.game__field').scrollIntoViewIfNeeded()
  await page.screenshot({ path: SHOT('aim') })
  await prompt.getByRole('button', { name: 'Never mind' }).click()
  check('"Never mind" lets it go: the stop as it was, and the Hammer glowing to be played again',
    await until(async () => (await prompt.getAttribute('aria-label')) === 'Your stop' && (await card.locator('.bcard--playable').count()) === 1)
    && wire.status?.stop === stopBefore)
  // The actions panel lists it as a play to press, which begins the same aiming.
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  const panel = page.locator('section.actions')
  await until(() => panel.count().then((n) => n === 1))
  const listed = panel.getByRole('button', { name: /Cast Volcanic Hammer/ }).first()
  check('the actions panel lists it as a play it will press', await listed.isEnabled() && !/What needs a target cannot be played here yet/.test(await panel.textContent() ?? ''))
  await listed.click()
  check('and pressing it there begins aiming it too', await until(() => prompt.getAttribute('aria-label').then((l) => l === 'Choosing for Volcanic Hammer')))
  const lifeOf = () => page.locator('.game__them .plate__total').textContent().then((t) => Number(t))
  const before = await lifeOf()
  // Counted rather than looked for: the log already names the Hammer from the
  // opening hand's draw, so a line naming it proves nothing (found in M4's
  // review). The cast and the life it took each come once more.
  const count = (text, words) => text.split(words).length - 1
  const logBefore = await logText()
  const said = { cast: count(logBefore, 'You cast Volcanic Hammer targeting'), lost: count(logBefore, 'Opponent lost 3 life') }
  await page.getByRole('button', { name: 'Aim at the engine' }).click()
  check('"Aim at the engine" casts it, and when it resolves the engine\'s life falls by three',
    await until(async () => (await lifeOf()) === before - 3, 20000),
    `the engine's life ${before} then ${await lifeOf()}`)
  check('the Hammer has left the hand, and the glows are gone', await until(async () => (await card.count()) === 0 && (await page.locator('.bcard--target, .plate--target').count()) === 0))
  check('the log says it was cast at the engine and what it did, once each more than before',
    await until(() => logText().then((t) => count(t, 'You cast Volcanic Hammer targeting') === said.cast + 1 && count(t, 'Opponent lost 3 life') === said.lost + 1), 8000),
    `${JSON.stringify(said)} before; ${(await logText()).slice(0, 300)}`)
  await page.locator('.game__them').scrollIntoViewIfNeeded()
  await page.screenshot({ path: SHOT('aimed') })
}

// Space after the pointer, with nothing blurred first (found in M3's review):
// a card the pointer pressed that did nothing keeps the focus it was given,
// and Space then passes rather than pressing that card a second time. Until
// the review Chromium's own marking of that card as focus-visible, the moment
// a key went down, made every such Space a second tap. The card is one in hand
// the engine offers nothing for, so a tap on it sends nothing.
{
  let pressed = null
  for (let i = 0; i < 20 && !pressed; i++) {
    await until(() => prompt.count().then((n) => n === 1), 20000)
    const s = wire.status
    if (!s || s.over) break
    const offered = new Set((s.actions ?? []).map((a) => a.card).filter(Boolean))
    const idle = (await handIds()).find((id) => !offered.has(id))
    if (s.actor === wire.me && s.waiting === 'action' && (s.actions ?? []).some((a) => a.type === 'PassPriority') && idle) { pressed = { id: idle, stop: s.stop }; break }
    const label = await prompt.getAttribute('aria-label').catch(() => null)
    if (label === 'Your attack') await page.getByRole('button', { name: 'No attack' }).click()
    else if (label === 'Their attack') await page.getByRole('button', { name: /No blocks/ }).click()
    else if (label === 'The engine asks') await page.getByRole('button', { name: /Let the engine choose|Yes/ }).first().click()
    else if (await passBtn.isEnabled().catch(() => false)) await passBtn.click()
    else break
    await nextStop(s.stop)
  }
  check('a stop of yours comes with a card in hand the engine offers nothing for', Boolean(pressed))
  if (pressed) {
    await tapHand(page.locator(`.tabletop__handcard[data-id="${pressed.id}"]`))
    const heldBy = await page.evaluate(() => document.activeElement?.closest('.tabletop__handcard')?.dataset.id ?? null)
    check('a card the pointer tapped keeps the focus', heldBy === pressed.id, `focus on ${heldBy}`)
    await page.keyboard.press('Space')
    check('and Space there passes, rather than tap the card again', await until(() => wire.status?.stop !== pressed.stop, 8000),
      `stop ${pressed.stop} then ${wire.status?.stop}`)
  }
}

console.log('\nSpace on a card the keyboard is on')
{
  // The other half: a card reached with Tab is pressed by Space, as every
  // button is, and nothing is passed. Found at the next stop of the player's
  // with a play in hand, reached by passing.
  let at = null
  for (let i = 0; i < 20 && !at; i++) {
    await until(() => prompt.count().then((n) => n === 1), 20000)
    const s = wire.status
    if (!s || s.over) break
    const play = offeredPlays(s).find((a) => !/^Declare/.test(a.type))
    if (s.actor === wire.me && s.waiting === 'action' && play && await page.locator(`.tabletop__handcard[data-id="${play.card}"]`).count()) { at = { play, status: s }; break }
    const label = await prompt.getAttribute('aria-label').catch(() => null)
    if (label === 'Your attack') await page.getByRole('button', { name: 'No attack' }).click()
    else if (label === 'Their attack') await page.getByRole('button', { name: /No blocks/ }).click()
    else if (label === 'The engine asks') await page.getByRole('button', { name: /Let the engine choose|Yes/ }).first().click()
    else if (await passBtn.isEnabled().catch(() => false)) await passBtn.click()
    else break
    await nextStop(s.stop)
  }
  check('a stop of yours comes with a card in hand to play', Boolean(at), JSON.stringify(wire.status).slice(0, 300))
  if (at) {
    const button = page.locator(`.tabletop__handcard[data-id="${at.play.card}"] .bcard`).first()
    await button.scrollIntoViewIfNeeded()
    // Reached by the keyboard: focused, then left and come back to with Tab.
    await button.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const on = await page.evaluate(() => ({ id: document.activeElement?.closest('.tabletop__handcard')?.dataset.id ?? null, shown: document.activeElement?.matches(':focus-visible') ?? false }))
    check('Tab reaches the card, and shows that it has', on.id === at.play.card && on.shown, JSON.stringify(on))
    await page.keyboard.press('Space')
    check('and Space plays that card, rather than pass', await until(() => page.locator(`.tabletop__handcard[data-id="${at.play.card}"]`).count().then((n) => n === 0), 8000),
      `stop ${at.status.stop} then ${wire.status?.stop}`)
  }
}

console.log('\nComing back')
await page.reload({ waitUntil: 'networkidle' })
check('a reload lands back in the same seat', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20000))
check('at the same table', await until(() => page.evaluate(() => location.hash).then((h) => h.includes(code))))
check('with the game where it was', await until(() => page.locator('.game__field .field .bcard--tile').count().then((n) => n >= 1), 10000))
check('the engine\'s table is not on the More panel\'s menu of things to do by hand', await (async () => {
  await page.getByRole('button', { name: 'More' }).click()
  return until(() => page.locator('.more').textContent().then((t) => /the engine's here/.test(t ?? '')))
})())
// Found by looking at a screenshot, not by a failing check: the by-hand
// table's "nothing here checks a play" sat under the engine's own note.
check('nor does the More panel say that nothing here checks a play', !/Nothing here checks whether a play is legal/.test(await page.locator('.more').textContent() ?? ''))
check('undo is not offered', await page.getByRole('button', { name: '↶ Undo' }).isDisabled())

await page.screenshot({ path: SHOT('table') })

console.log('\nWithout the cards it does not know')
// The owner's choice (2026-09-21): a deck the engine cannot fully hold may be
// played with those cards left out, and the table then says which were.
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Play the engine' }).click()
await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash)))
check('a second table asks again, and the answer is the same', await until(() => tile('Mixed Goblins').textContent().then((t) => /The engine knows 34 of 36 cards\./.test(t ?? '')), ENGINE_START_MS))
await tile('Mixed Goblins').click()
await page.getByRole('button', { name: /Sit down with Mixed Goblins/ }).click()
await until(() => gate.count().then((n) => n === 1))
await gate.getByRole('button', { name: 'Play the engine without them' }).click()
check('playing without them sits down, and the engine deals', await until(() => page.locator('.prompt').count().then((n) => n === 1), ENGINE_START_MS))
check('the log says what was left out and why', await until(() => logText().then((t) => /Played without 2 Made-Up Goblin: the engine does not know them\./.test(t))))
await page.getByRole('button', { name: 'More' }).click()
check('and so does the table, where the engine\'s rules are described', await until(() => page.locator('.more').textContent().then((t) => /Played without 2 Made-Up Goblin, as chosen in the lobby/.test(t ?? ''))))
check('a printing the engine has not got shows its own art, and the log says so once', /The engine does not have your printing of Raging Goblin, so it shows the engine's own art\./.test(await logText()))
check('the sideboard card it does not know is left out, and the table says so', /Your sideboard is played without Made-Up Wish: the engine does not know it\./.test(await page.locator('.more').textContent() ?? '') && /Your sideboard is played without Made-Up Wish/.test(await logText()))
check('no Made-Up Goblin reaches the hand', !/Made-Up Goblin/.test(await page.locator('.tabletop__handcard').allTextContents().then((ts) => ts.join(' '))))

console.log('\nA target to choose')
// A third table, with the deck whose arrival asks for a target. Played by the
// engine's own list — the first play it offers, else a pass — which is how
// the deck was tried against the engine before it was written here, so the
// same stop comes on every run.
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Play the engine' }).click()
await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash)))
check('the engine knows every card in the deck', await until(() => tile('Sparks').textContent().then((t) => /The engine knows all 34 cards\./.test(t ?? '')), ENGINE_START_MS))
wire.status = null
wire.me = null
await tile('Sparks').click()
await page.getByRole('button', { name: /Sit down with Sparks/ }).click()
check('it sits down, and the engine deals', await until(() => prompt.count().then((n) => n === 1), ENGINE_START_MS))
let asked = null
for (let i = 0; i < 40 && !asked; i++) {
  await until(() => prompt.count().then((n) => n === 1), 20000)
  const s = wire.status
  if (!s || s.over) break
  if (s.waiting === 'decision' && s.actor === wire.me && s.decision?.type === 'ChooseTargets') { asked = s; break }
  const label = await prompt.getAttribute('aria-label').catch(() => null)
  if (label === 'Your opening hand') await page.getByRole('button', { name: /^Keep this hand/ }).click()
  else if (label === 'The engine asks') await page.getByRole('button', { name: /Let the engine choose|Yes/ }).first().click()
  else if (label === 'Your attack') await page.getByRole('button', { name: 'No attack' }).click()
  else if (label === 'Their attack') await page.getByRole('button', { name: /No blocks/ }).click()
  else {
    const pick = offeredPlays(s).find((a) => !/^Declare/.test(a.type))
    if (pick) await tapHand(page.locator(`.tabletop__handcard[data-id="${pick.card}"]`))
    else { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Space') }
  }
  await nextStop(s.stop)
}
check('the engine asks this seat to aim Sparkmage Apprentice', Boolean(asked), JSON.stringify(wire.status).slice(0, 300))
if (asked) {
  const legal = asked.decision.requirements.flatMap((r) => r.legal ?? [])
  const seatIds = wire.seats.map((s) => s.engineSeat).filter(Boolean)
  const legalCards = legal.filter((id) => !seatIds.includes(id))
  const legalSeats = legal.filter((id) => seatIds.includes(id))
  check('exactly the legal targets glow, on both sides of the table, and nothing else does',
    await until(async () => { const g = await glowing(); return sameIds(g.target.map((x) => x.id), legalCards) && !g.playable.length && !g.chosen.length }),
    JSON.stringify({ glowing: (await glowing()).target.map((x) => x.id), legal: legalCards }))
  check('among them the engine\'s own creatures', await page.locator('.game__theirfield .bcard--target').count() > 0)
  check('and no land, and no card in hand', await page.locator('.tabletop__handcard .bcard--target').count() === 0
    && (await glowing()).target.every((x) => !/Basic Land/.test(x.label)))
  check('each saying so in words', (await glowing()).target.every((x) => /, a legal target$/.test(x.label)), JSON.stringify((await glowing()).target.map((x) => x.label)))
  check('the seats that are legal targets glow too, and say so', await until(async () => {
    const plates = (await glowing()).plates
    return plates.length === legalSeats.length && plates.every((p) => /, a legal target$/.test(p.label))
      && plates.some((p) => p.you) === legalSeats.includes(wire.me)
  }), JSON.stringify({ plates: (await glowing()).plates, legalSeats }))
  const plateMotion = await glowMotionEverywhere('.plate--target')
  check('a plate\'s glow breathes as a card\'s does, and stands still under either reduced-motion setting',
    plateMotion.moving === 'plate-target' && plateMotion.app === 'none' && plateMotion.system === 'none', JSON.stringify(plateMotion))
  check('the prompt names what is being aimed, and what the glow means',
    /Tap what Sparkmage Apprentice is aimed at: the legal targets glow\./.test(await prompt.textContent() ?? ''), await prompt.textContent())
  check('and offers each seat by name, since a plate is not a card to tap',
    await page.getByRole('button', { name: 'Aim at the engine' }).count() === 1 && await page.getByRole('button', { name: 'Aim at yourself' }).count() === 1)
  check('the table has no accessibility violations while it asks', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
  await page.locator('.game__field').scrollIntoViewIfNeeded()
  await page.screenshot({ path: SHOT('targets') })
  const lifeOf = () => page.locator('.game__them .plate__total').textContent().then((t) => Number(t))
  const before = await lifeOf()
  await page.getByRole('button', { name: 'Aim at the engine' }).click()
  check('aiming at the engine answers it: the engine loses the one life, and the glows go out',
    await until(async () => (await lifeOf()) === before - 1 && (await page.locator('.bcard--target, .plate--target').count()) === 0, 20000),
    `the engine's life ${before} then ${await lifeOf()}`)
}

console.log('\nA mulligan')
// A fourth table, the goblins again (HANDOFF.md, M4): one mulligan taken, the
// hand kept, one card put on the bottom, and six in hand when the game begins —
// the London mulligan as Argentum deals it (103.5). By the keyboard throughout.
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Play the engine' }).click()
await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash)))
await until(() => tile('Goblins').textContent().then((t) => /The engine knows all 34 cards\./.test(t ?? '')), ENGINE_START_MS)
wire.status = null
wire.me = null
await page.getByRole('button', { name: /^Goblins/ }).first().click()
await page.getByRole('button', { name: /Sit down with Goblins/ }).click()
const keeping = page.getByRole('group', { name: 'Your opening hand' })
check('the engine deals and asks whether to keep the hand', await until(() => keeping.count().then((n) => n === 1), ENGINE_START_MS))
check('seven in hand, said, and who plays first with it', (await hand()) === 7
  && /^7 cards\. You play first, so you skip your first draw \(103\.8a\)\./.test(await keeping.locator('.prompt__sub').textContent() ?? ''), await keeping.textContent())
check('the plate says what this is', /Opening hand/.test(await page.locator('.plate--you').getAttribute('aria-label') ?? ''))
check('the table has no accessibility violations while it asks', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.locator('.game__field').scrollIntoViewIfNeeded()
await page.screenshot({ path: SHOT('mulligan') })
await keeping.getByRole('button', { name: /^Mulligan/ }).focus()
await page.keyboard.press('Enter')
check('Enter on Mulligan takes one: seven again, and the prompt counts it and what keeping will cost',
  await until(() => keeping.locator('.prompt__sub').textContent().then((t) => /^7 cards, after 1 mulligan: keeping them puts 1 on the bottom of your library\./.test(t ?? '')).catch(() => false), 20000)
  && (await hand()) === 7, await prompt.textContent().catch(() => 'no prompt'))
check('the log says it once, as the mulligan it was', await until(() => logText().then((t) => t.split('You took a mulligan').length === 2)), await logText())
await keeping.getByRole('button', { name: /^Keep this hand/ }).focus()
await page.keyboard.press('Space')
check('Space on Keep keeps it, and the engine asks for the card to put on the bottom',
  await until(() => keeping.locator('.prompt__title').textContent().then((t) => t === 'Put 1 card on the bottom of your library').catch(() => false), 20000), await prompt.textContent().catch(() => 'no prompt'))
const bottomable = page.locator('.tabletop__handcard .bcard--target')
check('every card in hand glows, each saying it can go on the bottom', await until(() => bottomable.count().then((n) => n === 7))
  && await bottomable.evaluateAll((els) => els.every((el) => /, can go on the bottom$/.test(el.getAttribute('aria-label') ?? ''))))
check('the prompt counts down what is left to choose', /1 more to choose\./.test(await keeping.textContent() ?? ''))
check('the table has no accessibility violations while it asks for the card', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.locator('.game__hand').scrollIntoViewIfNeeded()
await page.screenshot({ path: SHOT('bottom') })
const sentDown = await page.locator('.tabletop__handcard').last().getAttribute('data-id')
await page.locator(`.tabletop__handcard[data-id="${sentDown}"] .bcard`).focus()
await page.keyboard.press('Enter')
check('Enter on a card puts it there: six in hand when the game begins, and not that one',
  await until(async () => (await hand()) === 6 && !(await handIds()).includes(sentDown), 20000), JSON.stringify(await handIds()))
check('the library holds the rest, the card at its bottom among them', /^Library, 28 cards/.test(await page.locator('.game__you .ztile[data-zone="library"]').getAttribute('aria-label') ?? ''))
check('the log says where it went', /You put .+ on the bottom of your library/.test(await logText()), await logText())
check('and the game has begun, at this seat\'s first stop', await until(() => prompt.getAttribute('aria-label').then((l) => l === 'Your stop').catch(() => false), 20000)
  && (await fetch(`${RELAY}/rooms/${await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])}`).then((r) => r.json())).mulligans === true)
await page.locator('.game__hand').scrollIntoViewIfNeeded()
await page.screenshot({ path: SHOT('six') })

console.log('\nCommander: the example decks, and a commander cast from the command zone')
// HANDOFF.md, M6. The app's four example Commander decks go on the shelf as a
// player would have them, by name, and the real engine is asked about each. At
// the pin it knows none of their commanders (PLAN.md, M6), so none can be dealt
// a Commander game, and the lobby says so and why. The Commander game is then
// played with what the engine can hold of one of them: the Esika example's
// green-white cards the engine knows, led by the legendary creature among them
// that fits those colours, Rhys the Redeemed, and basics to make a hundred —
// a deck made for this spec, and named as one.
const exampleDeck = (ex) => {
  const cardNames = {}
  const main = ex.main.map((e, i) => { const cardId = `ex-${ex.id}-${i}`; cardNames[cardId] = e.name; return { cardId, quantity: e.quantity } })
  const commanders = ex.commanders.map((name, i) => { const cardId = `ex-${ex.id}-c${i}`; cardNames[cardId] = name; return cardId })
  // Stamped names alone, as a deck whose records have not loaded carries them (src/lib/deck.js, stampNames).
  return { id: `ex-${ex.id}`, name: ex.name, formatId: 'commander', commanders, signatureSpell: null, categoryOrder: [], versions: [], main, sideboard: [], cardNames, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
}
// What the engine knows of each at the pin, measured on 2026-09-25 against the built engine (PLAN.md, M6).
const EXAMPLE_KNOWN = { "Y'shtola, Night's Blessed": 50, 'Esika, God of the Tree': 54, 'Anikthea, Hand of Erebos': 55, 'Commodore Guff': 45 }
// Rhys's deck: each card as the engine describes it (decklist, 2026-09-25), with no printing named, so the engine deals its own.
const g = (id, name, type_line, mana_cost, color_identity) => c(id, name, type_line, { mana_cost, color_identity, colors: color_identity, set: undefined, set_name: undefined, collector_number: undefined, legalities: { commander: 'legal' } })
const RHYS_CARDS = [
  g('rx-rhys', 'Rhys the Redeemed', 'Legendary Creature — Elf Warrior', '{G/W}', ['G', 'W']),
  g('rx-forest', 'Forest', 'Basic Land — Forest', '', ['G']), g('rx-plains', 'Plains', 'Basic Land — Plains', '', ['W']),
  g('rx-signet', 'Arcane Signet', 'Artifact', '{2}', []), g('rx-bark', 'Barkchannel Pathway', 'Land', '', ['G']),
  g('rx-whisperer', 'Beast Whisperer', 'Creature — Elf Druid', '{2}{G}{G}', ['G']), g('rx-within', 'Beast Within', 'Instant', '{2}{G}', ['G']),
  g('rx-branch', 'Branchloft Pathway', 'Land', '', ['G']), g('rx-bright', 'Brightclimb Pathway', 'Land', '', ['W']),
  g('rx-lantern', 'Chromatic Lantern', 'Artifact', '{3}', []), g('rx-tower', 'Command Tower', 'Land', '', []),
  g('rx-wilds', 'Evolving Wilds', 'Land', '', []), g('rx-orchard', 'Exotic Orchard', 'Land', '', []),
  g('rx-farseek', 'Farseek', 'Sorcery', '{1}{G}', ['G']), g('rx-fellwar', 'Fellwar Stone', 'Artifact', '{2}', []),
  g('rx-project', 'Guardian Project', 'Enchantment', '{3}{G}', ['G']), g('rx-harmonize', 'Harmonize', 'Sorcery', '{2}{G}{G}', ['G']),
  g('rx-henge', 'Hengegate Pathway', 'Land', '', ['W']), g('rx-golem', 'Meteor Golem', 'Artifact Creature — Golem', '{7}', []),
  g('rx-ancestry', 'Path of Ancestry', 'Land', '', []), g('rx-groves', 'Scattered Groves', 'Land — Forest Plains', '', ['G', 'W']),
  g('rx-sol', 'Sol Ring', 'Artifact', '{1}', []), g('rx-expanse', 'Terramorphic Expanse', 'Land', '', []),
  g('rx-map', 'Treasure Map', 'Artifact', '{2}', []), g('rx-blast', "Urza's Ruinous Blast", 'Legendary Sorcery', '{4}{W}', ['W']),
  g('rx-grove', 'Vivid Grove', 'Land', '', ['G']), g('rx-zetalpa', 'Zetalpa, Primal Dawn', 'Legendary Creature — Elder Dinosaur', '{6}{W}{W}', ['W']),
]
CARDS.push(...RHYS_CARDS)
const RHYS_DECK = {
  id: 'rhys', name: 'Rhys, from Esika', formatId: 'commander', commanders: ['rx-rhys'], signatureSpell: null, categoryOrder: [], versions: [],
  // Esika's own green-white cards the engine knows — 24 others, and 3 Forests and a Plains — and basics to a hundred with Rhys.
  main: RHYS_CARDS.filter((x) => x.id !== 'rx-rhys').map((x) => ({ cardId: x.id, quantity: x.id === 'rx-forest' ? 38 : x.id === 'rx-plains' ? 37 : 1 })),
  sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
// Each deck is a document of its own once the app has loaded its store (src/lib/storage.js), so each is added as one.
await page.evaluate((decks) => {
  for (const deck of decks) localStorage.setItem(`mtg-companion:v1:deck:${deck.id}`, JSON.stringify(deck))
}, [...EXAMPLE_DECKS.map(exampleDeck), RHYS_DECK])
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Play the engine' }).click()
await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash)))
const commanderCode = await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
// The shelf opens on Commander now that there are Commander decks on it.
for (const ex of EXAMPLE_DECKS) {
  const leader = ex.commanders[0]
  const known = EXAMPLE_KNOWN[leader]
  check(`the example deck ${ex.name}: the engine knows ${known} of its 100 cards, and not its commander, so it cannot deal a Commander game with it`,
    await until(() => tile(ex.name).textContent().then((t) => (t ?? '').includes(`The engine knows ${known} of 100 cards.`)
      && (t ?? '').includes(`It does not know the commander, ${leader}, and every Commander deck has one (903.3), so it cannot deal a Commander game with this deck.`)), ENGINE_START_MS),
    await tile(ex.name).textContent())
}
check('the lobby says what a Commander deck is dealt as, citing the rules',
  /A Commander deck is dealt as a Commander game, by Argentum's own Commander rules: 40 life each \(903\.7\)/.test(await page.locator('.lobby__seats').textContent() ?? ''))
check('the Commander shelf, checked by the real engine, has no accessibility violations', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.screenshot({ path: SHOT('examples') })
await tile('Commodore Guff').click()
await page.getByRole('button', { name: /Sit down with Commodore Guff/ }).click()
const guffGate = page.getByRole('dialog', { name: 'The engine does not know every card in Commodore Guff' })
check('sitting with an example deck says so instead, its commander first among what the engine does not know',
  await until(() => guffGate.count().then((n) => n === 1)) && /^\s*.*1 Commodore Guff, its commander/.test(await guffGate.getByRole('list', { name: 'Cards the engine does not know' }).textContent() ?? ''),
  await guffGate.textContent())
check('and offers the other 45 cards by the ordinary rules, the whole deck alone, or another deck',
  (await guffGate.textContent() ?? '').includes('Without them, the engine deals the other 45 cards by the ordinary rules: 20 life each, and no command zone.')
  && await guffGate.getByRole('button', { name: 'Play the engine without them' }).count() === 1)
await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
await page.screenshot({ path: SHOT('example-gate') })
await guffGate.getByRole('button', { name: 'Choose another deck' }).click()
await until(() => guffGate.count().then((n) => n === 0))

check('the Commander deck made from it, led by Rhys, is one the engine knows whole, commander and all',
  await until(() => tile('Rhys, from Esika').textContent().then((t) => (t ?? '').includes('The engine knows all 100 cards.')), ENGINE_START_MS), await tile('Rhys, from Esika').textContent())
wire.status = null
wire.me = null
await tile('Rhys, from Esika').click()
await page.getByRole('button', { name: /Sit down with Rhys, from Esika/ }).click()
const commanderStart = Date.now()
const keepIt = page.getByRole('group', { name: 'Your opening hand' })
check('the engine deals a Commander game and asks whether to keep the hand', await until(() => keepIt.count().then((n) => n === 1), ENGINE_START_MS))
const commanderDealMs = Date.now() - commanderStart
await keepIt.getByRole('button', { name: /^Keep this hand/ }).click()
check('the log says it is played by the Commander rules, citing them',
  await until(() => logText().then((t) => t.includes("Played by the Commander rules: 40 life each (903.7), and each commander begins in its owner's command zone (903.6)."))), await logText())
check('both plates say 40 life', await until(async () => /, 40 life/.test(await page.locator('.plate--you').getAttribute('aria-label') ?? '') && /, 40 life/.test(await page.locator('.plate--them').getAttribute('aria-label') ?? '')))
const myCommand = page.locator('.game__you .ztile[data-zone="command"]')
check('your command zone holds your commander, named', /^Command zone, 1 card: Rhys the Redeemed/.test(await myCommand.getAttribute('aria-label') ?? ''), await myCommand.getAttribute('aria-label'))
check('and the engine\'s holds its own, a copy of yours', /^The engine's command zone, 1 card: Rhys the Redeemed$/.test(await page.locator('.game__them .ztile[data-zone="command"]').getAttribute('aria-label') ?? ''))
// A basic land first, then the commander for the one mana it makes.
const basic = page.locator('.tabletop__handcard').filter({ has: page.getByLabel(/^(Forest|Plains),/) }).first()
check('a Forest or a Plains is in hand to play', await until(() => basic.count().then((n) => n === 1), 20_000))
await until(() => wire.status?.actor === wire.me && wire.status?.waiting === 'action' && wire.status.actions.some((a) => a.type === 'PlayLand'), 20_000)
await tapHand(basic)
check('the command zone glows once the commander can be cast, and says a tap casts it and how else it is opened',
  await until(() => myCommand.getAttribute('aria-label').then((l) => l === 'Command zone, 1 card: Rhys the Redeemed, your commander can be cast now: a tap casts it, and a hold, a right-click or Shift+Enter opens the zone'), 20_000)
  && /ztile--playable/.test(await myCommand.getAttribute('class')), await myCommand.getAttribute('aria-label'))
const castOffer = wire.status?.actions?.find((a) => a.from === 'command')
check('the engine offered it from the command zone, for its own cost and no tax yet', castOffer?.manaCost === '{G/W}' && castOffer?.commanderTax?.casts === 0, JSON.stringify(castOffer))
check('and the prompt says so in words', /Your commander, Rhys the Redeemed, can be cast from the command zone for \{G\/W\}\./.test(await prompt.textContent() ?? ''), await prompt.textContent())
check('the table has no accessibility violations', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
await page.locator('.game__you').scrollIntoViewIfNeeded()
await page.screenshot({ path: SHOT('command') })
await myCommand.click()
const rhysOnField = page.locator('.game__field .field__slot [aria-label^="Rhys the Redeemed"]').first()
check('a tap on the command zone casts it, and it is on the battlefield, said to be a commander',
  await until(() => rhysOnField.getAttribute('aria-label').then((l) => /, a commander/.test(l ?? '')).catch(() => false), 20_000), await rhysOnField.getAttribute('aria-label').catch(() => 'none'))
check('the command zone is empty behind it', await until(() => myCommand.getAttribute('aria-label').then((l) => l === 'Command zone, 0 cards')))
check('the log says it was cast from the command zone, in the engine\'s words', await until(() => logText().then((t) => /You cast Rhys the Redeemed \(from command zone, paid 1 mana\)/.test(t))), await logText())
check('the room dealt a Commander game', await fetch(`${RELAY}/rooms/${commanderCode}`).then((r) => r.json()).then((r) => r.format?.played === 'commander'))
await page.locator('.game__field').scrollIntoViewIfNeeded()
await page.screenshot({ path: SHOT('commander-cast') })
console.log(`        (from Sit to the hand to keep: ${commanderDealMs} ms)`)

check('no console errors throughout', errors.length === 0, errors.join('\n'))
console.log(`\nScreenshots: ${SHOT('gate')}, ${SHOT('gate-reasons')}, ${SHOT('playable')}, ${SHOT('playable-season')}, ${SHOT('peek-prompt')}, ${SHOT('attack')}, ${SHOT('attack-focus')}${thinkingShot ? `, ${SHOT('thinking')}` : ''}, ${SHOT('aim')}, ${SHOT('aimed')}, ${SHOT('table')}, ${SHOT('targets')}, ${SHOT('mulligan')}, ${SHOT('bottom')}, ${SHOT('six')}, ${SHOT('examples')}, ${SHOT('example-gate')}, ${SHOT('command')} and ${SHOT('commander-cast')}`)
await browser.close()
await relayServer.shutdown()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
