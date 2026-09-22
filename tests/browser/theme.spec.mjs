#!/usr/bin/env node
/**
 * The shell follows the season. While Reality Fracture is the focus set the
 * whole app wears its curated theme — indigo shell, cyan accent, the set's
 * own art and voice on the banner, Hexhaven's schools beside the colours —
 * and when the season points elsewhere the core shell is back, gold accent
 * and all, with nothing to undo. Fonts are self-hosted and must resolve
 * under the app's real base path.
 *
 * The page's clock is held on a fixed day for each case, so the spec means
 * the same after these dates as before them. Around Reality Fracture's
 * release (2 Oct 2026) the focus stays on it until Star Trek (13 Nov) is
 * nearer in days: Reality Fracture on its release day and still on 22 Oct,
 * Star Trek from 24 Oct. axe runs over each of those states.
 */

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url))
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}
const setsPayload = (list) => JSON.stringify({ object: 'list', data: list })
const FRA = { code: 'fra', name: 'Reality Fracture', released_at: '2026-10-02', set_type: 'expansion', icon_svg_uri: '', card_count: 291, digital: false }
const HOB = { code: 'hob', name: 'The Hobbit', released_at: '2026-08-14', set_type: 'expansion', icon_svg_uri: '', card_count: 281, digital: false }
const OTHER = { code: 'zzz', name: 'Some Other Set', released_at: '2026-11-20', set_type: 'expansion', icon_svg_uri: '', card_count: 250, digital: false }
const TRK = { code: 'trk', name: 'Star Trek', released_at: '2026-11-13', set_type: 'expansion', icon_svg_uri: '', card_count: 135, digital: false }
// Released beside Reality Fracture, and never the season's focus.
const FRC = { code: 'frc', name: 'Reality Fracture Commander', released_at: '2026-10-02', set_type: 'commander', icon_svg_uri: '', card_count: 100, digital: false }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []
const failedRequests = []
/**
 * A fresh browser profile on the Learn screen, its clock reading `day` at
 * 10:00 UTC and moving on from there, with Scryfall's set list answering
 * `sets` and everything else empty.
 */
const open = async (sets, { viewport = { width: 1200, height: 900 }, day = '2026-09-21' } = {}) => {
  const context = await browser.newContext({ viewport })
  await context.clock.install({ time: new Date(`${day}T10:00:00Z`) })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${day}: ${m.text()} (${m.location()?.url ?? ''})`) })
  // A request the browser cancelled because the page navigated away is not
  // an asset that failed to load; the hero picture's larger source can still
  // be in flight when the spec moves on to the next screen.
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return
    failedRequests.push(`${r.url()} (${r.failure()?.errorText})`)
  })
  page.on('response', (r) => { if (r.status() >= 400 && !/api\.scryfall\.com/.test(r.url())) failedRequests.push(`${r.status()} ${r.url()}`) })
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
  await page.route('**/api.scryfall.com/sets', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: setsPayload(sets) }))
  await page.goto(`${TARGET}#/guide`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  return page
}
const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

// After release the curated entries say they have not been checked against
// the released cards until the owner records a check (`checkedAt`), and then
// say when. A check can be recorded on release day itself, so from then on
// either sentence is right, and either is accepted.
const CHECK = '(not yet checked against the released cards|checked against the released cards on \\d{1,2} [A-Z][a-z]{2,3} \\d{4})'

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

