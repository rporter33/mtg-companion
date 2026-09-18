import { describe, it, expect } from 'vitest'
import { createState, invariants, battlefield, hand, stats, emptyPool, costOf, payFromPool } from '../src/lib/table/model.js'
import { applyAction, shortfallMessage } from '../src/lib/table/reducer.js'
import { start, act, replay, passUntil, settle } from '../src/lib/table/runner.js'
import { evaluate } from '../src/lib/table/objectives.js'
import { MANA_GUIDED, MANA_INDEPENDENT, MANA_WRONG_COLOUR } from '../src/lib/table/scenarios/mana.js'
import { unsupportedReason } from '../src/lib/table/mechanics.js'
import { PRACTICE_CARDS } from '../src/data/practice-cards.js'

/**
 * The acceptance scenarios for the mana lesson, MANA-01 to MANA-12, as
 * behaviour of the model. Every step also checks the invariants, so a
 * reducer bug fails here rather than on screen.
 */

const you = (action) => ({ player: 'you', ...action })
const ok = (result) => { expect(result.ok, result.reason?.message).toBe(true); expect(invariants(result.state)).toEqual([]); return result }
const refused = (result, code) => { expect(result.ok).toBe(false); expect(result.reason.code).toBe(code); return result }
const find = (state, cardId, zone = null) => Object.values(state.cards).find((c) => c.cardId === cardId && (!zone || c.zone === zone))
const ids = (state, cardId, zone = 'battlefield') => Object.values(state.cards).filter((c) => c.cardId === cardId && (!zone || c.zone === zone)).map((c) => c.instanceId)

/** Tap every source given, pay, and commit; returns the final state and every action taken. */
function castWith(state, scenario, cardId, sources, { target = null } = {}) {
  const log = []
  const step = (action) => { const r = ok(act(state, you(action), scenario)); state = r.state; log.push(...r.actions); return r }
  step({ type: 'beginCast', instanceId: find(state, cardId, 'hand').instanceId })
  for (const source of sources) step({ type: 'tapForMana', instanceId: source })
  if (target) step({ type: 'chooseTarget', target })
  step({ type: 'autoPay' })
  const committed = step({ type: 'commitCast' })
  return { state, log, committed }
}

