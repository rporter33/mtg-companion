import { COLORS, COLOR_NAMES, countPips, faceManaCost } from './mana.js'
import { isLandCard, isBasicLand, addCard } from './deck.js'
import { manaValueOf, analyzeDeck, resolveEntries } from './analysis.js'
import { openingHandOdds, landDropOdds } from './probability.js'

/**
 * Reading a hand, and trying one change to the deck it came from.
 *
 * Everything here is an observation about the seven cards on the table or
 * an odds calculation about the list, never a prediction about the game:
 * "no blue source for Counterspell" is a fact about this hand, "two lands
 * in the opening seven 84% of the time" is arithmetic about the deck. What
 * a change does is shown as the same arithmetic before and after, under
 * assumptions written next to the numbers.
 */

const BASIC = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }

/** Colours the lands and rocks in a hand can make. Only lands count for the first plays. */
function colorsMadeBy(cards) {
  const made = new Set()
  for (const card of cards) for (const c of card?.produced_mana ?? []) if (COLORS.includes(c)) made.add(c)
  return made
}

/**
 * What this hand says: lands and their colours, which spells can be cast
 * from these lands alone by turn three (one land a turn, colours as the
 * lands make them), which spells have no source of a colour they need,
 * and whether the hand does anything early at all.
 */
export function diagnoseHand(hand, { isLand = isLandCard } = {}) {
  const lands = hand.filter((card) => isLand(card))
  const spells = hand.filter((card) => !isLand(card))
  const colors = colorsMadeBy(lands)

  const early = []
  const uncastable = new Map() // by name: three copies of a spell are one observation
  for (const card of spells) {
    const pips = countPips(faceManaCost(card))
    const missing = COLORS.filter((c) => pips[c] > 0 && !colors.has(c))
    if (missing.length) {
      const seen = uncastable.get(card.name)
      if (seen) seen.count += 1
      else uncastable.set(card.name, { card, missing, count: 1 })
    }
    const mv = Math.max(0, Math.round(manaValueOf(card)))
    if (!missing.length && mv <= 3 && mv <= lands.length) early.push(card)
  }
  const expensive = spells.filter((card) => manaValueOf(card) >= 5)
  const average = spells.length ? spells.reduce((n, c) => n + manaValueOf(c), 0) / spells.length : 0

  const notes = []
  if (lands.length === 0) notes.push('No lands. Nothing here can be cast.')
  else if (lands.length === hand.length) notes.push('All lands. Nothing here to cast.')
  else {
    const names = [...colors].map((c) => COLOR_NAMES[c].toLowerCase())
    notes.push(`${lands.length} land${lands.length === 1 ? '' : 's'}${names.length ? `, making ${names.join(' and ')}` : ', making no colour'}.`)
  }
  for (const { card, missing, count } of uncastable.values()) {
    notes.push(`${count > 1 ? `${count}\u00d7 ` : ''}${card.name} needs ${missing.map((c) => COLOR_NAMES[c].toLowerCase()).join(' and ')}, and nothing here makes it.`)
  }
  if (lands.length > 0 && lands.length < hand.length) {
    notes.push(early.length
      ? `${early.length} play${early.length === 1 ? '' : 's'} by turn three from these lands: ${early.map((c) => c.name).join(', ')}.`
      : 'Nothing to cast by turn three from these lands.')
    if (expensive.length === spells.length) notes.push('Every spell costs five or more.')
    else if (expensive.length >= 2) notes.push(`${expensive.length} spells cost five or more.`)
  }

  return {
    size: hand.length,
    lands: lands.length,
    spells: spells.length,
    colors: [...colors],
    early: early.map((c) => c.name),
    uncastable: [...uncastable.values()].map(({ card, missing, count }) => ({ name: card.name, missing, count })),
    expensive: expensive.length,
    averageManaValue: average,
    keepable: lands.length > 0 && lands.length < hand.length,
    notes,
  }
}

