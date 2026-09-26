#!/usr/bin/env node
/**
 * The decisions the engine now asks a person rather than answers for them
 * (HANDOFF.md, M4), each on screen: in words, reached and answered with the
 * keyboard alone, and with nothing axe can find wrong. The opening hand first
 * (protocol 6): a card tapped before keeping refused in words, two mulligans
 * taken, and the two cards owed put on the bottom, one dragged out of the hand
 * and one by the keyboard. game-engine.spec.mjs takes a mulligan against the
 * real engine and counts the six kept.
 *
 * The real engine raises most of these only in games no seed here steers
 * towards — a double block, a trigger that divides damage, a modal trigger —
 * so this spec runs with the scripted stand-in (tests/fixtures/fake-engine.mjs)
 * and tells it which decisions to put to the seat, one after another, in the
 * shapes the built engine sent on 2026-09-24 (the same ones
 * tests/engine-choose.test.js and tests/engine-choosing.test.jsx read). What
 * the page sends back is read off the stand-in: the `decide` the room passed
 * on. It runs on any machine and in CI, where there is no JVM;
 * game-engine.spec.mjs casts a spell at a target against the real engine.
 *
 *   node tests/browser/decisions.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelay } from '../../scripts/relay-server.mjs'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
const FAKE_ENGINE = fileURLToPath(new URL('../fixtures/fake-engine.mjs', import.meta.url))
// Pictures go to the system's temporary folder and are named at the end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `decisions-${name}.png`)
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

const relayServer = createRelay({ engineCommand: FAKE_ENGINE, pingMs: 60_000, pace: 0 })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const RELAY = `http://127.0.0.1:${relayServer.server.address().port}`

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{R}', cmc: 1, type_line,
  oracle_text: '', color_identity: ['R'], colors: ['R'], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { standard: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
const CARDS = [
  c('mountain', 'Mountain', 'Basic Land — Mountain', { mana_cost: '', cmc: 0, produced_mana: ['R'], collector_number: '208' }),
  c('goblin', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste', collector_number: '145' }),
]
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [{
    id: 'd1', name: 'Goblins', formatId: 'standard', commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
    main: [{ cardId: 'mountain', quantity: 20 }, { cardId: 'goblin', quantity: 20 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { relayUrl: RELAY, playerName: 'Robin', reduceMotion: true },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
// Service workers blocked, as in game-engine.spec.mjs: the built app's own
// fetches every *.scryfall.io image past page.route, so the stand-in engine's
// card faces (real Scryfall links) would not be the pixel routed below.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
// What the room told the page, as the page received it.
const wire = { status: null, me: null, choices: null, sit: null }
page.on('websocket', (ws) => {
  ws.on('framesent', ({ payload }) => {
    try { const m = JSON.parse(typeof payload === 'string' ? payload : payload.toString()); if (m?.op === 'sit') wire.sit = m } catch { /* not ours */ }
  })
  ws.on('framereceived', ({ payload }) => {
    let m
    try { m = JSON.parse(typeof payload === 'string' ? payload : payload.toString()) } catch { return }
    if (m?.t !== 'engine') return
    if (m.op === 'status' && m.status) wire.status = m.status
    if (m.op === 'seated' && m.engineSeat) { wire.me = m.engineSeat; wire.choices = m.choices ?? null }
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
const prompt = page.locator('.prompt')

/**
 * Reaches a control with Tab alone, from the first control of the prompt, and
 * says whether it got there. Tab is the whole of it: a control a keyboard
 * cannot reach this way is one the prompt does not offer to a keyboard.
 */
const reach = async (locator, most = 60) => {
  const target = await locator.elementHandle()
  if (!target) return false
  await prompt.locator('button').first().focus()
  for (let i = 0; i < most; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return true
    await page.keyboard.press('Tab')
  }
  return target.evaluate((el) => el === document.activeElement)
}

/**
 * A point on a card in hand that no other card covers, for a pointer to press:
 * the hand is fanned, and the middle of a card can be under its neighbour.
 */
const handPoint = async (id) => {
  const card = page.locator(`.tabletop__handcard[data-id="${id}"] .bcard`)
  await card.scrollIntoViewIfNeeded()
  return card.evaluate(pointOnSlot)
}
const pointOnSlot = (el) => {
  const slot = el.closest('.tabletop__handcard')
  const box = slot.getBoundingClientRect()
  const y = box.top + box.height / 3
  let from = null
  for (let x = box.left + 1; x < box.right; x += 1) {
    const hit = document.elementFromPoint(x, y)
    if (hit && slot.contains(hit)) { if (from === null) from = x } else if (from !== null) return { x: (from + x) / 2, y }
  }
  return from === null ? null : { x: (from + box.right) / 2, y }
}
const handIds = () => page.locator('.tabletop__handcard').evaluateAll((els) => els.map((el) => el.dataset.id))

console.log('\nSitting down')
await page.getByRole('button', { name: 'Play the engine' }).click()
await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash)))
const code = await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
await until(() => page.getByRole('button', { name: /^Goblins/ }).count().then((n) => n > 0), 20_000)
await page.getByRole('button', { name: /^Goblins/ }).first().click()
await page.getByRole('button', { name: /Sit down with Goblins/ }).click()
check('the table opens', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000))
check('the sit says which decisions this build can show', Array.isArray(wire.sit?.answers) && wire.sit.answers.includes('SelectCards') && wire.sit.answers.includes('CombatResolution'), JSON.stringify(wire.sit?.answers))
check('the room says after the deal what this seat may choose', await until(() => Array.isArray(wire.choices?.decisions) && wire.choices.decisions.includes('BatchYesNo')), JSON.stringify(wire.choices))
const engine = relayServer.rooms.get(code)?.engine?.engine
const lastDecide = async () => (await engine.call('lastDecide')).request
check('the engine was dealt a seat that answers them', await engine.call('lastNew').then((r) => Array.isArray(r.request?.players?.[0]?.answers) && !('answers' in r.request.players[1])))

