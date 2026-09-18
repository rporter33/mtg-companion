import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../lib/router.js'
import { listDecks, getDeck, getTable, saveTable, clearTable } from '../../lib/storage.js'
import { createBoard, handOf, librarySize, zoneOf, nameOf, ZONE_LABELS } from '../../lib/board/model.js'
import { newRun, act, applyAll, undo, snapshot, restore } from '../../lib/board/runner.js'
import { openingActions, mulliganActions, libraryOf, OPENING_HAND } from '../../lib/board/deck.js'
import { isLandCard } from '../../lib/deck.js'
import useDeckCards from '../decks/useDeckCards.js'
import useDrag from './useDrag.js'
import Field from './Field.jsx'
import BoardCard from './BoardCard.jsx'
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

function Seat({ deck, onOpenCard }) {
  const { cards, loading, missing, lookup } = useDeckCards(deck)
  const [run, setRun] = useState(null)
  const [selected, setSelected] = useState(null)
  const [peeking, setPeeking] = useState(0)
  const [openPile, setOpenPile] = useState(null)
  const [mulligans, setMulligans] = useState(0)
  const fieldRef = useRef(null)
  const actionsRef = useRef(null)

  // Either the board this deck was left on, or a fresh deal. The seed is the
  // only thing here that is not pure: the model shuffles from a number, and
  // this is where the number comes from.
  const fresh = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9)
    return applyAll(newRun(createBoard({ seed })), openingActions(deck, { seed })).run
  }, [deck])

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
  const doAction = useCallback((action) => setRun((r) => (r ? act(r, action) : r)), [])
  const doAll = useCallback((actions) => setRun((r) => (r ? applyAll(r, actions).run : r)), [])

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
  // A drag that ends on a card must not also pick it up.
  const select = (id) => { if (!justDragged()) setSelected((current) => (current === id ? null : id)) }

  return (
    <div className="stack tabletop">
      <div className="row row--wrap tabletop__top">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate({ tableDeckId: null })}>← Decks</button>
        <h1 className="tabletop__name">{deck.name}</h1>
        <span className="spacer" />
        <span className="chip tiny">Turn {board.turn}</span>
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
            onBegin={begin}
            onSelect={select}
            onNudge={nudge}
          />

          {selectedInst && (
            <Actions
              panelRef={actionsRef}
              inst={selectedInst}
              name={nameFor(selectedInst)}
              card={cardFor(selectedInst)}
              onDo={(action) => { doAction(action); if (action.type === 'move') setSelected(null) }}
              onInspect={() => { const card = cardFor(selectedInst); if (card) onOpenCard(card) }}
              onClose={() => setSelected(null)}
            />
          )}

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
        </div>

        <div className="tabletop__rail stack">
          <Life board={board} onChange={(delta) => doAction({ type: 'life', delta })} onSet={(value) => doAction({ type: 'life', value })} />

          <section className="pile">
            <h2 className="pile__title">Library <span className="chip tiny">{librarySize(board, 'you')}</span></h2>
            <div className="row row--wrap">
              <button className="btn btn--primary btn--sm" onClick={() => doAction({ type: 'draw' })}>Draw</button>
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
            <h2 className="pile__title">The turn</h2>
            <div className="row row--wrap">
              <button className="btn btn--sm" onClick={() => doAll([{ type: 'nextTurn' }, { type: 'untapAll' }])}>Next turn</button>
              <button className="btn btn--ghost btn--sm" onClick={() => doAction({ type: 'untapAll' })}>Untap all</button>
              <button className="btn btn--ghost btn--sm" onClick={() => doAction({ type: 'tidy', lands: landIds })}>Tidy up</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setRun((r) => undo(r))} disabled={!run.past.length}>Undo</button>
            </div>
            <div className="row row--wrap">
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
            </div>
          </section>
        </div>
      </div>

    </div>
  )
}

// --- the pieces ------------------------------------------------------------

function Life({ board, onChange, onSet }) {
  return (
    <section className="pile life">
      <h2 className="pile__title">Life</h2>
      <div className="row life__row">
        <button className="btn btn--ghost btn--sm" onClick={() => onChange(-5)} aria-label="Lose 5 life">−5</button>
        <button className="btn btn--ghost btn--sm" onClick={() => onChange(-1)} aria-label="Lose 1 life">−1</button>
        <output className="life__total" aria-label={`${board.life.you} life`}>{board.life.you}</output>
        <button className="btn btn--ghost btn--sm" onClick={() => onChange(1)} aria-label="Gain 1 life">+1</button>
        <button className="btn btn--ghost btn--sm" onClick={() => onChange(5)} aria-label="Gain 5 life">+5</button>
      </div>
      <button className="btn btn--ghost btn--sm self-start" onClick={() => onSet(board.life.you === 40 ? 20 : 40)}>
        Set to {board.life.you === 40 ? '20' : '40'}
      </button>
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

function Actions({ inst, name, card, onDo, onInspect, onClose, panelRef }) {
  return (
    <section className="actions" aria-label={`Actions for ${name}`} ref={panelRef}>
      <div className="row row--wrap">
        <strong className="actions__name">{name}</strong>
        <span className="faint tiny">in the {ZONE_LABELS[inst.zone].toLowerCase()}</span>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Put it down</button>
      </div>
      <div className="row row--wrap">
        {inst.zone === 'battlefield' && (
          <button className="btn btn--sm" onClick={() => onDo({ type: 'tap', id: inst.id })}>{inst.tapped ? 'Untap' : 'Tap'}</button>
        )}
        <button className="btn btn--ghost btn--sm" onClick={() => onDo({ type: 'reveal', id: inst.id })}>Reveal</button>
        {MOVES.filter((move) => move.zone !== inst.zone || move.to).map((move) => (
          <button
            key={`${move.zone}${move.to ?? ''}`}
            className="btn btn--ghost btn--sm"
            onClick={() => onDo({ type: 'move', id: inst.id, zone: move.zone, to: move.to ?? 'top' })}
          >
            {move.label}
          </button>
        ))}
        {card && <button className="btn btn--ghost btn--sm" onClick={onInspect}>Read it</button>}
      </div>
    </section>
  )
}
