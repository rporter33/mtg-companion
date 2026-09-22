#!/usr/bin/env node
/**
 * Browser checks for saved cards being fetched again.
 *
 * A deck's cards are kept on the device so the deck opens with no signal,
 * and for a long time they were never asked about again: a Reality Fracture
 * card saved before its release on 2 October 2026 kept Scryfall's
 * pre-release not_legal for ever, and the launch legality watch compared one
 * frozen record with another. Here a Modern deck is saved on 21 Sep 2026 and
 * opened again half an hour into 2 Oct, when every record is over a week old
 * and due on that count alone: what was saved shows at once, with the new
 * card's legality read as not known rather than failed; then Scryfall's
 * current word arrives and the deck is drawn again; the watch announces the
 * ban and not the card coming out, and dates its data.
 *
 * Then a Standard deck, saved on the evening of 1 Oct with Scryfall's
 * pre-release record of the card (not_legal everywhere, legal in Future
 * Standard), is opened on 2 Oct twice over. Its records are hours old, so
 * only the release-day rule makes the Phoenix due, and the Mountain, out
 * since August, is not asked about. Once Scryfall lists the card as legal,
 * and the deck is plainly legal and nothing is announced; once it still says
 * what it said before release, and the deck says the app does not know the
 * card's legality and does not call it a problem.
 *
 * Each profile's clock is held and moved on within the one browser context,
 * so what the app saved in IndexedDB on 21 Sep is what it finds on 2 Oct.
 * The Scryfall answers are the objects Scryfall sent on 2026-09-21
 * (tests/fixtures/scryfall-unreleased.json), changed on release day only as
 * the checks below say, so this means the same in 2030 as it did the week
 * it was written.
 */

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/scryfall-unreleased.json', import.meta.url), 'utf8'))
const CARDS = FIXTURE.cards.map((card) => ({
  ...card,
  image_uris: Object.fromEntries(Object.keys(card.image_uris ?? {}).map((size) => [size, PNG])),
}))
const SETS = FIXTURE.sets.map((set) => ({ ...set, icon_svg_uri: '' }))
const print = (set, number) => CARDS.find((c) => c.set === set && c.collector_number === number)

const MOUNTAIN = print('hob', '197')
const BOLT = print('msc', '806')
const PHOENIX = print('fra', '53')

// Scryfall on release day, as these checks suppose it: Darklight Phoenix is
// out and legal where its Future Standard said it would be, and in Modern
// and Commander. For the Modern deck, Lightning Bolt has also been banned in
// Modern. The ban is made up for the test; it is the kind of news the watch
// exists for.
const legalAs = (card, changes) => ({ ...card, legalities: { ...card.legalities, ...changes } })
const PHOENIX_OUT = legalAs(PHOENIX, { standard: 'legal', modern: 'legal', commander: 'legal' })
const RELEASE_DAY = [MOUNTAIN, legalAs(BOLT, { modern: 'banned' }), PHOENIX_OUT]

const list = (data) => ({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', total_cards: data.length, has_more: false, data }) })

/**
 * Scryfall's collection endpoint answering ids from `cards`, after `gate` if
 * given. Each request's ids go into `asked`; an identifier that is not an id
 * goes in as itself, so a lookup by name would show.
 */
function collection(cards, asked, gate) {
  return async (route) => {
    const { identifiers = [] } = JSON.parse(route.request().postData() ?? '{}')
    asked.push(identifiers.map((i) => i.id ?? JSON.stringify(i)))
    if (gate) await gate
    const data = identifiers.map((i) => cards.find((c) => c.id === i.id)).filter(Boolean)
    const not_found = identifiers.filter((i) => !cards.some((c) => c.id === i.id))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', not_found, data }) })
  }
}

/** Polls `test` until it holds or `ms` pass, by the real clock, not the page's. */
async function until(test, ms = 10000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test().catch(() => false)) return true
    await sleep(100)
  }
  return false
}

const errors = []
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

/**
 * A fresh browser profile whose clock reads `time` and moves on from there,
 * with Scryfall's set list from the fixture and everything else it is asked
 * empty until a spec routes it.
 */
