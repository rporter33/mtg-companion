import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../lib/router.js'
import { saveDeck, getGameTable, saveGameTable, getTable, clearTable, getPrefs, setPref } from '../../lib/storage.js'
import { createBoard, handOf, librarySize, zoneOf, nameOf, hostOf, ZONE_LABELS, DEFAULT_COUNTERS } from '../../lib/board/model.js'
import { newRun, act, applyAll, undo, snapshot, restore } from '../../lib/board/runner.js'
import { untappedSources } from '../../lib/board/mana.js'
import { openingActions, mulliganActions, swapPrinting, OPENING_HAND } from '../../lib/board/deck.js'
import { treatmentOf, finishFor } from '../../lib/board/art.js'
import { artUrl } from '../../lib/deck-art.js'
import { stampNames } from '../../lib/deck.js'
import { laneFor, zoneWhenPlayed, isPermanent } from '../../lib/board/placement.js'
import { fan } from '../../lib/board/geometry.js'
import { prefersReducedMotion } from '../../lib/table/motion.js'
import { STEPS } from '../../data/turn-structure.js'
import { getCardsByIds } from '../../lib/scryfall.js'
import { pinCards } from '../../lib/cache.js'
import useDeckCards from '../decks/useDeckCards.js'
import { goneTableNote, movedTableNote } from '../../lib/card-migrations.js'
import { playFor } from '../../lib/board/sound.js'
import useDrag from '../../components/table/useDrag.js'
import useHold from '../../components/table/useHold.js'
import Field from '../../components/table/Field.jsx'
import BoardCard from '../../components/table/BoardCard.jsx'
import HandCost from '../../components/table/HandCost.jsx'
import Coach from '../../components/table/Coach.jsx'
import GameLog from '../../components/table/GameLog.jsx'
import TurnTracker from '../../components/table/TurnTracker.jsx'
import Pool from '../../components/table/Pool.jsx'
import PlayerCounters from '../../components/table/PlayerCounters.jsx'
import ZoneBrowser from '../../components/table/ZoneBrowser.jsx'
import TokenMaker from '../../components/table/TokenMaker.jsx'
import Printings from '../../components/Printings.jsx'
import Confirm from '../../components/Confirm.jsx'
import { nameList } from '../../lib/engine/deck.js'
import { THINKING, thinkingAt } from '../../lib/engine/board.js'
import { glowsAt, heldBack, offeredElsewhere, pileHolding } from '../../lib/engine/glow.js'
import { NO_CHOICES, advance, answerOf, beginBottom, beginDecision, beginPlay, complete, pickable, stepOf, toggle } from '../../lib/engine/choose.js'
import { chosenLevel, LEVEL_NAMES, levelOf } from '../../lib/engine/levels.js'
import { chosenOpponent } from '../../lib/engine/opponent.js'
import { damageLoses, damageRule, damageWords } from '../../lib/engine/commander.js'
import { restoringLine } from '../../lib/engine/restart.js'
import { standInPhrase } from '../../lib/engine/stand-in.js'
import { dropTarget, actionsForDrop } from '../../lib/board/drop.js'
import useRoom from './useRoom.js'
import useEngineRoom from './useEngineRoom.js'
import useTravel from './useTravel.js'
import Peek, { usePeek } from './Peek.jsx'
import { EnginePrompt } from './EnginePrompt.jsx'
import { relayAddress } from './relayAddress.js'
import '../../components/table/table.css'

/**
 * The rebuilt table: Moxgate's screen (docs/table-rebuild/TARGET.md §7) on
 * the existing board model, with the two frictions in FRICTION.md taken out.
 *
 * Reading the screen the way the recordings do: the opponent's seat along
 * the top, the battlefield in the middle with the log beside it, and along
 * the bottom your life plate, the actions rail, your hand fanned, and the
 * four zone tiles. Permanents are tiles rather than whole cards. Every part
 * of it that the old table already did well — the fan, the printed face in
 * hand, printings and foils, the zone browser, tokens, counters, arrows — is
 * the same component, lifted to components/table so both tables draw on it.
 *
 * Law 2: one tap does the thing. A card in hand is played by tapping it; a
 * permanent is tapped by tapping it. There is no second "confirm" tap, and
 * nothing is previewed on the way. What that costs is a way to reach the
 * rarer actions, so those live behind a long-press (or right-click), and
 * behind ACTIONS on the rail for the last card touched. Undo is on the rail,
 * always, because a one-tap table has to make a mis-tap cheap.
 *
 * Law 1 is the engine's to keep. This table has no engine yet, so it never
 * stops the player at a step to ask whether they have anything to do — the
 * phase pill is a tracker the player advances, and END TURN is one press.
 * The prompt panel of §8 appears when there is something to say: today,
 * only the opening hand.
 *
 * Alone, the table is yours and lives in this browser. At a shared table
 * (`room`), the relay holds it: every press is sent and nothing changes on
 * screen until it comes back, the seat opposite is a real person seen
 * across the table with their permanents mirrored, and undo is not offered
 * because the table is not only yours to wind back.
 */
const PILES = ['library', 'command', 'graveyard', 'exile']
const TILE_LABELS = { library: 'Lib', command: 'Cmd', graveyard: 'GY', exile: 'Exile' }
/** The zones anyone at the table may look through. A hand and a library are not among them. */
const PUBLIC_PILES = ['graveyard', 'exile']
const COMBAT_STEPS = ['beginCombat', 'attackers', 'blockers', 'firstStrike', 'damage', 'endCombat']
/** The words a pile's tile adds to its label when something in it is part of what the engine asks now. */
const PILE_SAYS = {
  target: 'holds a legal target',
  choice: 'holds a card that can be chosen now',
  cast: 'your commander can be cast now: a tap casts it',
  play: 'holds a card you can play, under Actions',
  use: 'holds a card whose ability you can use, under Actions',
}
/** How the command zone's tile is looked through while a tap on it casts the commander, said in its label. */
const OPENS_INSTEAD = 'and a hold, a right-click or Shift+Enter opens the zone'
/**
 * Said when a tap reaches an offer that needs a target this seat cannot send:
 * a relay or an engine from before M4, whose `act` carries none. Sent as it
 * is, the engine would refuse it saying there are no valid targets, which is
 * not so: it is this table that can send none (lib/engine/glow.js).
 */
const cannotAim = (name) => `${name} needs a target, and this table cannot choose one for it yet.`
/**
 * Said when a tap reaches an offer whose cost has a choice in it this seat
 * cannot make: which card to discard, which creature to sacrifice, from an
 * engine whose `act` carries no payment, or a kind of cost it cannot pay with
 * a choice. Sent bare, the engine would refuse it ("Must choose 1 card(s) to
 * discard"). The cost is named in Argentum's words.
 */
const cannotPay = (name, cost) => `${name} needs a choice made for its cost${typeof cost === 'string' && cost ? ` (${cost.charAt(0).toLowerCase()}${cost.slice(1)})` : ''}, and this table cannot make one for it yet.`
/** Why a tap on this offer is not sent, in words, for whichever reason holds it back. */
const cannotDo = (offer, name, can) => (heldBack(offer, can) === 'cost' ? cannotPay(name, offer.additionalCostText) : cannotAim(name))
/** Said when a tap lands on something the step being chosen cannot take, rather than sending it to be refused. */
const notPickable = (step, name, source) => {
  const of = source ? ` for ${source}` : ''
  if (step?.kind === 'targets') return `${name} is not a legal target${of}.`
  if (step?.kind === 'cost') return `${name} cannot pay the cost${of}.`
  if (step?.kind === 'sources') return `${name} cannot pay this mana.`
  if (step?.kind === 'cards') return `${name} cannot be chosen here.`
  if (step?.kind === 'bottom') return `Only a card in your hand can go on the bottom, and ${name} is not one.`
  if (step?.kind === 'x') return `Choose X${of} in the prompt first.`
  if (step?.kind === 'divide') return `Divide the damage${of} in the prompt first.`
  return `${name} is not part of this choice.`
}
const NO_GLOW = new Map()

// The prompt panel lives in its own file since M4; its tests and anything else
// that imported it from here still can.
export { EnginePrompt, placeWords, stopLine } from './EnginePrompt.jsx'


