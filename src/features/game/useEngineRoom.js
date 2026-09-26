import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { relay } from '../../lib/board/relay.js'
import { boardFromView, eventsBetween, standIn } from '../../lib/engine/board.js'
import { nothingHeld, receiveView } from '../../lib/engine/stream.js'
import { leaveOut, nameList, seatDeck } from '../../lib/engine/deck.js'
import { levelLine, levelOf } from '../../lib/engine/levels.js'
import { ANSWERS, NO_CHOICES, choicesFrom } from '../../lib/engine/choose.js'
import { DEFAULT_OPPONENT, OPPONENT_KINDS, engineDeckLine, formatWord, insteadLine, setsOf } from '../../lib/engine/opponent.js'
import { formatLine, gameName, gameOf, isCommanderGame } from '../../lib/engine/commander.js'
import { restartOf, restoredLines } from '../../lib/engine/restart.js'
import { leadOf, ledSeat, standInLine, standInLostLine, unledLine } from '../../lib/engine/stand-in.js'
import { sameCard } from '../../lib/engine/names.js'

/**
 * A seat at a table the engine holds.
 *
 * The browser's end of `scripts/relay-engine.mjs`: it sits down with the
 * deck's card names, and from then on receives what the engine decided —
 * a status saying whom the game waits on and what they may do, and a view
 * of the table as this seat may see it — and sends back the one thing a
 * player does at a rules-enforced table: choose among what is offered.
 *
 * What comes back is laid onto the same board model the solo and shared
 * tables draw (`src/lib/engine/board.js`), so the table component does not
 * know which authority is behind it. The one thing it is told plainly is
 * what the engine did on its behalf: the windows it passed because nothing
 * was affordable, and the decisions it answered because this protocol
 * cannot yet ask them, both written into the log as lines of their own.
 *
 * Two things here are about the order in which the wire says things.
 *
 * A view may be a delta, and a run of them is only worth having whole:
 * `src/lib/engine/stream.js` counts the numbers, applies what follows and
 * asks for the table whole where anything is missing. This seat says in its
 * `sit` that it can read them, so a room never sends a delta to a tab that
 * was open before this was written.
 *
 * And what the engine did *for* the player — the windows it passed, the
 * decisions it answered — arrives in the status, which the room sends before
 * the view it belongs to. Said as it arrives, "passed 4 priority windows"
 * would sit above the land that was played before those windows. So it is
 * held until the view's own lines are in the log and added after them.
 *
 * The level the player chose in the lobby goes with the sit, and the room
 * says after the deal what the engine is really playing at. The log says that
 * once, in the room's words rather than the lobby's: the level taken, or that
 * this engine or this relay is older than levels and plays its one way.
 *
 * So do the decisions this build can put on screen (`answers`,
 * src/lib/engine/choose.js), and after the deal the room says what this seat
 * may choose (`can`): what its `act` may carry — targets, an X, a division of
 * damage, what a cost takes — and which decisions it will be asked. Until the
 * room says, and where it never does, the table holds back what it cannot send.
 *
 * And that this build can show a mulligan (`mulligans`), so a room whose
 * engine deals one opens the game with the opening hands to keep (the owner's
 * "mulligans on", HANDOFF.md §3 item 3). A room that never says so deals every
 * hand kept, and the first status is simply the first stop of the game.
 *
 * And what the engine's seat is to play (M5): a copy of this deck, one of the
 * player's other decks by the names the lobby checked, or a deck the engine
 * builds, from the sets this deck uses or from the whole of its format. The
 * lobby records the choice with the table (`chooseEngineDeck`); the sit carries
 * it (`engineDeck`), and the log says once what the room reports was dealt.
 *
 * And which game the deck asks for (M6): the sit says so (`format`), a
 * Commander deck bringing its commander apart from its library (`commander`),
 * and the log says once which game the room reports was dealt — the Commander
 * rules, or the ordinary ones and why. Since §3 item 20 a Duel Commander or a
 * Brawl deck asks for its own game the same way, and the room's report carries
 * the engine's numbers for it (`game.rules`), which the table reads to know
 * whether commander damage can lose it.
 *
 * And a stand-in (HANDOFF.md §3 item 19): where the lobby recorded that the
 * player chose one of the deck's own legendary creatures to lead it in place of
 * a commander the engine does not know, the sit brings it as the commander, out
 * of the library, with `standsFor` naming the real one; the log says once that
 * it is a stand-in and not the deck's real commander, and the board marks the
 * card, the engine's copy of it too, for the table to say the same (`leads`).
 *
 * And a game that comes back (M7). A relay that restarts, or an engine that
 * stops, costs the room its engine for the fifteen seconds or so a new one
 * takes to load; the room says so (`restoring`), and this seat lets go of the
 * status it held, so nothing on screen offers a play there is no engine to
 * take, and `restoring` says why on the table. Once the game is back the room
 * says what came back (`restored`), and the log says it under the table it came
 * back to, as it says what the engine did for the player: which of the two
 * restarted, where the table is, and whether a move of this person's was lost
 * (src/lib/engine/restart.js). Any status is the game back too, since a room
 * sends none while it is coming back, and `restored` can be lost on a socket
 * that died unnoticed.
 */