console.log('\nWhile Reality Fracture is the focus set')
{
  const page = await open([FRA, HOB])
  check('the root wears the set theme', (await page.evaluate(() => document.documentElement.dataset.themeSet)) === 'fra')
  check('the accent is the set\'s cyan, app-wide', /77e4ef/i.test(await cssVar(page, '--accent')), await cssVar(page, '--accent'))
  check('the shell is the indigo void, not charcoal', /080812/i.test(await cssVar(page, '--bg')), await cssVar(page, '--bg'))
  check('headings take the set\'s theory face', /Cormorant/.test(await cssVar(page, '--font-heading')), await cssVar(page, '--font-heading'))
  const banner = page.locator('.season')
  check('the banner names the set by its official title', /Reality Fracture/.test(await banner.innerText()) && !/Shattered Reality/.test(await banner.innerText()))
  check('and speaks in the set\'s voice', /One world\. Another possibility\./.test(await banner.innerText()))
  check('and says its colours and lore are the app\'s reading, not official', /not official/.test(await banner.innerText()))
  await banner.getByRole('button', { name: /What.s new/ }).click()
  const whatsNew = await page.getByRole('dialog').innerText().catch(() => '')
  check('What\'s new says it is provisional until the set is out', /Provisional\./.test(whatsNew) && /comes out on 2 Oct 2026/.test(whatsNew), whatsNew.slice(-400))
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  const art = banner.locator('.hero-art img')
  check('the banner carries the set\'s own artwork, decorative and loaded',
    (await art.count()) === 1 && (await art.getAttribute('alt')) === '' && await art.evaluate((img) => img.complete && img.naturalWidth > 0))
  check('the artwork is the wide export on a desktop', /echoverse-hero(-1280)?\.webp$/.test(await art.evaluate((img) => img.currentSrc)), await art.evaluate((img) => img.currentSrc))
  // A swap-loaded face is fetched only when something uses it, so each is
  // asked for explicitly: the point is that the files resolve under the base.
  const fonts = await page.evaluate(async () => {
    const out = []
    for (const f of ['Source Sans 3', 'Cormorant Garamond', 'Cinzel', 'IBM Plex Mono', 'Source Serif 4']) {
      const faces = await document.fonts.load(`16px "${f}"`).catch(() => [])
      out.push([f, faces.length > 0 && document.fonts.check(`16px "${f}"`)])
    }
    return out
  })
  check('the self-hosted fonts loaded under the app\'s base path', fonts.every(([, ok]) => ok), JSON.stringify(fonts))
  await page.context().close()

  const phone = await open([FRA, HOB], { viewport: { width: 390, height: 844 } })
  const art2 = phone.locator('.season .hero-art img')
  check('on a phone the banner uses the portrait export', /sanctum-portrait-(480|768)\.webp$/.test(await art2.evaluate((img) => img.currentSrc)), await art2.evaluate((img) => img.currentSrc))
  check('nothing scrolls sideways', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await phone.context().close()
}

console.log('\nHexhaven beside the colours')
{
  const page = await open([FRA, HOB])
  await page.goto(`${TARGET}#/decks/new`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const dial = page.getByLabel('Colour dial')
  await dial.fill('50')
  await page.waitForTimeout(200)
  const school = page.locator('.school')
  check('a pair shows its school, with name, discipline, virtue and horror', /Fatehold/.test(await school.innerText()) && /Future History/.test(await school.innerText()) && /Virtue:/.test(await school.innerText()) && /Horror:/.test(await school.innerText()), await school.innerText().catch(() => 'no school block'))
  check('the emblem is decorative and the name is text beside it', (await school.locator('img[alt=""]').count()) === 1)
  await dial.fill('0')
  await page.waitForTimeout(200)
  const page1 = page.locator('.colour-page').first()
  check('a single colour names the two schools it belongs to', /Fatehold/.test(await page1.innerText()) && /Vigorbloom/.test(await page1.innerText()), await page1.innerText())
  check('each colour page carries its emblem beside its name', (await page1.locator('.colour-page__emblem').count()) === 1)
  await page.getByRole('button', { name: 'Theorix' }).count()
  await page.context().close()
}

/** The first-deck colours step on the Selesnya-to-Azorius end of the dial: white, then the pair. */
const firstDeckSchools = async (page) => {
  await page.goto(`${TARGET}#/decks/new`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const dial = page.getByLabel('Colour dial')
  await dial.fill('0')
  await page.waitForTimeout(200)
  const white = await page.locator('.colour-page').first().innerText()
  await dial.fill('50')
  await page.waitForTimeout(200)
  return { white, pairSchools: await page.locator('.school').count(), pairText: await page.locator('.colour-pages').innerText() }
}

console.log('\nThe day Reality Fracture comes out (2 Oct 2026)')
{
  const page = await open([HOB, FRA, FRC, TRK], { day: '2026-10-02' })
  check('the root still wears the set theme, its cyan accent and all',
    (await page.evaluate(() => document.documentElement.dataset.themeSet)) === 'fra' && /77e4ef/i.test(await cssVar(page, '--accent')),
    await cssVar(page, '--accent'))
  const banner = page.locator('.season')
  const text = await banner.innerText()
  check('the banner turns to its released view, not the next set',
    /Latest set/i.test(text) && /Reality Fracture/.test(text) && /Released 2 Oct 2026/.test(text) && !/Next set/i.test(text) && !/Releases /.test(text), text)
  check('and says what follows, on its date', /Star Trek follows on 13 Nov 2026\./.test(text), text)
  check('its note still says the colours and lore are the app\'s reading, not official',
    /Colours and lore here are the app.s own reading, not official\./.test(text), text)
  // "17 Sep 2026" or "17 Sept 2026", as the browser's own British date data has it.
  check('and reads as written from previews before release, and whether it has been checked against the released cards since',
    new RegExp(`Written on \\d{1,2} [A-Z][a-z]{2,3} \\d{4} from previews, before release; ${CHECK}\\.`).test(text)
      && !/public previews/.test(text), text)
  check('giving its dates in one form, and the release date once: the line above has already said it',
    !/before release on/.test(text) && !/January|February|March|April|June|July|August|September|October|November|December/.test(text), text)
  check('its search browses the set rather than calling it spoilers',
    (await banner.getByRole('button', { name: 'Browse the set' }).count()) === 1 && (await banner.getByRole('button', { name: 'Spoilers so far' }).count()) === 0)
  check('the Commanders guide offers both sets and opens on Reality Fracture',
    (await page.locator('.chip', { hasText: /^(Reality Fracture|Star Trek)$/ }).count()) === 2
      && (await page.locator('.chip.chip--active', { hasText: /^Reality Fracture$/ }).count()) === 1)
  await axe(page, 'Learn with the released view of the banner')
  await banner.getByRole('button', { name: /What.s new/ }).click()
  const sheet = page.getByRole('dialog')
  await sheet.waitFor({ timeout: 5000 }).catch(() => {})
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running')).catch(() => {})
  const note = await sheet.locator('.banner').last().innerText().catch(() => '')
  check('What\'s new is no longer provisional, and says it was written before release, and whether it has been checked since',
    !/Provisional/.test(await sheet.innerText().catch(() => 'Provisional'))
      && new RegExp(`from previews, before release on 2 Oct 2026; ${CHECK}\\.`).test(note), note)
  check('and flags an unchecked entry as a warning, a checked one as information',
    (await sheet.locator('.banner--warn', { hasText: 'not yet checked' }).count()) === 1
      || (await sheet.locator('.banner--info', { hasText: 'checked against the released cards on' }).count()) === 1, note)
  await axe(page, 'What\'s new on release day')
  await sheet.getByRole('button', { name: 'Close' }).click()
  const schools = await firstDeckSchools(page)
  check('Hexhaven\'s schools are still beside the colours in the first-deck flow',
    /At Hexhaven/.test(schools.white) && schools.pairSchools === 1 && /Fatehold/.test(schools.pairText), schools.white)
  check('with a note that they are the app\'s reading, when they were written, and how current they are, as the banner says',
    new RegExp(`The schools are this app.s own reading of the set.s lore, not official\\. Written on \\d{1,2} [A-Z][a-z]{2,3} \\d{4} from previews, before release on 2 Oct 2026; ${CHECK}\\.`).test(schools.pairText)
      && !/Provisional\./.test(schools.pairText), schools.pairText.slice(-400))
  await axe(page, 'the first-deck colours with Hexhaven\'s schools')
  await page.context().close()
}

console.log('\nReality Fracture out three weeks, and still nearer than Star Trek (22 Oct 2026)')
{
  const page = await open([HOB, FRA, FRC, TRK], { day: '2026-10-22' })
  check('the root still wears the set theme', (await page.evaluate(() => document.documentElement.dataset.themeSet)) === 'fra')
  const banner = page.locator('.season')
  const text = await banner.innerText()
  // The label is set in capitals by the stylesheet, which innerText reflects.
  check('the banner shows its released view for it', /Latest set/i.test(text) && /Reality Fracture/.test(text) && /Released 2 Oct 2026/.test(text) && !/Next set/i.test(text), text)
  check('and names the set that follows', /Star Trek follows on/.test(text), text)
  check('it still says its colours and lore are the app\'s reading, not official', /not official/.test(text), text)
  check('and that they were written before release, and whether they have been checked against the released cards since',
    new RegExp(`before release; ${CHECK}`).test(text) && !/public previews, not official/.test(text), text)
  check('its search browses the set rather than calling it spoilers',
    (await banner.getByRole('button', { name: 'Browse the set' }).count()) === 1 && (await banner.getByRole('button', { name: 'Spoilers so far' }).count()) === 0)
  const commanderTabs = page.locator('.chip', { hasText: /^(Reality Fracture|Star Trek)$/ })
  check('the Commanders guide offers both sets and opens on Reality Fracture',
    (await commanderTabs.count()) === 2 && (await page.locator('.chip.chip--active', { hasText: /^Reality Fracture$/ }).count()) === 1,
    await commanderTabs.allInnerTexts().then((t) => t.join(', ')))
  await banner.getByRole('button', { name: /What.s new/ }).click()
  const sheet = page.getByRole('dialog')
  await sheet.waitFor({ timeout: 5000 }).catch(() => {})
  const note = await sheet.innerText().catch(() => '')
  check('What\'s new is still there, saying whether it has been checked since release',
    new RegExp(CHECK).test(note) && !/Provisional/.test(note), note.slice(-400))
  await sheet.getByRole('button', { name: 'Close' }).click()
  const schools = await firstDeckSchools(page)
  check('Hexhaven\'s schools are still beside the colours', /At Hexhaven/.test(schools.white) && schools.pairSchools === 1 && /Fatehold/.test(schools.pairText), schools.white)
  await page.context().close()
}

console.log('\nStar Trek nearer than Reality Fracture (24 Oct 2026)')
{
  const page = await open([HOB, FRA, FRC, TRK], { day: '2026-10-24' })
  check('the root wears no set theme', (await page.evaluate(() => document.documentElement.dataset.themeSet ?? null)) === null)
  const banner = page.locator('.season')
  const text = await banner.innerText()
  check('the banner has moved to the next set', /Next set/i.test(text) && /Star Trek/.test(text) && /Releases 13 Nov 2026/.test(text) && !/Reality Fracture/.test(text), text)
  check('with no curated note and no What\'s new', !/not official/.test(text) && (await banner.getByRole('button', { name: /What.s new/ }).count()) === 0, text)
  check('the Commanders guide opens on Star Trek', (await page.locator('.chip.chip--active', { hasText: /^Star Trek$/ }).count()) === 1)
  await axe(page, 'Learn with Star Trek as the focus')
  const schools = await firstDeckSchools(page)
  check('Hexhaven\'s schools are no longer presented beside the colours',
    !/Hexhaven|Fatehold|Vigorbloom|Reality Fracture/.test(schools.white) && schools.pairSchools === 0 && !/Fatehold|Reality Fracture/.test(schools.pairText),
    `${schools.white} | ${schools.pairText.slice(0, 200)}`)
  check('the colours themselves are all still there', /Cares about/.test(schools.white) && /Wins by/.test(schools.white))
  await axe(page, 'the first-deck colours without schools')
  await page.context().close()
}

console.log('\nWhen the season points at a set with no curated theme')
{
  const page = await open([OTHER, HOB])
  check('the root wears no set theme', (await page.evaluate(() => document.documentElement.dataset.themeSet ?? null)) === null)
  check('the accent is the core theme\'s gold', /d8c17a/i.test(await cssVar(page, '--accent')), await cssVar(page, '--accent'))
  check('the shell is charcoal', /0b0c0e/i.test(await cssVar(page, '--bg')), await cssVar(page, '--bg'))
  check('the banner is the plain derived one, with no set art', (await page.locator('.season .hero-art').count()) === 0 && (await page.locator('.season').getAttribute('data-theme-source')) === 'code')
  const hero = page.locator('.hero--art .hero-art img')
  check('Learn keeps the core illustration behind its first-game panel', (await hero.count()) === 1 && await hero.evaluate((img) => img.complete && img.naturalWidth > 0))
  await page.goto(`${TARGET}#/decks`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  check('an empty Decks screen shows the core empty-state illustration, decorative', (await page.locator('.empty__art[alt=""]').count()) === 1 && /core\/decor\/empty-state/.test(await page.locator('.empty__art').getAttribute('src')))
  await page.context().close()
}

check('no asset request failed', failedRequests.length === 0, failedRequests.slice(0, 5).join('; '))
check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
