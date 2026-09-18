import { describe, it, expect } from 'vitest'
import { createState, invariants, battlefield, stats, hand } from '../src/lib/table/model.js'
import { applyAction } from '../src/lib/table/reducer.js'
import { start, act, passUntil } from '../src/lib/table/runner.js'
import { evaluate } from '../src/lib/table/objectives.js'
import { COMBAT_TRADE, COMBAT_SURVIVE, COMBAT_UNBLOCKED, COMBAT_READINESS } from '../src/lib/table/scenarios/combat.js'
import { RESPONSE_GUIDED, RESPONSE_CHOICE } from '../src/lib/table/scenarios/responses.js'
import { SCENARIOS, LESSONS } from '../src/lib/table/scenarios/index.js'
import { policyFor } from '../src/lib/table/opponent.js'

/**
 * Combat and responses on the shared model: attackers tap, blockers do
 * not, damage is simultaneous and marked apart from toughness, lethal
 * damage is a state-based action, cleanup removes damage and ends
 * until-end-of-turn effects, and the stack resolves one object at a time
 * with priority going round between them.
 */
const you = (action) => ({ player: 'you', ...action })
const ok = (result) => { expect(result.ok, result.reason?.message).toBe(true); expect(invariants(result.state)).toEqual([]); return result }
const refused = (result, code) => { expect(result.ok).toBe(false); expect(result.reason.code).toBe(code); return result }
const find = (state, cardId, player = 'you', zone = 'battlefield') => Object.values(state.cards).find((c) => c.cardId === cardId && c.owner === player && (!zone || c.zone === zone))
const toStep = (state, scenario, step) => passUntil(state, scenario, (s) => s.step === step || Boolean(s.awaiting))

