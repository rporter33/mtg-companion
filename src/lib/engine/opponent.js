/**
 * What the engine's seat plays, as the lobby offers it and the table says it
 * (HANDOFF.md, M5, and the owner's answer of 2026-09-25): a copy of the
 * player's deck, one of their other decks, or a deck the engine builds for
 * itself — by default only from the sets the player's own deck uses, a fair
 * fight, and with a switch from the whole of its format.
 *
 * The deck of its own is built by Argentum's own deck builder in the engine
 * process (`deckFor` in engine/src/main/kotlin/companion/Server.kt), seeded
 * from the game, and what it built comes back in the room's words
 * (`seated.engineDeck`, scripts/relay-engine.mjs): never its cards, which are
 * as hidden as any opponent's, but its colours, its format and its sets, and
 * any fallback and why. Everything here reads that forgivingly, because any
 * build of the relay may have written it, and says each case as what it is.
 *
 * Shared by the lobby (Seats.jsx, Lobby.jsx) and the table's seat
 * (useEngineRoom.js), so the choice and what is said about it are one thing.
 */
import { FORMATS, getFormat, isBasicLand } from '../formats.js'
import { nameList, withArticle } from './deck.js'
import { gameName, isCommanderGame, leaderProblem } from './commander.js'
import { standInPhrase } from './stand-in.js'

export const OPPONENT_KINDS = ['mirror', 'deck', 'own']

/**
 * A copy of the player's deck until they choose otherwise: what every table
 * against the engine dealt before there was a choice, so a first game plays as
 * it always did. Taken as a default at M5, and the owner's to overturn
 * (HANDOFF.md §3). The pool is the owner's own default: the sets the player's
 * deck uses.
 */
export const DEFAULT_OPPONENT = { kind: 'mirror', deckId: null, pool: 'sets' }

/**
 * The choice kept with the player's table preferences, read forgivingly: a
 * kind this build does not know is the default, a deck id that is not a string
 * is none, and a pool that is not the whole format is the sets.
 */
export function chosenOpponent(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    kind: OPPONENT_KINDS.includes(v.kind) ? v.kind : DEFAULT_OPPONENT.kind,
    deckId: typeof v.deckId === 'string' && v.deckId ? v.deckId : null,
    pool: v.pool === 'format' ? 'format' : 'sets',
  }
}

/**
 * The sets a deck uses, for a deck of the engine's own built "only from the
 * sets your deck uses": the set of each main-deck printing, by Scryfall's code
 * and name, the ones with the most copies first. Basic lands are left out — a
 * deck's Plains from a Commander precon would otherwise add the whole precon to
 * the pool — and so are cards that have not loaded, which have no set to say.
 */
export function setsOf(deck, lookup) {
  const copies = new Map()
  for (const entry of Array.isArray(deck?.main) ? deck.main : []) {
    const card = lookup?.(entry?.cardId)
    const code = typeof card?.set === 'string' && card.set ? card.set.toLowerCase() : null
    if (!code || isBasicLand(card)) continue
    const was = copies.get(code) ?? { code, name: typeof card.set_name === 'string' && card.set_name ? card.set_name : code.toUpperCase(), copies: 0 }
    was.copies += Number.isInteger(entry.quantity) && entry.quantity > 0 ? entry.quantity : 1
    copies.set(code, was)
  }
  return [...copies.values()]
    .sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name))
    .map(({ code, name }) => ({ code, name }))
}

/**
 * The format as the engine is asked for it: Scryfall's word for it, which is
 * what the app's formats call their legality key. A format this build does not
 * know goes by the deck's own id, which the engine will not build to, and says.
 */
export const formatWord = (formatId) => getFormat(formatId)?.legalityKey ?? (typeof formatId === 'string' ? formatId : null)

