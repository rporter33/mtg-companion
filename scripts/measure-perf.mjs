#!/usr/bin/env node
/**
 * How the app holds up at a real deck's size.
 *
 *   node scripts/measure-perf.mjs [url] [--throttle N]
 *
 * Seeds one genuinely full Commander deck — a hundred distinct cards with
 * images and three prices each, twenty-five versions of history, a collection —
 * and measures what a person would feel: how long each view takes to settle,
 * how much DOM it builds, and how much main-thread time it burns re-rendering.
 *
 * Runs CPU-throttled by default, because a fast machine hides exactly what a
 * phone shows and this app is mostly used on one.
 */
import { chromium } from 'playwright'

const TARGET = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4173/'
const throttleArg = process.argv.indexOf('--throttle')
const THROTTLE = throttleArg !== -1 ? Number(process.argv[throttleArg + 1]) : 4

const TYPES = [
  ['Basic Land — Forest', 36], ['Creature — Elf Druid', 28], ['Instant', 10], ['Sorcery', 8],
  ['Artifact', 8], ['Enchantment', 6], ['Legendary Planeswalker — Nissa', 3],
]
const FALLBACK = process.argv.includes('--fallback')
const IMG = FALLBACK
  ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw='   // truncated on purpose: forces the CSS-drawn face
  : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const cards = []
let n = 0
for (const [type_line, count] of TYPES) {
  for (let i = 0; i < count; i++) {
    n++
    const id = `c${String(n).padStart(3, '0')}`
    cards.push({
      object: 'card', id, oracle_id: `o-${id}`, name: `Test Card ${String(n).padStart(3, '0')}`,
      mana_cost: /Land/.test(type_line) ? '' : `{${(n % 5) + 1}}{G}`, cmc: /Land/.test(type_line) ? 0 : (n % 5) + 2,
      type_line, oracle_text: 'Whenever a creature enters, draw a card. {T}: Add {G}.',
      color_identity: ['G'], colors: /Land/.test(type_line) ? [] : ['G'], rarity: 'common',
      set: 'tst', set_name: 'Test', collector_number: String(n), legalities: { commander: 'legal' },
      prices: { usd: (n * 0.37).toFixed(2), eur: (n * 0.31).toFixed(2), tix: (n * 0.01).toFixed(2) },
      purchase_uris: { tcgplayer: 'https://t', cardmarket: 'https://c', cardhoarder: 'https://h' },
      image_uris: { normal: IMG, small: IMG }, produced_mana: /Land/.test(type_line) ? ['G'] : undefined,
    })
  }
}
const CMDR = { ...cards[0], id: 'cmdr', oracle_id: 'o-cmdr', name: 'Test Commander', type_line: 'Legendary Creature — Elf', mana_cost: '{2}{G}', cmc: 3 }
const ALL = [CMDR, ...cards]
const lists = () => ({ main: cards.map((c) => ({ cardId: c.id, quantity: 1 })), sideboard: [], commanders: ['cmdr'], signatureSpell: null, categoryOrder: [] })
const versions = Array.from({ length: 25 }, (_, i) => ({
  id: `v${i}`, at: `2026-0${(i % 8) + 1}-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z`,
  label: i % 5 === 0 ? `Milestone ${i}` : '', auto: i % 5 !== 0,
  ...lists(), main: cards.slice(i).map((c) => ({ cardId: c.id, quantity: 1 })),
}))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
const cdp = await page.context().newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
await page.route('**/api.scryfall.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
await page.route('**/api.scryfall.com/cards/collection', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: ALL }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.evaluate(({ lists, versions }) => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 4, collection: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`o-c${String(i + 1).padStart(3, '0')}`, 1])),
  decks: [{ id: 'd1', name: 'Full Deck', formatId: 'commander', ...lists, versions, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: { deckView: 'list' },
})), { lists: lists(), versions })

// Long tasks are the thing a person feels as jank. Collect them page-wide.
await page.addInitScript(() => {
  window.__longTasks = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(e.duration) }).observe({ type: 'longtask', buffered: true }) } catch {}
})
await page.reload({ waitUntil: 'networkidle' })

