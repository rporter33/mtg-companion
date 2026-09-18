/**
 * Evidence of learning, per lesson, kept apart.
 *
 * Three kinds that do not replace one another: viewed (the lesson was
 * opened), practiced (an exercise was completed, hints allowed), and
 * demonstrated (two different exercises of the lesson completed with no
 * hints, each ending in a correct prediction or explanation, which every
 * exercise has). Viewing never implies skill; paper practice is a
 * self-report and is not evidence here; nothing earned is removed by
 * revisiting. The threshold is a product default to try with learners,
 * not a validated cutoff, and the screen says as much.
 */
import { LESSONS, scenarioById } from './scenarios/index.js'

export const DEMONSTRATION_RUNS = 2

/** What the record says about a lesson. */
export function evidenceFor(lessonId, practice) {
  const record = practice?.evidence?.[lessonId] ?? {}
  const completions = record.completions ?? {}
  const clean = Object.values(completions).filter((c) => c.hints === 0).length
  const demonstrated = Boolean(record.demonstrated) || clean >= DEMONSTRATION_RUNS
  return {
    viewed: Boolean(record.viewed),
    practiced: Boolean(record.practiced) || Object.keys(completions).length > 0,
    demonstrated,
    completed: Object.keys(completions),
    clean,
    status: demonstrated ? 'demonstrated' : Object.keys(completions).length ? 'practiced' : record.viewed ? 'viewed' : 'new',
  }
}

/** The next exercise worth doing: the first in lesson order not yet completed, else the first not completed without hints, else null. */
export function nextScenario(practice) {
  for (const lesson of LESSONS) {
    const done = practice?.evidence?.[lesson.id]?.completions ?? {}
    for (const id of lesson.scenarios) if (!done[id]) return { lesson, scenario: scenarioById(id), why: 'not yet done' }
  }
  for (const lesson of LESSONS) {
    const done = practice?.evidence?.[lesson.id]?.completions ?? {}
    for (const id of lesson.scenarios) if (done[id] && done[id].hints > 0) return { lesson, scenario: scenarioById(id), why: 'done with hints' }
  }
  return null
}

/** A completion merged into a record: the fewest hints seen is kept, and the first date. */
export function withCompletion(record, scenarioId, { hints = 0, at }) {
  const completions = { ...(record?.completions ?? {}) }
  const previous = completions[scenarioId]
  completions[scenarioId] = previous
    ? { hints: Math.min(previous.hints, hints), at: previous.at }
    : { hints, at }
  return { ...(record ?? {}), completions }
}
