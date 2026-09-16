#!/usr/bin/env node
/**
 * Live Scryfall validation harness.
 *
 * Every network test in this repo runs against mocks that were written from
 * assumptions about Scryfall's response shape. Mocks validate our logic; they
 * cannot validate our beliefs about the API. This script checks the beliefs.
 *
 * It fetches a hand-picked set of genuinely awkward cards and asserts that the
 * app's own logic modules produce sane answers for them. Every probe names the
 * assumption it is testing, so a failure says what we got wrong, not just that
 * something differs.
 *
 *   npm run validate:live
 *
 * Read-only. No API key. Rate limited to Scryfall's requested 100ms.
 */

import { classifySymbol, countPips, faceManaCost } from '../src/lib/mana.js'
import { typeLineOf, oracleTextOf, isBasicLand, copyLimitOverride, FORMATS } from '../src/lib/formats.js'
import { manaValueOf, colorSources, countManaSources } from '../src/lib/analysis.js'
import { deckPrice } from '../src/lib/analysis.js'

const API = 'https://api.scryfall.com'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
let warn = 0
const failures = []

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  head: (s) => `\x1b[1m${s}\x1b[0m`,
}

function check(label, condition, detail) {
  if (condition) {
    pass++
    console.log(`  ${c.ok('PASS')} ${label}`)
  } else {
    fail++
    failures.push({ label, detail })
    console.log(`  ${c.bad('FAIL')} ${label}`)
    if (detail) console.log(`       ${c.dim(detail)}`)
  }
}

function note(label, detail) {
  warn++
  console.log(`  ${c.warn('NOTE')} ${label}`)
  if (detail) console.log(`       ${c.dim(detail)}`)
}

/**
 * A 404 and an unreachable network look identical to a caller that only sees
 * "it threw". They need opposite responses — one means our card name is stale,
 * the other means nothing was tested at all — so they are distinguished here
 * and the network case is fatal rather than a per-probe note.
 */
class Unreachable extends Error {}
class NotFound extends Error {}