/**
 * How long a press may go unanswered before the table says the engine is
 * thinking. Measured at M3 against a person's seat on this machine: easy and
 * intermediate answered every press within 218 ms, and hard nine in ten within
 * 700 ms and the slowest in 9.7 s (PLAN.md). So an ordinary answer never shows
 * it, and hard's long ones do.
 */
export const SLOW_MS = 400

const memoryKey = (code) => `mtg-companion:engine:${code}`
const remember = (code, value) => { try { localStorage.setItem(memoryKey(code), JSON.stringify(value)) } catch { /* private mode */ } }
const recall = (code) => { try { return JSON.parse(localStorage.getItem(memoryKey(code)) ?? 'null') } catch { return null } }

/**
 * Record, for one table, the cards a player chose to play without: the ones
 * the lobby showed them the engine does not know. Kept with the seat rather
 * than passed along once, so a reload of the table still leaves them out
 * instead of sitting down with a deck the engine will refuse.
 *
 * With them, the stand-in the player chose to lead the deck in place of a
 * commander the engine does not know (HANDOFF.md §3 item 19), by name, or none:
 * recorded together, so a later sit without one does not keep an earlier one.
 * The deck itself is never written to.
 */
export function agreeToLeaveOut(code, deckId, names, lead = null) {
  if (!code) return
  remember(code, { ...(recall(code) ?? {}), without: { deckId, names }, standIn: typeof lead === 'string' && lead ? { deckId, name: lead } : null })
}

/**
 * Record, for one table, what its engine's seat is to play, as the lobby had
 * it when the player sat down (M5): `{ kind: 'mirror' }`, `{ kind: 'deck',
 * deckId, name, deck, sideboard }` with exactly the names the engine was asked
 * about, or `{ kind: 'own', pool }`. A deck chosen but not sendable goes as the
 * copy with `instead` saying why. Kept with the seat, as the cards left out
 * are, so a reload of the table asks for the same deck.
 */
export function chooseEngineDeck(code, choice) {
  if (!code) return
  remember(code, { ...(recall(code) ?? {}), engineDeck: choice })
}

/**
 * The engine's deck as the sit sends it, from what the lobby recorded for this
 * table, read forgivingly — it was written by whatever build was running when
 * the player sat down — or, where it recorded nothing, from the player's kept
 * choice. `sets` are the sets the player's own deck uses (`setsOf`), sent only
 * for a deck of the engine's own built from them. A deck of theirs with no
 * names recorded cannot be sent, and goes as the copy with the reason.
 */
