#!/usr/bin/env node
/**
 * The views are code-split, and that is only safe because of the prefetch.
 *
 * The service worker caches same-origin responses as they are fetched, so a
 * chunk the visitor never navigated to would simply not be there when they go
 * offline — and this app's whole claim is that it works offline. App.jsx pulls
 * the other views in once the browser is idle to close that hole.
 *
 * If that prefetch ever stops firing, the app still works online and fails
 * silently offline, which is the worst way for it to break. So it is checked
 * here rather than trusted.
 */

import { chromium } from 'playwright'

const TARGET = process.argv[2] ?? 'http://localhost:4173/'
let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`) }
}

const VIEWS = ['CardsView', 'DecksView', 'PlayView', 'GuideView']

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

console.log('\nFirst paint')
{
  // Asserted against what the document declares, not against what has been
  // requested by some arbitrary moment. The prefetch below fires on idle, which
  // on a quiet page is within a few hundred milliseconds — so a timing-based
  // check here would measure the prefetch and call the split broken.
  const html = await (await fetch(TARGET)).text()
  const declared = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1])
  const viewsDeclared = VIEWS.filter((v) => declared.some((d) => d.includes(`/${v}-`)))

  check('the document does not pull in any view up front',
    viewsDeclared.length === 0, `declared: ${viewsDeclared.join(', ')}`)
  check('react is preloaded separately, so an app fix does not re-ship it',
    declared.some((d) => /\/react-[\w-]+\.js$/.test(d)), declared.join(' '))
  check('exactly one entry script', declared.filter((d) => !/\/react-/.test(d)).length === 1,
    declared.join(' '))
}

console.log('\nThe build knows what it is')
{
  // version.json is emitted beside the build and the same stamp is baked into
  // the entry script, so the running app can tell whether the file describes
  // a newer build than itself. If the two ever drift, the update banner is
  // either silent or nags forever.
  const version = await (await fetch(`${TARGET}version.json`, { cache: 'no-store' })).json().catch(() => null)
  check('version.json is published beside the build', !!version?.id && !!version?.at, JSON.stringify(version))
  const html = await (await fetch(TARGET)).text()
  const entry = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]).find((d) => !/\/react-/.test(d))
  const code = entry ? await (await fetch(new URL(entry, TARGET))).text() : ''
  check('the entry script carries the same build id', !!version?.id && code.includes(version.id),
    `looking for ${version?.id} in ${entry}`)
}

console.log('\nThe offline guarantee')
{
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } })
  const scripts = new Set()
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.add(new URL(r.url()).pathname.split('/').pop())
  })
  await page.route('**/api.scryfall.com/**', (route) => route.abort())
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  // The prefetch waits for an idle callback, so give it real time.
  await page.waitForTimeout(3000)

  const missing = VIEWS.filter((v) => ![...scripts].some((s) => s.startsWith(v)))
  check('every view is fetched without being visited, so all of them cache',
    missing.length === 0, `never requested: ${missing.join(', ')}`)
  await page.close()
}

console.log('\nNavigating still works')
{
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api.scryfall.com/**', (route) => route.abort())
  await page.goto(TARGET, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  for (const [tab, marker] of [['Cards', 'input[type="search"]'], ['Decks', '.app__main'], ['Play', '.app__main'], ['Learn', '.app__main']]) {
    await page.locator('.app__nav button', { hasText: tab }).click()
    await page.waitForTimeout(700)
    check(`${tab} renders after loading on demand`, (await page.locator(marker).count()) > 0)
  }
  check('no console errors while switching views', errors.length === 0, errors.join('; '))
  await page.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
