#!/usr/bin/env node
/**
 * Browser-level checks for the card zoom viewer.
 *
 * These live outside the Vitest suite because what they verify cannot be
 * verified in jsdom: real pointer capture, real layout measurement, real wheel
 * events, and the clamping maths agreeing with what the browser actually
 * renders. Every bug this feature had — text selected while panning, a pointer
 * lost to a thrown setPointerCapture, pan bounds measured against the viewport
 * instead of the card — was invisible to unit tests and obvious here.
 *
 *   npm run build && npm run preview &
 *   node tests/browser/zoom.spec.mjs [url]
 */

import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:4173/'
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const browser = await chromium.launch({ executablePath: EXECUTABLE })
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.locator('.hero').click()
await page.waitForTimeout(300)
for (let i = 0; i < 2; i++) {
  await page.getByRole('button', { name: 'Next' }).click()
  await page.waitForTimeout(150)
}

console.log('\nTutorial inspect')
const beatBefore = (await page.locator('.tutorial .faint.tiny').first().textContent()).trim()
check('cards carry a magnifier button', (await page.locator('.hand__card .inspect').count()) > 0)
await page.locator('.hand__card .inspect').first().click()
await page.waitForTimeout(350)
const beatAfter = (await page.locator('.tutorial .faint.tiny').first().textContent()).trim()
check('inspecting does not play the card', beatBefore === beatAfter, `${beatBefore} -> ${beatAfter}`)
check('the viewer opens', (await page.locator('.zoom').count()) === 1)

const level = async () => (await page.locator('.zoom__level').textContent()).trim()
const frame = await page.locator('.zoom__frame').boundingBox()
const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
const reset = async () => { await page.keyboard.press('0'); await page.waitForTimeout(120) }

const pinch = (spread) => page.locator('.zoom__frame').evaluate((el, spread) => {
  const rect = el.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const send = (type, pts) => pts.forEach((p) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: p.id, clientX: p.x, clientY: p.y, pointerType: 'touch',
    bubbles: true, isPrimary: p.id === 1,
  })))
  send('pointerdown', [{ id: 1, x: cx - 40, y: cy }, { id: 2, x: cx + 40, y: cy }])
  for (let i = 1; i <= 8; i++) {
    const d = 40 + (spread - 40) * (i / 8)
    send('pointermove', [{ id: 1, x: cx - d, y: cy }, { id: 2, x: cx + d, y: cy }])
  }
  send('pointerup', [{ id: 1, x: cx - spread, y: cy }, { id: 2, x: cx + spread, y: cy }])
}, spread)

console.log('\nGestures')
check('opens at fit', (await level()) === '100%', await level())

await pinch(160); await page.waitForTimeout(250)
check('pinch out magnifies', parseInt(await level(), 10) > 150, await level())
await pinch(45); await page.waitForTimeout(250)
check('pinch in returns toward fit', parseInt(await level(), 10) <= 120, await level())

await reset()
await page.mouse.move(centre.x, centre.y)
await page.mouse.wheel(0, -400)
await page.waitForTimeout(250)
check('wheel magnifies', parseInt(await level(), 10) > 100, await level())

await reset()
await page.mouse.click(centre.x, centre.y)
await page.mouse.click(centre.x, centre.y, { delay: 20 })
await page.waitForTimeout(250)
check('double tap toggles in', parseInt(await level(), 10) > 200, await level())
await page.mouse.click(centre.x, centre.y)
await page.mouse.click(centre.x, centre.y, { delay: 20 })
await page.waitForTimeout(250)
check('double tap toggles back out', (await level()) === '100%', await level())

console.log('\nPanning')
const dragBy = async (dx, dy) => {
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  return page.locator('.zoom__content').evaluate((el) => el.style.transform)
}

await reset()
check('cannot pan while the card fits', /translate\(0px,\s*0px\)/.test(await dragBy(4000, 4000)))

await page.keyboard.press('+'); await page.keyboard.press('+'); await page.waitForTimeout(150)
const transform = await dragBy(4000, 4000)
const [, tx, ty] = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/) ?? []
const box = await page.locator('.zoom__content').evaluate((el) => {
  const r = el.getBoundingClientRect()
  return { w: r.width, h: r.height }
})
const expectedX = Math.max(0, (box.w - frame.width) / 2)
const expectedY = Math.max(0, (box.h - frame.height) / 2)
check('pan clamps to the card\'s real overhang',
  Math.abs(Number(tx) - expectedX) < 2 && Math.abs(Number(ty) - expectedY) < 2,
  `got ${tx},${ty} expected ~${expectedX.toFixed(1)},${expectedY.toFixed(1)}`)

const selection = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim())
check('panning does not select the card text', selection === '', `selected: "${selection}"`)

console.log('\nKeyboard and dismissal')
await reset()
await page.keyboard.press('+')
await page.waitForTimeout(150)
check('"+" zooms in', (await level()) === '150%', await level())
await page.keyboard.press('-')
await page.waitForTimeout(150)
check('"-" zooms out', (await level()) === '100%', await level())
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
check('Escape closes the viewer', (await page.locator('.zoom').count()) === 0)
check('the tutorial is where we left it',
  (await page.locator('.tutorial .faint.tiny').first().textContent()).trim() === beatBefore)

check('no console errors throughout', errors.length === 0, errors.join('; '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
