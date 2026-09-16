#!/usr/bin/env node
/**
 * Turns a deck you already have into an example this app can ship.
 *
 *   npm run deck:fetch -- <url|file|-> [options]
 *
 * WHY THIS IS A SCRIPT AND NOT A FEATURE
 *
 * The app runs entirely in a browser, so it can only read a deck site that
 * sends CORS headers permitting it. Moxfield does not, and that is their call
 * to make — src/lib/deck-sources.js explains the refusal to the user and points
 * at the Export button instead. Nothing here changes that.
 *
 * This runs on your own machine instead, where CORS does not apply, and it is
 * run by hand, once, by the person curating the examples. That is a materially
 * different thing from an app fetching every user's link automatically, and it
 * is the only reason the network path below is acceptable at all.
 *
 * It sends an honest User-Agent naming the project. It does not pretend to be a
 * browser. If a site declines, the script says so and tells you which button to
 * press — it does not retry harder, rotate anything, or route around the answer.
 *
 * THE ENDPOINTS BELOW ARE UNVERIFIED. Moxfield publishes no publicly documented
 * API, so the candidates here are probes, not knowledge. The script reports
 * which one answered and what shape it got, so a wrong guess is visible and
 * fixable rather than silent. The file path always works and needs no network:
 *
 *   Moxfield → deck → ⋯ menu → Export → copy → save as deck.txt
 *   npm run deck:fetch -- deck.txt --credit "Your name"
 *
 * Options:
 *   --credit "..."   who chose this deck (shown in the app; an example is an
 *                    opinion and the reader deserves to know whose)
 *   --note "..."     one line on why it is worth looking at
 *   --name "..."     override the deck name
 *   --format <id>    format id (default: commander)
 *   --no-verify      skip the Scryfall name check (faster, riskier)
 *   --append         write the entry into src/data/example-decks.js
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { parseDecklist } from '../src/lib/decklist.js'
import { identifySource, parseArchidekt, parseMoxfield } from '../src/lib/deck-sources.js'

const SCRYFALL = 'https://api.scryfall.com'
const UA = 'mtg-companion-example-curator/1.0 (+https://github.com/rporter33/mtg-companion)'
const EXAMPLES_FILE = new URL('../src/data/example-decks.js', import.meta.url)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const useColor = process.env.FORCE_COLOR
  ? process.env.FORCE_COLOR !== '0'
  : !process.env.NO_COLOR && process.stdout.isTTY && process.env.TERM !== 'dumb'
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const c = { ok: paint(32), bad: paint(31), warn: paint(33), dim: paint(2), head: paint(1) }

function die(message, hint) {
  console.error(`\n${c.bad('✗')} ${message}`)
  if (hint) console.error(`  ${c.dim(hint)}`)
  process.exit(1)
}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = { verify: true, append: false, format: 'commander' }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-verify') opts.verify = false
    else if (arg === '--append') opts.append = true
    else if (arg === '--credit') opts.credit = argv[++i]
    else if (arg === '--note') opts.note = argv[++i]
    else if (arg === '--name') opts.name = argv[++i]
    else if (arg === '--format') opts.format = argv[++i]
    else if (arg.startsWith('--')) die(`Unknown option ${arg}`)
    else rest.push(arg)
  }
  opts.input = rest[0]
  return opts
}

// ------------------------------------------------------------------ sources

const MOXFIELD_CANDIDATES = [
  (id) => `https://api2.moxfield.com/v3/decks/all/${id}`,
  (id) => `https://api.moxfield.com/v2/decks/all/${id}`,
]

async function fetchMoxfield(id) {
  const attempts = []
  for (const build of MOXFIELD_CANDIDATES) {
    const url = build(id)
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
      if (response.ok) {
        console.log(`  ${c.ok('✓')} ${url}`)
        return parseMoxfield(await response.json())
      }
      attempts.push(`${response.status} ${response.statusText} — ${url}`)
    } catch (error) {
      attempts.push(`${error.message} — ${url}`)
    }
    await sleep(200)
  }

  // A 403 here can be Moxfield declining, or it can be a corporate proxy or a
  // sandbox declining on your behalf. Both look identical from inside Node, so
  // print what was actually attempted rather than diagnosing it for you.
  console.error(`\n${c.warn('Moxfield did not answer. Either it declined, or something between you and it did.')}`)
  for (const line of attempts) console.error(`  ${c.dim(line)}`)
  die(
    'Could not read the deck from Moxfield.',
    'Open the deck, use the ⋯ menu → Export, copy the list to a file, and run this script on that file instead.',
  )
}

async function fetchArchidekt(id) {
  const url = `https://archidekt.com/api/decks/${id}/`
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
  if (!response.ok) die(`Archidekt returned ${response.status} for ${url}`)
  return parseArchidekt(await response.json())
}

/** Reads a plain text export into the same shape the URL fetchers produce. */
function fromText(text, fallbackName) {
  const lines = parseDecklist(text)
  if (!lines.length) die('No card lines found in that text.', 'Expected lines like "4 Lightning Bolt".')

  const bucket = { commander: [], main: [], sideboard: [] }
  for (const line of lines) bucket[line.section].push({ name: line.name, quantity: line.quantity })

  return {
    name: fallbackName,
    commanders: bucket.commander,
    main: bucket.main,
    sideboard: bucket.sideboard,
  }
}