async function profile(time) {
  const context = await browser.newContext({ viewport: { width: 420, height: 1000 } })
  await context.clock.install({ time: new Date(time) })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} (${m.location()?.url ?? ''})`) })
  // Registered first: Playwright tries the route added last first.
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill(list([])))
  await page.route('**/api.scryfall.com/sets', (route) => route.fulfill(list(SETS)))
  return { context, page }
}

/**
 * Saves `deck` as the device's only deck, shows the Decks screen so the launch
 * watch takes its first snapshot of it, and opens it.
 */
async function saveAndOpen(page, deck) {
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.evaluate((deck) => localStorage.setItem('mtg-companion:v1', JSON.stringify({
    version: 4, collection: {}, decks: [deck], games: [],
    guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: { deckView: 'list' },
  })), deck)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await until(async () => !!(await storedDeck(page, deck.id))?.snapshot?.capturedAt)
  await page.locator('.deck-card__open').first().click()
  await page.waitForTimeout(900)
}

/** The deck's verdict chip, beside the way back to the shelf. */
async function verdict(page) {
  const chip = page.locator('.row').filter({ has: page.locator('button', { hasText: '← Decks' }) }).locator('.chip').first()
  return { text: (await chip.innerText()).trim(), className: (await chip.getAttribute('class')) ?? '' }
}

const storedDeck = (page, id) => page.evaluate((id) => JSON.parse(localStorage.getItem(`mtg-companion:v1:deck:${id}`) ?? 'null'), id)

/**
 * What the app has saved of a card in IndexedDB (src/lib/cache.js): when it
 * was fetched and the legalities it carries, or null when there is none.
 */
const savedRecord = (page, id) => page.evaluate((id) => new Promise((resolve) => {
  const request = indexedDB.open('mtg-companion')
  request.onerror = () => resolve(null)
  request.onsuccess = () => {
    const db = request.result
    const done = (value) => { db.close(); resolve(value) }
    try {
      const get = db.transaction('cards', 'readonly').objectStore('cards').get(id)
      get.onsuccess = () => done(get.result ? { fetchedAt: get.result.fetchedAt, legalities: get.result.card?.legalities ?? null } : null)
      get.onerror = () => done(null)
    } catch {
      done(null)
    }
  }
}), id)

/** The UTC day of a time in milliseconds, as the app's today() gives it. */
const dayOf = (time) => (Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : '')

/** axe-core over the whole page, held to the bar tests/browser/a11y.spec.mjs holds. */
async function axe(page, label) {
  await page.addScriptTag({ path: AXE })
  const { violations } = await page.evaluate(() => window.axe.run(document, {
    resultTypes: ['violations'],
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }))
  const blocking = violations.filter((v) => v.impact !== 'minor')
  check(`axe finds nothing critical, serious or moderate in ${label}`, blocking.length === 0,
    blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`).join('; '))
  for (const v of violations.filter((x) => x.impact === 'minor')) console.log(`        minor: ${v.id}`)
}

/** The launch watch's banner on the shelf, which only ever speaks of a change. */
const watchBanner = (page) => page.locator('.banner').filter({ hasText: /no longer playable|more playable|freed up/ })

const DECK = {
  id: 'rift-burn', name: 'Rift Burn', formatId: 'modern', commanders: [], signatureSpell: null,
  categoryOrder: [], versions: [],
  main: [{ cardId: MOUNTAIN.id, quantity: 52 }, { cardId: BOLT.id, quantity: 4 }, { cardId: PHOENIX.id, quantity: 4 }],
  sideboard: [], createdAt: '2026-09-21T09:00:00Z', updatedAt: '2026-09-21T09:00:00Z',
}

const { context, page } = await profile('2026-09-21T10:00:00Z')

console.log('\nOn 21 Sep 2026, before Reality Fracture is out')
{
  const askedBefore = []
  await page.route('**/api.scryfall.com/cards/collection', collection(CARDS, askedBefore))
  await saveAndOpen(page, DECK)
  const saved = await storedDeck(page, DECK.id)
  check('the launch watch takes its first snapshot of the deck, from the data of the day',
    saved?.snapshot?.cards?.[PHOENIX.id]?.status === 'not_legal' && saved.snapshot.cards[BOLT.id]?.status === 'legal'
      && saved.snapshot.capturedAt?.startsWith('2026-09-21'), JSON.stringify(saved?.snapshot ?? null).slice(0, 300))
  const v = await verdict(page)
  check('the deck says its four Phoenixes are not out yet', v.text === '4 cards not out yet', v.text)
  check('every card was asked for by id', [...new Set(askedBefore.flat())].sort().join() === [MOUNTAIN.id, BOLT.id, PHOENIX.id].sort().join(),
    JSON.stringify(askedBefore))
}

