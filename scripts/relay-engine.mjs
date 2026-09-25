/**
 * A rules-enforced room: the relay's other authority.
 *
 * An unenforced room is a table the relay holds (`relay-server.mjs`). An
 * enforced room is a table the engine holds: one engine process per room
 * (engine/README.md), started the moment every human seat has sat down with
 * a deck, and spoken to through `engine-bridge.mjs`. The browser talks to
 * both kinds of room over the same socket; what differs is the messages,
 * all of them `{ t: 'engine', op }` here, and who decides. Nothing in this
 * file knows a rule of Magic either — it knows whose turn the engine says
 * it is, and forwards.
 *
 *   from a client        sit { name, deck: { "Mountain": 14, … }, sideboard?: { … }, seat?, deltas?, level?, answers?, mulligans?, engineDeck?, format?, commander? }
 *                        act { stop, index, attackers?, blockers?, targets?, x?, damage?, cost?, auto?, cards? }
 *                        decide { stop, … }        turn                    resync
 *   to every client      seats [ … ]               status { … }            gone { reason }
 *                        restoring { reason }      restored { reason, behind, lost?, at }
 *   to one client        seated { seat, engineSeat, sideboardLeftOut, unknownPrintings, level?, ai?, choices?, engineDeck?, format? }
 *                        view { you, seq, state | delta, log }             refused { error, stale?, answering?, restoring? }
 *
 * `stop` is the number of the status a client is answering: an act sent
 * against a stale status is refused rather than landing on a different
 * offer with the same index.
 *
 * A view carries a `seq` of its own, counted per seat: the first view a seat
 * is sent is the whole `state`, and every later one may be a `delta` against
 * the one before it, with only the log lines added since. A client that sees
 * a gap in the numbers asks for `resync` and is sent a whole state again,
 * rather than draw a board built on a delta it never had. Deltas are sent
 * only to a client that said in its `sit` that it can apply them, and only by
 * a room whose engine speaks protocol 3: a tab left open across a deploy, or
 * an older engine, is served whole views as before.
 *
 * Watching the engine's turn is the room's job too (HANDOFF.md, M2). The
 * engine is dealt a paced table, which stops as soon as its own seat has made
 * a play worth watching; the room publishes that stop to every seat, waits
 * its pace, asks for the next step, and repeats until a player is to act or
 * the game ends. The engine never sleeps — one process serves one table over
 * one line — so all the waiting in wall-clock time is here.
 *
 * How strongly the engine plays is a room setting too (HANDOFF.md, M3): one of
 * the levels in `src/lib/engine/levels.js`, given when the room is opened
 * (`POST /rooms { level }`) and changed by a sit that names one, until the
 * deal. The room asks the engine for it only where the engine has levels
 * (protocol 4), and believes the engine's reply as to whether it was taken:
 * every `seated` after the deal says `level`, the level the engine is playing
 * at, or null where it plays its one way, and `ai`, the kind of player the
 * engine fields here, since only a heuristic one has levels to play at. A room
 * nobody asked a level of asks the engine for none, which is how a tab from
 * before levels plays as it did.
 *
 * What a person may choose is the engine's to say and the client's to show
 * (HANDOFF.md, M4). An engine at protocol 5 says in its `hello` what its `act`
 * takes beyond an index — targets, an X, a division of damage, what a cost
 * takes — and which decisions it can put to a person. A client says in its sit
 * which decisions it can show (`answers`), and the room passes that to the
 * deal for that seat alone; the engine answers the rest for them, as it always
 * has. Every `seated` after the deal then says `choices`: what that seat's
 * `act` may carry and which decisions it will be asked. A client told nothing —
 * by an older relay, or of an older engine — keeps holding back what it cannot
 * send, which is how nobody is shown a choice that would be dropped on the way.
 *
 * The status goes to every seat, and a decision can carry the faces of cards
 * only the deciding seat may see — the top of its library, looked at. Every
 * other seat's copy leaves those out.
 *
 * The opening hands are the players' to keep (HANDOFF.md, M4, and the owner's
 * "mulligans on", §3 item 3). A client says in its sit that it can show a
 * mulligan (`mulligans: true`), and where every person at the table has said
 * so and the engine speaks protocol 6, the room deals with Argentum's own
 * mulligan phase: the first statuses offer keeping, a mulligan, and then the
 * cards to put on the bottom, which the room forwards as it forwards any act.
 * Anywhere else every hand is kept, as it always was, so a tab from before
 * mulligans is never offered one it cannot take.
 *
 * What the engine's seat plays is the person's to choose (HANDOFF.md, M5, and
 * the owner's answer of 2026-09-25): a copy of their deck, as every room has
 * dealt; one of their other decks, whose names the sit brings; or a deck the
 * engine builds itself, by default from the sets the person's own deck uses,
 * or from the whole of its format. The sit says which (`engineDeck`), and the
 * room keeps it until the deal, as it keeps the deck. A copy and another deck
 * are sent as names, which every engine reads; a deck of its own is asked only
 * of an engine that builds one (protocol 7), and an older one is dealt the copy
 * instead and the room says why. Every `seated` after the deal says what the
 * engine's seat plays (`engineDeck`) — its colours, and for a deck of its own
 * the format and the sets, and any fallback and why — but never its cards: the
 * engine's deck is as hidden as any opponent's.
 *
 * A game may be Commander (HANDOFF.md, M6). A sit with a Commander deck says so
 * (`format: 'commander'`) and brings its commander (`commander`, a name and the
 * printing chosen, as a deck line names one); the room keeps both until the
 * deal, as it keeps the deck, and asks the engine for a Commander game where the
 * engine deals one (protocol 8) and every person at the table has brought a
 * commander. The engine's seat is then dealt one too: the person's, with a copy
 * of their deck; the one that came with another of their decks; or one its own
 * deck builder chose. Anywhere else the decks are dealt as every room before
 * dealt them, by the ordinary rules and without the commanders, and every
 * `seated` after the deal says which game it was and why (`format`). A commander
 * is no secret, since it begins the game face up in the command zone (CR 903.6),
 * so what the engine's seat plays says its commander by name.
 *
 * A game outlives its relay and its engine (HANDOFF.md, M7). After every stop
 * the room asks an engine that can keep a game (protocol 9) for a snapshot, and
 * holds the latest with the number of the stop it was taken at; the relay writes
 * it to disk beside the room (`record`), with any move still being answered. A
 * relay that comes back reads the room back and starts an engine for it at once
 * (`comeBack`), which takes the game back (`restore`) at the stop it was kept
 * at; an engine that stops mid-game is started again the same way. Meanwhile a
 * seat is told the table is coming back (`restoring`), nothing it presses is
 * sent, and once it is back each person is told what came back (`restored`):
 * which of the two restarted, whether the table is a stop or more behind what
 * they last saw, and to the person whose move was still being answered, that it
 * did not happen. A game that cannot come back — an engine too old to keep one,
 * a text it cannot read, or a restart that finds the same crash waiting — is
 * said to have gone, and why, never left to look like a table that froze.
 *
 * What the room decides of itself is written down with it (M7's review): a game
 * that ended, which comes back only when somebody sits down to look at it, and a
 * game the room ended for good — the same crash waiting, a turn the engine would
 * not take — which a relay that restarts does not start again. A game that could
 * not be taken back is tried again by the next relay, whose engine may be able to,
 * and says so. The stop a room publishes is on disk before anybody is sent it, as
 * is a move being answered, so a relay that dies however it dies comes back no
 * further on than what people saw, and says how far behind it is.
 */
import { startEngine } from './engine-bridge.mjs'
import { levelOf } from '../src/lib/engine/levels.js'

export const OP = {
  sit: 'sit', act: 'act', decide: 'decide', turn: 'turn', resync: 'resync',
  seated: 'seated', seats: 'seats', status: 'status', view: 'view', refused: 'refused', gone: 'gone',
  restoring: 'restoring', restored: 'restored',
}

/**
 * What a seat is told a press cannot do while the game is coming back. The
 * client clears its offers when it hears `restoring`, so this is for a press
 * that crossed that message on the wire.
 */
export const RESTORING = 'The table is coming back; nothing can be played until it is.'

