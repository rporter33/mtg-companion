/**
 * What a table the engine holds says when its game has to come back
 * (HANDOFF.md, M7): after its relay restarted, or after its engine stopped and
 * was started again.
 *
 * The room keeps the engine's own record of the game at every stop
 * (`scripts/relay-engine.mjs`), and a relay or an engine that comes back takes
 * the game back from the last one kept. Two things are said about that, both
 * the app's own words about what the room reports, never a claim about the
 * rules: while it is coming back, that it is and that nothing pressed will
 * happen until it has; and once it is back, a line in the log saying which of
 * the two restarted and where the table is, and to the person whose move had
 * not been saved, what became of it. Nothing that cannot come back is left
 * unsaid: a game that could not come back at all is the room's `gone`, with
 * its reason, which the table already shows.
 *
 * Everything here is read forgivingly, since it comes off the wire from a relay
 * of any age: a reason this build does not know is taken as the relay's, a
 * number that is not one as none, and a lost move of a kind it does not know
 * is not claimed.
 */

/** Which of the two restarted: the engine only where the room says so, the relay otherwise. */
export const restartOf = (reason) => (reason === 'engine' ? 'engine' : 'relay')

/** Said on the table while the game is coming back, in place of anything to press. */
export function restoringLine(reason) {
  return restartOf(reason) === 'engine'
    ? 'The engine stopped, and is starting again with this game as it was at the last stop. Nothing you press will happen until it is back.'
    : 'The relay restarted, and this game is coming back as it was at the last stop. Nothing you press will happen until it is back.'
}

/**
 * What became of a move that was being answered when the game went, by which
 * of the two went. A relay that restarted had nothing to do with the move, and
 * making it again is as safe as it was the first time. An engine that stopped
 * may have stopped over the move itself: the room starts it again only once
 * before the game has gone on (`scripts/relay-engine.mjs`, `died`), so the same
 * move stopping it again ends the game, and saying "make it again" without
 * that would invite the very thing that ends it (found in M7's review).
 */
const LOST = {
  relay: {
    act: 'Your last move was not saved in time, so the table is as it was before it: make it again if you still want to.',
    decide: 'Your last answer was not saved in time, so the question is put to you again.',
  },
  engine: {
    act: 'The engine stopped while it was answering your last move, so the table is as it was before it. If it stops again before the game has gone on, the game ends there, so making the same move again may end it.',
    decide: 'The engine stopped while it was taking your last answer, so the question is put to you again. If it stops again before the game has gone on, the game ends there, so giving the same answer again may end it.',
  },
}

/**
 * Said in the log once the game is back, after the table it came back to:
 * which restarted and where the table is, and, where the room says a move of
 * this person's had not been saved, what became of it.
 *
 * `behind` is how many stops before the last one this person saw the game was
 * last saved at: none, almost always, since the room saves each stop as it is
 * published; one or more where the relay or the engine went in the moment
 * between publishing a stop and keeping it, or a snapshot failed and the one
 * before it stands.
 */
export function restoredLines(message) {
  const m = message && typeof message === 'object' ? message : {}
  const which = restartOf(m.reason)
  const who = which === 'engine' ? 'The engine restarted' : 'The relay restarted'
  const behind = Number.isInteger(m.behind) && m.behind > 0 ? m.behind : 0
  const lines = [behind
    ? `${who}; the table is as it was ${behind === 1 ? 'one stop' : `${behind} stops`} before the last you saw, the last one it had saved.`
    : `${who}; the table is as it was at the last stop.`]
  if (m.lost === 'act' || m.lost === 'decide') lines.push(LOST[which][m.lost])
  return lines
}
