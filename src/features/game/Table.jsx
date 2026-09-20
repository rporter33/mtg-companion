import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../lib/router.js'
import { saveDeck, getGameTable, saveGameTable, getPrefs, setPref } from '../../lib/storage.js'
import { createBoard, handOf, librarySize, zoneOf, nameOf, hostOf, ZONE_LABELS, DEFAULT_COUNTERS } from '../../lib/board/model.js'
import { newRun, act, applyAll, undo, snapshot, restore } from '../../lib/board/runner.js'
import { untappedSources } from '../../lib/board/mana.js'
import { openingActions, mulliganActions, swapPrinting, OPENING_HAND } from '../../lib/board/deck.js'
import { treatmentOf, finishFor } from '../../lib/board/art.js'
import { artUrl } from '../../lib/deck-art.js'
import { laneFor, zoneWhenPlayed, isPermanent } from '../../lib/board/placement.js'
import { fan } from '../../lib/board/geometry.js'
import { prefersReducedMotion } from '../../lib/table/motion.js'
import { STEPS } from '../../data/turn-structure.js'
import { getCardsByIds } from '../../lib/scryfall.js'
import { pinCards } from '../../lib/cache.js'
import useDeckCards from '../decks/useDeckCards.js'
import { playFor } from '../../lib/board/sound.js'
import useDrag from '../../components/table/useDrag.js'
import Field from '../../components/table/Field.jsx'
import BoardCard from '../../components/table/BoardCard.jsx'
import HandCost from '../../components/table/HandCost.jsx'
import Coach from '../../components/table/Coach.jsx'
import GameLog from '../../components/table/GameLog.jsx'
import Pool from '../../components/table/Pool.jsx'
import PlayerCounters from '../../components/table/PlayerCounters.jsx'
import ZoneBrowser from '../../components/table/ZoneBrowser.jsx'
import TokenMaker from '../../components/table/TokenMaker.jsx'
import Printings from '../../components/Printings.jsx'
import useRoom from './useRoom.js'
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

