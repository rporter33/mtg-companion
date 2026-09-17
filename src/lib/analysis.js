// Deck analysis: curve, type breakdown, colour requirements vs. actual sources,
// land recommendation, price totals, and draw odds.

import { COLORS, aggregatePips, faceManaCost, countPips } from './mana.js'
import { typeLineOf, getFormat, frontTypeLine, isModalLand } from './formats.js'
import { isLandCard, isBasicLand } from './deck.js'
import {
  recommendedSourceCount, minimumSourcesFor, landDropOdds, openingHandOdds,
} from './probability.js'

const CARD_TYPES = [
  'Creature', 'Planeswalker', 'Instant', 'Sorcery',
  'Artifact', 'Enchantment', 'Battle', 'Land',
]

export const CURVE_BUCKETS = [0, 1, 2, 3, 4, 5, 6, 7]

/** Resolves deck entries to { card, quantity } pairs, dropping unloaded cards. */
export function resolveEntries(entries, lookup) {
  const get = typeof lookup === 'function' ? lookup : (id) => lookup?.[id]
  return entries
    .map(({ cardId, quantity }) => ({ card: get(cardId), quantity }))
    .filter((e) => e.card)
}

export function manaValueOf(card) {
  // Scryfall reports a single cmc for the whole card. For a modal double-faced
  // card that is the front face's value, which is the one you pay from hand.
  if (typeof card?.cmc === 'number') return card.cmc
  const face = card?.card_faces?.[0]
  return typeof face?.cmc === 'number' ? face.cmc : 0
}

/**
 * Mana curve over non-land cards. Lands are excluded because a curve including
 * them tells you nothing — they are all mana value zero and would swamp the
 * histogram. The top bucket is "7 or more".
 */
export function manaCurve(resolved) {
  const buckets = Object.fromEntries(CURVE_BUCKETS.map((b) => [b, 0]))
  let nonLand = 0
  let weighted = 0
  for (const { card, quantity } of resolved) {
    if (isLandCard(card)) continue
    const mv = Math.max(0, Math.round(manaValueOf(card)))
    const bucket = Math.min(mv, 7)
    buckets[bucket] += quantity
    nonLand += quantity
    weighted += mv * quantity
  }
  return {
    buckets,
    nonLandCount: nonLand,
    averageManaValue: nonLand ? weighted / nonLand : 0,
    peak: Math.max(1, ...Object.values(buckets)),
  }
}

export function typeBreakdown(resolved) {
  const counts = Object.fromEntries(CARD_TYPES.map((t) => [t, 0]))
  let other = 0
  for (const { card, quantity } of resolved) {
    // Front face only: a "Sorcery // Land" is a sorcery you may instead play as
    // a land, and filing it under Land hides it from the spell counts.
    const line = frontTypeLine(card) || typeLineOf(card)
    // A card can be more than one type (Artifact Creature). Count it under the
    // most specific type present, scanning in priority order, so totals still sum
    // to the deck size rather than double-counting.
    const match = CARD_TYPES.find((t) => new RegExp(`\\b${t}s?\\b`).test(line))
    if (match) counts[match] += quantity
    else other += quantity
  }
  return { ...counts, Other: other }
}

/**
 * Colour sources, from Scryfall's `produced_mana` field rather than from
 * parsing rules text. Any permanent that can produce mana counts, not just
 * lands — mana rocks and dorks are real sources and Commander decks live on them.
 */
export function colorSources(resolved) {
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  let landCount = 0
  let basicCount = 0
  for (const { card, quantity } of resolved) {
    if (isLandCard(card)) {
      landCount += quantity
      if (isBasicLand(card)) basicCount += quantity
    }
    for (const c of card.produced_mana ?? []) {
      if (sources[c] !== undefined) sources[c] += quantity
    }
  }
  return { sources, landCount, basicCount }
}

/**
 * The mana base by kind, because a two-mana rock is not an untapped land.
 *
 * Lands (and modal cards you may play as a land) are there from the turn
 * they are drawn. A rock or a dork has to be cast first and then survive to
 * the next untap, so it is "online" from the turn after its mana value at
 * the earliest, and that is the turn it starts to count as a source. A
 * ritual makes mana once and is not a source at all. None of this models
 * tapped lands, cost reduction or the mana it takes to cast the rock; those
 * are named as assumptions rather than folded in.
 */
export function manaBase(resolved) {
  const base = { lands: 0, modalLands: 0, rocks: 0, dorks: 0, rituals: 0, total: 0, accel: [] }
  for (const { card, quantity } of resolved) {
    if (isLandCard(card)) { base.lands += quantity; continue }
    if (isModalLand(card)) { base.modalLands += quantity; continue }
    if (!(card.produced_mana?.length)) continue
    const line = frontTypeLine(card) || typeLineOf(card)
    if (/\b(Instant|Sorcery)\b/.test(line)) { base.rituals += quantity; continue }
    const kind = /\bCreature\b/.test(line) ? 'dorks' : 'rocks'
    const online = Math.max(1, Math.round(manaValueOf(card))) + 1
    base[kind] += quantity
    base.accel.push({ card, quantity, kind, online, colors: card.produced_mana.filter((c) => COLORS.includes(c) || c === 'C') })
  }
  base.total = base.lands + base.modalLands + base.rocks + base.dorks
  return base
}

