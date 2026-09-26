/**
 * A stand-in commander (HANDOFF.md §3 item 19, the owner's decision of
 * 2026-09-25).
 *
 * The engine cannot deal a Commander game with a deck whose commander it does
 * not know, since every Commander deck has one (903.3), and at the pin it knows
 * none of the app's example decks' commanders (PLAN.md, M6). The owner decided
 * that one of the deck's own legendary creatures the engine knows may lead it
 * instead, as a stand-in, said everywhere as not the deck's real commander. This
 * file says which cards the rules allow to, builds the seat led by the one the
 * player chose, and holds every word said about it.
 *
 * Which cards: a legendary creature card, which is what a commander is (903.3);
 * within the deck's colour identity, which is its real commander's (903.4), as
 * every card of the deck is (903.5c); and holding every card dealt with it inside
 * its own colour identity, as a deck's commander must (903.5c). Colour identities
 * are Scryfall's (`color_identity`), off the records the deck loaded: a card to be
 * dealt whose record has not loaded says nothing of its colours, so where there is
 * one, no stand-in is offered, rather than one the rules may not allow. Only a
 * card the engine knows can lead, and only where it does not know the real one;
 * the lobby's verdict says both, and the cards it does not know are left out, as
 * the owner's M1 answer has it.
 *
 * Chosen by the player in the lobby's gate, never picked for them, and recorded
 * with the table (useEngineRoom.js, `agreeToLeaveOut`), never in the deck: the
 * deck on the shelf is not changed. The real commander is not sent at all — the
 * engine does not know it — and the stand-in goes as the commander, taken out of
 * the library, with `standsFor` naming the one it stands in for, which the relay
 * keeps and the engine is never sent (scripts/relay-engine.mjs).
 *
 * Section 903 is cited from the Comprehensive Rules directly, as M6's lines are,
 * there being no transcription of it in docs/ (PLAN.md, M6, departure 6).
 *
 * Since §3 item 20 a Duel Commander or a Brawl deck is dealt as a Commander game
 * too, and one whose commander the engine does not know is offered a stand-in the
 * same way, by the same rules — a legendary creature card, as item 22's default
 * has it, though Brawl allows a legendary planeswalker to lead a deck (903.12c) —
 * and said in the words of its own game: its life total and its rule, and for
 * Duel Commander its committee's rules for a commander, which defer to 903
 * (commander.js, `GAMES`).
 *
 * Pure, and forgiving: what it reads was written by any build of the app or the
 * relay, and a shape it cannot read is no stand-in, never a thrown error.
 */
import { stampedNames } from '../deck.js'
import { copiesOf, engineName, nameList, stampedEngineName, withArticle } from './deck.js'
import { COMMANDER_GAME, gameName, gameRules, isCommanderGame } from './commander.js'

const WUBRG = ['W', 'U', 'B', 'R', 'G']

/** A card's colour identity as Scryfall gives it (903.4), in WUBRG order; null where its record gives none. */
export function identityOf(card) {
  if (!Array.isArray(card?.color_identity)) return null
  return WUBRG.filter((c) => card.color_identity.includes(c))
}

/**
 * Whether a card is a legendary creature card, as a commander is (903.3): read
 * off the front face where a card has two, since that is the card in the deck.
 * The subtypes after the dash are left out, so a creature type is never read as
 * the card type.
 */
export function isLegendaryCreature(card) {
  const type = card?.card_faces?.[0]?.type_line ?? card?.type_line
  if (typeof type !== 'string') return false
  const [types] = type.split('—')
  return /\bLegendary\b/.test(types) && /\bCreature\b/.test(types)
}

const within = (inner, outer) => inner.every((c) => outer.includes(c))

/**
 * The stand-ins the rules allow for a Commander deck whose one commander the
 * engine does not know, in the deck's order: `{ name, set?, number?, identity }`
 * for each, `name` as the sit sends it (`engineName`) and the printing the deck
 * holds. Empty where there is none, and wherever what it takes to say cannot be
 * read: not a Commander deck, two commanders or none, a real commander the engine
 * knows or whose record has not loaded, or a card to be dealt whose colours are
 * not known.
 *
 * `unknown` is the names the engine does not know — the lobby's verdict, or at the
 * table the names the player agreed to leave out — which are the cards not dealt.
 */
