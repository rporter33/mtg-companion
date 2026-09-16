import { describe, it, expect } from 'vitest'
import {
  resolveEntries, manaCurve, typeBreakdown, colorSources,
  colorConsistency, landAdvice, deckPrice, priciestCards, analyzeDeck, countManaSources,
} from '../src/lib/analysis.js'
import { createDeck, addCard, setCommanders } from '../src/lib/deck.js'
import { priceOf } from '../src/lib/analysis.js'
import { isModalLand, isTrueLand } from '../src/lib/formats.js'
import { card, legalEverywhere, FOREST, ISLAND, BEAR, COUNTERSPELL, COMMANDER_BEAR } from './fixtures.js'

/**
 * The exact card live validation flagged: a six-mana sorcery whose back face is
 * a land, so the flattened type line contains "Land".
 */
const MDFC = card({
  id: 'mdfc', name: "Agadeem's Awakening", cmc: 6, type_line: 'Sorcery // Land',
  color_identity: ['B'],
  card_faces: [
    { type_line: 'Sorcery', mana_cost: '{X}{B}{B}{B}', oracle_text: '' },
    { type_line: 'Land', oracle_text: '{T}: Add {B}.' },
  ],
})

const lookup = new Map([
  [FOREST.id, FOREST], [ISLAND.id, ISLAND], [BEAR.id, BEAR],
  [COUNTERSPELL.id, COUNTERSPELL], [COMMANDER_BEAR.id, COMMANDER_BEAR],
])
const get = (id) => lookup.get(id)

describe('manaCurve', () => {
  it('excludes lands so they cannot swamp the histogram', () => {
    const curve = manaCurve(resolveEntries(
      [{ cardId: FOREST.id, quantity: 24 }, { cardId: BEAR.id, quantity: 4 }], get))
    expect(curve.buckets[0]).toBe(0)
    expect(curve.buckets[2]).toBe(4)
    expect(curve.nonLandCount).toBe(4)
    expect(curve.averageManaValue).toBe(2)
  })

  it('buckets everything at 7 or above into the top bucket', () => {
    const big = card({ id: 'big', cmc: 12, type_line: 'Creature — Eldrazi' })
    const curve = manaCurve([{ card: big, quantity: 2 }])
    expect(curve.buckets[7]).toBe(2)
  })

  it('reports an average of zero for an empty deck without dividing by zero', () => {
    expect(manaCurve([]).averageManaValue).toBe(0)
  })
})

describe('typeBreakdown', () => {
  it('counts each card exactly once, most specific type first', () => {
    const artifactCreature = card({ id: 'ac', type_line: 'Artifact Creature — Golem' })
    const counts = typeBreakdown([
      { card: BEAR, quantity: 4 },
      { card: COUNTERSPELL, quantity: 4 },
      { card: FOREST, quantity: 10 },
      { card: artifactCreature, quantity: 2 },
    ])
    expect(counts.Creature).toBe(6) // bears + the artifact creature, not double-counted
    expect(counts.Artifact).toBe(0)
    expect(counts.Instant).toBe(4)
    expect(counts.Land).toBe(10)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(20)
  })
})

describe('colorSources', () => {
  it('reads sources from produced_mana, not from rules text', () => {
    const { sources, landCount, basicCount } = colorSources([
      { card: FOREST, quantity: 10 }, { card: ISLAND, quantity: 8 },
    ])
    expect(sources.G).toBe(10)
    expect(sources.U).toBe(8)
    expect(landCount).toBe(18)
    expect(basicCount).toBe(18)
  })

  it('counts nonland mana producers as sources', () => {
    const rock = card({ id: 'rock', type_line: 'Artifact', produced_mana: ['G'] })
    expect(countManaSources([{ card: rock, quantity: 8 }, { card: BEAR, quantity: 4 }])).toBe(8)
  })
})