/** Sources of a colour that can be counted on by a turn: lands always, acceleration once online. */
function sourcesByTurn(library, base, color, turn) {
  let lands = 0
  for (const { card, quantity } of library) {
    if (!(isLandCard(card) || isModalLand(card))) continue
    if ((card.produced_mana ?? []).includes(color)) lands += quantity
  }
  let accel = 0
  for (const a of base.accel) if (a.online <= turn && a.colors.includes(color)) accel += a.quantity
  return { lands, accel, total: lands + accel }
}

/**
 * Compares what the deck demands in each colour against what it can produce
 * in time, and says which colours are short.
 *
 * Every spell is a demand: how many pips of a colour, by which turn (its
 * mana value, capped at six). The sources needed for each demand are solved
 * from the hypergeometric distribution at the library's real size, wanting
 * that many pips' worth by that turn nine games in ten — so a {B}{B} two-drop
 * asks for more black than a {1}{B} one, and a colour first wanted on turn
 * five asks for less than one wanted on turn one. What is on hand by that
 * turn is lands plus whatever acceleration is online by then. The row
 * reports the demand that binds: the largest shortfall, or the largest
 * need when nothing is short.
 *
 * `library` is where sources are counted from; the commander is a demand
 * (you want to cast it) but not a source (it is never drawn).
 */
export function colorConsistency(resolved, deckSize, { library = resolved } = {}) {
  const pips = aggregatePips(resolved.map(({ card, quantity }) => ({ card, quantity })))
  const base = manaBase(library)

  const demands = {}
  for (const c of COLORS) demands[c] = new Map()
  for (const { card } of resolved) {
    if (isLandCard(card)) continue
    const cost = faceManaCost(card)
    const perColor = countPips(cost)
    const turn = Math.min(Math.max(1, Math.round(manaValueOf(card))), 6)
    for (const c of COLORS) {
      const want = perColor[c]
      if (!want) continue
      const key = `${turn}:${want}`
      if (!demands[c].has(key)) demands[c].set(key, { turn, want })
    }
  }

  // A colour with pips always has at least one demand: pips are counted
  // from the same costs the demands are read from.
  return COLORS.filter((c) => pips[c] > 0 && demands[c].size > 0).map((c) => {
    const rows = [...demands[c].values()].map(({ turn, want }) => {
      const needed = minimumSourcesFor({ deckSize, turn, want, threshold: 0.9 })
      const have = sourcesByTurn(library, base, c, turn)
      return { turn, want, needed, have: have.total, landSources: have.lands, accelSources: have.accel, short: Math.max(0, needed - have.total) }
    })
    const binding = rows.reduce((best, row) => (
      row.short > best.short || (row.short === best.short && row.needed > best.needed) ? row : best
    ))
    return {
      color: c,
      pips: pips[c],
      sources: binding.have,
      landSources: binding.landSources,
      accelSources: binding.accelSources,
      needed: binding.needed,
      earliestTurn: Math.min(...rows.map((r) => r.turn)),
      turn: binding.turn,
      want: binding.want,
      shortfall: binding.short,
      healthy: binding.short === 0,
      demands: rows.sort((a, b) => a.turn - b.turn || a.want - b.want),
    }
  })
}

/**
 * The mana base against what this curve usually wants.
 *
 * Every permanent that taps for mana counts toward the total, not just
 * lands — a Commander deck's rocks and dorks are a real part of its mana
 * base, and judging such a deck on land count alone always reads as "you
 * are short on lands". Rituals do not count: they make mana once. The
 * on-curve odds use lands alone, because a rock in the opening seven is
 * not a land drop. `library` is where sources are counted; the curve is
 * read from everything you cast, commander included.
 */
export function landAdvice(resolved, deckSize, formatId, { library = resolved } = {}) {
  const base = manaBase(library)
  const landCount = base.lands
  const curve = manaCurve(resolved)
  const format = getFormat(formatId)

  const totalSources = base.total
  const recommended = recommendedSourceCount({
    deckSize,
    averageManaValue: curve.averageManaValue,
  })

  const targetTurn = format?.group === 'commander' ? 4 : 3

  return {
    landCount,
    modalLands: base.modalLands,
    rocks: base.rocks,
    dorks: base.dorks,
    rituals: base.rituals,
    nonLandSources: totalSources - landCount,
    totalSources,
    recommended,
    targetTurn,
    delta: totalSources - recommended,
    averageManaValue: curve.averageManaValue,
    oddsOnCurve: deckSize ? landDropOdds(deckSize, landCount, targetTurn, true) : 0,
  }
}