console.log('\nThe opening hand')
const lastAct = async () => (await engine.call('lastAct')).request
{
  check('the sit says this build can show a mulligan, and the room dealt the hands to keep', wire.sit?.mulligans === true && await engine.call('lastNew').then((r) => r.request?.mulligans === true))
  const opening = page.getByRole('group', { name: 'Your opening hand' })
  check('the prompt asks to keep the hand or take a mulligan, before anything else', await until(() => opening.count().then((n) => n === 1), 8000))
  const said = await opening.textContent() ?? ''
  check('in words, with the rule it is cited by', /Keep this hand/.test(said) && /London mulligan \(103\.5\)/.test(said), said)
  check('and the plate says what this is, where the turn would be', /Opening hand/.test(await page.locator('.plate--you').getAttribute('aria-label') ?? ''))
  check('the table has no accessibility violations while it asks', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
  await page.screenshot({ path: SHOT('opening') })
  // A card in hand tapped before the hand is kept is not played, and says why
  // (Table.jsx, `play`): nothing is played before the game begins.
  const banner = page.locator('.banner--info')
  const tapped = await handPoint((await handIds())[0])
  await page.mouse.click(tapped.x, tapped.y)
  check('a tap on a card before keeping says to keep the hand or take a mulligan first, and sends nothing',
    await until(() => banner.textContent().then((t) => t === 'Keep this hand or take a mulligan first: nothing is played before the game begins.').catch(() => false))
    && (await lastAct()) == null, await banner.textContent().catch(() => 'no banner'))
  const mulligan = opening.getByRole('button', { name: /^Mulligan/ })
  check('Mulligan is reached with Tab', await reach(mulligan))
  await page.keyboard.press('Enter')
  check('and Enter takes one', await until(async () => (await lastAct())?.index === 1, 5000))
  check('the prompt then counts it', await until(() => opening.textContent().then((t) => /after 1 mulligan/.test(t ?? '')).catch(() => false)))
  // A second, so two are owed and the first card chosen does not send the lot.
  await reach(opening.getByRole('button', { name: /^Mulligan/ }))
  await page.keyboard.press('Enter')
  check('and a second', await until(() => opening.textContent().then((t) => /after 2 mulligans/.test(t ?? '')).catch(() => false)))
  check('Keep is reached with Tab', await reach(opening.getByRole('button', { name: /^Keep this hand/ })))
  await page.keyboard.press('Space')
  const bottom = page.getByRole('group', { name: 'Your opening hand' })
  check('and Space keeps it: the engine asks for the cards to put on the bottom, in its words', await until(() => bottom.locator('.prompt__title').textContent().then((t) => t === 'Put 2 cards on the bottom of your library').catch(() => false), 5000), await prompt.textContent().catch(() => 'no prompt'))
  const glowing = page.locator('.tabletop__handcard .bcard--target')
  check('the cards in hand glow, each saying it can go on the bottom', await until(() => glowing.count().then((n) => n > 0))
    && await glowing.evaluateAll((els) => els.every((el) => /, can go on the bottom$/.test(el.getAttribute('aria-label') ?? ''))))
  check('the prompt counts down what is left to choose', /2 more to choose\./.test(await bottom.textContent() ?? ''))
  check('and the table has no accessibility violations while it asks', await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
  await page.screenshot({ path: SHOT('bottom') })
  const [dragged, pick] = await glowing.evaluateAll((els) => els.map((el) => el.closest('[data-id]')?.dataset.id))
  // A card dragged out of the hand onto the table while the bottom is being
  // chosen is chosen, as a tap on it is. Until M4's review the drag looked for
  // a play, and said to keep a hand already kept.
  const actsBefore = await lastAct()
  const from = await handPoint(dragged)
  const field = await page.locator('.game__field').boundingBox()
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2, { steps: 12 })
  await page.mouse.up()
  check('a card dragged onto the table is chosen for the bottom, and nothing is sent yet',
    await until(() => bottom.textContent().then((t) => /1 more to choose\./.test(t ?? '')).catch(() => false))
    && await page.locator(`.tabletop__handcard[data-id="${dragged}"] .bcard--chosen`).count() === 1
    && JSON.stringify(await lastAct()) === JSON.stringify(actsBefore),
    await bottom.textContent().catch(() => 'no prompt'))
  check('and nothing is refused', !/Keep this hand or take a mulligan first|Choose the cards/.test(await banner.textContent().catch(() => '') ?? ''), await banner.textContent().catch(() => ''))
  check('a card in hand is reached with Tab', await reach(page.locator(`.tabletop__handcard[data-id="${pick}"] .bcard`)))
  await page.keyboard.press('Enter')
  check('and Enter chooses it too', await until(() => bottom.textContent().then((t) => /All chosen\./.test(t ?? '')).catch(() => false)))
  await reach(bottom.getByRole('button', { name: /^Put them on the bottom/ }))
  await page.keyboard.press('Enter')
  check('"Put them on the bottom" sends both: the act carries the two cards, each once', await until(async () => JSON.stringify((await lastAct())?.cards) === JSON.stringify([dragged, pick]), 5000), JSON.stringify(await lastAct()))
  check('the game then begins', await until(() => page.getByRole('group', { name: 'Your opening hand' }).count().then((n) => n === 0), 5000))
}

// The stand-in serves the captured run (tests/fixtures/engine-views.json), and
// the decisions are asked at its second stop, after the attack this spec
// declines: there this seat holds Volcanic Hammer (e30) and a Mountain (e5),
// with Mountains (e13, e9) among its permanents.
await until(() => page.locator('.tabletop__handcard').count().then((n) => n >= 2))
const hand = ['e30', 'e5']
const land = 'e13'
const THEM = 'e1'

// The decisions, in the shapes Server.kt sends them, each after the one before is answered.
const DECISIONS = [
  { id: 'r1', type: 'SelectCards', player: 'e0', prompt: 'Discard down to 7 cards (choose 1 to discard)', source: null, min: 1, max: 1, options: hand },
  { id: 'r2', type: 'SelectCards', player: 'e0', prompt: 'Choose up to 2 cards', source: 'Magma Jet', min: 0, max: 2, options: ['lib1', 'lib2'], selectedLabel: 'Put on bottom', remainderLabel: 'Put on top', cards: { lib1: { name: 'Magma Jet', manaCost: '{1}{R}', typeLine: 'Instant' }, lib2: { name: 'Mountain', manaCost: '', typeLine: 'Basic Land — Mountain' } } },
  { id: 'r3', type: 'ReorderLibrary', player: 'e0', prompt: 'Look at the top 2 cards of your library. Put them back in any order.', source: 'Magma Jet', objects: ['lib1', 'lib2'], cards: { lib1: { name: 'Magma Jet', manaCost: '{1}{R}', typeLine: 'Instant' }, lib2: { name: 'Mountain', manaCost: '', typeLine: 'Basic Land — Mountain' } }, placement: 'top', library: 'e0' },
  { id: 'r4', type: 'Distribute', player: 'e0', prompt: 'Divide 3 damage among 2 targets', source: 'Arc Lightning', total: 3, minPer: 1, targets: [THEM, 'e0'] },
  {
    id: 'r5', type: 'CombatResolution', player: 'e0', prompt: "Assign Hill Giant's 3 combat damage", source: 'Hill Giant', firstStrike: false,
    edges: [
      { id: 'g->b1', source: 'g', target: 'b1', amount: 1, maximum: 3, lethal: 1, mine: true },
      { id: 'g->b2', source: 'g', target: 'b2', amount: 2, maximum: 3, lethal: 1, mine: true },
    ],
    attackers: [{ id: 'g', name: 'Hill Giant', power: 3, trample: false }],
    blockers: [{ id: 'b1', name: 'Raging Goblin' }, { id: 'b2', name: 'Goblin Bully' }],
    defenders: [{ id: THEM, name: 'Player' }],
  },
  { id: 'r6', type: 'SelectManaSources', player: 'e0', prompt: 'Pay {1}', source: 'Lightning Rift', cost: '{1}', canDecline: true, sources: [{ id: land, name: 'Mountain', amount: 1, colors: ['RED'] }, { id: 'e9', name: 'Mountain', amount: 1, colors: ['RED'] }], suggested: [land] },
  { id: 'r7', type: 'ChooseNumber', player: 'e0', prompt: "Choose X for Wizard's Rockets (0-3)", source: "Wizard's Rockets", min: 0, max: 3 },
  { id: 'r8', type: 'ChooseColor', player: 'e0', prompt: 'Choose a color', source: 'Prismatic Strands', colors: ['WHITE', 'BLUE', 'BLACK', 'RED', 'GREEN'] },
  { id: 'r9', type: 'ChooseMode', player: 'e0', prompt: 'Choose 1 mode(s) for Charm', source: 'Charm', min: 1, max: 1, modes: [{ index: 0, text: 'Deal 2 damage to any target', available: true }, { index: 1, text: 'Destroy target artifact', available: false }] },
  { id: 'r10', type: 'BatchYesNo', player: 'e0', prompt: 'Use the ability of each Pinger?', source: 'Pinger', count: 3, yesText: 'Yes', noText: 'No' },
  { id: 'r11', type: 'SplitPiles', player: 'e0', prompt: 'Separate cards into 2 piles', source: 'Fact or Fiction' },
]
for (const decision of DECISIONS) await engine.call('ask', { decision })
// The run's first stop offers an attack; declining it is the move that brings the next stop.
await until(() => prompt.getByRole('button', { name: 'No attack' }).count().then((n) => n === 1), 8000)
await prompt.getByRole('button', { name: 'No attack' }).click()

/** Waits for the prompt to ask this decision, in the engine's words, and checks axe finds nothing on the table while it does. */
const asking = async (d, what) => {
  const shown = await until(() => prompt.locator('.prompt__title').textContent().then((t) => t === d.prompt).catch(() => false))
  check(`the engine asks ${what}, in its own words`, shown, await prompt.textContent().catch(() => 'no prompt'))
  check(`and the table has no accessibility violations while it does`, await axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false)))
  return shown
}
/**
 * Waits for this decision's answer to have reached the engine: a `decide`
 * newer than the last one read, told apart by the number the room's bridge
 * gave the request (the room keeps a client's stop to itself).
 */
