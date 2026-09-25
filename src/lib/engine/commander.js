/**
 * Commander at the engine's table (HANDOFF.md, M6): which game a deck asks the
 * engine for, and every word the table says about it.
 *
 * The rules are Argentum's `Format.Commander` as it stands at the pin — 40
 * life, a hundred cards, each commander beginning in its owner's command zone,
 * commander tax, and 21 combat damage from one commander — and the engine keeps
 * them, not this file. What this file does is say them, each by its number in
 * the Comprehensive Rules, since docs/TURN_STRUCTURE.md is the turn and not the
 * format: 903.3 (every deck led by a commander), 903.6 (the command zone at the
 * start), 903.7 (40 life), 903.8 (commander tax), 903.9a and 903.9b (the
 * question of the command zone), and 903.10a (commander damage). Section 903
 * has no transcription in docs/ to cite as the turn has, so these are said
 * from the Comprehensive Rules directly: a departure recorded in PLAN.md (M6)
 * and put to the owner in HANDOFF.md §6.
 *
 * Only the Commander format is dealt as a Commander game. The engine deals no
 * other game of the family (Server.kt, `GAME_FORMATS`), so a Brawl or an
 * Oathbreaker deck goes as every deck of the family went before M6: its library
 * by the ordinary rules, and without its commander, which the lobby says.
 *
 * Pure, and forgiving: everything here reads what the wire or storage gave it,
 * any build of the relay or the engine having written it, and says a case it
 * cannot read as that rather than throwing.
 */
import { getFormat } from '../formats.js'
import { nameList, withArticle } from './deck.js'

/** The one format of the Commander family the engine deals by its own rules. */
export const COMMANDER_GAME = 'commander'

/**
 * The game a deck asks the engine for: Commander for a Commander deck, and the
 * ordinary rules for every other. Every sit says it (useEngineRoom.js), so a
 * room that was asked for Commander by one sit is told otherwise by the next.
 */
export const gameOf = (formatId) => (formatId === COMMANDER_GAME ? COMMANDER_GAME : 'standard')

/** Whether a format is of the Commander family and yet not dealt as a Commander game. */
export const leaderlessFamily = (formatId) => getFormat(formatId)?.group === 'commander' && formatId !== COMMANDER_GAME

/**
 * The log's one line about the game dealt, once the room has said (`seated.format`,
 * scripts/relay-engine.mjs). `report` is undefined from a relay older than
 * Commander, which deals every deck by the ordinary rules and without its
 * commander; `asked` is the game this deck asked for. Nothing is said of a game
 * nobody asked to be Commander, which is every table before M6.
 */
export function formatLine(report, asked = 'standard') {
  const r = report && typeof report === 'object' && !Array.isArray(report) ? report : null
  if (!r) return asked === COMMANDER_GAME ? 'This relay is older than Commander, so the game is played by the ordinary rules: 20 life each, and no commander dealt.' : null
  if (r.played === COMMANDER_GAME) return 'Played by the Commander rules: 40 life each (903.7), and each commander begins in its owner\'s command zone (903.6).'
  if (r.asked !== COMMANDER_GAME && asked !== COMMANDER_GAME) return null
  if (r.fellBack === 'engine') return 'This relay\'s engine is older than Commander, so the game is played by the ordinary rules: 20 life each, and no commander dealt.'
  if (r.fellBack === 'commander') return 'With no commander to deal there is no Commander game, since every Commander deck has one (903.3), so it is played by the ordinary rules: 20 life each, and no command zone.'
  return 'The game is played by the ordinary rules, not the Commander rules asked for.'
}

/** A count of casts in words: "once", "twice", "3 times". */
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

/**
 * What the commander tax adds to a cast from the command zone, in words, from
 * the offer the engine made (Server.kt, `commanderTax`): its casts from there so
 * far and the generic mana they add. Argentum has already put the tax in the
 * offer's cost; this says why the cost is what it is. Null where there is no tax
 * yet, and where an engine said nothing of it.
 */
export function taxWords(offer) {
  const t = offer?.commanderTax
  if (!t || typeof t !== 'object') return null
  const casts = Number.isInteger(t.casts) && t.casts > 0 ? t.casts : 0
  const generic = Number.isInteger(t.generic) && t.generic > 0 ? t.generic : 0
  if (!casts || !generic) return null
  return `{${generic}} more for the commander tax, as it has been cast from the command zone ${times(casts)} before (903.8)`
}

/** Whether an offer casts a commander from the command zone (Server.kt, `from`). */
export const fromCommand = (offer) => offer?.from === 'command'

/**
 * The rule that asks whether a commander goes to the command zone, by where it
 * is (Server.kt, `commanderZone`): 903.9a for a graveyard or exile, 903.9b for a
 * hand or a library, where Argentum asks the same question. The first is a
 * state-based action on a commander already there, and the second a
 * replacement, so only the second says "instead" (found in M6's review, where
 * the first said it too). Null for anything else, which is a yes or no like any
 * other.
 */
export function commanderZoneRule(zone) {
  if (zone === 'graveyard' || zone === 'exile') return 'A commander put into a graveyard or exile may be put into its owner\'s command zone, a state-based action (903.9a).'
  if (zone === 'hand' || zone === 'library') return 'A commander that would go to its owner\'s hand or library may go to the command zone instead (903.9b).'
  return null
}