export function standInsFor(deck, lookup, unknown) {
  if (!isCommanderGame(deck?.formatId)) return []
  const leaders = [...new Set((Array.isArray(deck.commanders) ? deck.commanders : []).filter((id) => typeof id === 'string' && id))]
  if (leaders.length !== 1) return []
  const real = lookup?.(leaders[0])
  const deckIdentity = identityOf(real)
  const left = new Set(Array.isArray(unknown) ? unknown.filter((n) => typeof n === 'string') : [])
  if (!deckIdentity || !left.has(engineName(real))) return []
  const stamped = stampedNames(deck)
  const dealt = []
  for (const entry of Array.isArray(deck.main) ? deck.main : []) {
    if (leaders.includes(entry?.cardId)) continue
    const card = lookup?.(entry?.cardId)
    const name = engineName(card) ?? stampedEngineName(stamped?.get(entry?.cardId))
    if (name && left.has(name)) continue
    // A card to be dealt with no colours to go by: 903.5c cannot be checked.
    if (!card || !identityOf(card)) return []
    dealt.push(card)
  }
  const colours = [...new Set(dealt.flatMap(identityOf))]
  const out = []
  for (const card of dealt) {
    const name = engineName(card)
    if (!name || out.some((s) => s.name === name) || !isLegendaryCreature(card)) continue
    const identity = identityOf(card)
    if (!within(identity, deckIdentity) || !within(colours, identity)) continue
    out.push({ name, ...(card.set && card.collector_number ? { set: card.set, number: card.collector_number } : {}), identity })
  }
  return out
}

/** One copy fewer of a deck line (a count, a printing with a count, or a list of those); null where none is left. */
function oneFewer(line) {
  if (Array.isArray(line)) {
    const list = [...line]
    const at = list.findIndex((l) => copiesOf(l) > 0)
    if (at < 0) return null
    const rest = oneFewer(list[at])
    if (rest === null) list.splice(at, 1); else list[at] = rest
    return list.length ? (list.length === 1 ? list[0] : list) : null
  }
  const n = copiesOf(line)
  if (n <= 1) return null
  return typeof line === 'number' ? n - 1 : { ...line, count: n - 1 }
}

/** The printing a deck line names, where it names one. */
function printingOf(line) {
  const first = (Array.isArray(line) ? line : [line]).find((l) => l && typeof l === 'object' && typeof l.set === 'string' && typeof l.number === 'string')
  return first ? { set: first.set, number: first.number } : {}
}

/**
 * The seat as the sit sends it, led by a stand-in: the card taken out of the
 * library, one copy of it, and sent as the commander in the printing the deck
 * holds, with `standsFor` naming the real commander. The count is unchanged, the
 * card having moved from the library to the command zone. Null where it cannot
 * be: not a Commander seat, a seat that still has a commander, or a card not in
 * its library.
 */
export function leadWith(seat, name, realName) {
  if (!isCommanderGame(seat?.game) || seat.commander || typeof name !== 'string' || !name || typeof realName !== 'string' || !realName) return null
  const line = seat.deck?.[name]
  if (!(copiesOf(line) > 0)) return null
  const deck = { ...seat.deck }
  const rest = oneFewer(line)
  if (rest === null) delete deck[name]; else deck[name] = rest
  return { ...seat, deck, commander: { name, ...printingOf(line), standsFor: realName } }
}

/**
 * The stand-in recorded for a table, as the table deals it (useEngineRoom.js):
 * `prepared` is the seat with the cards agreed to be left out already out
 * (`leaveOut`), the real commander among them; `name` the stand-in recorded, read
 * forgivingly. The rules are asked again here, of this device's records, since
 * the deck may have changed since the lobby asked them: `{ seat, lead }` where it
 * still may lead, `{ lost: name }` where it may not, and null where none was
 * recorded or the seat has no real commander left out to stand in for.
 */
export function ledSeat(prepared, name, { deck, lookup, left = [] } = {}) {
  if (typeof name !== 'string' || !name || !prepared?.seat) return null
  const real = (Array.isArray(prepared.left) ? prepared.left : []).find((l) => l?.commander)?.name
  if (!real) return null
  const allowed = standInsFor(deck, lookup, left).some((s) => s.name === name)
  const seat = allowed ? leadWith(prepared.seat, name, real) : null
  return seat ? { seat, lead: { name, for: real } } : { lost: name }
}