async function get(path) {
  await sleep(120)
  let res
  try {
    res = await fetch(`${API}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'mtg-companion-validator/1.0' },
    })
  } catch (error) {
    throw new Unreachable(error.message)
  }
  if (res.status === 404) throw new NotFound(`${path} -> 404`)
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}

async function preflight() {
  try {
    await get('/cards/named?exact=Forest')
    return true
  } catch (error) {
    if (error instanceof Unreachable) {
      console.log(c.bad('\nCannot reach api.scryfall.com.'))
      console.log(c.dim(`  ${error.message}`))
      console.log(c.dim('\n  Nothing was validated. This is a network problem, not a code problem —'))
      console.log(c.dim('  check your connection, a VPN, or a corporate proxy, then re-run.'))
      return false
    }
    console.log(c.bad(`\nScryfall reachable but the preflight failed: ${error.message}`))
    return false
  }
}

const named = (name) => get(`/cards/named?exact=${encodeURIComponent(name)}`)

// --------------------------------------------------------------------------

async function probeMultiFace() {
  console.log(c.head('\n1. Multi-face cards — we assume card_faces[0] is the castable front'))

  const cases = [
    // [card name, what shape it is, what we expect to be true]
    ['Delver of Secrets // Insectile Aberration', 'transforming DFC'],
    ['Fire // Ice', 'split card'],
    ['Brazen Borrower // Petty Theft', 'adventure'],
    ['Agadeem\'s Awakening // Agadeem, the Undercrypt', 'modal DFC (spell // land)'],
    ['Wear // Tear', 'split card'],
  ]

  for (const [name, shape] of cases) {
    let card
    try {
      card = await named(name)
    } catch (error) {
      if (error instanceof Unreachable) throw error
      note(`${shape}: Scryfall has no exact match for "${name}"`,
        'The card name in this harness is stale (Scryfall uses the full "front // back" form ' +
        'for some layouts and the front name alone for others). Update the probe, not the app.')
      continue
    }

    const faces = card.card_faces?.length ?? 0
    const cost = faceManaCost(card)
    const type = typeLineOf(card)
    const mv = manaValueOf(card)

    check(
      `${shape} (${card.name}): we extract a mana cost`,
      cost.length > 0 || faces === 0,
      `faces=${faces} top-level mana_cost=${JSON.stringify(card.mana_cost)} extracted=${JSON.stringify(cost)}`,
    )

    check(
      `${shape} (${card.name}): mana value is a finite number`,
      Number.isFinite(mv),
      `cmc=${card.cmc} faces[0].cmc=${card.card_faces?.[0]?.cmc} -> ${mv}`,
    )

    check(
      `${shape} (${card.name}): type line is non-empty`,
      type.length > 0,
      `top-level type_line=${JSON.stringify(card.type_line)}`,
    )

    // The real risk: for a modal DFC whose back is a land, does our land
    // detection fire when it should not (or vice versa)?
    if (/\/\//.test(type) && /Land/.test(type)) {
      note(
        `${card.name}: flattened type line contains "Land" (${type})`,
        'isLandCard() matches on the flattened line, so this card counts as a land in curve ' +
        'and land-count analysis. For a spell // land MDFC that is arguably wrong — it is a ' +
        'spell you may instead play as a land. Decide deliberately.',
      )
    }

    // Images live per-face on DFCs and at top level elsewhere.
    const hasImage = !!(card.image_uris || card.card_faces?.[0]?.image_uris)
    check(`${shape} (${card.name}): an image URI is reachable`, hasImage,
      `image_uris=${!!card.image_uris} faces[0].image_uris=${!!card.card_faces?.[0]?.image_uris}`)
  }
}

async function probeProducedMana() {
  console.log(c.head('\n2. produced_mana — we count every value as a real colour source'))

  const cases = [
    ['Forest', ['G'], 'basic land'],
    ['Command Tower', null, 'produces all colours conditionally'],
    ['Flooded Strand', null, 'fetchland — produces nothing itself'],
    ['Mystic Gate', null, 'filter land — needs mana to make mana'],
    ['Ancient Tomb', null, 'colourless, painful'],
    ['Birds of Paradise', null, 'creature that taps for mana'],
    ['Sol Ring', null, 'artifact that taps for mana'],
  ]

  for (const [name, expected, why] of cases) {
    let card
    try {
      card = await named(name)
    } catch (error) {
      if (error instanceof Unreachable) throw error
      note(`Scryfall has no exact match for "${name}"`, 'Stale probe name; update the harness.')
      continue
    }

    const produced = card.produced_mana ?? []
    const sources = colorSources([{ card, quantity: 1 }])
    console.log(`  ${c.dim(`${card.name.padEnd(20)} produced_mana=${JSON.stringify(produced)}  (${why})`)}`)

    if (expected) {
      check(`${card.name}: produced_mana matches expectation`,
        JSON.stringify(produced) === JSON.stringify(expected),
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(produced)}`)
    }

    // The assumption under test: a fetchland produces no mana, so counting it
    // as a coloured source would overstate the mana base.
    if (name === 'Flooded Strand') {
      check('Fetchland is not counted as a coloured source',
        produced.length === 0,
        `produced_mana=${JSON.stringify(produced)} — if non-empty, colorConsistency overstates sources ` +
        `for every fetch-based mana base.`)
      check('Fetchland still counts as a mana source overall (it is a land)',
        countManaSources([{ card, quantity: 1 }]) === 1,
        'Lands count via isLandCard regardless of produced_mana.')
    }

    if (name === 'Mystic Gate' && produced.length > 0) {
      note('Filter lands report produced_mana but require mana to activate',
        `${card.name} -> ${JSON.stringify(produced)}. We count these as full sources, which ` +
        `overstates a mana base built only on filters. Probably acceptable; worth knowing.`)
    }
  }
}