describe('attacking into a blocker (combat-trade)', () => {
  const scenario = COMBAT_TRADE

  it('reaches declare attackers and waits on the learner; a sick or tapped creature cannot be chosen', () => {
    const { state } = start(scenario)
    const moved = toStep(state, scenario, 'declareAttackers')
    expect(moved.state.step).toBe('declareAttackers')
    expect(moved.state.awaiting).toEqual({ kind: 'attackers', player: 'you' })
    // Passing is refused while a declaration is owed.
    refused(applyAction(moved.state, you({ type: 'pass' })), 'awaiting')
    const bears = find(moved.state, 'grizzlyBears').instanceId
    const sickState = { ...moved.state, cards: { ...moved.state.cards, [bears]: { ...moved.state.cards[bears], sick: true } } }
    refused(applyAction(sickState, you({ type: 'declareAttackers', attackers: [bears] })), 'summoningSick')
    const tappedState = { ...moved.state, cards: { ...moved.state.cards, [bears]: { ...moved.state.cards[bears], tapped: true } } }
    refused(applyAction(tappedState, you({ type: 'declareAttackers', attackers: [bears] })), 'tapped')
    // Their creature is not ours to declare.
    refused(applyAction(moved.state, you({ type: 'declareAttackers', attackers: [find(moved.state, 'goblinPiker', 'foe').instanceId] })), 'notYours')
  })

  it('attacking taps, blocking does not, damage is simultaneous, and both die of lethal damage', () => {
    const { state } = start(scenario)
    const moved = toStep(state, scenario, 'declareAttackers')
    const bears = find(moved.state, 'grizzlyBears').instanceId
    const piker = find(moved.state, 'goblinPiker', 'foe').instanceId
    const declared = ok(act(moved.state, you({ type: 'declareAttackers', attackers: [bears] }), scenario))
    expect(declared.state.cards[bears]).toMatchObject({ tapped: true, attacking: 'player' })
    expect(declared.state.priority).toBe('you')
    expect(declared.state.step).toBe('declareAttackers')
    // Pass out of declare attackers: the blocker policy blocks, and priority comes back in declare blockers.
    const blocked = ok(act(declared.state, you({ type: 'pass' }), scenario))
    expect(blocked.state.step).toBe('declareBlockers')
    expect(blocked.state.blocks).toEqual({ [piker]: bears })
    expect(blocked.state.cards[piker].tapped).toBe(false)
    expect(blocked.state.cards[piker].blocking).toBe(bears)
    expect(blocked.state.cards[bears].attacking).toBe('blocked')
    expect(blocked.state.priority).toBe('you')
    // Pass again: damage, then state-based actions, then priority in the damage step.
    const damaged = ok(act(blocked.state, you({ type: 'pass' }), scenario))
    const types = damaged.events.map((e) => e.type)
    expect(types.filter((t) => t === 'damageDealt')).toHaveLength(2)
    expect(types.filter((t) => t === 'creatureDied')).toHaveLength(2)
    expect(damaged.state.cards[bears].zone).toBe('graveyard')
    expect(damaged.state.cards[piker].zone).toBe('graveyard')
    expect(damaged.state.life).toEqual({ you: 20, foe: 20 })
    expect(damaged.state.step).toBe('combatDamage')
    expect(evaluate(scenario, damaged.state, [...damaged.events, { type: 'predicted', questionId: 'bears-into-piker', correct: true }]).complete).toBe(true)
  })

  it('a blocked attacker whose blocker has died deals no damage to the player', () => {
    // Shock the blocker after blocks: the attacker stays blocked and hits nothing (509.1h, 510.1c).
    const s0 = createState({ ...scenario, setup: { ...scenario.setup, you: { ...scenario.setup.you, battlefield: ['mountain', 'grizzlyBears'], hand: ['shock'] } } })
    const moved = toStep(s0, scenario, 'declareAttackers')
    const bears = find(moved.state, 'grizzlyBears').instanceId
    const piker = find(moved.state, 'goblinPiker', 'foe').instanceId
    let s = ok(act(moved.state, you({ type: 'declareAttackers', attackers: [bears] }), scenario)).state
    s = ok(act(s, you({ type: 'pass' }), scenario)).state
    expect(s.blocks[piker]).toBe(bears)
    s = ok(act(s, you({ type: 'beginCast', instanceId: find(s, 'shock', 'you', 'hand').instanceId }), scenario)).state
    s = ok(act(s, you({ type: 'tapForMana', instanceId: find(s, 'mountain').instanceId }), scenario)).state
    s = ok(act(s, you({ type: 'chooseTarget', target: { kind: 'creature', id: piker } }), scenario)).state
    s = ok(act(s, you({ type: 'autoPay' }), scenario)).state
    s = ok(act(s, you({ type: 'commitCast' }), scenario)).state
    const resolved = ok(act(s, you({ type: 'pass' }), scenario))
    expect(resolved.state.cards[piker].zone).toBe('graveyard')
    const damage = ok(act(resolved.state, you({ type: 'pass' }), scenario))
    expect(damage.state.step).toBe('combatDamage')
    expect(damage.state.life.foe).toBe(20)
    expect(damage.state.cards[bears].zone).toBe('battlefield')
  })

  it('leaves combat with attackers and blocks cleared, then cleanup removes damage', () => {
    const { state } = start(COMBAT_SURVIVE)
    const moved = toStep(state, COMBAT_SURVIVE, 'declareAttackers')
    const courser = find(moved.state, 'centaurCourser').instanceId
    let s = ok(act(moved.state, you({ type: 'declareAttackers', attackers: [courser] }), COMBAT_SURVIVE)).state
    s = ok(act(s, you({ type: 'pass' }), COMBAT_SURVIVE)).state // blocks declared
    s = ok(act(s, you({ type: 'pass' }), COMBAT_SURVIVE)).state // damage
    expect(s.cards[courser]).toMatchObject({ damage: 2, zone: 'battlefield' })
    expect(stats(s.cards[courser])).toMatchObject({ power: 3, toughness: 3, damage: 2 })
    expect(find(s, 'goblinPiker', 'foe', null).zone).toBe('graveyard')
    const main2 = passUntil(s, COMBAT_SURVIVE, (st) => st.step === 'main2')
    expect(main2.state.attackers).toEqual([])
    expect(main2.state.cards[courser].attacking).toBeNull()
    expect(main2.state.cards[courser].damage).toBe(2)
    const theirs = passUntil(main2.state, COMBAT_SURVIVE, (st) => st.active === 'foe' && st.step === 'main1')
    expect(theirs.state.cards[courser].damage).toBe(0)
    expect(theirs.events.some((e) => e.type === 'damageRemoved' && e.instanceId === courser)).toBe(true)
    // The attacker untaps only in our own untap step, not theirs.
    expect(theirs.state.cards[courser].tapped).toBe(true)
  })
})

