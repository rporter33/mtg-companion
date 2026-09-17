import { describe, it, expect } from 'vitest'
import {
  resolveEntries, manaCurve, typeBreakdown, colorSources,
  colorConsistency, landAdvice, deckPrice, priciestCards, analyzeDeck, countManaSources, manaBase,
} from '../src/lib/analysis.js'
import { openingHandOdds, minimumSourcesFor } from '../src/lib/probability.js'
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


describe('the mana base by kind', () => {
  const SWAMP = card({ id: 'swamp', name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0, produced_mana: ['B'] })
  const RING = card({ id: 'ring', name: 'Sol Ring', type_line: 'Artifact', cmc: 1, produced_mana: ['C'] })
  const TALISMAN = card({ id: 'tal', name: 'Talisman of Dominance', type_line: 'Artifact', cmc: 2, produced_mana: ['C', 'U', 'B'] })
  const ELVES = card({ id: 'elves', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, mana_cost: '{G}', produced_mana: ['G'] })
  const RITUAL = card({ id: 'ritual', name: 'Dark Ritual', type_line: 'Instant', cmc: 1, mana_cost: '{B}', produced_mana: ['B'] })
  const BB_DROP = card({ id: 'bb', name: 'Two Black', mana_cost: '{B}{B}', cmc: 2, type_line: 'Creature — Vampire', color_identity: ['B'] })
  const ONE_B = card({ id: 'ob', name: 'One Black', mana_cost: '{1}{B}', cmc: 2, type_line: 'Creature — Vampire', color_identity: ['B'] })
  const LATE_B = card({ id: 'lb', name: 'Late Black', mana_cost: '{3}{B}', cmc: 4, type_line: 'Sorcery', color_identity: ['B'] })

  it('tells lands, rocks, dorks and rituals apart', () => {
    const base = manaBase([
      { card: SWAMP, quantity: 30 }, { card: RING, quantity: 1 }, { card: TALISMAN, quantity: 2 },
      { card: ELVES, quantity: 1 }, { card: RITUAL, quantity: 1 }, { card: MDFC, quantity: 1 },
    ])
    expect(base.lands).toBe(30)
    expect(base.rocks).toBe(3)
    expect(base.dorks).toBe(1)
    expect(base.rituals).toBe(1)
    expect(base.modalLands).toBe(1)
    expect(base.total).toBe(35) // a ritual is not a source
  })

  it('puts a rock online the turn after it is cast', () => {
    const base = manaBase([{ card: RING, quantity: 1 }, { card: TALISMAN, quantity: 1 }, { card: ELVES, quantity: 1 }])
    const online = Object.fromEntries(base.accel.map((a) => [a.card.id, a.online]))
    expect(online).toEqual({ ring: 2, tal: 3, elves: 2 })
  })

  it('a two-mana rock is not a source for a turn-two spell, and is for a turn-four one', () => {
    const library = [{ card: SWAMP, quantity: 2 }, { card: TALISMAN, quantity: 8 }, { card: BEAR, quantity: 49 }]
    const early = colorConsistency([...library, { card: ONE_B, quantity: 1 }], 60, { library })
    const late = colorConsistency([...library, { card: LATE_B, quantity: 1 }], 60, { library })
    const blackEarly = early.find((r) => r.color === 'B')
    const blackLate = late.find((r) => r.color === 'B')
    expect(blackEarly.sources).toBe(2) // the swamps alone
    expect(blackEarly.accelSources).toBe(0)
    expect(blackLate.sources).toBe(10)
    expect(blackLate.accelSources).toBe(8)
  })

  it('a double-pip spell asks for more sources than a single-pip one at the same turn', () => {
    const lands = [{ card: SWAMP, quantity: 20 }, { card: FOREST, quantity: 4 }]
    const double = colorConsistency([...lands, { card: BB_DROP, quantity: 4 }], 60).find((r) => r.color === 'B')
    const single = colorConsistency([...lands, { card: ONE_B, quantity: 4 }], 60).find((r) => r.color === 'B')
    expect(double.want).toBe(2)
    expect(single.want).toBe(1)
    expect(double.needed).toBeGreaterThan(single.needed)
    expect(double.needed).toBe(minimumSourcesFor({ deckSize: 60, turn: 2, want: 2, threshold: 0.9 }))
  })

  it('reports the ask that binds, and every ask beside it', () => {
    const rows = colorConsistency([
      { card: SWAMP, quantity: 12 }, { card: BB_DROP, quantity: 4 }, { card: LATE_B, quantity: 4 },
    ], 60)
    const black = rows[0]
    expect(black.demands.map((d) => `${d.turn}:${d.want}`)).toEqual(['2:2', '4:1'])
    expect(black.turn).toBe(2)
    expect(black.want).toBe(2)
    expect(black.earliestTurn).toBe(2)
    expect(black.healthy).toBe(false)
  })

  it('a ritual never counts as a source', () => {
    const rows = colorConsistency([{ card: RITUAL, quantity: 4 }, { card: ONE_B, quantity: 4 }, { card: FOREST, quantity: 20 }], 60)
    expect(rows.find((r) => r.color === 'B').sources).toBe(0)
  })

  it('the commander is a demand but not a source, and not in the library', () => {
    const DORK_COMMANDER = card({
      id: 'dorkcmdr', name: 'Mana Legend', mana_cost: '{1}{G}', cmc: 2,
      type_line: 'Legendary Creature — Elf Druid', color_identity: ['G'], produced_mana: ['G'],
    })
    const look = (id) => (id === 'dorkcmdr' ? DORK_COMMANDER : get(id))
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [DORK_COMMANDER.id])
    deck = addCard(deck, FOREST.id, 36)
    deck = addCard(deck, BEAR.id, 63)
    const result = analyzeDeck(deck, look)
    expect(result.size).toBe(100)
    expect(result.librarySize).toBe(99)
    expect(result.commandZone).toBe(1)
    expect(result.lands.dorks).toBe(0) // the commander is not drawn
    expect(result.colors[0].pips).toBeGreaterThan(0)
    expect(result.odds.noLandHand).toBeCloseTo(openingHandOdds(99, 63, 7, 7), 12)
    expect(result.lands.recommended).toBe(landAdvice([{ card: FOREST, quantity: 36 }, { card: BEAR, quantity: 63 }], 99, 'commander').recommended)
  })

  it('a sixty-card deck has no command zone', () => {
    let deck = createDeck({ formatId: 'modern' })
    deck = addCard(deck, FOREST.id, 24)
    deck = addCard(deck, BEAR.id, 36)
    const result = analyzeDeck(deck, get)
    expect(result.librarySize).toBe(60)
    expect(result.commandZone).toBe(0)
  })
})
