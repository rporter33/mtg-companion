// The deck coach.
//
// Turns the analysis the app already computes into plain advice a beginner can
// act on, and a Scryfall query that finds candidate cards.
//
// TARGETS COME FROM PUBLISHED BEGINNER GUIDES, not from invention: roughly 40%
// lands, most spells costing one to three, eight to ten ways to answer a
// threat, and a creature count that swings with how aggressive the deck is.
// Commander numbers differ because the format does — singleton, 100 cards, a
// much longer game, and mana rocks doing work lands would otherwise do.
//
// The land target is the one number NOT taken from a guide: it is computed by
// the calibrated recommender, which independently lands on the same 24 for a
// 60-card deck. Agreement between an published rule of thumb and a solved
// model is the strongest evidence either is right.
//
// Every check states what it counted, what it wanted, and why — and carries a
// search that finds cards to fix it, built from oracle text so no hand-written
// card list can rot.

import { getFormat, poolQuery } from './formats.js'
import { analyzeDeck, resolveEntries, manaValueOf } from './analysis.js'
import { recommendedSourceCount } from './probability.js'
import { isLandCard } from './deck.js'
import { IS_REMOVAL, IS_DRAW, IS_RAMP, IS_CREATURE, CLASSIFIERS } from './classifiers.js'
import { targetsFor } from './skeleton.js'

/** Counts cards whose rules text matches a pattern. */
function countMatching(resolved, test) {
  let total = 0
  for (const { card, quantity } of resolved) {
    if (test(card)) total += quantity
  }
  return total
}

export { IS_REMOVAL, IS_DRAW, IS_RAMP, IS_CREATURE, CLASSIFIERS }

/**
 * A check the coach can make.
 *
 * `severity` is 'error' when the deck will play badly, 'warn' when it is
 * outside the usual range but defensible, and 'ok' when there is nothing to do.
 */
function check({ id, label, have, want, severity, message, why, query, unit = 'cards', scored = true }) {
  // `scored: false` means "there is not enough here to judge yet". Showing a
  // number in that state reads as a verdict, which is exactly what it is not.
  return { id, label, have, want, severity, message, why, query, unit, scored }
}

/**
 * Colour-identity scope for suggestion searches, so results are playable. The
 * format's pool is the deck search's own (poolQuery), so in Standard the coach
 * finds the next set's previewed cards that Scryfall says will be legal.
 */
function scopeFor(deck, format, identity) {
  const parts = [poolQuery(format)]
  if (format.commander?.colorIdentity && identity?.length) {
    parts.push(`id<=${identity.join('').toLowerCase()}`)
  } else if (format.commander?.colorIdentity) {
    parts.push('id<=c')
  }
  return parts.join(' ')
}

