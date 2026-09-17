#!/usr/bin/env node
/**
 * The shell follows the season. While Reality Fracture is the focus set the
 * whole app wears its curated theme — indigo shell, cyan accent, the set's
 * own art and voice on the banner, Hexhaven's schools beside the colours —
 * and when the season points elsewhere the core shell is back, gold accent
 * and all, with nothing to undo. Fonts are self-hosted and must resolve
 * under the app's real base path.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const errors = []
const failedRequests = []
const open = async (sets, viewport = { width: 1200, height: 900 }) => {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('requestfailed', (r) => failedRequests.push(r.url()))
  page.on('response', (r) => { if (r.status() >= 400 && !/api\.scryfall\.com/.test(r.url())) failedRequests.push(`${r.status()} ${r.url()}`) })
  await page.route('**/api.scryfall.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"object":"list","data":[]}' }))
  await page.route('**/api.scryfall.com/sets', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: setsPayload(sets) }))
  await page.goto(`${TARGET}#/guide`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  return page
}
const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

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
  await page.close()

  const phone = await open([FRA, HOB], { width: 390, height: 844 })
  const art2 = phone.locator('.season .hero-art img')
  check('on a phone the banner uses the portrait export', /sanctum-portrait-(480|768)\.webp$/.test(await art2.evaluate((img) => img.currentSrc)), await art2.evaluate((img) => img.currentSrc))
  check('nothing scrolls sideways', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await phone.close()
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
  await page.close()
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
  await page.close()
}

check('no asset request failed', failedRequests.length === 0, failedRequests.slice(0, 5).join('; '))
check('no console errors throughout', errors.length === 0, errors.join('; '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
