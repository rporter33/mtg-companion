/**
 * What a step of the turn is for, said at the engine's table the first few
 * times a person stops in it: the Learning preset's "explain as you go"
 * (lib/engine/pace.js; docs/MOXGATE_STUDY.md, the teaching line under the
 * step). The words are docs/TURN_STRUCTURE.md's, as src/data/turn-structure.js
 * transcribes them, each with its rule number; nothing here says anything the
 * turn's own reference does not. The prompt says where you are and what you may
 * do; this is only the second half, the fact about the turn, which is why it
 * never says "nothing to respond with" — that is the prompt's to say.
 *
 * How many times each step has been explained is kept with the player's table
 * preferences (`tableTaught`), so "the first few times" is across games, and
 * read forgivingly, any build having written it.
 *
 * Pure.
 */
import { STEPS } from '../../data/turn-structure.js'
import { EXPLAIN_TIMES } from './pace.js'

/**
 * Whether a line of the reference can happen at a table of this many players:
 * a line it scopes to multiplayer games only where there are more than two, and
 * one it scopes to Archenemy games never, since this app deals none.
 */
const happensAt = (line, seats) => !line.only || (line.only === 'multiplayer' && seats > 2)

/**
 * A step's teaching: its phase and name, its rule, and what it is for. The
 * step's note comes first, since it is the part that says what a person may do
 * there, then what happens in it, in the reference's order, each with its rule;
 * a line the reference scopes to other games is left out where it cannot happen
 * (`seats`, the players at the table; the engine's table has two). `note` and
 * `does` are the two halves, for a prompt that shows only one; `lines` is both.
 * Null for a step no person is ever stopped in — the untap step and the cleanup
 * step, where nobody gets priority (500.3) — and for a step this build does not
 * know.
 */
export function teachingFor(stepId, { seats = 2 } = {}) {
  const step = STEPS.find((s) => s.id === stepId)
  if (!step || !step.priority) return null
  const note = step.note ? { text: step.note, rule: null } : null
  const does = step.does.filter((d) => happensAt(d, seats)).map((d) => ({ text: d.text, rule: d.rule }))
  return {
    id: step.id,
    phase: step.phaseName,
    step: step.name,
    rule: step.rule,
    note,
    does,
    lines: [...(note ? [note] : []), ...does],
  }
}

/** A teaching's head, "Combat phase · Declare attackers (508.)", which says what it is the reference for. */
export const teachingHead = (t) => (t ? `${t.phase} · ${t.step} (${t.rule})` : null)

/** Where the turn panel stands beside the prompt, what a step with no note of its own says instead. */
export const TURN_PANEL_LINE = 'The turn panel under the log says what happens in it.'

/**
 * What a teaching says after its head. All of it, where it is read on its own;
 * where the turn panel stands beside the prompt (`beside`) — the table held
 * sideways, or on a desktop — that panel already shows what happens in the
 * step with the same rule numbers, so only the note is said, or, for a step
 * with none, where to look.
 */
export function teachingBody(t, { beside = false } = {}) {
  if (!t) return ''
  if (beside && !t.note) return TURN_PANEL_LINE
  return (beside ? [t.note] : t.lines).map((l) => (l.rule ? `${l.text} (${l.rule})` : l.text)).join(' ')
}

/** A teaching as one line of text, for a screen reader and a test alike. */
export function teachingWords(t) {
  if (!t) return null
  return `${t.phase}, ${t.step} (${t.rule}): ${teachingBody(t)}`
}

/**
 * Whether a stop's step is the person's to be taught: what the reference says
 * of a step is the active player's allowances, so a stop in their own turn, or
 * a block they are asked to declare in the other's (509.1, the defending
 * player's). A stop in the engine's turn with only a pass on it is not: taught
 * there, a step's first three times would be spent on turns where none of it
 * was theirs to do.
 */
export const teachesHere = ({ active, me, blocking = false }) => Boolean(me) && (active === me || Boolean(blocking))

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

/** How many times a step has been explained, from what was kept; 0 for anything unreadable. */
export function timesTaught(taught, stepId) {
  const n = obj(obj(taught).times)[stepId]
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/** Whether any step has been explained yet, so there is something to explain again. */
export const taughtAny = (taught) => Object.values(obj(obj(taught).times)).some((n) => Number.isInteger(n) && n > 0)

/** Whether a step has been explained its first few times already. */
export const taughtEnough = (taught, stepId) => timesTaught(taught, stepId) >= EXPLAIN_TIMES

/** The stop the last explanation was counted at, `code:stop`, or null. */
export const taughtAt = (taught) => (typeof obj(taught).at === 'string' ? obj(taught).at : null)

/**
 * What to keep once a step has been explained at a stop: one more time for it,
 * and the stop it was counted at, so a reload at the same stop shows the same
 * explanation without counting it twice.
 */
export function taughtOnce(taught, stepId, at) {
  const times = Object.fromEntries(Object.entries(obj(obj(taught).times)).filter(([, n]) => Number.isInteger(n) && n >= 0))
  return { times: { ...times, [stepId]: timesTaught(taught, stepId) + 1 }, at }
}