async function load(input, opts) {
  if (input === '-') return fromText(readFileSync(0, 'utf8'), opts.name ?? 'Pasted deck')

  if (/^https?:\/\//i.test(input)) {
    const identified = identifySource(input)
    if (!identified) die('That link is not from a deck site this script knows.')
    const { source, id } = identified
    console.log(`${c.head('Reading')} ${source.name} deck ${id}`)
    if (source.id === 'moxfield') return fetchMoxfield(id)
    if (source.id === 'archidekt') return fetchArchidekt(id)
    die(`${source.name} cannot be read directly.`, source.instructions)
  }

  const text = readFileSync(input, 'utf8')
  return fromText(text, opts.name ?? input.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, ''))
}

// ------------------------------------------------------------ verification

/**
 * Every name that ships must be a name Scryfall answers to, because the app
 * resolves examples by name at runtime. A typo here is a broken example for
 * everyone, so the check is on by default and replaces each name with the
 * canonical spelling Scryfall returns.
 */
async function verifyNames(names) {
  const canonical = new Map()
  const missing = []

  for (let i = 0; i < names.length; i += 75) {
    const chunk = names.slice(i, i + 75)
    const response = await fetch(`${SCRYFALL}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
    })
    if (!response.ok) die(`Scryfall returned ${response.status} while checking names.`)
    const payload = await response.json()

    for (const card of payload.data ?? []) {
      // Match back case-insensitively: Scryfall accepts a loose name and
      // answers with the exact one, which is the whole point of this pass.
      const match = chunk.find((name) => name.toLowerCase() === card.name.toLowerCase())
        ?? chunk.find((name) => card.name.toLowerCase().startsWith(name.toLowerCase()))
      if (match) canonical.set(match, card.name)
    }
    for (const entry of payload.not_found ?? []) missing.push(entry.name)
    await sleep(120)
  }

  return { canonical, missing }
}

// ------------------------------------------------------------------- output

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function buildEntry(deck, opts, canonical) {
  const name = (raw) => canonical?.get(raw) ?? raw
  const list = (entries) => entries
    .map((entry) => ({ name: name(entry.name), quantity: entry.quantity }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    id: slug(opts.name ?? deck.name),
    name: opts.name ?? deck.name,
    formatId: opts.format,
    commanders: deck.commanders.map((entry) => name(entry.name)),
    signatureSpell: null,
    main: list(deck.main),
    sideboard: list(deck.sideboard),
    credit: opts.credit ?? '',
    note: opts.note ?? '',
    addedAt: new Date().toISOString().slice(0, 10),
  }
}

/** Formats the entry the way the file is already written, so diffs stay small. */
function render(entry) {
  const q = (s) => JSON.stringify(s)
  const cards = (items) => (items.length
    ? `[\n${items.map((card) => `      { name: ${q(card.name)}, quantity: ${card.quantity} },`).join('\n')}\n    ]`
    : '[]')

  return [
    '  {',
    `    id: ${q(entry.id)},`,
    `    name: ${q(entry.name)},`,
    `    formatId: ${q(entry.formatId)},`,
    `    commanders: [${entry.commanders.map(q).join(', ')}],`,
    `    signatureSpell: ${entry.signatureSpell ? q(entry.signatureSpell) : 'null'},`,
    `    credit: ${q(entry.credit)},`,
    `    note: ${q(entry.note)},`,
    `    addedAt: ${q(entry.addedAt)},`,
    `    main: ${cards(entry.main)},`,
    `    sideboard: ${cards(entry.sideboard)},`,
    '  },',
  ].join('\n')
}

const CLOSER = '\n]\n'

function append(text) {
  const file = readFileSync(EXAMPLES_FILE, 'utf8')
  const marker = file.indexOf('export const EXAMPLE_DECKS = [')
  if (marker === -1) die('Could not find EXAMPLE_DECKS in src/data/example-decks.js.')
  const close = file.indexOf(CLOSER, marker)
  if (close === -1) die('Could not find the end of EXAMPLE_DECKS.')
  writeFileSync(EXAMPLES_FILE, `${file.slice(0, close)}\n${text}${file.slice(close)}`)
}

// --------------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2))
if (!opts.input) {
  // The header comment above IS the manual, so print it rather than keeping a
  // second copy that can drift out of step with it.
  const source = readFileSync(new URL(import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('/**') + 4, source.indexOf('\n */'))
  console.log(body.replace(/^ \* ?/gm, '').replace(/^ \*$/gm, '').trimEnd())
  process.exit(1)
}

const deck = await load(opts.input, opts)
const total = [...deck.commanders, ...deck.main, ...deck.sideboard]
if (!total.length) die('That deck came back empty.')

console.log(`\n${c.head(opts.name ?? deck.name)}`)
console.log(`  ${deck.commanders.length} commander(s), ${deck.main.length} main entries, ${deck.sideboard.length} sideboard`)

let canonical = null
if (opts.verify) {
  const names = [...new Set(total.map((entry) => entry.name))]
  console.log(`  ${c.dim(`checking ${names.length} names against Scryfall…`)}`)
  const result = await verifyNames(names)
  canonical = result.canonical
  if (result.missing.length) {
    console.error(`\n${c.bad('These names did not resolve:')}`)
    for (const name of result.missing) console.error(`  ${name}`)
    die('Refusing to emit an example with names the app cannot look up.', 'Fix the spellings, or re-run with --no-verify if you are certain.')
  }
  console.log(`  ${c.ok('✓')} every name resolves`)
}

const entry = buildEntry(deck, opts, canonical)
const text = render(entry)

if (opts.append) {
  append(text)
  console.log(`\n${c.ok('✓')} appended to src/data/example-decks.js`)
} else {
  console.log(`\n${c.dim('Paste this into EXAMPLE_DECKS in src/data/example-decks.js, or re-run with --append:')}\n`)
  console.log(text)
}