const settle = async (label, action, ready) => {
  await page.evaluate(() => { window.__longTasks = [] })
  const t0 = Date.now()
  await action()
  await page.waitForFunction(ready, null, { timeout: 30000 })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const ms = Date.now() - t0
  const stats = await page.evaluate(() => ({
    nodes: document.querySelectorAll('*').length,
    priceCells: document.querySelectorAll('.prices__cell').length,
    imgs: document.querySelectorAll('img').length,
    long: window.__longTasks.length,
    longMs: Math.round(window.__longTasks.reduce((a, b) => a + b, 0)),
    heapMB: performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 'n/a',
  }))
  console.log(`${label.padEnd(34)} ${String(ms).padStart(6)} ms   nodes ${String(stats.nodes).padStart(6)}   prices ${String(stats.priceCells).padStart(4)}   imgs ${String(stats.imgs).padStart(4)}   long ${String(stats.long).padStart(3)} (${String(stats.longMs).padStart(5)} ms)   heap ${stats.heapMB} MB`)
  return { ms, ...stats }
}

console.log(`\nCPU throttle ×${THROTTLE}, 390px viewport, 100-card deck, 25 versions, images ${FALLBACK ? 'BROKEN (CSS face fallback)' : 'real'}\n`)
const tab = (name) => () => page.getByRole('tab', { name }).click()
await settle('open Decks', () => page.locator('.app__nav button', { hasText: 'Decks' }).click(), () => document.querySelector('.deck-card__open'))
await settle('open deck (list, 100 rows)', () => page.locator('.deck-card__open').first().click(), () => document.querySelectorAll('.deck-row').length >= 100)
await settle('switch to grid (100 tiles)', () => page.getByRole('button', { name: 'Grid', exact: true }).click(), () => document.querySelectorAll('.deck-tile').length >= 100)
await settle('back to list', () => page.getByRole('button', { name: 'List', exact: true }).click(), () => document.querySelectorAll('.deck-row').length >= 100)

// Re-render cost: what one keystroke or click costs once the view is up.
await page.evaluate(() => { window.__longTasks = [] })
const t0 = Date.now()
for (let i = 0; i < 5; i++) {
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.deck-tile').length >= 100)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.deck-row').length >= 100)
}
const toggles = await page.evaluate(() => ({ long: window.__longTasks.length, longMs: Math.round(window.__longTasks.reduce((a, b) => a + b, 0)) }))
console.log(`${'5× list↔grid toggles'.padEnd(34)} ${String(Date.now() - t0).padStart(6)} ms   per toggle ${Math.round((Date.now() - t0) / 10)} ms   long ${toggles.long} (${toggles.longMs} ms)`)

await page.evaluate(() => { window.__longTasks = [] })
const k0 = Date.now()
const row = page.locator('.deck-row').filter({ has: page.locator('.deck-row__step') }).first()
for (let i = 0; i < 5; i++) { await row.getByRole('button', { name: /One more/ }).click(); await page.waitForTimeout(50) }
const keys = await page.evaluate(() => ({ long: window.__longTasks.length, longMs: Math.round(window.__longTasks.reduce((a, b) => a + b, 0)) }))
console.log(`${'5× quantity clicks in list'.padEnd(34)} ${String(Date.now() - k0).padStart(6)} ms   per click ${Math.round((Date.now() - k0) / 5)} ms   long ${keys.long} (${keys.longMs} ms)`)

await settle('Analysis tab', tab('Analysis'), () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Analysis' && document.querySelectorAll('.app__main *').length > 50)
await settle('Coach tab', tab('Coach'), () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Coach' && document.querySelectorAll('.app__main *').length > 50)
await settle('Playtest: draw a hand', async () => { await tab('Playtest')(); await page.getByRole('button', { name: 'Draw a hand' }).click() }, () => document.querySelectorAll('.hand-card').length === 7)
await settle('History tab (25 versions)', tab('History'), () => document.querySelectorAll('.version').length >= 25)
await settle('History: compare a 100-card diff', () => page.getByRole('button', { name: 'Compare to now' }).last().click(), () => document.querySelector('.diff'))

await page.evaluate(() => { window.__longTasks = [] })
const l0 = Date.now()
await page.getByLabel('Version label').type('typing a label here', { delay: 10 })
const typed = await page.evaluate(() => ({ long: window.__longTasks.length, longMs: Math.round(window.__longTasks.reduce((a, b) => a + b, 0)) }))
console.log(`${'typing 19 chars in version label'.padEnd(34)} ${String(Date.now() - l0).padStart(6)} ms   per char ${Math.round((Date.now() - l0) / 19)} ms   long ${typed.long} (${typed.longMs} ms)`)

await browser.close()