describe('the mana lesson, fixture A (guided)', () => {
  const scenario = MANA_GUIDED

  it('starts where the fixture says: turn 1, main phase, two untapped lands, Bears in hand, empty stack and pool', () => {
    const { state } = start(scenario)
    expect(invariants(state)).toEqual([])
    expect(state).toMatchObject({ turn: 1, active: 'you', step: 'main1', priority: 'you', stack: [] })
    expect(battlefield(state, 'you').map((c) => c.cardId)).toEqual(['forest', 'mountain'])
    expect(battlefield(state, 'you').every((c) => !c.tapped)).toBe(true)
    expect(hand(state, 'you').map((c) => c.cardId)).toEqual(['grizzlyBears'])
    expect(state.pool.you).toEqual(emptyPool())
    // Two Forests in two runs are two distinct objects with stable ids.
    expect(ids(start(scenario).state, 'forest', null)).toEqual(ids(state, 'forest', null))
  })

  it('MANA-01: looking at a card, or starting and cancelling a cast, changes no zone, mana, tap, turn or progress', () => {
    const { state } = start(scenario)
    const bears = find(state, 'grizzlyBears').instanceId
    const begun = ok(applyAction(state, you({ type: 'beginCast', instanceId: bears })))
    expect(begun.events).toEqual([])
    expect(begun.state.casting).toMatchObject({ instanceId: bears, assigned: [], targets: [] })
    const cancelled = ok(applyAction(begun.state, you({ type: 'cancelCast' })))
    expect(cancelled.events).toEqual([])
    const strip = (s) => ({ ...s, casting: null, seq: 0, events: [] })
    expect(strip(cancelled.state)).toEqual(strip(state))
    expect(evaluate(scenario, cancelled.state, []).complete).toBe(false)
  })

  it('MANA-02: a legal payment spends the mana once and puts the spell on the stack, not the battlefield', () => {
    const { state } = start(scenario)
    const [forest, mountain] = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    const { state: after, committed } = castWith(state, scenario, 'grizzlyBears', [forest, mountain])
    expect(after.stack.map((s) => s.instanceId)).toEqual([find(after, 'grizzlyBears').instanceId])
    expect(find(after, 'grizzlyBears').zone).toBe('stack')
    expect(battlefield(after, 'you').map((c) => c.cardId)).toEqual(['forest', 'mountain'])
    expect(after.pool.you).toEqual(emptyPool())
    expect(after.cards[forest].tapped && after.cards[mountain].tapped).toBe(true)
    expect(committed.events.map((e) => e.type)).toEqual(expect.arrayContaining(['manaSpent', 'spellCast']))
    expect(committed.events.find((e) => e.type === 'manaSpent').spent).toEqual({ ...emptyPool(), G: 1, R: 1 })
    // Priority came back to the caster (117.3c), and the opponent has not acted.
    expect(after.priority).toBe('you')
  })

  it('MANA-03: red mana on the {G} is refused with the reason, and the table is untouched and recoverable', () => {
    const { state } = start(scenario)
    const [forest, mountain] = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    let s = ok(applyAction(state, you({ type: 'beginCast', instanceId: find(state, 'grizzlyBears').instanceId }))).state
    s = ok(applyAction(s, you({ type: 'tapForMana', instanceId: mountain }))).state
    const wrong = refused(applyAction(s, you({ type: 'assign', part: 1, from: 'R' })), 'wrongColour')
    expect(wrong.reason.message).toMatch(/only be paid with green mana/)
    // Nothing committed: the pool still holds the red, the Forest is untapped, and the right assignment works.
    expect(s.pool.you.R).toBe(1)
    s = ok(applyAction(s, you({ type: 'assign', part: 0, from: 'R' }))).state // the {1}
    s = ok(applyAction(s, you({ type: 'tapForMana', instanceId: forest }))).state
    s = ok(applyAction(s, you({ type: 'assign', part: 1, from: 'G' }))).state
    const done = ok(applyAction(s, you({ type: 'commitCast' })))
    expect(done.state.stack).toHaveLength(1)
    // Committing with the {G} unpaid is refused too.
    let t = ok(applyAction(state, you({ type: 'beginCast', instanceId: find(state, 'grizzlyBears').instanceId }))).state
    t = ok(applyAction(t, you({ type: 'tapForMana', instanceId: mountain }))).state
    t = ok(applyAction(t, you({ type: 'assign', part: 0, from: 'R' }))).state
    refused(applyAction(t, you({ type: 'commitCast' })), 'costUnpaid')
  })

  it('MANA-04: a tapped source makes no second mana', () => {
    const { state } = start(scenario)
    const forest = find(state, 'forest').instanceId
    const once = ok(applyAction(state, you({ type: 'tapForMana', instanceId: forest })))
    expect(once.state.pool.you.G).toBe(1)
    const twice = refused(applyAction(once.state, you({ type: 'tapForMana', instanceId: forest })), 'alreadyTapped')
    expect(twice.reason.message).toMatch(/already tapped/)
    expect(once.state.pool.you.G).toBe(1)
  })

  it('MANA-05: a second commit does nothing: one cast, one payment', () => {
    const { state } = start(scenario)
    const sources = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    const { state: after } = castWith(state, scenario, 'grizzlyBears', sources)
    refused(applyAction(after, you({ type: 'commitCast' })), 'notCasting')
    expect(after.stack).toHaveLength(1)
    expect(after.pool.you).toEqual(emptyPool())
  })

  it('MANA-06: after both players pass the creature resolves once, summoning sick, and the lands stay tapped', () => {
    const { state } = start(scenario)
    const sources = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    const { state: cast } = castWith(state, scenario, 'grizzlyBears', sources)
    const passed = ok(act(cast, you({ type: 'pass' }), scenario))
    const types = passed.events.map((e) => e.type)
    expect(types).toEqual(['passed', 'passed', 'spellResolved', 'permanentEntered'])
    const bears = find(passed.state, 'grizzlyBears')
    expect(bears.zone).toBe('battlefield')
    expect(bears.sick).toBe(true)
    expect(bears.tapped).toBe(false)
    expect(passed.state.stack).toEqual([])
    expect(sources.every((id) => passed.state.cards[id].tapped)).toBe(true)
    expect(passed.state.priority).toBe('you')
    expect(passed.state.step).toBe('main1')
    expect(evaluate(scenario, passed.state, passed.events).goals[0].done).toBe(true)
  })

  it('MANA-07: the generic part accepts green as readily as red; both orders of tapping are accepted', () => {
    const { state } = start(scenario)
    const [forest, mountain] = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    const a = castWith(state, scenario, 'grizzlyBears', [mountain, forest])
    expect(a.state.stack).toHaveLength(1)
    // Two Forests would pay it too: green on the {1} is legal.
    const twoForests = createState({ ...scenario, setup: { ...scenario.setup, you: { ...scenario.setup.you, battlefield: ['forest', 'forest'] } } })
    const fs = ids(twoForests, 'forest')
    const b = castWith(twoForests, scenario, 'grizzlyBears', fs)
    expect(b.committed.events.find((e) => e.type === 'manaSpent').spent).toEqual({ ...emptyPool(), G: 2 })
  })

  it('MANA-08 and MANA-09: the action log replays to the same state, and replaying never repeats a payment', () => {
    const { state } = start(scenario)
    const sources = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    const { state: cast, log } = castWith(state, scenario, 'grizzlyBears', sources)
    const passed = ok(act(cast, you({ type: 'pass' }), scenario))
    const full = [...log, ...passed.actions]
    const rebuilt = replay(scenario, full)
    expect(rebuilt.applied).toBe(full.length)
    expect(rebuilt.state).toEqual(passed.state)
    // A checkpoint taken after the commit rebuilds the same pool and hand, with nothing paid twice.
    const checkpoint = replay(scenario, log)
    expect(checkpoint.state.pool.you).toEqual(emptyPool())
    expect(hand(checkpoint.state, 'you')).toEqual([])
    expect(checkpoint.state.stack).toHaveLength(1)
    // Reset is the setup again.
    expect(createState(scenario)).toEqual(createState(scenario))
  })

  it('MANA-10: the model has no motion; two identical runs give identical events, so a screen that skips animation loses nothing', () => {
    const run = () => {
      const { state } = start(scenario)
      const sources = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
      const { state: cast, log } = castWith(state, scenario, 'grizzlyBears', sources)
      return { ...ok(act(cast, you({ type: 'pass' }), scenario)), log }
    }
    const a = run()
    const b = run()
    expect(a.events).toEqual(b.events)
    expect(a.state).toEqual(b.state)
  })

  it('MANA-11: unspent mana empties when the step ends, with an event that says so', () => {
    const { state } = start(scenario)
    const [forest, mountain] = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    let s = ok(applyAction(state, you({ type: 'tapForMana', instanceId: forest }))).state
    s = ok(applyAction(s, you({ type: 'tapForMana', instanceId: mountain }))).state
    expect(s.pool.you).toEqual({ ...emptyPool(), G: 1, R: 1 })
    const moved = passUntil(s, scenario, (st) => st.step !== 'main1')
    expect(moved.state.step).toBe('beginCombat')
    expect(moved.state.pool.you).toEqual(emptyPool())
    expect(moved.events.find((e) => e.type === 'poolEmptied')).toMatchObject({ player: 'you', amount: 2 })
    expect(moved.state.cards[forest].tapped).toBe(true)
  })

  it('MANA-12: the paper prompt is data the screen records as self-report; it is not one of the goals', () => {
    expect(scenario.paper.needs.length).toBeGreaterThan(0)
    expect(scenario.paper.steps.length).toBeGreaterThan(0)
    expect(scenario.goals.map((g) => g.id)).not.toContain('paper')
  })

  it('the explanation question completes the lesson only when answered correctly', () => {
    const { state } = start(scenario)
    const sources = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    const { state: cast } = castWith(state, scenario, 'grizzlyBears', sources)
    const passed = ok(act(cast, you({ type: 'pass' }), scenario))
    const wrong = [...passed.events, { type: 'explained', questionId: 'what-untaps', correct: false }]
    expect(evaluate(scenario, passed.state, wrong).complete).toBe(false)
    const right = [...passed.events, { type: 'explained', questionId: 'what-untaps', correct: true }]
    expect(evaluate(scenario, passed.state, right).complete).toBe(true)
  })

  it('the guided coach has exactly one thing to say at every point of the walk', () => {
    const says = (state) => scenario.coach.steps.filter((st) => st.when(state)).map((st) => st.id)
    let { state } = start(scenario)
    expect(says(state)).toEqual(['begin'])
    const [forest, mountain] = ['forest', 'mountain'].map((c) => find(state, c).instanceId)
    state = ok(applyAction(state, you({ type: 'beginCast', instanceId: find(state, 'grizzlyBears').instanceId }))).state
    expect(says(state)).toEqual(['green'])
    state = ok(applyAction(state, you({ type: 'tapForMana', instanceId: forest }))).state
    expect(says(state)).toEqual(['generic'])
    state = ok(applyAction(state, you({ type: 'tapForMana', instanceId: mountain }))).state
    expect(says(state)).toEqual(['assign'])
    state = ok(applyAction(state, you({ type: 'autoPay' }))).state
    expect(says(state)).toEqual(['commit'])
    state = ok(applyAction(state, you({ type: 'commitCast' }))).state
    expect(says(state)).toEqual(['stack'])
    state = ok(act(state, you({ type: 'pass' }), scenario)).state
    expect(says(state)).toEqual(['done'])
  })
})

