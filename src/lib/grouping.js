// Grouping a decklist into sections.
//
// A hundred-card list read as one column tells you nothing. Split by what the
// cards are and the shape of the deck is visible at a glance: nine creatures
// and thirty-one lands is a different deck from the reverse, and neither reads
// off an alphabetical list.
//
// The grouper is a function of (card) -> key, so adding a mode — or, later,
// categories a player writes themselves — means adding a function, not
// rewriting the deck list.

import { frontTypeLine } from './formats.js'
import { manaValueOf } from './analysis.js'
import { isLandCard } from './deck.js'
import { totalFor } from './prices.js'

/*
 * Type precedence. A card is usually several types at once, and the useful
 * answer is the one a player would file it under: an Artifact Creature is a
 * creature, an artifact land is a land. Order is the decision.
 */
const TYPE_ORDER = [
  { id: 'land', label: 'Lands', test: (card) => isLandCard(card) },
  { id: 'creature', label: 'Creatures', test: (line) => /\bCreature\b/.test(line) },
  { id: 'planeswalker', label: 'Planeswalkers', test: (line) => /\bPlaneswalker\b/.test(line) },
  { id: 'battle', label: 'Battles', test: (line) => /\bBattle\b/.test(line) },
  { id: 'instant', label: 'Instants', test: (line) => /\bInstant\b/.test(line) },
  { id: 'sorcery', label: 'Sorceries', test: (line) => /\bSorcery\b/.test(line) },
  { id: 'artifact', label: 'Artifacts', test: (line) => /\bArtifact\b/.test(line) },
  { id: 'enchantment', label: 'Enchantments', test: (line) => /\bEnchantment\b/.test(line) },
]

/*
 * Two different orders, and conflating them put Lands at the top of every deck.
 *
 * TYPE_ORDER above is PRECEDENCE: lands are tested first so an artifact land is
 * a land rather than an artifact. This is DISPLAY: lands come last, because
 * that is where a player looks for them and where every other view in this app
 * puts them.
 */
export const TYPE_LABELS = ['Creatures', 'Planeswalkers', 'Battles', 'Instants',
  'Sorceries', 'Artifacts', 'Enchantments', 'Lands', 'Other']

const DISPLAY_IDS = ['creature', 'planeswalker', 'battle', 'instant', 'sorcery',
  'artifact', 'enchantment', 'land', 'other']

export function typeGroupOf(card) {
  // Front face only: a "Sorcery // Land" modal card is a sorcery you may play
  // as a land, and filing it under Lands would overstate the mana base — the
  // same confusion that once dropped these cards out of the curve entirely.
  const line = frontTypeLine(card)
  for (const entry of TYPE_ORDER) {
    if (entry.id === 'land' ? entry.test(card) : entry.test(line)) return entry
  }
  return { id: 'other', label: 'Other' }
}

const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }

export function colorGroupOf(card) {
  const colors = card?.colors ?? card?.card_faces?.[0]?.colors ?? []
  if (isLandCard(card)) return { id: 'land', label: 'Lands' }
  if (!colors.length) return { id: 'colorless', label: 'Colourless' }
  if (colors.length > 1) return { id: 'multicolor', label: 'Multicolour' }
  return { id: colors[0], label: COLOR_NAMES[colors[0]] ?? colors[0] }
}

export function manaValueGroupOf(card) {
  if (isLandCard(card)) return { id: 'land', label: 'Lands' }
  const mv = manaValueOf(card)
  if (mv >= 7) return { id: 'mv7', label: '7+ mana' }
  return { id: `mv${mv}`, label: mv === 1 ? '1 mana' : `${mv} mana` }
}

export const GROUPINGS = [
  { id: 'type', label: 'Type', of: typeGroupOf, order: DISPLAY_IDS },
  {
    id: 'color',
    label: 'Colour',
    of: colorGroupOf,
    order: ['W', 'U', 'B', 'R', 'G', 'multicolor', 'colorless', 'land'],
  },
  {
    id: 'mana',
    label: 'Mana value',
    of: manaValueGroupOf,
    order: ['mv0', 'mv1', 'mv2', 'mv3', 'mv4', 'mv5', 'mv6', 'mv7', 'land'],
  },
]

export const getGrouping = (id) => GROUPINGS.find((g) => g.id === id) ?? GROUPINGS[0]

/**
 * Splits {card, quantity} entries into sections, each carrying its own count
 * and price so a section header can say what it is worth without the caller
 * re-deriving it.
 *
 * `pinned` entries — the commander — lead, because that is how a deck is read.
 * Empty sections are dropped rather than rendered as noise.
 */
export function groupDeck(resolved, { groupBy = 'type', marketId = 'usd', pinned = [] } = {}) {
  const grouping = getGrouping(groupBy)
  const buckets = new Map()

  const add = (key, label, entry) => {
    if (!buckets.has(key)) buckets.set(key, { id: key, label, entries: [] })
    buckets.get(key).entries.push(entry)
  }

  for (const entry of pinned) add('commander', 'Commander', entry)
  for (const entry of resolved ?? []) {
    const group = grouping.of(entry.card)
    add(group.id, group.label, entry)
  }

  const rank = (id) => {
    if (id === 'commander') return -1
    const index = grouping.order.indexOf(id)
    return index === -1 ? grouping.order.length : index
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      entries: [...bucket.entries].sort((a, b) => a.card.name.localeCompare(b.card.name)),
      count: bucket.entries.reduce((n, e) => n + (e.quantity ?? 1), 0),
      price: totalFor(bucket.entries, marketId),
    }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label))
}
