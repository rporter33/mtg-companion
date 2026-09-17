import { useState } from 'react'
import CardImage from '../../components/CardImage.jsx'
import {
  newGame, mulligan, keep, draw, nextTurn, bottomCount, describeHand, OPENING_HAND,
} from '../../lib/goldfish.js'
import { isLandCard } from '../../lib/deck.js'
import { openingHandOdds, percent } from '../../lib/probability.js'

/**
 * Draw a real hand from this deck.
 *
 * The Analysis tab computes what an opening hand should look like across a
 * thousand games. This shows one. Both are worth having: a player deciding
 * whether to cut a land wants the number, and then wants to see seven cards.
 */
export default function DeckPlaytest({ deck, lookup, cards, onOpenCard }) {
  const [onPlay, setOnPlay] = useState(true)
  const [game, setGame] = useState(null)
  const [chosen, setChosen] = useState(new Set())

  const size = deck.main.reduce((n, e) => n + e.quantity, 0)
  const lands = deck.main.reduce(
    (n, e) => n + (lookup(e.cardId) && isLandCard(lookup(e.cardId)) ? e.quantity : 0), 0,
  )

  const start = (play = onPlay) => {
    setChosen(new Set())
    setGame(newGame(deck, lookup, { onPlay: play }))
  }

  if (size < OPENING_HAND) {
    return (
      <div className="empty">
        <h3>Not enough cards yet</h3>
        <p>A hand is seven cards. This deck has {size}.</p>
      </div>
    )
  }

  if (!game) {
    return (
      <div className="stack">
        <p className="muted">
          Shuffle and look. {lands} of {size} cards in this deck are lands, so an opening seven
          holds at least two about {percent(1 - openingHandOdds(size, lands, 2))} of the time —
          {' '}but that is the average of a thousand games, and you only get to play this one.
        </p>
        <div className="row row--wrap">
          {[[true, 'On the play'], [false, 'On the draw']].map(([value, label]) => (
            <button
              key={label}
              className={`chip ${onPlay === value ? 'chip--active' : ''}`}
              aria-pressed={onPlay === value}
              onClick={() => setOnPlay(value)}
            >
              {label}
            </button>
          ))}
          <button className="btn btn--primary" onClick={() => start()}>Draw a hand</button>
        </div>
      </div>
    )
  }

  const needed = bottomCount(game)
  const shape = describeHand(game.hand, isLandCard)
  const toggle = (i) => {
    const next = new Set(chosen)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setChosen(next)
  }

  return (
    <div className="stack">
      <div className="row row--wrap">
        <span className="chip">Turn {game.turn}</span>
        <span className={`chip ${shape.keepable ? '' : 'chip--warn'}`}>
          {shape.lands} land{shape.lands === 1 ? '' : 's'}, {shape.spells} spell{shape.spells === 1 ? '' : 's'}
        </span>
        <span className="chip">{game.library.length} left</span>
        {game.mulligans > 0 && <span className="chip chip--warn">Mulligan {game.mulligans}</span>}
        {/*
          Reachable mid-hand, not only from the intro screen. Once a hand was
          drawn there was no way back to the choice at all, and which side of
          the table you are on is the thing people flip between most.
          Switching reshuffles, because you cannot change sides mid-game.
        */}
        <button
          className="chip"
          title="Switch sides and shuffle up again"
          onClick={() => { setOnPlay(!game.onPlay); start(!game.onPlay) }}
        >
          {game.onPlay ? 'On the play' : 'On the draw'}
        </button>
      </div>

      {game.error && <div className="banner banner--warn tiny">{game.error}</div>}

      {!game.kept && needed > 0 && (
        <p className="faint tiny" style={{ margin: 0 }}>
          A London mulligan draws a fresh seven every time. Keeping this one means putting
          {' '}{needed} card{needed === 1 ? '' : 's'} on the bottom — tap the ones to lose.
          {' '}{chosen.size} of {needed} chosen.
        </p>
      )}

      <div className="hand-grid">
        {game.hand.map((card, i) => (
          <button
            key={`${card.id}-${i}`}
            className={`hand-card ${chosen.has(i) ? 'hand-card--chosen' : ''}`}
            onClick={() => (game.kept ? onOpenCard?.(card) : toggle(i))}
            aria-pressed={game.kept ? undefined : chosen.has(i)}
            aria-label={game.kept ? `Open ${card.name}` : `Put ${card.name} on the bottom`}
          >
            <CardImage card={card} size="normal" />
          </button>
        ))}
      </div>

      <div className="row row--wrap">
        {!game.kept && (
          <>
            <button
              className="btn btn--primary"
              disabled={chosen.size !== needed}
              onClick={() => { setGame(keep(game, [...chosen])); setChosen(new Set()) }}
            >
              {needed > 0 ? `Keep, bottom ${needed}` : 'Keep'}
            </button>
            <button
              className="btn"
              onClick={() => { setGame(mulligan(game, deck, lookup)); setChosen(new Set()) }}
            >
              Mulligan to {OPENING_HAND - (game.mulligans + 1)}
            </button>
          </>
        )}
        {game.kept && (
          <>
            <button className="btn btn--primary" onClick={() => setGame(nextTurn(game))}>
              Next turn
            </button>
            <button className="btn" onClick={() => setGame(draw(game, 1))}>Draw one</button>
          </>
        )}
        <span className="spacer" />
        <button className="btn btn--ghost" onClick={() => start()}>Shuffle up</button>
      </div>

      {game.kept && game.bottomed.length > 0 && (
        <p className="faint tiny" style={{ margin: 0 }}>
          Bottomed: {game.bottomed.map((c) => c.name).join(', ')}.
        </p>
      )}

      {cards.size === 0 && (
        <p className="faint tiny">Cards are still loading — the hand will look right once they arrive.</p>
      )}
    </div>
  )
}