describe('an unblocked attack and readiness', () => {
  it('deals its power to the defending player when nothing blocks', () => {
    const { state } = start(COMBAT_UNBLOCKED)
    const moved = toStep(state, COMBAT_UNBLOCKED, 'declareAttackers')
    const courser = find(moved.state, 'centaurCourser').instanceId
    let s = ok(act(moved.state, you({ type: 'declareAttackers', attackers: [courser] }), COMBAT_UNBLOCKED)).state
    s = ok(act(s, you({ type: 'pass' }), COMBAT_UNBLOCKED)).state
    expect(s.step).toBe('declareBlockers')
    expect(s.blocks).toEqual({})
    s = ok(act(s, you({ type: 'pass' }), COMBAT_UNBLOCKED)).state
    expect(s.life.foe).toBe(17)
    expect(find(s, 'goblinPiker', 'foe').damage).toBe(0)
  })

  it('haste attacks the turn it arrives; summoning sickness does not, and says so', () => {
    const { state } = start(COMBAT_READINESS)
    const moved = toStep(state, COMBAT_READINESS, 'declareAttackers')
    const goblin = find(moved.state, 'ragingGoblin').instanceId
    const bears = find(moved.state, 'grizzlyBears').instanceId
    const wrong = refused(applyAction(moved.state, you({ type: 'declareAttackers', attackers: [goblin, bears] })), 'summoningSick')
    expect(wrong.reason.message).toMatch(/Grizzly Bears is summoning sick/)
    let s = ok(act(moved.state, you({ type: 'declareAttackers', attackers: [goblin] }), COMBAT_READINESS)).state
    s = passUntil(s, COMBAT_READINESS, (st) => st.step === 'main2').state
    expect(s.life.foe).toBe(19)
  })

  it('with no creature able to attack, the declare blockers and damage steps are skipped', () => {
    const s0 = createState({ ...COMBAT_UNBLOCKED, setup: { ...COMBAT_UNBLOCKED.setup, you: { battlefield: ['forest'], hand: [], library: ['forest'] } } })
    const moved = passUntil(s0, COMBAT_UNBLOCKED, (st) => st.step === 'main2')
    const steps = moved.events.filter((e) => e.type === 'stepBegan').map((e) => e.step)
    expect(steps).toEqual(['beginCombat', 'declareAttackers', 'endCombat', 'main2'])
  })

  it('declaring no attackers is legal and moves on', () => {
    const { state } = start(COMBAT_TRADE)
    const moved = toStep(state, COMBAT_TRADE, 'declareAttackers')
    const s = ok(act(moved.state, you({ type: 'declareAttackers', attackers: [] }), COMBAT_TRADE)).state
    expect(s.awaiting).toBeNull()
    const on = passUntil(s, COMBAT_TRADE, (st) => st.step === 'main2')
    expect(on.state.step).toBe('main2')
    expect(on.state.life).toEqual({ you: 20, foe: 20 })
  })
})

