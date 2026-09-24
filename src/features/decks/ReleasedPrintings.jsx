import { useEffect, useMemo, useRef, useState } from 'react'
import { findReleasedFor } from '../../lib/scryfall.js'
import { today } from '../../lib/season.js'
import { allCardIds } from '../../lib/deck.js'
import {
  notOutPrintings, notOutSummary, switchPlan, switchLine, joinNote, keptLine, applySwitches, SWITCH_LABEL,
} from '../../lib/released-switch.js'

/**
 * The offer to move a deck off printings that are not out yet (see
 * released-switch.js for why it is an offer and never a repair).
 *
 * It says how many printings and until when, asks Scryfall only when the
 * player presses, lists every switch and every card with nothing to switch
 * to, and changes the deck only on the player's word. It keeps nothing: "Not
 * now" lasts while the deck is open, and the editor mounts this afresh for
 * each deck it opens, so the offer is back the next time. Nothing is stored
 * about it, not even that it was declined.
 *
 * Scryfall is asked fifteen cards to a search, and a search that fails leaves
 * its cards and every card after it unasked (findReleasedPrintings). So an
 * answer can be partial: those cards are listed apart from the ones Scryfall
 * answered for, and "Try again" asks about them alone, before the switch or
 * after it.
 *
 * `onSwitch(next, arrived)` saves the switched deck; `arrived` is the new
 * printings, in hand, so the save can stamp their names and snapshot their
 * legality before the editor has loaded them. `onDismiss` is where focus
 * goes when the offer goes, since the button that had it goes too.
 */