/**
 * Said after why a game could not be taken back: it is not written down as
 * ended, so the next relay to start tries again (M7's review), and a person
 * reading the reason in the lobby should know that it is worth coming back.
 */
export const TRIED_AGAIN = 'The relay tries again each time it restarts.'

// How long an engine's first answer may take. It loads the whole card corpus
// before it reads a line, which is far slower than any answer after it. An
// allowance rather than a measurement: engine/README.md has the measured load,
// and this is revisited against it.
export const STARTUP_MS = 120_000

/**
 * How long one of the engine's plays is left standing before the room asks for
 * the next. Moxgate's table plays the opponent's turn at a pace rather than in
 * one jump, and 600 ms is where this one starts (HANDOFF.md, M2). It is the
 * room's setting rather than a constant in the loop, so the playback-speed
 * preset of TARGET.md §5 — Relaxed, Brisk, Instant — has somewhere to land.
 */
export const PACE_MS = 600

/** The protocol that first had a pace, a `continue` and a log inside a delta. */
const PACED_PROTOCOL = 3
/** The protocol that first had levels, and said in its reply which one each seat took. */
const LEVELLED_PROTOCOL = 4
/** The protocol whose `act` first carried what a person chose, and which could ask more decisions. */
const CHOOSING_PROTOCOL = 5
/** The protocol that first dealt a mulligan phase when asked, and said in its reply that it had. */
const MULLIGAN_PROTOCOL = 6
/** The protocol that first built a deck of the engine's own, and said what its seat plays. */
const DECKS_PROTOCOL = 7
/** The protocol that first dealt a Commander game, commanders and all. */
const COMMANDER_PROTOCOL = 8
/** The protocol that first kept a game (`snapshot`) and took one back (`restore`). */
const KEEPING_PROTOCOL = 9

/** A list of short words from the wire, read forgivingly: anything else in it is dropped. */
const words = (list, most = 32) => (Array.isArray(list) ? list.filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 40).slice(0, most) : [])
/** One short word from the wire, or null. */
const word = (w) => (typeof w === 'string' && w.length > 0 && w.length <= 40 ? w : null)
/** A line of text from the wire, cut to a length a screen can hold, or null. */
const text = (t, most = 200) => (typeof t === 'string' && t.trim() ? t.trim().slice(0, most) : null)
/** A deck as the wire sends one: names to lines. */
const isDeck = (d) => Boolean(d) && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length > 0

/** What the engine's seat may be asked to play, in the sit's words. */
const ENGINE_DECKS = ['mirror', 'deck', 'own']

/**
 * A commander as a sit brings one (M6), read forgivingly: its name, and the
 * printing chosen for it by Scryfall's set and collector number, as a deck line
 * names one — or a bare name. Anything else is no commander, and a Commander
 * game is not asked for with none.
 */
const commanderOf = (v) => {
  const name = typeof v === 'string' ? text(v, 200) : text(v?.name, 200)
  if (!name) return null
  const set = typeof v === 'object' ? word(v?.set) : null
  const number = typeof v === 'object' ? word(v?.number) : null
  return { name, ...(set && number ? { set, number } : {}) }
}

/** The game a sit asks for, read forgivingly: Commander, or the ordinary rules every room has dealt. */
const formatOf = (v) => (v === 'commander' ? 'commander' : v === 'standard' ? 'standard' : null)

/**
 * What a sit asked the engine's seat to play (M5), read forgivingly: a copy
 * of the person's deck; one of their decks, by its names, with its own name
 * to say it by; or a deck of the engine's own, to the format given and from
 * the sets given — a list, even an empty one, asks for those sets, and none
 * asks for the whole format. Anything this room cannot read is no ask at all,
 * and the engine's seat plays the copy every room has always dealt.
 */
const engineDeckOf = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  if (v.kind === 'mirror') return { kind: 'mirror' }
  if (v.kind === 'deck' && isDeck(v.deck)) return { kind: 'deck', name: text(v.name, 80), deck: v.deck, sideboard: isDeck(v.sideboard) ? v.sideboard : null, commander: commanderOf(v.commander) }
  if (v.kind === 'own') return { kind: 'own', format: word(v.format), sets: Array.isArray(v.sets) ? words(v.sets, 64) : null }
  return null
}

/**
 * What an engine said its seat plays (`deck` on its seat in the reply to
 * `new`, protocol 7), read forgivingly and kept to what a client may be told:
 * how many cards and what colours, and for a deck of its own the format, the
 * sets it was built from and any fallback — never a card of it, but for its
 * commander at a Commander table, which is face up in the command zone from the
 * start (protocol 8).
 */
const COLOURS = ['W', 'U', 'B', 'R', 'G']
const reportOf = (d) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  const sets = Array.isArray(d.sets) ? d.sets.filter((s) => word(s?.code)).slice(0, 64).map((s) => ({ code: s.code, name: text(s.name, 80) ?? s.code })) : []
  return {
    asked: ENGINE_DECKS.includes(d.asked) ? d.asked : null,
    played: ENGINE_DECKS.includes(d.played) ? d.played : null,
    ...(Number.isInteger(d.cards) && d.cards >= 0 ? { cards: d.cards } : {}),
    colours: Array.isArray(d.colours) ? COLOURS.filter((c) => d.colours.includes(c)) : [],
    ...(word(d.format) ? { format: d.format } : {}),
    ...(text(d.formatName, 40) ? { formatName: text(d.formatName, 40) } : {}),
    ...(d.from === 'sets' || d.from === 'format' ? { from: d.from } : {}),
    ...(sets.length ? { sets } : {}),
    ...(words(d.missingSets, 64).length ? { missingSets: words(d.missingSets, 64) } : {}),
    ...(word(d.fellBack) ? { fellBack: d.fellBack } : {}),
    ...(text(d.why) ? { why: text(d.why) } : {}),
    ...(text(d.commander, 200) ? { commander: text(d.commander, 200) } : {}),
  }
}

/**
 * What an engine said a person may choose (its `hello`'s `choices`), kept as
 * the room passes it on. Read forgivingly: an engine that said nothing, or
 * something unreadable, offers nothing to choose.
 */
const choicesOf = (hello) => {
  const c = hello?.choices
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  return { act: words(c.act), costs: words(c.costs) }
}

/**
 * The status as one seat may see it. A decision is put to one seat, and the
 * faces it carries of cards in a hidden zone (`decision.cards`) are that
 * seat's alone: every other seat is sent the question without them.
 */
const statusFor = (status, seat) => {
  const d = status?.decision
  if (!d?.cards || status.actor === seat?.engineSeat) return status
  const { cards, ...rest } = d
  return { ...status, decision: rest }
}

// A deck line is a count, or a printing with a count, or a list of those.
const copiesOf = (v) => {
  if (Array.isArray(v)) return v.reduce((sum, x) => sum + copiesOf(x), 0)
  const n = typeof v === 'number' ? v : v?.count
  return Number.isInteger(n) && n > 0 ? n : 0
}
// An engine at protocol 1 reads a deck line only as a count, so it is sent only
// counts: the printings are lost, but the game is dealt rather than refused.
const forProtocol = (protocol, lines) => (!lines || protocol >= 2 ? lines : Object.fromEntries(Object.entries(lines).map(([name, v]) => [name, copiesOf(v)])))

/**
 * Another's sentence as a clause after the room's own words ("…could not come
 * back: that snapshot could not be read"): its first letter lowered, nothing
 * else changed. Most reasons are sentences of this repo's own, or the bridge's,
 * but one the engine did not expect it answers as the name of what was thrown
 * ("IllegalStateException: …", Server.kt), and a name keeps its capital (found
 * in M7's review, where one came out as "illegalStateException"): a first word
 * with a capital after its first letter is a name, and is left as it is.
 */
export const clause = (m) => {
  if (typeof m !== 'string' || !m) return 'no reason was given.'
  const first = m.match(/^\S+/)?.[0] ?? ''
  return /[A-Z]/.test(first.slice(1)) ? m : m[0].toLowerCase() + m.slice(1)
}

/** A reason ended as a sentence, so another can follow it: an engine's own words may stop short of a full stop. */
const ended = (s) => (/[.!?]$/.test(s) ? s : `${s}.`)

