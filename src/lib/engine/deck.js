// The deck as the engine takes it.
//
// One function builds what a seat sends, so that the lobby's check and the
// sit itself cannot disagree about what the deck is: the check asks about
// exactly the map the sit will send.
import { FORMATS } from '../formats.js'
import { stampedNames } from '../deck.js'

/**
 * The name to send for a card: Scryfall's own, except for a reversible card.
 * Scryfall names one "X // X", the same shape as an art-series card, which is
 * not a card a deck may hold, and the engine refuses that shape rather than
 * guess which it is. So a reversible card goes by its single name.
 */
export function engineName(card) {
  if (card?.layout === 'reversible_card' && card.card_faces?.[0]?.name) return card.card_faces[0].name
  return card?.name ?? null
}

/**
 * The name a deck stamped for a card that has not loaded, as the engine takes
 * it (see stampNames in deck.js). The stamp is Scryfall's name for the card and
 * nothing else — no layout, so the reversible card's "X // X" cannot be told
 * apart from a record; a stamp whose two halves are the same word is the one
 * shape that can only be that, and the engine refuses it, so it goes by the
 * single name as engineName sends it.
 */
function stampedEngineName(name) {
  if (typeof name !== 'string' || !name) return null
  const halves = name.split(' // ')
  return halves.length === 2 && halves[0] === halves[1] ? halves[0] : name
}

/** How many copies a deck line holds: a count, a printing with a count, or a list of those. */
export function copiesOf(line) {
  if (Array.isArray(line)) return line.reduce((sum, x) => sum + copiesOf(x), 0)
  const n = typeof line === 'number' ? line : line?.count
  return Number.isInteger(n) && n > 0 ? n : 0
}

/**
 * Name to deck line, and how many copies had no name to go by because their
 * card has not loaded. A line names the printing the player chose, by
 * Scryfall's set and collector number, so the engine can deal that printing's
 * art when it has it: `{count, set, number}`, or a list of those when one card
 * is in the deck in several printings. A card with no printing to name goes
 * as a plain count, the shape an engine before printings reads.
 *
 * A card that has not loaded but whose name the deck stamped (`stamped`, see
 * stampNames in deck.js) goes by that name, as a plain count: the engine knows
 * cards by name, so a deck holding a printing Scryfall no longer has is still a
 * deck it can deal. It is not counted as unloaded, because nothing is missing
 * from what is sent — only the printing's art is, which the engine picks for
 * itself.
 */
function countNames(entries, lookup, stamped) {
  const byName = new Map()
  let total = 0
  let unloaded = 0
  for (const entry of Array.isArray(entries) ? entries : []) {
    const copies = entry?.quantity ?? 1
    total += copies
    const card = lookup?.(entry?.cardId)
    const name = engineName(card) ?? stampedEngineName(stamped?.get(entry?.cardId))
    if (!name) { unloaded += copies; continue }
    const set = card?.set || null
    const number = card?.collector_number || null
    const key = set && number ? `${set} ${number}` : ''
    const lines = byName.get(name) ?? new Map()
    const line = lines.get(key) ?? (key ? { count: 0, set, number } : { count: 0 })
    line.count += copies
    lines.set(key, line)
    byName.set(name, lines)
  }
  const out = {}
  for (const [name, lines] of byName) {
    const list = [...lines.values()]
    out[name] = list.length > 1 ? list : list[0].set ? list[0] : list[0].count
  }
  return { out, total, unloaded }
}