/**
 * Whether the engine builds a deck of its own for this format: every sixty-card
 * format it has (Server.kt, `BUILDS`), and since M6 Commander, for a Commander
 * game (`COMMANDER_BUILDS`), and since §3 item 20 Brawl, for a Brawl game, by
 * Argentum's own Brawl format. The rest of the Commander family it builds none
 * for: Argentum has no Duel Commander card pool, and no Oathbreaker one.
 */
export const OWN_FAMILY = ['commander', 'brawl']
export const buildsFor = (formatId) => Boolean(getFormat(formatId)) && (getFormat(formatId).group !== 'commander' || OWN_FAMILY.includes(formatId))

/**
 * What the lobby says under the choice of the engine's deck where it builds none
 * of its own for the format, with why where Argentum's want of a card pool is why.
 */
export function noOwnLine(formatId) {
  const name = getFormat(formatId)?.name ?? formatId
  const why = formatId === 'duel' ? ', as Argentum has no Duel Commander card pool to build one from' : ''
  return `The engine builds no ${name} deck of its own${why}, so with ${withArticle(name)} deck it plays a copy of yours.`
}

const COLOUR_NAMES = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }
const WUBRG = ['W', 'U', 'B', 'R', 'G']
/** Each pair of colours in the order it is usually said: the five neighbours round the wheel, then the five across it. */
const PAIRS = ['WU', 'UB', 'BR', 'RG', 'GW', 'WB', 'UR', 'BG', 'RW', 'GU']

/**
 * A deck's colours in words: "mono-red", "red-green", "white, blue and black",
 * or "colourless" for none. Any letter that is not a colour is not read.
 */
export function colourWords(colours) {
  const cs = WUBRG.filter((c) => Array.isArray(colours) && colours.includes(c))
  if (!cs.length) return 'colourless'
  if (cs.length === 1) return `mono-${COLOUR_NAMES[cs[0]]}`
  if (cs.length === 2) {
    const pair = PAIRS.find((p) => p.includes(cs[0]) && p.includes(cs[1]))
    return `${COLOUR_NAMES[pair[0]]}-${COLOUR_NAMES[pair[1]]}`
  }
  return nameList(cs.map((c) => COLOUR_NAMES[c]), Infinity)
}

/** The format by name: the app's where it knows the word, else the engine's, else the word itself. */
function formatName(report) {
  const known = Object.values(FORMATS).find((f) => f.legalityKey === report?.format)
  return known?.name || (typeof report?.formatName === 'string' && report.formatName) || (typeof report?.format === 'string' && report.format) || 'its format'
}

/** Where a deck of its own came from, in words: its sets by name, or the whole of its format. */
function fromWords(report) {
  const sets = Array.isArray(report?.sets) ? report.sets.map((s) => s?.name || s?.code).filter(Boolean) : []
  return report?.from === 'sets' && sets.length ? nameList(sets, Infinity) : `the whole of ${formatName(report)}`
}

/**
 * The engine's commander as a report names it, read forgivingly: its name, and
 * where it stands in for a commander the engine does not know (HANDOFF.md §3
 * item 19, `standsFor`, which the room adds), that it is a stand-in and for
 * which. Null where the report names none.
 */
function ledBy(report) {
  const name = typeof report?.commander === 'string' && report.commander ? report.commander : null
  if (!name) return null
  const real = typeof report.standsFor === 'string' && report.standsFor ? report.standsFor : null
  return real ? standInPhrase({ name, for: real }) : name
}

/**
 * What the engine's seat is said to be playing, in the seat list: once dealt,
 * from the room's report; before that, from what was asked. "The engine, with
 * a deck of its own: red-green from Bloomburrow", the brief's own example.
 */
