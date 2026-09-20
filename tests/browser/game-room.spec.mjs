#!/usr/bin/env node
/**
 * Two people at the rebuilt table, through the app itself.
 *
 * relay.spec.mjs proves the wire with the protocol driven by hand; this
 * proves the screens on top of it: one person opens a room from the lobby
 * and gets a link, the other opens the link, both sit down with a deck, and
 * what one does the other sees — across the table, mirrored. Then the
 * things that go wrong in real life: a socket cut under one of them, and a
 * reload, both of which have to land back in the same seat with the same
 * table.
 *
 * Two browser contexts, not two pages: each has its own storage, so they
 * are two devices as far as the app can tell. The relay runs in this
 * process on port 0 and the app is the built one on the preview server.
 *
 *   node tests/browser/game-room.spec.mjs http://localhost:4173/
 */
import { chromium } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelay } from '../../scripts/relay-server.mjs'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (test, ms = 5000) => {
  const start = Date.now()
  while (!(await test())) {
    if (Date.now() - start > ms) return false
    await sleep(100)
  }
  return true
}

const dir = mkdtempSync(join(tmpdir(), 'game-room-'))
const relayServer = createRelay({ roomsDir: dir, pingMs: 300 })
await new Promise((resolve) => relayServer.server.listen(0, resolve))
const RELAY = `http://127.0.0.1:${relayServer.server.address().port}`