describe('responding to a Shock', () => {
  it('starts with their Shock on the stack and priority with the learner', () => {
    const { state, events } = start(RESPONSE_GUIDED)
    expect(state.active).toBe('foe')
    expect(state.stack).toHaveLength(1)
    expect(state.cards[state.stack[0].instanceId].cardId).toBe('shock')
    expect(state.stack[0].targets[0]).toEqual({ kind: 'creature', id: find(state, 'grizzlyBears').instanceId })
    expect(state.priority).toBe('you')
    expect(events.map((e) => e.type)).toContain('spellCast')
    expect(find(state, 'mountain', 'foe').tapped).toBe(true)
  })

  it('branch one: pass, and the Bears dies', () => {
    const { state } = start(RESPONSE_CHOICE)
    const passed = ok(act(state, you({ type: 'pass' }), RESPONSE_CHOICE))
    // Their pass after casting already counts: one pass from the learner makes two in succession (117.4).
    // ...and after resolution the active player (them) gets priority and passes it back.
    expect(passed.events.map((e) => e.type)).toEqual(['passed', 'damageDealt', 'spellResolved', 'creatureDied', 'passed'])
    expect(find(passed.state, 'grizzlyBears', 'you', null).zone).toBe('graveyard')
    expect(passed.state.stack).toEqual([])
    expect(evaluate(RESPONSE_CHOICE, passed.state, passed.events).goals.find((g) => g.id === 'stack-empty').done).toBe(true)
  })

  it('branch two: respond, and the Growth resolves first, then the Shock, and the Bears lives', () => {
    const { state } = start(RESPONSE_GUIDED)
    const bears = find(state, 'grizzlyBears').instanceId
    let s = ok(act(state, you({ type: 'beginCast', instanceId: find(state, 'giantGrowth', 'you', 'hand').instanceId }), RESPONSE_GUIDED)).state
    // Growth is an instant: allowed on their turn with a spell already on the stack.
    s = ok(act(s, you({ type: 'chooseTarget', target: { kind: 'creature', id: bears } }), RESPONSE_GUIDED)).state
    s = ok(act(s, you({ type: 'tapForMana', instanceId: find(s, 'forest').instanceId }), RESPONSE_GUIDED)).state
    s = ok(act(s, you({ type: 'autoPay' }), RESPONSE_GUIDED)).state
    const cast = ok(act(s, you({ type: 'commitCast' }), RESPONSE_GUIDED))
    expect(cast.state.stack.map((i) => cast.state.cards[i.instanceId].cardId)).toEqual(['shock', 'giantGrowth'])
    expect(cast.state.priority).toBe('you')
    expect(cast.state.passes).toBe(0) // a cast resets consecutive passes
    // One round of passes resolves only the top object.
    const first = ok(act(cast.state, you({ type: 'pass' }), RESPONSE_GUIDED))
    expect(first.events.map((e) => e.type)).toEqual(['passed', 'passed', 'pumped', 'spellResolved', 'passed'])
    expect(first.state.stack).toHaveLength(1)
    expect(stats(first.state.cards[bears])).toMatchObject({ power: 5, toughness: 5 })
    // Priority went to the active player (them) after resolution; they passed; it is with us again.
    expect(first.state.priority).toBe('you')
    const second = ok(act(first.state, you({ type: 'pass' }), RESPONSE_GUIDED))
    expect(second.events.map((e) => e.type)).toEqual(['passed', 'damageDealt', 'spellResolved', 'passed'])
    expect(second.state.cards[bears]).toMatchObject({ zone: 'battlefield', damage: 2 })
    expect(evaluate(RESPONSE_GUIDED, second.state, [
      ...second.events,
      { type: 'predicted', questionId: 'if-you-pass', correct: true },
      { type: 'predicted', questionId: 'if-you-respond', correct: true },
    ]).complete).toBe(true)
    // Cleanup ends the pump and removes the damage together.
    const ours = passUntil(second.state, RESPONSE_GUIDED, (st) => st.active === 'you' && st.step === 'main1')
    expect(stats(ours.state.cards[bears])).toMatchObject({ power: 2, toughness: 2, damage: 0 })
  })

  it('a sorcery could not be cast here, and the lesson refuses it with the reason', () => {
    const s0 = createState({ ...RESPONSE_GUIDED, setup: { ...RESPONSE_GUIDED.setup, you: { ...RESPONSE_GUIDED.setup.you, hand: ['volcanicHammer'] } } })
    const { state } = { state: start({ ...RESPONSE_GUIDED, setup: { ...RESPONSE_GUIDED.setup, you: { ...RESPONSE_GUIDED.setup.you, hand: ['volcanicHammer'] } } }).state }
    expect(state.stack).toHaveLength(1)
    const hammer = find(state, 'volcanicHammer', 'you', 'hand').instanceId
    refused(applyAction(state, you({ type: 'beginCast', instanceId: hammer })), 'notYourTurn')
    expect(hand(s0, 'you')).toHaveLength(1)
  })
})

describe('every scenario', () => {
  it('has a version, goals with labels, a coach intro, a paper prompt, and an opponent the screen can describe', () => {
    for (const scenario of Object.values(SCENARIOS)) {
      expect(scenario.version, scenario.id).toBe(1)
      expect(scenario.goals.length, scenario.id).toBeGreaterThan(0)
      for (const goal of scenario.goals) { expect(goal.label, `${scenario.id} ${goal.id}`).toBeTruthy(); expect(typeof goal.done).toBe('function') }
      expect(scenario.coach.intro.length, scenario.id).toBeGreaterThan(40)
      expect(scenario.paper.needs.length, scenario.id).toBeGreaterThan(0)
      expect(policyFor(scenario.opponent).description, scenario.id).toBeTruthy()
      for (const p of scenario.predict ?? []) {
        expect(p.options.filter((o) => o.correct).length, `${scenario.id} ${p.id}`).toBe(1)
        expect(scenario.goals.some((g) => g.id === `predicted:${p.id}`), `${scenario.id} ${p.id} is not a goal`).toBe(true)
      }
      if (scenario.explain) expect(scenario.goals.some((g) => g.id === `explained:${scenario.explain.id}`), scenario.id).toBe(true)
    }
    const listed = LESSONS.flatMap((l) => l.scenarios)
    expect(new Set(listed).size).toBe(listed.length)
    for (const id of listed) expect(SCENARIOS[id], id).toBeTruthy()
  })
  it('starts without stalling and with the invariants holding', () => {
    for (const scenario of Object.values(SCENARIOS)) {
      const { state } = start(scenario)
      expect(invariants(state), scenario.id).toEqual([])
      expect(state.over, scenario.id).toBeNull()
      expect(state.priority === 'you' || state.awaiting?.player === 'you', scenario.id).toBe(true)
    }
  })
})
