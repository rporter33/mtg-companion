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
 * Since §3 item 20 (the owner's decision of 2026-09-25), Duel Commander and
 * Brawl are dealt as Commander games too, each at its own life total and for two
 * players (Server.kt, `GAME_FORMATS`), and `GAMES` below holds what each is dealt
 * as and where each number comes from. Duel Commander is not in the Comprehensive
 * Rules: its numbers are its own rules committee's, cited as its rules by their
 * own numbers. Brawl's are the Comprehensive Rules' 903.12, but for two of them,
 * which the table does not follow and says so: its first mulligan is not free
 * (903.12g), since Argentum makes a first mulligan free only at a table of more
 * than two, and a Brawl deck here holds a hundred cards, as Scryfall's Brawl and
 * the app's own format do, where 903.12d's holds sixty. Oathbreaker is still dealt
 * as every deck of the family went before M6: its library by the ordinary rules,
 * and without its oathbreaker, which the lobby says.
 *
 * Pure, and forgiving: everything here reads what the wire or storage gave it,
 * any build of the relay or the engine having written it, and says a case it
 * cannot read as that rather than throwing.
 */
import { getFormat } from '../formats.js'
import { nameList, withArticle } from './deck.js'

/** The format of the Commander family the engine has dealt by its own rules since M6. */
export const COMMANDER_GAME = 'commander'

/**
 * Every game of the Commander family the engine deals as a Commander game, by the
 * word the sit, the room and the engine all use, which is the app's own format id.
 */
export const COMMANDER_GAMES = ['commander', 'duel', 'brawl']

/** Whether a format, or a room's word for a game, is one the engine deals as a Commander game. */
export const isCommanderGame = (word) => COMMANDER_GAMES.includes(word)

/**
 * What each Commander game is dealt as, each number with where it comes from:
 * `life` and `damage` (the commander damage that loses the game, null where none
 * does) are what Server.kt asks Argentum for, and `size` what a deck of the game
 * holds here. Each `…Rule` is the citation said beside its number: a number of the
 * Comprehensive Rules alone, or for Duel Commander, which they do not hold, its
 * own rules and number. `players` is the table it is dealt at: any for Commander,
 * two for the others, and `playersLine` why, for a table of more.
 *
 * And the rules of the commander itself: `hasRule`, that every deck of the game
 * has one; `leaderRule`, what one may be; `identityRule`, that its colour identity
 * holds every card in the deck. Commander's are 903.3, 903.4 and 903.5c, and
 * Brawl's the same, 903.12a keeping the Commander rules but where it says
 * otherwise. Duel Commander's committee has its own numbers for them — 402.1b, a
 * deck of a hundred "one of them being the Commander"; 403.1a, a commander chosen
 * by 903.3 "and the rules that follow"; 103.4b, colour identity as Commander has
 * it — and cites the Comprehensive Rules' from them, so both are said, the
 * committee's first (found in the review of item 20, where 903.3 alone was said
 * of Duel Commander, against item 23's default).
 */
const COMMANDER_LEADER = { hasRule: '903.3', leaderRule: '903.3', identityRule: '903.4, 903.5c' }
export const GAMES = {
  commander: { name: 'Commander', life: 40, lifeRule: '903.7', damage: 21, damageRule: '903.10a', size: 100, sizeRule: '903.5a', players: null, ...COMMANDER_LEADER },
  duel: {
    name: 'Duel Commander', life: 20, lifeRule: 'Duel Commander rules, 300.1a', damage: null, damageRule: 'Duel Commander rules, 506.1a', size: 100, sizeRule: 'Duel Commander rules, 402.1b', players: 2, playersLine: 'Duel Commander is for two (Duel Commander rules, 205.1a)',
    hasRule: 'Duel Commander rules, 402.1b', leaderRule: 'Duel Commander rules, 403.1a, which defers to 903.3', identityRule: 'Duel Commander rules, 103.4b and 403.1a, which defer to 903.4 and 903.5c',
  },
  brawl: { name: 'Brawl', life: 25, lifeRule: '903.12f', damage: null, damageRule: '903.12h', size: 100, sizeRule: null, players: 2, playersLine: 'the engine deals Brawl only to two, at 25 life each (903.12f; more begin at 30)', ...COMMANDER_LEADER },
}

/** A Commander game's rules by its word, Commander's for anything else, as every such line before item 20 said. */
export const gameRules = (word) => GAMES[word] ?? GAMES.commander

/**
 * The one rule of Brawl's own the engine does not deal, said where a Brawl game
 * is dealt and before it: Argentum's mulligan makes a first one free only at a
 * table of more than two, and a Brawl game here is two players.
 */
export const BRAWL_MULLIGAN = 'Brawl\'s first mulligan is free (903.12g), and not here: the engine makes a first mulligan free only at a table of more than two, so each counts.'

/** A Commander game by name: "Brawl", "Duel Commander"; Commander for anything else, as every such line before item 20 said. */
export const gameName = (word) => gameRules(word).name

/**
 * The game a deck asks the engine for: a Commander game for a deck of a format
 * the engine deals as one, and the ordinary rules for every other. Every sit says
 * it (useEngineRoom.js), so a room that was asked for Commander by one sit is told
 * otherwise by the next.
 */
export const gameOf = (formatId) => (isCommanderGame(formatId) ? formatId : 'standard')

/** Whether a format is of the Commander family and yet not dealt as a Commander game: Oathbreaker, since item 20. */
export const leaderlessFamily = (formatId) => getFormat(formatId)?.group === 'commander' && !isCommanderGame(formatId)

/**
 * The life total a game was dealt at, in words with its rule: the engine's own
 * number where the room passed it on (`rules.life`, protocol 10), cited only where
 * it is the rule's; the rule's number where nothing was passed on, as every engine
 * before protocol 10 dealt Commander at 40.
 */
function lifeWords(game, rules) {
  const life = Number.isInteger(rules?.life) && rules.life > 0 ? rules.life : game.life
  return life === game.life ? `${life} life each (${game.lifeRule})` : `${life} life each, as the engine dealt it`
}

/**
 * The log's one line about the game dealt, once the room has said (`seated.format`,
 * scripts/relay-engine.mjs). `report` is undefined from a relay older than
 * Commander, which deals every deck by the ordinary rules and without its
 * commander; `asked` is the game this deck asked for. Nothing is said of a game
 * nobody asked to be a Commander game, which is every table before M6.
 *
 * A Duel Commander or Brawl game says its own numbers, and that commander damage
 * loses it nobody (§3 item 20). One asked of a relay from before item 20, which
 * reads either word as none and deals the ordinary game, is said as that.
 */
export function formatLine(report, asked = 'standard') {
  const r = report && typeof report === 'object' && !Array.isArray(report) ? report : null
  const wanted = isCommanderGame(asked) ? asked : isCommanderGame(r?.asked) ? r.asked : null
  const name = gameName(wanted)
  const ordinary = 'played by the ordinary rules: 20 life each, and no commander dealt.'
  if (!r) return wanted === COMMANDER_GAME ? 'This relay is older than Commander, so the game is played by the ordinary rules: 20 life each, and no commander dealt.' : wanted ? `This relay is older than ${name} at the engine's table, so the game is ${ordinary}` : null
  if (r.played === COMMANDER_GAME) return `Played by the Commander rules: ${lifeWords(GAMES.commander, r.rules)}, and each commander begins in its owner's command zone (903.6).`
  if (isCommanderGame(r.played)) {
    const game = GAMES[r.played]
    const said = `Played by the ${game.name} rules, for two: ${lifeWords(game, r.rules)}, each commander begins in its owner's command zone (903.6), and commander damage loses nobody the game (${game.damageRule}).`
    return r.played === 'brawl' ? `${said} ${BRAWL_MULLIGAN}` : said
  }
  if (!wanted) return null
  // Asked of a relay from before item 20, which read the word as no game at all: one
  // since then says the game of the family somebody at the table asked for.
  if (asked !== COMMANDER_GAME && isCommanderGame(asked) && !isCommanderGame(r.asked)) return `This relay deals no ${name} game, so it is ${ordinary}`
  if (r.fellBack === 'engine') return wanted === COMMANDER_GAME ? 'This relay\'s engine is older than Commander, so the game is played by the ordinary rules: 20 life each, and no commander dealt.' : `This relay's engine deals no ${name} game, so it is ${ordinary}`
  if (r.fellBack === 'players') return `This table has more than two players, and ${GAMES[wanted]?.playersLine ?? `the engine deals ${name} only to two`}, so it is ${ordinary}`
  if (r.fellBack === 'games') return `The decks at this table ask for different games of the Commander family, so it is ${ordinary}`
  if (r.fellBack === 'commander') return `With no commander to deal there is no ${name} game, since every ${name} deck has one (${gameRules(wanted).hasRule}), so it is played by the ordinary rules: 20 life each, and no command zone.`
  return `The game is played by the ordinary rules, not the ${name} rules asked for.`
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

/**
 * Whether commander damage can lose the game dealt, from the room's report of it
 * (`seated.format`): not in Duel Commander or Brawl, whose rules have no such loss
 * (§3 item 20), nor wherever the engine said none does (`rules.commanderDamage:
 * null`, protocol 10). Argentum still keeps the tally in such a game, its threshold
 * past reach (Server.kt, `NO_COMMANDER_DAMAGE_LOSS`), and the plate says nothing of
 * it, since it counts towards nothing. A report that says nothing — a game not yet
 * dealt, a relay from before Commander — is read as every Commander game before
 * item 20 was, where it could.
 */
export function damageLoses(report) {
  const r = report && typeof report === 'object' && !Array.isArray(report) ? report : null
  if (r?.rules && typeof r.rules === 'object' && r.rules.commanderDamage === null) return false
  return !(r?.played === 'duel' || r?.played === 'brawl')
}

/** What the lobby says a Commander deck is dealt as at the engine's table: the rules, each by its number. */
export const COMMANDER_TABLE = 'A Commander deck is dealt as a Commander game, by Argentum\'s own Commander rules: 40 life each (903.7), each commander in its owner\'s command zone (903.6), {2} more to cast it from there for each time before (903.8), and 21 combat damage from one commander loses the game (903.10a).'

/**
 * What the lobby says a deck of a Commander game is dealt as at the engine's
 * table, before anybody sits (§3 item 20): the rules, each by its number, and
 * where the table does not follow the game's own, that too. Null for a format the
 * engine deals no Commander game in.
 */
export function tableLine(formatId) {
  if (formatId === COMMANDER_GAME) return COMMANDER_TABLE
  const zone = 'each commander in its owner\'s command zone (903.6), {2} more to cast it from there for each time before (903.8)'
  if (formatId === 'duel') return `A Duel Commander deck is dealt as a Commander game for two, by Argentum's own Commander rules at Duel Commander's numbers, which are its rules committee's and not in the Comprehensive Rules: 20 life each (Duel Commander rules, 300.1a), ${zone}, and commander damage loses nobody the game (Duel Commander rules, 506.1a).`
  if (formatId === 'brawl') return `A Brawl deck is dealt as a Commander game for two, by Argentum's own Commander rules at Brawl's numbers: 25 life each (903.12f), ${zone}, and commander damage loses nobody the game (903.12h). ${BRAWL_MULLIGAN} And a Brawl deck here holds a hundred cards, as Scryfall's Brawl does, where the Comprehensive Rules' Brawl holds sixty (903.12d).`
  return null
}

/**
 * What the lobby says about a deck of the Commander family the engine deals no
 * Commander game with — Oathbreaker, since item 20 —: what it deals instead,
 * which is what it dealt before M6, the main deck alone. An Oathbreaker deck's
 * leader is its oathbreaker, and its signature spell is kept apart from the main
 * deck as the commander is (`seatDeck` sends `main`), so neither is dealt, and
 * both are said.
 */
export function leaderlessLine(formatId) {
  const format = getFormat(formatId)
  const name = format?.name ?? formatId
  const left = format?.signatureSpell ? 'its oathbreaker and its signature spell are not dealt' : 'its commander is not dealt'
  return `The engine deals Commander, Duel Commander and Brawl as Commander games, and not ${name}, so ${withArticle(name)} deck is played by the ordinary rules: 20 life, and ${left}.`
}

/**
 * Why a Commander deck's commander cannot lead it against the engine, for the
 * lobby, or null where it can: the engine does not know it, the deck has more
 * than one (the engine deals one commander, as Argentum's `PlayerConfig` does),
 * or it has none. A deck of any Commander game (§3 item 20).
 */
export function leaderProblem(seat, verdict = null) {
  if (!isCommanderGame(seat?.game)) return null
  if (Number.isInteger(seat.leaders) && seat.leaders > 1) return 'partners'
  if (!seat.commander) return seat.commanderUnloaded ? null : 'none'
  if (verdict?.commanderUnknown) return 'unknown'
  return null
}

/** A leader problem in words, for the deck's tile and the gate, in the words of the game the deck asks for. */
export function leaderWords(problem, name = null, game = COMMANDER_GAME) {
  const { name: called, hasRule } = gameRules(game)
  if (problem === 'unknown') return `It does not know the commander, ${name ?? 'this deck\'s commander'}, and every ${called} deck has one (${hasRule}), so it cannot deal ${withArticle(called)} game with this deck.`
  if (problem === 'partners') return `The engine deals one commander, and this deck has two, so it cannot deal ${withArticle(called)} game with it.`
  if (problem === 'none') return `This deck has no commander, and every ${called} deck has one (${hasRule}), so the engine cannot deal ${withArticle(called)} game with it.`
  return null
}