export function coachDeck(deck, lookup) {
  const format = getFormat(deck.formatId)
  if (!format) return null

  const analysis = analyzeDeck(deck, lookup)
  const commander = format.group === 'commander'
  const target = format.deck.max ?? format.deck.min

  const entries = [...deck.main]
  for (const id of deck.commanders) entries.push({ cardId: id, quantity: 1 })
  const resolved = resolveEntries(entries, lookup)
  const size = analysis.size
  const scope = scopeFor(deck, format, analysis.colors.map((c) => c.color))

  const checks = []

  // --- size --------------------------------------------------------------
  const short = target - size
  checks.push(check({
    id: 'size',
    label: 'Deck size',
    have: size,
    want: target,
    unit: 'cards',
    severity: size === target ? 'ok' : short > 0 ? 'error' : 'error',
    message: size === target
      ? `Exactly ${target}. That is the number.`
      : short > 0
        ? `${short} card${short === 1 ? '' : 's'} short of ${target}.`
        : `${-short} card${-short === 1 ? '' : 's'} over ${target}.`,
    why: commander
      ? 'Commander decks are exactly 100 cards including the commander — not a minimum.'
      : 'Build exactly 60. Every extra card makes you less likely to draw the good ones.',
    query: short > 0 ? `${scope}` : null,
  }))

  // --- mana --------------------------------------------------------------
  //
  // Judged against the deck's FINISHED size, not its current one. A half-built
  // deck otherwise gets advice computed for a 43-card deck it will never be —
  // and is told it has too many lands while being 57 cards short.
  const lands = analysis.lands
  const nonLandCount = analysis.curve.nonLandCount

  // The curve average is meaningless while there are only a handful of spells —
  // one six-drop commander alone drags it to 4 and pushes the mana target up by
  // three sources. Below a threshold, use the neutral pivot so early advice is
  // stable instead of swinging with every card added.
  const CURVE_CONFIDENCE = 10
  const curveForMana = nonLandCount >= CURVE_CONFIDENCE
    ? analysis.curve.averageManaValue
    : 2.75

  const recommended = recommendedSourceCount({
    deckSize: target,
    averageManaValue: curveForMana,
  })
  const landGap = recommended - lands.totalSources
  checks.push(check({
    id: 'mana',
    label: 'Mana sources',
    have: lands.totalSources,
    want: recommended,
    unit: 'sources',
    severity: Math.abs(landGap) <= 2 ? 'ok' : landGap > 0 ? 'error' : 'warn',
    message: Math.abs(landGap) <= 2
      ? `${lands.totalSources} sources, about right for this curve.`
      : landGap > 0
        ? `${landGap} more source${landGap === 1 ? '' : 's'} needed. Expect slow starts as it is.`
        : `${-landGap} more than this curve needs. Not wrong, but you will flood sometimes.`,
    why: `Counting ${lands.landCount} lands${lands.nonLandSources ? ` and ${lands.nonLandSources} other things that make mana` : ''}, against a finished ${target}-card deck. The target is solved for having at least two sources in your opening seven, which is what real decks build toward.${nonLandCount < CURVE_CONFIDENCE ? ' Once you have more spells in, this will adjust to your actual curve.' : ''}`,
    query: landGap > 0 ? `${scope} (t:land or o:"add {")` : null,
  }))

  // --- curve -------------------------------------------------------------
  const cheap = countMatching(resolved, (card) => !isLandCard(card) && manaValueOf(card) <= 3)
  const nonLand = analysis.curve.nonLandCount
  const cheapShare = nonLand ? cheap / nonLand : 0
  checks.push(check({
    id: 'curve',
    label: 'Curve',
    have: cheap,
    want: Math.round(nonLand * 0.6),
    unit: 'cheap spells',
    scored: nonLand >= 8,
    severity: nonLand < 8 ? 'ok' : cheapShare >= 0.55 ? 'ok' : cheapShare >= 0.4 ? 'warn' : 'error',
    message: nonLand < 8
      ? 'Not enough spells yet to judge the curve.'
      : cheapShare >= 0.55
        ? `${Math.round(cheapShare * 100)}% of your spells cost three or less. Good.`
        : `Only ${Math.round(cheapShare * 100)}% of your spells cost three or less. You will spend the early turns doing nothing.`,
    why: 'Most of a deck should cost one to three mana, so you have something to do on the turns before your expensive cards come down.',
    query: cheapShare < 0.55 ? `${scope} cmc<=3 -t:land` : null,
  }))

  // --- interaction -------------------------------------------------------
  const targets = targetsFor(format)
  const removal = countMatching(resolved, IS_REMOVAL)
  const removalTarget = targets.removal
  checks.push(check({
    id: 'removal',
    label: 'Answers',
    have: removal,
    want: removalTarget,
    unit: 'cards',
    severity: removal >= removalTarget ? 'ok' : removal >= removalTarget / 2 ? 'warn' : 'error',
    message: removal >= removalTarget
      ? `${removal} ways to deal with something. Plenty.`
      : `${removal} way${removal === 1 ? '' : 's'} to deal with an opponent's card. Most decks want ${removalTarget}.`,
    why: 'A deck with no answers loses to the first threat it cannot block. This counts anything that destroys, exiles, counters or damages something.',
    query: removal < removalTarget
      ? `${scope} (o:"destroy target" or o:"exile target" or o:"counter target spell")`
      : null,
  }))

  // --- card draw ---------------------------------------------------------
  const draw = countMatching(resolved, IS_DRAW)
  const drawTarget = targets.draw
  checks.push(check({
    id: 'draw',
    label: 'Card draw',
    have: draw,
    want: drawTarget,
    unit: 'cards',
    severity: draw >= drawTarget ? 'ok' : draw >= drawTarget / 2 ? 'warn' : 'error',
    message: draw >= drawTarget
      ? `${draw} cards that refill your hand.`
      : `${draw} way${draw === 1 ? '' : 's'} to draw extra cards. Aim for about ${drawTarget}.`,
    why: commander
      ? 'Commander games are long, and one card per turn is not enough to keep up with three opponents.'
      : 'Running out of cards is how close games are lost.',
    query: draw < drawTarget ? `${scope} o:"draw" -o:"opponent draws"` : null,
  }))

  // --- ramp, Commander only ---------------------------------------------
  if (commander) {
    const ramp = countMatching(resolved, IS_RAMP)
    const rampTarget = targets.ramp
    checks.push(check({
      id: 'ramp',
      label: 'Ramp',
      have: ramp,
      want: rampTarget,
      unit: 'cards',
      severity: ramp >= rampTarget ? 'ok' : ramp >= rampTarget / 2 ? 'warn' : 'error',
      message: ramp >= rampTarget
        ? `${ramp} cards that accelerate your mana.`
        : `${ramp} ramp card${ramp === 1 ? '' : 's'}. Commander decks usually want around ${rampTarget}.`,
      why: 'Commander decks are expensive and start at 40 life, so the game rewards getting ahead on mana early.',
      query: ramp < rampTarget ? `${scope} (o:"add {" or o:"search your library for a basic land") -t:land` : null,
    }))
  }

  // --- creatures ---------------------------------------------------------
  const creatures = countMatching(resolved, IS_CREATURE)
  const creatureFloor = targets.creatureFloor
  checks.push(check({
    id: 'creatures',
    label: 'Creatures',
    have: creatures,
    want: creatureFloor,
    unit: 'creatures',
    severity: creatures >= creatureFloor ? 'ok' : 'warn',
    message: creatures >= creatureFloor
      ? `${creatures} creatures.`
      : `${creatures} creature${creatures === 1 ? '' : 's'}. Fewer than most decks, which is a real choice rather than a mistake — but it means something else has to win the game.`,
    why: 'Creatures are how most decks apply pressure and defend themselves. A deck with very few needs another plan.',
    query: creatures < creatureFloor ? `${scope} t:creature` : null,
  }))

  const errors = checks.filter((c) => c.severity === 'error')
  const warnings = checks.filter((c) => c.severity === 'warn')

  return {
    format,
    checks,
    done: errors.length === 0 && warnings.length === 0,
    headline: headlineFor({ checks, errors, warnings, size, target }),
    // An unjudged check is not a passed one, so it does not inflate progress.
    progress: checks.filter((c) => c.scored && c.severity === 'ok').length
      / checks.filter((c) => c.scored).length || 0,
  }
}

function headlineFor({ errors, warnings, size, target }) {
  if (size === 0) return 'Add a few cards and advice will appear here as you go.'
  if (!errors.length && !warnings.length) return 'This deck looks sound. Go and play it.'
  if (size < target / 2) return 'Early days — keep adding, and the numbers below will settle.'
  if (errors.length) {
    return `${errors.length} thing${errors.length === 1 ? '' : 's'} worth fixing before you play this.`
  }
  return `Close. ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to think about.`
}

export const __testing = { IS_REMOVAL, IS_DRAW, IS_RAMP, IS_CREATURE }