/** A stand-in as the wire says one, `{ name, for }`, read forgivingly; null for anything else. */
export function leadOf(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : null
  const real = typeof v.for === 'string' && v.for.trim() ? v.for.trim() : null
  return name && real ? { name, for: real } : null
}

/** A stand-in named with what it stands in for, as the seat lists and the table say it. */
export const standInPhrase = (lead) => `${lead.name}, a stand-in for ${lead.for}`

/** The line on a deck's tile in the lobby, under M6's line that the engine cannot lead it: what can lead it instead. */
export function standInTileLine(offered) {
  const names = (Array.isArray(offered) ? offered : []).map((s) => s?.name).filter((n) => typeof n === 'string')
  if (!names.length) return null
  return `A stand-in can lead it: ${names.length === 1 ? 'a legendary creature of its own the engine knows' : 'legendary creatures of its own the engine knows'}, ${nameList(names, Infinity)}.`
}

/**
 * What the lobby's gate says of leading the deck with a stand-in: which cards the
 * rules allow and why, each rule by its number, what the game dealt is, and that
 * the deck itself is not changed. `known` is how many cards the engine will deal,
 * the stand-in among them, and `game` the game the deck asks for (§3 item 20),
 * whose life total and deck size are said with their rules.
 */
export function standInOffer({ offered, real, known, game = COMMANDER_GAME }) {
  const list = Array.isArray(offered) ? offered : []
  const rules = gameRules(game)
  // What a commander may be and the colours it holds, by the game's own rules: Duel Commander's committee's, which defer to 903 (`GAMES`).
  const which = list.length === 1
    ? `${list[0].name} can lead it instead, as a stand-in: a legendary creature of the deck's own, as a commander is (${rules.leaderRule}), that the engine knows, whose colour identity lies within the deck's and holds every card dealt (${rules.identityRule}).`
    : `A stand-in can lead it instead, one of these: legendary creatures of the deck's own, as a commander is (${rules.leaderRule}), that the engine knows, each with a colour identity that lies within the deck's and holds every card dealt (${rules.identityRule}).`
  const library = known - 1
  // Brawl's hundred is the app's and Scryfall's, not the Comprehensive Rules' sixty (903.12d), so it has no rule to cite.
  const size = rules.sizeRule ? ` (${rules.sizeRule})` : ' here'
  return `${which} It begins in the command zone in ${real}'s place, said throughout to be a stand-in and not the deck's real commander, and the engine deals the other ${library} card${library === 1 ? '' : 's'} with it as ${withArticle(rules.name)} game: ${rules.life} life each (${rules.lifeRule}), and ${known} cards where ${withArticle(rules.name)} deck holds a hundred${size}. The deck you keep is not changed.`
}

/** The log's line, said once at the deal, where the person's deck is led by a stand-in, in the words of the game dealt. */
export const standInLine = (lead, game = COMMANDER_GAME) => `${lead.name} leads your deck as a stand-in, as you chose: the engine does not know the deck's real commander, ${lead.for}, and ${withArticle(gameName(game))} game needs one (${gameRules(game).hasRule}).`

/**
 * The log's line where the person sent a stand-in and the game was dealt by the
 * ordinary rules, in which nothing leads a deck: where the card went. The sit took
 * it out of the library to send it as the commander, and a room since the review
 * of items 19 and 20 puts it back and says so (`seated.format.inLibrary`, `back`
 * the stand-in it names); one from before says nothing, and dealt it nowhere.
 */
export function unledLine(lead, back = null) {
  const chosen = `${lead.name}, chosen to lead this deck as a stand-in for ${lead.for}, leads nothing in a game dealt by the ordinary rules`
  return back?.name === lead.name
    ? `${chosen}, so it is dealt in your library with the rest of the deck.`
    : `${chosen}, and this relay did not put it back in the library, so the deck is played without it.`
}

/**
 * The log's line where a stand-in recorded for the table can no longer lead the
 * deck — the card gone from it, or its colours no longer allowing it — so the
 * deck goes with no commander, and the game dealt is said after it.
 */
export const standInLostLine = (name) => `${name}, chosen in the lobby to lead this deck as a stand-in, can no longer lead it, so the deck is sent with no commander.`