function engineDeckFor(recorded, kept, { formatId, sets }) {
  const r = recorded && typeof recorded === 'object' && !Array.isArray(recorded) ? recorded : null
  const kind = OPPONENT_KINDS.includes(r?.kind) ? r.kind : kept.kind
  if (kind === 'own') {
    const pool = r ? (r.pool === 'format' ? 'format' : 'sets') : kept.pool
    return { sit: { kind: 'own', format: formatWord(formatId), sets: pool === 'sets' ? sets.map((s) => s.code) : null }, asked: 'own' }
  }
  if (kind === 'deck') {
    const isList = (d) => Boolean(d) && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length > 0
    if (r?.kind === 'deck' && isList(r.deck)) {
      const name = typeof r.name === 'string' ? r.name : null
      // Its commander, at a Commander game (M6), as the lobby had it; a commander
      // written by any build is read forgivingly and dropped where it has no name.
      const commander = r.commander && typeof r.commander === 'object' && typeof r.commander.name === 'string' && r.commander.name ? r.commander : null
      return { sit: { kind: 'deck', name, deck: r.deck, ...(isList(r.sideboard) ? { sideboard: r.sideboard } : {}), ...(commander ? { commander } : {}) }, asked: 'deck' }
    }
    return { sit: { kind: 'mirror' }, asked: 'mirror', instead: 'missing' }
  }
  const instead = ['none', 'short', 'unloaded', 'leader'].includes(r?.instead) ? r.instead : null
  return { sit: { kind: 'mirror' }, asked: 'mirror', ...(instead ? { instead, name: typeof r?.name === 'string' ? r.name : null } : {}) }
}