export function seatWords({ report = null, asked = null, deckName = null } = {}) {
  const played = report ? report.played : asked
  // At a Commander game the engine's commander is face up from the start (903.6), and named;
  // one standing in for a commander the engine does not know is said to be one (§3 item 19).
  const led = ledBy(report) ? `, led by ${ledBy(report)}` : ''
  if (played === 'own') {
    return report?.played === 'own' ? `The engine, with a deck of its own: ${colourWords(report.colours)} from ${fromWords(report)}${led}` : 'The engine, with a deck of its own'
  }
  if (played === 'deck') {
    const name = report?.name ?? deckName
    return name ? `The engine, with your deck ${name}${led}` : `The engine, with one of your decks${led}`
  }
  if (report && report.played == null) return 'The engine, with a deck of its own'
  return `The engine, with a copy of your deck${led}`
}

/**
 * What the sit will send for the engine's seat (M5, M6), from the choice kept,
 * the deck of the player's chosen for it, and the engine's check of that deck
 * (useEngineCheck): `{ kind: 'mirror' }`; `{ kind: 'deck', deckId, name, deck,
 * sideboard?, commander? }` with exactly the names the engine was asked about;
 * or `{ kind: 'own', pool }`. A deck chosen but not sendable — none chosen in
 * this format, a card the engine does not know, a card that has not loaded, a
 * Commander deck with no commander it can deal — goes as the copy, with the
 * reason (`instead`), which the table says. The lobby records it with the table
 * at the sit (Lobby.jsx), and the seat list says it before then (`plannedWords`),
 * so the two cannot disagree.
 */
export function engineDeckRecord({ choice, chosen = null, check = null } = {}) {
  if (choice?.kind === 'own') return { kind: 'own', pool: choice.pool === 'format' ? 'format' : 'sets' }
  if (choice?.kind !== 'deck') return { kind: 'mirror' }
  if (!chosen) return { kind: 'mirror', instead: 'none' }
  const { name } = chosen
  if (!check?.seat || check.seat.unloaded > 0) return { kind: 'mirror', instead: 'unloaded', name }
  if (check.state === 'short') return { kind: 'mirror', instead: 'short', name }
  // A Commander deck goes with its commander (M6); one that has none the engine can deal is not sent.
  if (leaderProblem(check.seat, check)) return { kind: 'mirror', instead: 'leader', name }
  const side = check.seat.sideboard
  const led = check.seat.commander
  return { kind: 'deck', deckId: chosen.id, name, deck: check.seat.deck, ...(side && Object.keys(side).length ? { sideboard: side } : {}), ...(led ? { commander: led } : {}) }
}

/** Why the sit will send the copy, in the seat list's words, by the record's reason. */
const COPY_BECAUSE = {
  short: (name) => `it does not know every card in ${name ?? 'the deck chosen for it'}`,
  unloaded: (name) => `not every card in ${name ?? 'the deck chosen for it'} has loaded`,
  leader: (name) => `${name ?? 'the deck chosen for it'} has no commander it can deal`,
}
const copyBecause = (why) => `The engine, with a copy of your deck: ${why}`
/** A format by the app's name for it, else as it came. */
const nameOfFormat = (formatId) => getFormat(formatId)?.name ?? formatId

/**
 * What the seat list says the engine's seat will play, before anybody sits: what
 * the sit will send (`engineDeckRecord`), not the choice as made. The choice as
 * made was said until M6's review found it saying "a deck of its own" on a Brawl
 * table, where the engine builds none and the sit brings a copy, and "your deck
 * Mystery" for a deck the engine does not know, which the sit sends as the copy.
 * `format` is the lobby's format, and `yours` the engine's check of the deck the
 * player will sit with: a Commander deck with no commander the engine can deal
 * is played by the ordinary rules, where a Commander deck of its own is not
 * built. A deck of theirs still being asked about is said as chosen, since the
 * sit waits for the engine's answer.
 */
