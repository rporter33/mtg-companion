#!/usr/bin/env node
/**
 * Browser checks for deck import and the commanders browser.
 *
 * The important assertion is a negative one: pasting a Moxfield link must not
 * cause a request to Moxfield. The app has no backend and Moxfield publishes no
 * browser-readable API, so the honest behaviour is to explain the Export route
 * rather than attempt something that cannot work.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const card = (name, over = {}) => ({
  object: 'card', id: name.toLowerCase().replace(/\W+/g, '-'), oracle_id: `o-${name}`,
  name, mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Bear', oracle_text: '',
  color_identity: ['G'], colors: ['G'], rarity: 'common', set: 'fra', set_name: 'Reality Fracture',
  legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over,
})

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } })
const errors = []
const requestedHosts = new Set()
page.on('pageerror', (e) => errors.push(e.message))
page.on('request', (r) => {
  try { requestedHosts.add(new URL(r.url()).hostname) } catch { /* ignore */ }
})

await page.route('**/api.scryfall.com/sets', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', data: [
    { code: 'fra', name: 'Reality Fracture', released_at: '2026-10-02', set_type: 'expansion',
      icon_svg_uri: '', card_count: 291, digital: false },
    { code: 'hob', name: 'The Hobbit', released_at: '2026-08-14', set_type: 'expansion',
      icon_svg_uri: '', card_count: 281, digital: false },
  ] }) }))
await page.route('**/api.scryfall.com/cards/search**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', total_cards: 2, has_more: false, data: [
    card('Test Commander One', { type_line: 'Legendary Creature — Elf' }),
    card('Test Commander Two', { type_line: 'Legendary Creature — Bear' }),
  ] }) }))
await page.route('**/api.scryfall.com/cards/named**', (route) => {
  namedCalls++
  const name = new URL(route.request().url()).searchParams.get('fuzzy')
    ?? new URL(route.request().url()).searchParams.get('exact')
  if (/nonexistent/i.test(name ?? '')) {
    return route.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ object: 'error', status: 404, details: 'No card found' }) })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(card(name)) })
})
// The importer resolves names in bulk through the collection endpoint. A name
// containing "nonexistent" comes back in not_found, exactly as Scryfall does it,
// so the fuzzy fall-back and the failure reporting both get exercised.
let collectionCalls = 0
let namedCalls = 0
const printingNames = {}
await page.route('**/api.scryfall.com/cards/collection', async (route) => {
  collectionCalls++
  const { identifiers } = JSON.parse(route.request().postData() ?? '{"identifiers":[]}')
  const data = []
  const not_found = []
  for (const id of identifiers) {
    // A printing identifier, as an Archidekt or Moxfield line produces. The
    // mock knows a few printings by number; "zzz" is a set Scryfall never heard of.
    if (id.collector_number) {
      if (id.set === 'zzz') { not_found.push(id); continue }
      const name = printingNames[`${id.set}/${id.collector_number}`] ?? `Printed ${id.set} ${id.collector_number}`
      data.push(card(name, {
        set: id.set, collector_number: id.collector_number,
        ...(/legend/i.test(name) ? { type_line: 'Legendary Creature — Human' } : {}),
      }))
      continue
    }
    const { name } = id
    if (/nonexistent/i.test(name)) not_found.push({ name })
    else if (/legend/i.test(name)) data.push(card(name, { type_line: 'Legendary Creature — Human' }))
    else data.push(card(name))
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ object: 'list', data, not_found }) })
})

