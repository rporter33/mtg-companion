#!/usr/bin/env node
/**
 * Checks every recommended first commander and every signature card in
 * src/data/colors.js against Scryfall, by exact name, and says which are
 * unknown. Run on a machine that can reach api.scryfall.com:
 *
 *   npm run firstdeck:verify
 *
 * A name that fails here would simply not appear in the app — nothing is
 * invented at runtime — but it should be fixed, because a missing pick is
 * one fewer good suggestion for someone's first deck.
 */
import { COLOR_PAGES, FIRST_COMMANDERS } from '../src/data/colors.js'
import { STRATEGIES } from '../src/data/strategies.js'
import { stapleQueries } from '../src/lib/first-deck.js'

const API = process.env.SCRYFALL_API || 'https://api.scryfall.com'
const UA = 'mtg-companion-first-deck-verifier/1.0 (+https://github.com/rporter33/mtg-companion)'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * One request, paced and patient. Scryfall's documented ask is a short
 * gap between requests, but a run at eight a second was cut off after
 * about thirty and blocked for a minute, so the pace here is under three
 * a second: the whole pass takes under a minute and never trips the
 * limit. If it is tripped anyway (a run just before this one, say), a
 * 429 waits as long as Scryfall says, or a growing pause, and tries
 * again, up to five times, before it is a failure.
 */
const GAP_MS = Number(process.env.SCRYFALL_GAP_MS) || 350
let requests = 0

async function request(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...init, headers: { Accept: 'application/json', 'User-Agent': UA, ...(init.headers ?? {}) } })
    requests++
    await wait(GAP_MS)
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      const after = Number(response.headers.get('retry-after'))
      const pause = Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt
      console.error(`Scryfall answered ${response.status} after ${requests} requests; waiting ${pause / 1000}s, then trying again (${attempt + 1} of 5)`)
      await wait(pause)
      continue
    }
    return response
  }
}

const names = [...new Set([
  ...Object.values(FIRST_COMMANDERS).flat().map((p) => p.name),
  ...Object.values(COLOR_PAGES).flatMap((p) => p.signature),
])]

let unknown = []
let notCommander = []
for (let i = 0; i < names.length; i += 75) {
  const chunk = names.slice(i, i + 75)
  const response = await request(`${API}/cards/collection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
  })
  if (!response.ok) { console.error(`Scryfall answered ${response.status}`); process.exit(2) }
  const payload = await response.json()
  unknown.push(...(payload.not_found ?? []).map((n) => n.name))
  const commanders = new Set(Object.values(FIRST_COMMANDERS).flat().map((p) => p.name))
  for (const card of payload.data ?? []) {
    if (commanders.has(card.name) && !/Legendary/.test(card.type_line) && !/can be your commander/i.test(card.oracle_text ?? '')) notCommander.push(card.name)
    if (commanders.has(card.name) && card.legalities?.commander !== 'legal') notCommander.push(`${card.name} (${card.legalities?.commander})`)
  }
}

// Every plan's searches, for every colour choice that offers it, at the
// default price cap: the first query that answers is the one the app will
// use, and a plan with no answering query would leave the role on its
// broad fallback without saying so here.
const silent = []
let plansChecked = 0
for (const formatId of ['commander', 'modern']) {
  for (const [colors, plans] of Object.entries(STRATEGIES)) for (const plan of plans) {
    plansChecked++
    const queries = stapleQueries(colors, 'theme', { capUsd: 4, strategy: plan, formatId }).slice(0, plan.queries.length)
    let answered = false
    for (const q of queries) {
      const response = await request(`${API}/cards/search?q=${encodeURIComponent(q)}&order=edhrec&unique=cards`)
      if (response.status === 404) continue // Scryfall's "no cards match"
      if (!response.ok) { console.error(`Scryfall answered ${response.status} for ${q}`); process.exit(2) }
      const payload = await response.json()
      if ((payload.data ?? []).length) { answered = true; break }
    }
    if (!answered) silent.push(`${formatId} ${colors} ${plan.id}: ${queries.join(' | ')}`)
  }
  console.log(`${formatId}: ${Object.values(STRATEGIES).flat().length} plan searches checked`)
}

console.log(`${names.length} names checked, ${plansChecked} plan searches checked.`)
if (unknown.length) console.log(`Unknown to Scryfall:\n  ${unknown.join('\n  ')}`)
if (notCommander.length) console.log(`Not a legal commander:\n  ${notCommander.join('\n  ')}`)
if (silent.length) console.log(`Plan searches that return nothing under $4:\n  ${silent.join('\n  ')}`)
if (!unknown.length && !notCommander.length && !silent.length) console.log('All good.')
process.exit(unknown.length || notCommander.length || silent.length ? 1 : 0)
