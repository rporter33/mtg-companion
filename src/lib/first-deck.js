/**
 * The first-deck flow's arithmetic: where the dial is, what the play-style
 * answers suggest, what to ask Scryfall for, and how far a deck is from a
 * sensible skeleton. All pure; the screen is a thin layer over this.
 */
import { WHEEL, PAIRS, STYLE_AXES } from '../data/colors.js'
import { getFormat } from './formats.js'
import { rolesFor, roleCounts as countRoles } from './skeleton.js'

/**
 * The dial runs W→U→B→R→G→W, one colour every 100, so every allied pair
 * sits between its two colours. 500 is white again, which is what lets
 * green-white appear. Within SNAP of a colour the choice is that colour
 * alone; otherwise it is the pair the thumb sits between.
 */
export const DIAL_MAX = 500
const SNAP = 25

export function dialToColors(value) {
  const v = Math.max(0, Math.min(DIAL_MAX, Number(value) || 0))
  const i = Math.floor(v / 100)
  const a = WHEEL[i % 5]
  const b = WHEEL[(i + 1) % 5]
  const within = v - i * 100
  if (within <= SNAP) return a
  if (within >= 100 - SNAP) return b
  return pairKey(a, b)
}

/** A pair in wheel order, so "UW" and "WU" are the same pair: "WU". */
export function pairKey(a, b) {
  if (!b) return a
  if (a === b) return a
  // The game's own spellings: "GW" and "RW" rather than "WG" and "WR".
  return PAIRS[`${a}${b}`] ? `${a}${b}` : `${b}${a}`
}

/** Where the dial should rest to show a choice; enemy pairs have no spot and return null. */
export function colorsToDial(colors) {
  if (!colors) return 0
  if (colors.length === 1) return WHEEL.indexOf(colors) * 100
  const [a, b] = colors.split('')
  const ia = WHEEL.indexOf(a)
  const ib = WHEEL.indexOf(b)
  if ((ia + 1) % 5 === ib) return ia * 100 + 50
  if ((ib + 1) % 5 === ia) return ib * 100 + 50
  return null
}

export function describeColors(colors) {
  if (!colors) return null
  if (colors.length === 1) return { kind: 'mono', id: colors }
  return { kind: 'pair', id: colors, pair: PAIRS[colors] ?? null }
}

/**
 * Adds up what the answers lean toward and picks the best pair — or a single
 * colour when the runner-up is far behind, since that is what the answers
 * said. Unanswered questions count for nothing.
 */
export function suggestColors(answers = {}) {
  const score = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  let answered = 0
  for (const axis of STYLE_AXES) {
    const option = axis.options.find((o) => o.id === answers[axis.id])
    if (!option) continue
    answered++
    for (const [c, n] of Object.entries(option.leans)) score[c] += n
  }
  if (!answered) return null
  const ranked = WHEEL.map((c) => [c, score[c]]).sort((a, b) => b[1] - a[1] || WHEEL.indexOf(a[0]) - WHEEL.indexOf(b[0]))
  const [[first, s1], [second, s2]] = ranked
  if (s2 === 0 || s1 >= s2 * 2.5) return first
  return pairKey(first, second)
}

// --- what to ask Scryfall -------------------------------------------------

const idOf = (colors) => colors.toLowerCase()

/** Commanders of exactly these colours, most played first. */
export function commanderQuery(colors) {
  return `is:commander legal:commander game:paper id=${idOf(colors)}`
}

/** The Commander skeleton, from the one place both the coach and this flow read it. */
export const ROLES = rolesFor(getFormat('commander'))

/**
 * Queries for a role, in the order to try them. Scryfall's oracle tags are
 * community-maintained and a slug can change, so each role lists a fallback;
 * the screen uses the first query that returns anything.
 */
export function stapleQueries(colors, roleId, { capUsd = 4, strategy = null } = {}) {
  const base = `legal:commander game:paper id<=${idOf(colors)} -is:commander usd<=${capUsd}`
  switch (roleId) {
    case 'lands': return [`${base} t:land -t:basic`]
    case 'ramp': return [`${base} otag:ramp`, `${base} otag:mana-ramp`, `${base} (t:artifact o:"add {") -t:land`]
    case 'draw': return [`${base} otag:card-draw`, `${base} otag:draw`, `${base} o:"draw a card" -t:land`]
    case 'removal': return [`${base} otag:removal`, `${base} otag:spot-removal`, `${base} (o:destroy or o:exile) -t:land`]
    // "Does your thing": with a plan chosen, its own searches come first and
    // the broad one stays as the last resort, so a renamed tag never leaves
    // the role empty. The eligibility filters are in the base of every one.
    default: return [
      ...(strategy?.queries ?? []).map((q) => `${base} (${q}) -t:land`),
      `${base} -t:land`,
    ]
  }
}