async function probePricing() {
  console.log(c.head('\n3. Pricing — we read prices.usd and treat null as unpriced'))

  // A foil-only printing is the specific case where prices.usd is null but the
  // card is not free: deckPrice() currently reports it as "unpriced".
  let foilOnly = null
  try {
    const search = await get('/cards/search?q=is%3Afoil+-is%3Anonfoil+usd%3E0&order=released&unique=prints')
    foilOnly = search.data?.find((card) => card.prices?.usd == null && card.prices?.usd_foil != null)
  } catch {
    note('could not search for a foil-only printing', 'skipping this probe')
  }

  if (foilOnly) {
    const result = deckPrice([{ card: foilOnly, quantity: 1 }])
    console.log(`  ${c.dim(`${foilOnly.name} (${foilOnly.set}): usd=${foilOnly.prices.usd} usd_foil=${foilOnly.prices.usd_foil}`)}`)
    check('Foil-only printing is reported as unpriced rather than $0',
      result.missing === 1 && result.total === 0,
      `total=${result.total} missing=${result.missing}`)
    note('Foil-only printings contribute nothing to a deck total',
      `${foilOnly.name} costs $${foilOnly.prices.usd_foil} in foil and is the only printing of ` +
      `that art, but deckPrice() counts it as unpriced. Consider falling back to usd_foil.`)
  } else {
    note('No foil-only printing found in the sample', 'The fallback concern may be moot.')
  }

  const bolt = await named('Lightning Bolt')
  check('A common card has a usd price',
    bolt.prices?.usd != null,
    `prices=${JSON.stringify(bolt.prices)}`)
}

async function probeLegalityKeys() {
  console.log(c.head('\n4. Legality keys — every format we claim to support must exist on a card'))

  const card = await named('Llanowar Elves')
  const keys = Object.keys(card.legalities ?? {})
  console.log(`  ${c.dim(`Scryfall exposes ${keys.length} legality keys`)}`)

  for (const format of Object.values(FORMATS)) {
    const present = Object.prototype.hasOwnProperty.call(card.legalities ?? {}, format.legalityKey)
    check(`${format.name} -> legalities.${format.legalityKey}`,
      present,
      present ? '' : `Key absent. Every deck in this format validates as "unknown". ` +
        `Available keys: ${keys.join(', ')}`)
  }
}

async function probeCopyLimits() {
  console.log(c.head('\n5. Copy-limit overrides — we parse these out of oracle text'))

  const cases = [
    ['Relentless Rats', Infinity],
    ['Persistent Petitioners', Infinity],
    ['Dragon\'s Approach', Infinity],
    ['Nazgûl', 9],
    ['Seven Dwarves', 7],
  ]

  for (const [name, expected] of cases) {
    let card
    try {
      card = await named(name)
    } catch (error) {
      if (error instanceof Unreachable) throw error
      note(`Scryfall has no exact match for "${name}"`, 'Stale probe name; update the harness.')
      continue
    }
    const actual = copyLimitOverride(card)
    check(`${card.name}: copy limit parsed as ${expected === Infinity ? 'unlimited' : expected}`,
      actual === expected,
      `got ${actual === Infinity ? 'Infinity' : actual}. Oracle text: ` +
      `"${(oracleTextOf(card).match(/A deck can have[^.]*\./) ?? ['<no clause found>'])[0]}"`)
  }

  const forest = await named('Forest')
  check('Forest is detected as a basic land', isBasicLand(forest), `type_line=${forest.type_line}`)

  const wastes = await named('Wastes')
  check('Wastes is detected as a basic land', isBasicLand(wastes), `type_line=${wastes.type_line}`)

  try {
    const snow = await named('Snow-Covered Forest')
    check('Snow-Covered Forest is detected as a basic land',
      isBasicLand(snow), `type_line=${snow.type_line}`)
  } catch {
    note('could not fetch Snow-Covered Forest', 'skipping')
  }
}

