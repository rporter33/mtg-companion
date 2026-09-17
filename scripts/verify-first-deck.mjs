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

console.log(`${names.length} names checked.`)
if (unknown.length) console.log(`Unknown to Scryfall:\n  ${unknown.join('\n  ')}`)
if (notCommander.length) console.log(`Not a legal commander:\n  ${notCommander.join('\n  ')}`)
if (!unknown.length && !notCommander.length) console.log('All good.')
process.exit(unknown.length || notCommander.length ? 1 : 0)