describe('the mana lesson, fixture B (independent)', () => {
  it('accepts any legal payment for Centaur Courser: Mountains or Elves for the {2}, the Forest for the {G}', () => {
    const { state } = start(MANA_INDEPENDENT)
    const forest = find(state, 'forest').instanceId
    const [m1, m2] = ids(state, 'mountain').filter((id) => state.cards[id].controller === 'you')
    const elves = find(state, 'llanowarElves').instanceId
    for (const sources of [[forest, m1, m2], [forest, m1, elves], [m2, elves, forest]]) {
      const { state: cast } = castWith(state, MANA_INDEPENDENT, 'centaurCourser', sources)
      const passed = ok(act(cast, you({ type: 'pass' }), MANA_INDEPENDENT))
      expect(evaluate(MANA_INDEPENDENT, passed.state, passed.events).goals[0].done).toBe(true)
      expect(stats(find(passed.state, 'centaurCourser'))).toMatchObject({ power: 3, toughness: 3 })
    }
  })

  it('refuses the Forest on the {2} once it is the only green left, and says why', () => {
    const { state } = start(MANA_INDEPENDENT)
    const forest = find(state, 'forest').instanceId
    const [m1] = ids(state, 'mountain').filter((id) => state.cards[id].controller === 'you')
    let s = ok(applyAction(state, you({ type: 'beginCast', instanceId: find(state, 'centaurCourser').instanceId }))).state
    s = ok(applyAction(s, you({ type: 'tapForMana', instanceId: forest }))).state
    s = ok(applyAction(s, you({ type: 'tapForMana', instanceId: m1 }))).state
    // Green on the {2} is legal in itself...
    s = ok(applyAction(s, you({ type: 'assign', part: 0, from: 'G' }))).state
    s = ok(applyAction(s, you({ type: 'assign', part: 0, from: 'R' }))).state
    // ...but then nothing pays the {G}.
    refused(applyAction(s, you({ type: 'assign', part: 1, from: 'G' })), 'notEnoughMana')
    refused(applyAction(s, you({ type: 'commitCast' })), 'costUnpaid')
    // Undo the green from the {2}, tap the Elves, and it works.
    s = ok(applyAction(s, you({ type: 'unassign', part: 0 }))).state
    s = ok(applyAction(s, you({ type: 'tapForMana', instanceId: find(s, 'llanowarElves').instanceId }))).state
    s = ok(applyAction(s, you({ type: 'autoPay' }))).state
    ok(applyAction(s, you({ type: 'commitCast' })))
  })
})

