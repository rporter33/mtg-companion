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

const names = [...new Set([
  ...Object.values(FIRST_COMMANDERS).flat().map((p) => p.name),
  ...Object.values(COLOR_PAGES).flatMap((p) => p.signature),
])]

let unknown = []
let notCommander = []
for (let i = 0; i < names.length; i += 75) {
  const chunk = names.slice(i, i + 75)
  const response = await fetch(`${API}/cards/collection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
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
  await new Promise((r) => setTimeout(r, 120))
}

// Every plan's searches, for every colour choice that offers it, at the
// default price cap: the first query that answers is the one the app will
// use, and a plan with no answering query would leave the role on its
// broad fallback without saying so here.
const silent = []
let plansChecked = 0
for (const formatId of ['commander', 'modern']) for (const [colors, plans] of Object.entries(STRATEGIES)) {
  for (const plan of plans) {
    plansChecked++
    const queries = stapleQueries(colors, 'theme', { capUsd: 4, strategy: plan, formatId }).slice(0, plan.queries.length)
    let answered = false
    for (const q of queries) {
      const response = await fetch(`${API}/cards/search?q=${encodeURIComponent(q)}&order=edhrec&unique=cards`, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      })
      await new Promise((r) => setTimeout(r, 120))
      if (response.status === 404) continue // Scryfall's "no cards match"
      if (!response.ok) { console.error(`Scryfall answered ${response.status} for ${q}`); process.exit(2) }
      const payload = await response.json()
      if ((payload.data ?? []).length) { answered = true; break }
    }
    if (!answered) silent.push(`${formatId} ${colors} ${plan.id}: ${queries.join(' | ')}`)
  }
}

console.log(`${names.length} names checked, ${plansChecked} plan searches checked.`)
if (unknown.length) console.log(`Unknown to Scryfall:\n  ${unknown.join('\n  ')}`)
if (notCommander.length) console.log(`Not a legal commander:\n  ${notCommander.join('\n  ')}`)
if (silent.length) console.log(`Plan searches that return nothing under $4:\n  ${silent.join('\n  ')}`)
if (!unknown.length && !notCommander.length && !silent.length) console.log('All good.')
process.exit(unknown.length || notCommander.length || silent.length ? 1 : 0)
