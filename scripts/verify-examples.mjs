#!/usr/bin/env node
/**
 * Checks every card name in every shipped example against Scryfall.
 *
 *   npm run examples:verify
 *
 * The examples resolve by name at runtime, so a name Scryfall does not know is
 * a card that silently never appears — the deck loads 99 cards and says nothing
 * about the hundredth. Unit tests cannot catch that: the names are only wrong
 * relative to a database that is not in this repo.
 *
 * It also reports the legality of each deck in its own format, because a name
 * can be real and still not belong (wrong colour identity, banned, not legal in
 * Commander at all). Read-only, no API key, rate limited to Scryfall's
 * requested pace.
 */

import { EXAMPLE_DECKS, exampleSize } from '../src/data/example-decks.js'

// Overridable so the reporting half can be exercised against a stub; there is
// no other way to see this script's output without a perfect set of examples.
const API = process.env.SCRYFALL_API || 'https://api.scryfall.com'
const UA = 'mtg-companion-example-verifier/1.0 (+https://github.com/rporter33/mtg-companion)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const useColor = process.env.FORCE_COLOR
  ? process.env.FORCE_COLOR !== '0'
  : !process.env.NO_COLOR && process.stdout.isTTY && process.env.TERM !== 'dumb'
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const c = { ok: paint(32), bad: paint(31), warn: paint(33), dim: paint(2), head: paint(1) }

if (!EXAMPLE_DECKS.length) {
  console.log('No examples are shipped yet — nothing to verify.')
  process.exit(0)
}

// One lookup covers every deck: the same staples appear in all of them, and
// Scryfall should not be asked for Sol Ring seven times.
const namesIn = (deck) => [
  ...deck.commanders,
  ...(deck.signatureSpell ? [deck.signatureSpell] : []),
  ...deck.main.map((card) => card.name),
  ...deck.sideboard.map((card) => card.name),
]

const wanted = new Set(EXAMPLE_DECKS.flatMap(namesIn))

const names = [...wanted]
console.log(`${c.head('Verifying')} ${names.length} distinct names across ${EXAMPLE_DECKS.length} decks\n`)

/**
 * One chunk of names, with a deadline.
 *
 * Without a timeout a stalled connection leaves this script sitting on a
 * progress counter forever, which looks identical to it working. Three tries,
 * backing off, then say plainly which it was.
 */
async function ask(chunk) {
  let last = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${API}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
        signal: AbortSignal.timeout(20000),
      })
      if (response.ok) return response.json()
      // A bad request or a refusal will not improve by being repeated.
      if (response.status < 500 && response.status !== 429) {
        console.error(`\n${c.bad('✗')} Scryfall returned ${response.status} ${response.statusText}.`)
        process.exit(2)
      }
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error.name === 'TimeoutError' ? 'timed out after 20s' : error.message
    }
    if (attempt < 3) await sleep(attempt * 2000)
  }
  console.error(`\n${c.bad('✗')} Could not reach Scryfall (${last}).`)
  console.error(`  ${c.dim('Check your connection, then run npm run examples:verify again.')}`)
  process.exit(2)
}

const TODAY = new Date().toISOString().slice(0, 10)

/** Has this printing's set not come out yet? */
function isUnreleased(card) {
  return Boolean(card?.released_at) && card.released_at > TODAY
}