describe('colorConsistency', () => {
  it('flags a colour the deck demands but cannot produce', () => {
    // 4 Counterspells, but every land is a Forest.
    const rows = colorConsistency([
      { card: FOREST, quantity: 24 }, { card: COUNTERSPELL, quantity: 4 },
    ], 60)
    const blue = rows.find((r) => r.color === 'U')
    expect(blue.sources).toBe(0)
    expect(blue.healthy).toBe(false)
    expect(blue.shortfall).toBeGreaterThan(0)
  })

  it('passes a colour with plenty of sources', () => {
    const rows = colorConsistency([
      { card: FOREST, quantity: 24 }, { card: BEAR, quantity: 4 },
    ], 60)
    expect(rows.find((r) => r.color === 'G').healthy).toBe(true)
  })

  it('ignores colours the deck never asks for', () => {
    const rows = colorConsistency([{ card: FOREST, quantity: 24 }, { card: BEAR, quantity: 4 }], 60)
    expect(rows.map((r) => r.color)).toEqual(['G'])
  })

  it('demands fewer sources for a colour only needed late', () => {
    const early = card({ id: 'e', mana_cost: '{U}', cmc: 1, type_line: 'Instant', color_identity: ['U'] })
    const late = card({ id: 'l', mana_cost: '{5}{U}', cmc: 6, type_line: 'Sorcery', color_identity: ['U'] })
    const earlyRow = colorConsistency([{ card: early, quantity: 4 }, { card: ISLAND, quantity: 20 }], 60)[0]
    const lateRow = colorConsistency([{ card: late, quantity: 4 }, { card: ISLAND, quantity: 20 }], 60)[0]
    expect(lateRow.needed).toBeLessThan(earlyRow.needed)
  })
})

describe('landAdvice', () => {
  it('counts mana rocks toward the mana base', () => {
    const rock = card({ id: 'rock', type_line: 'Artifact', cmc: 2, produced_mana: ['C'] })
    const advice = landAdvice([{ card: FOREST, quantity: 34 }, { card: rock, quantity: 10 },
      { card: BEAR, quantity: 56 }], 100, 'commander')
    expect(advice.landCount).toBe(34)
    expect(advice.nonLandSources).toBe(10)
    expect(advice.totalSources).toBe(44)
  })

  it('tells a land-light deck it is short', () => {
    const advice = landAdvice([{ card: FOREST, quantity: 12 }, { card: BEAR, quantity: 48 }], 60, 'modern')
    expect(advice.delta).toBeLessThan(0)
  })

  it('is satisfied by a conventional 24-land midrange deck', () => {
    const three = card({ id: 'three', mana_cost: '{2}{G}', cmc: 3, type_line: 'Creature — Bear' })
    const advice = landAdvice([{ card: FOREST, quantity: 24 }, { card: three, quantity: 36 }], 60, 'modern')
    expect(Math.abs(advice.delta)).toBeLessThanOrEqual(2)
  })
})

describe('deckPrice', () => {
  it('multiplies by quantity and reports unpriced cards separately', () => {
    const noPrice = card({ id: 'np', prices: {} })
    const result = deckPrice([
      { card: COUNTERSPELL, quantity: 4 }, // 1.50 each
      { card: BEAR, quantity: 2 },         // 0.10 each
      { card: noPrice, quantity: 3 },
    ])
    expect(result.total).toBeCloseTo(6.2, 5)
    expect(result.priced).toBe(6)
    expect(result.missing).toBe(3)
  })

  it('never treats a missing price as zero in the priced count', () => {
    const result = deckPrice([{ card: card({ id: 'x', prices: { usd: null } }), quantity: 1 }])
    expect(result.total).toBe(0)
    expect(result.missing).toBe(1)
    expect(result.priced).toBe(0)
  })
})

describe('priciestCards', () => {
  it('ranks by total contribution, not unit price', () => {
    const single = legalEverywhere({ id: 'single', name: 'Pricey', prices: { usd: '5.00' } })
    const playset = legalEverywhere({ id: 'set', name: 'Cheap', prices: { usd: '2.00' } })
    const ranked = priciestCards([
      { card: single, quantity: 1 }, { card: playset, quantity: 4 },
    ])
    expect(ranked[0].card.name).toBe('Cheap') // 8.00 total beats 5.00
    expect(ranked[0].total).toBe(8)
  })
})