/** A whole number from storage at or above a floor, or the fallback. */
const count = (n, fallback = 0) => (Number.isInteger(n) && n >= 0 ? n : fallback)

/**
 * A room as the relay kept it (`record`), read back forgivingly: it was written
 * by whatever build was running, and a file on a disk can hold anything. What
 * cannot be made sense of is dropped, and what is missing is taken as a room
 * that never dealt — so the worst a strange record does is bring back a table
 * waiting for its seats, or one that says its game could not come back, never a
 * thrown error. The kept game itself is the engine's text, passed back to it
 * untouched: its random number generator is a number JavaScript cannot hold.
 *
 * `over` is a game that ended, and `gone` why a game the room ended for good
 * went (M7's review): a record from before either has neither, and is read as a
 * game that was still being played, as it was then.
 */
export function savedRoomOf(v) {
  const r = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  const kept = r.kept && typeof r.kept === 'object' && typeof r.kept.text === 'string' && r.kept.text ? { text: r.kept.text, stop: count(r.kept.stop) } : null
  const seated = (Array.isArray(r.seated) ? r.seated : []).filter((s) => s && typeof s === 'object' && word(s.seat)).map((s) => ({
    seat: s.seat, name: text(s.name, 80), engineSeat: word(s.engineSeat),
    sideboardLeftOut: words(s.sideboardLeftOut, 200), unknownPrintings: words(s.unknownPrintings, 200),
    asked: Array.isArray(s.asked) ? words(s.asked) : null, seq: count(s.seq),
  }))
  const inFlight = r.inFlight && typeof r.inFlight === 'object' && word(r.inFlight.seat) && ['act', 'decide'].includes(r.inFlight.op) ? { seat: r.inFlight.seat, op: r.inFlight.op } : null
  const format = r.format && typeof r.format === 'object' && ['commander', 'standard'].includes(r.format.played)
    ? { asked: r.format.asked === 'commander' ? 'commander' : 'standard', played: r.format.played, ...(word(r.format.fellBack) ? { fellBack: r.format.fellBack } : {}) }
    : null
  const deck = reportOf(r.engineDeck)
  return {
    dealt: r.dealt === true, stop: count(r.stop), kept, inFlight, seated,
    level: levelOf(r.level), played: levelOf(r.played), profile: text(r.profile, 80),
    paced: r.paced === true, mulliganed: r.mulliganed === true,
    choices: choicesOf({ choices: r.choices }),
    engineDeck: deck ? { ...deck, ...(text(r.engineDeck?.name, 80) ? { name: text(r.engineDeck.name, 80) } : {}) } : null,
    format,
    unkept: text(r.unkept),
    over: r.over === true,
    gone: text(r.gone, 1000),
  }
}