/**
 * Why a card is on the list, from the evidence that put it there and
 * nothing else: the role it was searched under, the plan it matched if one
 * was chosen, that the list is ordered by how played the card is, and what
 * you already own. No claim of synergy with the commander is made, because
 * none was checked.
 */
export function whyFor({ role, strategy = null, matchedPlan = false, owned = 0, quantity = 1 } = {}) {
  const parts = []
  if (role) parts.push(role)
  if (strategy && matchedPlan) parts.push(`fits ${strategy.name.toLowerCase()}`)
  else parts.push('popular in your colours')
  if (owned > 0) parts.push(owned >= quantity ? 'you own it' : `you own ${owned}`)
  return parts.join(' · ')
}

/** Cards in each role, by the coach's own classifiers, with the target beside. */
export function roleCounts(deck, lookup) {
  return countRoles(deck, lookup, getFormat('commander'))
}

/** How many basics of each colour fill the land shortfall: evenly, by colour identity. */
export function basicSplit(colors, count) {
  const names = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
  const cs = (colors || '').split('').filter((c) => names[c])
  if (!cs.length || count <= 0) return []
  const each = Math.floor(count / cs.length)
  let rest = count - each * cs.length
  return cs.map((c) => ({ color: c, name: names[c], quantity: each + (rest-- > 0 ? 1 : 0) })).filter((b) => b.quantity > 0)
}

/**
 * What "fill the rest" would add: for each role, the top candidates not
 * already in the deck up to the target; the land shortfall is met with a
 * few nonbasics and then basics. Nothing is added twice, singleton rules
 * hold, and the commander is never a candidate. Pure — the screen applies it.
 *
 * The list never grows past `max`: a role already over its target does not
 * shrink the others' shortfalls, so without a cap a deck with thirty
 * creatures could be filled to a hundred and four. Lands give way last,
 * because a list short of lands is the one that never gets going.
 */
export function fillPlan(deck, lookup, candidates, { nonbasicLands = 6, max = null } = {}) {
  const inDeck = new Set([...(deck.main ?? []).map((e) => e.cardId), ...(deck.commanders ?? [])])
  const chosenNames = new Set((deck.main ?? []).map((e) => lookup?.(e.cardId)?.name).filter(Boolean))
  const size = (deck.main ?? []).reduce((n, e) => n + (e.quantity ?? 1), 0)
  let room = max === null ? Infinity : Math.max(0, max - size)
  const adds = []
  const take = (list, n) => {
    const out = []
    for (const card of list ?? []) {
      if (out.length >= n || room <= 0) break
      if (inDeck.has(card.id) || chosenNames.has(card.name)) continue
      inDeck.add(card.id); chosenNames.add(card.name)
      out.push(card)
      room -= 1
    }
    return out
  }
  const counts = roleCounts(deck, lookup)
  const lands = counts.find((r) => r.id === 'lands')
  // Lands are reserved before the spells are dealt out, so the cap cannot
  // eat them: whatever room remains after the land shortfall goes to spells.
  const landRoom = Math.min(lands.short, room)
  room -= landRoom
  for (const role of counts) {
    if (role.id === 'lands' || role.short === 0) continue
    for (const card of take(candidates[role.id], role.short)) adds.push({ card, role: role.id, quantity: 1 })
  }
  room += landRoom
  if (landRoom > 0) {
    const nonbasic = take(candidates.lands, Math.min(nonbasicLands, landRoom))
    for (const card of nonbasic) adds.push({ card, role: 'lands', quantity: 1 })
    const basics = basicSplit(deck.colors ?? candidates.colors, Math.min(landRoom - nonbasic.length, room))
    for (const b of basics) adds.push({ basic: b.name, role: 'lands', quantity: b.quantity })
  }
  return adds
}

/**
 * A commander's colour identity as the key the flow uses: a single letter,
 * a pair in the game's spelling, or 'C' for a colourless commander. Three
 * or more colours are outside what the flow offers and come back as null.
 */
export function identityKeyOf(card) {
  const identity = ['W', 'U', 'B', 'R', 'G'].filter((c) => (card?.color_identity ?? []).includes(c))
  if (!card) return null
  if (identity.length === 0) return 'C'
  if (identity.length === 1) return identity[0]
  if (identity.length === 2) return pairKey(identity[0], identity[1])
  return null
}

/** Whether a chosen colour key fits inside a commander's identity key. */
export function fitsIdentity(colors, identityKey) {
  if (!identityKey || identityKey === 'C') return colors === identityKey
  return (colors ?? '').split('').every((c) => identityKey.includes(c))
}
