#!/usr/bin/env node
/**
 * Browser checks for the card explainer.
 *
 * The parsing is covered thoroughly by unit tests; what this verifies is that
 * the explainer is actually *reachable* — that it is the default tab, that it
 * appears near the top rather than below every fact about the card, and that a
 * card carrying several kinds of ability renders each one distinctly.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

// One card carrying every shape the explainer knows about.
const CARD = {
  object: 'card', id: 'x1', oracle_id: 'ox1', name: 'Teaching Serpent',
  mana_cost: '{2}{G}{U}', cmc: 4, type_line: 'Creature — Serpent Druid',
  oracle_text: [
    'Flying, vigilance',
    'Landfall — Whenever a land enters the battlefield under your control, you may sacrifice a creature. When you do, draw two cards.',
    '{T}: Add {G}.',
    'Other creatures you control get +1/+1.',
  ].join('\n'),
  power: '3', toughness: '4', color_identity: ['G', 'U'], colors: ['G', 'U'],
  rarity: 'rare', set: 'tst', set_name: 'Test', artist: 'Test Artist',
  legalities: { modern: 'legal', commander: 'legal' }, prices: { usd: '2.00' },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 420, height: 1200 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.route('**/api.scryfall.com/cards/search**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', data: [CARD], total_cards: 1, has_more: false }) }))
await page.route('**/api.scryfall.com/sets', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [] }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Cards', exact: true }).click()
await page.waitForTimeout(250)
await page.getByLabel('Search cards').fill('teaching')
await page.getByRole('button', { name: 'Search' }).click()
await page.waitForTimeout(500)
await page.locator('.card-grid > *').first().click()
await page.waitForTimeout(600)

console.log('\nReachability')
check('Explain is the default tab',
  (await page.getByRole('tab', { name: 'Explain' }).getAttribute('aria-selected')) === 'true')

const explainBox = await page.locator('.explain').boundingBox()
const bodyBox = await page.locator('.sheet__body').boundingBox()
const offset = explainBox.y - bodyBox.y
check('it starts near the top rather than below every fact', offset < 900, `${Math.round(offset)}px in`)

console.log('\nIt tells the different kinds of ability apart')
const badges = await page.locator('.explain__kinds .chip').allTextContents()
for (const expected of ['Keywords', 'Triggered ability', 'Activated ability', 'Static ability']) {
  check(`identifies a ${expected.toLowerCase()} line`, badges.includes(expected), badges.join(', '))
}
check('flags the optional trigger', badges.includes('optional'), badges.join(', '))
check('flags the reflexive "when you do" trigger',
  badges.includes('reflexive trigger'), badges.join(', '))

console.log('\nAbility words')
const abilityWord = await page.locator('.explain__ability-word').textContent()
check('says Landfall carries no rules meaning',
  /no rules meaning/.test(abilityWord ?? ''), abilityWord)

console.log('\nCross-links and reference data')
check('keyword terms are tappable', (await page.locator('.explain .term').count()) > 0)
await page.getByRole('tab', { name: 'Details' }).click()
await page.waitForTimeout(250)
// Prices moved to the shared PriceRow, so all three markets appear here too
// rather than a bespoke list that only knew about dollars.
check('Details still carries the facts and prices',
  (await page.locator('.facts').count()) === 1
  && (await page.locator('.sheet .prices__cell').count()) === 3,
  `${await page.locator('.facts').count()} facts, ${await page.locator('.sheet .prices__cell').count()} price cells`)
await page.getByRole('tab', { name: 'Legality' }).click()
await page.waitForTimeout(250)
check('Legality still lists every format', (await page.locator('.legality').count()) >= 10)

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