describe('analyzeDeck', () => {
  it('includes the commander in the analysis', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, FOREST.id, 99)
    const result = analyzeDeck(deck, get)
    expect(result.size).toBe(100)
    expect(result.curve.nonLandCount).toBe(1) // the commander
    expect(result.types.Land).toBe(99)
  })

  it('survives an empty deck without throwing', () => {
    const result = analyzeDeck(createDeck({ formatId: 'modern' }), get)
    expect(result.size).toBe(0)
    expect(result.colors).toEqual([])
    expect(Number.isFinite(result.lands.recommended)).toBe(true)
  })
})


describe('modal double-faced lands (found by live validation)', () => {
  it('is not a true land — the front face is what you cast', () => {
    expect(isTrueLand(MDFC)).toBe(false)
    expect(isModalLand(MDFC)).toBe(true)
  })

  it('stays in the mana curve at its real cost', () => {
    // The bug: the flattened "Sorcery // Land" type line matched a land check,
    // so a six-mana sorcery vanished from the curve entirely.
    const curve = manaCurve([{ card: MDFC, quantity: 4 }])
    expect(curve.nonLandCount).toBe(4)
    expect(curve.buckets[6]).toBe(4)
  })

  it('is filed under its front-face type, not as a land', () => {
    const types = typeBreakdown([{ card: MDFC, quantity: 4 }])
    expect(types.Sorcery).toBe(4)
    expect(types.Land).toBe(0)
  })

  it('still counts as a mana source, because you may play it as a land', () => {
    expect(countManaSources([{ card: MDFC, quantity: 4 }])).toBe(4)
  })

  it('is reported separately so the mana base is honest about what it is', () => {
    const advice = landAdvice(
      [{ card: MDFC, quantity: 4 }, { card: FOREST, quantity: 20 }], 60, 'modern')
    expect(advice.landCount).toBe(20)
    expect(advice.modalLands).toBe(4)
    expect(advice.totalSources).toBe(24)
  })

  it('does not mistake an ordinary transforming creature for a modal land', () => {
    const werewolf = card({
      id: 'w', type_line: 'Creature — Human // Creature — Werewolf',
      card_faces: [{ type_line: 'Creature — Human' }, { type_line: 'Creature — Werewolf' }],
    })
    expect(isModalLand(werewolf)).toBe(false)
  })

  it('does not mistake a true land with two faces for a modal land', () => {
    const dfcLand = card({
      id: 'dl', type_line: 'Land // Land',
      card_faces: [{ type_line: 'Land' }, { type_line: 'Land' }],
    })
    expect(isTrueLand(dfcLand)).toBe(true)
    expect(isModalLand(dfcLand)).toBe(false)
  })
})

describe('foil-only pricing (found by live validation)', () => {
  const foilOnly = card({ id: 'f', name: 'Craterclaw Colossus', prices: { usd: null, usd_foil: '199.00' } })

  it('falls back to the foil price rather than reporting a $199 card as free', () => {
    expect(priceOf(foilOnly)).toEqual({ value: 199, foil: true })
  })

  it('counts the card and flags that the price is a foil one', () => {
    const result = deckPrice([{ card: foilOnly, quantity: 1 }])
    expect(result.total).toBe(199)
    expect(result.foilOnly).toBe(1)
    expect(result.missing).toBe(0)
  })

  it('prefers a nonfoil price when both exist', () => {
    const both = card({ id: 'b', prices: { usd: '2.00', usd_foil: '40.00' } })
    expect(priceOf(both)).toEqual({ value: 2, foil: false })
  })

  it('distinguishes a genuinely free card from an unpriced one', () => {
    // Number(null) is 0, not NaN — the trap that made null read as free.
    expect(priceOf(card({ id: 'z', prices: { usd: '0.00' } }))).toEqual({ value: 0, foil: false })
    expect(priceOf(card({ id: 'n', prices: { usd: null } })).value).toBeNull()
    expect(priceOf(card({ id: 'e', prices: {} })).value).toBeNull()
  })
})