let lastId = null
const sent = async (id, matches) => {
  let got = null
  const ok = await until(async () => { got = await lastDecide(); return Boolean(got) && got.id !== lastId && matches(got) }, 5000)
  if (got) lastId = got.id
  return { ok, got }
}

console.log('\nCards to select, picked on the table')
{
  const d = DECISIONS[0]
  await asking(d, 'which card to discard at cleanup (514.1)')
  check('the cards that can be chosen glow, saying so', await until(() => page.locator('.tabletop__handcard .bcard--target').count().then((n) => n === d.options.length))
    && await page.locator('.tabletop__handcard .bcard--target').evaluateAll((els) => els.every((el) => /, can be chosen$/.test(el.getAttribute('aria-label') ?? ''))))
  const card = page.locator(`.tabletop__handcard[data-id="${d.options[1]}"] .bcard`)
  // The hand comes after the prompt in the page, so Tab from the prompt reaches it.
  check('a card is reached with Tab', await reach(card))
  await page.keyboard.press('Enter')
  const { ok, got } = await sent(d.id, (r) => Array.isArray(r.cards))
  check('and Enter chooses it: the answer is that card', ok && JSON.stringify(got.cards) === JSON.stringify([d.options[1]]), JSON.stringify(got))
}

console.log('\nCards the table cannot show, named in the prompt')
{
  const d = DECISIONS[1]
  await asking(d, 'which of the cards looked at go to the bottom')
  check('the cards are named, as buttons that say whether they are chosen', await prompt.getByRole('button', { name: 'Magma Jet' }).getAttribute('aria-pressed') === 'false')
  check('and it says what choosing one does', /Chosen: put on bottom; the rest: put on top\./.test(await prompt.textContent() ?? ''))
  const jet = prompt.getByRole('button', { name: 'Magma Jet' })
  check('each is reached with Tab', await reach(jet))
  await page.keyboard.press('Space')
  check('and Space chooses it, and says so', await until(() => jet.getAttribute('aria-pressed').then((v) => v === 'true')))
  check('Done is reached with Tab', await reach(prompt.getByRole('button', { name: 'Done →' })))
  await page.keyboard.press('Enter')
  const { ok, got } = await sent(d.id, (r) => Array.isArray(r.cards))
  check('and Enter sends the choice', ok && JSON.stringify(got.cards) === '["lib1"]', JSON.stringify(got))
}