export default function useEngineRoom({ address, code, name, deck, deckLookup, cardsReady, level: chosen = null, opponent = DEFAULT_OPPONENT }) {
  const [wireStatus, setWireStatus] = useState('connecting')
  const [seat, setSeat] = useState(null)
  const [seats, setSeats] = useState([])
  const [status, setStatus] = useState(null)
  const [run, setRun] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [gone, setGone] = useState(null)
  // The game coming back (M7): 'relay' or 'engine' while it is, null otherwise.
  const [restoring, setRestoring] = useState(null)
  // A press sent and not yet answered. Against a level that searches, the
  // engine can take seconds over what follows a move (PLAN.md, M3), and with
  // nothing on screen changing a player presses again. So a second press is
  // not sent, and once an answer is slow — past SLOW_MS, which no easy or
  // intermediate answer reached when measured — `slow` lets the table say the
  // engine is thinking. Said at once, it would flash up on every press.
  const [answering, setAnswering] = useState(false)
  const [slow, setSlow] = useState(false)
  const slowTimer = useRef(null)
  const answered = useCallback(() => {
    clearTimeout(slowTimer.current)
    slowTimer.current = null
    setAnswering(false)
    setSlow(false)
  }, [])
  useEffect(() => () => clearTimeout(slowTimer.current), [])
  const wire = useRef(null)
  const board = useRef(null)
  // The run of views this seat has been sent: the last one whole, its number,
  // and whether a whole one has been asked for after a gap.
  const stream = useRef(nothingHeld())
  const events = useRef([])
  const seq = useRef(0)
  // What the status said the engine did for the player, waiting for the view
  // it belongs to so that it lands under it rather than over it.
  const held = useRef([])
  // What the room said came back (M7), said under the first view after it. Kept
  // apart from `held`, which the next status says at once, since the status
  // after a game comes back always precedes the view that shows it.
  const cameBack = useRef([])
  // Which coming back was last said (`at` on `restored`, the number of the stop
  // it came back at): a room that could not be sure this seat heard it says it
  // again on the socket that takes the old one's place, and it is said once.
  const heardBack = useRef(null)
  const stands = useRef(new Map())
  const memory = useMemo(() => recall(code) ?? {}, [code])
  // What the lobby agreed to leave out, for this deck only, read forgivingly:
  // it was written by whatever build was running when the player chose.
  const agreed = memory.without?.deckId === deck?.id && Array.isArray(memory.without?.names) ? memory.without.names.filter((n) => typeof n === 'string') : []
  // And the stand-in the player chose there to lead this deck in place of a
  // commander the engine does not know (HANDOFF.md §3 item 19), by name. The rules
  // are asked again of this device's records (`ledSeat`), since the deck may have
  // changed since: one that can no longer lead it is let go of, and said.
  const agreedLead = memory.standIn?.deckId === deck?.id && typeof memory.standIn?.name === 'string' ? memory.standIn.name : null
  const without = cardsReady ? leaveOut(seatDeck(deck, deckLookup), agreed) : null
  const leading = without && agreedLead ? ledSeat(without, agreedLead, { deck, lookup: deckLookup, left: agreed }) : null
  const prepared = without && leading?.seat ? { ...without, seat: leading.seat } : without
  const leadLost = leading?.lost ?? null
  // A card that has not loaded has no name to send, and the deck sent without
  // it would be smaller than the player's, so the seat is not taken at all
  // while any is missing; the table says so instead.
  const unloaded = prepared?.seat.unloaded ?? 0
  // The deck by name, as a string: the lookup function is new on every
  // render, and an effect keyed on an object rebuilt from it would open a
  // new socket each time. The names themselves change only with the deck.
  // A Commander deck's commander and the game it asks for go with it (M6): they
  // are part of what the seat is, and change with the deck.
  const deckKey = prepared && !unloaded
    ? JSON.stringify({ deck: prepared.seat.deck, sideboard: prepared.seat.sideboard, ...(isCommanderGame(prepared.seat.game) ? { game: prepared.seat.game, commander: prepared.seat.commander ?? null, leaders: prepared.seat.leaders ?? 0 } : {}) })
    : null
  const deckNames = useMemo(() => (deckKey ? JSON.parse(deckKey) : null), [deckKey])
  const leftKey = JSON.stringify(prepared?.left ?? [])
  const leftOut = useMemo(() => JSON.parse(leftKey), [leftKey])
  const sideboardUnloaded = prepared?.seat.sideboardUnloaded ?? 0
  // Named by the engine when it deals: sideboard cards it does not know, left
  // out rather than refused, which the table then says.
  const [sideboardLeftOut, setSideboardLeftOut] = useState([])
  // What the engine is playing at, once the room has said: a level, or null
  // where it plays its one way; undefined until the deal.
  const [level, setLevel] = useState(undefined)
  const levelNoted = useRef(false)
  // What this seat may choose, once the room has said after the deal; nothing
  // until then, and nothing from a relay or an engine that never says.
  const [can, setCan] = useState(NO_CHOICES)
  // What the engine's seat plays, once the room has said after the deal (M5):
  // its report, null where it said nothing, undefined until the deal.
  const [engineDeck, setEngineDeck] = useState(undefined)
  const deckNoted = useRef(false)
  // The game the room says it dealt (M6): Commander or the ordinary rules, and
  // why where a Commander game was asked for and not dealt; undefined until the deal.
  const [game, setGame] = useState(undefined)
  const gameNoted = useRef(false)
  // The commanders that stand in for ones the engine does not know (HANDOFF.md
  // §3 item 19), `{ name, for }`: this person's and the engine's seat's, once the
  // room has said, or null. Kept in a ref as well, since the board is laid from
  // a view inside the socket's handler, and marks each stand-in card for the
  // table to say (`boardFromView`'s `leaders`); `mySeat` is this seat's engine id.
  const [leads, setLeads] = useState({ own: null, engine: null })
  const leadsRef = useRef({ own: null, engine: null })
  const mySeat = useRef(null)
  const sat = useRef(false)
  const sideNoted = useRef(false)
  const printingsNoted = useRef(false)
  const seating = useRef([])

  const note = useCallback((text) => {
    events.current = [...events.current, { type: 'said', seq: ++seq.current, turn: board.current?.turn ?? 1, text, player: null }]
  }, [])
  /** Said once the view it is about has been drawn, not before it. */
  const hold = useCallback((text) => { held.current = [...held.current, text] }, [])
  const flush = useCallback(() => {
    if (!held.current.length) return false
    const waiting = held.current
    held.current = []
    for (const text of waiting) note(text)
    return true
  }, [note])

  useEffect(() => {
    if (!address || !code || !deckNames) return undefined
    // A press outstanding when the wire drops will never be answered on that
    // wire: a room that comes back after its relay restarts is at the stop it
    // last saved, says so, and tells this seat if the press was lost (M7), and
    // one that stayed up resends the status when this seat sits again. Left
    // waiting, "The engine is thinking…" stood on the plate for good beside
    // "Reconnecting…" (found in M3's review). The room's own one-move guard
    // still stops a second press reaching the engine while the first is being
    // answered.
    const line = relay({
      url: `${address.replace(/\/$/, '').replace(/^http/, 'ws')}/rooms/${encodeURIComponent(code)}/ws`,
      onStatus: (s) => { setWireStatus(s); if (s !== 'open') answered() },
    })
    const side = Object.keys(deckNames.sideboard ?? {}).length ? { sideboard: deckNames.sideboard } : {}
    // `deltas` says this build can apply one. A room asks it of every sit,
    // because the tab at a seat may be a newer build than the one before it.
    // The level rides along each time: before the deal it is the room's to
    // take, and after it the room keeps the one the game was dealt with.
    const asked = levelOf(chosen)
    // What the engine's seat is to play, and the sets this deck uses, which a
    // deck of the engine's own is built from by default. Worked out here, once
    // the deck's names are, because the sets are read off the same cards.
    const sets = setsOf(deck, deckLookup)
    const ask = engineDeckFor(memory.engineDeck, opponent, { formatId: deck?.formatId, sets })
    // Every sit says which game its deck asks for: a Commander deck a Commander
    // game, bringing its commander where it has one to send, and every other deck
    // the ordinary rules. Said by a sixty-card deck too, since M6's review: a sit
    // that said nothing left a room's earlier Commander request standing.
    const led = { format: gameOf(deck?.formatId), ...(isCommanderGame(deckNames.game) && deckNames.commander ? { commander: deckNames.commander } : {}) }
    line.onOpen(() => line.send({ t: 'engine', op: 'sit', name, seat: memory.seat ?? null, deck: deckNames.deck, deltas: true, answers: ANSWERS, mulligans: true, ...side, ...(asked ? { level: asked } : {}), engineDeck: ask.sit, ...led }))
    line.onMessage((m) => {
      if (m?.t !== 'engine') return
      switch (m.op) {
        case 'seated': {
          // Read forgivingly: a relay from before the sideboard sends none.
          const sideOut = Array.isArray(m.sideboardLeftOut) ? m.sideboardLeftOut.filter((n) => typeof n === 'string') : []
          setSideboardLeftOut(sideOut)
          // Said when the engine first names them, which is the seated after the
          // deal, not the one that answers the sit at once, before there is a deal.
          if (sideOut.length && !sideNoted.current) {
            sideNoted.current = true
            note(`Your sideboard is played without ${nameList(sideOut, Infinity)}: the engine does not know ${sideOut.length === 1 ? 'it' : 'them'}.`)
          }
          // The owner's choice (2026-09-21): a printing the engine has not got is
          // shown as the engine's own art to every seat, and the log says so once.
          const missed = Array.isArray(m.unknownPrintings) ? m.unknownPrintings.filter((n) => typeof n === 'string') : []
          if (missed.length && !printingsNoted.current) {
            printingsNoted.current = true
            note(`The engine does not have your printing of ${nameList(missed, Infinity)}, so ${missed.length === 1 ? 'it shows' : 'they show'} the engine's own art.`)
          }
          // The seated after the deal is the one with an engine seat in it, and the
          // one that can say what the engine took. A relay from before levels never
          // sends the key at all, which is a different thing from sending null.
          //
          // Said only at a table where the engine plays a seat with its own
          // judgement, the one kind of player that has levels. A random player,
          // or no engine player at all, is sent `level: null` too, and the line
          // for that — "this relay's engine is older than the levels" — was
          // untrue there (found in M3's review). The room says which kind it
          // fields (`ai` on the seated); a room from before that is read from
          // the seats it sent, and where neither has said, as it always was.
          if (m.engineSeat && !levelNoted.current) {
            levelNoted.current = true
            setLevel(levelOf(m.level))
            const kind = 'ai' in m ? m.ai : seating.current.length ? seating.current.find((x) => x.ai)?.ai ?? null : undefined
            const said = kind === undefined || kind === 'heuristic' ? levelLine('level' in m ? m.level : undefined, levelOf(chosen)) : null
            if (said) note(said)
          }
          // What the engine's seat plays, said once, where the engine plays a
          // seat at all: why a deck chosen for it could not be sent, and then
          // what the room says was dealt — a deck of its own by its colours and
          // where it was built from, and any fallback with its reason. A relay
          // from before the choice sends no word of it, which is said where the
          // player asked for anything but the copy every table used to deal.
          // The game dealt goes with it, since it is why a Commander deck of the
          // engine's own was not built at a table dealt by the ordinary rules.
          const dealtGame = m.format && typeof m.format === 'object' && !Array.isArray(m.format) ? m.format : undefined
          // A stand-in leading this person's deck (§3 item 19), only in a Commander
          // game: the room's word, and where a relay older than stand-ins says none,
          // the one this seat sent. And the engine's: a copy of the deck is led by
          // the same card, which the room says (`standsFor`), and which a relay older
          // than stand-ins leaves to be read off the copy's commander — named by the
          // engine by its front where it has two faces (`sameCard`).
          const sent = deckNames.commander?.standsFor ? { name: deckNames.commander.name, for: deckNames.commander.standsFor } : null
          const ownLead = m.engineSeat && isCommanderGame(dealtGame?.played) ? leadOf(dealtGame.standIn) ?? sent : null
          const raw = m.engineDeck && typeof m.engineDeck === 'object' ? m.engineDeck : undefined
          const reported = raw && ownLead && !raw.standsFor && raw.played === 'mirror' && sameCard(ownLead.name, raw.commander) ? { ...raw, standsFor: ownLead.for } : raw
          if (m.engineSeat) {
            mySeat.current = m.engineSeat
            leadsRef.current = { own: ownLead, engine: leadOf({ name: reported?.commander, for: reported?.standsFor }) }
            setLeads(leadsRef.current)
          }
          if (m.engineSeat && !deckNoted.current) {
            deckNoted.current = true
            const kind = 'ai' in m ? m.ai : seating.current.length ? seating.current.find((x) => x.ai)?.ai ?? null : undefined
            const report = reported
            setEngineDeck(report ?? null)
            if (kind !== null) {
              const instead = insteadLine(ask.instead, ask.name)
              if (instead) note(instead)
              const told = engineDeckLine(report, { asked: ask.asked, sets, game: dealtGame })
              if (told) note(told)
            }
          }
          // Which game was dealt, said once, after the deal: the Commander rules,
          // or the ordinary ones and why, where this deck asked for Commander.
          // A room from before Commander says nothing, and dealt the ordinary game.
          if (m.engineSeat && !gameNoted.current) {
            gameNoted.current = true
            const report = dealtGame
            setGame(report ?? null)
            const line = isCommanderGame(deckNames.game) && deckNames.leaders > 1 && !isCommanderGame(report?.played)
              ? `The engine deals one commander, and this deck has two, so the game is played by the ordinary rules${deckNames.game === 'commander' ? '' : `, not the ${gameName(deckNames.game)} rules`}: 20 life each, and no command zone.`
              : formatLine(report, deckNames.game ?? 'standard')
            if (line) note(line)
            // And the stand-in that leads this deck, said as not its real commander;
            // or, in a game dealt by the ordinary rules, where nothing leads it, where
            // the card went: into the library, where the room says it put it back, and
            // nowhere where a room older than that says nothing, since the sit took it
            // out of the library to send it as the commander.
            if (ownLead) note(standInLine(ownLead, report?.played))
            else if (sent && !isCommanderGame(report?.played)) note(unledLine(sent, leadOf(report?.inLibrary)))
          }
          if (!sat.current) {
            // A stand-in chosen in the lobby that can no longer lead this deck, let go of.
            if (leadLost) note(standInLostLine(leadLost))
            if (leftOut.length) {
              const copies = leftOut.reduce((sum, l) => sum + l.count, 0)
              note(`Played without ${nameList(leftOut.map((l) => `${l.count} ${l.name}`), Infinity)}: the engine does not know ${copies === 1 ? 'it' : 'them'}.`)
            }
            if (sideboardUnloaded) note(`${sideboardUnloaded === 1 ? 'One sideboard card' : `${sideboardUnloaded} sideboard cards`} did not load, so ${sideboardUnloaded === 1 ? 'it is' : 'they are'} left out.`)
          }
          sat.current = true
          if (m.engineSeat) { setSeat(m.engineSeat); setCan(choicesFrom(m)) }
          if (m.seat && memory.seat !== m.seat) { memory.seat = m.seat; remember(code, memory) }
          break
        }
        case 'seats': seating.current = m.seats ?? []; setSeats(seating.current); break
        case 'status': {
          const s = m.status
          // Anything still held belonged to a view that never came; it is
          // said now rather than lost under what this status brings, and the
          // log is redrawn for it, since no view is coming to do that.
          if (flush()) setRun((r) => (r ? { ...r, events: events.current } : r))
          if (s?.autoPassed > 0) hold(`The engine passed ${s.autoPassed} priority window${s.autoPassed === 1 ? '' : 's'} for you: nothing was affordable.`)
          for (const d of s?.decided ?? []) hold(`Decided for you — ${d.prompt}${d.source ? ` (${d.source})` : ''}.`)
          setStatus(s)
          // A room sends no status while its game is coming back, so a status is
          // the game back, whether or not the `restored` before it arrived: one
          // said on a socket that had silently died was lost, and the banner
          // saying nothing pressed would happen stood over a table that played
          // (found in M7's review).
          setRestoring(null)
          // Any status is the room having answered, whoever's stop it is.
          answered()
          // A refusal stands until the table is the player's to answer again.
          // A paced room publishes a status for each of the engine's own plays
          // — one every few hundred milliseconds — and none of them is an
          // answer to anything this seat pressed, so clearing on those would
          // take the banner away inside a pace: too fast to read, and for a
          // screen reader a live region cut off mid-sentence.
          //
          // Except "still answering your last move": any status is that answer,
          // so it has stopped being true however the table goes on. Kept, it
          // said the engine was still answering through every paced step of
          // the turn the answer began (found in M3's review).
          if (s?.waiting !== 'engine') setRefusal(null)
          else setRefusal((r) => (r?.answering ? null : r))
          break
        }
        case 'view': {
          const was = stream.current.view
          const taken = receiveView(stream.current, m)
          stream.current = taken.held
          // A gap, or a delta this build could not read: the table whole is
          // asked for, and the board already drawn stands until it arrives —
          // a moment behind is better than a board built on a guess.
          if (taken.resync) line.send({ t: 'engine', op: 'resync' })
          const next = taken.view
          if (!next) break
          for (const c of Object.values(next.cards ?? {})) { const stand = standIn(c); stands.current.set(stand.id, stand) }
          const fresh = eventsBetween(was, next, { seq: seq.current })
          if (fresh.length) seq.current = fresh[fresh.length - 1].seq
          events.current = [...events.current, ...fresh]
          // Seats in the room's order once the engine has named them all, so
          // the plates sit where the lobby said they would.
          const order = seating.current.length && seating.current.every((x) => x.engineSeat) ? seating.current.map((x) => ({ id: x.engineSeat })) : null
          // Each stand-in commander by its owner, for the table to say it is one.
          const leaders = {}
          const botSeat = seating.current.find((x) => x.ai)?.engineSeat
          if (mySeat.current && leadsRef.current.own) leaders[mySeat.current] = leadsRef.current.own
          if (botSeat && leadsRef.current.engine) leaders[botSeat] = leadsRef.current.engine
          board.current = boardFromView(next, { prev: board.current, seats: order, leaders })
          // Now that this view's own lines are in the log, what the engine did
          // for the player before them can be said under them, and what came
          // back after a restart under the table it came back to.
          flush()
          for (const text of cameBack.current.splice(0)) note(text)
          setRun({ board: board.current, events: events.current, restored: false, past: [], refusal: null })
          break
        }
        // `answering` is the room saying the refusal is its one-move guard,
        // which the next status makes untrue; a room from before it says only
        // the words, and its refusal then stands as any other does. One marked
        // `restoring` is a press that crossed the room's word that the game is
        // coming back, which the table already says, so it is not said twice.
        case 'refused':
          answered()
          if (m.restoring === true) { setRestoring((r) => r ?? 'relay'); setStatus(null); break }
          setRefusal({ message: m.error, stale: Boolean(m.stale), ...(m.answering === true ? { answering: true } : {}) })
          break
        case 'restoring': {
          // The game is coming back (M7). What is held is said now, as for a
          // status whose view never came; the status is let go of, because the
          // engine that would take a press on it is not there; and anything
          // pressed and not yet answered never will be.
          if (flush()) setRun((r) => (r ? { ...r, events: events.current } : r))
          answered()
          setStatus(null)
          setRefusal(null)
          setRestoring(restartOf(m.reason))
          break
        }
        case 'restored': {
          // Said under the table it came back to, which the view after this
          // brings; and once, where the room says it again. A room from before
          // `at` says it once of itself.
          setRestoring(null)
          const at = Number.isInteger(m.at) ? m.at : null
          if (at !== null && at === heardBack.current) break
          heardBack.current = at
          cameBack.current.push(...restoredLines(m))
          break
        }
        case 'gone': {
          // Nothing more is coming, so anything held is said now: the log is
          // the record of the game, and a table that has gone still has one.
          flush()
          for (const text of cameBack.current.splice(0)) note(text)
          answered()
          setRestoring(null)
          setRun((r) => (r ? { ...r, events: events.current } : r))
          setGone(m.reason ?? 'The engine has gone.')
          break
        }
        default: break
      }
    })
    wire.current = line
    return () => { line.close(); wire.current = null }
    // The room, the address and the deck's names are the identity of the seat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, code, deckKey])

  const send = useCallback((op, params = {}) => {
    const line = wire.current
    if (!line || !status) return false
    // The room refuses a second press while the first is being answered, in
    // these words; saying so here spares the round trip.
    if (answering) { setRefusal({ message: 'The engine is still answering your last move.', stale: true, answering: true }); return false }
    setRefusal(null)
    const sent = line.send({ t: 'engine', op, stop: status.stop, ...params })
    if (sent) {
      setAnswering(true)
      clearTimeout(slowTimer.current)
      slowTimer.current = setTimeout(() => setSlow(true), SLOW_MS)
    }
    return sent
  }, [status, answering])
  const act = useCallback((index, extra = {}) => send('act', { index, ...extra }), [send])
  const decide = useCallback((params) => send('decide', params), [send])

  /** A card the engine described, by its Scryfall id, until the real record arrives. */
  const cardFor = useCallback((id) => stands.current.get(id) ?? null, [])

  /** Where a permanent sits is the table's to decide, so a drag stays here. */
  const moveCard = useCallback((id, x, y) => {
    const b = board.current
    if (!b?.cards[id]) return
    b.cards[id] = { ...b.cards[id], x, y, z: b.nextZ++ }
    board.current = { ...b, cards: { ...b.cards } }
    setRun((r) => (r ? { ...r, board: board.current } : r))
  }, [])

  return {
    run, seat, seats, status, refusal, gone, restoring, wireStatus, unloaded, leftOut, sideboardLeftOut, level, answering, slow, can, engineDeck, game, leads,
    act, decide, cardFor, moveCard,
    refuse: (message) => setRefusal({ message }),
    clearRefusal: () => setRefusal(null),
  }
}