export function plannedWords({ choice = null, chosen = null, check = null, format = null, yours = null } = {}) {
  if (choice?.kind === 'own') {
    if (!buildsFor(format)) return copyBecause(`it builds no ${nameOfFormat(format)} deck of its own`)
    // A deck a stand-in can lead (HANDOFF.md §3 item 19) is a Commander game only if one is
    // chosen at the sit, which has not happened yet: both are said, rather than either as settled.
    // A Brawl deck the same, in Brawl's words (§3 item 20).
    const called = gameName(format)
    if (isCommanderGame(format) && leaderProblem(yours?.seat, yours) && yours?.standIns?.length) {
      return `The engine, with a deck of its own if a stand-in leads yours, and a copy of yours if not: it builds ${withArticle(called)} deck of its own only for ${withArticle(called)} game`
    }
    if (isCommanderGame(format) && leaderProblem(yours?.seat, yours)) return copyBecause(`it builds ${withArticle(called)} deck of its own only for ${withArticle(called)} game, and yours has no commander it can deal`)
    return seatWords({ asked: 'own' })
  }
  if (choice?.kind === 'deck' && chosen && check?.state === 'asking') return seatWords({ asked: 'deck', deckName: chosen.name })
  const record = engineDeckRecord({ choice, chosen, check })
  if (record.kind === 'deck') return seatWords({ asked: 'deck', deckName: record.name })
  const why = COPY_BECAUSE[record.instead]?.(record.name)
  return why ? copyBecause(why) : seatWords({ asked: 'mirror' })
}

/**
 * What the seat list says while the engine deals, from what the room was asked
 * (`describe()`'s `engineDeck`, scripts/relay-engine.mjs): a deck of its own asked
 * in a format of the Commander family the engine builds none for is the copy, as
 * it is before the deal. A room older than that says no format, and is said as asked.
 */
export function dealingWords(report) {
  if (report?.asked === 'own' && getFormat(report.format)?.group === 'commander' && !buildsFor(report.format)) return copyBecause(`it builds no ${nameOfFormat(report.format)} deck of its own`)
  return seatWords({ asked: report?.asked, deckName: report?.name })
}

/**
 * The log's one line about the engine's deck, once the deal has said what it
 * plays. `report` is the room's `engineDeck`: undefined from a relay older than
 * the choice, which says nothing at all. `asked` is the kind the player chose,
 * and `sets` the sets their deck uses, for the names of any the engine lacks.
 * `game` is the room's report of the game dealt (`seated.format`), which says
 * why a Commander deck of its own was not built. Each case is said as what it
 * is, and a fallback always says why.
 */