export default function Table({ deck: initialDeck, onOpenCard, room = null, engine = null }) {
  // The deck is kept here because choosing a printing rewrites it, and the
  // table should show the copy just chosen without a reload.
  const [deck, setDeck] = useState(initialDeck)
  // `moved` and `gone` are read as well as `missing`: a printing Scryfall has
  // dropped or replaced is not in `missing`, and the table deals every copy the
  // deck lists whether a record for it exists or not (see libraryOf). Without
  // these two the cards were simply on the battlefield, nameless or under
  // another printing, with nothing said about either.
  const { cards, loading, missing, moved, gone, lookup: deckLookup } = useDeckCards(deck)
  // Cards on the table the deck has never heard of: a token, a printing
  // swapped in, or — at a shared table — everything the other seat plays.
  // Pinned, so they are still themselves after a reload.
  const [extra, setExtra] = useState(() => new Map())
  const remember = useCallback((card) => {
    if (!card?.id) return
    setExtra((was) => new Map(was).set(card.id, card))
    pinCards([card.id]).catch(() => { /* it will be fetched again if it has to be */ })
  }, [])

  const [localRun, setLocalRun] = useState(null)
  // The last card touched. One tap acts on a card and also makes it the one
  // ACTIONS on the rail is about, so the rarer things are one press away.
  const [selected, setSelected] = useState(null)
  // Pointing at something: an arrow, or putting one card on another. Until
  // the second card is picked the table is unchanged.
  const [aiming, setAiming] = useState(null)
  // One panel at a time in the side column: the actions for a card, a zone
  // opened from its tile, the token maker, the printings, or the rest.
  const [panel, setPanel] = useState(null)
  const [peeking, setPeeking] = useState(0)
  const [turnsOpen, setTurnsOpen] = useState(false)
  // A question being asked in the house style: 'deal', 'mulligan', or
  // 'carry' (a game with this deck was left at the first table), or null.
  const [asking, setAsking] = useState(null)
  const carried = useRef(null)
  const [mulligans, setMulligans] = useState(0)
  // The opening hand is kept once, and the prompt goes away for the game.
  const [localKept, setLocalKept] = useState(false)
  const [prefs, setPrefs] = useState(() => getPrefs())
  const reduced = prefersReducedMotion(prefs.reduceMotion ?? null)
  const showImages = prefs.showCardImages !== false
  const fieldRef = useRef(null)

  // Deal once, and not before the cards have arrived: which row a card
  // belongs in is read off its type line, and at first paint there is none
  // to read. `loading` is false on the very first render, so readiness is
  // "something came back", true only once the fetch settled either way.
  // `gone` counts too: an id moves out of `missing` into it when /migrations
  // answers, and a readiness that fell back to false at that moment nulled the
  // engine seat's deck and tore down a sit-down that had already happened.
  const ready = !deck.main?.length || cards.size > 0 || missing.length > 0 || gone.length > 0

  const shared = useRoom({
    address: room ? relayAddress() : null,
    code: room,
    name: prefs.playerName || 'Player',
    deck,
    deckLookup,
    cardsReady: ready,
  })
  /*
   * The third authority. At a table the engine holds, the board on screen is
   * the engine's state laid onto this same model (src/lib/engine/board.js),
   * and the only thing a press can do is choose among what the engine
   * offers. Where a card sits is still the table's, so a drag is local.
   */
  const held = useEngineRoom({
    address: engine ? relayAddress() : null,
    code: engine,
    name: prefs.playerName || 'Player',
    deck,
    deckLookup,
    cardsReady: ready,
    // The level chosen in the lobby, kept with the player's other table
    // preferences; read forgivingly, since any build may have written it.
    level: chosenLevel(prefs.engineLevel),
    // And what the engine's seat plays, where the lobby recorded nothing for
    // this table (M5): the player's kept choice, read the same way.
    opponent: chosenOpponent(prefs.engineOpponent),
  })
  const away = Boolean(room || engine)
  // A card the deck knows, else one fetched for the table, else what the
  // engine said about it — enough to draw a printed face until the record
  // arrives.
  const lookup = useCallback((id) => deckLookup(id) ?? extra.get(id) ?? held.cardFor(id) ?? null, [deckLookup, extra, held.cardFor])

  /*
   * A fresh deal, alone. The lanes go in with the seat action rather than
   * being looked up inside the reducer: the board still knows nothing about
   * what a card is, and two devices replaying the same log reach the same
   * table.
   */
  const fresh = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9)
    const actions = openingActions(deck, { seed })
    const seat = actions[0]
    seat.lanes = Object.fromEntries(
      [...new Set([...seat.cards, ...seat.command])].map((id) => [id, laneFor(deckLookup(id))]),
    )
    return applyAll(newRun(createBoard({ seed, guided: prefs.tablePlaymat !== false })), actions).run
  }, [deck, deckLookup, prefs.tablePlaymat])

  const run = engine ? held.run : room ? shared.run : localRun

  // Anything on the table the deck cannot name comes back with its painting.
  const unknownIds = useMemo(() => {
    if (!run?.board) return ''
    return [...new Set(Object.values(run.board.cards)
      .map((inst) => inst.cardId)
      .filter((id) => id && !id.startsWith('engine:') && !cards.has(id) && !extra.has(id)))].sort().join(',')
  }, [run?.board, cards, extra])

  useEffect(() => {
    if (!unknownIds) return undefined
    let cancelled = false
    getCardsByIds(unknownIds.split(','))
      .then((found) => {
        if (cancelled || !found.size) return
        setExtra((was) => {
          const next = new Map(was)
          for (const [id, card] of found) next.set(id, card)
          return next
        })
      })
      .catch(() => { /* offline: they sit on the table without a name */ })
    return () => { cancelled = true }
  }, [unknownIds])

  /*
   * Alone: the board this deck was left on, or a fresh deal. The slot is
   * this table's own; the old table's game is not touched. A restored board
   * already carries its rows and needs no wait for the cards.
   */
  const dealt = useRef(false)
  useEffect(() => {
    if (away || dealt.current) return
    const saved = getGameTable()
    if (saved?.deckId === deck.id) {
      const restored = restore(saved)
      if (restored) {
        dealt.current = true
        setLocalRun(restored)
        setMulligans(saved.mulligans ?? 0)
        // A save from before `kept` existed is a game already under way.
        setLocalKept(saved.kept ?? true)
        return
      }
    }
    /*
     * A game with this deck left at the first table, before this one
     * replaced it. Its save has the same shape, so it can be picked up here
     * — but that is the person's to decide, so it is asked, in the house
     * style, before anything is dealt.
     */
    const old = getTable()
    if (old?.deckId === deck.id && asking !== 'carry') {
      const restored = restore(old)
      if (restored) { carried.current = { run: restored, mulligans: old.mulligans ?? 0 }; setAsking('carry'); return }
    }
    if (!ready || asking === 'carry') return
    dealt.current = true
    setLocalRun(fresh())
    setMulligans(0)
    setLocalKept(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [away, deck.id, ready, asking])
  const carryOn = () => {
    const c = carried.current
    dealt.current = true
    clearTable()
    setAsking(null)
    if (c) { setLocalRun(c.run); setMulligans(c.mulligans); setLocalKept(true) }
  }
  const letGo = () => {
    dealt.current = true
    clearTable()
    setAsking(null)
    setLocalRun(fresh())
    setMulligans(0)
    setLocalKept(false)
  }

  /*
   * Saved a moment after things settle, with a deadline so a board being
   * played — changing every few hundred milliseconds — still gets written.
   * And written on the way out regardless: a tab closed within half a second
   * of the last press used to lose that press, because the timer it was
   * waiting on died with the page. A shared table is saved by the relay.
   */
  const lastSaveAt = useRef(0)
  const latest = useRef(null)
  latest.current = !away && localRun ? snapshot(localRun, { deckId: deck.id, deckName: deck.name, mulligans, kept: localKept }) : null
  useEffect(() => {
    if (away || !localRun) return undefined
    const overdue = Date.now() - lastSaveAt.current > 2000
    const timer = setTimeout(() => {
      lastSaveAt.current = Date.now()
      saveGameTable(latest.current)
    }, overdue ? 0 : 400)
    return () => clearTimeout(timer)
  }, [away, localRun, deck.id, deck.name, mulligans, localKept])
  useEffect(() => {
    const flush = () => { if (latest.current) saveGameTable(latest.current) }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])

  const board = run?.board
  const soundOn = prefs.tableSound
  const localDo = useCallback((action) => setLocalRun((r) => {
    if (!r) return r
    const next = act(r, action)
    playFor(next.lastEvents, soundOn)
    return next
  }), [soundOn])
  const localDoAll = useCallback((actions) => setLocalRun((r) => {
    if (!r) return r
    const next = applyAll(r, actions).run
    playFor(next.lastEvents, soundOn)
    return next
  }), [soundOn])
  // At the engine's table the board is not the table's to change: a move
  // across the battlefield is the one thing that stays here, because where
  // a permanent sits is a matter of layout and not of rules.
  const heldDo = useCallback((action) => {
    if ((action.type === 'move' && action.zone === 'battlefield' && action.x !== undefined) || action.type === 'slide') {
      held.moveCard(action.id, action.x, action.y)
      return
    }
    held.refuse('The engine decides that at this table.')
  }, [held])
  const heldDoAll = useCallback((actions) => { for (const action of actions) heldDo(action) }, [heldDo])
  const doAction = engine ? heldDo : room ? shared.doAction : localDo
  const doAll = engine ? heldDoAll : room ? shared.doAll : localDoAll
  const kept = engine ? true : room ? shared.kept : localKept
  const setKept = room ? shared.setKept : setLocalKept
  const togglePref = useCallback((key) => { setPrefs(setPref(key, !prefs[key]).prefs) }, [prefs])

  // Which seat is yours. Alone it is the board's one seat; at a shared table
  // it is whatever chair the relay gave you.
  const me = engine ? held.seat : room ? shared.seat : 'you'

  // What the engine offers this seat right now, if it is this seat's stop.
  const status = engine ? held.status : null
  const myStop = Boolean(status && status.actor === me && !status.over)
  const offers = myStop && status.waiting === 'action' && Array.isArray(status.actions) ? status.actions : []
  // The opening hand being kept (protocol 6): the game has not begun, and the
  // plates and a tap on a card say so rather than speak of a turn. `keeping`
  // is the part of it before the hand is kept, when the choice is to keep it or
  // take a mulligan; after, only the cards owed to the bottom are left.
  const keeping = offers.some((a) => a?.type === 'KeepHand' || a?.type === 'TakeMulligan')
  const opening = keeping || offers.some((a) => a?.type === 'BottomCards')
  // What this seat may choose, as the room said after the deal (HANDOFF.md,
  // M4): nothing at a table the engine does not hold, and nothing where the
  // relay or the engine is older than choosing.
  const can = engine ? held.can ?? NO_CHOICES : NO_CHOICES
  // The offer a tap on this card acts: a meaningful one before any other, and
  // one the table can carry out before one it cannot — needing a target it
  // cannot send, or a choice in its cost it cannot make (lib/engine/glow.js) —
  // which is kept last so the tap can say why.
  const offerFor = (id) => {
    const mine = offers.filter((a) => a.card === id && a.affordable)
    return mine.find((a) => a.meaningful && !heldBack(a, can)) ?? mine.find((a) => !heldBack(a, can)) ?? mine[0] ?? null
  }
  /*
   * Something being chosen before it is sent (lib/engine/choose.js): a play's
   * X, what its cost takes, its targets and how its damage is divided, begun by
   * the tap that found its offer; or a decision whose answer is picked on the
   * table — a trigger's targets, cards to select, the mana sources to pay with, and the
   * cards put on the bottom after a mulligan — which the stop that asks it
   * begins. A choice belongs to the stop it was made at and is dropped the
   * moment the table moves on, so a pick can never be sent against an offer the
   * engine has since withdrawn.
   */
  const [picking, setPicking] = useState(null)
  const asked = useMemo(() => {
    const ch = engine ? beginDecision(status, me) ?? beginBottom(status, me) : null
    return ch ? { ...ch, stop: status?.stop } : null
    // The stop is what the decision belongs to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, status?.stop, me])
  const choosing = (picking && picking.stop === status?.stop ? picking : null) ?? asked
  const setChoosing = useCallback((ch) => setPicking(ch ? { ...ch, stop: status?.stop } : null), [status?.stop])
  // Space passes (HANDOFF.md, M1b): the pass on offer now, read by the key's
  // handler below through a ref so that one listener serves every stop. Not
  // while a play is being chosen: Space there would throw the choice away.
  const passOffer = useRef(null)
  passOffer.current = engine && !choosing ? offers.find((a) => a.type === 'PassPriority') ?? null : null
  const actRef = useRef(null)
  actRef.current = held.act
  // Combat is declared by tapping: attackers gathered until "Attack", a
  // blocker then the attacker it blocks. Both are cleared at the next stop.
  const [chosen, setChosen] = useState(() => new Set())
  const [blocks, setBlocks] = useState({})
  const [blocker, setBlocker] = useState(null)
  useEffect(() => { setChosen(new Set()); setBlocks({}); setBlocker(null) }, [status?.stop])
  // Combat being declared, drawn as the arrows it will become. Hooks come
  // before the table's early return for the loading state, so this one is
  // here rather than with the rest of the render.
  const declaring = offers.find((a) => a.type === 'DeclareAttackers' && a.meaningful) ?? null
  const blocking = offers.find((a) => a.type === 'DeclareBlockers' && a.meaningful) ?? null
  const shownBoard = useMemo(() => {
    if (!engine || !board || (!chosen.size && !Object.keys(blocks).length)) return board
    const arrows = [...board.arrows]
    const target = declaring?.validAttackTargets?.[0] ?? board.players.find((p) => p !== me)
    for (const id of chosen) arrows.push({ id: `chosen:${id}`, from: id, to: target, kind: 'attack' })
    for (const [b, attackers] of Object.entries(blocks)) for (const a of attackers) arrows.push({ id: `block:${b}:${a}`, from: b, to: a, kind: 'target' })
    return { ...board, arrows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, chosen, blocks, engine, declaring, me])

  /*
   * Carrying out an offer the engine made, at its table: sent at once where
   * it needs nothing chosen, or begun as a choice whose last step sends it —
   * its X, what its cost takes, its targets, how its damage is divided
   * (lib/engine/choose.js). Whatever was open in the side column is closed,
   * since the choosing happens on the table and in the prompt.
   */
  const choose = (offer) => {
    const ch = beginPlay(offer, can)
    if (!ch) { held.act(offer.index); return }
    setChoosing(ch)
    setPanel(null)
  }

  /*
   * Playing a card from hand. A permanent goes to the battlefield, into its
   * row; anything else goes on the stack, because that is where a spell
   * goes. The one tap and the drag both end here.
   *
   * At the engine's table, while something is being chosen, a card dragged out
   * of the hand is a pick for it, as a tap on it is (`answerTap`, below): a
   * card to put on the bottom, a card to discard. Until M4's review a drag
   * looked for a play instead, and in the bottoming step said to keep the hand
   * or take a mulligan, a hand already kept. `answerTap` is defined with the
   * other taps, after the table's early return, so it is reached by a ref.
   */
  const answerTapRef = useRef(null)
  const play = useCallback((id, point = {}) => {
    const inst = board?.cards[id]
    if (!inst) return
    if (engine) {
      // The game coming back (M7): there is no stop to be or not be this seat's,
      // and the banner already says nothing pressed will happen until it is
      // back. Refused in words here, the tap said "It is not your stop." of a
      // stop that may well be this person's (found in M7's review).
      if (held.restoring) return
      if (choosing) { answerTapRef.current?.(id); return }
      const offer = offerFor(id)
      if (offer && heldBack(offer, can)) held.refuse(cannotDo(offer, nameOf(board, id, lookup), can))
      else if (offer) choose(offer)
      else if (keeping) held.refuse('Keep this hand or take a mulligan first: nothing is played before the game begins.')
      else if (opening) held.refuse('Choose the cards to put on the bottom first: nothing is played before the game begins.')
      else held.refuse(myStop ? 'The engine does not offer that card now.' : 'It is not your stop.')
      return
    }
    const card = inst.custom ? null : deckLookup(inst.cardId) ?? null
    const zone = board.guided && card ? zoneWhenPlayed(card, inst) : 'battlefield'
    doAction(zone === 'stack'
      ? { type: 'move', id, zone: 'stack' }
      : { type: 'move', id, zone: 'battlefield', ...point })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, deckLookup, doAction, engine, offers, myStop, held, lookup, can, opening, keeping, choosing])

  /*
   * A released card goes where the most specific thing under the pointer
   * says: onto a card, into a zone tile, back to hand, or onto the table at
   * that point. The rectangles are read off the screen at release, which is
   * once per drag rather than once per frame, and drop.js decides the order.
   * A spell dropped on the table goes to the stack, as a tap would send it.
   */
  const rootRef = useRef(null)
  const onDrop = useCallback((session, point) => {
    const root = rootRef.current
    if (!root || !board) return
    const rectOf = (el) => el?.getBoundingClientRect() ?? null
    const target = dropTarget(point, {
      dragged: session.id,
      cards: [...root.querySelectorAll('.game__field .field__slot[data-id]')].map((el) => ({ id: el.dataset.id, rect: rectOf(el) })),
      zones: [...root.querySelectorAll('.game__you .ztile[data-zone]')].map((el) => ({ zone: el.dataset.zone, rect: rectOf(el) })),
      hand: rectOf(root.querySelector('.game__hand')),
      field: rectOf(fieldRef.current),
    })
    setSelected(session.id)
    if (target?.kind === 'field' && session.from !== 'battlefield') { play(session.id, { x: target.x, y: target.y }); return }
    const actions = actionsForDrop(target, { id: session.id, from: session.from })
    if (actions.length) doAll(actions)
  }, [board, play, doAll])
  // The long way in, from a finger: rest on a card and it is picked up
  // without being played or tapped, the same as a right-click.
  const holdRef = useRef(null)
  const onHold = useCallback((id) => holdRef.current?.(id), [])
  const { drag, begin, justDragged } = useDrag({ fieldRef, onDrop, onHold })
  // The same from a finger on your command zone's tile, which casts the
  // commander at a tap (M6): a hold opens the zone instead, as a right-click
  // does. Opened, not toggled, so the contextmenu an Android browser raises from
  // the same long press cannot close it again.
  const { start: holdTile, justHeld: tileJustHeld } = useHold((zone) => setPanel(`zone:${zone}@${me}`))

  // Cards travel between places, unless motion is reduced.
  useTravel(rootRef, { board, reduced, me })
  // Resting the pointer on a card shows its printed face; Z shows it at once.
  const { peek, enter: peekAt, leave: peekOff } = usePeek({ enabled: showImages })
  // Where the next press goes, which the preview must leave uncovered: the
  // prompt panel with its Pass, and the rail with its own (HANDOFF.md, M1b).
  // Read each time the preview is placed rather than once, because the prompt
  // comes and goes with every stop.
  const pressable = useCallback(() => {
    const root = rootRef.current
    return root ? [...root.querySelectorAll('.prompt, .rail')].map((el) => el.getBoundingClientRect()) : []
  }, [])

  /*
   * Space passes, when a pass is on offer (HANDOFF.md, M1b; the Grok pack's
   * prototype). Not while a field has focus, where Space is a letter, nor in a
   * dialog; and not while the keyboard is on a control, where Space presses
   * that control — a person tabbing through their hand expects Space to play
   * the card they are on, as every button does. A control the pointer last
   * pressed has focus without showing it, and there Space passes: after
   * tapping a land, the next thing Space is for is the pass. A key held down
   * repeats, and a repeat is not a second decision to pass. Z stays the zoom.
   *
   * Which of the two a control is, is noted when it takes focus, not asked in
   * the keydown: by then Chromium already counts the focused control as
   * focus-visible, because a key has gone down, so a control the pointer had
   * pressed looked keyboard-focused to every Space and was pressed again — a
   * refused card refused again rather than a pass (found in M3's review, with a
   * probe on the pinned Chromium). What the browser showed as focus arrived is
   * what the person saw. A control focused before this was listening counts as
   * the pointer's.
   */
  useEffect(() => {
    if (!engine) return undefined
    const byKeyboard = new WeakMap()
    const onFocus = (e) => {
      const el = e.target
      if (!(el instanceof Element)) return
      let shown = false
      try { shown = el.matches(':focus-visible') } catch { /* a browser without it shows no ring to go by */ }
      byKeyboard.set(el, shown)
    }
    const onKey = (e) => {
      if (e.key !== ' ' || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return
      const pass = passOffer.current
      if (!pass) return
      const at = document.activeElement
      if (at && at !== document.body) {
        if (at.isContentEditable || /^(input|textarea|select)$/i.test(at.tagName)) return
        if (at.closest?.('[role="dialog"], dialog')) return
        if (byKeyboard.get(at)) return
      }
      e.preventDefault()
      actRef.current?.(pass.index)
    }
    document.addEventListener('focusin', onFocus, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('focusin', onFocus, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [engine])

  const nudge = useCallback((id, dx, dy) => {
    const inst = board?.cards[id]
    if (!inst) return
    doAction({ type: 'move', id, zone: 'battlefield', x: inst.x + dx, y: inst.y + dy })
  }, [board, doAction])

  if (!run || !me) {
    // The table's own shape, empty, rather than a spinner: what is about to
    // appear is already where it will be, and the line says what is being
    // waited for.
    const why = asking === 'carry' ? 'A game with this deck is waiting at the old table.' : engine
      ? (held.gone ? `The engine has gone: ${held.gone}` : held.restoring ? restoringLine(held.restoring) : !ready ? 'Fetching the cards, then sitting down…'
        // Not sent short: without those cards the engine would deal a smaller
        // deck than the player's, and it has no name to be told them by.
        : held.unloaded ? `${held.unloaded === 1 ? 'One card' : `${held.unloaded} cards`} in this deck did not load, so it is not sent to the engine: it would deal a smaller deck than yours.`
        : held.wireStatus === 'open' ? 'Sitting down; the engine is dealing…' : held.wireStatus === 'connecting' ? 'Joining the table…' : 'The relay is not answering yet. Trying again…')
      : room
      ? (shared.status === 'open' ? 'Taking a seat…' : shared.status === 'connecting' ? 'Joining the table…' : 'The relay is not answering yet. Trying again…')
      : (missing.length ? 'Some cards could not be loaded; dealing anyway…' : 'Fetching the cards, then dealing…')
    return (
      <div className="game game--loading" aria-busy="true">
        <div className="game__them"><div className="plate plate--them skeleton" /><span className="skeleton skeleton--line" /></div>
        <div className="game__field"><div className="field field--tile skeleton"><p className="field__empty" role="status">{why}</p></div></div>
        <div className="game__you">
          <div className="game__seat"><div className="plate plate--you skeleton" /><div className="rail"><span className="rail__btn skeleton" /><span className="rail__btn skeleton" /><span className="rail__btn skeleton" /></div></div>
          <div className="game__hand skeleton skeleton--hand" />
          <div className="ztiles">{PILES.map((z) => <span key={z} className="ztile"><span className="ztile__label">{TILE_LABELS[z]}</span><span className="ztile__face skeleton" /></span>)}</div>
        </div>
        <aside className="game__side"><div className="gamelog skeleton skeleton--log" /></aside>
        <Confirm
          open={asking === 'carry'}
          title="Pick up where you left off"
          onClose={letGo}
          actions={[
            { label: 'Continue that game', kind: 'primary', onPress: carryOn },
            { label: 'Deal a new hand', kind: 'ghost', onPress: letGo },
          ]}
        >
          A game with this deck was left at the table before this one. Continuing brings it here as it stood; dealing a new hand lets it go.
        </Confirm>
      </div>
    )
  }

  const selectedInst = selected ? board.cards[selected] ?? null : null
  const hand = handOf(board, me)
  const spread = fan(hand.length)
  const nameFor = (inst) => nameOf(board, inst.id, lookup)
  const cardFor = (inst) => (inst.custom ? null : lookup(inst.cardId))
  const pool = untappedSources(board, me, cardFor)
  const step = STEPS.find((s) => s.id === board.step) ?? STEPS[0]
  const myTurn = board.active === me
  const inCombat = COMBAT_STEPS.includes(board.step)
  const commander = deck.commanders?.length ? lookup(deck.commanders[0]) : null
  // At the engine's table the command zone is the engine's to say (M6): what is
  // in it now, which is nothing while the commander is on the battlefield.
  const commandCard = (who) => (engine ? zoneOf(board, who, 'command')[0] ?? null : null)
  // What the command zone's tile says of what is in it: its name, and where it
  // stands in for a commander the engine does not know, that it is a stand-in and
  // for which (HANDOFF.md §3 item 19), which the tile also shows in a word.
  const commandName = (inst) => `${nameFor(inst)}${inst.standsFor ? `, a stand-in for ${inst.standsFor}, not the deck's real commander` : ''}`
  // The commander a tap on the command zone casts, where the engine offers it.
  const castable = (who) => (engine && who === me ? zoneOf(board, me, 'command').find((inst) => offerFor(inst.id)) ?? null : null)
  const refusal = engine ? held.refusal : room ? shared.refusal : run.refusal
  // Whether the first-strike damage step happens at all this turn (510.4),
  // read off the creatures on the table rather than asked for.
  const hasFirstStrike = zoneOf(board, me, 'battlefield').some((inst) => /\b(first strike|double strike)\b/i.test(cardFor(inst)?.oracle_text ?? ''))
  const others = away ? board.players.filter((p) => p !== me) : []
  const seatOf = (p) => {
    if (engine) {
      const s = held.seats.find((x) => x.engineSeat === p) ?? null
      return s ? { ...s, here: s.here || Boolean(s.ai) } : null
    }
    return shared.seats.find((s) => s.seat === p) ?? null
  }
  const nameOfSeat = (p) => seatOf(p)?.name ?? (engine ? 'The engine' : `Seat ${p.replace(/^p/, '')}`)
  // Whether commander damage can lose this game (lib/engine/commander.js,
  // `damageLoses`): not a Duel Commander or a Brawl game (§3 item 20), whose rules
  // have no such loss, and where Argentum's tally counts towards nothing, so the
  // plates say nothing of it. The log says so once, at the deal.
  const tallied = !engine || damageLoses(held.game)
  // Whose a commander is, for a plate telling two tallies of one name apart
  // (lib/engine/commander.js, `damageWords`): its owner, read off the card, or
  // the controller the engine names for it where the card is out of sight.
  const whoseCommander = (d) => {
    const owner = board.cards[d?.commander]?.owner ?? d?.controller ?? null
    if (!owner) return null
    if (owner === me) return 'your'
    const seat = nameOfSeat(owner)
    return `${seat.startsWith('The ') ? `the ${seat.slice(4)}` : seat}'s`
  }
  // What glows, and what each glow says (lib/engine/glow.js). Only the
  // engine's table has any: the table played by hand knows nothing of what a
  // card can do, and says so rather than guessing.
  const glows = engine ? glowsAt({ status, me, zoneOf: (id) => board.cards[id]?.zone, chosen, blocks, blocker, can, choosing }) : NO_GLOW
  const glowOf = (id) => glows.get(id) ?? null
  // Where a card is and whose it is, for the words that say where something is.
  const placeOf = (id) => { const inst = board.cards[id]; return inst ? { zone: inst.zone, owner: inst.owner ?? inst.controller ?? null } : null }
  // Plays the engine offers for a card in a pile rather than in hand or on the
  // battlefield: a flashback in the graveyard. No tap on the table reaches
  // them, so the prompt names them and the pile's tile says it holds one.
  const elsewhere = engine ? offeredElsewhere(status, (id) => board.cards[id]?.zone, can) : []
  /**
   * What a pile's tile says it holds, when something in it is part of what the
   * engine is asking now: a legal target (a trigger aimed at a card in a
   * graveyard), a card something else being chosen can take (a cost exiling
   * from the graveyard), or a card with a play on offer. The tile is where a
   * player looks for a pile, and the cards inside glow only once it is opened,
   * so the tile carries the edge and the words.
   */
  const pileHolds = (who, zone) => (engine ? pileHolding(board.zones[who]?.[zone] ?? [], glows, elsewhere) : null)

  /*
   * One tap. In hand it plays the card; on the battlefield it taps it; in a
   * pile it picks it up, because a pile card has no one obvious thing to
   * do. While something is being pointed at, the tap is the far end of the
   * pointing instead, and the aim is spent either way.
   */
  const touch = (id) => {
    if (justDragged()) return
    if (aiming) {
      const { id: from, mode } = aiming
      setAiming(null)
      if (id === from) return
      if (mode === 'attach') doAction({ type: 'attach', id: from, to: id })
      else doAction({ type: 'arrow', from, to: id, kind: mode })
      return
    }
    const inst = board.cards[id]
    if (!inst) return
    setSelected(id)
    if (engine) { touchHeld(id, inst); return }
    if (inst.zone === 'hand') play(id)
    else if (inst.zone === 'battlefield') doAction({ type: 'tap', id })
    else setPanel('actions')
  }
  /*
   * One tap, at the engine's table. While something is being chosen, the tap
   * answers it (`answerTap`); otherwise a card in hand is played through the
   * offer the engine made for it; a creature is gathered into the attack or the
   * block being declared; a permanent with an ability the engine offers
   * activates it. Anything else picks the card up, as a hold does.
   */
  const touchHeld = (id, inst) => {
    if (choosing) { answerTap(id); return }
    if (inst.zone === 'hand') { play(id); return }
    // A commander in the command zone is cast by a tap on it, as a card in hand
    // is played (M6); with nothing offered for it, the tap picks it up.
    if (inst.zone === 'command' && offerFor(id)) { play(id); return }
    if (inst.zone === 'battlefield') {
      if (declaring?.validAttackers?.includes(id)) {
        setChosen((was) => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next })
        return
      }
      if (blocking) {
        if (blocking.validBlockers?.includes(id)) { setBlocker(blocker === id ? null : id); return }
        if (blocker && board.arrows.some((a) => a.kind === 'attack' && a.from === id)) {
          setBlocks((was) => ({ ...was, [blocker]: [id] }))
          setBlocker(null)
          return
        }
      }
      const abilities = offers.filter((a) => a.card === id && a.type === 'ActivateAbility' && !a.mana && a.affordable)
      const ability = abilities.find((a) => !heldBack(a, can))
      if (ability) { choose(ability); return }
      if (abilities.length) { held.refuse(cannotDo(abilities[0], nameOf(board, id, lookup), can)); return }
    }
    setPanel('actions')
  }
  /*
   * A pick for what is being chosen, from a tap on the table or a button in
   * the prompt. A step that takes one thing and now has it goes straight on
   * (`complete`), as a trigger's single target always has; the last step sends
   * the whole choice, as a play's `act` or a decision's answer.
   */
  const pick = (id) => {
    const next = toggle(choosing, id)
    if (complete(next)) goOn(next)
    else setChoosing(next)
  }
  /*
   * A tap, or a card dragged from hand, while something is being chosen: it
   * picks what the step can take — a target, a card to pay with, a card to
   * select or to put on the bottom — and says why not where it cannot. A tap on
   * the source of the play being chosen lets the play go, but only where the
   * step cannot take it: an ability's source may pay its own cost or be its own
   * target (`pickable`), and there the tap picks it (found in M4's review,
   * where it let the play go and the only way on was the engine's choice).
   */
  const answerTap = (id) => {
    if (pickable(choosing).includes(id)) { pick(id); return }
    if (choosing.from === 'play' && id === choosing.source) { setChoosing(null); return }
    held.refuse(notPickable(stepOf(choosing), nameOf(board, id, lookup), choosing.from === 'play' ? nameOf(board, choosing.source, lookup) : status?.decision?.source))
  }
  answerTapRef.current = answerTap
  // A play and the cards put on the bottom are offers, sent as the offer's act;
  // anything else being chosen is a decision's answer.
  const offered = (ch) => ch?.from === 'play' || ch?.from === 'bottom'
  const goOn = (ch = choosing) => {
    const { ch: next, done } = advance(ch)
    if (!done) { setChoosing(next); return }
    setChoosing(null)
    if (offered(next)) held.act(next.offer.index, answerOf(next))
    else held.decide(answerOf(next))
  }
  // "Let the engine choose": the play's choices made by the engine for the
  // player, every one of them, those already made here included, since the
  // engine chooses a play whole and reads nothing sent beside `auto`; the cards
  // to put on the bottom picked by it; or the decision answered by it
  // (Server.kt, `auto`). The prompt says which.
  const chooseForMe = () => {
    const ch = choosing
    setChoosing(null)
    if (offered(ch)) held.act(ch.offer.index, { auto: true })
    else held.decide({ auto: true })
  }
  // The long way in: pick the card up without doing anything to it.
  const hold = (id) => { setSelected(id); setAiming(null); setPanel('actions') }
  holdRef.current = hold
  // `at` is the element under the pointer, which the preview measures afresh each time it is placed.
  const hoverCard = (id, at) => { if (id && board.cards[id]) peekAt(cardFor(board.cards[id]), at); else peekOff() }
  const aimAt = (mode) => { setAiming({ id: selected, mode }); setPanel(null) }

  const choosePrinting = (print, finish) => {
    const from = selectedInst?.cardId
    setPanel('actions')
    if (!from || !print?.id || from === print.id) return
    remember(print)
    doAction({ type: 'reprint', from, to: print.id, finish })
    // The printing just chosen is in hand, so its name is stamped on the deck
    // with it (see stampNames): the swap is a save of the deck either way.
    const next = stampNames(swapPrinting(deck, from, print.id), (id) => (id === print.id ? print : null))
    if (next !== deck) { setDeck(next); saveDeck(next) }
  }
  const makeToken = ({ cardId = null, card = null, custom = null }) => {
    if (card) remember(card)
    doAction({ type: 'makeToken', cardId, custom })
    setPanel(null)
  }
  const dealAgain = () => { setSelected(null); setAiming(null); setPanel(null); setPeeking(0); setMulligans(0); setLocalKept(false); setLocalRun(fresh()) }
  const mulligan = () => { setMulligans(mulligans + 1); doAll(mulliganActions(board, { player: me, seed: Math.floor(Math.random() * 1e9) })) }
  const openZone = (zone, who = me) => setPanel(panel === `zone:${zone}@${who}` ? null : `zone:${zone}@${who}`)
  const [zoneOpen, zoneWho] = panel?.startsWith('zone:') ? panel.slice(5).split('@') : [null, null]

  return (
    // `game--still` is the app's own reduced-motion setting, which the
    // stylesheet cannot read the way it reads the system's.
    <div className={`game${drag ? ' game--carrying' : ''}${away ? ' game--shared' : ''}${engine ? ' game--held' : ''}${reduced ? ' game--still' : ''}`} ref={rootRef}>
      {drag && drag.moved && drag.from !== 'battlefield' && board.cards[drag.id] && (
        <div className="carried" style={{ left: `${drag.x}px`, top: `${drag.y}px` }} aria-hidden="true">
          <BoardCard card={cardFor(board.cards[drag.id])} name={nameFor(board.cards[drag.id])} inst={board.cards[drag.id]} size="hand" dragging />
        </div>
      )}

      {/* --- the seat opposite ------------------------------------------- */}
      {others.length === 0 ? (
        <div className="game__them">
          <Plate who="them" status="Open seat" name="Nobody yet" life={null} />
          <p className="game__theirhand faint tiny">Nobody sits here yet. Opponents arrive with the engine.</p>
          <div className="ztiles ztiles--them" aria-hidden="true">
            {PILES.map((zone) => (
              <span key={zone} className="ztile ztile--empty">
                <span className="ztile__label">{TILE_LABELS[zone]}</span>
                <span className="ztile__face" />
              </span>
            ))}
          </div>
        </div>
      ) : others.map((them) => {
        const sitting = seatOf(them)
        // A paced table stops after each of the engine's plays and says it is
        // waiting on itself; the plate says so in words, where the seat's own
        // state is already read, and the prompt panel says nothing, as
        // Moxgate's does (docs/MOXGATE_STUDY.md; HANDOFF.md, M2). It says the
        // same once a press of yours has gone unanswered for a while: at a
        // level that searches, what follows a move can take seconds (M3), and
        // it is the engine's seat that is taking them.
        const thinking = thinkingAt(status, them) || Boolean(engine && held.slow && sitting?.ai && !status?.over)
        const theirHand = handOf(board, them).length
        const theirCommander = zoneOf(board, them, 'command')[0]
        const face = theirCommander && showImages ? artUrl(cardFor(theirCommander)) : null
        return (
          <div className={`game__them game__them--seated${sitting?.here ? '' : ' game__them--away'}`} key={them} data-seat={them}>
            <Plate
              who="them"
              status={thinking ? THINKING : !sitting ? 'Open seat' : !sitting.here ? 'Away' : opening ? 'Waiting' : board.active === them ? 'Their turn' : 'Waiting'}
              thinking={thinking}
              active={board.active === them}
              target={glows.get(them)?.kind === 'target'}
              name={nameOfSeat(them)}
              life={sitting ? board.life[them] : null}
              damage={tallied ? board.engine?.commanderDamage?.[them] ?? null : null}
              whose={whoseCommander}
            />
            <div className="game__theirhand" aria-label={`${nameOfSeat(them)}'s hand, ${theirHand} card${theirHand === 1 ? '' : 's'}`} role="img">
              {theirHand ? (
                <span className="backs" aria-hidden="true">
                  {Array.from({ length: Math.min(theirHand, 12) }, (_, i) => <span key={i} className="back" />)}
                  {theirHand > 12 && <span className="backs__more">+{theirHand - 12}</span>}
                </span>
              ) : <span className="faint tiny">{sitting ? 'Nothing in hand' : 'Nobody sits here yet'}</span>}
            </div>
            <div className="ztiles ztiles--them" role="group" aria-label={`${nameOfSeat(them)}'s zones`}>
              {PILES.map((zone) => {
                const n = zone === 'library' ? librarySize(board, them) : zoneOf(board, them, zone).length
                // A command zone is public (CR 903.6 puts the commander there face
                // up), so at the engine's table it can be looked through, and its
                // tile names what is in it.
                const led = zone === 'command' ? commandCard(them) : null
                const open = PUBLIC_PILES.includes(zone) || Boolean(engine && zone === 'command')
                const Tag = open ? 'button' : 'span'
                const holds = pileHolds(them, zone)
                return (
                  <Tag
                    key={zone}
                    data-zone={zone}
                    // A pile nobody may look through is not a control, and a
                    // bare span is a role that may not be named: it is a
                    // picture of a pile with a count, and says so, or its
                    // label is thrown away (found by the axe sweep, 2026-09-22).
                    role={open ? undefined : 'img'}
                    className={`ztile${open ? '' : ' ztile--closed'}${zoneOpen === zone && zoneWho === them ? ' ztile--open' : ''}${holds ? ` ztile--${holds === 'target' || holds === 'choice' ? 'target' : 'playable'}` : ''}`}
                    onClick={open ? () => openZone(zone, them) : undefined}
                    aria-expanded={open ? zoneOpen === zone && zoneWho === them : undefined}
                    aria-label={`${nameOfSeat(them)}'s ${ZONE_LABELS[zone].toLowerCase()}, ${n} card${n === 1 ? '' : 's'}${led ? `: ${commandName(led)}` : ''}${holds ? `, ${PILE_SAYS[holds]}` : ''}`}
                  >
                    <span className="ztile__label" aria-hidden="true">{TILE_LABELS[zone]}</span>
                    <span className={`ztile__face${zone === 'library' && n ? ' ztile__face--back' : ''}`} style={zone === 'command' && face ? { backgroundImage: `url("${face}")` } : undefined} aria-hidden="true">
                      {!n && <span className="ztile__nil">—</span>}
                    </span>
                    {n > 0 && <span className="ztile__count" aria-hidden="true">{n}</span>}
                    {led?.standsFor && <span className="ztile__standin" aria-hidden="true">stand-in</span>}
                  </Tag>
                )
              })}
            </div>
            <div className="game__theirfield">
              <Field
                fieldRef={{ current: null }}
                board={shownBoard}
                lookup={lookup}
                player={them}
                selectedId={selected}
                drag={null}
                aiming={aiming}
                onBegin={() => {}}
                onSelect={touch}
                onContext={hold}
                onHover={hoverCard}
                onBackground={() => { if (panel === 'actions') setPanel(null) }}
                images={showImages}
                tile
                mirror
                glowOf={glowOf}
              />
            </div>
          </div>
        )
      })}

      {/* --- the battlefield ---------------------------------------------- */}
      <div className={`game__field${kept ? '' : ' game__field--prompt'}`}>
        {((room && shared.status !== 'open') || (engine && held.wireStatus !== 'open')) && (
          <div className="banner banner--warn" role="status">
            {(room ? shared.status : held.wireStatus) === 'reconnecting' ? 'Lost the table for a moment. Reconnecting…' : 'Connecting to the table…'}
            {' '}Nothing you press will happen until it is back.
          </div>
        )}
        {engine && held.gone && (
          <div className="banner banner--warn" role="alert">The engine has gone: {held.gone}</div>
        )}
        {/* The game coming back after a restart (M7): no prompt is shown, since
            there is no engine to take a press, and this says why. */}
        {engine && held.restoring && !held.gone && (
          <div className="banner banner--warn game__restoring" role="status">{restoringLine(held.restoring)}</div>
        )}
        {missing.length > 0 && (
          <div className="banner banner--warn">
            {missing.length} card{missing.length === 1 ? '' : 's'} in this deck could not be loaded, so
            {missing.length === 1 ? ' it is' : ' they are'} on the table without a name or a painting.
          </div>
        )}
        {/* What Scryfall has done with a printing this deck holds. Both arrive
            after the deal, so both are announced. */}
        {moved.length > 0 && (
          <div className="banner banner--info stack stack--snug" role="status">
            {movedTableNote(moved).map((line, i) => <span key={i}>{line}</span>)}
          </div>
        )}
        {gone.length > 0 && (
          <div className="banner banner--warn stack stack--snug" role="status">
            {goneTableNote(gone).map((line, i) => <span key={i}>{line}</span>)}
          </div>
        )}
        {loading && <p className="faint tiny m0">Loading the paintings…</p>}
        {refusal && <div className="banner banner--info" role="status">{refusal.message}</div>}
        <Field
          fieldRef={fieldRef}
          board={shownBoard}
          lookup={lookup}
          player={me}
          selectedId={selected}
          drag={drag}
          aiming={aiming}
          onBegin={begin}
          onSelect={touch}
          onContext={hold}
          onHover={hoverCard}
          onNudge={nudge}
          onBackground={() => { if (!justDragged()) { setAiming(null); if (panel === 'actions') setPanel(null) } }}
          images={showImages}
          tile
          glowOf={glowOf}
        />
        {aiming && (
          <div className="banner banner--info row row--wrap game__aim" role="status">
            <span style={{ flex: '1 1 12rem' }}>
              {aiming.mode === 'attach'
                ? `Pick the card to put ${nameOf(board, aiming.id, lookup)} on.`
                : `Pick what ${nameOf(board, aiming.id, lookup)} is ${aiming.mode === 'attack' ? 'attacking' : 'pointing at'}.`}
            </span>
            <button className="btn btn--ghost btn--sm" onClick={() => setAiming(null)}>Never mind</button>
          </div>
        )}
        {!kept && hand.length > 0 && (
          <OpeningHand count={hand.length} mulligans={mulligans} onMulligan={mulligan} onKeep={() => setKept(true)} />
        )}
        {/* A slow answer is the engine thinking, and the prompt says nothing
            while it does, as it says nothing at one of the engine's own stops. */}
        {engine && status && !held.slow && (
          <EnginePrompt
            status={status}
            me={me}
            step={step}
            chosen={chosen}
            blocks={blocks}
            blocker={blocker}
            declaring={declaring}
            blocking={blocking}
            glows={glows}
            elsewhere={elsewhere}
            placeOf={placeOf}
            players={board.players}
            nameOf={(id) => nameOf(board, id, lookup)}
            standsForOf={(id) => board.cards[id]?.standsFor ?? null}
            nameOfSeat={nameOfSeat}
            can={can}
            choosing={choosing}
            onPick={pick}
            onChange={setChoosing}
            onDone={() => goOn()}
            onChooseForMe={chooseForMe}
            onLetGo={() => setChoosing(null)}
            handSize={hand.length}
            active={board.active}
            onAct={(index, extra) => held.act(index, extra)}
            onDecide={(params) => held.decide(params)}
          />
        )}
      </div>

      {/* --- your seat ---------------------------------------------------- */}
      <div className="game__you">
        <div className="game__seat">
          <Plate
            who="you"
            status={opening ? 'Opening hand' : myTurn ? step.name : 'Waiting'}
            active={myTurn}
            target={glows.get(me)?.kind === 'target'}
            name={away ? (prefs.playerName || 'You') : 'You'}
            life={board.life[me]}
            onLife={engine ? undefined : (delta) => doAction({ type: 'life', delta })}
            damage={tallied ? board.engine?.commanderDamage?.[me] ?? null : null}
            whose={whoseCommander}
          >
            <div className="plate__mana">
              <span className="plate__label">Untapped sources</span>
              {pool.count ? <Pool pool={pool} /> : <span className="faint tiny">None untapped</span>}
            </div>
          </Plate>
          <nav className="rail" aria-label="Actions">
            <button className={`rail__btn${panel === 'actions' ? ' rail__btn--on' : ''}`} onClick={() => setPanel(panel === 'actions' ? null : 'actions')} aria-expanded={panel === 'actions'}>
              Actions
            </button>
            {!engine && (
              <button className="rail__btn" onClick={() => doAction(inCombat ? { type: 'step' } : { type: 'step', to: 'beginCombat' })}>
                {inCombat ? '⚔ Next step' : '⚔ Combat'}
              </button>
            )}
            {engine ? (
              <button
                className="rail__btn rail__btn--go"
                onClick={() => { const pass = offers.find((a) => a.type === 'PassPriority'); if (pass) held.act(pass.index) }}
                disabled={!offers.some((a) => a.type === 'PassPriority')}
                title={held.restoring ? restoringLine(held.restoring) : myStop ? undefined : 'The engine is not waiting on you.'}
                aria-keyshortcuts="Space"
              >
                → Pass
              </button>
            ) : (
              <button
                className="rail__btn rail__btn--go"
                onClick={() => (room ? doAction({ type: 'nextTurn' }) : doAll([{ type: 'nextTurn' }, { type: 'untapAll' }]))}
                disabled={room && !myTurn}
                title={room && !myTurn ? 'Only the player whose turn it is can end it.' : undefined}
              >
                → End turn
              </button>
            )}
            <button
              className="rail__btn"
              onClick={() => setLocalRun((r) => undo(r))}
              disabled={away ? true : !run.past.length}
              title={engine ? 'The engine keeps the rules; there is nothing to wind back by hand.' : room ? 'A shared table is not only yours to wind back. Ask, and move it back by hand.' : undefined}
            >
              ↶ Undo
            </button>
            <button className={`rail__btn${panel === 'more' ? ' rail__btn--on' : ''}`} onClick={() => setPanel(panel === 'more' ? null : 'more')} aria-expanded={panel === 'more'} aria-label="More">
              …
            </button>
          </nav>
        </div>

        <section className="game__hand" aria-label={`Your hand, ${hand.length} card${hand.length === 1 ? '' : 's'}`}>
          {kept && mulligans > 0 && (
            <span className="chip tiny game__owed">{mulligans} mulligan{mulligans === 1 ? '' : 's'}: put {Math.min(mulligans, OPENING_HAND)} on the bottom</span>
          )}
          {!hand.length ? (
            <p className="faint tiny m0">Nothing in hand.</p>
          ) : (
            <div className="tabletop__handrow" style={{ '--overlap': spread.overlap, '--span': spread.span }}>
              {hand.map((inst, i) => (
                <span
                  className="tabletop__handcard"
                  key={inst.id}
                  data-id={inst.id}
                  style={{ '--angle': `${spread.cards[i].angle}deg`, '--drop': spread.cards[i].drop, '--badge': spread.cards[i].badge, '--i': i }}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') hoverCard(inst.id, e.currentTarget) }}
                  onPointerLeave={() => hoverCard(null)}
                >
                  <HandCost card={cardFor(inst)} pool={pool} />
                  <BoardCard
                    card={cardFor(inst)}
                    name={nameFor(inst)}
                    inst={inst}
                    size="hand"
                    tilt={!reduced}
                    images={showImages}
                    glow={glowOf(inst.id)}
                    selected={selected === inst.id}
                    onPointerDown={(e) => begin(e, { id: inst.id, from: 'hand' })}
                    onClick={() => touch(inst.id)}
                    onContextMenu={(e) => { e.preventDefault(); hold(inst.id) }}
                  />
                  {board.revealed.includes(inst.id) && <span className="tabletop__revealed chip tiny">revealed</span>}
                </span>
              ))}
            </div>
          )}
        </section>

        <div className="ztiles" role="group" aria-label="Your zones">
          {PILES.map((zone) => {
            const n = zone === 'library' ? librarySize(board, me) : zoneOf(board, me, zone).length
            // At the engine's table the command zone shows what the engine says is
            // in it (M6); alone and at a shared table, the deck's own commander.
            const led = zone === 'command' ? commandCard(me) : null
            const face = zone === 'command' && showImages ? artUrl(engine ? (led ? cardFor(led) : null) : commander) : null
            const isOpen = zoneOpen === zone && zoneWho === me
            const holds = pileHolds(me, zone)
            // A tap on the command zone casts the commander where the engine offers
            // it, as a tap on a card in hand plays it (Law 2); the zone is still
            // looked through the long way in — a hold (useHold, since a phone has
            // no right-click), a right-click, or Shift+Enter from the keyboard —
            // each said in its label. While a tap casts, the tile discloses
            // nothing, so it says no `aria-expanded` (found in M6's review).
            const casts = zone === 'command' ? castable(me) : null
            const tapCasts = Boolean(casts && !choosing)
            return (
              <button
                key={zone}
                data-zone={zone}
                className={`ztile${isOpen ? ' ztile--open' : ''}${holds ? ` ztile--${holds === 'target' || holds === 'choice' ? 'target' : 'playable'}` : ''}`}
                onClick={() => { if (zone === 'command' && tileJustHeld()) return; if (tapCasts) play(casts.id); else openZone(zone) }}
                onContextMenu={tapCasts ? (e) => { e.preventDefault(); if (!tileJustHeld()) openZone(zone) } : undefined}
                onPointerDown={tapCasts ? (e) => holdTile(e, zone) : undefined}
                onKeyDown={tapCasts ? (e) => { if (e.key === 'Enter' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openZone(zone) } } : undefined}
                onPointerEnter={led ? (e) => { if (e.pointerType === 'mouse') hoverCard(led.id, e.currentTarget) } : undefined}
                onPointerLeave={led ? () => hoverCard(null) : undefined}
                aria-expanded={tapCasts ? undefined : isOpen}
                aria-keyshortcuts={tapCasts ? 'Shift+Enter' : undefined}
                aria-label={`${ZONE_LABELS[zone]}, ${n} card${n === 1 ? '' : 's'}${led ? `: ${commandName(led)}` : ''}${holds ? `, ${PILE_SAYS[holds]}` : ''}${tapCasts ? `, ${OPENS_INSTEAD}` : ''}`}
              >
                <span className="ztile__label" aria-hidden="true">{TILE_LABELS[zone]}</span>
                <span className={`ztile__face${zone === 'library' && n ? ' ztile__face--back' : ''}`} style={face ? { backgroundImage: `url("${face}")` } : undefined} aria-hidden="true">
                  {!n && <span className="ztile__nil">—</span>}
                </span>
                {n > 0 && <span className="ztile__count" aria-hidden="true">{n}</span>}
                {led?.standsFor && <span className="ztile__standin" aria-hidden="true">stand-in</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* --- the side column: the log, and whatever is open --------------- */}
      <aside className="game__side">
        {away && (
          <section className="pile game__seats" aria-label="Who is at the table">
            <h2 className="pile__title">Table <span className="chip tiny">{room ?? engine}</span></h2>
            <ul className="game__seatlist" role="list">
              {board.players.map((p) => {
                const s = seatOf(p)
                // A stand-in leading a seat's deck (§3 item 19): yours, and the engine's copy of it.
                const lead = engine ? (p === me ? held.leads.own : s?.ai ? held.leads.engine : null) : null
                return (
                  <li key={p} className={`game__seatrow${p === me ? ' game__seatrow--you' : ''}${s && !s.here ? ' game__seatrow--away' : ''}`}>
                    <span className="game__dot" aria-hidden="true" />
                    {/* The engine's seat says the level the room says it plays at, and nothing where it named none. */}
                    <span>
                      {p === me ? 'You' : s ? s.name : 'Open seat'}{s?.ai && levelOf(s.level) ? ` · ${LEVEL_NAMES[s.level]}` : ''}
                      {lead && <span className="faint tiny"> · led by {standInPhrase(lead)}</span>}
                    </span>
                    <span className="faint tiny">{!s ? '' : !s.here ? 'away' : board.active === p ? (p === me ? 'your turn' : 'their turn') : ''}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        <GameLog board={board} events={run.events} lookup={lookup} restored={run.restored} you={me} who={away ? nameOfSeat : null} />
        {/*
          Where you are in the turn, taught from the rules by number. Moxgate's
          prompt panel says "Your upkeep" and a teaching line at every stop;
          this says the same without stopping anyone, and cites the rule,
          which is the difference between being told and being shown.
        */}
        <TurnTracker
          board={board}
          hasFirstStrike={hasFirstStrike}
          open={turnsOpen}
          onToggle={() => setTurnsOpen(!turnsOpen)}
          onStep={engine ? undefined : (options) => doAction({ type: 'step', ...options })}
          onJump={engine ? undefined : (to) => doAction({ type: 'step', to })}
        />
        {prefs.tableCoach && <Coach board={board} events={run.events} lookup={lookup} player={me} onSilence={() => togglePref('tableCoach')} />}

        <StackShelf
          board={board}
          // The engine keeps one stack for the table, filed under one seat's
          // id; at a table played by hand each seat's is its own.
          players={engine ? board.players : [me]}
          nameFor={nameFor}
          cardFor={cardFor}
          glowOf={glowOf}
          onSelect={touch}
          // The engine resolves the stack itself; a button saying otherwise
          // would only be refused.
          onResolve={engine ? null : (inst) => {
            const card = cardFor(inst)
            doAction(card && isPermanent(card, inst)
              ? { type: 'move', id: inst.id, zone: 'battlefield' }
              : { type: 'move', id: inst.id, zone: 'graveyard' })
          }}
          onCounter={engine ? null : (inst) => doAction({ type: 'move', id: inst.id, zone: 'graveyard' })}
        />

        {panel === 'actions' && engine && (
          <EngineActions
            offers={offers}
            selected={selectedInst}
            name={selectedInst ? nameFor(selectedInst) : null}
            card={selectedInst ? cardFor(selectedInst) : null}
            myStop={myStop}
            restoring={held.restoring}
            can={can}
            onAct={(offer) => choose(offer)}
            onInspect={() => { const card = selectedInst ? cardFor(selectedInst) : null; if (card) onOpenCard(card) }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'actions' && !engine && (
          selectedInst ? (
            <Actions
              inst={selectedInst}
              name={nameFor(selectedInst)}
              card={cardFor(selectedInst)}
              host={hostOf(board, selectedInst.id)}
              mine={selectedInst.controller === me || selectedInst.owner === me}
              permanent={!board.guided || !cardFor(selectedInst) || isPermanent(cardFor(selectedInst), selectedInst)}
              onDo={(action) => doAction(action)}
              onAim={aimAt}
              onInspect={() => { const card = cardFor(selectedInst); if (card) onOpenCard(card) }}
              onPrintings={() => setPanel('printings')}
              onClose={() => setPanel(null)}
            />
          ) : (
            <section className="actions" aria-label="Actions">
              <p className="faint tiny m0">Nothing picked up. Tap a card to play or tap it; hold one to pick it up without doing anything.</p>
            </section>
          )
        )}

        {panel === 'printings' && selectedInst && cardFor(selectedInst) && (
          <Printings card={cardFor(selectedInst)} finish={selectedInst.finish} onChoose={choosePrinting} onClose={() => setPanel('actions')} />
        )}

        {panel === 'token' && (
          <TokenMaker colors={commander?.color_identity ?? []} onMake={makeToken} onClose={() => setPanel('more')} />
        )}

        {zoneOpen && (
          <section className="pile" aria-label={ZONE_LABELS[zoneOpen]}>
            <h2 className="pile__title">
              {zoneWho !== me ? `${nameOfSeat(zoneWho)}'s ${ZONE_LABELS[zoneOpen].toLowerCase()}` : ZONE_LABELS[zoneOpen]}
              <span className="chip tiny">{zoneOpen === 'library' ? librarySize(board, zoneWho) : zoneOf(board, zoneWho, zoneOpen).length}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => setPanel(null)}>Close</button>
            </h2>
            {zoneOpen === 'library' && zoneWho === me ? (
              <Library
                board={board}
                player={me}
                nameFor={nameFor}
                cardFor={cardFor}
                peeking={peeking}
                onPeek={() => setPeeking(peeking ? 0 : 3)}
                onShuffle={() => doAction({ type: 'shuffle' })}
                onDraw={() => doAction({ type: 'draw' })}
                onDo={doAction}
                selected={selected}
                onSelect={touch}
              />
            ) : (
              <ZoneBrowser
                label={ZONE_LABELS[zoneOpen].toLowerCase()}
                instances={zoneOf(board, zoneWho, zoneOpen).slice().reverse()}
                cardFor={cardFor}
                nameFor={nameFor}
                selected={selected}
                onSelect={touch}
                glowOf={glowOf}
              />
            )}
          </section>
        )}

        {panel === 'more' && (
          <More
            board={board}
            player={me}
            prefs={prefs}
            shared={away}
            held={Boolean(engine)}
            leftOut={engine ? held.leftOut : []}
            sideboardLeftOut={engine ? held.sideboardLeftOut : []}
            onDo={doAction}
            onToken={() => setPanel('token')}
            onMulligan={() => setAsking('mulligan')}
            onDealAgain={() => setAsking('deal')}
            onTogglePref={togglePref}
            onLeave={() => navigate({ tab: 'game', gameDeckId: null, gameRoom: null, gameEngine: null })}
          />
        )}
        {/*
          Every tile on this screen is a painting cropped out of its card, and
          a cropped painting has lost the artist's name and the copyright line
          that the printed card carries. So the screen carries them instead:
          the artist beside each selected card, the rest here.
        */}
        {/* The sources named as well, in the shape Moxgate's own footer names
            Scryfall and its engine (SOURCES.md, "The Grok handoff pack"). */}
        <p className="faint tiny game__credit">
          Card art and names are the property of Wizards of the Coast and the artists named on each card,
          shown under the Fan Content Policy. Unofficial, and not endorsed by Wizards. Card data and imagery
          from Scryfall.
          {engine && ' Rules-enforced play is powered by Argentum, an independent open-source rules engine, used under the MIT licence.'}
        </p>
      </aside>
      <Peek peek={peek} avoid={pressable} />

      {/* The house style: the title is the situation, the body the consequence, the buttons what they do. */}
      <Confirm
        open={asking === 'deal'}
        title="Deal again"
        onClose={() => setAsking(null)}
        actions={[
          { label: 'Deal a new hand', kind: 'primary', onPress: () => { setAsking(null); dealAgain() } },
          { label: 'Keep playing', kind: 'ghost', onPress: () => setAsking(null) },
        ]}
      >
        This game ends here. Every card goes back into the deck, it is shuffled, and seven are dealt again. The log starts over.
      </Confirm>
      <Confirm
        open={asking === 'mulligan'}
        title="Mulligan"
        onClose={() => setAsking(null)}
        actions={[
          { label: 'Take the mulligan', kind: 'primary', onPress: () => { setAsking(null); mulligan() } },
          { label: 'Keep this hand', kind: 'ghost', onPress: () => setAsking(null) },
        ]}
      >
        Your hand goes back, the library is shuffled, and you draw seven again. After keeping, you owe {Math.min(mulligans + 1, OPENING_HAND)} to the bottom.
      </Confirm>
    </div>
  )
}

// --- the pieces ------------------------------------------------------------

/**
 * A life plate: the status word or phase pill, the name, the life with its
 * steppers, and whatever the seat wants under it. The active seat wears a
 * ring, which is how Moxgate says whose turn it is without a word.
 *
 * `thinking` is the engine taking its own turn a play at a time. It is a
 * sentence rather than a word, so the pill reads as one and is allowed to
 * breathe; the breathing stops under reduced motion, and nothing about the
 * state is said by that motion alone. It is not a live region: the words are
 * the seat's own state, read where the seat is, and a turn's worth of plays
 * announced one after another would talk over a player reading their hand.
 * What the engine did is in the log, which is a record to be read rather
 * than an announcement.
 *
 * `target` is the seat being a legal target of what the engine is asking to
 * aim (lib/engine/glow.js): the plate wears the target edge the cards do, and
 * says so in its label; the prompt offers the seat by name, since a plate is
 * not a card to tap.
 */
function Plate({ who, status, active = false, thinking = false, target = false, name, life, onLife, damage = null, whose = null, children }) {
  // Commander damage at a Commander table (M6), under the life total once any
  // is dealt, in words (lib/engine/commander.js): each commander's tally, told
  // apart by whose it is where two share a name, and what they count towards.
  const dealt = damageWords(damage, { whose })
  const rule = damageRule(damage)
  return (
    <section
      className={`plate plate--${who}${active ? ' plate--active' : ''}${target ? ' plate--target' : ''}`}
      aria-label={`${name}: ${status}${life == null ? '' : `, ${life} life`}${dealt ? `, ${dealt.charAt(0).toLowerCase()}${dealt.slice(1)}` : ''}${target ? ', a legal target' : ''}`}
    >
      <span className={`plate__status${active ? ' plate__status--turn' : ''}${thinking ? ' plate__status--thinking' : ''}`}>{status}</span>
      <span className="plate__name">{name}</span>
      <div className="plate__life">
        {onLife && <button className="plate__step" onClick={() => onLife(-1)} aria-label="Lose 1 life">−</button>}
        <output className="plate__total" aria-label={life == null ? 'No life total' : `${life} life`}>{life ?? '—'}</output>
        {onLife && <button className="plate__step" onClick={() => onLife(1)} aria-label="Gain 1 life">+</button>}
      </div>
      {/* The count, and once beside it what reaching the threshold does, the rule cited (found in M6's review, where only the number was cited). */}
      {dealt && <p className="plate__cmd">{dealt}. {rule}</p>}
      {children}
    </section>
  )
}

/**
 * What the engine offers, as a list: the actions panel at its table. The
 * card last touched comes first; mana abilities are counted rather than
 * listed, because the engine pays for spells itself. While the game is coming
 * back (M7) there is no stop at all, and it says that rather than whose stop
 * it is not.
 */
export function EngineActions({ offers, selected, name, card, myStop, restoring = null, can = NO_CHOICES, onAct, onInspect, onClose }) {
  const listed = offers.filter((a) => !a.mana && a.type !== 'PassPriority')
  const mine = selected ? listed.filter((a) => a.card === selected.id) : []
  const rest = listed.filter((a) => !mine.includes(a))
  const mana = offers.filter((a) => a.mana).length
  // An offer needing a target, or with a choice in its cost, that this seat
  // cannot send is listed, so nothing the engine offers is hidden, but not
  // pressable: the engine would refuse it (lib/engine/glow.js). One this seat
  // can send begins choosing, as a tap on its card does.
  const row = (a) => {
    const held = heldBack(a, can)
    const why = !a.affordable ? 'Not affordable now'
      : held === 'target' ? 'Needs a target, which this table cannot choose yet'
        : held === 'cost' ? 'Needs a choice made for its cost, which this table cannot make yet'
          : undefined
    return (
      <button key={a.index} className={`btn btn--sm ${a.meaningful && !why ? '' : 'btn--ghost'}`} disabled={Boolean(why)} onClick={() => onAct(a)} title={why}>
        {a.description}{a.manaCost ? ` · ${a.manaCost}` : ''}
      </button>
    )
  }
  return (
    <section className="actions" aria-label={name ? `Actions for ${name}` : 'Actions'}>
      <div className="row row--wrap">
        <strong className="actions__name">{name ?? 'What the engine offers'}</strong>
        <span className="faint tiny">{restoring ? 'coming back' : myStop ? 'your stop' : 'not your stop'}</span>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
      </div>
      {card && <div className="row row--wrap"><button className="btn btn--ghost btn--sm" onClick={onInspect}>Read it</button></div>}
      {mine.length > 0 && <div className="row row--wrap">{mine.map(row)}</div>}
      {rest.length > 0 && <div className="row row--wrap">{rest.map(row)}</div>}
      {!listed.length && <p className="faint tiny m0">{restoring ? restoringLine(restoring) : myStop ? 'Nothing but passing is offered here.' : 'The engine is not waiting on you.'}</p>}
      {listed.some((a) => a.affordable && heldBack(a, can) === 'target') && (
        <p className="faint tiny m0">What needs a target cannot be played here yet: this table does not choose targets for a spell or an ability.</p>
      )}
      {listed.some((a) => a.affordable && heldBack(a, can) === 'cost') && (
        <p className="faint tiny m0">
          {can.act.has('cost')
            ? 'What needs a choice made for its cost cannot be played here yet where it is a kind of cost the engine at this table cannot take a choice for.'
            : 'What needs a choice made for its cost cannot be played here yet: this table does not choose what a cost takes, such as a card to discard or a creature to sacrifice.'}
        </p>
      )}
      {mana > 0 && <p className="faint tiny m0">{mana} mana abilit{mana === 1 ? 'y' : 'ies'} the engine pays with itself.</p>}
    </section>
  )
}

/**
 * The opening hand, floating on the battlefield the way Moxgate's does. Not
 * a modal: the hand is right there to look at while deciding.
 *
 * A London mulligan draws seven again and puts one more on the bottom each
 * time. Putting them there is the player's own job afterwards, as in paper;
 * the prompt says how many so it is not forgotten.
 */
function OpeningHand({ count, mulligans, onMulligan, onKeep }) {
  const owed = Math.min(mulligans + 1, OPENING_HAND)
  return (
    <div className="prompt" role="group" aria-label="Opening hand">
      <div className="prompt__lead">
        <strong className="prompt__title">Opening hand</strong>
        <span className="prompt__sub">{count} card{count === 1 ? '' : 's'}{mulligans ? ` · ${mulligans} mulligan${mulligans === 1 ? '' : 's'}` : ''}</span>
      </div>
      <button className="btn btn--sm prompt__btn" onClick={onMulligan}>
        Mulligan
        <span className="prompt__hint">Draw 7 · put {owed} on the bottom</span>
      </button>
      <button className="btn btn--primary btn--sm prompt__btn" onClick={onKeep}>Keep hand →</button>
    </div>
  )
}

/**
 * The stack, as a shelf. The last thing on is the first to resolve, and
 * nothing here resolves on the player's behalf.
 */
function StackShelf({ board, players, nameFor, cardFor, glowOf = () => null, onSelect, onResolve, onCounter }) {
  const waiting = players.flatMap((p) => zoneOf(board, p, 'stack'))
  if (!waiting.length) return null
  const top = waiting[waiting.length - 1]
  return (
    <section className="stackshelf" aria-label={`The stack, ${waiting.length} waiting`}>
      <div className="row row--wrap">
        <h2 className="pile__title">The stack <span className="chip tiny">{waiting.length}</span></h2>
        <span className="spacer" />
        <span className="faint tiny">Last on, first to happen</span>
      </div>
      <ol className="stackshelf__list" role="list">
        {waiting.slice().reverse().map((inst, i) => {
          // A spell on the stack that the engine is asking this seat to aim at
          // is tapped here, as a card on the table is, and says so in words.
          const glow = glowOf(inst.id)
          return (
            <li key={inst.id} className={`stackshelf__item${i === 0 ? ' stackshelf__item--top' : ''}`}>
              <span className="chip tiny">{i === 0 ? 'top' : `${i + 1}`}</span>
              {glow?.kind === 'target' && onSelect ? (
                <button type="button" className="btn btn--sm stackshelf__pick" onClick={() => onSelect(inst.id)}>
                  {nameFor(inst)}<span className="pile__glow"> · {glow.says}</span>
                </button>
              ) : <strong>{nameFor(inst)}</strong>}
              <span className="faint tiny">{cardFor(inst)?.type_line ?? ''}</span>
            </li>
          )
        })}
      </ol>
      {(onResolve || onCounter) && (
        <div className="row row--wrap">
          {onResolve && <button className="btn btn--sm" onClick={() => onResolve(top)}>Resolve {nameFor(top)}</button>}
          {onCounter && <button className="btn btn--ghost btn--sm" onClick={() => onCounter(top)}>It was countered</button>}
        </div>
      )}
    </section>
  )
}

/**
 * Your library, opened from its tile: the things a hand does with a deck.
 * Searching it is what a paper table always allows; shuffling afterwards is
 * the player's job there too, hence the reminder.
 */
function Library({ board, player, nameFor, cardFor, peeking, onPeek, onShuffle, onDraw, onDo, selected, onSelect }) {
  const [searching, setSearching] = useState(false)
  const top = zoneOf(board, player, 'library').slice(0, peeking)
  return (
    <>
      <div className="row row--wrap">
        <button className="btn btn--primary btn--sm" onClick={onDraw}>Draw</button>
        <button className="btn btn--ghost btn--sm" onClick={onShuffle}>Shuffle</button>
        <button className="btn btn--ghost btn--sm" onClick={onPeek} aria-expanded={peeking > 0}>{peeking ? 'Stop looking' : 'Look at the top 3'}</button>
        <button className="btn btn--ghost btn--sm" onClick={() => setSearching(!searching)} aria-expanded={searching}>{searching ? 'Close the search' : 'Search'}</button>
      </div>
      {peeking > 0 && (
        <ol className="peek" aria-label="The top of your library, in order">
          {top.map((inst) => (
            <li key={inst.id} className="peek__card">
              <span>{nameFor(inst)}</span>
              <span className="row">
                <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'move', id: inst.id, zone: 'library', to: 'bottom' })}>Bottom</button>
                <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'move', id: inst.id, zone: 'hand' })}>Hand</button>
                <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'move', id: inst.id, zone: 'graveyard' })}>Graveyard</button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {searching && (
        <>
          <ZoneBrowser label="library" instances={zoneOf(board, player, 'library')} cardFor={cardFor} nameFor={nameFor} selected={selected} onSelect={onSelect} />
          <p className="faint tiny m0">Shuffle when you are done, the way you would in paper.</p>
        </>
      )}
    </>
  )
}

/** Everything a hand can do with a card at a table, and nothing about what the card says. */
const MOVES = [
  { zone: 'battlefield', label: 'To the battlefield' },
  { zone: 'stack', label: 'To the stack' },
  { zone: 'hand', label: 'To hand' },
  { zone: 'graveyard', label: 'To the graveyard' },
  { zone: 'exile', label: 'Exile it' },
  { zone: 'library', to: 'top', label: 'Top of library' },
  { zone: 'library', to: 'bottom', label: 'Bottom of library' },
  { zone: 'command', label: 'To the command zone' },
]

function whereIs(zone) {
  if (zone === 'stack') return 'on the stack'
  if (zone === 'battlefield') return 'on the battlefield'
  return `in the ${ZONE_LABELS[zone].toLowerCase()}`
}

/**
 * The rarer things to do with the card last touched. One press each; the
 * common ones — play it, tap it — never come here, because a tap on the card
 * already did them. Somebody else's card offers only what anyone at a table
 * may do to it: read it, and point at it.
 */
function Actions({ inst, name, card, host, mine = true, permanent = true, onDo, onAim, onInspect, onPrintings, onClose }) {
  const onField = inst.zone === 'battlefield'
  const counters = Object.entries(inst.counters).filter(([, n]) => n)
  const treatment = card ? treatmentOf(card) : null
  const foil = inst.finish !== 'normal'
  return (
    <section className="actions" aria-label={`Actions for ${name}`}>
      <div className="row row--wrap">
        <strong className="actions__name">{name}</strong>
        <span className="faint tiny">
          {whereIs(inst.zone)}
          {host ? ` · on ${host.id === inst.id ? 'itself' : 'another card'}` : ''}
          {mine ? '' : ' · not yours'}
          {card?.artist && !inst.custom ? ` · art by ${card.artist}` : ''}
        </span>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
      </div>
      <div className="row row--wrap">
        {mine && onField && <button className="btn btn--sm" onClick={() => onDo({ type: 'tap', id: inst.id })}>{inst.tapped ? 'Untap' : 'Tap'}</button>}
        {mine && <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'flip', id: inst.id })}>{inst.faceDown ? 'Turn it up' : 'Turn it face down'}</button>}
        {mine && <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'reveal', id: inst.id })}>Reveal</button>}
        {onField && <button className="btn btn--ghost btn--sm" onClick={() => onAim('attack')}>Attacking…</button>}
        {onField && <button className="btn btn--ghost btn--sm" onClick={() => onAim('target')}>Pointing at…</button>}
        {mine && onField && !inst.attachedTo && <button className="btn btn--ghost btn--sm" onClick={() => onAim('attach')}>Put it on…</button>}
        {mine && inst.attachedTo && <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'detach', id: inst.id })}>Take it off</button>}
        {card && <button className="btn btn--ghost btn--sm" onClick={onInspect}>Read it</button>}
        {mine && card && (treatment.foilable || treatment.etchable || foil) && (
          <button
            className="btn btn--ghost btn--sm"
            aria-pressed={foil}
            onClick={() => onDo({ type: 'finish', id: inst.id, value: foil ? 'normal' : finishFor(card, treatment.etchable && !treatment.foilable ? 'etched' : 'foil') })}
          >
            {foil ? 'An ordinary copy' : 'Mine is foil'}
          </button>
        )}
        {mine && card && !inst.token && <button className="btn btn--ghost btn--sm" onClick={onPrintings}>Another printing…</button>}
      </div>
      {mine && onField && (
        <div className="row row--wrap counters">
          {counters.map(([label, n]) => (
            <span className="counters__on" key={label}>
              <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'counter', id: inst.id, name: label, delta: -1 })} aria-label={`One fewer ${label} counter`}>−</button>
              <span className="chip tiny">{n} {label}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'counter', id: inst.id, name: label, delta: 1 })} aria-label={`One more ${label} counter`}>+</button>
            </span>
          ))}
          {DEFAULT_COUNTERS.filter((label) => !inst.counters[label]).map((label) => (
            <button key={label} className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'counter', id: inst.id, name: label, delta: 1 })}>+ {label}</button>
          ))}
        </div>
      )}
      {mine && (
        <div className="row row--wrap">
          {MOVES
            .filter((move) => move.zone !== inst.zone || move.to)
            .filter((move) => move.zone !== 'battlefield' || permanent)
            .map((move) => (
              <button key={`${move.zone}${move.to ?? ''}`} className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'move', id: inst.id, zone: move.zone, to: move.to ?? 'top' })}>
                {move.label}
              </button>
            ))}
        </div>
      )}
    </section>
  )
}