describe('the mana lesson, wrong colour', () => {
  it('four Forests cannot cast Hill Giant, and the reason names the colour, not the count', () => {
    const { state } = start(MANA_WRONG_COLOUR)
    const forests = ids(state, 'forest').filter((id) => state.cards[id].controller === 'you')
    let s = ok(applyAction(state, you({ type: 'beginCast', instanceId: find(state, 'hillGiant').instanceId }))).state
    for (const f of forests) s = ok(applyAction(s, you({ type: 'tapForMana', instanceId: f }))).state
    expect(s.pool.you.G).toBe(4)
    const short = refused(applyAction(s, you({ type: 'autoPay' })), 'notEnoughMana')
    expect(short.reason.message).toMatch(/short of red mana/)
    refused(applyAction(s, you({ type: 'assign', part: 1, from: 'G' })), 'wrongColour')
    // Cancel keeps the mana made: it was made legally and empties with the step.
    s = ok(applyAction(s, you({ type: 'cancelCast' }))).state
    expect(s.pool.you.G).toBe(4)
    // Bears can be paid from what is in the pool already.
    s = ok(applyAction(s, you({ type: 'beginCast', instanceId: find(s, 'grizzlyBears').instanceId }))).state
    s = ok(applyAction(s, you({ type: 'autoPay' }))).state
    s = ok(applyAction(s, you({ type: 'commitCast' }))).state
    expect(s.pool.you.G).toBe(2)
  })

  it('shortfall messages tell a colour problem from a count problem', () => {
    const giant = costOf(PRACTICE_CARDS.hillGiant)
    expect(shortfallMessage(giant, { ...emptyPool(), G: 4 })).toMatch(/short of red/)
    expect(shortfallMessage(giant, { ...emptyPool(), R: 1, G: 1 })).toMatch(/2 mana short/)
    expect(payFromPool(giant, { ...emptyPool(), R: 1, G: 3 })).toHaveLength(4)
  })
})

