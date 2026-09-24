// Deck model and format-aware validation.
//
// A deck stores card *ids* plus quantities; the card objects themselves live in
// the card cache. Validation therefore takes a lookup map so it stays a pure
// function — which is what makes it straightforward to test.

import {
  getFormat, legalityStatus, canBeCommander, effectiveCopyLimit,
  typeLineOf, isBasicLand, isTrueLand, isModalLand, frontTypeLine, oracleIdOf,
} from './formats.js'
import { notOutUntil, releaseLabel } from './release.js'
import { today } from './season.js'

/**
 * A fresh deck id. Bookkeeping, not content: storage keys a deck by it, and a
 * deck arriving from a file without one has to be given one or it cannot be
 * written at all (see importAll in storage.js).
 */
export function newDeckId() {
  return `deck_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export function createDeck({ name = 'Untitled deck', formatId = 'commander' } = {}) {
  const now = new Date().toISOString()
  return {
    id: newDeckId(),
    name,
    formatId,
    commanders: [],
    signatureSpell: null,
    main: [],
    sideboard: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * A deck read back from storage, whatever build wrote it.
 *
 * A deck in somebody's phone was written by an older build — or by a newer
 * one, if a stale service worker is serving this bundle — and has whatever
 * shape it had then. So what is missing is filled in, what cannot be made
 * sense of is dropped, and nothing here throws: `upgrade` in
 * `lib/board/model.js` is the same job for a saved table. Every read in
 * storage.js goes through this.
 *
 * Fields this build does not know are kept untouched, because state written by
 * a newer build is left alone rather than forced backwards (see storage.js).
 * No date is invented for a deck with none: saveDeck stamps `updatedAt` when
 * it writes, and a made-up `createdAt` would reorder the shelf.
 *
 * Returns the very same object when there was nothing to do, so storage can go
 * on deciding what to write by identity.
 */
export function upgradeDeck(deck) {
  if (!deck || typeof deck !== 'object' || Array.isArray(deck)) return null

  // An entry is { cardId, quantity } and may carry `name` (see stampNames),
  // `category`, and whatever a later build adds. One with no card to point at,
  // or a quantity that is not a whole number of copies, is not an entry any
  // screen could draw, so it goes.
  const entries = (list) => {
    if (!Array.isArray(list)) return []
    let changed = false
    const out = []
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || typeof entry.cardId !== 'string' || !entry.cardId
        || !Number.isInteger(entry.quantity) || entry.quantity <= 0) {
        changed = true
        continue
      }
      if ('name' in entry && typeof entry.name !== 'string') {
        const { name: _drop, ...rest } = entry
        changed = true
        out.push(rest)
      } else {
        out.push(entry)
      }
    }
    return changed ? out : list
  }

  const strings = (list) => {
    if (!Array.isArray(list)) return []
    const out = list.filter((item) => typeof item === 'string' && item)
    return out.length === list.length ? list : out
  }

  const next = {
    ...deck,
    name: typeof deck.name === 'string' ? deck.name : 'Untitled deck',
    formatId: typeof deck.formatId === 'string' && deck.formatId ? deck.formatId : 'commander',
    commanders: strings(deck.commanders),
    signatureSpell: typeof deck.signatureSpell === 'string' && deck.signatureSpell ? deck.signatureSpell : null,
    main: entries(deck.main),
    sideboard: entries(deck.sideboard),
    categoryOrder: strings(deck.categoryOrder),
    versions: Array.isArray(deck.versions) ? deck.versions : [],
  }

  // The names kept for the ids that have no entry to carry one (see
  // stampNames). A name that is not a name would be drawn as one, so only
  // strings survive; the key is left off a deck that has none.
  const names = plainObject(deck.cardNames)
  if (names) {
    const kept = {}
    for (const [id, name] of Object.entries(names)) if (typeof name === 'string' && name) kept[id] = name
    if (sameNames(kept, names)) next.cardNames = deck.cardNames
    else if (Object.keys(kept).length) next.cardNames = kept
    else delete next.cardNames
  } else if ('cardNames' in next) {
    delete next.cardNames
  }

  const settled = UPGRADED_FIELDS.every((field) => next[field] === deck[field])
    && next.cardNames === deck.cardNames && ('cardNames' in next) === ('cardNames' in deck)
  return settled ? deck : next
}

const UPGRADED_FIELDS = [
  'name', 'formatId', 'commanders', 'signatureSpell', 'main', 'sideboard', 'categoryOrder', 'versions',
]

const plainObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)

const sameNames = (a, b) => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/**
 * The same store of names with one id's name copied to another, or null when it
 * holds none. Copied rather than moved: a printing swap and a followed merge are
 * both the same game card under a new id, so the name is true of both — and a
 * stored version still holds the old id in its command zone, so dropping it
 * there would bring the commander back nameless on a restore.
 */
const renameKey = (store, fromId, toId) => {
  const names = plainObject(store)
  if (!names || !(fromId in names)) return names
  return { ...names, [toId]: names[fromId] }
}

const cardFrom = (lookup, id) => {
  if (typeof id !== 'string' || !id) return null
  if (typeof lookup === 'function') return lookup(id)
  if (lookup instanceof Map) return lookup.get(id)
  return lookup?.[id]
}

/**
 * The name the deck has stamped for each card id it holds.
 *
 * A printing id can stop resolving: Scryfall merges or deletes ids, most often
 * the preview printings a deck built during a spoiler season is full of. Once
 * that happens the card can no longer be fetched, and a deck row, an export
 * and the rules engine all had nothing to call it. So the name Scryfall gave
 * is written down while the card is in hand (stampNames) and read from here
 * wherever the card itself is missing. It is never a substitute for the
 * record: a stamped name carries no set, no price and no legality, and
 * nothing is ever guessed from it.
 *
 * Entries carry their own `name`; the ids with no entry — the commanders and
 * the signature spell — are kept in `cardNames`. A deck saved before any of
 * this also has a name for each of its cards in the legality snapshot, which
 * has recorded one since snapshots existed, so that is read last and makes an
 * older deck readable without waiting for it to be saved again.
 */
export function stampedNames(deck) {
  const out = new Map()
  const keep = (id, name) => {
    if (typeof id === 'string' && id && typeof name === 'string' && name && !out.has(id)) out.set(id, name)
  }
  for (const entry of [...(deck?.main ?? []), ...(deck?.sideboard ?? [])]) keep(entry?.cardId, entry?.name)
  for (const [id, name] of Object.entries(plainObject(deck?.cardNames) ?? {})) keep(id, name)
  for (const [id, held] of Object.entries(plainObject(deck?.snapshot?.cards) ?? {})) keep(id, held?.name)
  return out
}

/**
 * Writes down each card's name, as Scryfall gave it, for the cards in hand.
 *
 * Called where a deck is already being saved with its cards loaded — the
 * editor's commit, a card added from the card sheet, an import being applied —
 * so it costs no save of its own. A card that has not loaded keeps whatever
 * name was stamped before: nothing here invents one, and a name is never
 * fetched for its own sake.
 *
 * "Whatever was stamped before" means anywhere the deck already keeps a name,
 * stampedNames and all — including the legality snapshot of a deck saved before
 * any of this, which is the only name such a deck has. That name is *promoted*
 * here onto the entry, because the save this runs in front of replaces the
 * snapshot with one built from the cards that loaded, and a printing Scryfall no
 * longer has is not among them. Reading only `lookup` would therefore erase, on
 * the first save after launch, the name of the one card that most needs it.
 *
 * Returns the very same deck when nothing changed, as stampFace does, because
 * storage decides what to write by identity.
 */
export function stampNames(deck, lookup) {
  if (!deck || typeof deck !== 'object') return deck
  let stamped = null
  const nameOf = (id) => {
    const card = cardFrom(lookup, id)
    if (typeof card?.name === 'string' && card.name) return card.name
    stamped = stamped ?? stampedNames(deck)
    return stamped.get(id) ?? null
  }

  const stampZone = (list) => {
    if (!Array.isArray(list)) return list
    let changed = false
    const out = list.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      const name = nameOf(entry.cardId)
      if (!name || entry.name === name) return entry
      changed = true
      return { ...entry, name }
    })
    return changed ? out : list
  }
  const main = stampZone(deck.main)
  const sideboard = stampZone(deck.sideboard)

  // The command zone holds ids rather than entries, so its names are kept
  // beside them. Kept, not rebuilt: a name already here stays, even for an id
  // the command zone no longer holds. A main-deck entry keeps its name through
  // any number of removals, because a version clones the entry whole; `cardNames`
  // is in no version, so pruning it on the commit that takes a commander out
  // threw away the only record of what it was called — and a restore then
  // brought the commander back nameless. One short string per id is cheaper
  // than that.
  const held = plainObject(deck.cardNames) ?? {}
  const names = {}
  for (const [id, name] of Object.entries(held)) if (typeof name === 'string' && name) names[id] = name
  for (const id of [...(deck.commanders ?? []), ...(deck.signatureSpell ? [deck.signatureSpell] : [])]) {
    const name = nameOf(id)
    if (name) names[id] = name
  }
  const namesSettled = sameNames(names, held) && (Object.keys(names).length > 0) === ('cardNames' in deck)

  if (main === deck.main && sideboard === deck.sideboard && namesSettled) return deck
  const next = { ...deck }
  if (main !== deck.main) next.main = main
  if (sideboard !== deck.sideboard) next.sideboard = sideboard
  if (Object.keys(names).length) next.cardNames = namesSettled ? deck.cardNames : names
  else delete next.cardNames
  return next
}

const zoneOf = (deck, zone) => (zone === 'sideboard' ? deck.sideboard : deck.main)

export function addCard(deck, cardId, quantity = 1, zone = 'main') {
  const current = zoneOf(deck, zone)
  // A new entry object, never `existing.quantity += n`: the entries are
  // shared with the deck passed in, and a version or a "before" held by
  // reference would otherwise change under the caller's feet.
  const list = current.some((e) => e.cardId === cardId)
    ? current.map((e) => (e.cardId === cardId ? { ...e, quantity: e.quantity + quantity } : e))
    : [...current, { cardId, quantity }]
  const pruned = list.filter((e) => e.quantity > 0)
  return { ...deck, [zone]: pruned, updatedAt: new Date().toISOString() }
}

export function setQuantity(deck, cardId, quantity, zone = 'main') {
  const list = zoneOf(deck, zone)
    .map((e) => (e.cardId === cardId ? { ...e, quantity } : e))
    .filter((e) => e.quantity > 0)
  return { ...deck, [zone]: list, updatedAt: new Date().toISOString() }
}

export function removeCard(deck, cardId, zone = 'main') {
  return setQuantity(deck, cardId, 0, zone)
}

export function setCommanders(deck, cardIds) {
  return { ...deck, commanders: [...cardIds], updatedAt: new Date().toISOString() }
}

/**
 * The deck a hand-over from the Learn tab starts. An example arrives empty,
 * named and formatted after the list, because its cards go through the
 * importer for the person to review. A commander has nothing to review, so
 * it is seated here, by id: the printing the guide showed is the one the
 * deck holds, not whichever printing its name would look up.
 */
export function deckFromSeed({ example, card } = {}) {
  const deck = createDeck({
    name: example?.name ?? (card?.name ? `${card.name} deck` : 'Untitled deck'),
    formatId: example?.formatId ?? 'commander',
  })
  if (example || !card?.id) return deck
  // The card is in hand, so its name is stamped with it (see stampNames).
  return stampNames(setCommanders(deck, [card.id]), (id) => (id === card.id ? card : null))
}

/** Total card count, including commanders where the format counts them. */
export function deckSize(deck, format) {
  const main = deck.main.reduce((n, e) => n + e.quantity, 0)
  const commanders = format?.commanderCountsTowardDeck ? deck.commanders.length : 0
  const signature = format?.signatureSpell && deck.signatureSpell ? 1 : 0
  return main + commanders + signature
}

export function sideboardSize(deck) {
  return deck.sideboard.reduce((n, e) => n + e.quantity, 0)
}

/** Every card id in the deck across all zones, including commanders. */
export function allCardIds(deck) {
  const ids = new Set()
  for (const e of deck.main) ids.add(e.cardId)
  for (const e of deck.sideboard) ids.add(e.cardId)
  for (const id of deck.commanders) ids.add(id)
  if (deck.signatureSpell) ids.add(deck.signatureSpell)
  return [...ids]
}

/**
 * Copy counts aggregated across main and sideboard. The four-copy limit applies
 * to the combined deck-and-sideboard total, not to each zone separately — a
 * common and expensive misunderstanding at a tournament table.
 */
export function combinedCounts(deck) {
  const counts = new Map()
  const bump = (id, n) => counts.set(id, (counts.get(id) ?? 0) + n)
  for (const e of deck.main) bump(e.cardId, e.quantity)
  for (const e of deck.sideboard) bump(e.cardId, e.quantity)
  for (const id of deck.commanders) bump(id, 1)
  if (deck.signatureSpell) bump(deck.signatureSpell, 1)
  return counts
}

/**
 * Which game card a printing is, for copy limits: four of one printing and
 * one of another are five Lightning Bolts. Scryfall's oracle id says which
 * printings are one card; a record without one (an older cache, a
 * hand-written fixture) falls back to its name, and a card that has not
 * loaded to its own id, so it is only ever counted with itself.
 */
export function gameCardKey(card, cardId = card?.id) {
  const oracle = oracleIdOf(card)
  if (oracle) return `oracle:${oracle}`
  if (card?.name) return `name:${card.name}`
  return `id:${cardId}`
}

/**
 * Copies per game card rather than per printing: the counts of combinedCounts
 * gathered under gameCardKey, each with the printing ids that make it up, in
 * the deck's order.
 */
export function gameCardCounts(deck, cardsById) {
  const lookup = (id) => (cardsById instanceof Map ? cardsById.get(id) : cardsById?.[id])
  const groups = new Map()
  for (const [cardId, quantity] of combinedCounts(deck)) {
    const key = gameCardKey(lookup(cardId), cardId)
    const group = groups.get(key) ?? { ids: [], quantity: 0 }
    group.ids.push(cardId)
    group.quantity += quantity
    groups.set(key, group)
  }
  return groups
}

const err = (code, message, cardId) => ({ code, severity: 'error', message, cardId })
const warn = (code, message, cardId) => ({ code, severity: 'warning', message, cardId })

/**
 * The two warnings for a card held back only by not being out yet (see
 * legalityStatus). Neither makes a deck illegal.
 */
export const NOT_OUT_CODES = new Set(['not_out_yet', 'legality_pending'])

/**
 * The warning for a card in the week after its release whose Scryfall record
 * lists it in no paper format yet, as a record from before release does (see
 * legalityStatus). It does not make a deck illegal either; after the week,
 * Scryfall's not_legal is an error again.
 */
export const CATCHING_UP_CODE = 'legality_catching_up'

/**
 * Validates a deck against its format.
 *
 * @param deck       deck object
 * @param cardsById  Map or plain object of cardId -> Scryfall card
 * @param options    { now }: the day to judge release against, 'YYYY-MM-DD'
 * @returns { legal, violations, counts, colorIdentity }
 */
export function validateDeck(deck, cardsById, { now = today() } = {}) {
  const format = getFormat(deck.formatId)
  const violations = []
  if (!format) {
    return {
      legal: false,
      // The id the deck gives, when it gives one: a deck with none would
      // otherwise read 'Unknown format "undefined"'.
      violations: [err('unknown_format', typeof deck.formatId === 'string' && deck.formatId.trim()
        ? `Unknown format "${deck.formatId}".`
        : 'This deck names no format.')],
      counts: { main: 0, sideboard: 0, total: 0 },
      colorIdentity: [],
    }
  }

  const lookup = (id) =>
    cardsById instanceof Map ? cardsById.get(id) : cardsById?.[id]

  const total = deckSize(deck, format)
  const side = sideboardSize(deck)

  // --- Deck size -----------------------------------------------------------
  if (format.deck.max && total > format.deck.max) {
    violations.push(err('deck_too_large',
      `${format.name} decks must be exactly ${format.deck.max} cards. This deck has ${total}.`))
  }
  if (total < format.deck.min) {
    const shortfall = format.deck.min - total
    violations.push(err('deck_too_small',
      format.deck.max === format.deck.min
        ? `${format.name} decks must be exactly ${format.deck.min} cards. This deck has ${total} — ${shortfall} short.`
        : `${format.name} decks need at least ${format.deck.min} cards. This deck has ${total} — ${shortfall} short.`))
  }
  if (side > format.sideboard.max) {
    violations.push(err('sideboard_too_large',
      format.sideboard.max === 0
        ? `${format.name} does not use a sideboard, but this deck has ${side} cards in one.`
        : `Sideboards are capped at ${format.sideboard.max} cards. This one has ${side}.`))
  }

  // --- Commanders ----------------------------------------------------------
  const commanderCards = deck.commanders.map(lookup).filter(Boolean)
  let identity = []

  if (format.commander?.required) {
    const rules = format.commander
    if (deck.commanders.length < rules.min) {
      violations.push(err('missing_commander',
        rules.requirePlaneswalker
          ? 'This deck needs an Oathbreaker (a planeswalker).'
          : 'This deck needs a commander.'))
    }
    if (deck.commanders.length > rules.max) {
      violations.push(err('too_many_commanders',
        `${format.name} allows at most ${rules.max} commander${rules.max === 1 ? '' : 's'}.`))
    }
    for (const card of commanderCards) {
      const check = canBeCommander(card, format)
      if (!check.ok) {
        violations.push(err('invalid_commander', `${card.name}: ${check.reason}`, card.id))
      }
    }
    identity = unionColorIdentity(commanderCards)
  }

  if (format.signatureSpell?.required) {
    const spell = lookup(deck.signatureSpell)
    if (!spell) {
      violations.push(err('missing_signature_spell',
        'Oathbreaker decks need a signature spell — one instant or sorcery.'))
    } else {
      const type = typeLineOf(spell)
      const ok = format.signatureSpell.types.some((t) => new RegExp(`\\b${t}\\b`).test(type))
      if (!ok) {
        violations.push(err('invalid_signature_spell',
          `${spell.name} cannot be a signature spell — it must be an instant or a sorcery.`, spell.id))
      }
    }
  }

  // --- Per-card checks -----------------------------------------------------
  // Legality and colour identity are read per printing, as each record
  // carries them. The copy limit and a restriction count the game card, all
  // its printings together, and are reported once, at its first printing,
  // with every printing's id, so one breach is one problem however many
  // printings make it up.
  const counts = combinedCounts(deck)
  const groupOf = new Map()
  for (const group of gameCardCounts(deck, cardsById).values()) {
    for (const id of group.ids) groupOf.set(id, group)
  }
  for (const [cardId] of counts) {
    const card = lookup(cardId)
    if (!card) {
      violations.push(warn('card_not_loaded',
        'A card in this deck has not loaded yet, so it has not been checked.', cardId))
      continue
    }
    const group = groupOf.get(cardId)
    const first = group.ids[0] === cardId
    const quantity = group.quantity
    const onGroup = (violation) => ({ ...violation, cardIds: [...group.ids] })

    // A card that is not out yet warns rather than fails: Scryfall has not
    // ruled on it, and the player is never kept from building with it.
    const status = legalityStatus(card, format, now)
    if (status === 'banned') {
      violations.push(err('banned', `${card.name} is banned in ${format.name}.`, cardId))
    } else if (status === 'not_legal') {
      violations.push(err('not_legal', `${card.name} is not in the ${format.name} card pool.`, cardId))
    } else if (status === 'future_legal') {
      violations.push(warn('not_out_yet',
        `${card.name} is not out until ${releaseLabel(notOutUntil(card, now))}. Scryfall's Future Standard lists it, so it is expected to be Standard-legal once out.`, cardId))
    } else if (status === 'pending') {
      violations.push(warn('legality_pending',
        `${card.name} is not out until ${releaseLabel(notOutUntil(card, now))}. Scryfall sets its ${format.name} legality when it is released.`, cardId))
    } else if (status === 'catching_up') {
      // What the record shows, and no more: it may yet say legal here, or
      // not, and the app does not guess which.
      violations.push(warn(CATCHING_UP_CODE,
        `${card.name} came out on ${releaseLabel(card.released_at)}, but the Scryfall data on this device lists it as legal in no format, as Scryfall does before a release, so the app does not know whether it is ${format.name}-legal.`, cardId))
    } else if (status === 'restricted' && first && quantity > 1) {
      violations.push(onGroup(err('restricted',
        `${card.name} is restricted in ${format.name} — only one copy is allowed, but this deck has ${quantity}.`, cardId)))
    } else if (status === 'unknown') {
      violations.push(warn('legality_unknown',
        `Legality data for ${card.name} in ${format.name} is unavailable, so it has not been checked.`, cardId))
    }

    const limit = effectiveCopyLimit(card, format)
    if (first && quantity > limit) {
      violations.push(onGroup(err('too_many_copies',
        format.singleton && limit === 1
          ? `${format.name} is singleton — only one ${card.name}, but this deck has ${quantity}.`
          : `At most ${limit} copies of ${card.name} are allowed, but this deck has ${quantity}.`, cardId)))
    }

    if (format.commander?.colorIdentity && commanderCards.length) {
      const outside = (card.color_identity ?? []).filter((c) => !identity.includes(c))
      if (outside.length) {
        violations.push(err('color_identity',
          `${card.name} is outside your commander's colour identity (${outside.join('')}).`, cardId))
      }
    }
  }

  return {
    legal: violations.every((v) => v.severity !== 'error'),
    violations,
    counts: { main: total - (format.commanderCountsTowardDeck ? deck.commanders.length : 0), sideboard: side, total },
    colorIdentity: identity,
  }
}