export default function Table({ deck: initialDeck, onOpenCard, room = null }) {
  // The deck is kept here because choosing a printing rewrites it, and the
  // table should show the copy just chosen without a reload.
  const [deck, setDeck] = useState(initialDeck)
  const { cards, loading, missing, lookup: deckLookup } = useDeckCards(deck)
  // Cards on the table the deck has never heard of: a token, a printing
  // swapped in, or — at a shared table — everything the other seat plays.
  // Pinned, so they are still themselves after a reload.
  const [extra, setExtra] = useState(() => new Map())
  const lookup = useCallback((id) => deckLookup(id) ?? extra.get(id) ?? null, [deckLookup, extra])
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
  const ready = !deck.main?.length || cards.size > 0 || missing.length > 0

  const shared = useRoom({
    address: room ? relayAddress() : null,
    code: room,
    name: prefs.playerName || 'Player',
    deck,
    deckLookup,
    cardsReady: ready,
  })

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

  const run = room ? shared.run : localRun

  // Anything on the table the deck cannot name comes back with its painting.
  const unknownIds = useMemo(() => {
    if (!run?.board) return ''
    return [...new Set(Object.values(run.board.cards)
      .map((inst) => inst.cardId)
      .filter((id) => id && !cards.has(id) && !extra.has(id)))].sort().join(',')
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
    if (room || dealt.current) return
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
    if (!ready) return
    dealt.current = true
    setLocalRun(fresh())
    setMulligans(0)
    setLocalKept(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, deck.id, ready])

  /*
   * Saved a moment after things settle, with a deadline so a board being
   * played — changing every few hundred milliseconds — still gets written.
   * And written on the way out regardless: a tab closed within half a second
   * of the last press used to lose that press, because the timer it was
   * waiting on died with the page. A shared table is saved by the relay.
   */
  const lastSaveAt = useRef(0)
  const latest = useRef(null)
  latest.current = !room && localRun ? snapshot(localRun, { deckId: deck.id, deckName: deck.name, mulligans, kept: localKept }) : null
  useEffect(() => {
    if (room || !localRun) return undefined
    const overdue = Date.now() - lastSaveAt.current > 2000
    const timer = setTimeout(() => {
      lastSaveAt.current = Date.now()
      saveGameTable(latest.current)
    }, overdue ? 0 : 400)
    return () => clearTimeout(timer)
  }, [room, localRun, deck.id, deck.name, mulligans, localKept])
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
  const doAction = room ? shared.doAction : localDo
  const doAll = room ? shared.doAll : localDoAll
  const kept = room ? shared.kept : localKept
  const setKept = room ? shared.setKept : setLocalKept
  const togglePref = useCallback((key) => { setPrefs(setPref(key, !prefs[key]).prefs) }, [prefs])

  // Which seat is yours. Alone it is the board's one seat; at a shared table
  // it is whatever chair the relay gave you.
  const me = room ? shared.seat : 'you'

  /*
   * Playing a card from hand. A permanent goes to the battlefield, into its
   * row; anything else goes on the stack, because that is where a spell
   * goes. The one tap and the drag both end here.
   */
  const play = useCallback((id, point = {}) => {
    const inst = board?.cards[id]
    if (!inst) return
    const card = inst.custom ? null : deckLookup(inst.cardId) ?? null
    const zone = board.guided && card ? zoneWhenPlayed(card, inst) : 'battlefield'
    doAction(zone === 'stack'
      ? { type: 'move', id, zone: 'stack' }
      : { type: 'move', id, zone: 'battlefield', ...point })
  }, [board, deckLookup, doAction])

  const onSlide = useCallback((id, point) => doAction({ type: 'move', id, zone: 'battlefield', ...point }), [doAction])
  const onPlay = useCallback((id, point) => { setSelected(id); play(id, point) }, [play])
  const { drag, begin, justDragged } = useDrag({ fieldRef, onSlide, onPlay })

  const nudge = useCallback((id, dx, dy) => {
    const inst = board?.cards[id]
    if (!inst) return
    doAction({ type: 'move', id, zone: 'battlefield', x: inst.x + dx, y: inst.y + dy })
  }, [board, doAction])

  if (!run || !me) {
    return (
      <div className="stack">
        <div className="view-loading" aria-busy="true" />
        {room && (
          <p className="faint tiny" role="status">
            {shared.status === 'open' ? 'Taking a seat…' : shared.status === 'connecting' ? 'Joining the table…' : 'The relay is not answering yet. Trying again…'}
          </p>
        )}
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
  const refusal = room ? shared.refusal : run.refusal
  const others = room ? board.players.filter((p) => p !== me) : []
  const seatOf = (p) => shared.seats.find((s) => s.seat === p) ?? null
  const nameOfSeat = (p) => seatOf(p)?.name ?? `Seat ${p.replace(/^p/, '')}`

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
    if (inst.zone === 'hand') play(id)
    else if (inst.zone === 'battlefield') doAction({ type: 'tap', id })
    else setPanel('actions')
  }
  // The long way in: pick the card up without doing anything to it.
  const hold = (id) => { setSelected(id); setAiming(null); setPanel('actions') }
  const aimAt = (mode) => { setAiming({ id: selected, mode }); setPanel(null) }

  const choosePrinting = (print, finish) => {
    const from = selectedInst?.cardId
    setPanel('actions')
    if (!from || !print?.id || from === print.id) return
    remember(print)
    doAction({ type: 'reprint', from, to: print.id, finish })
    const next = swapPrinting(deck, from, print.id)
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
    <div className={`game${drag ? ' game--carrying' : ''}${room ? ' game--shared' : ''}`}>
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
        const theirHand = handOf(board, them).length
        const theirCommander = zoneOf(board, them, 'command')[0]
        const face = theirCommander && showImages ? artUrl(cardFor(theirCommander)) : null
        return (
          <div className={`game__them game__them--seated${sitting?.here ? '' : ' game__them--away'}`} key={them}>
            <Plate
              who="them"
              status={!sitting ? 'Open seat' : !sitting.here ? 'Away' : board.active === them ? 'Their turn' : 'Waiting'}
              active={board.active === them}
              name={nameOfSeat(them)}
              life={sitting ? board.life[them] : null}
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
                const open = PUBLIC_PILES.includes(zone)
                const Tag = open ? 'button' : 'span'
                return (
                  <Tag
                    key={zone}
                    className={`ztile${open ? '' : ' ztile--closed'}${zoneOpen === zone && zoneWho === them ? ' ztile--open' : ''}`}
                    onClick={open ? () => openZone(zone, them) : undefined}
                    aria-expanded={open ? zoneOpen === zone && zoneWho === them : undefined}
                    aria-label={`${nameOfSeat(them)}'s ${ZONE_LABELS[zone].toLowerCase()}, ${n} card${n === 1 ? '' : 's'}`}
                  >
                    <span className="ztile__label" aria-hidden="true">{TILE_LABELS[zone]}</span>
                    <span className={`ztile__face${zone === 'library' && n ? ' ztile__face--back' : ''}`} style={zone === 'command' && face ? { backgroundImage: `url("${face}")` } : undefined} aria-hidden="true">
                      {!n && <span className="ztile__nil">—</span>}
                    </span>
                    {n > 0 && <span className="ztile__count" aria-hidden="true">{n}</span>}
                  </Tag>
                )
              })}
            </div>
            <div className="game__theirfield">
              <Field
                fieldRef={{ current: null }}
                board={board}
                lookup={lookup}
                player={them}
                selectedId={selected}
                drag={null}
                aiming={aiming}
                onBegin={() => {}}
                onSelect={touch}
                onContext={hold}
                onBackground={() => { if (panel === 'actions') setPanel(null) }}
                images={showImages}
                tile
                mirror
              />
            </div>
          </div>
        )
      })}

      {/* --- the battlefield ---------------------------------------------- */}
      <div className={`game__field${kept ? '' : ' game__field--prompt'}`}>
        {room && shared.status !== 'open' && (
          <div className="banner banner--warn" role="status">
            {shared.status === 'reconnecting' ? 'Lost the table for a moment. Reconnecting…' : 'Connecting to the table…'}
            {' '}Nothing you press will happen until it is back.
          </div>
        )}
        {missing.length > 0 && (
          <div className="banner banner--warn">
            {missing.length} card{missing.length === 1 ? '' : 's'} in this deck could not be loaded, so
            {missing.length === 1 ? ' it is' : ' they are'} on the table without a name or a painting.
          </div>
        )}
        {loading && <p className="faint tiny m0">Loading the paintings…</p>}
        {refusal && <div className="banner banner--info" role="status">{refusal.message}</div>}
        <Field
          fieldRef={fieldRef}
          board={board}
          lookup={lookup}
          player={me}
          selectedId={selected}
          drag={drag}
          aiming={aiming}
          onBegin={begin}
          onSelect={touch}
          onContext={hold}
          onNudge={nudge}
          onBackground={() => { if (!justDragged()) { setAiming(null); if (panel === 'actions') setPanel(null) } }}
          images={showImages}
          tile
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
      </div>

      {/* --- your seat ---------------------------------------------------- */}
      <div className="game__you">
        <div className="game__seat">
          <Plate
            who="you"
            status={myTurn ? step.name : 'Waiting'}
            active={myTurn}
            name={room ? (prefs.playerName || 'You') : 'You'}
            life={board.life[me]}
            onLife={(delta) => doAction({ type: 'life', delta })}
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
            <button className="rail__btn" onClick={() => doAction(inCombat ? { type: 'step' } : { type: 'step', to: 'beginCombat' })}>
              {inCombat ? '⚔ Next step' : '⚔ Combat'}
            </button>
            <button
              className="rail__btn rail__btn--go"
              onClick={() => (room ? doAction({ type: 'nextTurn' }) : doAll([{ type: 'nextTurn' }, { type: 'untapAll' }]))}
              disabled={room && !myTurn}
              title={room && !myTurn ? 'Only the player whose turn it is can end it.' : undefined}
            >
              → End turn
            </button>
            <button
              className="rail__btn"
              onClick={() => setLocalRun((r) => undo(r))}
              disabled={room ? true : !run.past.length}
              title={room ? 'A shared table is not only yours to wind back. Ask, and move it back by hand.' : undefined}
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
                  style={{ '--angle': `${spread.cards[i].angle}deg`, '--drop': spread.cards[i].drop, '--badge': spread.cards[i].badge, '--i': i }}
                >
                  <HandCost card={cardFor(inst)} pool={pool} />
                  <BoardCard
                    card={cardFor(inst)}
                    name={nameFor(inst)}
                    inst={inst}
                    size="hand"
                    tilt={!reduced}
                    images={showImages}
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
            const face = zone === 'command' && showImages ? artUrl(commander) : null
            const isOpen = zoneOpen === zone && zoneWho === me
            return (
              <button
                key={zone}
                className={`ztile${isOpen ? ' ztile--open' : ''}`}
                onClick={() => openZone(zone)}
                aria-expanded={isOpen}
                aria-label={`${ZONE_LABELS[zone]}, ${n} card${n === 1 ? '' : 's'}`}
              >
                <span className="ztile__label" aria-hidden="true">{TILE_LABELS[zone]}</span>
                <span className={`ztile__face${zone === 'library' && n ? ' ztile__face--back' : ''}`} style={face ? { backgroundImage: `url("${face}")` } : undefined} aria-hidden="true">
                  {!n && <span className="ztile__nil">—</span>}
                </span>
                {n > 0 && <span className="ztile__count" aria-hidden="true">{n}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* --- the side column: the log, and whatever is open --------------- */}
      <aside className="game__side">
        {room && (
          <section className="pile game__seats" aria-label="Who is at the table">
            <h2 className="pile__title">Table <span className="chip tiny">{room}</span></h2>
            <ul className="game__seatlist" role="list">
              {board.players.map((p) => {
                const s = seatOf(p)
                return (
                  <li key={p} className={`game__seatrow${p === me ? ' game__seatrow--you' : ''}${s && !s.here ? ' game__seatrow--away' : ''}`}>
                    <span className="game__dot" aria-hidden="true" />
                    <span>{p === me ? 'You' : s ? s.name : 'Open seat'}</span>
                    <span className="faint tiny">{!s ? '' : !s.here ? 'away' : board.active === p ? (p === me ? 'your turn' : 'their turn') : ''}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        <GameLog board={board} events={run.events} lookup={lookup} restored={run.restored} you={me} who={room ? nameOfSeat : null} />
        {prefs.tableCoach && <Coach board={board} events={run.events} lookup={lookup} player={me} onSilence={() => togglePref('tableCoach')} />}

        <StackShelf
          board={board}
          player={me}
          nameFor={nameFor}
          cardFor={cardFor}
          onResolve={(inst) => {
            const card = cardFor(inst)
            doAction(card && isPermanent(card, inst)
              ? { type: 'move', id: inst.id, zone: 'battlefield' }
              : { type: 'move', id: inst.id, zone: 'graveyard' })
          }}
          onCounter={(inst) => doAction({ type: 'move', id: inst.id, zone: 'graveyard' })}
        />

        {panel === 'actions' && (
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
              />
            )}
          </section>
        )}

        {panel === 'more' && (
          <More
            board={board}
            player={me}
            prefs={prefs}
            shared={Boolean(room)}
            onDo={doAction}
            onToken={() => setPanel('token')}
            onMulligan={mulligan}
            onDealAgain={dealAgain}
            onTogglePref={togglePref}
            onLeave={() => navigate({ tab: 'game', gameDeckId: null, gameRoom: null })}
          />
        )}
      </aside>
    </div>
  )
}

// --- the pieces ------------------------------------------------------------

/**
 * A life plate: the status word or phase pill, the name, the life with its
 * steppers, and whatever the seat wants under it. The active seat wears a
 * ring, which is how Moxgate says whose turn it is without a word.
 */
function Plate({ who, status, active = false, name, life, onLife, children }) {
  return (
    <section className={`plate plate--${who}${active ? ' plate--active' : ''}`} aria-label={`${name}: ${status}${life == null ? '' : `, ${life} life`}`}>
      <span className={`plate__status${active ? ' plate__status--turn' : ''}`}>{status}</span>
      <span className="plate__name">{name}</span>
      <div className="plate__life">
        {onLife && <button className="plate__step" onClick={() => onLife(-1)} aria-label="Lose 1 life">−</button>}
        <output className="plate__total" aria-label={life == null ? 'No life total' : `${life} life`}>{life ?? '—'}</output>
        {onLife && <button className="plate__step" onClick={() => onLife(1)} aria-label="Gain 1 life">+</button>}
      </div>
      {children}
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
function StackShelf({ board, player, nameFor, cardFor, onResolve, onCounter }) {
  const waiting = zoneOf(board, player, 'stack')
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
        {waiting.slice().reverse().map((inst, i) => (
          <li key={inst.id} className={`stackshelf__item${i === 0 ? ' stackshelf__item--top' : ''}`}>
            <span className="chip tiny">{i === 0 ? 'top' : `${i + 1}`}</span>
            <strong>{nameFor(inst)}</strong>
            <span className="faint tiny">{cardFor(inst)?.type_line ?? ''}</span>
          </li>
        ))}
      </ol>
      <div className="row row--wrap">
        <button className="btn btn--sm" onClick={() => onResolve(top)}>Resolve {nameFor(top)}</button>
        <button className="btn btn--ghost btn--sm" onClick={() => onCounter(top)}>It was countered</button>
      </div>
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
function More({ board, player, prefs, shared, onDo, onToken, onMulligan, onDealAgain, onTogglePref, onLeave }) {
  return (
    <div className="more">
      <section className="pile">
        <h2 className="pile__title">The turn <span className="chip tiny">Turn {board.turn}</span></h2>
        <div className="row row--wrap">
          <button className="btn btn--sm" onClick={() => onDo({ type: 'draw' })}>Draw</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'step' })}>Next step</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'untapAll' })}>Untap all</button>
          {board.arrows.length > 0 && <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'clearArrows' })}>Clear the arrows</button>}
        </div>
      </section>
      <section className="pile">
        <h2 className="pile__title">Life <span className="chip tiny">{board.life[player]}</span></h2>
        <div className="row row--wrap">
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'life', delta: -5 })}>−5</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'life', delta: 5 })}>+5</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'life', value: board.life[player] === 40 ? 20 : 40 })}>Set to {board.life[player] === 40 ? '20' : '40'}</button>
        </div>
        <PlayerCounters board={board} player={player} onChange={(name, delta) => onDo({ type: 'playerCounter', name, delta })} />
      </section>
      <section className="pile">
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
      </section>
      <section className="pile">
        <h2 className="pile__title">This game</h2>
        <div className="row row--wrap">
          <button className="btn btn--ghost btn--sm" onClick={onMulligan}>Mulligan</button>
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
        <p className="faint tiny m0">
          Nothing here checks whether a play is legal. With the playmat on, a card sits in the row its kind
          belongs in and an instant may not be left on the battlefield; the rest is yours.
        </p>
      </section>
    </div>
  )
}