/**
 * Behind the dots on the rail: everything a game needs now and then and a
 * screen should not spend space on all the time.
 */
function More({ board, player, prefs, shared, held = false, leftOut = [], sideboardLeftOut = [], onDo, onToken, onMulligan, onDealAgain, onTogglePref, onLeave }) {
  return (
    <div className="more">
      {held && (
        <section className="pile">
          <h2 className="pile__title">The engine's table</h2>
          <p className="faint tiny m0">
            Drawing, untapping, life, tokens and dice are the engine's here: they happen when the rules say so, and are written in the log.
          </p>
          {leftOut.length > 0 && (
            <p className="faint tiny m0">
              Played without {nameList(leftOut.map((l) => `${l.count} ${l.name}`), Infinity)}, as chosen in the lobby: the engine does not know {leftOut.reduce((sum, l) => sum + l.count, 0) === 1 ? 'it' : 'them'}.
            </p>
          )}
          {sideboardLeftOut.length > 0 && (
            <p className="faint tiny m0">
              Your sideboard is played without {nameList(sideboardLeftOut, Infinity)}: the engine does not know {sideboardLeftOut.length === 1 ? 'it' : 'them'}.
            </p>
          )}
        </section>
      )}
      {!held && <section className="pile">
        <h2 className="pile__title">The turn <span className="chip tiny">Turn {board.turn}</span></h2>
        <div className="row row--wrap">
          <button className="btn btn--sm" onClick={() => onDo({ type: 'draw' })}>Draw</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'step' })}>Next step</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'untapAll' })}>Untap all</button>
          {board.arrows.length > 0 && <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'clearArrows' })}>Clear the arrows</button>}
        </div>
      </section>}
      {!held && <section className="pile">
        <h2 className="pile__title">Life <span className="chip tiny">{board.life[player]}</span></h2>
        <div className="row row--wrap">
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'life', delta: -5 })}>−5</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'life', delta: 5 })}>+5</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'life', value: board.life[player] === 40 ? 20 : 40 })}>Set to {board.life[player] === 40 ? '20' : '40'}</button>
        </div>
        <PlayerCounters board={board} player={player} onChange={(name, delta) => onDo({ type: 'playerCounter', name, delta })} />
      </section>}
      {!held && <section className="pile">
        <h2 className="pile__title">Tokens and dice</h2>
        <div className="row row--wrap">
          <button className="btn btn--ghost btn--sm" onClick={onToken}>Make a token</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'roll', sides: 6, label: 'd6', seed: Math.floor(Math.random() * 1e9) })}>Roll a d6</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'roll', sides: 20, label: 'd20', seed: Math.floor(Math.random() * 1e9) })}>Roll a d20</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'roll', sides: 2, label: 'Coin', seed: Math.floor(Math.random() * 1e9) })}>Flip a coin</button>
        </div>
        {board.dice.length > 0 && (
          <ul className="dice" role="list" aria-label="What was rolled, most recent first">
            {board.dice.slice(0, 5).map((die) => (
              <li key={die.id} className="dice__roll">
                <span className="chip tiny">{die.label || `d${die.sides}`}</span>
                <strong>{die.sides === 2 ? (die.value === 1 ? 'heads' : 'tails') : die.value}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>}
      <section className="pile">
        <h2 className="pile__title">This game</h2>
        <div className="row row--wrap">
          {!held && <button className="btn btn--ghost btn--sm" onClick={onMulligan}>Mulligan</button>}
          {!shared && <button className="btn btn--ghost btn--sm" onClick={onDealAgain}>Deal again</button>}
          <button className="btn btn--ghost btn--sm" onClick={onLeave}>← Lobby</button>
        </div>
        {shared && <p className="faint tiny m0">Leaving keeps your seat: the relay holds the table, and this browser remembers which chair was yours.</p>}
      </section>
      <section className="pile">
        <h2 className="pile__title">This table</h2>
        <div className="row row--wrap">
          <button className="btn btn--ghost btn--sm" onClick={() => onTogglePref('tableCoach')} aria-pressed={prefs.tableCoach}>Notes {prefs.tableCoach ? 'on' : 'off'}</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onTogglePref('tableSound')} aria-pressed={prefs.tableSound}>Sound {prefs.tableSound ? 'on' : 'off'}</button>
          {!shared && (
            <button
              className="btn btn--ghost btn--sm"
              aria-pressed={board.guided}
              onClick={() => { setPref('tablePlaymat', !board.guided); onDo({ type: 'setGuided', value: !board.guided }) }}
            >
              Playmat {board.guided ? 'on' : 'off'}
            </button>
          )}
        </div>
        {/* True of the table played by hand and false of the engine's, where
            every play is checked; the panel above says so there instead. */}
        {!held && (
          <p className="faint tiny m0">
            Nothing here checks whether a play is legal. With the playmat on, a card sits in the row its kind
            belongs in and an instant may not be left on the battlefield; the rest is yours.
          </p>
        )}
      </section>
    </div>
  )
}
