// Deck analysis: curve, type breakdown, colour requirements vs. actual sources,
// land recommendation, price totals, and draw odds.

import { COLORS, aggregatePips, faceManaCost } from './mana.js'
import { typeLineOf, getFormat } from './formats.js'
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
    const line = typeLineOf(card)
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
 * Compares what the deck demands in each colour against what it can actually
 * produce, and says which colours are short. The "needed" figure is solved from
 * the hypergeometric distribution at this deck's real size.
 */
export function colorConsistency(resolved, deckSize) {
  const pips = aggregatePips(resolved.map(({ card, quantity }) => ({ card, quantity })))
  const { sources } = colorSources(resolved)

  // Earliest turn a colour is actually demanded — a splash you only need on
  // turn five needs far fewer sources than a colour you want on turn one.
  const earliestTurn = {}
  for (const c of COLORS) earliestTurn[c] = null
  for (const { card } of resolved) {
    if (isLandCard(card)) continue
    const cost = faceManaCost(card)
    const mv = Math.max(1, Math.round(manaValueOf(card)))
    for (const c of COLORS) {
      if (!cost.includes(c)) continue
      if (earliestTurn[c] === null || mv < earliestTurn[c]) earliestTurn[c] = mv
    }
  }

  return COLORS.filter((c) => pips[c] > 0).map((c) => {
    const turn = Math.min(earliestTurn[c] ?? 3, 6)
    const needed = minimumSourcesFor({ deckSize, turn, want: 1, threshold: 0.9 })
    const have = sources[c]
    return {
      color: c,
      pips: pips[c],
      sources: have,
      needed,
      earliestTurn: turn,
      shortfall: Math.max(0, needed - have),
      healthy: have >= needed,
    }
  })
}

export function landAdvice(resolved, deckSize, formatId) {
  const { landCount, sources } = { ...colorSources(resolved) }
  const curve = manaCurve(resolved)
  const format = getFormat(formatId)

  // Every permanent that taps for mana counts, not just lands — a Commander
  // deck's rocks and dorks are a real part of its mana base, and judging such a
  // deck on land count alone always reads as "you are short on lands".
  const totalSources = countManaSources(resolved)
  const recommended = recommendedSourceCount({
    deckSize,
    averageManaValue: curve.averageManaValue,
  })

  const targetTurn = format?.group === 'commander' ? 4 : 3

  return {
    landCount,
    nonLandSources: totalSources - landCount,
    totalSources,
    recommended,
    targetTurn,
    delta: totalSources - recommended,
    averageManaValue: curve.averageManaValue,
    oddsOnCurve: deckSize ? landDropOdds(deckSize, landCount, targetTurn, true) : 0,
  }
}

/** Any card that can produce mana counts as a source, land or not. */
export function countManaSources(resolved) {
  let n = 0
  for (const { card, quantity } of resolved) {
    if (isLandCard(card) || (card.produced_mana?.length ?? 0) > 0) n += quantity
  }
  return n
}

/**
 * Deck price. Scryfall's prices are a daily aggregate from market data, not a
 * live quote, and are absent for some printings — cards without a price are
 * reported separately rather than silently treated as free.
 */
export function deckPrice(resolved, currency = 'usd') {
  let total = 0
  let missing = 0
  let priced = 0
  for (const { card, quantity } of resolved) {
    const raw = card.prices?.[currency]
    const value = raw == null ? null : Number(raw)
    if (value === null || Number.isNaN(value)) {
      missing += quantity
      continue
    }
    total += value * quantity
    priced += quantity
  }
  return { total, missing, priced, currency }
}

/** The most expensive cards in the deck, for the "what's driving the cost" list. */
export function priciestCards(resolved, currency = 'usd', limit = 5) {
  return resolved
    .map(({ card, quantity }) => ({
      card,
      quantity,
      unit: Number(card.prices?.[currency] ?? 0),
    }))
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

export function analyzeDeck(deck, lookup) {
  const format = getFormat(deck.formatId)
  const entries = [...deck.main]
  for (const id of deck.commanders) entries.push({ cardId: id, quantity: 1 })
  if (deck.signatureSpell) entries.push({ cardId: deck.signatureSpell, quantity: 1 })

  const resolved = resolveEntries(entries, lookup)
  const size = resolved.reduce((n, e) => n + e.quantity, 0)

  return {
    size,
    curve: manaCurve(resolved),
    types: typeBreakdown(resolved),
    colors: colorConsistency(resolved, size || format?.deck.min || 60),
    lands: landAdvice(resolved, size || format?.deck.min || 60, deck.formatId),
    price: deckPrice(resolved),
    priciest: priciestCards(resolved),
    odds: drawOdds(resolved, size || format?.deck.min || 60, deck.formatId),
  }
}