await page.route('**/api.scryfall.com/cards/autocomplete**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: ['Nonexistent Suggestion A', 'Nonexistent Suggestion B'] }) }))

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

console.log('\nCommanders browser')
check('it lists commanders from the newest sets',
  (await page.locator('.commander').count()) >= 2,
  String(await page.locator('.commander').count()))
const setChips = await page.locator('.commander-grid').count()
check('both the upcoming and current set are offered',
  (await page.getByRole('button', { name: 'Reality Fracture' }).count()) >= 1
  && (await page.getByRole('button', { name: 'The Hobbit' }).count()) >= 1)
// The per-commander "See a deck" button only fires when a shipped deck shares a
// commander with the set on screen, which for most sets is none of them. The
// list below it is the only thing that makes the examples reachable at all.
const exampleChips = page.locator('.chip', { hasText: /\(\d+\)$/ })
check('the shipped example decks are listed where they can be opened',
  (await exampleChips.count()) >= 1,
  `${await exampleChips.count()} example chips`)
check('the empty-state message is gone now that examples ship',
  !/No example decklists are shipped yet/.test(await page.locator('body').innerText()))



console.log('\nStarting a deck from a commander')
await page.locator('.commander .btn').first().click()
await page.waitForTimeout(700)
check('it creates a deck and opens it',
  (await page.locator('.deck-title').count()) === 1,
  await page.locator('.deck-title').inputValue().catch(() => 'no title field'))

console.log('\nPasting a Moxfield link')
await page.getByRole('tab', { name: 'Import / export' }).click()
await page.waitForTimeout(300)
const box = page.locator('textarea').first()
await box.fill('https://moxfield.com/decks/JAJNhQHxg0qfdq4ULGcj5g')
await page.waitForTimeout(300)
const body = await page.locator('body').innerText()
check('it names the site and says why it cannot read it',
  /Moxfield does not let other sites read decks/.test(body), body.slice(0, 200))
check('it says exactly which button to press instead', /Export/.test(body))
check('the import button is disabled rather than failing on press',
  await page.getByRole('button', { name: /Review import|Fetch this deck/ }).isDisabled())
check('no request was made to moxfield',
  ![...requestedHosts].some((h) => /moxfield/.test(h)),
  [...requestedHosts].join(', '))

console.log('\nPreview before anything is written')
await box.fill('2 Test Card\n1 Nonexistent Card')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Review import' }).click()
await page.waitForTimeout(1200)
check('it shows what will land before writing', /Before anything is added/.test(await page.locator('body').innerText()))
check('it reports the card it could not find',
  (await page.locator('.chip--warn').filter({ hasText: 'not found' }).count()) === 1)
check('it offers close matches for the failure',
  (await page.getByRole('button', { name: /Nonexistent Suggestion/ }).count()) >= 1)

const before = await page.locator('.deck-row').count()
check('nothing has been added to the deck yet', before === 0, String(before))

await page.getByRole('button', { name: /Add \d+ cards/ }).click()
await page.waitForTimeout(600)
await page.getByRole('tab', { name: 'List' }).click()
await page.waitForTimeout(400)
check('confirming adds the cards', (await page.locator('.deck-row').count()) > 0)

console.log('\nOpening a shipped example')
await page.locator('.app__nav button', { hasText: 'Learn' }).click()
await page.waitForTimeout(600)
const example = page.locator('.chip', { hasText: /\(\d+\)$/ }).first()
const exampleName = await example.innerText()
await example.click()
await page.waitForTimeout(900)
const loaded = await page.locator('textarea').first().inputValue()
const cardLines = loaded.split('\n').filter((l) => /^\d+\s/.test(l))
const totalCards = cardLines.reduce((n, l) => n + Number(l.match(/^(\d+)/)[1]), 0)
check('opening an example loads its whole list, not a summary',
  totalCards >= 99 && totalCards <= 100,
  `${exampleName.replace(/\s+/g, ' ')} -> ${totalCards} cards over ${cardLines.length} lines`)
check('the example arrives with its commander named',
  /^Commander\n/.test(loaded), JSON.stringify(loaded.slice(0, 60)))

console.log('\nA whole Commander deck at once')
{
  // The importer used to resolve one card per request, sequentially and rate
  // limited. Ninety-nine names was ninety-nine round trips before the first
  // result appeared — twenty seconds when nothing went wrong, and unbounded
  // once a rate limit started the backoff compounding. It read as a hang.
  const names = Array.from({ length: 99 }, (_, i) => `1 Bulk Card ${i}`).join('\n')
  await page.getByRole('tab', { name: 'Import / export' }).click()
  await page.waitForTimeout(300)
  const bulkBox = page.locator('textarea').first()
  collectionCalls = 0
  namedCalls = 0

  const started = Date.now()
  await bulkBox.fill(names)
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Review import' }).click()
  await page.getByRole('button', { name: /Add \d+ cards/ }).waitFor({ timeout: 20000 })
  const elapsed = Date.now() - started

  check('ninety-nine names resolve in two requests, not ninety-nine',
    collectionCalls === 2, `${collectionCalls} collection calls, ${namedCalls} single lookups`)
  check('nothing falls back to per-card lookups when every name is known',
    namedCalls === 0, `${namedCalls} single lookups`)
  check('the preview is ready in a couple of seconds', elapsed < 6000, `${elapsed}ms`)
  check('every card is accounted for',
    /99 cards found/.test(await page.locator('body').innerText()),
    (await page.locator('.chip--ok').first().innerText().catch(() => '?')))

  await page.getByRole('button', { name: /Add \d+ cards/ }).click()
  await page.waitForTimeout(800)
}

console.log('\nA list with no Commander line')
{
  // What a Moxfield or EDHREC copy actually looks like: no section headers, the
  // commander just another line. It used to import as a hundred cards with an
  // empty command zone and a legality error the reader could not obviously fix.
  await page.getByRole('tab', { name: 'Import / export' }).click()
  await page.waitForTimeout(300)
  const noHeader = page.locator('textarea').first()
  await noHeader.fill('1 Headless Legend\n1 Plain Spell\n1 Another Spell')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Review import' }).click()
  await page.getByRole('button', { name: /Add \d+ cards/ }).waitFor({ timeout: 15000 })

  const offered = page.locator('.chip', { hasText: 'Headless Legend' })
  check('it offers the legendary creature as the commander', (await offered.count()) > 0,
    await page.locator('body').innerText().then((t) => t.slice(0, 0)) || '')
  check('it does not offer a non-legendary card',
    (await page.locator('.chip', { hasText: 'Plain Spell' }).count()) === 0)
}

console.log('\nAn Archidekt export, pasted as it is')
{
  // The real line that surfaced this: "1x Teshar, Ancestor's Apostle (soc) 180
  // [Creature]". The printing sits before the category, so the old stripper
  // never removed it, every name missed the bulk lookup, and ninety-nine names
  // went through the slow path one at a time under "checking the last few".
  Object.assign(printingNames, {
    'soc/1': 'Import Legend', 'soc/2': 'Ramp Rock', 'soc/3': 'Plain Type',
  })
  await page.getByRole('tab', { name: 'Import / export' }).click()
  await page.waitForTimeout(300)
  const archidekt = page.locator('textarea').first()
  collectionCalls = 0
  namedCalls = 0
  await archidekt.fill([
    '1x Import Legend (soc) 1 [Commander{top}]',
    '1x Ramp Rock (soc) 2 [Ramp]',
    '1x Plain Type (soc) 3 [Creature]',
    '1x Fallback Card (zzz) 9 [Instant]',
  ].join('\n'))
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Review import' }).click()
  await page.getByRole('button', { name: /Add \d+ cards/ }).waitFor({ timeout: 15000 })
  const text = await page.locator('body').innerText()

  check('every line resolves', /4 cards found/.test(text) && !/not found/.test(text),
    text.match(/\d+ cards found[^\n]*/)?.[0])
  check('printings are looked up as printings, in bulk, and an unknown one falls back by name',
    collectionCalls === 2 && namedCalls === 0, `${collectionCalls} collection calls, ${namedCalls} single lookups`)
  check('the preview says which lines matched their exact printing', /3 exact printings/.test(text))
  check('the preview names the section kept from the export', /1 section kept: Ramp/.test(text))
  check("Archidekt's commander marker is read, so no commander is asked for",
    !/This list has no Commander line/.test(text))

  await page.getByRole('button', { name: /Add \d+ cards/ }).click()
  await page.waitForTimeout(600)
  await page.getByRole('tab', { name: 'List' }).click()
  await page.waitForTimeout(500)
  const titles = await page.locator('.section-title').allInnerTexts()
  check('the export\'s own section exists in the list', titles.some((t) => /^Ramp/.test(t)), titles.join(' | '))
  check("Archidekt's default type category does not become a section of its own",
    !titles.some((t) => /^Creature\b/.test(t)), titles.join(' | '))
  const commanderSection = page.locator('section').filter({ has: page.locator('h2', { hasText: /^Commander/ }) })
  check('the marked card is the commander',
    /Import Legend/.test(await commanderSection.innerText().catch(() => '')),
    await commanderSection.innerText().catch(() => 'no commander section'))
}

console.log('\nEvery line names the printing it adds')
{
  // A bare name gets Scryfall's pick for it, and Scryfall lists a set's
  // cards before the set is out. The dates are counted from today, so "not
  // out" stays not out however long after this was written the suite runs.
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
  const upcoming = { set: 'trk', set_name: 'Star Trek', released_at: day(60), type_line: 'Basic Land — Island' }
  const previews = {
    'Preview Island': card('Preview Island', { ...upcoming, oracle_id: 'o-preview-island', collector_number: '319' }),
    'Preview Only': card('Preview Only', { ...upcoming, oracle_id: 'o-preview-only', collector_number: '12' }),
  }
  const released = card('Preview Island', {
    ...upcoming, id: 'released-island', oracle_id: 'o-preview-island',
    set: 'hob', set_name: 'The Hobbit', collector_number: '195', released_at: day(-60),
  })
  const answer = (id) => (id.collector_number
    ? (id.set === 'trk' && id.collector_number === '319' ? previews['Preview Island'] : null)
    : previews[id.name])
  // Later routes run first; anything these do not recognise goes on to the
  // mocks above.
  await page.route('**/api.scryfall.com/cards/collection', (route) => {
    const { identifiers } = JSON.parse(route.request().postData() ?? '{"identifiers":[]}')
    if (!identifiers.length || !identifiers.every(answer)) return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ object: 'list', data: identifiers.map(answer), not_found: [] }) })
  })
  const searched = []
  await page.route('**/api.scryfall.com/cards/search**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    if (!q.includes('oracleid:')) return route.fallback()
    searched.push(q)
    const data = q.includes('oracleid:o-preview-island') ? [released] : []
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ object: 'list', total_cards: data.length, has_more: false, data }) })
  })

  await page.getByRole('tab', { name: 'Import / export' }).click()
  await page.waitForTimeout(300)
  await page.locator('textarea').first().fill('4 Preview Island\n1 Preview Only\n2 Preview Island (TRK) 319')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Review import' }).click()
  await page.getByRole('button', { name: /Add \d+ cards/ }).waitFor({ timeout: 15000 })

  const lines = await page.locator('.import-line').allInnerTexts()
  const flat = lines.map((l) => l.replace(/\s+/g, ' '))
  check('the review has one line per card', lines.length === 3, flat.join(' | '))
  check('a bare name that Scryfall gave a preview for lands on the newest printing that is out, and says why',
    /The Hobbit #195/.test(flat[0])
      && /Scryfall's pick for the name, Star Trek, is not out until \d{1,2} \S+ \d{4}, so the app took the newest paper printing that is out/.test(flat[0])
      && !/Not out until/.test(flat[0]), flat[0])
  check('a card with no printing out yet keeps its preview, labelled, and says so',
    /Star Trek #12/.test(flat[1]) && /Not out until/.test(flat[1])
      && /Scryfall lists no paper printing of it that is out yet/.test(flat[1]), flat[1])
  check('a printing the list named is kept as it is, with the label and no note',
    /Star Trek #319/.test(flat[2]) && /Not out until/.test(flat[2]) && !/Scryfall/.test(flat[2]), flat[2])
  check('the cards to pass over are asked about in one search', searched.length === 1, searched.join(' | '))

  await page.getByRole('button', { name: /Add \d+ cards/ }).click()
  await page.waitForTimeout(600)
  const exported = await page.getByLabel('This deck as a plain text list').inputValue()
  check('the two printings stay two entries, and the export names each one',
    /^4 Preview Island \(HOB\) 195$/m.test(exported) && /^2 Preview Island \(TRK\) 319$/m.test(exported)
      && /^1 Preview Only \(TRK\) 12$/m.test(exported),
    exported.split('\n').filter((l) => /Preview/.test(l)).join(' | '))
}

console.log('\nExamples survive Scryfall being unreachable')
{
  // They lived inside the commanders browser, which renders nothing without a
  // set list — so losing the network took the offline content down with the
  // online content, in an app whose whole claim is that it works offline.
  const offline = await browser.newPage({ viewport: { width: 420, height: 1000 } })
  await offline.route('**/api.scryfall.com/**', (route) => route.abort())
  await offline.goto(TARGET, { waitUntil: 'domcontentloaded' })
  await offline.waitForTimeout(1200)
  await offline.locator('.app__nav button', { hasText: 'Learn' }).click()
  await offline.waitForTimeout(700)
  const chips = await offline.locator('.chip', { hasText: /\(\d+\)$/ }).count()
  check('the example decks still render with no network', chips > 0, `${chips} chips`)
  check('the commanders browser is absent rather than broken',
    (await offline.locator('.commander').count()) === 0)
  await offline.close()
}

check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
