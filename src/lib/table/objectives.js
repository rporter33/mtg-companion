/**
 * What a lesson asks for, judged from consequences.
 *
 * A goal is a question about the committed state and event log, never
 * about which button was pressed: "Grizzly Bears is on the battlefield and
 * the sources that paid for it are tapped" is satisfied by any legal way of
 * getting there. Evidence for the lesson's progress record is built from
 * these plus whether hints were shown, by the screen, not here.
 */
import { battlefield, cardOf } from './model.js'

/** Standard goal shapes scenarios can name. */
export const GOALS = {
  /** A permanent from the given card is on the learner's battlefield, put there by a resolved spell. */
  resolved(cardId) {
    return {
      id: `resolved:${cardId}`,
      done: (state, events) => events.some((e) => e.type === 'spellResolved' && state.cards[e.instanceId]?.cardId === cardId)
        && battlefield(state, 'you').some((c) => c.cardId === cardId),
    }
  },
  /** A spell of the given card was cast by the learner (it may still be on the stack). */
  cast(cardId) {
    return { id: `cast:${cardId}`, done: (state, events) => events.some((e) => e.type === 'spellCast' && e.player === 'you' && state.cards[e.instanceId]?.cardId === cardId) }
  },
  /** The learner answered the lesson's why-question correctly. Judged by the screen, recorded as an event. */
  explained(questionId) {
    return { id: `explained:${questionId}`, done: (state, events) => events.some((e) => e.type === 'explained' && e.questionId === questionId && e.correct) }
  },
  /** A creature of the given card the opponent controlled has died. */
  killed(cardId) {
    return { id: `killed:${cardId}`, done: (state, events) => events.some((e) => e.type === 'creatureDied' && state.cards[e.instanceId]?.cardId === cardId && state.cards[e.instanceId]?.owner === 'foe') }
  },
  /** The learner's creature of the given card is still on the battlefield. */
  survives(cardId) {
    return { id: `survives:${cardId}`, done: (state) => battlefield(state, 'you').some((c) => c.cardId === cardId) }
  },
  /** The opponent's life is at most the given value. */
  lifeAtMost(player, value) {
    return { id: `life:${player}<=${value}`, done: (state) => state.life[player] <= value }
  },
  /** The learner predicted a result before it happened. Recorded by the screen. */
  predicted(questionId) {
    return { id: `predicted:${questionId}`, done: (state, events) => events.some((e) => e.type === 'predicted' && e.questionId === questionId && e.correct) }
  },
}

/** Every goal's status, and whether the lesson is complete. */
export function evaluate(scenario, state, events) {
  const goals = scenario.goals.map((goal) => ({ id: goal.id, label: goal.label, done: goal.done(state, events) }))
  return { goals, complete: goals.every((g) => g.done) }
}

/** The name of a card for a goal label. */
export const nameFor = (cardId) => cardOf({ cardId }).name