console.log('\nAn order')
{
  const d = DECISIONS[2]
  await asking(d, 'the order to put the cards back in')
  const rows = () => prompt.locator('li .prompt__rowname').allTextContents()
  check('it lists them, the top of the library first, and says which end the first is, of whose library, as the engine said',
    JSON.stringify(await rows()) === JSON.stringify(['1. Magma Jet', '2. Mountain']) && /The first is the top of your library\./.test(await prompt.textContent() ?? ''),
    JSON.stringify(await rows()))
  const up = prompt.getByRole('button', { name: 'Move Mountain up' })
  check('each has buttons that say what they move, reached with Tab', await reach(up))
  await page.keyboard.press('Enter')
  check('and Enter moves it', await until(() => rows().then((r) => JSON.stringify(r) === JSON.stringify(['1. Mountain', '2. Magma Jet']))))
  await page.screenshot({ path: SHOT('order') })
  await reach(prompt.getByRole('button', { name: 'Done →' }))
  await page.keyboard.press('Enter')
  const { ok, got } = await sent(d.id, (r) => Array.isArray(r.order))
  check('Done sends the order', ok && JSON.stringify(got.order) === '["lib2","lib1"]', JSON.stringify(got))
}

console.log('\nA division')
{
  const d = DECISIONS[3]
  await asking(d, 'how to divide damage')
  check('it says the total and what is divided so far', /Divide 3 among them, at least 1 each: 3 of 3 divided\./.test(await prompt.textContent() ?? ''), await prompt.textContent())
  const more = prompt.getByRole('button', { name: 'One more to yourself' })
  check('each share has buttons that say whose share they change, reached with Tab', await reach(more))
  await page.keyboard.press('Enter')
  check('a division that does not add up cannot be sent', await prompt.getByRole('button', { name: 'Done →' }).isDisabled())
  // The stand-in's seat opposite is called Bot, where the real engine's is The engine.
  await reach(prompt.getByRole('button', { name: /^One fewer to (the engine|Bot)$/ }))
  await page.keyboard.press('Enter')
  await reach(prompt.getByRole('button', { name: 'Done →' }))
  await page.keyboard.press('Enter')
  const { ok, got } = await sent(d.id, (r) => r.distribution)
  check('one that does is sent', ok && got.distribution[THEM] === 1 && got.distribution.e0 === 2, JSON.stringify(got))
}

