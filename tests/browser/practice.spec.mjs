#!/usr/bin/env node
/**
 * The practice table, in the browser: the guided mana lesson walked end to
 * end with the mouse, a refusal on the way, the question at the end, then
 * reset. Everything on screen has to come from the model, so the checks
 * read the table (pool, stack, tags) rather than the coach's prose alone.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const SHOTS = process.env.SHOTS || null
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
const main = () => page.locator('main').innerText()
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }

console.log('\nGetting there')
await page.goto(`${TARGET}#/practice`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('the practice home lists the mana lesson', /Lands, mana and a first creature/.test(await main()))
await page.getByRole('button', { name: /Cast your first creature/ }).click()
await page.waitForTimeout(500)
check('an exercise has an address', (await page.evaluate(() => location.hash)) === '#/practice/mana-guided', await page.evaluate(() => location.hash))
check('the table says whose turn, which step and who has priority', /Your turn 1 · Main phase · You have priority/.test(await main()), (await main()).match(/turn 1[^\n]*/)?.[0])
check('the stack and the pool start empty', /The stack is empty/.test(await main()) && /Mana pool\s*empty/.test(await main()))
await shot('practice-01-start')

console.log('\nMANA-01: inspecting changes nothing')
await page.getByRole('button', { name: 'Look closely at Grizzly Bears' }).click()
await page.waitForTimeout(400)
check('the viewer opens', (await page.locator('.zoom').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('and the table is as it was', /Mana pool\s*empty/.test(await main()) && (await page.locator('.hand__card').count()) === 1)

console.log('\nThe cast')
await page.locator('.hand__card .cardface').first().click()
await page.waitForTimeout(200)
check('selecting a card in hand offers Cast without casting', (await page.getByRole('button', { name: 'Cast', exact: true }).count()) === 1 && /The stack is empty/.test(await main()))
await page.getByRole('button', { name: 'Cast', exact: true }).click()
await page.waitForTimeout(200)
check('the casting panel shows the cost with nothing paid', /Casting Grizzly Bears/.test(await main()) && /nothing in the pool: tap a source/.test(await main()))
check('the coach asks for the Forest', /Tap the Forest/.test(await main()))
await shot('practice-02-casting')
const land = (name) => page.locator(`.zone--you .permanent--land .cardface[aria-label*="${name}"], .zone--you .permanent--land .cardface`, { hasText: name }).first()
await land('Forest').click()
await page.waitForTimeout(200)
check('tapping the Forest adds one green to the pool', /1 green/.test(await main()))
check('and the Forest reads as tapped', (await page.locator('.zone--you .permanent--tapped').count()) === 1)
await land('Forest').click()
await page.waitForTimeout(200)
check('MANA-04: tapping it again is refused and the pool is unchanged', /Not allowed\.\s*Forest is already tapped/.test(await main()) && /1 green/.test(await main()) && !/2 green/.test(await main()))
await land('Mountain').click()
await page.waitForTimeout(200)
check('the Mountain adds one red', /1 green/.test(await main()) && /1 red/.test(await main()))

console.log('\nMANA-03: the wrong colour')
await page.getByRole('button', { name: 'Pay G with red mana' }).click()
await page.waitForTimeout(200)
check('red on the {G} is refused with the reason', /can only be paid with green mana/.test(await main()))
check('and nothing was committed', /1 green/.test(await main()) && /1 red/.test(await main()) && /The stack is empty/.test(await main()))
await page.getByRole('button', { name: 'Pay from pool' }).click()
await page.waitForTimeout(200)
check('paying from the pool fills both parts', (await page.locator('.cast__assigned .chip').count()) === 2 && /Paid\. Casting puts it on the stack/.test(await main()))
await shot('practice-03-paid')
await page.getByRole('button', { name: 'Cast', exact: true }).click()
await page.waitForTimeout(300)
check('MANA-02: the spell is on the stack, not the battlefield, and the mana is spent', /top\s*Grizzly Bears\s*yours/.test(await main()) && /Mana pool\s*empty/.test(await main()) && (await page.locator('.zone--you .permanent:not(.permanent--land)').count()) === 0)
check('MANA-05: one spell on the stack, one hand card gone', (await page.locator('.table__spell').count()) === 1 && /Your hand: empty/.test(await main()))
check('the coach says to pass', /Pass\. Your opponent passes too/.test(await main()))
await shot('practice-04-stack')

console.log('\nMANA-06: resolution')
await page.getByRole('button', { name: 'Pass priority' }).click()
await page.waitForTimeout(400)
check('after both pass, Grizzly Bears is on the battlefield', (await page.locator('.zone--you .permanent:not(.permanent--land)').count()) === 1 && /The stack is empty/.test(await main()))
check('summoning sick, and the lands still tapped', (await page.locator('.zone--you .permanent--sick').count()) === 1 && (await page.locator('.zone--you .permanent--land.permanent--tapped').count()) === 2)
check('priority is back with you in the same main phase', /Your turn 1 · Main phase · You have priority/.test(await main()))
check('the first goal ticks', /✓ Grizzly Bears is on the battlefield/.test(await main()))
await shot('practice-05-resolved')

console.log('\nThe question')
check('the why-question appears', /What untaps\?/.test(await main()))
await page.getByRole('button', { name: /The mana you spent comes back/ }).click()
await page.waitForTimeout(200)
check('a wrong answer explains and the lesson is not done', /Not quite/.test(await main()) && !/Every goal is met/.test(await main()))
await page.getByRole('button', { name: 'Try again' }).click()
await page.getByRole('button', { name: /The Forest and the Mountain/ }).click()
await page.waitForTimeout(200)
check('the right answer completes the lesson', /Every goal is met/.test(await main()) && /✓ Say what untaps next turn/.test(await main()))
await shot('practice-06-done')

console.log('\nMANA-11: mana empties with the step')
await page.getByRole('button', { name: 'Reset' }).click()
await page.waitForTimeout(300)
check('MANA-08: reset restores the fixture', /Mana pool\s*empty/.test(await main()) && (await page.locator('.hand__card').count()) === 1 && (await page.locator('.zone--you .permanent--tapped').count()) === 0)
await land('Forest').click()
await page.waitForTimeout(150)
check('a source can be tapped outside a cast, with priority', /1 green/.test(await main()))
await page.getByRole('button', { name: 'Pass priority' }).click()
await page.waitForTimeout(300)
check('passing with an empty stack moves on and empties the pool', /Beginning of combat/.test(await main()) && /Mana pool\s*empty/.test(await main()), (await main()).match(/turn 1[^\n]*/)?.[0])
check('the Forest stays tapped', (await page.locator('.zone--you .permanent--tapped').count()) === 1)
await page.getByRole('button', { name: 'Undo the last action (practice only)' }).click()
await page.waitForTimeout(200)
check('undo steps back one action', /Main phase/.test(await main()) && /1 green/.test(await main()))

console.log('\nThe wrong-colour exercise')
await page.goto(`${TARGET}#/practice/mana-wrong-colour`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.locator('.hand__card .cardface', { hasText: 'Hill Giant' }).click()
await page.getByRole('button', { name: 'Cast', exact: true }).click()
for (let i = 0; i < 4; i++) { await page.locator('.zone--you .permanent--land:not(.permanent--tapped) .cardface').first().click(); await page.waitForTimeout(80) }
check('four Forests make four green', /4 green/.test(await main()))
await page.getByRole('button', { name: 'Pay from pool' }).click()
await page.waitForTimeout(200)
check('paying is refused for the colour, not the count', /short of red mana/.test(await main()))
check('and Cast stays disabled', await page.getByRole('button', { name: 'Cast', exact: true }).isDisabled())
await page.getByRole('button', { name: 'Cancel' }).click()
await page.waitForTimeout(200)
check('cancelling keeps the mana made', /4 green/.test(await main()) && !/Casting Hill Giant/.test(await main()))

console.log('\nWide screen')
await page.setViewportSize({ width: 1200, height: 900 })
await page.goto(`${TARGET}#/practice/mana-guided`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('the coach sits beside the board on a wide screen',
  (await page.locator('.coach').boundingBox()).x > (await page.locator('.table').boundingBox()).x + 300)
await shot('practice-07-desktop')

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
