import { useMemo, useState } from 'react'
import CardImage from '../../components/CardImage.jsx'
import {
  newGame, mulligan, keep, draw, nextTurn, bottomCount, describeHand, OPENING_HAND,
} from '../../lib/goldfish.js'
import { isLandCard } from '../../lib/deck.js'
import { getFormat } from '../../lib/formats.js'
import { openingHandOdds, percent } from '../../lib/probability.js'
import { diagnoseHand, proposeChange, applyChange, describeChange } from '../../lib/practice.js'
import { captureVersion } from '../../lib/versions.js'
import { getCardsByNames } from '../../lib/scryfall.js'

/**
 * Draw a real hand from this deck.
 *
 * The Analysis tab computes what an opening hand should look like across a
 * thousand games. This shows one. Both are worth having: a player deciding
 * whether to cut a land wants the number, and then wants to see seven cards.
 */
export default function DeckPlaytest({ deck, lookup, cards, onOpenCard, onChange }) {
  const [onPlay, setOnPlay] = useState(true)
  // Commander is usually a pod of three or more, where nobody skips the
  // first draw; every other format defaults to the two-player rule.
  const [multiplayer, setMultiplayer] = useState(() => getFormat(deck.formatId)?.group === 'commander')
  const [game, setGame] = useState(null)
  const [chosen, setChosen] = useState(new Set())

  const size = deck.main.reduce((n, e) => n + e.quantity, 0)
  // The library is built from cards that have loaded, not from the list. Until
  // every entry resolves, a shuffle would deal from a deck missing whatever is
  // still in flight — and a hand short of lands is exactly the thing this tab
  // exists to notice, so it must never manufacture one.
  const loaded = deck.main.reduce((n, e) => n + (lookup(e.cardId) ? e.quantity : 0), 0)
  const ready = loaded === size
  const lands = deck.main.reduce(
    (n, e) => n + (lookup(e.cardId) && isLandCard(lookup(e.cardId)) ? e.quantity : 0), 0,
  )

  const start = (play = onPlay, pod = multiplayer) => {
    setChosen(new Set())
    setGame(newGame(deck, lookup, { onPlay: play, multiplayer: pod }))
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
          holds at least two about {percent(openingHandOdds(size, lands, 2))} of the time —
          {' '}but that is the average of a thousand games, and you only get to play this one.
        </p>
        <div className="row row--wrap" role="group" aria-label="Table">
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
          {[[false, 'Two players'], [true, 'Three or more']].map(([value, label]) => (
            <button
              key={label}
              className={`chip ${multiplayer === value ? 'chip--active' : ''}`}
              aria-pressed={multiplayer === value}
              title={value ? 'With three or more players, nobody skips the first draw' : 'The player going first skips the first draw'}
              onClick={() => setMultiplayer(value)}
            >
              {label}
            </button>
          ))}
          <button className="btn btn--primary" onClick={() => start()} disabled={!ready}>
            {ready ? 'Draw a hand' : `Loading cards… ${loaded}/${size}`}
          </button>
        </div>
        {ready && onChange && <TryAChange deck={deck} lookup={lookup} onChange={onChange} />}
      </div>
    )
  }

  const needed = bottomCount(game)
  const shape = describeHand(game.hand, isLandCard)
  const reading = diagnoseHand(game.hand)
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
          onClick={() => { setOnPlay(!game.onPlay); start(!game.onPlay, game.multiplayer) }}
        >
          {game.onPlay ? 'On the play' : 'On the draw'}
        </button>
        <button
          className="chip"
          title={game.multiplayer ? 'Three or more players: nobody skips the first draw. Switch to two and shuffle up again' : 'Two players: the first player skips the first draw. Switch to a pod and shuffle up again'}
          onClick={() => { setMultiplayer(!game.multiplayer); start(game.onPlay, !game.multiplayer) }}
        >
          {game.multiplayer ? 'Three or more' : 'Two players'}
        </button>
      </div>

      {game.error && <div className="banner banner--warn tiny">{game.error}</div>}

      {!game.kept && needed > 0 && (
        <p className="faint tiny m0">
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
        <p className="faint tiny m0">
          Bottomed: {game.bottomed.map((c) => c.name).join(', ')}.
        </p>
      )}

      {/*
        What this hand says, as observations about these cards and nothing
        more: which colours the lands make, which spells have no source,
        what can be cast by turn three from these lands alone. Not a keep
        or mulligan verdict — that decision is the thing being practised.
      */}
      <section className="panel stack stack--snug hand-reading" aria-label="What this hand says">
        <h3 className="m0">What this hand says</h3>
        <ul className="hand-reading__notes">
          {reading.notes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      </section>

      {onChange && <TryAChange deck={deck} lookup={lookup} onChange={onChange} />}
    </div>
  )
}

/**
 * One change to the deck, with the odds before and after. The change comes
 * from the list, not the hand: a hand is seven random cards and the list is
 * what keeps dealing them. Making it goes through the editor's commit path
 * with the list before it kept as a version, so it is one restore away.
 */
function TryAChange({ deck, lookup, onChange }) {
  const [busy, setBusy] = useState(false)
  const change = useMemo(() => proposeChange(deck, lookup), [deck, lookup])
  if (!change) {
    return (
      <section className="panel stack stack--snug" aria-label="Try a change">
        <h3 className="m0">Try a change</h3>
        <p className="faint tiny m0">Nothing to suggest: the land count fits this curve and every colour has the sources it asks for.</p>
      </section>
    )
  }
  const make = async () => {
    setBusy(true)
    try {
      let basic = null
      if (!deck.main.some((e) => lookup(e.cardId)?.name === change.addBasic)) {
        const found = await getCardsByNames([change.addBasic])
        basic = [...found.values()][0] ?? null
        if (!basic) return
      }
      const kept = captureVersion(deck, { label: `Before: ${describeChange(change)}`, auto: true })
      onChange(applyChange(kept, change, lookup, basic))
    } finally {
      setBusy(false)
    }
  }
  const pct = (p) => percent(p, 0)
  return (
    <section className="panel stack stack--snug" aria-label="Try a change">
      <h3 className="m0">Try a change: {describeChange(change)}</h3>
      <p className="tiny m0">{change.reason}</p>
      <table className="odds">
        <thead><tr><th>Lands only</th><th>Now</th><th>After</th></tr></thead>
        <tbody>
          <tr><td>Two lands in the opening seven</td><td className="mono">{pct(change.before.twoLands)}</td><td className="mono">{pct(change.after.twoLands)}</td></tr>
          <tr><td>Every land drop through turn {change.before.targetTurn}, on the play</td><td className="mono">{pct(change.before.onCurve)}</td><td className="mono">{pct(change.after.onCurve)}</td></tr>
          <tr><td>Opening hand with no lands</td><td className="mono">{percent(change.before.noLands, 1)}</td><td className="mono">{percent(change.after.noLands, 1)}</td></tr>
        </tbody>
      </table>
      <p className="faint tiny m0">{change.assumptions}</p>
      <div className="row row--wrap">
        <button className="btn btn--sm" onClick={make} disabled={busy}>
          {busy ? 'Making it…' : 'Make this change'}
        </button>
        <span className="faint tiny">The list as it is now is kept in History, one restore away.</span>
      </div>
    </section>
  )
}