console.log('\nCombat damage')
{
  const d = DECISIONS[4]
  await asking(d, "how the Hill Giant's damage is split between its blockers (510.1c)")
  check('the engine\'s own split is where it begins, and each blocker says what is lethal to it',
    /Hill Giant: 3 of 3 dealt/.test(await prompt.textContent() ?? '') && await prompt.getByRole('button', { name: 'More damage to Raging Goblin, lethal 1' }).count() === 1)
  await page.screenshot({ path: SHOT('combat') })
  await reach(prompt.getByRole('button', { name: 'More damage to Raging Goblin, lethal 1' }))
  await page.keyboard.press('Enter')
  await reach(prompt.getByRole('button', { name: 'Less damage to Goblin Bully, lethal 1' }))
  await page.keyboard.press('Enter')
  await reach(prompt.getByRole('button', { name: 'Done →' }))
  await page.keyboard.press('Enter')
  const { ok, got } = await sent(d.id, (r) => r.edges)
  check('Done sends each edge as set', ok && got.edges['g->b1'] === 2 && got.edges['g->b2'] === 1, JSON.stringify(got))
}

console.log('\nMana to pay with')
{
  const d = DECISIONS[5]
  await asking(d, 'which lands pay a cost')
  check('the engine\'s own choice is lit, saying so, and the other land glows as one that could pay', await until(() => page.locator(`[data-id="${land}"] .bcard--chosen`).count().then((n) => n === 1))
    && /, chosen to pay mana$/.test(await page.locator(`[data-id="${land}"] .bcard--chosen`).getAttribute('aria-label') ?? '')
    && /, can pay mana$/.test(await page.locator('[data-id="e9"] .bcard--target').getAttribute('aria-label') ?? ''))
  check('and it may be left to the engine, or declined', await prompt.getByRole('button', { name: /Let the engine pay/ }).count() === 1 && await prompt.getByRole('button', { name: 'Do not pay' }).count() === 1)
  await reach(prompt.getByRole('button', { name: /Let the engine pay/ }))
  await page.keyboard.press('Enter')
  const { ok, got } = await sent(d.id, (r) => r.autoPay === true)
  check('"Let the engine pay" asks it to pay as it would', ok, JSON.stringify(got))
}