export default function ReleasedPrintings({
  deck, cards, lookup, offline, onSwitch, onDismiss, now = today(),
}) {
  // `now` is the app's day, as every "Not out until" label reads it, so the
  // offer and the labels agree, and both go on release day. A test passes it.
  // `cards` stands in for `lookup`, which is a new function every render: the
  // map is what changes when records arrive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const held = useMemo(() => notOutPrintings(deck, lookup, now), [deck, cards, now])

  const [stage, setStage] = useState('offer')
  // Scryfall's answer for each printing asked about, by id. A second ask adds
  // to the first rather than replacing it.
  const [answers, setAnswers] = useState(() => new Map())
  const [askingFor, setAskingFor] = useState(0)
  const [outcome, setOutcome] = useState(null)
  const asking = useRef(null)
  const focusHere = useRef(null)

  // Closing the deck leaves nothing of this waiting in Scryfall's queue.
  useEffect(() => () => asking.current?.abort(), [])
  // Each stage replaces the buttons of the one before it, and the focus they
  // had, so focus goes to what came in their place.
  useEffect(() => {
    if (stage !== 'offer') focusHere.current?.focus()
  }, [stage])

  // The plan is made from the deck as it is now and every answer so far, for
  // the printings that were asked about. A printing taken out of the deck
  // meanwhile drops out of it, and so is not put back by a switch; one added
  // meanwhile waits for the next ask.
  const plan = useMemo(() => {
    const asked = held.filter((h) => answers.has(h.cardId))
    return switchPlan(deck, asked, asked.map((h) => answers.get(h.cardId)))
  }, [deck, held, answers])

  if (stage === 'hidden' || (stage === 'offer' && !held.length)) return null

  const dismiss = () => {
    asking.current?.abort()
    setStage('hidden')
    onDismiss?.()
  }

  /** Asks Scryfall about every printing not out, or about the ids in `only`. */
  const find = async (only = null) => {
    asking.current?.abort()
    const controller = new AbortController()
    asking.current = controller
    const these = only ? held.filter((h) => only.has(h.cardId)) : held
    setAskingFor(these.length)
    setStage('asking')
    let found
    try {
      found = await findReleasedFor(these.map((h) => h.card), { signal: controller.signal, now })
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) return
      // Nothing is known about any of them, and the screen says so.
      found = these.map(() => ({ answer: 'unchecked' }))
    }
    if (controller.signal.aborted) return
    setAnswers((before) => {
      const next = new Map(before)
      these.forEach((h, i) => next.set(h.cardId, found[i]))
      return next
    })
    setStage('plan')
  }

  const { switches, kept } = plan
  // Scryfall's word on these, against no word at all on the rest: the screen
  // claims no more than the answer did, and offers to ask about the rest again.
  const answered = kept.filter((k) => k.answer !== 'unchecked')
  const unchecked = kept.filter((k) => k.answer === 'unchecked')
  const askAgain = () => find(new Set(unchecked.map((k) => k.cardId)))

  const apply = () => {
    // The deck as it is now, not as it was when the plan was made: a printing
    // taken out of the deck meanwhile is not put back by a switch.
    const before = new Set(allCardIds(deck))
    const next = applySwitches(deck, switches)
    if (next !== deck) onSwitch(next, new Map(switches.map((s) => [s.to.id, s.to])))
    setOutcome({
      switched: next === deck ? 0 : switches.filter((s) => before.has(s.fromId)).length,
      kept: answered.length,
      unchecked: unchecked.length,
      // No checkpoint is taken when the newest version already holds these
      // lists (see captureVersion), and then the sentence must not name one.
      checkpoint: next !== deck && next.versions?.[0] !== deck.versions?.[0],
    })
    setStage('done')
  }

  if (stage === 'done') {
    return (
      <div className="banner banner--info stack stack--snug">
        <p className="m0" role="status" tabIndex={-1} ref={focusHere}>{doneText(outcome)}</p>
        {unchecked.length > 0 && (
          <div className="row row--wrap">
            <button className="btn btn--sm" onClick={askAgain}>Try again</button>
          </div>
        )}
      </div>
    )
  }

  const unanswered = stage === 'plan' && !switches.length && !answered.length && unchecked.length > 0

  return (
    <section className="banner banner--info stack stack--snug" aria-label="Printings not out yet">
      <strong>{notOutSummary(held)}</strong>

      {stage === 'offer' && (
        <>
          <span className="tiny">
            Each is labelled on its row, and the label goes on the day it comes out. The app can look
            for the newest paper printing of the same card that is out, and show you each switch
            before anything changes.
          </span>
          <div className="row row--wrap">
            <button className="btn btn--sm" onClick={() => find()}>Find released printings</button>
            <button className="btn btn--sm btn--ghost" onClick={dismiss}>Not now</button>
          </div>
        </>
      )}

      {stage === 'asking' && (
        <>
          <p className="m0 tiny" tabIndex={-1} ref={focusHere}>
            Asking Scryfall for a printing that is out, for {askingFor} card{askingFor === 1 ? '' : 's'}…
          </p>
          <div className="row row--wrap">
            <button className="btn btn--sm btn--ghost" onClick={dismiss}>Not now</button>
          </div>
        </>
      )}

      {unanswered && (
        <>
          <p className="m0" tabIndex={-1} ref={focusHere}>
            Scryfall could not be asked just now{offline ? ', and this device is offline' : ''}.
            Nothing in the deck has changed.
          </p>
          <div className="row row--wrap">
            <button className="btn btn--sm" onClick={askAgain}>Try again</button>
            <button className="btn btn--sm btn--ghost" onClick={dismiss}>Not now</button>
          </div>
        </>
      )}

      {stage === 'plan' && !unanswered && (
        <>
          <p className="m0" tabIndex={-1} ref={focusHere}>
            {switches.length === 1 ? 'The app would make this switch:'
              : switches.length > 1 ? `The app would make these ${switches.length} switches:`
                : unchecked.length ? 'None that Scryfall answered for has a printing to switch to yet.'
                  : 'There is nothing to switch to yet.'}
          </p>
          {switches.length > 0 && (
            <ul className="violation-list" aria-label="Switches the app would make">
              {switches.map((s) => {
                const note = joinNote(s.joins)
                return (
                  <li key={s.fromId}>
                    {switchLine(s)}
                    {note && <span className="tiny"> ({note})</span>}
                  </li>
                )
              })}
            </ul>
          )}
          {/* Under its own words, or it reads as one more switch. */}
          {switches.length > 0 && answered.length > 0 && (
            <p className="m0">{answered.length === 1 ? 'One has nothing to switch to:' : `${answered.length} have nothing to switch to:`}</p>
          )}
          {answered.length > 0 && (
            <ul className="violation-list" aria-label="Printings that stay as they are">
              {answered.map((k) => <li key={k.cardId}>{keptLine(k)}</li>)}
            </ul>
          )}
          {unchecked.length > 0 && (
            <>
              <p className="m0">
                {unchecked.length === 1 ? 'Scryfall could not be asked about one of them just now:'
                  : `Scryfall could not be asked about ${unchecked.length} of them just now:`}
              </p>
              <ul className="violation-list" aria-label="Printings Scryfall could not be asked about">
                {unchecked.map((k) => <li key={k.cardId}>{keptLine(k)}</li>)}
              </ul>
            </>
          )}
          {switches.length > 0 && (
            <span className="tiny">
              The app chose each one: the newest paper printing of the same card that is out, by
              Scryfall&rsquo;s release dates, which is the printing an import takes when the app picks.
              It cannot tell a printing you chose from one it picked, so nothing changes until you say.
              The deck as it stands is kept in History first.
            </span>
          )}
          <div className="row row--wrap">
            {switches.length > 0 && (
              <button className="btn btn--sm" onClick={apply}>
                {switches.length === 1 ? 'Switch this' : 'Switch these'}
              </button>
            )}
            {unchecked.length > 0 && (
              <button className="btn btn--sm" onClick={askAgain}>Try again</button>
            )}
            <button className="btn btn--sm btn--ghost" onClick={dismiss}>
              {switches.length || unchecked.length ? 'Not now' : 'Close'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * What the switch did, what it left and why, and where the deck as it was
 * can be found. A printing Scryfall was never asked about is not called one
 * with nothing to switch to.
 */
function doneText({ switched, kept, unchecked = 0, checkpoint }) {
  const stays = kept === 0 ? ''
    : kept === 1 ? ' 1 printing with nothing to switch to stays as it is.'
      : ` ${kept} printings with nothing to switch to stay as they are.`
  const unasked = unchecked === 0 ? ''
    : unchecked === 1 ? ' 1 printing Scryfall could not be asked about stays as it is for now.'
      : ` ${unchecked} printings Scryfall could not be asked about stay as they are for now.`
  if (!switched) return `Nothing was switched, because the deck no longer holds those printings.${stays}${unasked}`
  const history = checkpoint
    ? ` The deck as it stood is in History, as “${SWITCH_LABEL}”.`
    : ' The deck as it stood is already the newest version in History.'
  return `Switched ${switched} printing${switched === 1 ? '' : 's'}.${stays}${unasked}${history}`
}