/**
 * How many cards in the deck are printings not out yet, in copies, the way
 * the deck's other counts are given: four of one card are four cards. Every
 * copy is counted, main deck, sideboard and command zone, whatever its
 * legality, so the number matches the "Not out until" labels on the rows
 * beside it. A card that has not loaded has no date to read and is not one.
 */
export function notOutCount(deck, cardsById, { now = today() } = {}) {
  const lookup = (id) => (cardsById instanceof Map ? cardsById.get(id) : cardsById?.[id])
  let n = 0
  for (const [cardId, quantity] of combinedCounts(deck)) {
    if (notOutUntil(lookup(cardId), now)) n += quantity
  }
  return n
}

/**
 * The deck's verdict in a few words, for the chip at the top of the editor:
 * its problems when it has any, then how many cards are not out yet, then how
 * many are out but have no legality the app can read in the Scryfall data on
 * this device (the week after a release, see legalityStatus), and only then
 * "Legal", since a deck with cards nobody can hold yet, or cards whose
 * legality the app does not know, is not one it can call legal to play today.
 * Copies are counted, as elsewhere. `tone` is the chip's: error, warn or ok.
 */
export function deckVerdict(deck, validation, cardsById, { now = today() } = {}) {
  if (!validation.legal) {
    const errors = validation.violations.filter((v) => v.severity === 'error').length
    return { tone: 'error', text: `${errors} problem${errors === 1 ? '' : 's'}` }
  }
  const notOut = notOutCount(deck, cardsById, { now })
  if (notOut) return { tone: 'warn', text: `${notOut} card${notOut === 1 ? '' : 's'} not out yet` }
  const catchingUp = new Set(validation.violations
    .filter((v) => v.code === CATCHING_UP_CODE).map((v) => v.cardId))
  let unlisted = 0
  for (const [cardId, quantity] of combinedCounts(deck)) {
    if (catchingUp.has(cardId)) unlisted += quantity
  }
  if (unlisted) return { tone: 'warn', text: `${unlisted} card${unlisted === 1 ? '' : 's'} with legality not known` }
  return { tone: 'ok', text: 'Legal' }
}

