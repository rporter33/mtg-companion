// Hypergeometric probability — drawing without replacement, which is what a
// deck of cards actually is. Used for opening-hand odds, land-drop odds, and
// for deriving colour-source recommendations rather than quoting a folk rule.

const logFactorialCache = [0, 0]

function logFactorial(n) {
  if (n < 0) return NaN
  if (logFactorialCache[n] !== undefined) return logFactorialCache[n]
  let value = logFactorialCache[logFactorialCache.length - 1]
  for (let i = logFactorialCache.length; i <= n; i++) {
    value += Math.log(i)
    logFactorialCache[i] = value
  }
  return logFactorialCache[n]
}

/** log of the binomial coefficient C(n, k). Work in logs so big decks cannot overflow. */
function logChoose(n, k) {
  if (k < 0 || k > n || n < 0) return -Infinity
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

/**
 * P(exactly k successes) when drawing `draws` cards from a deck of `population`
 * containing `successes` relevant cards.
 */
export function hypergeometric(population, successes, draws, k) {
  if (draws > population || successes > population) return 0
  if (k > successes || k > draws) return 0
  if (k < 0 || draws - k > population - successes) return 0
  const logP =
    logChoose(successes, k) +
    logChoose(population - successes, draws - k) -
    logChoose(population, draws)
  return Math.exp(logP)
}

/** P(at least k successes). */
export function atLeast(population, successes, draws, k) {
  if (k <= 0) return 1
  const max = Math.min(successes, draws)
  if (k > max) return 0
  let total = 0
  for (let i = k; i <= max; i++) total += hypergeometric(population, successes, draws, i)
  return Math.min(1, total)
}

/** P(at most k successes). */
export function atMost(population, successes, draws, k) {
  if (k < 0) return 0
  let total = 0
  for (let i = 0; i <= Math.min(k, successes, draws); i++) {
    total += hypergeometric(population, successes, draws, i)
  }
  return Math.min(1, total)
}

/**
 * How many cards you have seen by the start of a given turn.
 * On the play you do not draw on turn one; on the draw you do.
 */
export function cardsSeenByTurn(turn, onPlay = true, handSize = 7) {
  if (turn < 1) return handSize
  return handSize + (onPlay ? turn - 1 : turn)
}

/** P(having at least `want` copies in your opening hand). */
export function openingHandOdds(deckSize, copies, want = 1, handSize = 7) {
  return atLeast(deckSize, copies, handSize, want)
}

/** P(having made every land drop through `turn`). */
export function landDropOdds(deckSize, lands, turn, onPlay = true) {
  const seen = cardsSeenByTurn(turn, onPlay)
  return atLeast(deckSize, lands, seen, turn)
}

/**
 * The smallest number of sources that gets you to `threshold` probability of
 * holding at least `want` of them by `turn`.
 *
 * This is how the app derives colour-source advice: rather than reproducing a
 * published table, it solves the same question the table answers, against the
 * deck's actual size. The answers land close to the community tables, and when
 * they differ the deck size is usually why.
 */
export function minimumSourcesFor({ deckSize, turn, want = 1, threshold = 0.9, onPlay = true }) {
  const seen = cardsSeenByTurn(turn, onPlay)
  for (let sources = want; sources <= deckSize; sources++) {
    if (atLeast(deckSize, sources, seen, want) >= threshold) return sources
  }
  return deckSize
}

/**
 * Recommended number of mana sources for a deck.
 *
 * CALIBRATION NOTE — the obvious objective ("never miss a land drop") is wrong,
 * and measurably so. A standard 24-land 60-card deck makes its turn-three land
 * drop only 78.9% of the time, and a 37-land Commander deck makes its turn-four
 * drop 54.5% of the time. Nobody builds to that target, so a recommender aimed
 * at it demands absurd land counts.
 *
 * The objective that does match how decks are actually built is simpler:
 * have at least two mana sources in your opening seven. Solving that at an 85%
 * threshold reproduces the accepted ratios closely —
 *
 *     60-card  -> 24 sources  (standard midrange land count)
 *     40-card  -> 16 sources  (limited convention is 17)
 *    100-card  -> 40 sources  (Commander runs ~37 lands plus mana rocks)
 *
 * The curve adjustment then moves that baseline: cheap decks flood less
 * happily and can afford fewer, expensive decks need more.
 */
export const SOURCE_THRESHOLD = 0.85
const CURVE_PIVOT = 2.75

export function baseSourceCount({ deckSize, threshold = SOURCE_THRESHOLD, handSize = 7 }) {
  for (let sources = 2; sources <= deckSize; sources++) {
    if (atLeast(deckSize, sources, handSize, 2) >= threshold) return sources
  }
  return deckSize
}

export function recommendedSourceCount({ deckSize, averageManaValue = CURVE_PIVOT, threshold = SOURCE_THRESHOLD }) {
  const base = baseSourceCount({ deckSize, threshold })
  const adjustment = clamp(Math.round(2 * (averageManaValue - CURVE_PIVOT)), -4, 4)
  return Math.max(2, base + adjustment)
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

export function percent(p, digits = 1) {
  return `${(p * 100).toFixed(digits)}%`
}
