/**
 * The run of views one seat is sent, and what may be drawn from it.
 *
 * An enforced room numbers every view it sends a seat (`scripts/relay-engine.mjs`):
 * the first is the table whole, and every later one may be a `delta` against
 * the one before it, carrying only the log lines added since. That is cheap
 * while the engine's turn is being watched a play at a time — a whole state
 * every few hundred milliseconds would soon be most of what the wire carried
 * — but it only works while the client has every view in the run. One missed
 * message and a delta applied to the wrong thing draws a board that is
 * quietly wrong, which is worse than one that is late.
 *
 * So the numbers are counted here. A delta that follows the view held is
 * applied; anything else — a gap, a delta with nothing to apply it to, a
 * delta that cannot be made sense of — asks the room for the table whole
 * and draws nothing until it arrives. A whole state is always taken,
 * whatever its number, because it is the engine's own word and needs
 * nothing that went before it.
 *
 * Pure: `receiveView` is given what is held and one message, and answers
 * with what is held now, what there is to draw, and whether to ask. The
 * hook (`src/features/game/useEngineRoom.js`) keeps the one and sends the
 * other.
 */
import { applyDelta } from './board.js'

/** Nothing held: no view, no number, nothing asked for. */
export const nothingHeld = () => ({ view: null, seq: 0, asking: false, dropped: 0 })

/**
 * How many deltas may be dropped waiting for a whole view before it is asked
 * for again. An ask can go missing exactly as a view can, and a seat that
 * asked once and never heard back would drop every delta for the rest of the
 * game: a board frozen where it stood, saying nothing about being behind,
 * which is worse than one a moment late and worse than one asked for twice.
 * The room's answer is the same whichever ask reaches it, and a paced table
 * sends about one delta a pace, so this is an ask every four of them.
 */
const ASK_AGAIN_AFTER = 4

/**
 * One view message taken in.
 *
 * Answers `{ held, view, resync }`: `held` to keep, `view` the one to draw
 * (null when this message left nothing new to draw), and `resync` true when
 * the room should be asked for the table whole. Asked once per gap: while an
 * answer is outstanding the deltas that follow are dropped rather than asked
 * about again, since they are all against views this seat has not got — and
 * asked again only after enough have been dropped that the ask itself looks
 * to have gone the way of the view.
 */
export function receiveView(held, message) {
  const have = held ?? nothingHeld()
  if (!message || typeof message !== 'object') return { held: have, view: null, resync: false }
  const seq = Number.isFinite(message.seq) ? message.seq : null
  const log = Array.isArray(message.log) ? message.log : []

  // The table whole. It stands on its own, so it is taken whatever it is
  // numbered and whatever was missed before it, and its log replaces the one
  // held rather than being added to it.
  if (message.state && typeof message.state === 'object') {
    const view = { ...message.state, log }
    return { held: { view, seq: seq ?? have.seq + 1, asking: false, dropped: 0 }, view, resync: false }
  }

  if (!message.delta || typeof message.delta !== 'object') return { held: have, view: null, resync: false }

  // A delta while a whole view is already on its way is a delta against a
  // view this seat will never have. Dropped, and not asked about again —
  // until enough of them have gone that the ask itself looks lost.
  if (have.asking) {
    const dropped = (have.dropped ?? 0) + 1
    if (dropped < ASK_AGAIN_AFTER) return { held: { ...have, dropped }, view: null, resync: false }
    return { held: { ...have, dropped: 0 }, view: null, resync: true }
  }
  const follows = have.view && (seq == null || seq === have.seq + 1)
  const next = follows ? applyDelta(have.view, message.delta, { log }) : null
  // Nothing to apply it to, a number that skipped one, or a delta this
  // build cannot read: ask, and go on drawing the last board known to be
  // right until the answer comes.
  if (!next) return { held: { ...have, asking: true, dropped: 0 }, view: null, resync: true }
  return { held: { view: next, seq: seq ?? have.seq + 1, asking: false, dropped: 0 }, view: next, resync: false }
}
