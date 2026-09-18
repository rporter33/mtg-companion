import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../lib/router.js'
import { listDecks, getDeck, saveDeck, getTable, saveTable, clearTable, getPrefs, setPref } from '../../lib/storage.js'
import { createBoard, handOf, librarySize, zoneOf, nameOf, hostOf, ZONE_LABELS, DEFAULT_COUNTERS } from '../../lib/board/model.js'
import { newRun, act, applyAll, undo, snapshot, restore } from '../../lib/board/runner.js'
import { openingActions, mulliganActions, libraryOf, swapPrinting, OPENING_HAND } from '../../lib/board/deck.js'
import { treatmentOf, finishFor } from '../../lib/board/art.js'
import { prefersReducedMotion } from '../../lib/table/motion.js'
import { getCardsByIds } from '../../lib/scryfall.js'
import { pinCards } from '../../lib/cache.js'
import { isLandCard } from '../../lib/deck.js'
import useDeckCards from '../decks/useDeckCards.js'
import { playFor } from '../../lib/board/sound.js'
import useDrag from './useDrag.js'
import Field from './Field.jsx'
import BoardCard from './BoardCard.jsx'
import Coach from './Coach.jsx'
import Printings from './Printings.jsx'
import TokenMaker from './TokenMaker.jsx'
import './table.css'

/**
 * The table.
 *
 * Every other screen in this app knows the rules: the deck builder knows
 * what is legal, the practice table refuses an illegal play by name. This
 * one knows nothing and refuses nothing, and that is the feature. It is the
 * kitchen table — your own deck, your own hands, and no judge — which is the
 * only way a hundred-card deck of cards nothing could parse can be played at
 * all. What the app does is remember where everything is.
 *
 * Reached at #/table and #/table/<deckId>. The board is saved as a snapshot
 * so a reload lands back on the same table.
 */
export default function TableView({ route, onOpenCard }) {
  const deckId = route.tableDeckId
  if (!deckId) return <Pick />
  const deck = getDeck(deckId)
  if (!deck) {
    return (
      <div className="stack">
        <button className="btn btn--ghost btn--sm self-start" onClick={() => navigate({ tableDeckId: null })}>← Table</button>
        <div className="banner banner--warn">That deck is not on this device.</div>
      </div>
    )
  }
  return <Seat key={deck.id} deck={deck} onOpenCard={onOpenCard} />
}

// --- choosing a deck -------------------------------------------------------

