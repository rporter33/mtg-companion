#!/usr/bin/env node
/**
 * Scores the deck coach's card classifiers against real cards.
 *
 *   npm run coach:measure
 *
 * WHY THIS EXISTS
 *
 * Everything else the coach does is arithmetic — count the lands, compare to a
 * number derived from a hypergeometric distribution. But whether a card *is*
 * removal, ramp or card draw is decided by a handful of regexes over oracle
 * text, and those were written from memory: they have only ever been checked
 * against cards I happened to think of. That is the one place this app makes a
 * claim about Magic that nothing verifies.
 *
 * GROUND TRUTH, AND ITS LIMITS
 *
 * Scryfall's Tagger project carries community-curated functional tags, queried
 * with `otag:`. They are genuinely independent of this repo's regexes, which is
 * the whole point — measuring oracle-text patterns against oracle-text patterns
 * would prove nothing.
 *
 * They are not a gold standard. Tagger is volunteer-maintained and incomplete,
 * so a card with no tag is not proof the card is not removal. That asymmetry
 * matters for reading the output: a false positive here may be a real miss in
 * the tag data, so precision is a lower bound. Recall is the sturdier number,
 * because a card someone bothered to tag as removal almost certainly is.
 *
 * THE SAMPLE
 *
 * Cards are drawn in EDHREC popularity order from the Commander-legal paper
 * pool. That is deliberately not a uniform sample of Magic: it is roughly the
 * population a deck coach actually meets, which is what these numbers should
 * describe. It also means these figures say nothing about obscure cards.
 *
 * Read-only. No API key. Rate limited to Scryfall's requested pace.
 */

import { CLASSIFIERS } from '../src/lib/coach.js'
import { SLOW_INTERVAL_MS } from '../src/lib/scryfall-limits.js'

const API = process.env.SCRYFALL_API || 'https://api.scryfall.com'
const UA = 'mtg-companion-coach-measure/1.0 (+https://github.com/rporter33/mtg-companion)'
const SAMPLE = Number(process.env.SAMPLE || 300)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const useColor = process.env.FORCE_COLOR
  ? process.env.FORCE_COLOR !== '0'
  : !process.env.NO_COLOR && process.stdout.isTTY && process.env.TERM !== 'dumb'
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const c = { ok: paint(32), bad: paint(31), warn: paint(33), dim: paint(2), head: paint(1) }

// Tag slugs are not documented anywhere this repo can check, so each category
// lists candidates and the script reports which one answered. A wrong guess
// then shows up as "no cards", not as a score of zero.
const CATEGORIES = [
  { id: 'removal', tags: ['removal', 'spot-removal'] },
  { id: 'draw', tags: ['card-draw', 'draw'] },
  { id: 'ramp', tags: ['ramp', 'mana-ramp'] },
]

const BASE = 'game:paper legal:commander'

async function search(query, limit) {
  const found = []
  let path = `/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`
  while (path && found.length < limit) {
    let payload
    try {
      const response = await fetch(`${API}${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(20000),
      })
      if (response.status === 404) return found       // Scryfall's "no matches"
      if (!response.ok) {
        console.error(`${c.bad('✗')} Scryfall returned ${response.status} for ${query}`)
        process.exit(2)
      }
      payload = await response.json()
    } catch (error) {
      console.error(`${c.bad('✗')} Could not reach Scryfall (${error.message}).`)
      process.exit(2)
    }
    found.push(...(payload.data ?? []))
    path = payload.has_more && payload.next_page
      ? payload.next_page.replace(/^https:\/\/api\.scryfall\.com/, '')
      : null
    await sleep(SLOW_INTERVAL_MS)
  }
  return found.slice(0, limit)
}

/** Finds whichever tag slug actually returns cards. */
async function resolveTag(candidates) {
  for (const tag of candidates) {
    const hit = await search(`${BASE} otag:${tag}`, 1)
    if (hit.length) return tag
  }
  return null
}

function score({ truePos, falsePos, falseNeg }) {
  const precision = truePos + falsePos ? truePos / (truePos + falsePos) : 0
  const recall = truePos + falseNeg ? truePos / (truePos + falseNeg) : 0
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  return { precision, recall, f1 }
}

const pct = (n) => `${(n * 100).toFixed(1)}%`

console.log(`${c.head('Scoring the coach against Scryfall card tags')}`)
console.log(c.dim(`${SAMPLE} tagged and ${SAMPLE} untagged cards per category, EDHREC order\n`))

let worstF1 = 1

for (const category of CATEGORIES) {
  const classify = CLASSIFIERS[category.id]
  const tag = await resolveTag(category.tags)
  if (!tag) {
    console.log(`${c.warn('SKIP')} ${category.id} — none of ${category.tags.join(', ')} returned cards`)
    console.log(c.dim('       the tag slug has changed; the score would be meaningless, not zero\n'))
    continue
  }

  const positives = await search(`${BASE} otag:${tag}`, SAMPLE)
  const negatives = await search(`${BASE} -otag:${tag}`, SAMPLE)

  const missed = positives.filter((card) => !classify(card))
  const wrong = negatives.filter((card) => classify(card))
  const { precision, recall, f1 } = score({
    truePos: positives.length - missed.length,
    falsePos: wrong.length,
    falseNeg: missed.length,
  })
  worstF1 = Math.min(worstF1, f1)

  const mark = f1 >= 0.8 ? c.ok('✓') : f1 >= 0.6 ? c.warn('~') : c.bad('✗')
  console.log(`${mark} ${c.head(category.id)} ${c.dim(`(otag:${tag}, ${positives.length} tagged / ${negatives.length} untagged)`)}`)
  console.log(`    precision ${pct(precision)}   recall ${pct(recall)}   F1 ${pct(f1)}`)

  // The coach's stated design is to err toward counting: missing a removal
  // spell is annoying, demanding removal you already have is wrong. So the
  // asymmetry is the point, and this says whether it actually leans that way.
  const leaning = recall > precision ? 'counts too much, as intended'
    : recall < precision ? c.warn('misses more than it over-counts — against its stated design')
      : 'balanced'
  console.log(`    ${c.dim(leaning)}`)

  if (missed.length) {
    console.log(`    ${c.dim(`misses (${missed.length}): ${missed.slice(0, 6).map((x) => x.name).join(', ')}`)}`)
  }
  if (wrong.length) {
    console.log(`    ${c.dim(`counts anyway (${wrong.length}): ${wrong.slice(0, 6).map((x) => x.name).join(', ')}`)}`)
  }
  console.log()
}

console.log(c.dim('Precision is a lower bound: Tagger is incomplete, so some "wrong" calls'))
console.log(c.dim('are cards nobody has tagged yet. Recall is the sturdier number.\n'))
process.exit(worstF1 < 0.5 ? 1 : 0)
