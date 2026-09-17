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

/**
 * What did they probably mean?
 *
 * Fuzzy naming gives one confident guess; autocomplete gives a list. Both are
 * printed and neither is applied, because a fuzzy match is confidently wrong
 * often enough that a person has to look at it.
 */
async function suggest(name) {
  const get = async (path) => {
    try {
      const response = await fetch(`${API}${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(15000),
      })
      return response.ok ? response.json() : null
    } catch { return null }
  }

  const fuzzy = await get(`/cards/named?fuzzy=${encodeURIComponent(name)}`)
  await sleep(120)
  // Drop the last word: "Awesome Android" finds nothing, "Awesome" finds the
  // family of names it might belong to.
  const stem = name.split(/\s+/).slice(0, 2).join(' ')
  const auto = await get(`/cards/autocomplete?q=${encodeURIComponent(stem)}`)
  await sleep(120)

  return {
    best: fuzzy?.name ?? null,
    candidates: (auto?.data ?? []).filter((candidate) => candidate !== fuzzy?.name),
  }
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
  console.log(c.dim('  enough to miss. Closest matches are looked up for each one.\n'))
  for (const name of missing) {
    const owners = EXAMPLE_DECKS.filter((deck) => namesIn(deck).includes(name)).map((deck) => deck.id)
    console.log(`  ${c.head(name)} ${c.dim(`(in ${owners.join(', ')})`)}`)
    const { best, candidates } = await suggest(name)
    if (best) console.log(`    closest: ${c.ok(best)}`)
    if (candidates.length) console.log(`    ${c.dim(`also: ${candidates.slice(0, 5).join(' | ')}`)}`)
    if (!best && !candidates.length) console.log(`    ${c.dim('no close match — it may be a token, not a card')}`)
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
