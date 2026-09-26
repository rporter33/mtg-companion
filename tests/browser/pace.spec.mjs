#!/usr/bin/env node
/**
 * How a person plays at the engine's table (HANDOFF.md §3 item 24): the pace
 * presets, asked once, remembered, changing what the table does, and changeable
 * later from the table's own settings.
 *
 * Driven through the app itself against the relay and the scripted stand-in for
 * the engine (tests/fixtures/fake-engine.mjs), so it runs on any machine and in
 * CI. The stand-in offers a person stopped at every window the windows its
 * captured run passed for them, each a stop with only a pass on it, and passes
 * them for a person who is not, which is what makes the difference between the
 * presets something a page can be seen to do. tests/engine-live.test.js holds
 * the real engine to the same.
 *
 * What is checked: the question on the table the first time, above the
 * battlefield and never in front of it, with Fast — the owner's choice since
 * 2026-09-26 — chosen and in force from the sit; three presets as radios a
 * keyboard and a screen reader use, and under Advanced the settings each sets;
 * Controlled a tap away over the opening hand, the engine asked, and a window
 * with nothing in it then a stop; Learning chosen from the keyboard, its steps
 * explained at the stops, counted, and its speed the room's; the question answered and not asked again after a reload, the
 * choice remembered; Fast chosen later from the table's own settings, after
 * which a window with nothing in it is passed and the log says so; axe clean at
 * both widths, nothing sideways at a phone's, and nothing animating.
 *
 *   node tests/browser/pace.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelay } from '../../scripts/relay-server.mjs'
import { PAYING_LINE, PRESET_LINES, STACK_LINE } from '../../src/lib/engine/pace.js'
import { teachingBody, teachingFor, teachingHead } from '../../src/lib/engine/teach.js'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
const FAKE_ENGINE = fileURLToPath(new URL('../fixtures/fake-engine.mjs', import.meta.url))
// Pictures go to the system's temporary folder, named at the end, because a picture nobody opens proves nothing.
const SHOT = (name) => join(tmpdir(), `ui-pace-${name}.png`)
const shots = []
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

// A paced relay, so the speed is something the room really waits: 40 ms is its own pace, Brisk.
const BASE_PACE = 40
const relayServer = createRelay({ engineCommand: FAKE_ENGINE, pingMs: 60_000, pace: BASE_PACE })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const RELAY = `http://127.0.0.1:${relayServer.server.address().port}`
const peek = async (code) => (await fetch(`${RELAY}/rooms/${code}`)).json()

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
  // Nothing kept of how this person plays: this is their first game against the engine.
  prefs: { relayUrl: RELAY, playerName: 'Robin', reduceMotion: true },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
// Service workers blocked, as in every spec that routes *.scryfall.io: the built app's own
// fetches Scryfall's images past page.route, and the stand-in's faces are Scryfall's links.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
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
const clean = async () => axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false))
const kept = () => page.evaluate(() => {
  const prefs = JSON.parse(localStorage.getItem('mtg-companion:v1') ?? '{}').prefs ?? {}
  return { pace: prefs.tablePace ?? null, taught: prefs.tableTaught ?? null }
})
const shoot = async (name, target = page) => { const path = SHOT(name); await target.screenshot({ path }); shots.push(path) }
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

console.log('\nAsked once, on the table')
const playEngine = page.getByRole('button', { name: 'Play the engine' })
check('the lobby offers the engine when the relay has one', await until(() => playEngine.count().then((n) => n === 1)))
await playEngine.click()
check('opening a table the engine holds changes the address', await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash))), page.url())
const code = await page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
check('the lobby of that table says the engine never stops the person where they have nothing to do, as Fast, the default, does',
  await until(() => page.locator('.lobby__seats').textContent().then((t) => /the engine never stops you where you have nothing to do\./.test(t ?? ''))),
  await page.locator('.lobby__seats').textContent())
await page.getByRole('button', { name: /^Goblins/ }).first().click()
await page.getByRole('button', { name: /Sit down with Goblins/ }).click()
const panel = page.getByRole('region', { name: 'How do you want to play?' })
check('sitting down is not held up: the table opens, and the question is on it', await until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000) && await panel.isVisible())
check('the question is beside the table, in the column the log is in, not in the battlefield\'s box nor a dialog in front of it',
  await page.locator('.game__side > .pacechoice').count() === 1 && await page.locator('.game__field .pacechoice').count() === 0 && await page.getByRole('dialog').count() === 0)
check('and narrow there, each preset its name and tagline, what it does opened with Advanced',
  await panel.locator('.pacechoice__preset').first().locator('.pacechoice__line').isHidden() && await panel.locator('.pacechoice__tag').first().isVisible())
const preset = (name) => panel.getByRole('radio', { name: new RegExp(`^${name}`) })
check('three presets, as radios a keyboard and a screen reader can use', await panel.getByRole('radio').count() === 3)
check('each named by the preset and its tagline alone, what it does being its description',
  await panel.getByRole('radio', { name: 'Controlled See every window', exact: true }).count() === 1
  && (await panel.getByRole('radio', { name: 'Controlled See every window', exact: true }).evaluate((r) => r.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id).textContent).join(' '))) === `${PRESET_LINES.controlled} More passing`)
// The owner's choice since 2026-09-26 (HANDOFF.md §3 item 24): Fast, where it had been Controlled.
check('Fast is chosen, the owner\'s choice, and the other two are not', await preset('Fast').isChecked() && !(await preset('Controlled').isChecked()) && !(await preset('Learning').isChecked()))
const panelText = (await panel.textContent()) ?? ''
check('each preset says what it does, in the app\'s own words', Object.values(PRESET_LINES).every((line) => panelText.includes(line)), panelText)
check('and the question says it is asked once, and where it can be changed later', /Asked once\. Fast is chosen until you pick another, and any of this can be changed later from the table’s More button \(…\), under “How you play”\./.test(panelText), panelText)
check('nothing is kept until the person answers', (await kept()).pace === null)
const engine = () => relayServer.rooms.get(code)?.engine?.engine
check('Fast is in force from the sit: the engine was dealt this person passed for where nothing is affordable',
  await until(async () => (await engine()?.call('lastNew'))?.request?.players?.[0]?.autoPass === true), JSON.stringify((await engine()?.call('lastNew'))?.request?.players?.map((p) => p.autoPass)))
const advanced = panel.getByRole('button', { name: 'Advanced' })
check('the settings each preset sets are behind a disclosure, closed', await advanced.getAttribute('aria-expanded') === 'false' && !(await panel.locator('.pacechoice__advanced').isVisible()))
check('the table with the question has no accessibility violations', await clean())
await shoot('asked-1280')

console.log('\nControlled, a tap away over the opening hand: a window with nothing in it is a stop')
const prompt = page.locator('.prompt')
const keep = prompt.getByRole('button', { name: /^Keep this hand/ })
check('the opening hand is asked first, beside the question', await until(() => keep.count().then((n) => n === 1)))
check('with one primary button on screen, the hand\'s Keep: the question\'s own steps back while the hand waits',
  await page.locator('.game .btn--primary').count() === 1 && /^Keep this hand/.test(await page.locator('.game .btn--primary').textContent())
  && /btn--ghost/.test(await panel.getByRole('button', { name: /^Play / }).getAttribute('class')),
  await page.locator('.game .btn--primary').allTextContents().then((t) => t.join(' | ')))
const log = page.locator('.gamelog')
check('the log says where the game stops for this person as dealt, Fast\'s, once',
  await until(() => log.textContent().then((t) => (t ?? '').split('The game stops for you only where you can play; the engine passes every other window for you, and says how many.').length === 2)), await log.textContent())
// Controlled, one tap away in the same question, taken before the hand is kept.
await preset('Controlled').check()
check('a tap chooses Controlled, kept at once, the question not yet answered',
  await until(async () => (await kept()).pace?.preset === 'controlled' && (await kept()).pace?.asked === false), JSON.stringify(await kept()))
check('the engine is asked to stop this person at every window, once',
  await until(async () => (await engine().call('lastStops')).stopsAsked === 1) && (await engine().call('lastStops')).request.autoPass === false)
check('and the log says so, once the engine has: from the next window',
  await until(() => log.textContent().then((t) => (t ?? '').split('From the next window, the game stops for you at every priority window, both turns.').length === 2)), await log.textContent())
// Where the tabletop stands in the table, with the question and, below, without it.
const tabletopTop = () => page.evaluate(() => document.querySelector('.game__table').getBoundingClientRect().top - document.querySelector('.game').getBoundingClientRect().top)
const tabletopAsked = await tabletopTop()
await keep.click()
const title = () => prompt.locator('.prompt__title').textContent().catch(() => null)
check('then the table stops at the upkeep, with nothing to do but pass', await until(async () => (await title()) === 'Upkeep') && /Nothing to do here but pass\./.test(await prompt.textContent() ?? ''), await prompt.textContent())

console.log('\nLearning, chosen from the keyboard')
await preset('Controlled').focus()
await page.keyboard.press('ArrowRight')
check('an arrow key moves the choice to Learning, as radios do', await until(() => preset('Learning').isChecked()))
check('the choice is kept at once, the question not yet answered', await until(async () => (await kept()).pace?.preset === 'learning' && (await kept()).pace?.asked === false), JSON.stringify(await kept()))
check('and the room takes Learning\'s speed, Relaxed, at twice its own pace', await until(async () => { const r = await peek(code); return r.speed === 'relaxed' && r.pace === BASE_PACE * 2 }), JSON.stringify(await peek(code)))
const upkeepTaught = teachingFor('upkeep')
check('this stop now says what its step is for, in the turn\'s own reference: in the prompt, beside the turn panel, the head and where the rest is',
  await until(() => prompt.locator('.prompt__teach').textContent().then((t) => t === `${teachingHead(upkeepTaught)} ${teachingBody(upkeepTaught, { beside: true })}`).catch(() => false)),
  await prompt.locator('.prompt__teach').textContent().catch(() => 'no teaching'))
check('and the turn panel beside it says what happens in the step, with its rule, so it is not said twice',
  (await page.locator('.turns__does').textContent()).includes('(503.1a)') && !(await prompt.textContent()).includes('(503.1a)'))
await advanced.focus()
await page.keyboard.press('Enter')
const settings = panel.locator('.pacechoice__advanced')
check('Enter opens Advanced, and it says it is open', await advanced.getAttribute('aria-expanded') === 'true' && await settings.isVisible())
const onIn = (legend) => settings.getByRole('group', { name: legend }).locator('input:checked').evaluate((r) => r.closest('label').textContent)
check('and it shows what Learning sets: every window, Relaxed, steps explained the first three times',
  /^At every window/.test(await onIn('Where the game stops for you')) && /^Relaxed/.test(await onIn('How long each of the engine’s plays stands')) && /^The first three times/.test(await onIn('What each step is for')))
check('and the wait Relaxed makes at this table, as the room says it', /Here: 80 ms\./.test(await settings.textContent() ?? ''), await settings.textContent())
check('and what no preset can set here: paying mana is the engine\'s', (await settings.textContent() ?? '').includes(PAYING_LINE))
check('and what every window cannot mean here: nobody is given one with a spell on the stack', (await settings.textContent() ?? '').includes(STACK_LINE))
check('nothing in the question moves, opened or closed', await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.pacechoice')).length === 0)
  && await panel.locator('.pacechoice__preset').first().evaluate((el) => ['0s', ''].includes(getComputedStyle(el).transitionDuration.split(',')[0].trim())))
check('opened, it has no accessibility violations', await clean())
await shoot('advanced-1280')
await page.setViewportSize({ width: 390, height: 844 })
await panel.scrollIntoViewIfNeeded()
check('at a phone\'s width, where the log is under the table, the question is first thing on the table instead',
  await until(() => page.locator('.game > .game__ask > .pacechoice').count().then((n) => n === 1)) && await page.locator('.game__side .pacechoice').count() === 0)
check('at a phone\'s width it fits without scrolling sideways', await fits(), await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`))
check('and has no accessibility violations there either', await clean())
await shoot('asked-390')
await page.setViewportSize({ width: 1280, height: 900 })
const play = panel.getByRole('button', { name: 'Play Learning →' })
check('the button names what it plays', await play.count() === 1)
await play.focus()
await page.keyboard.press('Enter')
check('pressed, the question is answered and goes', await until(() => panel.count().then((n) => n === 0)) && (await kept()).pace?.asked === true, JSON.stringify(await kept()))
check('and focus goes where the game is, the prompt\'s pass, rather than to nothing',
  await until(() => page.evaluate(() => Boolean(document.activeElement?.closest('.prompt')) && /^Pass/.test(document.activeElement?.textContent ?? ''))),
  await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)))
const tabletopAnswered = await tabletopTop()
check('and the tabletop, with the prompt at its foot, is where it was while the question stood beside it',
  Math.abs(tabletopAnswered - tabletopAsked) <= 1, `${tabletopAsked} then ${tabletopAnswered}`)

console.log('\nLearning, at the table')
check('the teaching stays with the stop it was said at', await prompt.locator('.prompt__teach').count() === 1)
await page.keyboard.press('Space')
check('Space passes, and the next window is a stop too: beginning of combat', await until(async () => (await title()) === 'Beginning of combat'))
check('which says what it is for, the first time it is met', await until(() => prompt.locator('.prompt__teach').textContent().then((t) => /^Combat phase · Beginning of combat \(507\.\)/.test(t ?? '')).catch(() => false)))
await shoot('teach-1280')
await page.setViewportSize({ width: 390, height: 844 })
await prompt.scrollIntoViewIfNeeded()
const underField = page.locator('.game__field > .game__teach')
const combatTaught = teachingFor('beginCombat')
check('at a phone\'s width, the turn panel far below, the teaching is said whole under the battlefield, and not in the prompt on it',
  await until(() => underField.textContent().then((t) => t === `${teachingHead(combatTaught)} ${teachingBody(combatTaught)}`).catch(() => false))
  && await prompt.locator('.teaching').count() === 0,
  await underField.textContent().catch(() => 'none'))
check('and says nothing of a multiplayer game, which a table of two is not', await underField.textContent({ timeout: 2000 }).then((t) => !/multiplayer|507\.1/.test(t), () => false))
check('the prompt and its teaching fit a phone\'s width', await fits())
check('and has no accessibility violations there', await clean())
await shoot('teach-390')
await page.setViewportSize({ width: 1280, height: 900 })
await prompt.getByRole('button', { name: /^Pass/ }).click()
check('then the stop the run made, an attack, explained too', await until(() => prompt.getByRole('button', { name: 'No attack' }).count().then((n) => n === 1)) && /^Combat phase · Declare attackers \(508\.\)/.test(await prompt.locator('.prompt__teach').textContent().catch(() => '') ?? ''))
check('each step counted once, kept with the player', JSON.stringify((await kept()).taught?.times) === JSON.stringify({ upkeep: 1, beginCombat: 1, attackers: 1 }), JSON.stringify((await kept()).taught))
check('and no window was passed for the person on the way', !/passed \d+ priority window/.test(await log.textContent() ?? ''))

console.log('\nRemembered, and not asked again')
await page.reload({ waitUntil: 'networkidle' })
check('after a reload the table is back', await until(() => prompt.getByRole('button', { name: 'No attack' }).count().then((n) => n === 1), 20_000))
check('and the question is not asked again', await page.getByRole('region', { name: 'How do you want to play?' }).count() === 0)
check('the stop\'s teaching is said again, and not counted twice', /^Combat phase · Declare attackers/.test(await prompt.locator('.prompt__teach').textContent().catch(() => '') ?? '') && (await kept()).taught?.times?.attackers === 1, JSON.stringify((await kept()).taught))
// On a phone the teaching grew the prompt, half the field wide, over the creatures a
// person taps to attack with, so the one way on was not to attack (found in review).
await page.setViewportSize({ width: 390, height: 844 })
check('at a phone\'s width the attack\'s teaching is showing, under the battlefield', await until(() => underField.textContent().then((t) => /^Combat phase · Declare attackers \(508\.\)/.test(t ?? '')).catch(() => false)))
// The creature the engine says may attack, which glows as one.
const attackerId = await page.locator('.game__table .field__slot .bcard--target').first().evaluate((el) => el.closest('[data-id]').dataset.id)
const attacker = page.locator(`.game__table .field__slot[data-id="${attackerId}"] .bcard`)
await attacker.scrollIntoViewIfNeeded()
const tapped = await attacker.click({ timeout: 3000 }).then(() => true, (e) => (console.log(`        ${e.message.split('\n')[0]}`), false))
check('and a tap on the creature that may attack reaches it, the prompt covering nothing: "Attack with 1 →"',
  tapped && await until(() => prompt.getByRole('button', { name: 'Attack with 1 →' }).count().then((n) => n === 1)))
await shoot('attack-390')
// Let go again, so the attack is not declared by what follows.
if (tapped) await attacker.click({ timeout: 3000 }).catch(() => {})
check('and a second tap lets it go', tapped && await until(() => prompt.getByRole('button', { name: 'Attack with 0 →' }).count().then((n) => n === 1)))
await page.setViewportSize({ width: 1280, height: 900 })
await page.getByRole('button', { name: 'More', exact: true }).click()
const mine = page.getByRole('region', { name: 'How you play' })
check('the table\'s own settings hold the choice, as it was made', await until(() => mine.count().then((n) => n === 1)) && await mine.getByRole('radio', { name: /^Learning/ }).isChecked())
check('the room says it is still Relaxed after the sit again', (await peek(code)).speed === 'relaxed')
check('the settings have no accessibility violations', await clean())
await shoot('settings-1280', page)

console.log('\nChanged later, from the table: Fast')
await mine.getByRole('radio', { name: /^Fast/ }).check()
check('Fast is chosen and kept', await until(async () => (await kept()).pace?.preset === 'fast'))
// The second change the engine is asked for: the first was Controlled, over the opening hand.
check('the engine was asked to pass for this person from the next window, once', await until(async () => (await engine().call('lastStops')).stopsAsked === 2) && (await engine().call('lastStops')).request.autoPass === true)
check('the log says so, once the engine has', await until(() => log.textContent().then((t) => (t ?? '').includes('From the next window, the game stops for you only where you can play.'))), await log.textContent())
check('and the room is back at its own pace, Brisk', await until(async () => { const r = await peek(code); return r.speed === 'brisk' && r.pace === BASE_PACE }), JSON.stringify(await peek(code)))
await page.setViewportSize({ width: 390, height: 844 })
await mine.scrollIntoViewIfNeeded()
check('the settings fit a phone\'s width', await fits())
check('and have no accessibility violations there', await clean())
await shoot('settings-390')
await page.setViewportSize({ width: 1280, height: 900 })
const turnBefore = (await engine().call('turn')).turn
await prompt.getByRole('button', { name: 'No attack' }).click()
check('the log says the window before the next stop was passed for the person, not asked', await until(() => log.textContent().then((t) => /The engine passed 1 priority window for you: nothing was affordable\./.test(t ?? ''))), await log.textContent())
check('and the next stop is the attack, turns later, with no window in between',
  (await engine().call('turn')).turn > turnBefore && (await engine().call('tally')).windows === 0 && await until(() => prompt.getByRole('button', { name: 'No attack' }).count().then((n) => n === 1)))
check('and no step is explained any more', await prompt.locator('.prompt__teach').count() === 0)
await shoot('fast-1280')

console.log('\nA first sit on a phone, from a scrolled lobby')
// The question asked again, of somebody sitting at the engine's table for the first time:
// on a phone they scroll down the shelf to Sit, and the table opens in the same screen.
await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  delete state.prefs.tablePace
  delete state.prefs.tableTaught
  localStorage.setItem('mtg-companion:v1', JSON.stringify(state))
})
await page.setViewportSize({ width: 390, height: 844 })
await page.reload({ waitUntil: 'networkidle' })
const playAgain = page.getByRole('button', { name: 'Play the engine' })
check('the lobby offers the engine again', await until(() => playAgain.count().then((n) => n === 1)))
await playAgain.click()
check('a new table the engine holds', await until(() => page.evaluate((was) => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash) && !location.hash.endsWith(was), code)))
await page.getByRole('button', { name: /^Goblins/ }).first().click()
const sit = page.getByRole('button', { name: /Sit down with Goblins/ })
await sit.scrollIntoViewIfNeeded()
const lobbyScroll = await page.evaluate(() => document.querySelector('.app__main').scrollTop)
check('the lobby is scrolled down to its Sit button', lobbyScroll > 100, String(lobbyScroll))
await sit.click()
const asked = page.getByRole('region', { name: 'How do you want to play?' })
/** Whether an element is wholly inside the screen the table scrolls in. */
const inView = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect()
  const main = document.querySelector('.app__main').getBoundingClientRect()
  return r.width > 0 && r.top >= main.top - 1 && r.bottom <= Math.min(main.bottom, window.innerHeight) + 1
})
check('the table opens with the question in view, its title and its three presets, not above the top of the screen',
  await until(async () => (await asked.count()) === 1 && await inView(asked.getByRole('heading', { name: 'How do you want to play?' }))
    && (await Promise.all((await asked.locator('.pacechoice__preset').all()).map(inView))).every(Boolean), 20_000),
  await page.evaluate(() => `scrollTop ${document.querySelector('.app__main').scrollTop}, title at ${document.querySelector('.pacechoice__title')?.getBoundingClientRect().top}`))
