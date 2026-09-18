#!/usr/bin/env node
/**
 * Checks the bundled tutorial cards against Scryfall, by exact name: mana
 * cost, mana value, type line, rules text, power and toughness. Run on a
 * machine that can reach api.scryfall.com:
 *
 *   npm run tutorial:verify
 *
 * A mismatch means the tutorial teaches a card that no longer reads that way
 * and must be fixed by hand, because the script never changes the bundled
 * text. At the end it prints a `source` block per card — the Scryfall ids of
 * the printing it checked — to paste into src/data/tutorial-cards.js.
 */
import { TUTORIAL_CARDS } from '../src/data/tutorial-cards.js'

const API = process.env.SCRYFALL_API || 'https://api.scryfall.com'
const UA = 'mtg-companion-tutorial-verifier/1.0 (+https://github.com/rporter33/mtg-companion)'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let gapMs = Number(process.env.SCRYFALL_GAP_MS) || 350

async function request(url) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
    await wait(gapMs)
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      const after = Number(response.headers.get('retry-after'))
      const pause = Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt
      if (response.status === 429) gapMs = Math.min(gapMs * 2, 5000)
      console.error(`Scryfall answered ${response.status}; waiting ${pause / 1000}s, then trying again (${attempt + 1} of 5)`)
      await wait(pause)
      continue
    }
    return response
  }
}

// Reminder text in parentheses is compared loosely: Scryfall omits it on some
// printings and includes it on others, and the tutorial keeps it for haste.
const strip = (text) => String(text ?? '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()

const problems = []
const sources = {}
for (const [key, card] of Object.entries(TUTORIAL_CARDS)) {
  const response = await request(`${API}/cards/named?exact=${encodeURIComponent(card.name)}`)
  if (response.status === 404) { problems.push(`${card.name}: unknown to Scryfall`); continue }
  if (!response.ok) { console.error(`Scryfall answered ${response.status} for ${card.name}`); process.exit(2) }
  const live = await response.json()
  const checks = [
    ['mana_cost', card.mana_cost ?? '', live.mana_cost ?? ''],
    ['cmc', Number(card.cmc), Number(live.cmc)],
    ['type_line', card.type_line, live.type_line],
    ['oracle_text', strip(card.oracle_text), strip(live.oracle_text)],
    ['power', card.power ?? null, live.power ?? null],
    ['toughness', card.toughness ?? null, live.toughness ?? null],
  ]
  for (const [field, ours, theirs] of checks) {
    if (ours !== theirs) problems.push(`${card.name}: ${field} is ${JSON.stringify(ours)} here, ${JSON.stringify(theirs)} on Scryfall`)
  }
  sources[key] = {
    oracleId: live.oracle_id, scryfallId: live.id, set: live.set, collectorNumber: live.collector_number,
    checkedAt: new Date().toISOString().slice(0, 10),
  }
}

console.log(`${Object.keys(TUTORIAL_CARDS).length} tutorial cards checked.`)
if (problems.length) console.log(`Mismatches:\n  ${problems.join('\n  ')}`)
else console.log('All match.')
console.log('\nSource blocks to paste into src/data/tutorial-cards.js:')
for (const [key, source] of Object.entries(sources)) console.log(`  ${key}: ${JSON.stringify(source)}`)
process.exit(problems.length ? 1 : 0)