function Pick() {
  const decks = listDecks()
  const saved = getTable()
  const savedDeck = saved ? decks.find((d) => d.id === saved.deckId) : null

  return (
    <div className="stack">
      <div>
        <h1>Table</h1>
        <p className="muted">
          One of your own decks, dealt out on a table that enforces nothing. Move cards where you like, tap them,
          put them anywhere — the way you would on a kitchen table, because that is the only way a deck of cards
          this app has never seen can be played at all.
        </p>
      </div>

      {savedDeck && (
        <section className="hero">
          <div className="hero__label">In progress</div>
          <h2>{savedDeck.name}</h2>
          <p className="muted">Turn {saved.board?.turn ?? 1}, {saved.board?.life?.you ?? 20} life. Saved where you left it.</p>
          <div className="row row--wrap">
            <button className="btn btn--primary" onClick={() => navigate({ tab: 'table', tableDeckId: savedDeck.id })}>Back to the table</button>
            <button className="btn btn--ghost" onClick={() => { clearTable(); navigate({ tab: 'table' }, { replace: true }) }}>Clear it</button>
          </div>
        </section>
      )}

      {!decks.length ? (
        <div className="banner banner--info">
          There is nothing to play yet. Build or import a deck first and it will appear here.
          <div className="row" style={{ marginTop: 'var(--space-2)' }}>
            <button className="btn btn--primary btn--sm" onClick={() => navigate({ tab: 'decks' })}>Go to Decks</button>
          </div>
        </div>
      ) : (
        <section className="stack">
          <h2>Your decks</h2>
          <ul className="table-picker" role="list">
            {decks.map((deck) => (
              <li key={deck.id}>
                <button className="table-picker__deck" onClick={() => navigate({ tab: 'table', tableDeckId: deck.id })}>
                  <strong>{deck.name}</strong>
                  <span className="faint tiny">
                    {libraryOf(deck).length} cards
                    {deck.commanders?.length ? ` · ${deck.commanders.length} in the command zone` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// --- the table itself ------------------------------------------------------

const PILES = ['graveyard', 'exile', 'command']

function Seat({ deck: initialDeck, onOpenCard }) {
  // The deck is kept here because choosing a printing rewrites it, and the
  // table should show the copy that was just chosen without a reload.
  const [deck, setDeck] = useState(initialDeck)
  const { cards, loading, missing, lookup: deckLookup } = useDeckCards(deck)
  /*
   * Cards on the table that the deck has never heard of: a token made
   * mid-game, or a printing swapped in. Kept beside the deck's own cards and
   * pinned in the cache, so a token is still a token after a reload.
   */
  const [extra, setExtra] = useState(() => new Map())
  const lookup = useCallback((id) => deckLookup(id) ?? extra.get(id) ?? null, [deckLookup, extra])
  const remember = useCallback((card) => {
    if (!card?.id) return
    setExtra((was) => new Map(was).set(card.id, card))
    pinCards([card.id]).catch(() => { /* it will be fetched again if it has to be */ })
  }, [])
  const [run, setRun] = useState(null)
  const [selected, setSelected] = useState(null)
  const [peeking, setPeeking] = useState(0)
  const [openPile, setOpenPile] = useState(null)
  const [mulligans, setMulligans] = useState(0)
  // Pointing at something: an arrow, or putting one card on another. Until a
  // second card is picked the table is unchanged.
  const [aiming, setAiming] = useState(null)
  const [prefs, setPrefs] = useState(() => getPrefs())
  // On a phone held upright there is not room for the table, your hand and
  // every pile at once, and a screen you have to scroll to play is not a
  // table. So the counts and the rarer buttons fold away behind one press,
  // and the quick ones live in a strip under your hand.
  const [railOpen, setRailOpen] = useState(false)
  // One panel at a time, under the table: the printings of a card, or the
  // token maker.
  const [panel, setPanel] = useState(null)
  const reduced = prefersReducedMotion(prefs.reduceMotion ?? null)
  const fieldRef = useRef(null)
  const actionsRef = useRef(null)

  // Either the board this deck was left on, or a fresh deal. The seed is the
  // only thing here that is not pure: the model shuffles from a number, and
  // this is where the number comes from.
  const fresh = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9)
    return applyAll(newRun(createBoard({ seed })), openingActions(deck, { seed })).run
  }, [deck])

  /*
   * Anything on the table the deck cannot name. After a reload that is every
   * token made last session and every printing swapped in; they are real
   * cards on a real table and they should come back with their paintings.
   */
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

  useEffect(() => {
    const saved = getTable()
    if (saved?.deckId === deck.id) {
      const restored = restore(saved)
      if (restored) {
        setRun(restored)
        setMulligans(saved.mulligans ?? 0)
        return
      }
    }
    setRun(fresh())
    setMulligans(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id])

  /*
   * Saved a moment after things settle, so dragging a card across the table
   * is not twenty writes to storage — but with a deadline, because a plain
   * debounce never fires at all while someone is actually playing. Every
   * action within the window pushes the save further out, and a board being
   * played is a board changing every few hundred milliseconds. So: settle
   * briefly, and if it has been a couple of seconds since the last save,
   * write now regardless.
   */
  const lastSaveAt = useRef(0)
  useEffect(() => {
    if (!run) return undefined
    const overdue = Date.now() - lastSaveAt.current > 2000
    const timer = setTimeout(() => {
      lastSaveAt.current = Date.now()
      saveTable(snapshot(run, { deckId: deck.id, deckName: deck.name, mulligans }))
    }, overdue ? 0 : 400)
    return () => clearTimeout(timer)
  }, [run, deck.id, deck.name, mulligans])

  const board = run?.board
  // Sound is played from the events an action produced, so one draw of seven
  // is one riffle and a refused action is silent.
  const soundOn = prefs.tableSound
  const doAction = useCallback((action) => setRun((r) => {
    if (!r) return r
    const next = act(r, action)
    playFor(next.lastEvents, soundOn)
    return next
  }), [soundOn])
  const doAll = useCallback((actions) => setRun((r) => {
    if (!r) return r
    const next = applyAll(r, actions).run
    playFor(next.lastEvents, soundOn)
    return next
  }), [soundOn])
  const togglePref = useCallback((key) => { setPrefs(setPref(key, !prefs[key]).prefs) }, [prefs])

  const onSlide = useCallback((id, point) => doAction({ type: 'move', id, zone: 'battlefield', ...point }), [doAction])
  const onPlay = useCallback((id, point) => { setSelected(null); doAction({ type: 'move', id, zone: 'battlefield', ...point }) }, [doAction])
  const { drag, begin, justDragged } = useDrag({ fieldRef, onSlide, onPlay })

  const nudge = useCallback((id, dx, dy) => setRun((r) => {
    const inst = r.board.cards[id]
    if (!inst) return r
    return act(r, { type: 'move', id, zone: 'battlefield', x: inst.x + dx, y: inst.y + dy })
  }), [])

  // Picking a card up out of a pile lower down the screen should not leave
  // its options off the top of the view.
  useEffect(() => {
    if (selected) actionsRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const landIds = useMemo(() => {
    if (!board) return []
    return zoneOf(board, 'you', 'battlefield').filter((inst) => isLandCard(lookup(inst.cardId))).map((inst) => inst.id)
  }, [board, lookup])

  if (!run) return <div className="view-loading" aria-busy="true" />

  const selectedInst = selected ? board.cards[selected] : null
  const hand = handOf(board, 'you')
  const topOfLibrary = zoneOf(board, 'you', 'library').slice(0, peeking)
  const nameFor = (inst) => nameOf(board, inst.id, lookup)
  const cardFor = (inst) => (inst.custom ? null : lookup(inst.cardId))
  /*
   * One click does one of two things. Normally it picks a card up, or puts
   * it down again. While something is being pointed at, it is the far end
   * of that pointing instead — an arrow drawn, or a card laid on another —
   * and the aim is spent either way.
   */
  const select = (id) => {
    if (justDragged()) return
    if (aiming) {
      const { id: from, mode } = aiming
      setAiming(null)
      if (id === from) return
      if (mode === 'attach') doAction({ type: 'attach', id: from, to: id })
      else doAction({ type: 'arrow', from, to: id, kind: mode })
      return
    }
    setSelected((current) => (current === id ? null : id))
  }
  const aimAt = (mode) => { setAiming({ id: selected, mode }); setSelected(null) }

  /*
   * Choosing a printing does two things, and both matter. The copies on this
   * table change, because those are the cards in front of you; and the deck
   * changes, because that is a fact about the deck rather than a setting on
   * this screen. Next game it is still the copy you chose.
   */
  const choosePrinting = (print, finish) => {
    const from = selectedInst?.cardId
    setPanel(null)
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

  return (
    <div className="stack tabletop">
      <div className="row row--wrap tabletop__top">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate({ tableDeckId: null })}>← Decks</button>
        <h1 className="tabletop__name">{deck.name}</h1>
        <span className="spacer" />
        {mulligans > 0 && <span className="chip tiny">{mulligans} mulligan{mulligans === 1 ? '' : 's'}: put {Math.min(mulligans, OPENING_HAND)} on the bottom</span>}
      </div>

      {missing.length > 0 && (
        <div className="banner banner--warn">
          {missing.length} card{missing.length === 1 ? '' : 's'} in this deck could not be loaded, so
          {missing.length === 1 ? ' it is' : ' they are'} on the table without a name or a painting. They are still real cards on it.
        </div>
      )}
      {loading && <p className="faint tiny">Loading the paintings…</p>}
      {run.refusal && <div className="banner banner--info" role="status">{run.refusal.message}</div>}

      <div className="tabletop__layout">
        <div className="tabletop__main">
          <Field
            fieldRef={fieldRef}
            board={board}
            lookup={lookup}
            selectedId={selected}
            drag={drag}
            aiming={aiming}
            onBegin={begin}
            onSelect={select}
            onNudge={nudge}
            onBackground={() => { if (!justDragged()) { setSelected(null); setAiming(null) } }}
          />

          {aiming && (
            <div className="banner banner--info row row--wrap" role="status">
              <span style={{ flex: '1 1 12rem' }}>
                {aiming.mode === 'attach'
                  ? `Pick the card to put ${nameOf(board, aiming.id, lookup)} on.`
                  : `Pick what ${nameOf(board, aiming.id, lookup)} is ${aiming.mode === 'attack' ? 'attacking' : 'pointing at'}.`}
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => setAiming(null)}>Never mind</button>
            </div>
          )}

          {selectedInst && (
            <Actions
              panelRef={actionsRef}
              host={hostOf(board, selectedInst.id)}
              onAim={aimAt}
              inst={selectedInst}
              name={nameFor(selectedInst)}
              card={cardFor(selectedInst)}
              onDo={(action) => { doAction(action); if (action.type === 'move') setSelected(null) }}
              onInspect={() => { const card = cardFor(selectedInst); if (card) onOpenCard(card) }}
              onPrintings={() => setPanel(panel === 'printings' ? null : 'printings')}
              onClose={() => { setSelected(null); setPanel(null) }}
            />
          )}

          {panel === 'printings' && selectedInst && cardFor(selectedInst) && (
            <Printings
              card={cardFor(selectedInst)}
              finish={selectedInst.finish}
              onChoose={choosePrinting}
              onClose={() => setPanel(null)}
            />
          )}

          {panel === 'token' && (
            <TokenMaker
              colors={deck.commanders?.length ? (lookup(deck.commanders[0])?.color_identity ?? []) : []}
              onMake={makeToken}
              onClose={() => setPanel(null)}
            />
          )}

        </div>

        <div className="tabletop__side">
          {prefs.tableCoach && <Coach board={board} events={run.events} lookup={lookup} onSilence={() => togglePref('tableCoach')} />}

          <section className="pile tabletop__hand">
            <h2 className="pile__title">
              Your hand <span className="chip tiny">{hand.length}</span>
              {hand.length > 7 && <span className="faint tiny"> — you discard to seven at end of turn</span>}
            </h2>
            {!hand.length ? (
              <p className="faint tiny">Nothing in hand. Draw a card.</p>
            ) : (
              <div className="tabletop__handrow">
                {hand.map((inst) => (
                  <span className="tabletop__handcard" key={inst.id}>
                    <BoardCard
                      card={cardFor(inst)}
                      name={nameFor(inst)}
                      inst={inst}
                      size="hand"
                      tilt={!reduced}
                      selected={selected === inst.id}
                      onPointerDown={(e) => begin(e, { id: inst.id, from: 'hand' })}
                      onClick={() => select(inst.id)}
                    />
                    {board.revealed.includes(inst.id) && <span className="tabletop__revealed chip tiny">revealed</span>}
                  </span>
                ))}
              </div>
            )}
          </section>

          <Strip
            board={board}
            railOpen={railOpen}
            onLife={(delta) => doAction({ type: 'life', delta })}
            onDraw={() => doAction({ type: 'draw' })}
            onUntap={() => doAction({ type: 'untapAll' })}
            onNextTurn={() => doAll([{ type: 'nextTurn' }, { type: 'untapAll' }])}
            onToggleRail={() => setRailOpen(!railOpen)}
          />

          <div className={`tabletop__rail${railOpen ? ' tabletop__rail--open' : ''}`}>
            <section className="pile">
              <h2 className="pile__title">Library <span className="chip tiny">{librarySize(board, 'you')}</span></h2>
              <div className="row row--wrap">
                <button className="btn btn--ghost btn--sm" onClick={() => doAction({ type: 'shuffle' })}>Shuffle</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setPeeking(peeking ? 0 : 3)} aria-expanded={peeking > 0}>
                  {peeking ? 'Stop looking' : 'Look at the top 3'}
                </button>
              </div>
              {peeking > 0 && (
                <Peek
                  instances={topOfLibrary}
                  nameFor={nameFor}
                  onBottom={(id) => doAction({ type: 'move', id, zone: 'library', to: 'bottom' })}
                  onHand={(id) => doAction({ type: 'move', id, zone: 'hand' })}
                  onGraveyard={(id) => doAction({ type: 'move', id, zone: 'graveyard' })}
                />
              )}
            </section>

            {PILES.map((zone) => {
              const pile = zoneOf(board, 'you', zone)
              return (
                <section className="pile" key={zone}>
                  <h2 className="pile__title">
                    {ZONE_LABELS[zone]} <span className="chip tiny">{pile.length}</span>
                    {pile.length > 0 && (
                      <button className="btn btn--ghost btn--sm" onClick={() => setOpenPile(openPile === zone ? null : zone)} aria-expanded={openPile === zone}>
                        {openPile === zone ? 'Close' : 'Look'}
                      </button>
                    )}
                  </h2>
                  {openPile === zone && (
                    <ul className="pile__cards" role="list">
                      {pile.slice().reverse().map((inst) => (
                        <li key={inst.id}>
                          <button className={`pile__card ${selected === inst.id ? 'pile__card--selected' : ''}`} onClick={() => select(inst.id)} aria-pressed={selected === inst.id}>
                            {nameFor(inst)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}

            <section className="pile">
              <h2 className="pile__title">Tokens</h2>
              <div className="row row--wrap">
                <button className="btn btn--ghost btn--sm" onClick={() => setPanel(panel === 'token' ? null : 'token')} aria-expanded={panel === 'token'}>
                  Make a token
                </button>
              </div>
            </section>

            <Dice board={board} onRoll={(sides, label) => doAction({ type: 'roll', sides, label, seed: Math.floor(Math.random() * 1e9) })} />

            <section className="pile">
              <h2 className="pile__title">The turn</h2>
              <div className="row row--wrap">
                <button className="btn btn--ghost btn--sm" onClick={() => doAction({ type: 'tidy', lands: landIds })}>Tidy up</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setRun((r) => undo(r))} disabled={!run.past.length}>Undo</button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => { setMulligans(mulligans + 1); doAll(mulliganActions(board, { seed: Math.floor(Math.random() * 1e9) })) }}
                >
                  Mulligan
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => { setSelected(null); setMulligans(0); setPeeking(0); setRun(fresh()) }}
                >
                  Deal again
                </button>
                {board.arrows.length > 0 && (
                  <button className="btn btn--ghost btn--sm" onClick={() => doAction({ type: 'clearArrows' })}>
                    Clear the arrows
                  </button>
                )}
              </div>
            </section>

            <section className="pile">
              <h2 className="pile__title">This table</h2>
              <div className="row row--wrap">
                <button className="btn btn--ghost btn--sm" onClick={() => togglePref('tableCoach')} aria-pressed={prefs.tableCoach}>
                  Notes {prefs.tableCoach ? 'on' : 'off'}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => togglePref('tableSound')} aria-pressed={prefs.tableSound}>
                  Sound {prefs.tableSound ? 'on' : 'off'}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => doAction({ type: 'life', value: board.life.you === 40 ? 20 : 40 })}>
                  Set life to {board.life.you === 40 ? '20' : '40'}
                </button>
              </div>
              <p className="faint tiny">
                Notes are observations, never rulings, and nothing here checks whether a play is legal.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- the pieces ------------------------------------------------------------

/**
 * The strip under your hand: life, a card, the turn.
 *
 * These four are most of what anyone presses during a game, so they are the
 * four that are always on screen. Everything else — the piles, the dice, a
 * mulligan — is behind "More", because on a phone held upright the table and
 * your hand already fill the screen, and a table you have to scroll to play
 * is not a table.
 */
function Strip({ board, railOpen, onLife, onDraw, onUntap, onNextTurn, onToggleRail }) {
  return (
    <section className="pile tabletop__strip">
      <div className="row life__row">
        <button className="btn btn--ghost btn--sm" onClick={() => onLife(-5)} aria-label="Lose 5 life">−5</button>
        <button className="btn btn--ghost btn--sm" onClick={() => onLife(-1)} aria-label="Lose 1 life">−1</button>
        <output className="life__total" aria-label={`${board.life.you} life`}>{board.life.you}</output>
        <button className="btn btn--ghost btn--sm" onClick={() => onLife(1)} aria-label="Gain 1 life">+1</button>
        <button className="btn btn--ghost btn--sm" onClick={() => onLife(5)} aria-label="Gain 5 life">+5</button>
        <span className="spacer" />
        <span className="chip tiny">Turn {board.turn}</span>
      </div>
      <div className="row row--wrap">
        <button className="btn btn--primary btn--sm" onClick={onDraw}>Draw</button>
        <button className="btn btn--sm" onClick={onNextTurn}>Next turn</button>
        <button className="btn btn--ghost btn--sm" onClick={onUntap}>Untap all</button>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm tabletop__more" onClick={onToggleRail} aria-expanded={railOpen}>
          {railOpen ? 'Fewer' : 'More'}
        </button>
      </div>
    </section>
  )
}

/**
 * Looking at the top of your own library. No new zone and nothing moved: the
 * order is already known, so a scry is reading the top few and deciding what
 * goes to the bottom, which is what it is in paper.
 */
function Peek({ instances, nameFor, onBottom, onHand, onGraveyard }) {
  return (
    <ol className="peek" aria-label="The top of your library, in order">
      {instances.map((inst) => (
        <li key={inst.id} className="peek__card">
          <span>{nameFor(inst)}</span>
          <span className="row">
            <button className="btn btn--ghost btn--sm" onClick={() => onBottom(inst.id)}>Bottom</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onHand(inst.id)}>Hand</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onGraveyard(inst.id)}>Graveyard</button>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * What you can do with the card you picked up. Everything a hand can do to a
 * card at a table, and nothing about what the card says: the player decides
 * whether the move is legal, which is the whole arrangement here.
 */
const MOVES = [
  { zone: 'battlefield', label: 'To the battlefield' },
  { zone: 'hand', label: 'To hand' },
  { zone: 'graveyard', label: 'To the graveyard' },
  { zone: 'exile', label: 'Exile it' },
  { zone: 'library', to: 'top', label: 'Top of library' },
  { zone: 'library', to: 'bottom', label: 'Bottom of library' },
  { zone: 'command', label: 'To the command zone' },
]

function Actions({ inst, name, card, host, onDo, onAim, onInspect, onPrintings, onClose, panelRef }) {
  const onField = inst.zone === 'battlefield'
  const counters = Object.entries(inst.counters).filter(([, n]) => n)
  const treatment = card ? treatmentOf(card) : null
  const foil = inst.finish !== 'normal'
  return (
    <section className="actions" aria-label={`Actions for ${name}`} ref={panelRef}>
      <div className="row row--wrap">
        <strong className="actions__name">{name}</strong>
        <span className="faint tiny">
          in the {ZONE_LABELS[inst.zone].toLowerCase()}
          {host ? ` · on ${host.id === inst.id ? 'itself' : 'another card'}` : ''}
        </span>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Put it down</button>
      </div>

      <div className="row row--wrap">
        {onField && (
          <button className="btn btn--sm" onClick={() => onDo({ type: 'tap', id: inst.id })}>{inst.tapped ? 'Untap' : 'Tap'}</button>
        )}
        <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'flip', id: inst.id })}>
          {inst.faceDown ? 'Turn it up' : 'Turn it face down'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'reveal', id: inst.id })}>Reveal</button>
        {onField && <button className="btn btn--ghost btn--sm" onClick={() => onAim('attack')}>Attacking…</button>}
        {onField && <button className="btn btn--ghost btn--sm" onClick={() => onAim('target')}>Pointing at…</button>}
        {onField && !inst.attachedTo && <button className="btn btn--ghost btn--sm" onClick={() => onAim('attach')}>Put it on…</button>}
        {inst.attachedTo && <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'detach', id: inst.id })}>Take it off</button>}
        {card && <button className="btn btn--ghost btn--sm" onClick={onInspect}>Read it</button>}
        {card && (treatment.foilable || treatment.etchable || foil) && (
          <button
            className="btn btn--ghost btn--sm"
            aria-pressed={foil}
            onClick={() => onDo({ type: 'finish', id: inst.id, value: foil ? 'normal' : finishFor(card, treatment.etchable && !treatment.foilable ? 'etched' : 'foil') })}
          >
            {foil ? 'An ordinary copy' : 'Mine is foil'}
          </button>
        )}
        {card && !inst.token && (
          <button className="btn btn--ghost btn--sm" onClick={onPrintings}>Another printing…</button>
        )}
      </div>

      {onField && <Counters inst={inst} counters={counters} onDo={onDo} />}

      <div className="row row--wrap">
        {MOVES.filter((move) => move.zone !== inst.zone || move.to).map((move) => (
          <button
            key={`${move.zone}${move.to ?? ''}`}
            className="btn btn--ghost btn--sm"
            onClick={() => onDo({ type: 'move', id: inst.id, zone: move.zone, to: move.to ?? 'top' })}
          >
            {move.label}
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * Counters on a card.
 *
 * What is already there can go up or down; anything else is one press away.
 * The board removes a counter that reaches zero rather than keeping a zero,
 * so a card never carries "0 charge" the way a spreadsheet would.
 */
function Counters({ inst, counters, onDo }) {
  const step = (name, delta) => onDo({ type: 'counter', id: inst.id, name, delta })
  return (
    <div className="row row--wrap counters">
      {counters.map(([name, n]) => (
        <span className="counters__on" key={name}>
          <button className="btn btn--ghost btn--sm" onClick={() => step(name, -1)} aria-label={`One fewer ${name} counter`}>−</button>
          <span className="chip tiny">{n} {name}</span>
          <button className="btn btn--ghost btn--sm" onClick={() => step(name, 1)} aria-label={`One more ${name} counter`}>+</button>
        </span>
      ))}
      {DEFAULT_COUNTERS.filter((name) => !inst.counters[name]).map((name) => (
        <button key={name} className="btn btn--ghost btn--sm" onClick={() => step(name, 1)}>
          + {name}
        </button>
      ))}
    </div>
  )
}

/**
 * Dice and a coin, for everything a game asks you to decide at random and
 * the rules do not cover: who starts, which of two targets, a die on a card
 * standing in for a counter.
 */
function Dice({ board, onRoll }) {
  return (
    <section className="pile">
      <h2 className="pile__title">Dice</h2>
      <div className="row row--wrap">
        <button className="btn btn--ghost btn--sm" onClick={() => onRoll(6, 'd6')}>Roll a d6</button>
        <button className="btn btn--ghost btn--sm" onClick={() => onRoll(20, 'd20')}>Roll a d20</button>
        <button className="btn btn--ghost btn--sm" onClick={() => onRoll(2, 'Coin')}>Flip a coin</button>
      </div>
      {board.dice.length > 0 && (
        <ul className="dice" role="list" aria-label="What was rolled, most recent first">
          {board.dice.map((die) => (
            <li key={die.id} className="dice__roll">
              <span className="chip tiny">{die.label || `d${die.sides}`}</span>
              <strong>{die.sides === 2 ? (die.value === 1 ? 'heads' : 'tails') : die.value}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

