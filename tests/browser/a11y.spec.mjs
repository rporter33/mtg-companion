#!/usr/bin/env node
/**
 * Accessibility checks against the real UI.
 *
 * axe-core finds a specific and useful subset of accessibility problems —
 * contrast, names, roles, landmarks — and finding nothing is not the same as
 * being accessible. What it does catch is the class of bug that is invisible
 * to a sighted developer with a mouse, which is exactly the class this app had
 * never been checked for.
 *
 * Every view is scanned, plus the states that only exist after interaction:
 * an open card viewer, a deck being edited. A dialog that traps nobody and
 * names nothing is only wrong while it is open.
 */

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
const REPORT_ONLY = process.argv.includes('--report')

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const card = (name, extra = {}) => ({
  object: 'card', id: `id-${name}`, oracle_id: `o-${name}`, name,
  mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Elf', oracle_text: 'Flying',
  color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'tst', set_name: 'Test',
  collector_number: '1', legalities: { commander: 'legal' }, prices: { usd: '1.00' },
  image_uris: { normal: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
  ...extra,
})

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// Registered first on purpose: Playwright gives precedence to the route added
// last, so a catch-all at the bottom would swallow every specific mock above it.
await page.route('**/api.scryfall.com/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [] }) }))
await page.route('**/api.scryfall.com/sets', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', data: [
    { code: 'fra', name: 'Reality Fracture', released_at: '2026-10-02', set_type: 'expansion', icon_svg_uri: '', card_count: 291, digital: false },
    { code: 'hob', name: 'The Hobbit', released_at: '2026-08-14', set_type: 'expansion', icon_svg_uri: '', card_count: 281, digital: false },
  ] }) }))
await page.route('**/api.scryfall.com/cards/search**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', total_cards: 2, has_more: false, data: [card('Alpha Elf'), card('Beta Bear')] }) }))
await page.route('**/api.scryfall.com/cards/named**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(card('Alpha Elf')) }))


const seen = new Map()

async function scan(label) {
  await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(async () => window.axe.run(document, {
    resultTypes: ['violations'],
    // Colour contrast is the single most common real barrier in a dark theme,
    // so it stays on. Best-practice rules that are not WCAG failures are not
    // included — this has to be a bar the project can actually hold.
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }))

  for (const violation of result.violations) {
    const entry = seen.get(violation.id) ?? { impact: violation.impact, help: violation.help, where: new Set(), nodes: [] }
    entry.where.add(label)
    for (const node of violation.nodes.slice(0, 3)) {
      if (entry.nodes.length < 4) entry.nodes.push(node.target.join(' '), node.failureSummary?.split('\n')[1]?.trim() ?? '')
    }
    seen.set(violation.id, entry)
  }
  return result.violations.length
}

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

const go = async (tab) => {
  await page.locator('.app__nav button', { hasText: tab }).click()
  await page.waitForTimeout(600)
}

console.log('\nScanning every view')
for (const tab of ['Learn', 'Cards', 'Decks', 'Play']) {
  await go(tab)
  const n = await scan(tab)
  console.log(`  ${tab}: ${n} violation type(s)`)
}

console.log('\nScanning states that only exist after interaction')

/**
 * Scan a state, and fail loudly if it could not be reached.
 *
 * The first version of this file skipped a state whose locator found nothing
 * and still reported a clean run — so the zoom viewer and the deck editor,
 * the two most interactive things in the app, were never actually checked.
 * A scan that cannot reach its target is a failure, not a pass.
 */
async function scanState(label, open) {
  const reached = await open()
  check(`reached the ${label} to scan it`, reached, 'locator found nothing')
  if (!reached) return
  console.log(`  ${label}: ${await scan(label)} violation type(s)`)
}

await scanState('card search results', async () => {
  await go('Cards')
  const box = page.getByLabel('Search cards')
  if (!await box.count()) return false
  await box.fill('elf')
  await page.getByRole('button', { name: 'Search' }).click()
  await page.waitForTimeout(600)
  return (await page.locator('.card-grid > *').count()) > 0
})

await scanState('card detail', async () => {
  const result = page.locator('.card-grid > *').first()
  if (!await result.count()) return false
  await result.click()
  await page.waitForTimeout(700)
  return (await page.locator('.sheet, .card-detail').count()) > 0
})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(300)

// The scripted first game is the screen a brand new player meets first, and
// the only place the zoom viewer is two clicks away.
await scanState('tutorial', async () => {
  await go('Learn')
  const hero = page.locator('.hero')
  if (!await hero.count()) return false
  await hero.click()
  await page.waitForTimeout(400)
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Next' }).click().catch(() => {})
    await page.waitForTimeout(200)
  }
  return (await page.locator('.tutorial').count()) > 0
})

