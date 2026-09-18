/**
 * Running a table: applying actions, keeping the log, and saving.
 *
 * What gets stored is a snapshot of the board plus a short tail of recent
 * actions for undo. The snapshot rather than the whole log, because an
 * unenforced table produces an action every time a card is nudged and a
 * three-hour game would be tens of thousands of them. The tail is what
 * undo walks back through.
 *
 * The full log still matters for the networked modes, where two devices
 * apply the same actions to reach the same board. That is why every
 * action is small, serialisable and free of any clock.
 */
import { apply } from './reducer.js'
import { createBoard, invariants, upgrade } from './model.js'

export const UNDO_DEPTH = 40

/** Applies an action and keeps the events. Refusals come back untouched. */
export function act(run, action) {
  const result = apply(run.board, action)
  if (!result.ok) return { ...run, refusal: { ...result.reason, action } }
  // Events carry the turn they happened on, so the coach can count this turn's.
  const events = result.events.map((e) => ({ ...e, turn: run.board.turn }))
  return {
    ...run,
    board: result.board,
    events: [...run.events, ...events].slice(-600),
    lastEvents: events,
    past: [...run.past, run.board].slice(-UNDO_DEPTH),
    refusal: null,
    seq: run.seq + 1,
  }
}

export function undo(run) {
  if (!run.past.length) return run
  const board = run.past[run.past.length - 1]
  return { ...run, board, past: run.past.slice(0, -1), lastEvents: [], refusal: null, seq: run.seq + 1 }
}

export function newRun(board = createBoard()) {
  return { board, events: [], lastEvents: [], past: [], refusal: null, seq: 0 }
}

/** Applies a list of actions in order, stopping at the first that will not go. */
export function applyAll(run, actions) {
  let next = run
  for (const action of actions) {
    const result = act(next, action)
    if (result.refusal) return { run: next, applied: actions.indexOf(action), refusal: result.refusal }
    next = result
  }
  return { run: next, applied: actions.length, refusal: null }
}

/** What goes to storage: the board, and nothing derived from it. */
export function snapshot(run, meta = {}) {
  return { version: 1, board: run.board, savedAt: new Date().toISOString(), ...meta }
}

/**
 * Rebuilds a run from a snapshot.
 *
 * Whatever is in storage, the worst outcome here is null — meaning "deal a
 * fresh table" — and never a broken screen. A board saved by an older build
 * is an ordinary thing and gets brought up to date; a board this build cannot
 * make sense of is dropped. Wrapped, because a save can also be edited by
 * hand, truncated by a full disk, or written by a version that does not exist
 * yet, and none of those are worth losing the app over.
 */
export function restore(saved) {
  try {
    if (!saved || saved.version !== 1 || !saved.board?.players?.length) return null
    const board = upgrade(saved.board)
    if (!board || invariants(board).length) return null
    return { ...newRun(board), restored: true }
  } catch {
    return null
  }
}
