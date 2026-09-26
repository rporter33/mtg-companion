#!/usr/bin/env node
/**
 * What the engine's seat plays, chosen in the lobby (HANDOFF.md, M5, and the
 * owner's answer of 2026-09-25).
 *
 * The choice is the lobby's and the deck is the room's, so this drives both
 * through the app itself: three choices beside the engine's seat — a copy of
 * yours, one of your decks, a deck of its own — a copy until the player
 * chooses; a deck of its own built from the sets the player's deck uses until
 * the switch says the whole format; the app's own words for each, and the
 * sets named; a deck the engine does not know not offered; a Commander table
 * saying it cannot; nothing axe can find wrong at either width; the choice
 * remembered across a reload; and each choice travelling with the sit to the
 * engine and coming back into the log and the seat list, fallback and all.
 *
 * The relay runs here with the scripted stand-in for the engine
 * (tests/fixtures/fake-engine.mjs), so this runs on any machine and in CI,
 * where there is no JVM; tests/engine-live.test.js holds the real engine's
 * decks to the app's own validator.
 *
 *   node tests/browser/engine-deck.spec.mjs http://localhost:4173/
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
const SHOT = (name) => join(tmpdir(), `engine-deck-${name}.png`)
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

// No pace: the stand-in plays no turn of its own worth waiting on.
const relayServer = createRelay({ engineCommand: FAKE_ENGINE, pingMs: 60_000, pace: 0 })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const RELAY = `http://127.0.0.1:${relayServer.server.address().port}`
const peek = async (code) => (await fetch(`${RELAY}/rooms/${code}`)).json()

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{R}', cmc: 1, type_line,
  oracle_text: '', color_identity: ['R'], colors: ['R'], rarity: 'common', set: 'por',
  set_name: 'Portal', collector_number: '1', legalities: { standard: 'legal', commander: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
const FDN = { set: 'fdn', set_name: 'Foundations', color_identity: ['G'], colors: ['G'], mana_cost: '{G}' }
const CARDS = [
  c('mountain', 'Mountain', 'Basic Land — Mountain', { mana_cost: '', cmc: 0, produced_mana: ['R'], collector_number: '208' }),
  c('goblin', 'Raging Goblin', 'Creature — Goblin Berserker', { power: '1', toughness: '1', oracle_text: 'Haste', collector_number: '145' }),
  c('forest', 'Forest', 'Basic Land — Forest', { ...FDN, mana_cost: '', cmc: 0, produced_mana: ['G'], collector_number: '278' }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid', { ...FDN, power: '1', toughness: '1', oracle_text: '{T}: Add {G}.', collector_number: '227' }),
  // A card the stand-in does not know (its rule: a name beginning "Made-Up").
  c('madeup', 'Made-Up Thing', 'Creature — Construct', { power: '2', toughness: '2', collector_number: '9' }),
  c('boss', 'Goblin King', 'Legendary Creature — Goblin', { power: '2', toughness: '2', collector_number: '10' }),
]
const deckOf = (id, name, formatId, main, commanders = []) => ({
  id, name, formatId, commanders, signatureSpell: null, categoryOrder: [], versions: [],
  main, sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})
const STATE = {
  version: 4, collection: {}, games: [],
  decks: [
    deckOf('d1', 'Goblins', 'standard', [{ cardId: 'mountain', quantity: 20 }, { cardId: 'goblin', quantity: 20 }]),
    deckOf('d2', 'Elves', 'standard', [{ cardId: 'forest', quantity: 20 }, { cardId: 'elf', quantity: 20 }]),
    deckOf('d3', 'Mystery', 'standard', [{ cardId: 'mountain', quantity: 20 }, { cardId: 'madeup', quantity: 20 }]),
    deckOf('d4', 'Goblin Court', 'commander', [{ cardId: 'mountain', quantity: 60 }, { cardId: 'goblin', quantity: 39 }], ['boss']),
  ],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  // Nothing kept about the engine's deck: this is somebody's first game against it.
  prefs: { relayUrl: RELAY, playerName: 'Robin', reduceMotion: true },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
// Service workers blocked, as in game-engine.spec.mjs: the built app's own
// fetches every *.scryfall.io image past page.route, so the stand-in engine's
// card faces (real Scryfall links) would not be the pixel routed below.
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
const axeClean = async () => axeViolations().then((v) => v.length === 0 || (console.log(v.join('\n')), false))
const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem('mtg-companion:v1') ?? '{}').prefs?.engineOpponent ?? null)
const seats = page.locator('.lobby__seats')
const seatsText = () => seats.textContent().then((t) => t ?? '')
const group = page.getByRole('group', { name: 'The engine\'s deck' })
const radio = (name) => group.getByRole('radio', { name: new RegExp(`^${name}`) })
const poolSwitch = group.getByRole('switch')

/** Opens a table the engine holds from the lobby, and returns its code. */
const openTable = async () => {
  await page.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
  const play = page.getByRole('button', { name: 'Play the engine' })
  await until(() => play.count().then((n) => n === 1))
  await play.click()
  await until(() => page.evaluate(() => /#\/game\/engine\/[A-Z0-9]{5}$/.test(location.hash)))
  return page.evaluate(() => location.hash.match(/engine\/([A-Z0-9]{5})/)?.[1])
}
/** Sits down at the open table with a deck from the Standard shelf, and waits for the table. */
const sitWith = async (name) => {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click()
  await page.getByRole('button', { name: new RegExp(`Sit down with ${name}`) }).click()
  return until(() => page.locator('.game:not(.game--loading)').count().then((n) => n === 1), 20_000)
}
const logText = () => page.locator('.gamelog').textContent().then((t) => t ?? '')
const sentBot = async (code) => (await relayServer.rooms.get(code).engine.engine.call('lastNew')).request.players[1]

console.log('\nThe choice, in the lobby')
let code = await openTable()
check('beside the engine\'s seat, the lobby asks what the engine plays', await until(() => group.count().then((n) => n === 1)))
check('it offers three, as radios a keyboard and a screen reader can use', await group.getByRole('radio').count() === 3)
check('a first game is a copy of the player\'s deck, as every table before', await radio('A copy of yours').isChecked() && !(await radio('One of your decks').isChecked()) && !(await radio('A deck of its own').isChecked()))
check('and nothing is kept until the player chooses', (await kept()) === null)
check('the seat list says the engine plays a copy of the player\'s deck', /The engine, with a copy of your deck/.test(await seatsText()), await seatsText())
const groupText = (await group.textContent()) ?? ''
check('each choice has a line saying what it does, and who builds a deck of its own', ['It plays the deck you sit down with, card for card.', 'It plays another deck from your shelf, chosen below.', "Built afresh for each game by Argentum's own deck builder."].every((l) => groupText.includes(l)), groupText)

// The shelf opens on Commander, the first of the front tabs with a deck. Since
// M6 the engine builds a Commander deck of its own, commander and all, so the
// switch is there as it is for Standard, and the lobby says the game a Commander
// deck is dealt as, each rule by its number.
await radio('A deck of its own').check()
check('at a Commander table, a deck of its own comes with the switch for its pool, as in Standard (M6)',
  await until(() => poolSwitch.count().then((n) => n === 1)) && /From the whole of Commander/.test(await group.textContent()), await group.textContent())
check('and the lobby says a Commander deck is dealt as a Commander game, citing the rules',
  /A Commander deck is dealt as a Commander game, by Argentum's own Commander rules: 40 life each \(903\.7\)/.test(await seatsText()), await seatsText())
check('the lobby saying so has no accessibility violations', await axeClean())
// Since §3 item 20 Brawl is a Commander game of its own, and the engine builds a
// Brawl deck of its own for one; Duel Commander is a Commander game too, and the
// engine builds none, Argentum having no Duel Commander card pool; Oathbreaker is
// dealt as the family was before M6. Each says so.
await page.getByRole('button', { name: /More/ }).click()
await page.getByRole('button', { name: /^Brawl/ }).click()
check('a Brawl table offers a deck of its own with the switch for its pool, and says what a Brawl deck is dealt as, each rule by its number (§3 item 20)',
  await until(() => poolSwitch.count().then((n) => n === 1)) && /From the whole of Brawl/.test(await group.textContent())
  && (await seatsText()).includes("A Brawl deck is dealt as a Commander game for two, by Argentum's own Commander rules at Brawl's numbers: 25 life each (903.12f)")
  && (await seatsText()).includes("Brawl's first mulligan is free (903.12g), and not here"),
  await seatsText())
check('and the seat list says the engine brings a deck of its own', (await seatsText()).includes('The engine, with a deck of its own'), await seatsText())
check('the Brawl lobby has no accessibility violations', await axeClean())
await page.getByRole('button', { name: /^Duel Commander/ }).click()
check('a Duel Commander table says the engine builds no Duel Commander deck of its own, and why, and what a Duel Commander deck is dealt as',
  await until(() => group.textContent().then((t) => (t ?? '').includes('The engine builds no Duel Commander deck of its own, as Argentum has no Duel Commander card pool to build one from, so with a Duel Commander deck it plays a copy of yours.'))) && (await poolSwitch.count()) === 0
  && (await seatsText()).includes('20 life each (Duel Commander rules, 300.1a)'),
  await seatsText())
// Found in M6's review: the seat list said "a deck of its own" here, the choice as made, where the sit sends a copy.
check('and the seat list says the copy the sit will send, and why, not the choice as made',
  (await seatsText()).includes('The engine, with a copy of your deck: it builds no Duel Commander deck of its own') && !/The engine, with a deck of its own/.test(await seatsText()), await seatsText())
check('the lobby saying so has no accessibility violations', await axeClean())
await page.getByRole('button', { name: /^Oathbreaker/ }).click()
check('an Oathbreaker table says it is dealt by the ordinary rules, as the family was before M6',
  await until(() => seatsText().then((t) => t.includes('The engine deals Commander, Duel Commander and Brawl as Commander games, and not Oathbreaker, so an Oathbreaker deck is played by the ordinary rules: 20 life, and its oathbreaker and its signature spell are not dealt.'))),
  await seatsText())

await page.getByRole('button', { name: /^Standard/ }).click()
await page.getByRole('button', { name: /^Goblins/ }).first().click()
check('in Standard, a deck of its own comes with one switch, for its card pool', await until(() => poolSwitch.count().then((n) => n === 1)))
check('off to begin with: only the sets the player\'s deck uses, the owner\'s fair fight', !(await poolSwitch.isChecked()) && await poolSwitch.getAttribute('aria-checked') === 'false')
check('and the sets are named, from the deck chosen on the shelf', await until(() => group.textContent().then((t) => (t ?? '').includes('Off: it builds only from the sets your deck uses, for a fair fight. Goblins uses Portal.'))), await group.textContent())
check('the switch is named for what turning it on does', (await poolSwitch.getAttribute('aria-describedby')) === 'engine-pool-line' && /From the whole of Standard/.test(await group.locator('label', { has: page.getByRole('switch') }).textContent()))
check('the choice is kept with the player\'s other table preferences', JSON.stringify(await kept()) === JSON.stringify({ kind: 'own', deckId: null, pool: 'sets' }), JSON.stringify(await kept()))
check('the seat list says the engine brings a deck of its own', /The engine, with a deck of its own/.test(await seatsText()), await seatsText())
check('the lobby with a deck of its own chosen has no accessibility violations', await axeClean())
await seats.screenshot({ path: SHOT('own') })

await poolSwitch.focus()
await page.keyboard.press('Space')
check('Space turns the switch on, and it says so in words and to a screen reader', await poolSwitch.isChecked() && await poolSwitch.getAttribute('aria-checked') === 'true' && (await group.textContent()).includes('On: it builds from every Standard card the engine knows.'))
check('and that is kept too', (await kept())?.pool === 'format')
await page.keyboard.press('Space')
check('and off again', !(await poolSwitch.isChecked()) && (await kept())?.pool === 'sets')

await radio('One of your decks').check()
const which = group.getByRole('combobox', { name: 'Which of your Standard decks' })
check('one of your decks is picked from this shelf, by name', await which.count() === 1)
check('none is picked to begin with, and until one is the lobby says the engine plays a copy', (await which.inputValue()) === '' && (await group.textContent()).includes('Until you choose one, the engine plays a copy of yours.') && /with a copy of your deck/.test(await seatsText()))
const mystery = which.locator('option', { hasText: 'Mystery' })
check('a deck the engine does not wholly know is listed but cannot be picked, and says why', await until(() => mystery.evaluate((el) => el.disabled).catch(() => false)) && /the engine does not know every card/.test(await mystery.textContent()), await mystery.textContent())
await which.selectOption('d2')
check('picked, the seat list names it', await until(() => seatsText().then((t) => /The engine, with your deck Elves/.test(t))), await seatsText())
check('the lobby with a deck picked has no accessibility violations', await axeClean())

await radio('One of your decks').focus()
await page.keyboard.press('ArrowUp')
check('the arrow keys move between the choices, as radios do', await radio('A copy of yours').isChecked())
await page.keyboard.press('ArrowDown')
check('and back, the deck picked still picked', await radio('One of your decks').isChecked() && (await which.inputValue()) === 'd2')

await page.reload({ waitUntil: 'networkidle' })
check('a reload remembers the choice and the deck', await until(() => radio('One of your decks').isChecked().catch(() => false)) && JSON.stringify(await kept()) === JSON.stringify({ kind: 'deck', deckId: 'd2', pool: 'sets' }))

// A deck remembered for the engine that the engine does not wholly know — kept
// by an earlier visit, before a card of it was found unknown — is sent as the
// copy, and the seat list says so, with why (found in M6's review).
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('mtg-companion:v1'))
  state.prefs.engineOpponent = { kind: 'deck', deckId: 'd3', pool: 'sets' }
  localStorage.setItem('mtg-companion:v1', JSON.stringify(state))
})
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: /^Standard/ }).click()
check('a remembered deck the engine does not wholly know is said as the copy the sit will send, and why',
  await until(() => seatsText().then((t) => t.includes('The engine, with a copy of your deck: it does not know every card in Mystery'))), await seatsText())