await scanState('zoom viewer', async () => {
  const inspect = page.locator('.hand__card .inspect')
  if (!await inspect.count()) return false
  await inspect.first().click()
  await page.waitForTimeout(600)
  return (await page.locator('.zoom').count()) === 1
})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(300)

await scanState('deck editor', async () => {
  // Learn is still showing the tutorial, so come back through another tab.
  await go('Cards')
  await go('Learn')
  const example = page.locator('.chip', { hasText: /\(\d+\)$/ }).first()
  if (!await example.count()) return false
  await example.click()
  await page.waitForTimeout(900)
  return (await page.locator('.deck-title, textarea').count()) > 0
})

// The grid and the playtest need a deck whose cards have actually loaded. The
// example-deck route above resolves nothing under these mocks, so seed one
// directly and answer the collection lookup for it.
const SEEDED = [
  card('Seed Commander', { id: 'seed-cmdr', oracle_id: 'o-seed-cmdr', type_line: 'Legendary Creature — Elf' }),
  card('Seed Forest', { id: 'seed-forest', oracle_id: 'o-seed-forest', type_line: 'Basic Land — Forest' }),
  card('Seed Elf', { id: 'seed-elf', oracle_id: 'o-seed-elf' }),
]
await page.route('**/api.scryfall.com/cards/collection', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ data: SEEDED }) }))
await page.evaluate(() => localStorage.setItem('mtg-companion:v1', JSON.stringify({
  version: 3, collection: {},
  decks: [{
    id: 'a11y-deck', name: 'Sweep Deck', formatId: 'commander', commanders: ['seed-cmdr'],
    signatureSpell: null, categoryOrder: [],
    main: [{ cardId: 'seed-forest', quantity: 40 }, { cardId: 'seed-elf', quantity: 59 }],
    sideboard: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }],
  games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: { deckView: 'list' },
})))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await go('Decks')
await page.locator('.deck-card__open').first().click()
await page.waitForTimeout(900)

await scanState('deck grid view', async () => {
  const grid = page.getByRole('button', { name: 'Grid', exact: true })
  if (!await grid.count()) return false
  await grid.click()
  await page.waitForTimeout(600)
  return (await page.locator('.deck-tile').count()) > 0
})

await scanState('playtest hand', async () => {
  const tab = page.getByRole('tab', { name: 'Playtest' })
  if (!await tab.count()) return false
  await tab.click()
  await page.waitForTimeout(400)
  const drawBtn = page.getByRole('button', { name: 'Draw a hand' })
  if (!await drawBtn.count() || await drawBtn.isDisabled()) return false
  await drawBtn.click()
  await page.waitForTimeout(500)
  return (await page.locator('.hand-card').count()) === 7
})

console.log('\nFindings')
if (!seen.size) console.log('  none')
const order = { critical: 0, serious: 1, moderate: 2, minor: 3 }
const found = [...seen.entries()].sort((a, b) => (order[a[1].impact] ?? 9) - (order[b[1].impact] ?? 9))
for (const [id, entry] of found) {
  console.log(`\n  [${entry.impact}] ${id} — ${entry.help}`)
  console.log(`    on: ${[...entry.where].join(', ')}`)
  for (let i = 0; i < entry.nodes.length; i += 2) {
    console.log(`    ${entry.nodes[i]}`)
    if (entry.nodes[i + 1]) console.log(`      ${entry.nodes[i + 1]}`)
  }
}

console.log()
const blocking = found.filter(([, e]) => e.impact === 'critical' || e.impact === 'serious')
check('no critical or serious accessibility violations', blocking.length === 0,
  blocking.map(([id]) => id).join(', '))
check('no moderate violations', found.filter(([, e]) => e.impact === 'moderate').length === 0,
  found.filter(([, e]) => e.impact === 'moderate').map(([id]) => id).join(', '))
check('no console errors throughout', errors.length === 0, errors.join('; '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(REPORT_ONLY ? 0 : (fail ? 1 : 0))