export function unionColorIdentity(cards) {
  const set = new Set()
  for (const card of cards) for (const c of card?.color_identity ?? []) set.add(c)
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => set.has(c))
}

/** Expands deck entries to a flat array of card objects, one per physical copy. */
export function expandToCards(entries, lookup) {
  const out = []
  for (const { cardId, quantity } of entries) {
    const card = typeof lookup === 'function' ? lookup(cardId) : lookup?.[cardId]
    if (!card) continue
    for (let i = 0; i < quantity; i++) out.push(card)
  }
  return out
}

/**
 * A land for curve and type-breakdown purposes: the front face is a land.
 *
 * Deliberately excludes modal spell // land cards — see isModalLand. Use
 * `countManaSources` when you want "things that can produce mana", which does
 * include them.
 */
export function isLandCard(card) {
  return isTrueLand(card)
}

/**
 * Choosing a different printing of a card you already have.
 *
 * The deck stores a printing id per entry, so this is a straight swap — but
 * if the deck already holds the printing being swapped to, the two entries
 * have to merge, or the deck would list the same card twice and every count
 * in the app would be wrong. Commanders are swapped the same way.
 *
 * Both zones merge, and for the same reason. A sideboard holding a foil and a
 * non-foil of one card, or a preview printing and the released one, is ordinary;
 * leaving two entries under one id there gave two rows on one React key, a
 * stepper that added a copy to the wrong one, and a ✕ that deleted both.
 */