describe('timing and turn structure', () => {
  const scenario = MANA_GUIDED

  it('a second land in one turn is refused; a land outside a main phase is refused', () => {
    const withLands = createState({ ...scenario, setup: { ...scenario.setup, you: { ...scenario.setup.you, hand: ['forest', 'forest'] } } })
    const [a, b] = ids(withLands, 'forest', 'hand')
    const one = ok(applyAction(withLands, you({ type: 'playLand', instanceId: a })))
    expect(one.events[0]).toMatchObject({ type: 'landPlayed', instanceId: a })
    refused(applyAction(one.state, you({ type: 'playLand', instanceId: b })), 'landAlready')
    const inCombat = { ...withLands, step: 'beginCombat' }
    refused(applyAction(inCombat, you({ type: 'playLand', instanceId: a })), 'notMainPhase')
  })

  it('a creature cannot be cast on the opponent\'s turn, but an instant can', () => {
    const theirs = createState({
      ...scenario,
      setup: { ...scenario.setup, active: 'foe', priority: 'you', step: 'main1', you: { ...scenario.setup.you, hand: ['grizzlyBears', 'giantGrowth'], battlefield: ['forest', 'mountain', 'grizzlyBears'] } },
    })
    const bears = find(theirs, 'grizzlyBears', 'hand').instanceId
    const growth = find(theirs, 'giantGrowth').instanceId
    refused(applyAction(theirs, you({ type: 'beginCast', instanceId: bears })), 'notYourTurn')
    ok(applyAction(theirs, you({ type: 'beginCast', instanceId: growth })))
  })

  it('a sorcery needs an empty stack; an instant does not', () => {
    const s0 = createState({ ...scenario, setup: { ...scenario.setup, you: { battlefield: ['mountain', 'mountain', 'mountain', 'mountain', 'grizzlyBears'], hand: ['volcanicHammer', 'lightningStrike', 'goblinPiker'], library: [] } } })
    const [m1, m2] = ids(s0, 'mountain').filter((id) => s0.cards[id].controller === 'you')
    const { state: s1 } = castWith(s0, scenario, 'goblinPiker', [m1, m2])
    expect(s1.stack).toHaveLength(1)
    refused(applyAction(s1, you({ type: 'beginCast', instanceId: find(s1, 'volcanicHammer').instanceId })), 'stackNotEmpty')
    ok(applyAction(s1, you({ type: 'beginCast', instanceId: find(s1, 'lightningStrike').instanceId })))
  })

  it('a summoning-sick Elves cannot tap for mana until its controller\'s next untap step', () => {
    const s0 = createState({ ...scenario, setup: { ...scenario.setup, you: { battlefield: [{ cardId: 'llanowarElves', sick: true }, 'forest'], hand: [], library: ['forest'] }, foe: { library: ['mountain'] } } })
    const elves = find(s0, 'llanowarElves').instanceId
    refused(applyAction(s0, you({ type: 'tapForMana', instanceId: elves })), 'summoningSick')
    // Through the opponent's turn and into ours: untap step clears it.
    const next = passUntil(s0, scenario, (st) => st.active === 'you' && st.turn > s0.turn)
    expect(next.state.turn).toBe(3)
    expect(next.state.cards[elves].sick).toBe(false)
    ok(applyAction(next.state, you({ type: 'tapForMana', instanceId: elves })))
  })

  it('the first player skips the first draw and draws thereafter; the opponent draws on their first turn', () => {
    const { state } = start(scenario)
    expect(hand(state, 'you')).toHaveLength(1)
    const theirTurn = passUntil(state, scenario, (st) => st.active === 'foe' && st.step === 'main1')
    expect(hand(theirTurn.state, 'foe')).toHaveLength(1)
    expect(theirTurn.events.some((e) => e.type === 'drew' && e.player === 'foe')).toBe(true)
    const ourNext = passUntil(theirTurn.state, scenario, (st) => st.active === 'you' && st.turn > 1 && st.step === 'main1')
    expect(hand(ourNext.state, 'you')).toHaveLength(2)
    expect(ourNext.state.turnsBy).toEqual({ you: 2, foe: 1 })
  })

  it('drawing from an empty library loses the game', () => {
    const s0 = createState({ ...scenario, setup: { ...scenario.setup, you: { battlefield: [], hand: [], library: [] }, foe: { library: [] } } })
    const gone = passUntil(s0, scenario, (st) => Boolean(st.over))
    expect(gone.state.over).toMatchObject({ winner: 'you', losers: ['foe'], reason: 'drewFromEmpty' })
  })

  it('a spell whose target has gone does not resolve', () => {
    const s0 = createState({ ...scenario, setup: { ...scenario.setup, you: { battlefield: ['mountain', 'mountain', 'mountain', 'goblinPiker'], hand: ['shock', 'lightningStrike'], library: ['forest'] }, foe: { library: ['mountain'] } } })
    const piker = find(s0, 'goblinPiker').instanceId
    const [m1, m2, m3] = ids(s0, 'mountain').filter((id) => s0.cards[id].controller === 'you')
    // Shock the Piker, then in response Strike it: the Strike resolves first and kills it; the Shock fizzles.
    const { state: s1 } = castWith(s0, scenario, 'shock', [m1], { target: { kind: 'creature', id: piker } })
    const { state: s2 } = castWith(s1, scenario, 'lightningStrike', [m2, m3], { target: { kind: 'creature', id: piker } })
    expect(s2.stack).toHaveLength(2)
    const resolvedOne = ok(act(s2, you({ type: 'pass' }), scenario))
    expect(resolvedOne.events.map((e) => e.type)).toContain('creatureDied')
    expect(resolvedOne.state.stack).toHaveLength(1)
    const resolvedTwo = ok(act(resolvedOne.state, you({ type: 'pass' }), scenario))
    expect(resolvedTwo.events.map((e) => e.type)).toContain('spellFizzled')
    expect(find(resolvedTwo.state, 'shock').zone).toBe('graveyard')
  })

  it('damage to a player and lethal life are state-based, and a game over refuses further actions', () => {
    const s0 = createState({ ...scenario, setup: { ...scenario.setup, life: { you: 20, foe: 2 }, you: { battlefield: ['mountain'], hand: ['shock'], library: ['forest'] }, foe: { library: ['mountain'] } } })
    const m = find(s0, 'mountain').instanceId
    const { state: s1 } = castWith(s0, scenario, 'shock', [m], { target: { kind: 'player', id: 'foe' } })
    const done = ok(act(s1, you({ type: 'pass' }), scenario))
    expect(done.state.life.foe).toBe(0)
    expect(done.state.over).toMatchObject({ winner: 'you', reason: 'life' })
    refused(applyAction(done.state, you({ type: 'pass' })), 'gameOver')
  })
})

