/**
 * Runs a scenario: the learner's actions go through the reducer, the
 * opponent's policy answers whenever the table waits on it, and the
 * committed action log is what gets saved. Replaying the log from the
 * scenario's setup rebuilds the same state, because nothing in the model is
 * random or timed, which is how a reload resumes and how undo works.
 */
import { createState } from './model.js'
import { applyAction } from './reducer.js'
import { policyFor } from './opponent.js'

/** A composite the opponent uses: tap the named sources, pay, choose a target, commit. */
function expandCastWith(state, action) {
  const steps = [{ type: 'beginCast', player: action.player, instanceId: action.instanceId }]
  for (const id of action.sources) steps.push({ type: 'tapForMana', player: action.player, instanceId: id })
  if (action.target) steps.push({ type: 'chooseTarget', player: action.player, target: action.target })
  steps.push({ type: 'autoPay', player: action.player }, { type: 'commitCast', player: action.player })
  return steps
}

/** Lets the opponent act until the table is back with the learner (or the game ends). Returns { state, events, actions }. */
export function settle(state, scenario, limit = 200) {
  const policy = policyFor(scenario.opponent)
  const events = []
  const actions = []
  for (let i = 0; i < limit; i++) {
    if (state.over) break
    const decision = policy.decide(state)
    if (!decision) break
    const list = decision.type === 'castWith' ? expandCastWith(state, decision) : [decision]
    for (const action of list) {
      const result = applyAction(state, action)
      if (!result.ok) {
        // A policy that asks for something illegal passes instead; the game must not stall on the opponent.
        const fallback = state.awaiting?.player === 'foe'
          ? { type: state.awaiting.kind === 'attackers' ? 'declareAttackers' : state.awaiting.kind === 'blockers' ? 'declareBlockers' : 'discard', player: 'foe', attackers: [], blocks: {}, instanceIds: state.zones.hand.foe.slice(0, state.awaiting.count ?? 0) }
          : state.casting?.player === 'foe' ? { type: 'cancelCast', player: 'foe' } : { type: 'pass', player: 'foe' }
        const retry = applyAction(state, fallback)
        if (!retry.ok) return { state, events, actions, stalled: result.reason }
        state = retry.state; events.push(...retry.events); actions.push(fallback)
        break
      }
      state = result.state
      events.push(...result.events)
      actions.push(action)
    }
  }
  return { state, events, actions }
}

/** One learner action, then the opponent's replies. */
export function act(state, action, scenario) {
  const result = applyAction(state, action)
  if (!result.ok) return result
  const settled = settle(result.state, scenario)
  return { ok: true, state: settled.state, events: [...result.events, ...settled.events], actions: [action, ...settled.actions], stalled: settled.stalled }
}

/** The state a scenario starts in, after the opponent has taken any opening moves. */
export function start(scenario) {
  const settled = settle(createState(scenario), scenario)
  return { state: settled.state, events: settled.events, actions: settled.actions }
}

/** Rebuilds a state from the scenario and a saved action log. Stops at the first action that no longer applies. */
export function replay(scenario, log) {
  let state = createState(scenario)
  const events = []
  let applied = 0
  for (const action of log) {
    const result = applyAction(state, action)
    if (!result.ok) break
    state = result.state
    events.push(...result.events)
    applied += 1
  }
  return { state, events, applied }
}

/** Passes priority for the learner until `until(state)` holds or the game ends; each pass lets the opponent reply. */
export function passUntil(state, scenario, until, limit = 60) {
  const actions = []
  const events = []
  for (let i = 0; i < limit; i++) {
    if (state.over || until(state)) break
    if (state.awaiting?.player === 'you') break
    if (state.priority !== 'you') { const s = settle(state, scenario); state = s.state; events.push(...s.events); actions.push(...s.actions); if (s.stalled) break; continue }
    const result = act(state, { type: 'pass', player: 'you' }, scenario)
    if (!result.ok) break
    state = result.state
    events.push(...result.events)
    actions.push(...result.actions)
  }
  return { state, events, actions }
}