export function createEngineRoom({ code, seats: seatCount, ai = 'heuristic', level: askedLevel = null, engineCommand, seed = null, deliver, onStderr = null, paceMs = PACE_MS, wait = null, saved = null, onChange = null }) {
  const humanSeats = Math.max(1, ai ? seatCount - 1 : seatCount)
  const seats = Array.from({ length: seatCount }, (_, i) => ({
    seat: `p${i + 1}`, name: null, here: false, ready: false, socket: null, deck: null, sideboard: null, commander: null, format: 'standard',
    ai: ai && i === seatCount - 1 ? ai : null, engineSeat: null, sideboardLeftOut: [], unknownPrintings: [],
    // What this seat has been sent: the number of its last view, whether it
    // has had a whole state since it last connected, and whether the client
    // there said it can apply a delta.
    seq: 0, whole: false, deltas: false,
    // The decisions the client at this seat said it can show, passed to the
    // deal; and, after it, the ones the engine said it will ask this seat.
    answers: [], asked: null,
    // Whether the client at this seat said it can show a mulligan, until the deal.
    mulligans: false,
    // What this seat is still to be told of a game that came back (`restored`),
    // until a socket of theirs has heard it: a person away while the relay
    // restarted comes back to a table that says what happened. `said` is the
    // message, and `to` the socket it was last said to. Said to a socket that
    // has not spoken since, it may not have been heard — one left open by a
    // phone that changed networks stays open until the heartbeat finds it
    // (found in M7's review) — so it is kept until that socket speaks, or the
    // person sits again and is told it on a socket that just has.
    untold: null,
  }))
  // The level the room was asked for, until the deal; a word this build does
  // not know is no level. After the deal, `played` is the engine's own word
  // for what its seat is playing at, or null where it took none.
  let level = levelOf(askedLevel)
  let played = null
  let profile = null
  // What the engine's seat was asked to play, until the deal: the last sit to
  // say, as with the level. After it, `dealtDeck` is what it plays, in the
  // engine's words where it said them and the room's where it could not.
  let wantedDeck = null
  let dealtDeck = null
  // The game asked for, until the deal: Commander where a person sitting with a
  // deck asked for it, and the ordinary rules every room has dealt otherwise.
  // Read from the seats rather than kept from the last sit to say, because the
  // game belongs to the deck it came with (found in M6's review: a person who
  // sat again with a sixty-card deck left an earlier Commander request standing).
  // After the deal, `dealtFormat` is which game it was, and why where it was not
  // the one asked for.
  const wantedFormat = () => (seats.some((s) => !s.ai && s.deck && s.format === 'commander') ? 'commander' : 'standard')
  let dealtFormat = null
  // The level is said only once there is a deal to have taken it: before that,
  // a seated carries no `level`, rather than one the engine may yet refuse.
  // With it goes the kind of player the engine fields here, `ai` — heuristic,
  // random, or null for none — because only the first has levels, and a null
  // `level` means "plays one way" only where it could have had one.
  //
  // And what the person in the seat may choose, once the engine has said: what
  // their `act` may carry and which decisions they will be asked. Said only
  // where an engine said it, so a client told nothing holds back what it
  // cannot send, as it did before there was anything to choose.
  //
  // And what the engine's seat plays, once dealt, where there is one; and the
  // game that was dealt, Commander or the ordinary rules.
  const seated = (seat) => ({
    seat: seat.seat, engineSeat: seat.engineSeat, sideboardLeftOut: seat.sideboardLeftOut, unknownPrintings: seat.unknownPrintings,
    ...(seat.engineSeat ? { level: played, ai: ai ?? null } : {}),
    ...(seat.engineSeat && choices && !seat.ai ? { choices: { ...choices, decisions: seat.asked ?? [] } } : {}),
    ...(seat.engineSeat && dealtDeck ? { engineDeck: dealtDeck } : {}),
    ...(seat.engineSeat && dealtFormat ? { format: dealtFormat } : {}),
  })
  const sockets = new Map()
  let engine = null
  // The last process this room started, kept even after the room has let it
  // go, so a test can see that one which failed to deal was closed.
  let lastStarted = null
  let status = null
  let stop = 0
  let starting = false
  let gone = null
  // Whether `gone` is for good: the room ended the game itself — the same crash
  // waiting, a turn the engine would not take — and a relay that restarts must
  // not start it again. A game that could not be taken back is not: the next
  // relay's engine may be able to, and it says so (M7's review).
  let final = false
  // Whether the game has ended, in the engine's own word: written down, so a
  // relay that restarts does not load the corpus for a game nobody can play on,
  // and takes it back only when somebody sits down to look at it (M7's review).
  let finished = false
  // What the engine said it is: whether it took the pace, and whether it is new
  // enough to be asked for a delta. Both are the engine's word rather than this
  // room's assumption, because an older one answers neither and must not be
  // driven as though it had.
  let paced = false
  let protocol = 0
  // What the engine said a person may choose (protocol 5), or null.
  let choices = null
  // Whether the engine dealt the game with a mulligan phase, in its own word (protocol 6).
  let mulliganed = false
  let closed = false

  // Keeping the game (M7). `kept` is the engine's latest snapshot, its own text,
  // and the number of the stop it was taken at; `unkept` why the engine could
  // not keep this game, where it could not. `dealt` is whether a stop was ever
  // published, which is what makes a game worth keeping at all. `inFlight` is a
  // person's move sent to the engine, until a stop after it has been kept: kept
  // with the game, because a room written in the meantime comes back to the stop
  // before it, and the person who made it is told it did not happen.
  // `inFlightFrom` is the stop it answered, held here and never written: any
  // stop kept after it holds the move, and takes the mark down in one write.
  let kept = null
  let unkept = null
  let dealt = false
  let inFlight = null
  let inFlightFrom = null
  let keeping = null
  // Coming back: 'relay' or 'engine' while a game is being taken back, and null
  // otherwise. `generation` counts the engine processes this room has started,
  // so an answer from one that has since been replaced is recognised and let
  // go rather than applied to the game the new one holds. `crashes` counts the
  // times the engine itself stopped since the game last went on: one is started
  // again, and a second is not, since the same crash is most likely waiting at
  // the same place. A relay restart is not the engine stopping, and counts none.
  // The game has gone on once a stop after the one it came back at has been
  // kept (`restoredAt`), not merely once the engine has answered: an engine that
  // answers and then stops building that stop's views would otherwise be started
  // again at the same place for as long as it kept doing so (M7's review).
  let restoring = null
  let generation = 0
  let crashes = 0
  let restoredAt = 0

  // A room read back from disk: the game as it was dealt and where it stood.
  // Its seats keep their places and their numbering; what the engine's seat
  // plays and which game it is are as the room last said them.
  const from = saved ? savedRoomOf(saved) : null
  if (from) {
    dealt = from.dealt
    stop = from.stop
    kept = from.kept
    unkept = from.unkept
    inFlight = from.inFlight
    level = from.level ?? level
    if (from.dealt) {
      played = from.played
      profile = from.profile
      paced = from.paced
      mulliganed = from.mulliganed
      choices = from.choices
      dealtDeck = from.engineDeck
      dealtFormat = from.format
      for (const s of from.seated) {
        const seat = seats.find((x) => x.seat === s.seat)
        if (!seat) continue
        seat.engineSeat = s.engineSeat
        seat.name = s.name ?? seat.name
        seat.sideboardLeftOut = s.sideboardLeftOut
        seat.unknownPrintings = s.unknownPrintings
        seat.asked = s.asked
        seat.seq = s.seq
        if (!seat.ai) seat.ready = true
      }
      finished = from.over
    }
    // Ended for good by the room before the relay went: still ended, and said as it was.
    if (from.dealt && from.gone) {
      gone = from.gone
      final = true
    } else if (from.dealt && !from.kept) {
      // Dealt and never kept: nothing this room could give an engine to take back.
      gone = from.unkept
        ? `The relay restarted, and this game could not come back: ${from.unkept}`
        : 'The relay restarted before this game had been kept, so it could not come back.'
    }
  }

  const say = (socket, op, body = {}) => deliver(socket, { t: 'engine', op, ...body })
  const tell = (op, body = {}) => { for (const s of sockets.values()) say(s, op, body) }
  /** The status, numbered, as the seat at this socket may see it (`statusFor`). */
  const sayStatus = (socket) => say(socket, OP.status, { status: { ...statusFor(status, seats.find((x) => x.socket === socket)), stop } })
  // The engine's seat says the level it plays at: the room's setting until
  // the deal, and what the engine took after it.
  const seatList = () => seats.map(({ seat, name, here, ready, ai: bot, engineSeat }) => ({
    seat, name, here, ready: ready || Boolean(bot), ai: bot, engineSeat,
    ...(bot ? { level: engineSeat ? played : level } : {}),
  }))

  /**
   * The room has lost its engine, said once. A process can be found to have
   * gone by three different routes at once — a call that rejects, the step the
   * pace asked for, the exit itself — and a room that told each of them would
   * say the same thing three times to every seat. The first word is kept,
   * because it is the one that says what happened rather than what followed.
   *
   * Written down, so a relay that restarts does not start again a game the room
   * ended for good (M7's review: one that did loaded the corpus for it at every
   * restart, and said it had come back). `final: false` is a game that could not
   * be taken back, which the next relay tries again.
   */
  const lost = (reason, { final: forGood = true } = {}) => {
    if (gone) return
    gone = reason
    final = forGood
    tell(OP.gone, { reason })
    onChange?.()
  }

  /**
   * One seat's view of the table, numbered. A seat that has had a whole state
   * and said it can apply a delta is sent one; anything else is sent the state
   * entire. What comes back decides which it was: an engine that answered a
   * delta with a whole state is believed, and the seat's count starts again
   * from it, rather than a delta being announced that was never sent.
   */
  const sendView = async (seat, { whole = false } = {}) => {
    if (!engine || !seat.socket || !seat.engineSeat) return
    const asDelta = !whole && seat.whole && seat.deltas && protocol >= PACED_PROTOCOL
    // A view the engine answered but this room did not send is a hole in the
    // chain with no gap for the client to see. The engine moves a seat on when
    // it builds the reply — its own last view for that seat, and its count of
    // the log lines sent — so a reply that is lost, refused or never comes has
    // still moved it: the next delta would be against a view nobody has, and
    // the lines that travelled with the lost one never come again, while the
    // numbers stay consecutive and nothing asks. So the seat is marked as
    // holding nothing whole, and its next view is asked for whole, which
    // starts both of the engine's counts again and resends the log entire.
    try {
      const v = await engine.call('view', { viewer: seat.engineSeat, ...(asDelta ? { delta: true } : {}) })
      const body = v.state ? { state: v.state } : v.delta ? { delta: v.delta } : null
      if (!body) { seat.whole = false; return }
      if (v.state) seat.whole = true
      // The log beside a delta is only what was added since this seat's last
      // view, which its client appends; beside a whole state it is the lot.
      say(seat.socket, OP.view, { you: seat.engineSeat, seq: ++seat.seq, ...body, log: v.log ?? [] })
    } catch { seat.whole = false }
  }

  /**
   * The game written down at the stop just published (M7), by an engine that can
   * (protocol 9). Asked after the views, so nobody waits on it to see the table:
   * a snapshot took 6 ms at the median when measured, and its first in a process
   * over 170 (PLAN.md, M7). One that fails leaves the last one kept standing,
   * and the room says, when it comes back to that, that it is behind.
   *
   * The request is written to the engine before this first waits, and the engine
   * answers its lines in order, so a move or a step asked for after `keep` is
   * called is answered after the snapshot: what is kept is the stop published.
   *
   * A stop kept is the game having gone on: past the stop it last came back at,
   * the engine's crashes are forgiven, and a move in flight from before it is in
   * it, so its mark comes down with the same write — a relay going down between
   * the two would otherwise tell its person a move was lost that was kept.
   */
  const keep = async () => {
    if (!engine || closed) return
    if (protocol < KEEPING_PROTOCOL) {
      if (unkept) return
      unkept = `the engine it was played on keeps no game (protocol ${protocol}; keeping one came with ${KEEPING_PROTOCOL}).`
      onChange?.()
      return
    }
    const gen = generation
    const at = stop
    const asked = (async () => {
      try {
        const r = await engine.call('snapshot')
        // Closed, or its engine replaced: the answer is about a game this room
        // no longer holds, and nothing is written of it.
        if (gen !== generation || closed) return
        if (typeof r?.snapshot !== 'string' || !r.snapshot) throw new Error('It answered with no snapshot.')
        kept = { text: r.snapshot, stop: at }
        unkept = null
        if (at > restoredAt) crashes = 0
        if (inFlight && inFlightFrom !== null && at > inFlightFrom) { inFlight = null; inFlightFrom = null }
      } catch (e) {
        if (gen !== generation || closed) return
        unkept = `the engine could not keep it: ${clause(e.message)}`
        onStderr?.(`could not keep the game at stop ${at}: ${e.message}`)
      }
      onChange?.()
    })()
    keeping = asked
    await asked
    if (keeping === asked) keeping = null
  }

  /**
   * A stop, published: its status to every seat, then each seat's view. The
   * callers keep it (`keep`) once it is out; a move's is kept after the one-move
   * guard is down, since the guard is there to keep two moves from being
   * answered at once, and a snapshot is not an answer anybody waits on.
   *
   * The stop's number is written to disk at once, before anybody is sent it
   * (`now`), rather than at the relay's next write a moment later: a relay killed
   * in that moment came back with the stop before, told everybody it was "as it
   * was at the last stop", and numbered the position it went back to as one the
   * clients had already seen for another (M7's review). Written first, what came
   * back is at worst a stop behind what people saw, and says so.
   */
  const publish = async () => {
    if (!engine || !status) return
    const gen = generation
    stop++
    dealt = true
    if (status.over) finished = true
    onChange?.({ now: true })
    for (const s of sockets.values()) sayStatus(s)
    for (const seat of seats) {
      if (gen !== generation) return
      await sendView(seat)
    }
  }

  // The room's own wait between the engine's steps. Held as a wake so that a
  // room closing, or the last seat emptying, is not waited out first: the loop
  // is woken and finds its own reason to stop.
  let napWake = null
  const nap = (ms) => new Promise((done) => {
    const timer = setTimeout(() => { napWake = null; done() }, Math.max(0, ms))
    timer.unref?.()
    napWake = () => { clearTimeout(timer); napWake = null; done() }
  })
  const wakeNap = () => napWake?.()
  const pause = wait ?? nap

  /**
   * Watching the engine's turn. While the engine is waiting on itself, the room
   * publishes what it just did, waits the room's pace and asks for the next
   * step. It stops the moment there is nothing or nobody to watch it for — the
   * game hands back, the room closes, the engine dies, the last seat empties —
   * and only one loop ever runs, so a rejoin mid-turn takes the turn up again
   * without starting a second (an act cannot: it is refused before it gets
   * here, because it is not that seat the game is waiting on).
   */
  let driving = false
  // Somebody in a seat, not merely somebody on the wire: a socket is in the
  // room from the moment it connects, and one whose sit was refused — every
  // seat taken — would otherwise keep the turn running for a room where
  // nobody can be sent a view, since `sendView` has no seat to send one to.
  const watching = () => Boolean(engine) && !closed && paced && seats.some((s) => s.socket) && status?.waiting === 'engine'
  /**
   * How many steps in a row may fail before the room stops taking them. A step
   * can fail without the engine being dead: a call that timed out, a reply
   * that threw after the table had already moved on. Giving up on the first
   * would leave the plate saying the engine was thinking about a turn nobody
   * was taking, and never giving up would ask a broken engine once a pace for
   * the rest of the game. So a few, and then it is said in words.
   */
  const STEPS_BEFORE_GIVING_UP = 3
  const drive = async () => {
    if (driving || !watching()) return
    driving = true
    // The engine this turn is being watched on. One that stops mid-turn is
    // replaced by a game taken back (M7), and that one's turn is watched by a
    // loop of its own once it is back; this one lets go.
    const gen = generation
    let failed = 0
    try {
      // The try is inside the loop, so a step that failed and was recovered
      // from is one step lost rather than the whole of the engine's turn: the
      // loop looks again at whether there is anything to watch and carries on.
      while (watching() && gen === generation) {
        try {
          await pause(paceMs)
          if (!watching() || gen !== generation) break
          const next = await engine.call('continue')
          if (gen !== generation) break
          status = next
          await publish()
          if (gen !== generation) break
          await keep()
          failed = 0
        } catch (e) {
          // An engine that has gone is said by its exit, or taken back from the
          // last stop kept, and there is no turn left to take on this one.
          if (gen !== generation || engine?.exited) break
          failed++
          // A continue the engine refused: it is not waiting on itself after all.
          // Its word for where the table stands is worth more than this room's,
          // so the room asks rather than keep asking for a step that is not there.
          try {
            const now = await engine.call('turn')
            if (gen !== generation) break
            status = now
            await publish()
            if (gen !== generation) break
            await keep()
          } catch { /* an engine that cannot say has gone, and its exit says so */ }
          // Still the engine's to play, and still not playing it. A room left
          // saying "The engine is thinking…" about a turn nobody is taking is
          // a screen saying something untrue, so this is the end of the turn
          // and the room says why.
          if (failed >= STEPS_BEFORE_GIVING_UP) { lost(`The engine stopped taking its turn: ${e.message}`); break }
        }
      }
    } finally {
      driving = false
      // A loop that let go because its engine was replaced hands the turn on:
      // the game taken back may be waiting on the engine too, and only one loop
      // may watch it. While it is still coming back there is nothing to watch,
      // and the room starts the loop itself once it is.
      if (gen !== generation) drive()
    }
  }

  const start = async () => {
    if (engine || starting) return
    starting = true
    try {
      // Watched for its exit as well as asked: a process can stop answering
      // before it is gone — a write to a stdin that is no longer writable
      // rejects while the exit is still in flight — and without this the room
      // would learn of it only from whichever call happened to be waiting.
      // Said only while the room still holds this process: one let go of after
      // a refused deal, or closed with the room, has not gone, it was ended.
      const started = startEngine({
        command: engineCommand,
        onStderr,
        onExit: (why) => { if (!closed && engine === started) died(why) },
      })
      engine = started
      lastStarted = engine
      generation++
      // Asked first and given the long allowance, so that the corpus loading
      // is waited for once, here, and every later call keeps the usual wait.
      const hello = await engine.call('hello', {}, { timeoutMs: STARTUP_MS })
      // The engine's own seat plays what the sit asked (M5), and where nothing
      // was asked, the first human's deck: a mirror match, as every room before
      // dealt. The mirror is the whole deck, sideboard too, or a wish in it
      // would be a dead card on one side of the table only.
      const first = seats.find((s) => !s.ai && s.deck)
      protocol = Number(hello?.protocol) || 0
      const wants = wantedDeck ?? { kind: 'mirror' }
      // A deck of its own only of an engine that builds one: an older one reads
      // a deck that is not a list as none and refuses the game, so it is sent
      // the copy instead, and the room says why once the deal is done.
      const own = wants.kind === 'own' && protocol >= DECKS_PROTOCOL
      // A Commander game where one was asked for, where the engine deals one, and
      // where every person here brought a commander: a player without one has no
      // command zone to begin in (CR 903.6), and the engine refuses such a game.
      // Anywhere else the decks go as every room has sent them, and the room says
      // which game it dealt and why after the deal.
      const commanderAsked = wantedFormat() === 'commander'
      const commanderGame = commanderAsked && protocol >= COMMANDER_PROTOCOL && seats.filter((s) => !s.ai).every((s) => s.commander)
      // Another of the person's decks goes with its own commander at a Commander
      // game; one that came without is not sent, and the copy — which has one — is.
      const theirs = wants.kind === 'deck' && (!commanderGame || wants.commander) ? wants : null
      const unled = wants.kind === 'deck' && !theirs
      const botDeck = () => {
        if (own) return { deck: 'own', ...(wants.format ? { format: wants.format } : {}), ...(wants.sets ? { sets: wants.sets } : {}) }
        const side = forProtocol(hello?.protocol, theirs ? theirs.sideboard : first?.sideboard)
        const led = commanderGame ? (theirs ? theirs.commander : first?.commander) : null
        return { deck: forProtocol(hello?.protocol, theirs ? theirs.deck : (first?.deck ?? {})), ...(side ? { sideboard: side } : {}), ...(led ? { commander: led } : {}) }
      }
      // Taken only from an engine new enough to carry a choice in its `act`:
      // an older one ignores every key a choice would travel in.
      choices = protocol >= CHOOSING_PROTOCOL ? choicesOf(hello) : null
      // A level is asked only of an engine that has them, and only for the seat
      // it plays with its own judgement: an older engine ignores the key and
      // plays its one way, and a random player has no levels to play at.
      const levelled = level && protocol >= LEVELLED_PROTOCOL
      const player = (s) => {
        const side = forProtocol(hello?.protocol, s.sideboard)
        const deck = s.ai ? botDeck() : { deck: forProtocol(hello?.protocol, s.deck ?? {}), ...(side ? { sideboard: side } : {}) }
        return {
          name: s.name ?? (s.ai ? 'The engine' : s.seat), ...deck, ai: s.ai, autoPass: !s.ai,
          ...(commanderGame && !s.ai ? { commander: s.commander } : {}),
          // The decisions this seat's client can show, for a person's seat and an engine that asks them.
          ...(choices && !s.ai && s.answers.length ? { answers: s.answers } : {}),
          ...(levelled && s.ai === 'heuristic' ? { level } : {}),
        }
      }
      // A pace is asked for only of an engine that has one: an older one ignores
      // the key and would then refuse the `continue` that followed it.
      const asking = paceMs > 0 && protocol >= PACED_PROTOCOL
      // A mulligan phase only where every person here can be shown one: a seat
      // whose client cannot would be offered keeping and bottoming it has no
      // prompt for, and the game would wait on it for good.
      const opening = protocol >= MULLIGAN_PROTOCOL && seats.filter((s) => !s.ai).every((s) => s.mulligans)
      const reply = await engine.call('new', {
        players: seats.map(player),
        // Absent, the engine picks one and says which in its reply.
        ...(seed == null ? {} : { seed }),
        // Sent as the room's own pace in milliseconds, which the engine reads
        // only as a yes: the waiting is this room's, not the process's.
        ...(asking ? { pace: paceMs } : {}),
        ...(opening ? { mulligans: true } : {}),
        ...(commanderGame ? { format: 'commander' } : {}),
      })
      // Taken only where the engine says it took it, so a room never drives a
      // table that is not stopping for it.
      paced = asking && reply?.paced === true
      mulliganed = opening && reply?.mulligans === true
      // The game dealt, in the engine's own word: Commander only where it said so.
      // Asked for and not dealt, it says why — an engine that deals no Commander
      // game, or a person at the table with no commander to bring.
      const dealtCommander = commanderGame && reply?.format === 'commander'
      dealtFormat = {
        asked: commanderAsked ? 'commander' : 'standard', played: dealtCommander ? 'commander' : 'standard',
        ...(commanderAsked && !dealtCommander ? { fellBack: commanderGame || protocol < COMMANDER_PROTOCOL ? 'engine' : 'commander' } : {}),
      }
      reply.seats.forEach((es, i) => {
        seats[i].engineSeat = es.id
        if (seats[i].ai) seats[i].name = es.name
        // Read forgivingly: an engine from before the sideboard sends none.
        seats[i].sideboardLeftOut = Array.isArray(es.sideboardLeftOut) ? es.sideboardLeftOut.filter((n) => typeof n === 'string') : []
        seats[i].unknownPrintings = Array.isArray(es.unknownPrintings) ? es.unknownPrintings.filter((n) => typeof n === 'string') : []
        // What the engine will ask this person, in its own words; an engine that
        // does not say asks what every engine has: targets, yes or no, an option.
        seats[i].asked = choices && !seats[i].ai ? words(es.asked) : null
      })
      // The level the engine says its seat took, and only where this room asked
      // for that one: an older engine says none, and a word the room did not ask
      // for is not one it can vouch for.
      const bot = reply.seats.find((_, i) => seats[i]?.ai)
      played = levelled && levelOf(bot?.level) === level ? level : null
      profile = typeof bot?.profile === 'string' ? bot.profile : null
      // What the engine's seat plays. A deck of its own is the engine's to
      // describe, fallback and all. A copy or another deck went as names, which
      // the engine calls a list whatever the room meant by it, so the room says
      // which it was and takes only the colours and the count from the engine;
      // and a deck of its own asked of an engine too old to build one is the
      // copy, said as that. An engine asked for a deck of its own that says
      // nothing readable of what it dealt is not guessed for: `played` is null.
      // At a Commander game the engine names its seat's commander whichever deck
      // it plays, and the room passes that on, the commander being face up from
      // the start. Another of the person's decks that came with no commander to a
      // Commander game was not sent, and the copy was, which is said as that.
      if (bot) {
        const said = protocol >= DECKS_PROTOCOL ? reportOf(bot.deck) : null
        const { cards, colours } = said ?? { colours: [] }
        const counted = { ...(cards !== undefined ? { cards } : {}), colours, ...(said?.commander ? { commander: said.commander } : {}) }
        dealtDeck = own
          ? (said?.played ? said : { asked: 'own', played: null, colours: [] })
          : wants.kind === 'own'
            ? { asked: 'own', played: 'mirror', ...counted, ...(wants.format ? { format: wants.format } : {}), fellBack: 'engine' }
            : unled
              ? { asked: 'deck', played: 'mirror', ...counted, ...(wants.name ? { name: wants.name } : {}), fellBack: 'commander' }
              : { asked: wants.kind, played: wants.kind, ...counted, ...(theirs?.name ? { name: theirs.name } : {}) }
      }
      status = reply
      tell(OP.seats, { seats: seatList() })
      for (const seat of seats) if (seat.socket) say(seat.socket, OP.seated, seated(seat))
      await publish()
      // The deal kept before the engine's turn is watched, so a game that goes
      // down from its first stop comes back to it (M7).
      await keep()
      drive()
    } catch (e) {
      lost(e.message)
      // A refused deal leaves the process up and waiting, and one that missed
      // the startup allowance is still loading: either way it holds the whole
      // corpus, and once the room lets go of it nothing else can close it.
      const dead = engine
      engine = null
      dead?.close().catch(() => {})
    } finally {
      starting = false
    }
  }

  const maybeStart = () => {
    const ready = seats.filter((s) => !s.ai && s.ready).length
    if (ready >= humanSeats) start()
  }

  /**
   * What a seat is told once its game is back, if it has a socket to hear it;
   * kept for it until then. `heard` is a socket that has just spoken, and so is
   * there: told on it, the seat has been told. Told on one that has not, it is
   * kept until that socket speaks (`receive`), and said again to a socket that
   * takes its place; `at` lets a client that did hear it the first time say it
   * once.
   */
  const tellRestored = (seat, { heard = false } = {}) => {
    if (!seat.untold || !seat.socket) return
    say(seat.socket, OP.restored, seat.untold.said)
    if (heard) seat.untold = null
    else seat.untold.to = seat.socket
  }

  /**
   * The engine stopped while the room still held it. A game that has been kept
   * is taken back from the last stop kept, by an engine started again, and the
   * table says so (M7): "The engine restarted; the table is as it was at the
   * last stop." Once, and again only after the game has gone on from there — an
   * engine that stops before it has would most likely stop at the same place
   * again, so the third start is not tried and the room says why. Anything else
   * — no game kept, an engine that keeps none — is the room gone, as before.
   */
  const died = (why) => {
    if (closed || gone) return
    // The restore under way hears of it from its own call, and says why.
    if (restoring) return
    if (kept && crashes === 0) { crashes++; resume('engine'); return }
    lost(kept ? `The engine stopped again before the game could go on, so it was not started a third time: ${clause(why)}` : why)
  }

  /**
   * The game taken back, by a new engine, from the last stop kept (M7): after
   * the relay restarted (`relay`), or after the engine stopped (`engine`).
   *
   * Every seat is told at once that the table is coming back, and the status is
   * let go of, so nothing anybody presses reaches an engine that is not there;
   * the move a person was waiting on, if there was one, is let go of too, and
   * that person is told it did not happen. The engine loads the corpus (about
   * 15 s, engine/README.md) and takes the kept game back; the room then holds
   * it to the seats it saved — a game with other seats in it is not this one —
   * and publishes it whole to every seat, with what each is to be told first.
   * A paced turn that was being watched goes on being watched.
   *
   * A game that cannot be taken back is gone, but not for good: what refused it
   * was this engine, and the next relay's may not (an engine too old to keep a
   * game, one that could not start), so it is not written down as ended, the next
   * relay tries again, and the reason says so.
   */
  const resume = async (reason) => {
    if (closed || !kept || restoring) return
    restoring = reason
    starting = true
    // Answers the old engine may still give are not this game's any more.
    const gen = ++generation
    // The move a person was waiting on, told to them once the game is back. The
    // mark stays on the room until then, so a relay that goes down again while
    // this one is loading still has it to tell.
    const lostMove = inFlight
    answering = false
    status = null
    // Behind what the people at the table last saw, in stops, where the last
    // stop published was never kept: said, so a table a stop behind does not
    // read as the table they left.
    const behind = Math.max(0, stop - kept.stop)
    wakeNap()
    const old = engine
    engine = null
    if (old && !old.exited) old.close().catch(() => {})
    tell(OP.restoring, { reason })
    try {
      const started = startEngine({
        command: engineCommand,
        onStderr,
        onExit: (why) => { if (!closed && engine === started) died(why) },
      })
      engine = started
      lastStarted = started
      const hello = await started.call('hello', {}, { timeoutMs: STARTUP_MS })
      if (gen !== generation || closed) return
      const p = Number(hello?.protocol) || 0
      if (p < KEEPING_PROTOCOL) throw new Error(`Its engine takes no game back (protocol ${p}; that came with ${KEEPING_PROTOCOL}).`)
      // The corpus is loaded by now, which is most of the wait; taking the game
      // back is milliseconds (PLAN.md, M7), but is given the long allowance too.
      const reply = await started.call('restore', { snapshot: kept.text }, { timeoutMs: STARTUP_MS })
      if (gen !== generation || closed) return
      // The engine's seats, in order, must be the ones this room recorded at the deal.
      const ids = Array.isArray(reply?.seats) ? reply.seats.map((s) => s?.id) : []
      const recorded = seats.map((s) => s.engineSeat).filter(Boolean)
      if (!ids.length || ids.length !== recorded.length || ids.some((id, i) => id !== recorded[i])) throw new Error('The game the engine took back is not the one this table was playing.')
      protocol = p
      // A pace the engine took back is one this room can go on driving; the
      // engine says whether it did, as it says so at a deal.
      paced = paced && reply.paced === true
      status = reply
      restoring = null
      inFlight = null
      inFlightFrom = null
      // The number the stop taken back is about to be published as, which
      // says which coming back this was: stops only ever count up, across
      // restarts too, since each is on disk before anybody sees it.
      const at = stop + 1
      for (const seat of seats) {
        // Every seat is sent the table whole: its client may hold a view the
        // game has since gone back from.
        seat.whole = false
        if (seat.ai) continue
        seat.untold = { said: { reason, behind, ...(lostMove?.seat === seat.seat ? { lost: lostMove.op } : {}), at }, to: null }
      }
      tell(OP.seats, { seats: seatList() })
      for (const seat of seats) {
        if (!seat.socket) continue
        tellRestored(seat)
        say(seat.socket, OP.seated, seated(seat))
      }
      await publish()
      if (gen !== generation || closed) return
      // What is kept is the game just taken back, now at the stop it was
      // published as: the engine holds nothing else, so it is not asked again.
      // It is also the stop past which the game has gone on (`crashes`).
      kept = { text: kept.text, stop }
      restoredAt = stop
      onChange?.()
      drive()
    } catch (e) {
      if (gen !== generation || closed) return
      restoring = null
      const dead = engine
      engine = null
      dead?.close().catch(() => {})
      lost(`${reason === 'engine' ? 'The engine stopped' : 'The relay restarted'}, and the game could not come back: ${ended(clause(e.message))} ${TRIED_AGAIN}`, { final: false })
    } finally {
      if (gen === generation) starting = false
    }
  }

  const sit = (socket, { name, seat: wanted, deck, sideboard, deltas, level: wantedLevel, answers, mulligans, engineDeck, format, commander }) => {
    let seat = wanted ? seats.find((s) => s.seat === wanted && !s.ai) : null
    if (seat?.socket && seat.socket !== socket) { sockets.delete(seat.socket.id); seat.socket.terminate?.() }
    if (!seat) seat = seats.find((s) => !s.ai && !s.here) ?? null
    if (!seat) { say(socket, OP.refused, { error: 'Every seat is taken.' }); return }
    // A client that has just arrived holds no view to apply a delta to, whether
    // it is a new one or the same one come back, so this seat starts whole
    // again. Deltas are what this client says it can read, asked each time it
    // sits: the one at a seat may be a newer build than the one before it.
    if (seat.socket !== socket) seat.whole = false
    seat.deltas = deltas === true
    // Kept until the deal, as the deck is; after it, the engine asks what it
    // was dealt to ask, whichever build comes back to the seat. So is whether
    // this client can show a mulligan.
    if (!engine && !starting) { seat.answers = words(answers); seat.mulligans = mulligans === true }
    seat.socket = socket; seat.here = true; seat.name = name || seat.name || seat.seat
    if (deck && typeof deck === 'object' && Object.keys(deck).length) {
      seat.deck = deck
      // The sideboard belongs to the deck it came with; a rejoin without a deck keeps both.
      seat.sideboard = sideboard && typeof sideboard === 'object' && !Array.isArray(sideboard) && Object.keys(sideboard).length ? sideboard : null
      // So do a commander and the game asked for (M6): a deck that brings no
      // commander has none, and one that names no game it can read — a tab from
      // before Commander — asks for the ordinary rules it always played by.
      seat.commander = commanderOf(commander)
      seat.format = formatOf(format) ?? 'standard'
      seat.ready = true
    }
    socket.seat = seat.seat
    // The level is the room's until the deal, and a sit that names one changes
    // it: the lobby's choice travels with the sit. After the deal it is the
    // game's, and a sit that comes back naming another is told what it is.
    if (!engine && !starting && levelOf(wantedLevel)) level = levelOf(wantedLevel)
    // So is what the engine's seat plays: the room's until the deal, and a sit
    // that asks for one changes it. A sit that says nothing it can read — a tab
    // from before the choice — leaves it as it was, which is a copy.
    if (!engine && !starting && ai && engineDeckOf(engineDeck)) wantedDeck = engineDeckOf(engineDeck)
    say(socket, OP.seated, seated(seat))
    tell(OP.seats, { seats: seatList() })
    if (gone) { say(socket, OP.gone, { reason: gone }); return }
    // Coming back (M7): said, and nothing more until it is back, when the room
    // publishes the table whole to every seat.
    if (restoring) { say(socket, OP.restoring, { reason: restoring }); return }
    // Back while this person was away: what came back is said before the table,
    // on a socket that has just spoken and so is there to hear it.
    tellRestored(seat, { heard: true })
    if (engine && status) {
      sayStatus(socket)
      // Whole, and then the engine's turn goes on being watched: somebody who
      // came back mid-turn is who the pace was waiting for.
      sendView(seat, { whole: true }).then(drive)
    } else if (dealt) {
      // A game that had ended when the relay last went is taken back only now,
      // for somebody who has sat down to look at it (`comeBack`). It is never
      // dealt again: a dealt room with no engine has a game to take back, or has
      // gone, and said so above.
      if (kept) resume('relay')
    } else maybeStart()
  }

  /**
   * A client that missed a view asks for the table whole. Its next number is
   * the one after the view it never got, so a gap is closed rather than
   * papered over, and what it draws is the engine's own state, not a board
   * built on a delta applied to the wrong thing.
   */
  const resync = (socket) => {
    const seat = seats.find((s) => s.socket === socket)
    if (!seat) { say(socket, OP.refused, { error: 'Sit down first.' }); return }
    // Coming back: the whole table is sent to every seat once it is.
    if (restoring) { say(socket, OP.refused, { error: RESTORING, restoring: true }); return }
    if (!engine || !status) { say(socket, OP.refused, { error: gone ?? 'The game has not started.' }); return }
    sendView(seat, { whole: true })
  }

  /*
   * One move at a time. The stop a press answers does not move on until the
   * engine has answered it, and against a level that searches (M3 measured up
   * to ten seconds at hard) a second press in that time used to pass the stale
   * check below, reach the engine after the first, and be applied to whatever
   * it offered next: a play nobody chose. So while one is being answered, the
   * next is refused and said, not sent.
   */
  let answering = false
  const forward = async (socket, op, message) => {
    const seat = seats.find((s) => s.socket === socket)
    if (!seat) { say(socket, OP.refused, { error: 'Sit down first.' }); return }
    // A press that crossed `restoring` on the wire: there is no engine to take it.
    if (restoring) { say(socket, OP.refused, { error: RESTORING, stale: true, restoring: true }); return }
    if (!engine || !status) { say(socket, OP.refused, { error: gone ?? 'The game has not started.' }); return }
    if (status.actor !== seat.engineSeat) { say(socket, OP.refused, { error: 'It is not you the game is waiting on.' }); return }
    if (message.stop !== undefined && message.stop !== stop) { say(socket, OP.refused, { error: 'The table moved on; look again.', stale: true }); return }
    // `answering` marks this refusal as the guard's, which the answer on its
    // way makes untrue: a client drops it at the next status, where it keeps
    // any other refusal standing through the engine's turn.
    if (answering) { say(socket, OP.refused, { error: 'The engine is still answering your last move.', stale: true, answering: true }); return }
    const { t, op: _op, stop: _stop, ...params } = message
    // This move's own marks, taken down by this move alone: once its guard is
    // down another move can begin, and must not have its marks taken down by
    // this one finishing after it.
    const guard = {}
    answering = guard
    // The move is in flight until a stop after it has been kept (M7, and `keep`,
    // which takes the mark down): a room written in the meantime comes back to
    // the stop before it, and this person is told the move did not happen.
    // Written now, on disk before the engine is asked, rather than at the relay's
    // next write: against a level that searches the answer can be seconds away,
    // and a relay killed before a later write would forget the move was ever
    // made (M7's review). Only where the game is kept at all: an engine that
    // keeps none has no stop to come back to, and no move to tell of.
    const gen = generation
    const mine = { seat: seat.seat, op }
    if (protocol >= KEEPING_PROTOCOL) {
      inFlight = mine
      inFlightFrom = stop
      onChange?.({ now: true })
    }
    try {
      const next = await engine.call(op, params)
      // An engine replaced while this was answered: the game taken back is at
      // the stop before this move, and the person is told so by `restored`.
      // A room closed meanwhile keeps the move as in flight, as it was written.
      if (gen !== generation || closed) return
      status = next
      await publish()
      if (gen !== generation || closed) return
      // Answered and published: the next move may be taken, and is answered
      // after the snapshot asked for here, so what is kept is this stop.
      if (answering === guard) answering = false
      const written = keep()
      drive()
      await written
    } catch (e) {
      if (gen !== generation || closed) return
      // Refused: the game did not move, so there is nothing to lose.
      if (inFlight === mine) { inFlight = null; inFlightFrom = null; onChange?.() }
      say(socket, OP.refused, { error: e.message })
      if (engine?.exited) lost(e.message)
    } finally {
      if (gen === generation && answering === guard) answering = false
    }
  }

  return {
    mode: 'enforced',
    get engine() { return engine },
    get lastStarted() { return lastStarted },
    get status() { return status },
    join(socket) { sockets.set(socket.id, socket) },
    leave(socket) {
      sockets.delete(socket.id)
      const seat = seats.find((s) => s.socket === socket)
      if (seat) { seat.socket = null; seat.here = false; seat.whole = false; tell(OP.seats, { seats: seatList() }) }
      // Nobody left in a seat to watch the engine play: the pace is woken so
      // the turn stops where it is rather than running on to a room nobody can
      // be sent a view in. It goes on from there when somebody sits down again.
      if (!seats.some((s) => s.socket)) wakeNap()
    },
    receive(message, socket) {
      if (message?.t !== 'engine') return
      // A socket told what came back that has spoken since was there to hear it (`tellRestored`).
      const told = seats.find((s) => s.socket === socket && s.untold?.to === socket)
      if (told) told.untold = null
      switch (message.op) {
        case OP.sit: sit(socket, message); break
        case OP.act: forward(socket, 'act', message); break
        case OP.decide: forward(socket, 'decide', message); break
        case OP.turn: if (restoring) say(socket, OP.restoring, { reason: restoring }); else if (status) sayStatus(socket); break
        case OP.resync: resync(socket); break
        default: say(socket, OP.refused, { error: `Unknown op "${message.op}".` })
      }
    },
    describe() {
      // `level` is what the room was asked for; `played` what the engine took,
      // once there is a deal, with Argentum's own id for the profile behind it.
      // `started` is an engine process begun, which is some seconds before a
      // deal — the whole corpus loads first — and `dealt` is the deal itself:
      // a lobby that read "started" as "under way" said the game was being
      // played, one way only, while it was still loading (found in M3's review).
      // `mulligans` is whether the game was dealt with a mulligan phase, once it is dealt.
      // `engineDeck` is what the engine's seat was asked to play until the deal, and what it
      // plays after it, as a seated says it: never a card of it, since anybody with the
      // table's code may ask.
      // `format` is the game asked for until the deal, and the game dealt after it, as a seated says it.
      // A deck of its own is said with the format it was asked to be built to, so
      // a lobby can say the copy while the engine deals where it builds none.
      // A game coming back (M7) was dealt, and is said as dealt, with `restoring`
      // saying why it cannot be played this minute; so is one that had ended when
      // the relay last went, which has no engine until somebody sits to look at
      // it, and is said as begun and over rather than as a table to be dealt.
      const isDealt = Boolean(engine && status) || dealt
      const own = wantedDeck?.kind === 'own' ? { pool: wantedDeck.sets ? 'sets' : 'format', ...(wantedDeck.format ? { format: wantedDeck.format } : {}) } : {}
      const asked = wantedDeck ? { asked: wantedDeck.kind, ...(wantedDeck.name ? { name: wantedDeck.name } : {}), ...own } : null
      return {
        mode: 'enforced', ai, seats: seatList(), started: Boolean(engine) || dealt, dealt: isDealt, over: Boolean(status?.over) || finished, pace: paceMs, paced,
        level, ...(isDealt ? { played, profile, mulligans: mulliganed } : {}),
        ...(ai && (isDealt ? dealtDeck : asked) ? { engineDeck: isDealt ? dealtDeck : asked } : {}),
        format: isDealt && dealtFormat ? dealtFormat : { asked: wantedFormat() },
        ...(restoring ? { restoring } : {}),
        // Why the game has gone, where it has: since M7 a room can outlive its
        // game, when the game could not come back after a restart, and a lobby
        // that asks should not offer it as a table waiting to be dealt.
        ...(gone ? { gone } : {}),
      }
    },
    /**
     * What the relay writes to disk for this room (M7), for `savedRoomOf` to
     * read back: the room's settings, and once it has dealt, the game as the
     * room holds it — its seats and their numbering, what the engine's seat
     * plays and which game it is, the last stop published, and the engine's own
     * text of the game at the last stop kept, with any move still in flight;
     * and whether the game ended, and why it went where the room ended it for
     * good (M7's review), so the next relay neither loads an engine for it nor
     * says it came back.
     * Never the decks: a room that has dealt has them in the engine's text, and
     * one that has not is sat at again by clients that bring them.
     */
    record() {
      return {
        seats: seats.length, ai, pace: paceMs, level,
        ...(dealt ? {
          dealt: true, stop, played, profile, paced, mulliganed, choices, engineDeck: dealtDeck, format: dealtFormat,
          seated: seats.map((s) => ({ seat: s.seat, name: s.name, engineSeat: s.engineSeat, sideboardLeftOut: s.sideboardLeftOut, unknownPrintings: s.unknownPrintings, asked: s.asked, seq: s.seq })),
          ...(finished ? { over: true } : {}),
          ...(gone && final ? { gone } : {}),
        } : {}),
        ...(kept ? { kept: { text: kept.text, stop: kept.stop } } : {}),
        ...(inFlight ? { inFlight } : {}),
        ...(unkept ? { unkept } : {}),
      }
    },
    /**
     * A room read back from disk comes back (M7): a game kept is taken back by
     * an engine started for it now, rather than when somebody sits, so the
     * corpus is loading while their clients find their way back. A room that
     * never dealt is a table waiting for its seats, as it was. A game that had
     * ended, or that the room ended for good, is not taken back now (M7's
     * review): nobody is waiting to play on, and the first is taken back when
     * somebody sits down to look at it (`sit`).
     */
    comeBack() { if (kept && dealt && !gone && !finished) resume('relay') },
    /** Once the snapshot being taken now, if one is, has been kept: the relay waits on this, briefly, before it goes down. */
    settled() { return keeping ?? Promise.resolve() },
    async close() {
      // The loop is told the room has gone before the engine is: a step asked
      // for after this would be a call on a closing process, and a pace waited
      // out would hold the close for as long as it had left.
      closed = true
      wakeNap()
      await engine?.close()
    },
  }
}
