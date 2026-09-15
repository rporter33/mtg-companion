import { describe, it, expect } from 'vitest'
import {
  hypergeometric, atLeast, atMost, cardsSeenByTurn,
  openingHandOdds, landDropOdds, minimumSourcesFor,
  baseSourceCount, recommendedSourceCount,
} from '../src/lib/probability.js'

const close = (a, b, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)

describe('hypergeometric', () => {
  it('matches a hand-computable case', () => {
    // 4 successes in 52, draw 5, want exactly 1:
    // C(4,1)*C(48,4)/C(52,5) = 4*194580/2598960
    close(hypergeometric(52, 4, 5, 1), (4 * 194580) / 2598960)
  })

  it('is a proper distribution — all outcomes sum to 1', () => {
    let sum = 0
    for (let k = 0; k <= 7; k++) sum += hypergeometric(60, 24, 7, k)
    close(sum, 1, 1e-12)
  })

  it('returns 0 for impossible outcomes', () => {
    expect(hypergeometric(60, 4, 7, 5)).toBe(0)   // more hits than copies exist
    expect(hypergeometric(60, 4, 7, -1)).toBe(0)
    expect(hypergeometric(60, 61, 7, 0)).toBe(0)  // more successes than cards
    expect(hypergeometric(60, 4, 70, 1)).toBe(0)  // more draws than cards
  })

  it('allows outcomes that are unlikely but possible', () => {
    // Whiffing entirely on 40 successes in 7 draws is rare, not impossible:
    // there are still 20 non-successes to hit.
    expect(hypergeometric(60, 40, 7, 0)).toBeGreaterThan(0)
  })

  it('handles the degenerate all-successes deck', () => {
    close(hypergeometric(60, 60, 7, 7), 1)
  })

  it('does not overflow on large populations', () => {
    const p = hypergeometric(500, 250, 100, 50)
    expect(Number.isFinite(p)).toBe(true)
    expect(p).toBeGreaterThan(0)
  })
})

describe('atLeast / atMost', () => {
  it('are complementary', () => {
    const a = atLeast(60, 24, 7, 3)
    const b = atMost(60, 24, 7, 2)
    close(a + b, 1, 1e-12)
  })

  it('atLeast(0) is certain', () => {
    expect(atLeast(60, 24, 7, 0)).toBe(1)
  })

  it('reproduces the familiar 4-of opening hand figure', () => {
    // A 4-of in a 60 card deck appears in roughly 40% of opening sevens.
    const p = openingHandOdds(60, 4, 1)
    expect(p).toBeGreaterThan(0.39)
    expect(p).toBeLessThan(0.41)
  })
})

describe('cardsSeenByTurn', () => {
  it('does not draw on turn one when on the play', () => {
    expect(cardsSeenByTurn(1, true)).toBe(7)
    expect(cardsSeenByTurn(3, true)).toBe(9)
  })

  it('draws every turn when on the draw', () => {
    expect(cardsSeenByTurn(1, false)).toBe(8)
    expect(cardsSeenByTurn(3, false)).toBe(10)
  })
})

describe('landDropOdds', () => {
  it('is better on the draw than on the play', () => {
    expect(landDropOdds(60, 24, 3, false)).toBeGreaterThan(landDropOdds(60, 24, 3, true))
  })

  it('degrades as the deck thins on lands', () => {
    expect(landDropOdds(60, 17, 3, true)).toBeLessThan(landDropOdds(60, 24, 3, true))
  })
})

describe('minimumSourcesFor', () => {
  it('needs fewer sources the later the colour is required', () => {
    const t1 = minimumSourcesFor({ deckSize: 60, turn: 1 })
    const t4 = minimumSourcesFor({ deckSize: 60, turn: 4 })
    expect(t4).toBeLessThan(t1)
  })

  it('lands near the community consensus for a turn-one colour in 60 cards', () => {
    // Published tables put a reliable turn-one colour around 14 sources.
    const n = minimumSourcesFor({ deckSize: 60, turn: 1, threshold: 0.9 })
    expect(n).toBeGreaterThanOrEqual(12)
    expect(n).toBeLessThanOrEqual(16)
  })

  it('actually meets the threshold it was asked for', () => {
    const n = minimumSourcesFor({ deckSize: 99, turn: 2, threshold: 0.9 })
    expect(atLeast(99, n, cardsSeenByTurn(2, true), 1)).toBeGreaterThanOrEqual(0.9)
    expect(atLeast(99, n - 1, cardsSeenByTurn(2, true), 1)).toBeLessThan(0.9)
  })
})

describe('source recommendation', () => {
  // These are the calibration tests. The model exists to reproduce the land
  // counts real decks actually run; if it stops doing that, it is broken
  // regardless of how principled the maths looks.
  it('reproduces the standard 60-card land count', () => {
    expect(baseSourceCount({ deckSize: 60 })).toBe(24)
  })

  it('reproduces a sane limited land count', () => {
    // Limited convention is 17; landing on 16 for a 40-card deck is within one.
    expect(baseSourceCount({ deckSize: 40 })).toBe(16)
  })

  it('reproduces a sane Commander source count', () => {
    // ~37 lands plus ~8 rocks is the community shape; 40 is a fair floor.
    expect(baseSourceCount({ deckSize: 100 })).toBe(40)
  })

  it('asks for fewer sources as the curve drops', () => {
    const aggro = recommendedSourceCount({ deckSize: 60, averageManaValue: 1.8 })
    const midrange = recommendedSourceCount({ deckSize: 60, averageManaValue: 2.75 })
    const control = recommendedSourceCount({ deckSize: 60, averageManaValue: 3.6 })
    expect(aggro).toBeLessThan(midrange)
    expect(control).toBeGreaterThan(midrange)
    expect(aggro).toBeGreaterThanOrEqual(20)
    expect(control).toBeLessThanOrEqual(28)
  })

  it('clamps the curve adjustment so degenerate curves cannot run away', () => {
    const absurd = recommendedSourceCount({ deckSize: 60, averageManaValue: 12 })
    const free = recommendedSourceCount({ deckSize: 60, averageManaValue: 0 })
    expect(absurd).toBe(28)
    expect(free).toBe(20)
  })

  it('actually meets its stated threshold', () => {
    const n = baseSourceCount({ deckSize: 60 })
    expect(atLeast(60, n, 7, 2)).toBeGreaterThanOrEqual(0.85)
    expect(atLeast(60, n - 1, 7, 2)).toBeLessThan(0.85)
  })
})
