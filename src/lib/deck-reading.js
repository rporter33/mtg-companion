import { STRATEGIES } from '../data/strategies.js'
import { oracleTextOf, typeLineOf } from './formats.js'

/**
 * What the lobby's shelf reads of a deck beyond what the deck says of itself: the
 * plan it reads as, and the lowest Commander bracket its Game Changers allow.
 *
 * Neither is the deck's builder's word, or anybody's ranking, and every screen
 * that shows one says it is this app's reading. Both are worked out from the card
 * records the app already holds for the deck — Scryfall's — and from nothing else.
 *
 * THE PLAN. The vocabulary is this app's own plans for a first deck
 * (data/strategies.js): Tokens, +1/+1 counters, Flyers and the rest, written as
 * this app's suggestions and not as official archetypes. Each plan comes with the
 * searches the first-deck flow asks Scryfall for, and a plan is read here by those
 * same searches, as far as a card record can answer them on this device: rules
 * text (`o:`), type line (`t:`) and power (`pow>=`). An oracle tag (`otag:`) is
 * Scryfall's community's and not on a card record, so a search with one is left
 * out rather than guessed at; every plan has a search without one. A card fits a
 * plan when it answers any of the plan's searches that can be run, lands left out
 * as the first-deck flow leaves them out (`-t:land`, lib/first-deck.js). A deck
 * reads as the plan most of its cards fit, every copy counted — as several where
 * they tie, and as none where no card fits any.
 *
 * THE BRACKET. Read from `game_changer` on each card, which is Wizards' Game
 * Changers list as Scryfall carries it, against Wizards' Commander Brackets as its
 * Commander page gives them (read 2026-09-26, the bracket system still a beta):
 * Brackets 1 and 2 hold no Game Changers, Bracket 3 up to three, Brackets 4 and 5
 * any number. So a deck with none can be in any bracket, one with one to three in
 * Bracket 3 or higher, and one with four or more in 4 or higher. The rest of what
 * a bracket weighs — two-card combos, extra turns, mass land denial, and the
 * intent behind a deck, which Wizards calls the most important part — is not read,
 * which is why the reading is a floor and is said as one. Commander's alone: the
 * brackets are Wizards' for the Commander format.
 *
 * A deck with a card whose record has not arrived is not read at all, rather than
 * read from part of itself: a missing card could be the one that decides either.
 * A deck of no cards is read as what it is: no plan, and no Game Changers.
 */

/** Every plan in the vocabulary once, in the order data/strategies.js first names it. */
export const PLANS = (() => {
  const seen = new Map()
  for (const list of Object.values(STRATEGIES)) for (const plan of list) if (!seen.has(plan.id)) seen.set(plan.id, plan)
  return [...seen.values()]
})()

const planById = new Map(PLANS.map((p) => [p.id, p]))
export const planName = (id) => planById.get(id)?.name ?? null

/**
 * One search of a plan as a test of a card, or null where it holds a term a card
 * record cannot answer. Terms are ANDed, as Scryfall ANDs them; a quoted phrase is
 * one term. Scryfall reads each term of a card of several faces from any of them.
 */