const deck = (id, name, formatId, extra = {}) => ({
  id, name, formatId, commanders: [], signatureSpell: null, categoryOrder: [], versions: [],
  main: [{ cardId: 'elf', quantity: 4 }], sideboard: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
})
const stateFor = (who) => ({
  version: 4, collection: {}, games: [],
  decks: [deck(`d-${who}`, `${who}'s Elves`, 'commander', { commanders: ['cmdr'], main: [{ cardId: 'elf', quantity: 40 }, { cardId: 'forest', quantity: 59 }] })],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { relayUrl: RELAY, playerName: who },
})
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAI+PjwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const c = (id, name, type_line, over = {}) => ({
  object: 'card', id, oracle_id: `o-${id}`, name, mana_cost: '{1}{G}', cmc: 2, type_line,
  oracle_text: '', color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst',
  set_name: 'Test', collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' },
  image_uris: { art_crop: PIXEL, small: PIXEL, normal: PIXEL }, ...over,
})
const CARDS = [
  c('cmdr', 'Test Commander', 'Legendary Creature — Elf', { power: '3', toughness: '3' }),
  c('elf', 'Llanowar Elves', 'Creature — Elf Druid', { power: '1', toughness: '1' }),
  c('forest', 'Forest', 'Basic Land — Forest', { mana_cost: '', cmc: 0, produced_mana: ['G'] }),
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []
/** A device: its own context, its own storage, seeded with one deck and the relay's address. */
const device = async (who) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`))
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
  await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CARDS }) }))
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate((state) => localStorage.setItem('mtg-companion:v1', JSON.stringify(state)), stateFor(who))
  return page
}

/** Taps a card in the fan by its visible sliver; see table.spec.mjs. */
const tapHand = async (page, card) => {
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
}

const ada = await device('Ada')
const bob = await device('Bob')

console.log('\nOpening a room from the lobby')
await ada.goto(`${TARGET}#/game`, { waitUntil: 'networkidle' })
await ada.reload({ waitUntil: 'networkidle' })
await ada.waitForTimeout(400)
check('with a relay to reach, the seats panel offers an invite', (await ada.getByRole('button', { name: 'Invite a friend' }).count()) === 1)
await ada.getByRole('button', { name: 'Invite a friend' }).click()
check('inviting opens a room and puts its code in the address',
  await until(async () => /^#\/game\/room\/[A-Z0-9]{5}$/.test(await ada.evaluate(() => location.hash))), await ada.evaluate(() => location.hash))
const code = (await ada.evaluate(() => location.hash)).split('/').pop()
check('the lobby now says Together', /Together/.test(await ada.locator('.lobby__title').innerText()))
check('and shows the link to hand a friend', (await ada.locator('.lobby__link').innerText()).endsWith(`#/game/room/${code}`), await ada.locator('.lobby__link').innerText())
await ada.locator('.lobby__deck').first().click()
await ada.getByRole('button', { name: /^Sit down with/ }).click()
check('sitting down opens the shared table', await until(() => ada.locator('.game--shared').count().then((n) => n === 1)))
check('in the first seat, and it is your turn', await until(() => ada.locator('.plate--you.plate--active').count().then((n) => n === 1)))
check('with the seat opposite open', /open seat/i.test(await ada.locator('.game__them').innerText()))
await ada.getByRole('button', { name: 'Keep hand →' }).click()

console.log('\nA friend opens the link')
await bob.goto(`${TARGET}#/game/room/${code}`, { waitUntil: 'networkidle' })
await bob.reload({ waitUntil: 'networkidle' })
check('the link lands in the lobby for that room', await until(() => bob.locator('.lobby__title').innerText().then((t) => /Together/.test(t)).catch(() => false)))
check('which already shows who is seated', await until(() => bob.locator('.lobby__seats').innerText().then((t) => /Ada/.test(t))), await bob.locator('.lobby__seats').innerText())
await bob.locator('.lobby__deck').first().click()
await bob.getByRole('button', { name: /^Sit down with/ }).click()
check('the friend sits down at the same table', await until(() => bob.locator('.game--shared').count().then((n) => n === 1)))
check('across from the first player, whose turn it is',
  await until(() => bob.locator('.game__them--seated').innerText().then((t) => /ada/i.test(t) && /their turn/i.test(t))), await bob.locator('.game__them--seated').innerText().catch(() => ''))
check('and the first player sees the friend arrive', await until(() => ada.locator('.game__them--seated').innerText().then((t) => /bob/i.test(t))))
check('with seven card backs in hand', await until(() => ada.locator('.game__them--seated .back').count().then((n) => n === 7)))
await bob.getByRole('button', { name: 'Keep hand →' }).click()

console.log('\nWhat one does, the other sees')
await tapHand(bob, bob.locator('.tabletop__handcard .bcard').last())
check('a card played on one screen lands on the other, across the table',
  await until(() => ada.locator('.game__theirfield .bcard--tile').count().then((n) => n === 1)))
check('and on its own screen, once the relay said so', await until(() => bob.locator('.game__field .bcard--tile').count().then((n) => n === 1)))
check('and the log on the other screen names who did it', /Bob/.test(await ada.locator('.gamelog').innerText()))
await ada.locator('.game__theirfield .bcard--tile').first().click()
check('tapping somebody else\'s card is refused, and the screen says so',
  await until(() => ada.locator('.banner').innerText().then((t) => /not your card/i.test(t)).catch(() => false)))
check('and nothing changed', (await bob.locator('.game__field .bcard--tapped').count()) === 0)

console.log('\nWhose turn it is')
check('the friend cannot end a turn that is not theirs', await bob.getByRole('button', { name: /end turn/i }).isDisabled())
await ada.getByRole('button', { name: /end turn/i }).click()
check('ending the turn hands it across the table',
  await until(() => bob.locator('.plate--you.plate--active').count().then((n) => n === 1)))
check('and the first player now waits', await until(() => ada.locator('.plate--you').innerText().then((t) => /waiting/i.test(t))))
check('and can no longer end the turn', await ada.getByRole('button', { name: /end turn/i }).isDisabled())

console.log('\nA socket cut under one of them')
for (const socket of relayServer.wss.clients) if (socket.seat === 'p2') socket.terminate()
check('the screen says it lost the table', await until(() => bob.locator('.banner').innerText().then((t) => /Reconnecting/.test(t)).catch(() => false)))
check('and gets it back on its own', await until(() => bob.locator('.banner').count().then((n) => n === 0), 8000))
check('in the same seat, with the turn still theirs', (await bob.locator('.plate--you.plate--active').count()) === 1)

console.log('\nA reload')
await ada.reload({ waitUntil: 'networkidle' })
check('comes back to the same table', await until(() => ada.locator('.game--shared').count().then((n) => n === 1)))
check('in the same seat, waiting on the friend', await until(() => ada.locator('.plate--you').innerText().then((t) => /waiting/i.test(t))))
check('with the friend\'s card still across the table', await until(() => ada.locator('.game__theirfield .bcard--tile').count().then((n) => n === 1)))
check('and without asking about the opening hand again', (await ada.locator('.prompt').count()) === 0)

check('no console errors on either device', errors.length === 0, errors.join('; '))

await browser.close()
await relayServer.shutdown()
rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