await which.selectOption('d2')
check('and picking one it knows says that one again', await until(() => seatsText().then((t) => /The engine, with your deck Elves/.test(t))), await seatsText())

console.log('\nAt a phone\'s width')
await page.getByRole('button', { name: /^Standard/ }).click()
await page.setViewportSize({ width: 390, height: 844 })
await group.scrollIntoViewIfNeeded()
check('the choice fits without scrolling sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`))
check('and has no accessibility violations there either', await axeClean())
await page.setViewportSize({ width: 1280, height: 900 })

console.log('\nOne of your decks, to the engine and back')
await page.getByRole('button', { name: /^Standard/ }).click()
check('the table opens', await sitWith('Goblins'))
let bot = await sentBot(code)
check('the engine was dealt that deck by the names the lobby checked, and the player theirs', JSON.stringify(bot.deck) === JSON.stringify({ Forest: { count: 20, set: 'fdn', number: '278' }, 'Llanowar Elves': { count: 20, set: 'fdn', number: '227' } }), JSON.stringify(bot))
check('the log says once which deck the engine plays', await until(() => logText().then((t) => t.split('The engine plays your deck Elves.').length === 2)), await logText())
await page.goto(`${TARGET}#/game/engine/${code}`, { waitUntil: 'networkidle' })
check('back in that table\'s lobby, the seat list says what the room dealt, and the choice is not offered again',
  await until(() => seatsText().then((t) => /The engine, with your deck Elves/.test(t))) && (await group.count()) === 0, await seatsText())

console.log('\nA deck of its own, to the engine and back')
code = await openTable()
await until(() => group.count().then((n) => n === 1))
await page.getByRole('button', { name: /^Standard/ }).click()
await radio('A deck of its own').check()
check('the table opens', await sitWith('Goblins'))
bot = await sentBot(code)
check('the engine was asked for a deck of its own, to Standard, from the sets Goblins uses', bot.deck === 'own' && bot.format === 'standard' && JSON.stringify(bot.sets) === '["por"]', JSON.stringify(bot))
const built = "The engine plays a deck of its own, built by Argentum's deck builder: red-green, from Portal."
check('the log names its colours and where it was built from, once', await until(() => logText().then((t) => t.split(built).length === 2)), await logText())
await page.screenshot({ path: SHOT('table') })
check('the table saying so has no accessibility violations', await axeClean())
await page.goto(`${TARGET}#/game/engine/${code}`, { waitUntil: 'networkidle' })
check('and the seat list says it, the brief\'s own shape', await until(() => seatsText().then((t) => /The engine, with a deck of its own: red-green from Portal/.test(t))), await seatsText())
check('the room reports it the same way to anybody who looks', await peek(code).then((r) => r.engineDeck?.played === 'own' && r.engineDeck?.sets?.[0]?.name === 'Portal' && !('deck' in r.engineDeck)), JSON.stringify((await peek(code)).engineDeck))

console.log('\nA fallback, said')
code = await openTable()
await until(() => group.count().then((n) => n === 1))
await page.getByRole('button', { name: /^Standard/ }).click()
await radio('A deck of its own').check()
// Elves is from Foundations, which the stand-in has not got: none of the sets asked.
check('the table opens', await sitWith('Elves'))
const fellBack = 'The engine has none of the sets your deck uses, so it built its deck from the whole of Standard instead: black-green.'
check('the log says the engine built from the whole format instead, and why', await until(() => logText().then((t) => t.split(fellBack).length === 2)), await logText())
await page.goto(`${TARGET}#/game/engine/${code}`, { waitUntil: 'networkidle' })
check('and the lobby says it beside the seat', await until(() => seatsText().then((t) => t.includes(fellBack) && /mono|black-green from the whole of Standard/.test(t))), await seatsText())
check('the lobby saying so has no accessibility violations', await axeClean())
await seats.screenshot({ path: SHOT('fallback') })

check('no uncaught errors', errors.length === 0, errors.join('; '))

console.log(`\nPictures: ${SHOT('own')}, ${SHOT('table')}, ${SHOT('fallback')}`)
await browser.close()
await relayServer.shutdown()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