console.log('\nA number, a colour, a mode, and one answer for several')
{
  let d = DECISIONS[6]
  await asking(d, 'for a number')
  await reach(prompt.getByRole('button', { name: 'Raise the number' }))
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await reach(prompt.getByRole('button', { name: 'Choose 2 →' }))
  await page.keyboard.press('Enter')
  let r = await sent(d.id, (x) => x.number !== undefined)
  check('the number set with the keyboard is the one sent', r.ok && r.got.number === 2, JSON.stringify(r.got))

  d = DECISIONS[7]
  await asking(d, 'for a colour')
  check('it offers the five colours by name', JSON.stringify(await prompt.locator('button').allTextContents()).includes('"Red"'))
  await reach(prompt.getByRole('button', { name: 'Green' }))
  await page.keyboard.press('Enter')
  r = await sent(d.id, (x) => x.color !== undefined)
  check('and sends the one chosen', r.ok && r.got.color === 'GREEN', JSON.stringify(r.got))

  d = DECISIONS[8]
  await asking(d, 'for one mode')
  check('a mode that is not possible now says so and cannot be pressed', await prompt.getByRole('button', { name: /Destroy target artifact \(not possible now\)/ }).isDisabled())
  await reach(prompt.getByRole('button', { name: 'Deal 2 damage to any target' }))
  await page.keyboard.press('Enter')
  r = await sent(d.id, (x) => Array.isArray(x.modes))
  check('and one press chooses the mode', r.ok && JSON.stringify(r.got.modes) === '[0]', JSON.stringify(r.got))

  d = DECISIONS[9]
  await asking(d, 'the same question for three at once')
  check('it says what answering all of them does', /answer all 3, or this one and be asked again for the rest/.test(await prompt.textContent() ?? ''))
  await reach(prompt.getByRole('button', { name: 'Yes to all 3' }))
  await page.keyboard.press('Enter')
  r = await sent(d.id, (x) => x.all !== undefined)
  check('and "Yes to all 3" answers all three', r.ok && r.got.yes === true && r.got.all === true, JSON.stringify(r.got))
}

console.log('\nA decision this table cannot show')
{
  const d = DECISIONS[10]
  await asking(d, 'what it cannot show here, still')
  check('with only the engine\'s choice to offer, and saying where it came from', JSON.stringify(await prompt.locator('button').allTextContents()) === JSON.stringify(['Let the engine chooseIt will say what it chose']) && /From Fact or Fiction\./.test(await prompt.textContent() ?? ''))
  await reach(prompt.getByRole('button', { name: /Let the engine choose/ }))
  await page.keyboard.press('Enter')
  const { ok, got } = await sent(d.id, (r) => r.auto === true)
  check('which the keyboard reaches and sends', ok, JSON.stringify(got))
}

// The run's second stop is an attack to declare, and the table goes back to it.
check('the table is back at the player\'s own stop once every decision is answered', await until(() => prompt.getAttribute('aria-label').then((l) => l === 'Your attack').catch(() => false)))
check('no uncaught errors', errors.length === 0, errors.join('; '))
check('no console errors', consoleErrors.length === 0, consoleErrors.join('\n'))

console.log(`\nPictures: ${SHOT('opening')}, ${SHOT('bottom')}, ${SHOT('order')}, ${SHOT('combat')}`)
await browser.close()
await relayServer.shutdown()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
