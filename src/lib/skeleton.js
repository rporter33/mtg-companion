/**
 * What a sensible deck is made of, in one place.
 *
 * The coach's checks and the first-deck flow's role targets both describe the
 * same skeleton — so many lands, so much ramp, draw and removal, the rest
 * doing what the deck does. They used to be two lists that agreed because the
 * same person wrote both in the same week. Now there is one, and both read it.
 *
 * TARGETS COME FROM PUBLISHED BEGINNER GUIDES, not from invention: around 40%
 * lands, eight to ten answers, six to ten draw spells, and in Commander
 * around ten ramp cards because the format is expensive and long. The coach
 * refines the land number with its calibrated recommender; the flat number
 * here is the starting skeleton before a curve exists to refine against.
 */
import { CLASSIFIERS, IS_CREATURE } from './classifiers.js'
import { isLandCard } from './deck.js'

/** Per-format targets. `format` is a formats.js entry; commander is the branch that matters. */
export function targetsFor(format) {
  const commander = format?.group === 'commander'
  const size = format?.deck?.max ?? format?.deck?.min ?? 60
  const list = commander ? size - 1 : size // the commander sits outside the 99
  return {
    size,
    list,
    lands: commander ? 36 : 24,
    ramp: commander ? 10 : 0,
    draw: commander ? 10 : 6,
    removal: commander ? 10 : 8,
    creatureFloor: commander ? 20 : 12,
  }
}

const BLURBS = {
  lands: 'Thirty-six or so. Most are basics; a few duals and utility lands help.',
  ramp: 'Around ten. Mana rocks and dorks get your commander out early and keep you ahead.',
  draw: 'Around ten. The hand runs out by turn six without it.',
  removal: 'Around ten. Answers for the creature, artifact or enchantment that is beating you.',
  theme: 'The rest: cards that do what your commander wants. Popular cards in your colours are a fine start.',
}
const LABELS = { lands: 'Lands', ramp: 'Ramp', draw: 'Card draw', removal: 'Removal', theme: 'Does your thing' }

/** The roles with their targets for a format; theme is whatever is left, so they add up to the list. */
export function rolesFor(format) {
  const t = targetsFor(format)
  const fixed = { lands: t.lands, ramp: t.ramp, draw: t.draw, removal: t.removal }
  const theme = t.list - Object.values(fixed).reduce((n, v) => n + v, 0)
  return [...Object.entries(fixed), ['theme', theme]]
    .filter(([, target]) => target > 0)
    .map(([id, target]) => ({ id, label: LABELS[id], target, blurb: BLURBS[id] }))
}

/** Which role a card fills. One answer per card, checked in this order. */
export function roleOf(card) {
  if (!card) return 'theme'
  if (isLandCard(card)) return 'lands'
  if (CLASSIFIERS.ramp(card)) return 'ramp'
  if (CLASSIFIERS.draw(card)) return 'draw'
  if (CLASSIFIERS.removal(card)) return 'removal'
  return 'theme'
}

export const isCreature = IS_CREATURE

/** Cards in each role, with the target and the shortfall beside. */
export function roleCounts(deck, lookup, format) {
  const roles = rolesFor(format)
  const have = Object.fromEntries(roles.map((r) => [r.id, 0]))
  for (const entry of deck?.main ?? []) {
    const role = roleOf(lookup?.(entry.cardId))
    if (role in have) have[role] += entry.quantity
    else have.theme = (have.theme ?? 0) + entry.quantity
  }
  return roles.map((role) => ({ ...role, have: have[role.id], short: Math.max(0, role.target - have[role.id]) }))
}
