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

import { EXAMPLE_DECKS, exampleSize, unverifiedIn } from '../src/data/example-decks.js'
import { readFileSync, writeFileSync } from 'node:fs'

const FIX = process.argv.includes('--fix')
const EXAMPLES_FILE = new URL('../src/data/example-decks.js', import.meta.url)

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

const normalise = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)

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
 * How close are two names?
 *
 * Shared words dominate, because a card that gained a subtitle keeps every word
 * it had; edit distance only breaks ties. A perfect word overlap scores 4.
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

const searchCache = new Map()

/**
 * Every card whose name contains this word, anywhere in Magic.
 *
 * NOT restricted to a set. The previous version searched the commander's
 * printing set, which for these decks is a promo set the other cards are not
 * in — so it narrowed the pool to the one place the answer could not be and
 * reported "nothing is close" about a card that exists. A word is a small
 * enough pool on its own.
 */
async function cardsNamed(word) {
  if (searchCache.has(word)) return searchCache.get(word)
  const payload = await get(`/cards/search?q=${encodeURIComponent(`name:${word}`)}&include_extras=true&unique=cards`)
  await sleep(120)
  const found = (payload?.data ?? []).map((card) => ({
    name: card.name,
    set: card.set,
    token: card.layout === 'token' || /\bToken\b/.test(card.type_line ?? ''),
    // A back face, an adventure half and a meld part are all names that exist
    // on a card Scryfall will not find by that name alone. Knowing which half
    // matched is the difference between renaming a line and deleting it.
    faces: (card.card_faces ?? []).map((face) => face.name),
  }))
  searchCache.set(word, found)
  return found
}