async function probeManaSymbols() {
  console.log(c.head('\n6. Mana symbols — every symbol Scryfall uses must classify'))

  const payload = await get('/symbology')
  const unknown = []
  const costSymbols = (payload.data ?? []).filter((s) => s.represents_mana)

  for (const symbol of costSymbols) {
    const body = symbol.symbol.slice(1, -1)
    const { kind } = classifySymbol(body)
    if (kind === 'other') unknown.push(symbol.symbol)
  }

  check(`All ${costSymbols.length} mana-producing symbols classify`,
    unknown.length === 0,
    unknown.length ? `Unclassified: ${unknown.join(' ')} — these render as grey circles ` +
      `with raw text and contribute no pips.` : '')

  // Spot-check pip counting on a genuinely awkward cost.
  try {
    const kroxa = await named('Kroxa, Titan of Death\'s Hunger')
    console.log(`  ${c.dim(`Kroxa mana_cost=${faceManaCost(kroxa)} pips=${JSON.stringify(countPips(faceManaCost(kroxa)))}`)}`)
  } catch { /* optional */ }
}

async function probeSets() {
  console.log(c.head('\n7. Sets endpoint — the basis for set-aware theming'))

  const payload = await get('/sets')
  const sets = payload.data ?? []
  check('Sets endpoint returns a list', sets.length > 0, `got ${sets.length}`)

  const sample = sets[0]
  for (const field of ['code', 'name', 'released_at', 'set_type', 'icon_svg_uri', 'card_count']) {
    check(`Set objects carry "${field}"`,
      sample && Object.prototype.hasOwnProperty.call(sample, field),
      `sample keys: ${Object.keys(sample ?? {}).join(', ')}`)
  }

  const today = new Date().toISOString().slice(0, 10)
  const expansions = sets.filter((s) => ['expansion', 'core'].includes(s.set_type))
  const upcoming = expansions.filter((s) => s.released_at > today)
    .sort((a, b) => a.released_at.localeCompare(b.released_at))
  const released = expansions.filter((s) => s.released_at <= today)
    .sort((a, b) => b.released_at.localeCompare(a.released_at))

  console.log(`\n  ${c.head('What the theming engine would pick up:')}`)
  console.log(`  Most recent released : ${released[0]?.name} (${released[0]?.code}, ${released[0]?.released_at})`)
  console.log(`  Next upcoming        : ${upcoming[0]?.name ?? '(none announced)'} ` +
    `${upcoming[0] ? `(${upcoming[0].code}, ${upcoming[0].released_at})` : ''}`)
  console.log(`  ${c.dim('Paste these two lines back — they are what I cannot see from my container.')}`)
}

// --------------------------------------------------------------------------

async function main() {
  console.log(c.head('Scryfall live validation'))
  console.log(c.dim('Checking assumptions that mocked tests cannot check.\n'))

  if (!(await preflight())) process.exit(2)

  const probes = [
    probeMultiFace, probeProducedMana, probePricing,
    probeLegalityKeys, probeCopyLimits, probeManaSymbols, probeSets,
  ]

  for (const probe of probes) {
    try {
      await probe()
    } catch (error) {
      if (error instanceof Unreachable) {
        console.log(c.bad(`\n  Lost connection to Scryfall partway through: ${error.message}`))
        console.log(c.dim('  Results above are partial. Re-run when the connection is stable.'))
        process.exit(2)
      }
      fail++
      failures.push({ label: `${probe.name} threw`, detail: error.message })
      console.log(`  ${c.bad('ERROR')} ${probe.name}: ${error.message}`)
    }
  }

  console.log(c.head('\n' + '─'.repeat(60)))
  console.log(`${c.ok(`${pass} passed`)}  ${fail ? c.bad(`${fail} failed`) : '0 failed'}  ${c.warn(`${warn} notes`)}`)

  if (failures.length) {
    console.log(c.head('\nFailures to paste back:'))
    for (const f of failures) {
      console.log(`\n• ${f.label}`)
      if (f.detail) console.log(`  ${f.detail}`)
    }
  }
  process.exit(fail ? 1 : 0)
}

main()