export function swapPrinting(deck, fromId, toId) {
  if (!deck || !fromId || !toId || fromId === toId) return deck
  let merged = false
  const swapZone = (list) => {
    const out = []
    for (const entry of list ?? []) {
      const id = entry.cardId === fromId ? toId : entry.cardId
      const at = out.findIndex((e) => e.cardId === id)
      if (at >= 0) {
        out[at] = { ...out[at], quantity: out[at].quantity + entry.quantity }
        merged = true
      } else {
        out.push(entry.cardId === fromId ? { ...entry, cardId: toId } : entry)
      }
    }
    return out
  }
  const main = swapZone(deck.main)
  const sideboard = swapZone(deck.sideboard)
  const commanders = [...new Set((deck.commanders ?? []).map((id) => (id === fromId ? toId : id)))]
  // The signature spell is an id like any other, and choosing a printing for it
  // used to do nothing at all.
  const signatureSpell = deck.signatureSpell === fromId ? toId : deck.signatureSpell
  const touched = merged
    || main.some((e, i) => e !== (deck.main ?? [])[i])
    || sideboard.some((e, i) => e !== (deck.sideboard ?? [])[i])
    || commanders.join() !== (deck.commanders ?? []).join()
    || signatureSpell !== deck.signatureSpell
  if (!touched) return deck
  // The deck's own chosen art follows the card it was pointing at.
  const artCardId = deck.artCardId === fromId ? toId : deck.artCardId
  // So does the name stamped for an id in the command zone: it is the same card.
  const cardNames = renameKey(deck.cardNames, fromId, toId)
  return {
    ...deck,
    main,
    sideboard,
    commanders,
    signatureSpell,
    artCardId,
    ...(cardNames ? { cardNames } : {}),
    updatedAt: new Date().toISOString(),
  }
}

export { isBasicLand, isModalLand, isTrueLand, frontTypeLine }
