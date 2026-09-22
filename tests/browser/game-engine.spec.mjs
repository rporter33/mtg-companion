#!/usr/bin/env node
/**
 * The engine on screen, through the app itself.
 *
 * engine-live.test.js proves the wire; this proves the screens on top of
 * it: from the lobby, a person opens a table the engine holds, sits down
 * with a deck, and plays — a land by tapping it, a pass from the rail, an
 * attack by tapping a creature and pressing Attack — against the engine's
 * own player, with the log saying what the engine did on their behalf.
 * Then a reload, which has to land back in the same seat at the same table.
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

await passBtn.click()
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
    await attacker.click()
    check('tapping a creature draws its attack as an arrow', await until(() => page.locator('.game__field .field__arrow--attack').count().then((n) => n === 1)))
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

check('no console errors throughout', errors.length === 0, errors.join('\n'))
console.log(`\nScreenshots: ${SHOT('gate')}, ${SHOT('gate-reasons')}, ${SHOT('attack')}${thinkingShot ? `, ${SHOT('thinking')}` : ''} and ${SHOT('table')}`)
await browser.close()
await relayServer.shutdown()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