describe('the supported-mechanics registry', () => {
  it('every practice card is inside it', () => {
    for (const card of Object.values(PRACTICE_CARDS)) expect(unsupportedReason(card), card.name).toBeNull()
  })
  it('refuses what it does not model, by name', () => {
    expect(unsupportedReason({ name: 'X', rules: { kind: 'creature', keywords: ['flying'] } })).toMatch(/flying/)
    expect(unsupportedReason({ name: 'X', rules: { kind: 'enchantment' } })).toMatch(/enchantment/)
    expect(unsupportedReason({ name: 'X', rules: { kind: 'instant', effect: { kind: 'counter', target: 'spell' } } })).toMatch(/effect/)
    expect(unsupportedReason({ name: 'X', rules: { kind: 'creature', trigger: {} } })).toMatch(/trigger/)
    expect(unsupportedReason({ name: 'X' })).toMatch(/no rules block/)
    expect(() => createState({ id: 'x', setup: { you: { hand: ['nothing'] } } })).toThrow(/No practice card/)
  })
  it('the passive opponent never stalls a scenario', () => {
    const { state } = start(MANA_GUIDED)
    const s = settle({ ...state, priority: 'foe' }, MANA_GUIDED)
    expect(s.stalled).toBeUndefined()
    expect(s.state.priority).toBe('you')
  })
})