console.log('\nOn 2 Oct 2026, half an hour after midnight UTC, the day Reality Fracture comes out')
{
  let open
  const gate = new Promise((resolve) => { open = resolve })
  const askedAfter = []
  await page.route('**/api.scryfall.com/cards/collection', collection(RELEASE_DAY, askedAfter, gate))
  await page.clock.setSystemTime(new Date('2026-10-02T00:30:00Z'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  const clock = await page.evaluate(() => new Date().toISOString())
  check('the page reads the release day', clock.startsWith('2026-10-02'), clock)

  await page.locator('.deck-title').waitFor()
  await page.waitForTimeout(900)
  const cached = await verdict(page)
  check('what was saved shows at once, the Phoenixes with legality not known rather than failed',
    cached.text === '4 cards with legality not known' && /\bchip--warn\b/.test(cached.className), `${cached.text} [${cached.className}]`)
  const note = (await page.locator('.banner--warn').allInnerTexts()).join(' | ')
  check('and the deck says why, as what the data on this device says',
    note.includes('Darklight Phoenix came out on 2 Oct 2026, but the Scryfall data on this device lists it as legal in no format, as Scryfall does before a release, so the app does not know whether it is Modern-legal.'), note)
  const refreshed = [...new Set(askedAfter.flat())].sort().join()
  check('the saved records are asked for again, by id, in the background',
    refreshed === [MOUNTAIN.id, BOLT.id, PHOENIX.id].sort().join(), JSON.stringify(askedAfter))

  open()
  await page.waitForFunction(() => /problem/.test(document.querySelector('.chip--error')?.textContent ?? ''), null, { timeout: 10000 })
    .catch(() => {})
  const now = await verdict(page)
  check("Scryfall's current word arrives and the deck is drawn again: the Bolt ban is a problem",
    now.text === '1 problem' && /\bchip--error\b/.test(now.className), `${now.text} [${now.className}]`)
  const problems = (await page.locator('.violation-list li').allInnerTexts()).join(' | ')
  check('and the Phoenix is no longer mentioned', /Lightning Bolt is banned in Modern/.test(problems) && !/Phoenix/.test(problems), problems)

  await page.getByRole('button', { name: '← Decks' }).click()
  await watchBanner(page).waitFor({ timeout: 10000 }).catch(() => {})
  const banner = watchBanner(page)
  check('the launch watch announces the ban', (await banner.count()) === 1
    && (await banner.locator('strong').innerText()).trim() === '1 card in your deck is no longer playable.',
  (await page.locator('.banner').allInnerTexts()).join(' | '))
  if (await banner.count()) {
    await banner.getByRole('button', { name: 'Details' }).click()
    await page.waitForTimeout(300)
    const details = (await banner.innerText()).replace(/\s+/g, ' ')
    check('and only the ban: a card coming out is not news',
      details.includes('Lightning Bolt has been banned in Modern.') && !/Phoenix|more playable|now legal/.test(details), details)
    check('it dates the data it compared, rather than calling it current',
      details.includes('Checked against Scryfall data from 2 Oct 2026, not a list baked into this app.') && !/current/.test(details), details)
    await axe(page, 'the shelf with the watch\'s details open')
  }
  const saved = await storedDeck(page, DECK.id)
  check('and takes a new snapshot, so each change is told once',
    saved?.snapshot?.cards?.[BOLT.id]?.status === 'banned' && saved.snapshot.cards[PHOENIX.id]?.status === 'legal'
      && saved.name === DECK.name && saved.main.length === 3, JSON.stringify(saved?.snapshot ?? null).slice(0, 300))
}
await context.close()

// A Standard deck of Mountains and four Phoenixes, legal but for the card
// not being out. Scryfall's record of the Phoenix on 21 Sep says not_legal in
// Standard and legal in Future Standard, which is what gets saved.
const STANDARD_DECK = {
  id: 'rift-standard', name: 'Rift Standard', formatId: 'standard', commanders: [], signatureSpell: null,
  categoryOrder: [], versions: [],
  main: [{ cardId: MOUNTAIN.id, quantity: 56 }, { cardId: PHOENIX.id, quantity: 4 }],
  sideboard: [], createdAt: '2026-09-21T09:00:00Z', updatedAt: '2026-09-21T09:00:00Z',
}

/**
 * The Standard deck saved on 1 Oct 2026 at 20:00 UTC in a fresh profile, and
 * opened again in the same profile on 2 Oct at 10:00 UTC with Scryfall's
 * collection endpoint answering from `releaseDay`. Fourteen hours on, no
 * record is due for its age; the Phoenix is due only because it was fetched
 * before its release day began. Returns once the refreshed Phoenix has been
 * saved on the device, or the wait for it has run out, with the ids of each
 * collection request made on release day.
 */
async function standardDeckOnReleaseDay(releaseDay) {
  const run = await profile('2026-10-01T20:00:00Z')
  const { page: p } = run
  const before = []
  await p.route('**/api.scryfall.com/cards/collection', collection(CARDS, before))
  await saveAndOpen(p, STANDARD_DECK)
  const v = await verdict(p)
  check('on 1 Oct the deck says its four Phoenixes are not out yet, a warning',
    v.text === '4 cards not out yet' && /\bchip--warn\b/.test(v.className), `${v.text} [${v.className}]`)
  const saved = await savedRecord(p, PHOENIX.id)
  check("the device keeps Scryfall's pre-release record: not_legal in Standard, legal in Future Standard, fetched on 1 Oct",
    dayOf(saved?.fetchedAt) === '2026-10-01' && saved.legalities?.standard === 'not_legal' && saved.legalities?.future === 'legal',
    JSON.stringify(saved))

  const after = []
  await p.route('**/api.scryfall.com/cards/collection', collection(releaseDay, after))
  await p.clock.setSystemTime(new Date('2026-10-02T10:00:00Z'))
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.locator('.deck-title').waitFor()
  const landed = await until(async () => dayOf((await savedRecord(p, PHOENIX.id))?.fetchedAt) === '2026-10-02')
  // The deck is drawn again once the refreshed cards are in.
  await p.waitForTimeout(800)
  await p.getByRole('tab', { name: 'List' }).click()
  await p.waitForTimeout(400)
  return { ...run, after, landed }
}

/** The Phoenix's row in the deck list, and whether it is marked as a problem. */
async function phoenixRow(page) {
  const row = page.locator('.deck-row').filter({ has: page.locator('.deck-row__name', { hasText: /^Darklight Phoenix$/ }) })
  return {
    count: await row.count(),
    flagged: /\bdeck-row--flagged\b/.test((await row.first().getAttribute('class').catch(() => '')) ?? ''),
    label: (await row.locator('.not-out').count()) ? (await row.locator('.not-out').first().innerText()).trim() : '',
  }
}

/** The shelf once the launch watch has taken its release-day snapshot, and the snapshot it took. */
async function shelfAfterWatch(page, deckId) {
  await page.getByRole('button', { name: '← Decks' }).click()
  await until(async () => (await storedDeck(page, deckId))?.snapshot?.capturedAt?.startsWith('2026-10-02'))
  await page.waitForTimeout(400)
  return (await storedDeck(page, deckId))?.snapshot ?? null
}

console.log('\nA Standard deck saved on the evening of 1 Oct, opened on 2 Oct with Scryfall listing the Phoenix as legal')
{
  const { context: ctx, page: p, after, landed } = await standardDeckOnReleaseDay([MOUNTAIN, PHOENIX_OUT])
  const phoenixAsked = after.filter((ids) => ids.includes(PHOENIX.id))
  check('on release day the app asks Scryfall about the Phoenix again, by its id',
    phoenixAsked.length >= 1 && after.flat().every((id) => CARDS.some((c) => c.id === id)),
    JSON.stringify(after))
  check('and not about the Mountain, out since August and fetched hours ago: the release-day rule, not the weekly one',
    !after.flat().includes(MOUNTAIN.id), JSON.stringify(after))
  console.log(`        ${phoenixAsked.length} collection request(s) named it; ${after.length} in all`)
  const saved = await savedRecord(p, PHOENIX.id)
  check("and keeps Scryfall's answer on the device, dated release day: legal in Standard",
    landed && saved?.legalities?.standard === 'legal', JSON.stringify(saved))
  await until(async () => (await verdict(p)).text === 'Legal')
  const v = await verdict(p)
  check('the deck is plainly legal', v.text === 'Legal' && /\bchip--ok\b/.test(v.className), `${v.text} [${v.className}]`)
  const warnings = await p.locator('.banner--warn, .banner--error').allInnerTexts()
  check('with no not-out and no legality warning anywhere on the deck',
    warnings.length === 0 && (await p.locator('.not-out').count()) === 0, warnings.join(' | '))
  const row = await phoenixRow(p)
  check("the Phoenix's row is neither labelled nor marked", row.count === 1 && !row.flagged && row.label === '', JSON.stringify(row))
  await axe(p, 'the deck editor, legal on release day')

  const snapshot = await shelfAfterWatch(p, STANDARD_DECK.id)
  check('the launch watch has compared the deck on release day, with the Phoenix now legal',
    snapshot?.cards?.[PHOENIX.id]?.status === 'legal', JSON.stringify(snapshot).slice(0, 300))
  check('and says nothing: the Phoenix coming out is not announced as becoming playable',
    (await watchBanner(p).count()) === 0 && !/Phoenix/.test(await p.locator('main').innerText()),
    (await p.locator('.banner').allInnerTexts()).join(' | '))
  await ctx.close()
}

console.log('\nThe same deck on 2 Oct with Scryfall still saying what it said before release')
{
  const { context: ctx, page: p, after, landed } = await standardDeckOnReleaseDay(CARDS)
  const phoenixAsked = after.filter((ids) => ids.includes(PHOENIX.id))
  check('on release day the app asks Scryfall about the Phoenix again, by its id',
    phoenixAsked.length >= 1 && after.flat().every((id) => CARDS.some((c) => c.id === id)),
    JSON.stringify(after))
  check('and not about the Mountain: the release-day rule, not the weekly one',
    !after.flat().includes(MOUNTAIN.id), JSON.stringify(after))
  console.log(`        ${phoenixAsked.length} collection request(s) named it; ${after.length} in all`)
  const saved = await savedRecord(p, PHOENIX.id)
  check("and saves Scryfall's answer, dated release day, though it still says not_legal in Standard",
    landed && saved?.legalities?.standard === 'not_legal', JSON.stringify(saved))
  const v = await verdict(p)
  check('the verdict says the Phoenixes have legality not known, a warning and not an error',
    v.text === '4 cards with legality not known' && /\bchip--warn\b/.test(v.className) && !/\bchip--error\b/.test(v.className),
    `${v.text} [${v.className}]`)
  const warning = (await p.locator('.banner--warn').allInnerTexts()).join(' | ')
  check('the deck gives the warning as what the data on this device says, promising nothing',
    warning.includes('Darklight Phoenix came out on 2 Oct 2026, but the Scryfall data on this device lists it as legal in no format, as Scryfall does before a release, so the app does not know whether it is Standard-legal.')
      && !/\byet\b|each day/.test(warning), warning)
  check('and no error: the deck is not called illegal',
    (await p.locator('.banner--error').count()) === 0, await p.locator('.banner--error').innerText().catch(() => ''))
  const row = await phoenixRow(p)
  check("the Phoenix's row is not marked as a problem, and no longer says it is not out",
    row.count === 1 && !row.flagged && row.label === '', JSON.stringify(row))
  await axe(p, 'the deck editor with the catching-up warning')

  await p.locator('.deck-row__name', { hasText: /^Darklight Phoenix$/ }).click()
  const sheet = p.getByRole('dialog', { name: 'Darklight Phoenix' })
  await sheet.waitFor()
  await p.waitForTimeout(300)
  await sheet.getByRole('tab', { name: 'Legality', exact: true }).click()
  await p.waitForTimeout(400)
  const statuses = {}
  for (const r of await sheet.locator('.legality').all()) {
    const [format, status] = (await r.locator('span').allTextContents()).map((t) => t.trim())
    statuses[format] = status
  }
  const legalityNote = (await sheet.locator('.legality-grid + p').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  check("its page reads Not known here in Standard, not Not in pool, and not Not out yet",
    statuses.Standard === 'Not known here' && !Object.values(statuses).includes('Not out yet'), JSON.stringify(statuses))
  check('and says so as what the data on this device says, promising a daily check only for deck cards',
    legalityNote.startsWith('Came out on 2 Oct 2026. The Scryfall data on this device lists it as legal in no format')
      && legalityNote.includes('Cards in your decks are checked against Scryfall again each day for the week after a release.')
      && !/listed as legal yet|the app checks Scryfall/.test(legalityNote), legalityNote)
  const footer = (await sheet.locator('.legality-grid ~ p.faint').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('and does not call the data beside it current', /From Scryfall, not a copy baked into this app\./.test(footer) && !/current/.test(footer), footer)
  const toDeck = sheet.locator('.detail-layout__art button', { hasText: 'Standard' })
  check('adding it to the Standard deck is not marked illegal, and says, where it can be seen, that its legality is not known',
    (await toDeck.count()) === 1 && (await toDeck.locator('.chip--error').count()) === 0
      && (await toDeck.locator('.chip--warn', { hasText: 'legality not known' }).isVisible().catch(() => false)),
    await toDeck.innerText().catch(() => 'no deck row'))
  await axe(p, "the card's Legality tab while its data catches up")
  await sheet.getByRole('button', { name: 'Close' }).click()
  await p.waitForTimeout(300)

  const snapshot = await shelfAfterWatch(p, STANDARD_DECK.id)
  check('the launch watch has compared the deck on release day', !!snapshot?.cards?.[PHOENIX.id], JSON.stringify(snapshot).slice(0, 300))
  check('and announces nothing', (await watchBanner(p).count()) === 0, (await p.locator('.banner').allInnerTexts()).join(' | '))
  await ctx.close()
}

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