/** One GET, or null. Every lookup here is advisory, so a failure is not fatal. */
async function get(path) {
  try {
    const response = await fetch(`${API}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
    return response.ok ? response.json() : null
  } catch { return null }
}

/**
 * Every card in a set, by name.
 *
 * Fetched once per set and reused, because the question "what is this card
 * really called" is best answered against the actual contents of the set the
 * deck came from rather than by guessing at a search engine's ranking. A
 * Commander precon set is a few hundred cards — small enough to hold and
 * compare locally, where the comparison is one this repo can reason about.
 */
const setCache = new Map()

async function cardsInSet(code) {
  if (setCache.has(code)) return setCache.get(code)
  const found = []
  let path = `/cards/search?q=${encodeURIComponent(`set:${code}`)}&include_extras=true&unique=cards`
  for (let page = 0; page < 6 && path; page++) {
    const payload = await get(path)
    await sleep(120)
    if (!payload?.data) break
    for (const card of payload.data) {
      found.push({
        name: card.name,
        token: card.layout === 'token' || /\bToken\b/.test(card.type_line ?? ''),
      })
    }
    path = payload.has_more && payload.next_page
      ? payload.next_page.replace(API, '').replace('https://api.scryfall.com', '')
      : null
  }
  setCache.set(code, found)
  return found
}

const normalise = (s2) => s2.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)

/** Ordinary edit distance, iterative so a long name cannot blow the stack. */
function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let corner = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(prev[j] + 1, prev[j - 1] + 1, corner + (a[i - 1] === b[j - 1] ? 0 : 1))
      corner = prev[j]
      prev[j] = next
    }
  }
  return prev[b.length]
}

/**
 * How close are two card names?
 *
 * Shared words dominate, because a card that gained a subtitle keeps every word
 * it had. Edit distance only breaks ties, so "Loki's Double" cannot beat
 * "Lady Loki's Manifestation" on letter count alone when one shares two words
 * and the other shares one.
 */
function similarity(wanted, candidate) {
  const a = normalise(wanted)
  const b = normalise(candidate)
  const shared = a.filter((word) => b.includes(word)).length
  const overlap = shared / Math.max(a.length, 1)
  const letters = 1 - distance(wanted.toLowerCase(), candidate.toLowerCase())
    / Math.max(wanted.length, candidate.length, 1)
  return overlap * 3 + letters
}

/** The nearest real names in the set this deck came from. */
async function suggest(name, hintSet) {
  if (!hintSet) return []
  const pool = await cardsInSet(hintSet)
  return pool
    .map((card) => ({ ...card, score: similarity(name, card.name) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .filter((card) => card.score > 0.6)
}

const cards = new Map()
const missing = []

for (let i = 0; i < names.length; i += 75) {
  const chunk = names.slice(i, i + 75)
  const payload = await ask(chunk)
  for (const card of payload.data ?? []) {
    const match = chunk.find((name) => name.toLowerCase() === card.name.toLowerCase())
      ?? chunk.find((name) => card.name.toLowerCase().startsWith(name.toLowerCase()))
    if (match) cards.set(match, card)
  }
  for (const entry of payload.not_found ?? []) missing.push(entry.name)

  // Only on a terminal: a \r into a log file or a pasted transcript leaves the
  // counter fused to the next line, and this output exists to be pasted back.
  if (process.stdout.isTTY) {
    process.stdout.write(`  ${c.dim(`${Math.min(i + 75, names.length)}/${names.length}`)}\r`)
  }
  await sleep(120)
}
if (process.stdout.isTTY) process.stdout.write(`${' '.repeat(40)}\r`)

let problems = 0

if (missing.length) {
  problems += missing.length
  console.log(c.bad(missing.length === 1
    ? '1 name Scryfall does not know:'
    : `${missing.length} names Scryfall does not know:`))
  console.log(c.dim('  Scryfall matches names exactly here, so a subtitle or a stray word is'))
  console.log(c.dim("  enough to miss. Candidates are the closest real names in that deck's own set.\n"))
  for (const name of missing) {
    const owners = EXAMPLE_DECKS.filter((deck) => namesIn(deck).includes(name))
    // A precon's odd names come from its own set, and the commander resolved,
    // so its set code is the best hint available for where to look.
    const hint = owners.map((deck) => cards.get(deck.commanders[0])?.set).find(Boolean)
    console.log(`  ${c.head(name)} ${c.dim(`(in ${owners.map((d) => d.id).join(', ')})`)}`)
    const hits = await suggest(name, hint)
    if (!hint) { console.log(`    ${c.dim('no set to search — its commander did not resolve either')}`); continue }
    if (!hits.length) {
      console.log(`    ${c.dim(`nothing in set ${hint} is close, tokens included`)}`)
      continue
    }
    for (const hit of hits) {
      const tag = hit.token ? c.warn('   [token — delete the line, do not rename it]') : ''
      console.log(`    ${hit.name}${tag}`)
    }
  }
  console.log()
}

for (const deck of EXAMPLE_DECKS) {
  const size = exampleSize(deck)
  const entries = namesIn(deck)
  const unresolved = entries.filter((name) => !cards.has(name))
  const wrongSize = deck.formatId === 'commander' && size !== 100

  // A card from a set that has not come out yet is "not_legal" everywhere. That
  // is a release date, not a deck problem, and reporting it as one would bury
  // the real bans in noise — a preview deck would show thirty failures and none
  // of them actionable.
  const illegal = []
  const unreleased = []
  for (const { name } of deck.main) {
    const card = cards.get(name)
    const legality = card?.legalities?.[deck.formatId]
    if (!legality || legality === 'legal' || legality === 'restricted') continue
    if (legality === 'not_legal' && isUnreleased(card)) unreleased.push(name)
    else illegal.push(`${name} (${legality})`)
  }

  // A colourless commander has an empty identity and every coloured card is off
  // limits, so "empty" must not be confused with "unknown". Only skip the check
  // when a commander did not resolve at all.
  const knownCommanders = deck.commanders.map((name) => cards.get(name))
  const identity = new Set(knownCommanders.flatMap((card) => card?.color_identity ?? []))
  const identityKnown = knownCommanders.every(Boolean)
  // Colour identity is the rule people get wrong most often, and the one an
  // example must not get wrong at all.
  const offColor = deck.main.filter(({ name }) => {
    const card = cards.get(name)
    if (!card || !identityKnown) return false
    return (card.color_identity ?? []).some((color) => !identity.has(color))
  }).map((card) => card.name)

  const bad = illegal.length + offColor.length + unresolved.length + (wrongSize ? 1 : 0)
  problems += bad
  const mark = bad ? c.bad('✗') : c.ok('✓')
  console.log(`${mark} ${deck.name} ${c.dim(`— ${size} cards, ${entries.length - unresolved.length}/${entries.length} names known`)}`)
  if (wrongSize) console.log(`    ${c.warn('not 100 cards')} ${c.dim(deck.note || '(no note explaining why)')}`)
  if (unreleased.length) {
    const soonest = unreleased
      .map((name) => cards.get(name)?.released_at)
      .filter(Boolean)
      .sort()[0]
    console.log(`    ${c.warn(`${unreleased.length} cards not released yet`)} ${c.dim(`(from ${soonest} onward) — legal once their set is out`)}`)
  }
  for (const entry of illegal) console.log(`    ${c.bad('not legal in ' + deck.formatId)}: ${entry}`)
  if (offColor.length) {
    console.log(`    ${c.bad('outside the commander\'s colour identity')}: ${offColor.join(', ')}`)
  }
}

console.log()
if (problems) {
  console.log(c.bad(`${problems} problem${problems === 1 ? '' : 's'}. Paste this output back and they can be fixed.`))
  process.exit(1)
}
console.log(c.ok('Every example checks out.'))