/** The closest real names to one that did not resolve. */
async function suggest(name) {
  const words = normalise(name).filter((word) => word.length > 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)

  const pool = new Map()
  for (const word of words) {
    for (const card of await cardsNamed(word)) pool.set(card.name, card)
  }

  return [...pool.values()]
    .map((card) => {
      // Score against the whole name and each face; a back face that matches
      // exactly should win even though the whole name looks nothing like it.
      const scores = [card.name, ...card.faces].map((text) => similarity(name, text))
      const best = Math.max(...scores)
      const face = card.faces[scores.indexOf(best) - 1] ?? null
      return { ...card, score: best, matchedFace: best === scores[0] ? null : face }
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .filter((card) => card.score > 1.2)
}

const cards = new Map()
let missing = []

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

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const repairs = []
let problems = 0

const declared = new Set(EXAMPLE_DECKS.flatMap(unverifiedIn))
const stale = [...declared].filter((name) => cards.has(name))
if (stale.length) {
  console.log(c.warn('These are marked unverified but Scryfall now knows them — drop the flag:'))
  for (const name of stale) console.log(`  ${name}`)
  console.log()
}

const known = missing.filter((name) => declared.has(name))
missing = missing.filter((name) => !declared.has(name))
if (known.length) {
  console.log(c.dim(`${known.length} names are declared unverified in the data and are not counted:`))
  for (const name of known) console.log(c.dim(`  ${name}`))
  console.log()
}

if (missing.length) {
  problems += missing.length
  console.log(c.bad(missing.length === 1
    ? '1 name Scryfall does not know:'
    : `${missing.length} names Scryfall does not know:`))
  console.log(c.dim('  Scryfall matches names exactly here, so a subtitle or a stray word is'))
  console.log(c.dim('  enough to miss. Candidates are the closest real names in Magic.\n'))
  for (const name of missing) {
    const owners = EXAMPLE_DECKS.filter((deck) => namesIn(deck).includes(name))
    console.log(`  ${c.head(name)} ${c.dim(`(in ${owners.map((d) => d.id).join(', ')})`)}`)
    const hits = await suggest(name)
    if (!hits.length) {
      console.log(`    ${c.dim('nothing in Magic is close, tokens and every face included')}`)
      continue
    }
    for (const hit of hits) {
      const why = hit.token
        ? c.warn('   [token — delete the line, do not rename it]')
        : hit.matchedFace
          ? c.warn(`   [this is the "${hit.matchedFace}" face — use the full name]`)
          : ''
      console.log(`    ${hit.name} ${c.dim(`(${hit.set}, ${hit.score.toFixed(1)})`)}${why}`)
      repairs.push({
        from: name, to: hit.name, token: hit.token, score: hit.score,
        deckIds: owners.map((deck) => deck.id),
      })
      break
    }
  }
  console.log()
}

for (const deck of EXAMPLE_DECKS) {
  const size = exampleSize(deck)
  const entries = namesIn(deck)
  const unresolved = entries.filter((name) => !cards.has(name) && !declared.has(name))
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

// Applying the repair here rather than printing it for a human to retype is the
// whole point: the machine that can reach Scryfall is the one that should write
// the answer down. Only unambiguous repairs are applied, and every one is
// printed, so nothing changes quietly.
if (repairs.length) {
  // 3.2 is close to a whole-word match. Below that the suggestions are real
  // cards that merely share a word — Loki's Double scored 2.6 against Loki's
  // Scepter, a different card already in that same deck. A rename to a card the
  // deck already holds is never right, so that is refused outright.
  const confident = repairs.filter((r) => {
    if (r.token) return true
    if (r.score < 3.2) return false
    const holders = EXAMPLE_DECKS.filter((deck) => r.deckIds.includes(deck.id))
    return !holders.some((deck) => deck.main.some((card) => card.name === r.to))
  })
  const unsure = repairs.filter((r) => !confident.includes(r))

  console.log()
  if (!FIX) {
    console.log(c.head('Repairs available — re-run with --fix to apply:'))
    for (const r of confident) {
      console.log(r.token ? `  delete  ${r.from} ${c.dim('(token)')}` : `  rename  ${r.from} -> ${r.to}`)
    }
    for (const r of unsure) console.log(`  ${c.dim(`too unsure to apply: ${r.from} -> ${r.to} (${r.score.toFixed(1)})`)}`)
    console.log(c.dim('\n  npm run examples:verify -- --fix'))
  } else {
    let file = readFileSync(EXAMPLES_FILE, 'utf8')
    let applied = 0
    for (const r of confident) {
      // \r?\n, not \n: git checks this file out with CRLF on Windows, and the
      // first version silently matched nothing there while reporting success.
      const line = new RegExp(`^ *\\{ name: ${escapeRe(JSON.stringify(r.from))}, quantity: \\d+ \\},\\r?\\n`, 'm')
      if (r.token) {
        if (line.test(file)) { file = file.replace(line, ''); applied++ }
      } else {
        const before = file
        file = file.replace(line, (m) => m.replace(JSON.stringify(r.from), JSON.stringify(r.to)))
        if (file !== before) applied++
      }
    }
    // A deleted token leaves the deck short, and the repo's own test requires an
    // example that is not 100 cards to say why. Write that reason now rather
    // than leaving `npm test` red for someone else to puzzle over.
    for (const r of confident.filter((x) => x.token)) {
      for (const id of r.deckIds) {
        const block = new RegExp(`(id: ${escapeRe(JSON.stringify(id))},[\\s\\S]{0,400}?note: )("(?:[^"\\\\]|\\\\.)*")`)
        file = file.replace(block, (match, head, note) => {
          const existing = JSON.parse(note)
          const addition = `${r.from} was a token in the source export and was removed, leaving this list short.`
          return existing.includes(addition) ? match : head + JSON.stringify(existing ? `${existing} ${addition}` : addition)
        })
      }
    }

    writeFileSync(EXAMPLES_FILE, file)
    console.log(c.ok(`Applied ${applied} repair(s) to src/data/example-decks.js.`))
    for (const r of confident) {
      console.log(r.token ? `  deleted ${r.from}` : `  ${r.from} -> ${r.to}`)
    }
    for (const r of unsure) console.log(`  ${c.dim(`left alone: ${r.from} (best guess ${r.to}, ${r.score.toFixed(1)})`)}`)
    console.log(c.dim('\n  Deleting a token line drops that deck below 100 cards — run again to see.'))
    console.log(c.dim('  Then: git add -A; git commit -m "Fix example card names"; git push origin main'))
  }
}

console.log()
if (problems) {
  console.log(c.bad(`${problems} problem${problems === 1 ? '' : 's'}. Paste this output back and they can be fixed.`))
  process.exit(1)
}
console.log(c.ok('Every example checks out.'))
