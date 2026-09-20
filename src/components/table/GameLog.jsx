import { useMemo, useState } from 'react'
import { readLogNamed } from '../../lib/board/log.js'
import { artUrl } from '../../lib/deck-art.js'
import { STEPS } from '../../data/turn-structure.js'

const stepName = (id) => STEPS.find((step) => step.id === id)?.name?.toLowerCase() ?? id
/** "Your upkeep", "Bob's upkeep": whose step it is, then the step. */
const stepOf = (id, active, you, who) => {
  const owner = active === you ? 'Your' : `${who?.(active) ?? active}'s`
  return `${owner} ${stepName(id)}`
}

/**
 * What has happened, read back.
 *
 * The table is a record of where cards are now, and says nothing about how
 * they got there. Thirty seconds after a card moves you cannot tell whether
 * you drew that land or played it, and at a real table you would simply
 * remember, because you were the one who moved it.
 *
 * Newest first, grouped by turn, with the steps nothing happened in collapsed
 * into one quiet line — so the panel says where the game went as well as what
 * was done in it. Every sentence comes from an event the reducer already
 * emitted; nothing here inspects a card or knows a rule.
 *
 * The list of turns takes focus because it scrolls: a region with its own
 * scrollbar that cannot be tabbed to is one a keyboard user cannot read past
 * the first few lines of.
 */
export default function GameLog({ board, events, lookup, restored = false, open = true, onToggle, you = 'you', who = null }) {
  const [showing, setShowing] = useState(open)
  const nameFor = (cardId) => (cardId ? lookup?.(cardId)?.name ?? null : null)

  const turns = useMemo(
    () => readLogNamed(events ?? [], board, nameFor, { you, who }).slice(0, MOST_TURNS),
    // The events array is replaced on every action, so its identity is the
    // signal; `lookup` changes only when the card cache fills.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, board, lookup, you, who],
  )

  const toggle = () => {
    setShowing((was) => !was)
    onToggle?.(!showing)
  }

  return (
    <section className={`gamelog${showing ? '' : ' gamelog--shut'}`}>
      <h2 className="gamelog__head">
        <button
          type="button"
          className="gamelog__toggle"
          onClick={toggle}
          aria-expanded={showing}
        >
          Game log
          <span aria-hidden="true" className="gamelog__chevron">{showing ? '⌄' : '⌃'}</span>
        </button>
      </h2>

      {showing && (
        <ol className="gamelog__turns" role="list" tabIndex={0} aria-label="What has happened, newest first">
          {turns.length === 0 && (
            <li className="gamelog__empty faint tiny">
              {/*
                * A restored table has no log, and saying "nothing has
                * happened" to somebody looking at their own board from
                * yesterday would be a lie. What is stored is a snapshot of
                * where the cards are, not the history of how they got there —
                * see snapshot() in runner.js for why.
                */}
              {restored
                ? 'Picked up where you left off. What happened before was not kept.'
                : 'Nothing has happened yet.'}
            </li>
          )}
          {turns.map((turn) => (
            <li key={turn.turn}>
              <h3 className={`gamelog__turn${turn.active === you ? ' gamelog__turn--you' : ''}`}>
                {turn.active === you && <span className="gamelog__dot" aria-hidden="true" />}
                <span className="gamelog__who">{turn.active === you ? 'Your turn' : (who?.(turn.active) ?? turn.active)}</span>
                <span aria-hidden="true"> · </span>
                <span className="gamelog__turnno">Turn {turn.turn}</span>
              </h3>
              <ol className="gamelog__items" role="list">
                {turn.items.map((item, i) => {
                  if (item.kind === 'step') {
                    return (
                      <li className="gamelog__step" key={`d${i}`}>
                        <span className="gamelog__stepname">{stepOf(item.step, turn.active, you, who)}</span>
                        {item.passed.length > 0 && (
                          <span className="gamelog__passed">{item.passed.map(stepName).join(' · ')}</span>
                        )}
                      </li>
                    )
                  }
                  if (item.kind === 'passed') {
                    return <li className="gamelog__passed gamelog__passed--tail" key={`p${i}`}>{item.steps.map(stepName).join(' · ')}</li>
                  }
                  return (
                    <li className={`gamelog__item${item.hidden ? ' gamelog__item--hidden' : ''}`} key={item.seq ?? `e${i}`}>
                      {item.hidden
                        ? <span className="gamelog__thumb gamelog__thumb--hidden" aria-hidden="true" />
                        : <Thumb card={item.cardId ? lookup?.(item.cardId) : null} />}
                      <p className="gamelog__said">
                        <span className={`gamelog__actor${item.who === 'You' ? ' gamelog__actor--you' : ''}`}>
                          {item.who}
                        </span>{' '}
                        {item.text}
                      </p>
                    </li>
                  )
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * How far back the log goes on screen.
 *
 * A three-hour game is thousands of events and the panel is a few hundred
 * pixels tall. What is wanted is the last few turns; the rest is scrollback
 * nobody reads, and rendering it costs a frame on a phone.
 */
const MOST_TURNS = 12

/** The card an entry is about, cropped to its art. Decoration, so unlabelled. */
function Thumb({ card }) {
  const url = card ? artUrl(card) : null
  if (!url) return <span className="gamelog__thumb gamelog__thumb--none" aria-hidden="true" />
  return <img className="gamelog__thumb" src={url} alt="" loading="lazy" decoding="async" />
}
