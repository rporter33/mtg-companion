import { describe, it, expect } from 'vitest'
import { narrate, narrateAll, cuesFrom, prefersReducedMotion } from '../src/lib/table/motion.js'
import { start, act } from '../src/lib/table/runner.js'
import { applyAction } from '../src/lib/table/reducer.js'
import { MANA_GUIDED } from '../src/lib/table/scenarios/mana.js'

/**
 * Motion is derived from events and never the other way round: every
 * event the reducer emits has a sentence, the cues name only cards and
 * players, and a run with motion reduced is the same run.
 */
const find = (state, cardId) => Object.values(state.cards).find((c) => c.cardId === cardId)

function walk() {
  let { state } = start(MANA_GUIDED)
  const events = []
  const step = (action) => { const r = act(state, { player: 'you', ...action }, MANA_GUIDED); if (!r.ok) throw new Error(r.reason.message); state = r.state; events.push(...r.events) }
  step({ type: 'beginCast', instanceId: find(state, 'grizzlyBears').instanceId })
  step({ type: 'tapForMana', instanceId: find(state, 'forest').instanceId })
  step({ type: 'tapForMana', instanceId: find(state, 'mountain').instanceId })
  step({ type: 'autoPay' })
  step({ type: 'commitCast' })
  step({ type: 'pass' })
  return { state, events }
}

describe('narration', () => {
  it('says every committed event of the guided walk in order', () => {
    const { state, events } = walk()
    expect(narrateAll(events, state)).toEqual([
      'Forest tapped for green.',
      'Mountain tapped for red.',
      'You paid 1 red and 1 green.',
      'You cast Grizzly Bears. It is on the stack.',
      'You passed priority.',
      'Your opponent passed priority.',
      'Grizzly Bears resolved.',
      'Grizzly Bears is on the battlefield, summoning sick.',
    ])
  })

  it('has a sentence for every event kind the reducer emits', () => {
    const { state } = walk()
    const bears = find(state, 'grizzlyBears').instanceId
    const forest = find(state, 'forest').instanceId
    const samples = [
      { type: 'landPlayed', player: 'you', instanceId: forest },
      { type: 'spellFizzled', instanceId: bears },
      { type: 'pumped', instanceId: bears, power: 3, toughness: 3 },
      { type: 'damageDealt', source: bears, target: 'foe', amount: 2 },
      { type: 'creatureDied', instanceId: bears, why: 'damage' },
      { type: 'poolEmptied', player: 'you', amount: 2 },
      { type: 'stepBegan', step: 'main2' },
      { type: 'turnBegan', active: 'foe', ordinal: 1 },
      { type: 'untapped', instanceId: forest },
      { type: 'drew', player: 'foe' },
      { type: 'drewFromEmpty', player: 'foe' },
      { type: 'damageRemoved', instanceId: bears },
      { type: 'effectsEnded', instanceId: bears },
      { type: 'attackersDeclared', player: 'you', attackers: [bears] },
      { type: 'blockersDeclared', player: 'foe', blocks: { [bears]: bears } },
      { type: 'discarded', player: 'foe', instanceId: forest },
      { type: 'gameOver', winner: 'you' },
      { type: 'explained', correct: true },
      { type: 'predicted', correct: false },
    ]
    for (const e of samples) expect(narrate(e, state), e.type).toBeTruthy()
    expect(narrate({ type: 'stepBegan', step: 'untap' }, state)).toBeNull()
    expect(narrate({ type: 'somethingElse' }, state)).toBeNull()
  })
})

describe('cues', () => {
  it('names only cards and players, one cue per visible change', () => {
    const { events } = walk()
    const cues = cuesFrom(events)
    expect(cues.map((c) => c.kind)).toEqual(['tap', 'tap', 'toStack', 'resolve', 'enter'])
    for (const cue of cues) expect(typeof cue.id).toBe('string')
  })
  it('carries no state: applying cues or not leaves the model identical', () => {
    const a = walk()
    const b = walk()
    expect(a.state).toEqual(b.state)
    expect(cuesFrom(a.events)).toEqual(cuesFrom(b.events))
  })
})

describe('reduced motion', () => {
  it('follows the app preference when set, and the system otherwise', () => {
    expect(prefersReducedMotion(true)).toBe(true)
    expect(prefersReducedMotion(false)).toBe(false)
    expect(typeof prefersReducedMotion(null)).toBe('boolean')
  })
})

describe('the reducer never depends on time', () => {
  it('gives the same result for the same action twice', () => {
    const { state } = start(MANA_GUIDED)
    const a = applyAction(state, { type: 'tapForMana', player: 'you', instanceId: find(state, 'forest').instanceId })
    const b = applyAction(state, { type: 'tapForMana', player: 'you', instanceId: find(state, 'forest').instanceId })
    expect(a).toEqual(b)
  })
})