/**
 * A deck made ready to sit with at the engine's table.
 *
 * `deck` maps each card's name, as Scryfall spells it, to how many copies;
 * the engine resolves the names (engine/README.md). `total` counts every copy
 * in the main deck. `unloaded` counts the main-deck copies whose card has not
 * arrived from Scryfall yet. Those have no name to send, and a deck sent
 * without them is a different deck, so a caller must not sit while `unloaded`
 * is above zero rather than quietly leave them out.
 *
 * `sideboard` is the same map for the cards the player owns outside the game,
 * which only a wish reaches. It is sent only for a format that has one: the
 * Commander family's is 0 cards, and what a Commander deck keeps there is
 * usually its maybeboard, not cards for the game. A sideboard card that has
 * not loaded is counted in `sideboardUnloaded` and left out, as a sideboard
 * card the engine does not know is (the owner's choice, 2026-09-21).
 *
 * A card whose record is gone but whose name the deck stamped still goes, by
 * that name (see countNames), so a deck built in a preview season can be
 * played after Scryfall discards one of its ids.
 */
export function seatDeck(deck, lookup) {
  const stamped = stampedNames(deck)
  const main = countNames(deck?.main, lookup, stamped)
  const allowed = FORMATS[deck?.formatId]?.sideboard?.max > 0
  const side = allowed ? countNames(deck?.sideboard, lookup, stamped) : { out: {}, unloaded: 0 }
  return { deck: main.out, sideboard: side.out, total: main.total, unloaded: main.unloaded, sideboardUnloaded: side.unloaded }
}

/**
 * The seat without the named cards, and what was left out with its counts.
 * Used when a player chose, in the lobby, to play the engine without the
 * cards it does not know; a name the deck does not hold is ignored.
 */
export function leaveOut(seat, names) {
  const deck = { ...seat.deck }
  const left = []
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name !== 'string' || !(copiesOf(deck[name]) > 0)) continue
    left.push({ name, count: copiesOf(deck[name]) })
    delete deck[name]
  }
  const gone = left.reduce((sum, l) => sum + l.count, 0)
  return { seat: { ...seat, deck, total: seat.total - gone }, left }
}

/**
 * The cards behind each name a seat sends, by that name (`engineName`), so
 * what the engine says about a name can be laid against the printings the
 * deck holds of it. A card that has not loaded has no name and is not here.
 */
export function recordsByName(entries, lookup) {
  const out = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const card = lookup?.(entry?.cardId)
    const name = engineName(card)
    if (!name) continue
    const list = out.get(name) ?? []
    if (!list.includes(card)) list.push(card)
    out.set(name, list)
  }
  return out
}

/**
 * The engine's set list, read forgivingly, keyed by code in lower case:
 * Argentum gives Scryfall's codes in capitals ("POR"), and Scryfall's records
 * carry them in small letters ("por"). Null when there is no list to read,
 * which leaves every card without a reason rather than with a wrong one.
 */
function setListOf(list) {
  if (!Array.isArray(list)) return null
  const out = new Map()
  for (const s of list) {
    const code = typeof s === 'string' ? s : s?.code
    if (typeof code !== 'string' || !code) continue
    const key = code.toLowerCase()
    out.set(key, { incomplete: Boolean(out.get(key)?.incomplete) || s?.incomplete === true })
  }
  return out.size ? out : null
}

/** How near the engine comes to a card, so the nearest of its printings speaks for it. */
const NEARNESS = { 'no-set': 0, 'part-set': 1, 'not-in-set': 2 }

/**
 * Why the engine does not know a card, from its own set list and the set of
 * each printing the deck holds: it has no cards of that set ('no-set'), it
 * marks the set incomplete ('part-set'), or it has the set and not the card
 * ('not-in-set'). The set is named as Scryfall names it on the card. Null
 * when there is nothing to go on: no set list, no record, or a record with no
 * set to name. Nothing here guesses when a set will reach the engine, and the
 * engine's own release dates are not read.
 *
 * The engine knows a card by its name, from whichever of its sets printed
 * it, so a set it does not list is the reason only for a card's first
 * printing. A reprint (Scryfall's `reprint`) in a set it does not list, as a
 * Secret Lair or The List printing is, says nothing of why: the engine lacks
 * the card in every printing, which is 'not-in-set', what its own answer
 * says. A reprint in a set it has only in part keeps that reason, since
 * finishing the set would bring the card.
 */