export function searchOf(query) {
  const terms = String(query ?? '').match(/[^\s"]+(?:"[^"]*")?|"[^"]*"/g) ?? []
  const tests = []
  for (const term of terms) {
    const m = /^([a-z]+)(:|>=)("?)(.*?)\3$/i.exec(term)
    if (!m) return null
    const [, key, op, , value] = m
    const want = value.toLowerCase()
    if (!want) return null
    if (key === 'o' && op === ':') tests.push((card) => textsOf(card).some((t) => t.includes(want)))
    else if (key === 't' && op === ':') tests.push((card) => typesOf(card).some((t) => t.includes(want)))
    else if (key === 'pow' && op === '>=' && Number.isFinite(Number(want))) {
      const least = Number(want)
      tests.push((card) => powersOf(card).some((p) => p >= least))
    } else return null
  }
  return tests.length ? (card) => tests.every((test) => test(card)) : null
}

const faces = (card) => (Array.isArray(card?.card_faces) ? card.card_faces : [])
/*
 * Rules text as Scryfall's `o:` reads it, which leaves reminder text out — the
 * words in parentheses — and only `fo:` reads it in. Read in, a reach creature's
 * reminder read as Flyers, an investigate creature's Clue as Tokens and Draw
 * engine, and an afterlife creature's Spirit as both Tokens and Flyers, none of
 * which the plans' own searches would have found.
 */
const withoutReminders = (text) => String(text).replace(/\([^)]*\)/g, '')
const textsOf = (card) => [oracleTextOf(card), ...faces(card).map((f) => f?.oracle_text ?? '')].map((t) => withoutReminders(t).toLowerCase())
const typesOf = (card) => [typeLineOf(card), ...faces(card).map((f) => f?.type_line ?? '')].map((t) => String(t).toLowerCase())
const powersOf = (card) => [card?.power, ...faces(card).map((f) => f?.power)].map((p) => parseFloat(p)).filter(Number.isFinite)

/** Each plan's searches that can be run here, once. */
const SEARCHES = new Map(PLANS.map((plan) => [plan.id, (plan.queries ?? []).map(searchOf).filter(Boolean)]))
/** The plans' searches this app runs, as text, for a test and for the words that say how a plan is read. */
export const readableSearches = (id) => (planById.get(id)?.queries ?? []).filter((q) => searchOf(q))

const isLand = (card) => typesOf(card).some((t) => /\bland\b/.test(t))

// One answer per card record: a shelf reads the same Sol Ring in every deck that
// holds it, and the card cache keeps a record the same object while it is held.
const FITS = new WeakMap()

/** The ids of the plans a card fits, in the vocabulary's order. */
export function plansFitting(card) {
  if (!card || typeof card !== 'object') return []
  let fits = FITS.get(card)
  if (!fits) {
    fits = isLand(card) ? [] : PLANS.filter((plan) => SEARCHES.get(plan.id).some((test) => test(card))).map((p) => p.id)
    FITS.set(card, fits)
  }
  return fits
}

/**
 * A deck's cards, every copy: its main deck, its commanders and its signature
 * spell, which are the cards it plays. The sideboard is left out; it is not the deck.
 */
export function playedEntries(deck) {
  return [
    ...(Array.isArray(deck?.main) ? deck.main : []),
    ...(Array.isArray(deck?.commanders) ? deck.commanders : []).map((cardId) => ({ cardId, quantity: 1 })),
    ...(typeof deck?.signatureSpell === 'string' && deck.signatureSpell ? [{ cardId: deck.signatureSpell, quantity: 1 }] : []),
  ].filter((e) => e && typeof e.cardId === 'string' && e.cardId && Number.isInteger(e.quantity) && e.quantity > 0)
}

const cardFrom = (lookup, id) => (typeof lookup === 'function' ? lookup(id) : lookup instanceof Map ? lookup.get(id) : lookup?.[id])

/**
 * What a deck reads as: `{ top, counts, cards, most }`, where `top` is the ids of
 * the plans the most copies fit (empty where none fits any, and for a deck of no
 * cards), `counts` how many copies fit each plan any do, `cards` how many were
 * read and `most` how many fit the plans at the top. Null where a card of the deck
 * has no record here.
 */
export function readPlan(deck, lookup) {
  const entries = playedEntries(deck)
  const counts = {}
  let cards = 0
  for (const { cardId, quantity } of entries) {
    const card = cardFrom(lookup, cardId)
    if (!card) return null
    cards += quantity
    for (const id of plansFitting(card)) counts[id] = (counts[id] ?? 0) + quantity
  }
  const most = Math.max(0, ...Object.values(counts))
  const top = most ? PLANS.filter((p) => counts[p.id] === most).map((p) => p.id) : []
  return { top, counts, cards, most }
}

/** Wizards' names for its brackets, 1 to 5. */
export const BRACKET_NAMES = { 1: 'Exhibition', 2: 'Core', 3: 'Upgraded', 4: 'Optimized', 5: 'cEDH' }
/** The floors the Game Changers set, lowest first. */
export const FLOORS = [1, 3, 4]

/** The lowest bracket a number of Game Changers allows. */
export const floorFor = (changers) => (changers >= 4 ? 4 : changers >= 1 ? 3 : 1)

/**
 * The lowest Commander bracket a deck's Game Changers allow: `{ floor, changers }`,
 * `changers` being the Game Changers' names, each once. Null where a card has no
 * record here, or a record that does not say either way — one kept from before
 * Scryfall carried the flag, which is as good as not arrived, and which the card
 * refresh replaces within its week.
 */
export function readBracket(deck, lookup) {
  const entries = playedEntries(deck)
  const changers = new Set()
  for (const { cardId } of entries) {
    const card = cardFrom(lookup, cardId)
    if (!card || typeof card.game_changer !== 'boolean') return null
    if (card.game_changer) changers.add(card.name)
  }
  const names = [...changers].sort()
  return { floor: floorFor(names.length), changers: names }
}

/** "B3+", as the shelf's badge says it. */
export const floorBadge = (floor) => `B${floor}+`

/** A floor in words: "Bracket 3 or higher". */
export const floorWords = (floor) => `Bracket ${floor} or higher`

/** How many Game Changers set each floor, as a filter chip says it beside the badge. */
const FLOOR_CHANGERS = { 1: 'no Game Changers', 3: '1–3 Game Changers', 4: '4 or more Game Changers' }

/**
 * A Bracket filter chip's words: the badge, and the Game Changers that set it —
 * "B3+ · 1–3 Game Changers". A chip keeps the decks at that floor and no other,
 * so it is named by what it keeps: "B3 or higher" was true of a B4+ deck too,
 * which it did not keep, and of every deck for B1.
 */
export const floorChip = (floor) => `${floorBadge(floor)} · ${FLOOR_CHANGERS[floor] ?? floorWords(floor)}`

/** What the badge stands for, in a sentence a screen reader says with the tile. */
export function bracketSentence({ floor, changers }) {
  const n = changers.length
  if (!n) return `${floorWords(floor)}, this app's reading: no Game Changers.`
  return `${floorWords(floor)}, this app's reading: ${n === 1 ? 'one Game Changer' : `${n} Game Changers`}, ${listOf(changers)}.`
}

/** What the plan tag stands for, in a sentence a screen reader says with the tile. */
export function planSentence({ top, most, cards }) {
  if (!cards) return 'No plan read: it has no cards yet.'
  if (!top.length) return `No plan read: none of its ${cards} cards fits one of this app's plans.`
  const names = listOf(top.map(planName))
  return `Reads as ${names}, this app's reading: ${most} of its ${cards} cards fit${top.length > 1 ? ' each' : ''}.`
}

const listOf = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** What a tile says of a deck that was not read, to a screen reader and a pointer. */
export const UNREAD_SENTENCE = "Not read: not all its cards have arrived, so this app has not read it."

/** The one line under a filter's chips, with how it was read behind a disclosure. */
export const READING_LINE = "This app's reading of the cards."

/** How the plans are read, said beside the filter that offers them once asked. */
export const PLAN_LINE = "The plan most of a deck's cards fit, from this app's own plans for a first deck, each read by its own searches of rules text, type and power, as Scryfall reads them, reminder text left out. Lands are left out, and so are the plans' Scryfall tag searches, which a card here cannot answer."

/** How the bracket is read, said beside the filter that offers it once asked. */
export const BRACKET_LINE = "The lowest bracket a deck's Game Changers allow, by Wizards' Commander Brackets — none in Brackets 1 and 2, up to three in Bracket 3, any number in 4 and 5 — with each card's Game Changer mark taken from Scryfall. Combos, extra turns, mass land denial and what the deck is built to do are not read, so a deck may belong higher."

/**
 * The one line above the shelf, wherever a reading is shown, naming only what
 * is read there: the bracket and its filter on the Commander tab, where it is.
 */
export const shelfLine = ({ brackets = false } = {}) => (brackets
  ? "Each deck's plan and bracket are this app's reading of its cards, not its builder's word; the Archetype and Bracket filters say how."
  : "Each deck's plan is this app's reading of its cards, not its builder's word; the Archetype filter says how.")