const keepFirst = page.locator('.prompt').getByRole('button', { name: /^Keep this hand/ })
check('the opening hand is asked beside it', await until(() => keepFirst.count().then((n) => n === 1), 20_000))
/** The prompt, drawn and clear of every button of the question's. */
const promptClear = () => page.evaluate(() => {
  const p = document.querySelector('.prompt')?.getBoundingClientRect()
  const hit = (b) => b.left < p.right && p.left < b.right && b.top < p.bottom && p.top < b.bottom
  return Boolean(p) && ![...document.querySelectorAll('.pacechoice button')].map((b) => b.getBoundingClientRect()).some(hit)
})
check('and the prompt keeps to the tabletop, clear of the question\'s buttons', await promptClear())
await shoot('first-390')
await page.setViewportSize({ width: 360, height: 780 })
check('at 360 too, where the prompt once rose over Advanced and Play', await until(promptClear))
check('and nothing scrolls sideways there', await fits())
await shoot('first-360')
await page.setViewportSize({ width: 390, height: 844 })
await asked.getByRole('button', { name: 'Play Fast →' }).focus()
await page.keyboard.press('Enter')
check('answered from the keyboard over the opening hand, focus goes to Keep this hand, not Mulligan',
  await until(() => page.evaluate(() => Boolean(document.activeElement?.closest('.prompt')) && /^Keep this hand/.test(document.activeElement?.textContent ?? ''))),
  await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)))
await page.keyboard.press('Enter')
// Fast, kept: the empty windows before it passed, the next stop is the attack.
check('so the next Enter keeps the hand, and takes no mulligan', await until(async () => (await title()) === 'Your attack'), await prompt.textContent().catch(() => 'no prompt'))
await page.setViewportSize({ width: 1280, height: 900 })

check('no uncaught errors', errors.length === 0, errors.join('; '))

console.log(`\nPictures: ${shots.join(', ')}`)
await browser.close()
await relayServer.shutdown()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