/**
 * Anything that can produce mana counts as a source: lands, mana rocks, dorks,
 * and modal cards whose back face is a land.
 *
 * Modal lands are counted at full weight here even though playing one as a land
 * means giving up a spell. That is the same conservative direction as the pip
 * counting — we would rather advise a mana base that works than one that is
 * technically minimal.
 */
export function countManaSources(resolved) {
  let n = 0
  for (const { card, quantity } of resolved) {
    if (isLandCard(card) || isModalLand(card) || (card.produced_mana?.length ?? 0) > 0) {
      n += quantity
    }
  }
  return n
}

/**
 * Reads a usable price off a printing.
 *
 * Some printings exist only in foil — live validation turned up a $199 card
 * whose `prices.usd` is null — and reporting those as unpriced made a deck
 * containing one look free. Falling back to the foil price is far closer to the
 * truth than zero, but it is a different number, so the fallback is reported
 * rather than folded in silently.
 */
export function priceOf(card, currency = 'usd') {
  // Number(null) is 0, not NaN, so a null price passes a bare isFinite check and
  // reads as free. Absence has to be tested before conversion.
  const read = (key) => {
    const raw = card?.prices?.[key]
    if (raw === null || raw === undefined || raw === '') return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }

  const direct = read(currency)
  if (direct !== null) return { value: direct, foil: false }

  const foil = read(currency === 'usd' ? 'usd_foil' : `${currency}_foil`)
  if (foil !== null) return { value: foil, foil: true }

  return { value: null, foil: false }
}

/**
 * Deck price. Scryfall's prices are a daily aggregate from market data, not a
 * live quote, and are absent for some printings — cards with no price at all
 * are reported separately rather than silently treated as free, and cards
 * priced only in foil are counted but flagged.
 */
export function deckPrice(resolved, currency = 'usd') {
  let total = 0
  let missing = 0
  let priced = 0
  let foilOnly = 0
  for (const { card, quantity } of resolved) {
    const { value, foil } = priceOf(card, currency)
    if (value === null) {
      missing += quantity
      continue
    }
    total += value * quantity
    priced += quantity
    if (foil) foilOnly += quantity
  }
  return { total, missing, priced, foilOnly, currency }
}

/** The most expensive cards in the deck, for the "what's driving the cost" list. */
export function priciestCards(resolved, currency = 'usd', limit = 5) {
  return resolved
    .map(({ card, quantity }) => {
      const { value, foil } = priceOf(card, currency)
      return { card, quantity, unit: value ?? 0, foil }
    })
    .filter((e) => e.unit > 0)
    .map((e) => ({ ...e, total: e.unit * e.quantity }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

/** Draw-odds table for the analysis panel. */
export function drawOdds(resolved, deckSize, formatId) {
  const { landCount } = colorSources(resolved)
  const format = getFormat(formatId)
  const handSize = format?.group === 'commander' ? 7 : 7
  const rows = []
  for (const turn of [1, 2, 3, 4, 5]) {
    rows.push({
      turn,
      onPlay: landDropOdds(deckSize, landCount, turn, true),
      onDraw: landDropOdds(deckSize, landCount, turn, false),
    })
  }
  return {
    rows,
    handSize,
    noLandHand: deckSize ? openingHandOdds(deckSize, deckSize - landCount, handSize, handSize) : 0,
    allLandHand: deckSize ? openingHandOdds(deckSize, landCount, handSize, handSize) : 0,
  }
}

/**
 * The whole picture. The commander is part of the deck — its cost is on the
 * curve and its colours are demanded — but it starts in the command zone,
 * so every probability is drawn from the library without it: a 100-card
 * Commander deck shuffles 99.
 */
export function analyzeDeck(deck, lookup) {
  const format = getFormat(deck.formatId)
  const zone = []
  for (const id of deck.commanders) zone.push({ cardId: id, quantity: 1 })
  if (deck.signatureSpell) zone.push({ cardId: deck.signatureSpell, quantity: 1 })

  const library = resolveEntries(deck.main, lookup)
  const resolved = [...library, ...resolveEntries(zone, lookup)]
  const size = resolved.reduce((n, e) => n + e.quantity, 0)
  const librarySize = library.reduce((n, e) => n + e.quantity, 0)
  const population = librarySize || format?.deck.min || 60

  return {
    size,
    librarySize,
    commandZone: size - librarySize,
    curve: manaCurve(resolved),
    types: typeBreakdown(resolved),
    colors: colorConsistency(resolved, population, { library }),
    lands: landAdvice(resolved, population, deck.formatId, { library }),
    price: deckPrice(resolved),
    priciest: priciestCards(resolved),
    odds: drawOdds(library, population, deck.formatId),
  }
}