/** The odds a change is judged by: lands only, from the library without the commander. */
export function oddsFor(deck, lookup, { targetTurn = 4 } = {}) {
  const library = resolveEntries(deck.main, lookup)
  const size = library.reduce((n, e) => n + e.quantity, 0)
  const lands = library.reduce((n, e) => n + (isLandCard(e.card) ? e.quantity : 0), 0)
  if (!size) return { size, lands, twoLands: 0, onCurve: 0, noLands: 0 }
  return {
    size,
    lands,
    twoLands: openingHandOdds(size, lands, 2),
    onCurve: landDropOdds(size, lands, targetTurn, true),
    noLands: openingHandOdds(size, size - lands, 7, 7),
    targetTurn,
  }
}

/**
 * One change worth trying, from the deck rather than the hand: the hand is
 * seven random cards, the deck is what keeps dealing them. Short of the
 * sources this curve wants, the proposal is a basic in the colour most
 * short of sources for the costliest spell; a colour short of sources with
 * lands to spare is a basic of that colour for a basic of the best-served
 * one. Nothing else is proposed, and a deck that wants nothing gets null.
 */
export function proposeChange(deck, lookup) {
  const analysis = analyzeDeck(deck, lookup)
  const library = resolveEntries(deck.main, lookup)
  if (!library.length) return null
  const { lands, colors } = analysis
  const targetTurn = lands.targetTurn
  const before = oddsFor(deck, lookup, { targetTurn })

  const short = [...colors].filter((row) => row.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall)[0] ?? null
  const spells = library.filter((e) => !isLandCard(e.card)).sort((a, b) => manaValueOf(b.card) - manaValueOf(a.card))
  const basics = library.filter((e) => isBasicLand(e.card))

  let change = null
  if (lands.totalSources < lands.recommended && spells.length) {
    const color = short?.color ?? [...colors].sort((a, b) => b.pips - a.pips)[0]?.color ?? 'G'
    const cut = spells[0]
    change = {
      kind: 'more-lands',
      remove: cut.card,
      addBasic: BASIC[color],
      reason: `${lands.totalSources} sources for a curve that usually wants ${lands.recommended}. A ${BASIC[color]} for ${cut.card.name}, the costliest spell, gives the mana something to do earlier.`,
    }
  } else if (short && basics.length) {
    const served = [...colors].filter((r) => r.color !== short.color).sort((a, b) => (b.sources - b.needed) - (a.sources - a.needed))[0]
    const spare = served ? basics.find((e) => (e.card.produced_mana ?? []).includes(served.color) && !(e.card.produced_mana ?? []).includes(short.color)) : null
    if (spare) {
      change = {
        kind: 'swap-basic',
        remove: spare.card,
        addBasic: BASIC[short.color],
        reason: `${COLOR_NAMES[short.color]} is ${short.shortfall} source${short.shortfall === 1 ? '' : 's'} short for ${short.want > 1 ? `${short.want} pips` : 'a pip'} by turn ${short.turn}, and ${COLOR_NAMES[served.color].toLowerCase()} has more than it needs. A ${BASIC[short.color]} for a ${spare.card.name}.`,
      }
    }
  }
  if (!change) return null

  const after = oddsFor(applyChange(deck, change, lookup), lookup, { targetTurn })
  return {
    ...change,
    before,
    after,
    assumptions: `One card for one; only lands count toward these odds; drawn from the ${before.size} cards the commander is not among. Prices, colours of other lands and what the swapped spell did are not weighed.`,
  }
}

/**
 * The change applied. The basic added is one already in the deck when
 * there is one, so nothing has to be fetched; otherwise `basicCard` is the
 * card the screen looked up. Pure, and never past the list's size.
 */
export function applyChange(deck, change, lookup, basicCard = null) {
  const existing = deck.main.find((e) => {
    const card = lookup(e.cardId)
    return card && isBasicLand(card) && card.name === change.addBasic
  })
  const basic = existing ? lookup(existing.cardId) : basicCard
  if (!basic) return deck
  return addCard(addCard(deck, change.remove.id, -1, 'main'), basic.id, 1, 'main')
}

/** A one-line name for the change, for a version label. */
export function describeChange(change) {
  return `+1 ${change.addBasic}, −1 ${change.remove.name}`
}