function reasonFor(records, sets) {
  if (!sets || !Array.isArray(records)) return null
  let best = null
  for (const card of records) {
    const code = typeof card?.set === 'string' ? card.set.toLowerCase() : ''
    if (!code) continue
    const listed = sets.get(code)
    const kind = listed
      ? (listed.incomplete ? 'part-set' : 'not-in-set')
      : (card.reprint === true ? 'not-in-set' : 'no-set')
    const set = typeof card.set_name === 'string' && card.set_name ? card.set_name : null
    // Every reason but the last names the set, so it needs a name to say.
    if (kind !== 'not-in-set' && !set) continue
    if (!best || NEARNESS[kind] > NEARNESS[best.kind]) best = { kind, set }
  }
  return best
}

/**
 * What the engine's answer about a deck means, read forgivingly: the engine is
 * another program, and the lobby should never meet a shape it has to guard
 * against. The unknown names are laid against the deck's own counts, in the
 * deck's own order, and a name the deck does not hold is dropped rather than
 * shown. A deck is complete only when the engine knows every card and every
 * card loaded. `reply` null means the relay cannot check at all.
 *
 * Each unknown main-deck card carries a `reason` (see reasonFor) when the
 * reply has the engine's set list and `records` (from recordsByName) holds the
 * card; otherwise its reason is null and the lobby names it as before.
 */
export function verdictOf(seat, reply, records = null) {
  const base = { total: seat.total, unloaded: seat.unloaded }
  if (reply === null) return { state: 'cannot-check', ...base }
  if (!Array.isArray(reply?.unknown)) return { state: 'unreadable', ...base }
  const lines = (held, named) => {
    const asked = new Set(Array.isArray(named) ? named.filter((n) => typeof n === 'string') : [])
    return Object.keys(held ?? {}).filter((name) => asked.has(name)).map((name) => ({ name, count: copiesOf(held[name]) }))
  }
  const sets = setListOf(reply.engineSets)
  const recordsOf = (name) => (records instanceof Map ? records.get(name) : null)
  const unknown = lines(seat.deck, reply.unknown).map((u) => ({ ...u, reason: reasonFor(recordsOf(u.name), sets) }))
  const missing = unknown.reduce((sum, u) => sum + u.count, 0)
  return {
    state: unknown.length || seat.unloaded ? 'short' : 'complete',
    ...base,
    known: seat.total - seat.unloaded - missing,
    unknown,
    unknownSideboard: lines(seat.sideboard, reply.unknownSideboard),
  }
}

/**
 * The unknown cards gathered by their reason, in the deck's order, so twenty
 * cards of one set the engine has not got are one reason with twenty names
 * under it rather than twenty reasons. Cards the engine has the set of go
 * together whatever their set, since that reason does not name one.
 */
export function byReason(unknown) {
  const groups = new Map()
  for (const u of Array.isArray(unknown) ? unknown : []) {
    const reason = u?.reason ?? null
    const key = !reason ? '' : reason.kind === 'not-in-set' ? reason.kind : `${reason.kind}\n${reason.set}`
    const group = groups.get(key) ?? { reason, cards: [] }
    group.cards.push(u)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** A reason in words, for one card or several; no reason is the lobby's plain "Not known". */
export function reasonText(reason, many = false) {
  const which = many ? 'these cards' : 'this card'
  switch (reason?.kind) {
    case 'no-set': return `The rules engine has no ${reason.set} cards yet`
    case 'part-set': return `The rules engine has ${reason.set} only in part, and not ${which} yet`
    case 'not-in-set': return `The rules engine does not know ${which}`
    default: return 'Not known'
  }
}

/** A few names, as a sentence says them: "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function nameList(names, max = 3) {
  if (names.length <= 1) return names.join('')
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}