export function engineDeckLine(report, { asked = 'mirror', sets = [], game = null } = {}) {
  if (report === undefined || report === null) {
    return asked && asked !== 'mirror'
      ? 'This relay is older than the choice of the engine\'s deck, so the engine plays a copy of yours.'
      : null
  }
  const format = formatName(report)
  // A Commander deck's commander, said by name: it is face up in the command zone from the start (903.6).
  // One standing in for a commander the engine does not know is said to be one (§3 item 19).
  const led = ledBy(report)
  if (report.played === 'own') {
    const colours = led ? `${colourWords(report.colours)}, led by ${led}` : colourWords(report.colours)
    let line
    if (report.fellBack === 'sets') line = `The engine has none of the sets your deck uses, so it built its deck from the whole of ${format} instead: ${colours}.`
    else if (report.fellBack === 'thin') line = `The sets your deck uses hold too few ${format} cards to build a deck from, so the engine built one from the whole of ${format} instead: ${colours}.`
    else if (report.fellBack) line = `The engine could not build a deck from the sets your deck uses, so it built one from the whole of ${format} instead: ${colours}.`
    else if (led) line = `The engine plays a deck of its own, built by Argentum's deck builder: ${colourWords(report.colours)}, from ${fromWords(report)}, led by ${led}.`
    else line = `The engine plays a deck of its own, built by Argentum's deck builder: ${colours}, from ${fromWords(report)}.`
    const missing = Array.isArray(report.missingSets) ? report.missingSets.filter((c) => typeof c === 'string') : []
    if (missing.length && report.from === 'sets') {
      const names = missing.map((code) => sets.find((s) => s.code === code.toLowerCase())?.name ?? code.toUpperCase())
      line += ` It has no cards from ${nameList(names, Infinity)}, so did not draw on ${missing.length === 1 ? 'it' : 'them'}.`
    }
    return line
  }
  if (report.played === 'mirror') {
    // A copy led by the stand-in that leads the person's deck, said to be one wherever the copy is said.
    const copyLed = report.standsFor && led ? `, led as yours is by ${led}` : ''
    if (report.fellBack === 'engine') return 'This relay\'s engine is older than decks of its own, so it plays a copy of yours.'
    // Another of the person's decks, sent to a Commander game with no commander to lead it (scripts/relay-engine.mjs).
    // In the words of the game dealt, a Brawl or a Duel Commander one since §3 item 20.
    if (report.fellBack === 'commander') return `${report.name ?? 'The deck chosen for the engine'} came with no commander to lead it in ${withArticle(gameName(game?.played))} game, so the engine plays a copy of yours${copyLed}.`
    if (report.fellBack === 'format') {
      if (!report.format) return `The engine was not told which format to build for, so it plays a copy of your deck${copyLed}.`
      // Since protocol 8 the engine builds a Commander deck of its own, but only for a
      // Commander game: at a table dealt by the ordinary rules because a person had no
      // commander to deal (the room's `fellBack: 'commander'`), that is why. An engine
      // older than 8 builds none at all, and the room says so (`fellBack: 'engine'`), as
      // a room older than Commander does by saying nothing; for those, the old words
      // hold (found in M6's review, where they were said at 8 too). Since protocol 10
      // a Brawl deck of its own the same (§3 item 20), for a Brawl game, which a table
      // of more than two or of different games is not either.
      if (buildsFor(report.format) && isCommanderGame(report.format) && game?.played === 'standard' && ['commander', 'players', 'games'].includes(game?.fellBack)) {
        const called = gameName(report.format)
        return `The engine builds ${withArticle(called)} deck of its own only for ${withArticle(called)} game, and this one is played by the ordinary rules, so it plays a copy of yours.`
      }
      // At a Duel Commander table the copy is dealt for a deck of its own, led as the
      // person's is, a stand-in too (found in the review of items 19 and 20).
      return `The engine builds no ${format} deck of its own, so it plays a copy of yours${copyLed}.`
    }
    if (report.fellBack) return `The engine could not build ${withArticle(format)} deck of its own, so it plays a copy of yours${copyLed}.`
    // A copy of a deck led by a stand-in is led by it too, and said to be (§3 item 19).
    if (copyLed) return `The engine plays a copy of your deck${copyLed}.`
    return 'The engine plays a copy of your deck.'
  }
  if (report.played === 'deck') return report.name ? `The engine plays your deck ${report.name}${led ? `, led by ${led}` : ''}.` : 'The engine plays one of your decks.'
  return 'The engine did not say which deck it plays.'
}

/**
 * Why a deck chosen for the engine was not the one sent, said once at the
 * table: none was chosen in this format, the engine does not know every card
 * in it, or some of its cards had not loaded when the player sat down.
 */
export function insteadLine(instead, name) {
  if (instead === 'none') return 'No deck was chosen for the engine in this format, so it plays a copy of yours.'
  if (instead === 'short') return `The engine does not know every card in ${name ?? 'the deck chosen for it'}, so it plays a copy of yours.`
  if (instead === 'unloaded') return `Not every card in ${name ?? 'the deck chosen for it'} had loaded, so the engine plays a copy of yours.`
  if (instead === 'missing') return 'The deck chosen for the engine was not sent from this device\'s lobby, so it plays a copy of yours.'
  if (instead === 'leader') return `${name ?? 'The deck chosen for the engine'} has no commander the engine can deal, so it plays a copy of yours.`
  return null
}