/**
 * The commander damage a player has been dealt, read forgivingly off the
 * engine's view (`ClientPlayer.commanderDamage`): each commander that has dealt
 * any, by name, with the amount and the threshold that loses the game. An entry
 * that is not one is dropped. `controller` is Argentum's `controllerId`, the
 * commander's controller now, which may not be its owner; the table reads the
 * owner off the card where it can see it, and falls back to this.
 */
export function commanderDamageOf(player) {
  const list = Array.isArray(player?.commanderDamage) ? player.commanderDamage : []
  return list
    .filter((d) => d && typeof d === 'object' && Number.isInteger(d.amount) && d.amount > 0)
    .map((d) => ({
      commander: typeof d.commanderId === 'string' ? d.commanderId : null,
      name: typeof d.commanderName === 'string' && d.commanderName ? d.commanderName : 'A commander',
      controller: typeof d.controllerId === 'string' ? d.controllerId : null,
      amount: d.amount,
      threshold: Number.isInteger(d.threshold) && d.threshold > 0 ? d.threshold : 21,
    }))
}

/**
 * Commander damage in words, for a plate: "Commander damage: Rhys the Redeemed 3
 * of 21". A player who reaches the threshold from one commander loses (903.10a),
 * which is what the number is counting towards, so each commander's tally is its
 * own. Two commanders of one name — a copy of the person's deck plays theirs, and
 * a commander taken by another player is still its owner's — are told apart by
 * whose each is: `whose(entry)` says so ("your", "the engine's"), the table
 * reading it off the card, or off the controller the engine names where the card
 * is out of sight (found in M6's review, where both read "Rhys the Redeemed"). A
 * name no other entry shares is said alone, as it needs nothing more.
 */
export function damageWords(tally, { whose = null } = {}) {
  const list = Array.isArray(tally) ? tally : []
  if (!list.length) return null
  const shared = (name) => list.filter((d) => d.name === name).length > 1
  const said = list.map((d) => {
    const owner = shared(d.name) && typeof whose === 'function' ? whose(d) : null
    return `${owner ? `${owner} ` : ''}${d.name} ${d.amount} of ${d.threshold}`
  })
  return `Commander damage: ${nameList(said, Infinity)}`
}

/**
 * What 903.10a says the tally counts towards, said once beside it on the plate:
 * the threshold is the engine's, as each entry carries it.
 */
export function damageRule(tally) {
  const list = Array.isArray(tally) ? tally : []
  if (!list.length) return null
  const threshold = list.find((d) => Number.isInteger(d?.threshold) && d.threshold > 0)?.threshold ?? 21
  return `A player dealt ${threshold} combat damage by one commander loses the game (903.10a).`
}

/** What the lobby says a Commander deck is dealt as at the engine's table: the rules, each by its number. */
export const COMMANDER_TABLE = 'A Commander deck is dealt as a Commander game, by Argentum\'s own Commander rules: 40 life each (903.7), each commander in its owner\'s command zone (903.6), {2} more to cast it from there for each time before (903.8), and 21 combat damage from one commander loses the game (903.10a).'

/**
 * What the lobby says about a deck of the Commander family the engine deals no
 * Commander game with (Brawl, Oathbreaker, Duel Commander): what it deals
 * instead, which is what it dealt before M6 — the main deck alone. An
 * Oathbreaker deck's leader is its oathbreaker, and its signature spell is kept
 * apart from the main deck as the commander is (`seatDeck` sends `main`), so
 * neither is dealt, and both are said.
 */
export function leaderlessLine(formatId) {
  const format = getFormat(formatId)
  const name = format?.name ?? formatId
  const left = format?.signatureSpell ? 'its oathbreaker and its signature spell are not dealt' : 'its commander is not dealt'
  return `The engine deals the Commander rules for Commander alone, so ${withArticle(name)} deck is played by the ordinary rules: 20 life, and ${left}.`
}

/**
 * Why a Commander deck's commander cannot lead it against the engine, for the
 * lobby, or null where it can: the engine does not know it, the deck has more
 * than one (the engine deals one commander, as Argentum's `PlayerConfig` does),
 * or it has none.
 */
export function leaderProblem(seat, verdict = null) {
  if (seat?.game !== COMMANDER_GAME) return null
  if (Number.isInteger(seat.leaders) && seat.leaders > 1) return 'partners'
  if (!seat.commander) return seat.commanderUnloaded ? null : 'none'
  if (verdict?.commanderUnknown) return 'unknown'
  return null
}

/** A leader problem in words, for the deck's tile and the gate. */
export function leaderWords(problem, name = null) {
  if (problem === 'unknown') return `It does not know the commander, ${name ?? 'this deck\'s commander'}, and every Commander deck has one (903.3), so it cannot deal a Commander game with this deck.`
  if (problem === 'partners') return 'The engine deals one commander, and this deck has two, so it cannot deal a Commander game with it.'
  if (problem === 'none') return 'This deck has no commander, and every Commander deck has one (903.3), so the engine cannot deal a Commander game with it.'
  return null
}
