// @vitest-environment node
/**
 * What a person chooses at the engine's table before anything is sent
 * (src/lib/engine/choose.js; HANDOFF.md, M4).
 *
 * The offers and decisions here are as the built engine sent them on
 * 2026-09-24, protocol 5, from the games `tests/engine-live.test.js` plays:
 * Volcanic Hammer and Magma Jet aimed at a player, Arc Lightning's damage
 * divided, Blaze's X, Tormenting Voice's discard, the discard at cleanup, a
 * scry's bottom and order, and a Hill Giant's combat damage between two
 * blockers. Only the ids are shortened.
 */
import { describe, it, expect } from 'vitest'
import {
  ALWAYS_ASKED, ANSWERS, NO_CHOICES, advance, answerOf, beginBottom, beginDecision, beginPlay, choicesFrom, complete,
  heldBackBy, pickable, ready, requirementsOf, setAmount, setX, stepOf, stepsFor, toggle,
} from '../src/lib/engine/choose.js'

const YOU = 'e0'
const BOT = 'e1'
/** What the room says after the deal, at a relay and an engine that both choose. */
const CAN = choicesFrom({
  choices: {
    act: ['targets', 'x', 'damage', 'cost', 'auto'],
    costs: ['DiscardCard', 'SacrificePermanent', 'TapPermanents', 'BouncePermanent', 'ExileFromGraveyard', 'ExileFromHand', 'Behold', 'RevealCard', 'Blight'],
    decisions: [...ALWAYS_ASKED, ...ANSWERS],
  },
})

const HAMMER = { index: 1, type: 'CastSpell', description: 'Cast Volcanic Hammer', card: 'e30', affordable: true, meaningful: true, manaCost: '{1}{R}', requiresTargets: true, targetCount: 1, minTargets: 1, targetDescription: 'any target', validTargets: ['e21', 'e55', YOU, BOT], targetRequirements: [{ index: 0, description: 'any target', min: 1, max: 1, legal: ['e21', 'e55', YOU, BOT] }] }
const ARC = { index: 1, type: 'CastSpell', description: 'Cast Arc Lightning', card: 'e29', affordable: true, meaningful: true, manaCost: '{2}{R}', requiresTargets: true, targetCount: 3, minTargets: 1, targetDescription: '3 targets', validTargets: [YOU, BOT], targetRequirements: [{ index: 0, description: '3 targets', min: 1, max: 3, legal: [YOU, BOT] }], divide: { total: 3, min: 1 } }
const BLAZE = { index: 1, type: 'CastSpell', description: 'Cast Blaze', card: 'e36', affordable: true, meaningful: true, manaCost: '{X}{R}', requiresTargets: true, targetCount: 1, minTargets: 1, targetDescription: 'any target', validTargets: [YOU, BOT], targetRequirements: [{ index: 0, description: 'any target', min: 1, max: 1, legal: [YOU, BOT] }], x: { min: 0, max: 3 } }
const VOICE = { index: 1, type: 'CastSpell', description: 'Cast Tormenting Voice', card: 'e39', affordable: true, meaningful: true, manaCost: '{1}{R}', requiresTargets: false, additionalCost: 'DiscardCard', additionalCostText: 'Discard a card', costChoice: { min: 1, max: 1, candidates: ['e26', 'e29', 'e22', 'e7'] } }
const GECKO = { index: 3, type: 'ActivateAbility', description: '{1}{R}, Discard a card: Draw a card', card: 'e30', affordable: true, meaningful: true, manaCost: '{1}{R}', requiresTargets: false, additionalCost: 'DiscardCard', additionalCostText: 'Discard a card', costChoice: { min: 1, max: 1, candidates: ['e31', 'e32'] } }
const LAND = { index: 2, type: 'PlayLand', description: 'Play Mountain', card: 'e14', affordable: true, meaningful: true }

describe('what the room says a seat may choose', () => {
  it('reads what it says, forgivingly', () => {
    expect(CAN.act.has('targets')).toBe(true)
    expect(CAN.costs.has('DiscardCard')).toBe(true)
    expect([...CAN.decisions]).toEqual([...ALWAYS_ASKED, ...ANSWERS])
    // A relay or an engine from before choices says nothing, and nothing is read.
    for (const seated of [null, {}, { choices: null }, { choices: [] }, { choices: 'yes' }]) expect(choicesFrom(seated)).toBe(NO_CHOICES)
    // A list with something in it that is not a word keeps the words.
    expect([...choicesFrom({ choices: { act: ['targets', 3, null], costs: 'DiscardCard' } }).act]).toEqual(['targets'])
    // Every engine asks targets, yes or no, and an option, whatever the room said.
    expect([...choicesFrom({ choices: { decisions: [] } }).decisions]).toEqual(ALWAYS_ASKED)
  })

  it('names every decision this build can show, and none that every engine asks already', () => {
    expect(ANSWERS).toEqual(['SelectCards', 'OrderObjects', 'ReorderLibrary', 'Distribute', 'CombatResolution', 'SelectManaSources', 'ChooseNumber', 'ChooseColor', 'ChooseMode', 'BatchYesNo'])
    expect(ANSWERS.filter((d) => ALWAYS_ASKED.includes(d))).toEqual([])
  })
})

describe('what holds a play back', () => {
  it('holds back a target or a chosen cost where the seat cannot send it, as every table before M4 did', () => {
    expect(heldBackBy(HAMMER)).toBe('target')
    expect(heldBackBy(VOICE)).toBe('cost')
    expect(heldBackBy(GECKO, NO_CHOICES)).toBe('cost')
    expect(heldBackBy(LAND)).toBeNull()
  })

  it('holds back neither where the room says the seat can send them', () => {
    for (const offer of [HAMMER, ARC, BLAZE, VOICE, GECKO, LAND]) expect(heldBackBy(offer, CAN), offer.description).toBeNull()
  })

  it('still holds back a cost the engine cannot take a choice for, or one it named no candidates for', () => {
    expect(heldBackBy({ ...VOICE, additionalCost: 'CollectEvidence', costChoice: undefined }, CAN)).toBe('cost')
    expect(heldBackBy({ ...VOICE, costChoice: undefined }, CAN)).toBe('cost')
    expect(heldBackBy({ ...VOICE, costChoice: { min: 1, max: 1, candidates: [] } }, CAN)).toBe('cost')
    expect(heldBackBy({ ...GECKO, requiresForage: true }, CAN)).toBe('cost')
    // A cost with nothing to choose holds nothing back.
    expect(heldBackBy({ ...GECKO, additionalCost: 'SacrificeSelf', costChoice: undefined })).toBeNull()
    expect(heldBackBy({ ...GECKO, additionalCost: 'PayLife', costChoice: undefined })).toBeNull()
  })

  it('holds back a divided spell at a seat that can aim but not divide', () => {
    const aimsOnly = { ...CAN, act: new Set(['targets']) }
    expect(heldBackBy(ARC, aimsOnly)).toBe('target')
    expect(heldBackBy(HAMMER, aimsOnly)).toBeNull()
  })

  it('reads an offer of one requirement the way Argentum describes it, flat', () => {
    const { targetRequirements, ...flat } = HAMMER
    expect(requirementsOf(flat)).toEqual([{ index: 0, description: 'any target', min: 1, max: 1, legal: HAMMER.validTargets, distinct: false }])
    expect(requirementsOf(LAND)).toEqual([])
    expect(requirementsOf({ requiresTargets: true, targetRequirements: [null, 'x', { legal: [1, 'e2'] }] })).toEqual([{ index: 2, description: '', min: 1, max: 1, legal: ['e2'], distinct: false }])
  })
})

describe('a play, chosen a step at a time', () => {
  it('needs nothing chosen for a land, which a tap sends as it is', () => {
    expect(stepsFor(LAND, CAN)).toEqual([])
    expect(beginPlay(LAND, CAN)).toBeNull()
    // Nor for anything held back.
    expect(beginPlay(HAMMER, NO_CHOICES)).toBeNull()
  })

  it('aims Volcanic Hammer with one tap, and sends the target as the process reads it', () => {
    let ch = beginPlay(HAMMER, CAN)
    expect(stepOf(ch)).toMatchObject({ kind: 'targets', index: 0, min: 1, max: 1 })
    expect(pickable(ch)).toEqual(['e21', 'e55', YOU, BOT])
    expect(toggle(ch, 'e99')).toBe(ch)
    ch = toggle(ch, BOT)
    expect(complete(ch)).toBe(true)
    const { ch: done, done: finished } = advance(ch)
    expect(finished).toBe(true)
    expect(answerOf(done)).toEqual({ targets: { 0: [BOT] } })
  })

  it('takes Blaze\'s X first, from the least to the most this seat can pay, then its target', () => {
    let ch = beginPlay(BLAZE, CAN)
    expect(stepOf(ch)).toMatchObject({ kind: 'x', min: 0, max: 3, value: 3 })
    ch = setX(ch, 9)
    expect(stepOf(ch).value).toBe(3)
    ch = setX(ch, 2)
    expect(ready(ch)).toBe(true)
    ch = advance(ch).ch
    expect(stepOf(ch).kind).toBe('targets')
    ch = toggle(ch, BOT)
    const { ch: done, done: finished } = advance(ch)
    expect(finished).toBe(true)
    expect(answerOf(done)).toEqual({ x: 2, targets: { 0: [BOT] } })
    // A seat that cannot send an X is not asked for one: the engine reads none as nought, as before.
    const noX = { ...CAN, act: new Set(['targets']) }
    expect(beginPlay(BLAZE, noX).steps.map((s) => s.kind)).toEqual(['targets'])
  })

  it('divides Arc Lightning\'s damage among the targets chosen, ready-made and changeable', () => {
    let ch = beginPlay(ARC, CAN)
    expect(ch.steps.map((s) => s.kind)).toEqual(['targets', 'divide'])
    ch = toggle(ch, BOT)
    // Up to three targets: one more might be wanted, so the step waits for Done.
    expect(complete(ch)).toBe(false)
    ch = toggle(ch, YOU)
    ch = advance(ch).ch
    expect(stepOf(ch)).toMatchObject({ kind: 'divide', total: 3, min: 1, amounts: { [BOT]: 2, [YOU]: 1 } })
    expect(ready(ch)).toBe(true)
    ch = setAmount(ch, BOT, 1)
    expect(ready(ch)).toBe(false)
    ch = setAmount(ch, YOU, 2)
    // Never below the least each must take.
    expect(stepOf(setAmount(ch, YOU, 0)).amounts[YOU]).toBe(1)
    const { ch: done, done: finished } = advance(ch)
    expect(finished).toBe(true)
    expect(answerOf(done)).toEqual({ targets: { 0: [BOT, YOU] }, damage: { [BOT]: 1, [YOU]: 2 } })
  })

  it('passes over the division where one target takes it all, as Argentum does', () => {
    let ch = toggle(beginPlay(ARC, CAN), BOT)
    const { ch: done, done: finished } = advance(ch)
    expect(finished).toBe(true)
    expect(answerOf(done)).toEqual({ targets: { 0: [BOT] } })
  })

  it('takes the card a cost discards, never the card being cast', () => {
    let ch = beginPlay(VOICE, CAN)
    expect(stepOf(ch)).toMatchObject({ kind: 'cost', min: 1, max: 1, text: 'Discard a card' })
    expect(pickable(ch)).toEqual(['e26', 'e29', 'e22', 'e7'])
    // Argentum lists the whole hand as able to discard, the spell among them;
    // the spell cannot pay its own cost, and is left out.
    expect(pickable(beginPlay({ ...VOICE, costChoice: { ...VOICE.costChoice, candidates: ['e39', 'e26'] } }, CAN))).toEqual(['e26'])
    ch = toggle(ch, 'e22')
    expect(complete(ch)).toBe(true)
    expect(answerOf(advance(ch).ch)).toEqual({ cost: ['e22'] })
  })

  it('takes an ability\'s own source where Argentum lists it, to pay its cost or as its target', () => {
    // Shaped as Server.kt describes them, not captured: Bloodthrone Vampire's
    // "Sacrifice a creature" may sacrifice the Vampire, and Argentum leaves a
    // source out only where the card says "another" (`excludeSelf`); Prodigal
    // Pyromancer's "any target" is any, itself included. Until M4's review the
    // source was taken out of every cost of its own play, which left the
    // Vampire alone with nothing that could pay.
    const VAMPIRE = { index: 2, type: 'ActivateAbility', description: 'Sacrifice a creature: Bloodthrone Vampire gets +2/+2 until end of turn', card: 'e40', affordable: true, meaningful: true, requiresTargets: false, additionalCost: 'SacrificePermanent', additionalCostText: 'Sacrifice a creature', costChoice: { min: 1, max: 1, candidates: ['e40'] } }
    let ch = beginPlay(VAMPIRE, CAN)
    expect(pickable(ch)).toEqual(['e40'])
    ch = toggle(ch, 'e40')
    expect(answerOf(advance(ch).ch)).toEqual({ cost: ['e40'] })
    const PYROMANCER = { index: 2, type: 'ActivateAbility', description: '{T}: Prodigal Pyromancer deals 1 damage to any target', card: 'e41', affordable: true, meaningful: true, requiresTargets: true, targetRequirements: [{ index: 0, description: 'any target', min: 1, max: 1, legal: ['e41', YOU, BOT] }] }
    expect(pickable(beginPlay(PYROMANCER, CAN))).toEqual(['e41', YOU, BOT])
  })

  it('keeps a later requirement that must differ from choosing what an earlier one took', () => {
    const two = { ...HAMMER, targetRequirements: [{ index: 0, description: 'target creature', min: 1, max: 1, legal: ['e21', 'e55'] }, { index: 1, description: 'another target creature', min: 1, max: 1, legal: ['e21', 'e55'], distinct: true }] }
    let ch = toggle(beginPlay(two, CAN), 'e21')
    ch = advance(ch).ch
    expect(pickable(ch)).toEqual(['e55'])
    ch = toggle(ch, 'e55')
    expect(answerOf(advance(ch).ch)).toEqual({ targets: { 0: ['e21'], 1: ['e55'] } })
  })

  it('replaces the last pick once a step has all it takes, and takes one back when tapped again', () => {
    const twoOf = { ...ARC, divide: undefined, targetRequirements: [{ index: 0, description: '2 targets', min: 1, max: 2, legal: ['a', 'b', 'c'] }] }
    let ch = beginPlay(twoOf, CAN)
    ch = toggle(toggle(ch, 'a'), 'b')
    expect(stepOf(ch).picked).toEqual(['a', 'b'])
    ch = toggle(ch, 'c')
    expect(stepOf(ch).picked).toEqual(['a', 'c'])
    ch = toggle(ch, 'a')
    expect(stepOf(ch).picked).toEqual(['c'])
  })
})

describe('a decision picked on the table', () => {
  const asked = (decision) => ({ actor: YOU, waiting: 'decision', decision })

  it('begins a trigger\'s targets, a cleanup discard and the lands to pay with, and nothing else', () => {
    const aim = beginDecision(asked({ id: 'd1', type: 'ChooseTargets', prompt: 'Choose targets', source: 'Sparkmage Apprentice', requirements: [{ index: 0, description: 'any target', min: 1, max: 1, legal: [BOT, 'e21'] }] }), YOU)
    expect(stepOf(aim)).toMatchObject({ kind: 'targets', legal: [BOT, 'e21'] })
    expect(answerOf(advance(toggle(aim, BOT)).ch)).toEqual({ targets: { 0: [BOT] } })

    const discard = beginDecision(asked({ id: 'r0', type: 'SelectCards', prompt: 'Discard down to 7 cards (choose 1 to discard)', source: null, min: 1, max: 1, options: ['e15', 'e27', 'e2'] }), YOU)
    expect(stepOf(discard)).toMatchObject({ kind: 'cards', min: 1, max: 1 })
    expect(answerOf(advance(toggle(discard, 'e27')).ch)).toEqual({ cards: ['e27'] })

    // A scry of two may take none of them to the bottom: Done is ready at once.
    const scry = beginDecision(asked({ id: 'r1', type: 'SelectCards', prompt: 'Choose up to 2 cards', min: 0, max: 2, options: ['e37', 'e7'], cards: { e37: { name: 'Magma Jet' }, e7: { name: 'Mountain' } } }), YOU)
    expect(ready(scry)).toBe(true)
    expect(answerOf(advance(scry).ch)).toEqual({ cards: [] })

    // The engine's own choice of lands is where paying begins.
    const pay = beginDecision(asked({ id: 'r2', type: 'SelectManaSources', cost: '{1}', canDecline: true, sources: [{ id: 'e3', name: 'Mountain' }, { id: 'e4', name: 'Mountain' }, null], suggested: ['e4', 'e9'] }), YOU)
    expect(stepOf(pay)).toMatchObject({ kind: 'sources', legal: ['e3', 'e4'], picked: ['e4'] })
    expect(answerOf(advance(toggle(pay, 'e3')).ch)).toEqual({ sources: ['e4', 'e3'] })

    for (const type of ['YesNo', 'ChooseOption', 'OrderObjects', 'ReorderLibrary', 'Distribute', 'CombatResolution', 'ChooseNumber', 'ChooseColor', 'ChooseMode', 'BatchYesNo', 'SomethingNew']) {
      expect(beginDecision(asked({ id: 'x', type }), YOU), type).toBeNull()
    }
  })

  it('begins nothing for a decision that is not this seat\'s, nor at a stop that is not a decision', () => {
    const d = { id: 'd1', type: 'SelectCards', min: 1, max: 1, options: ['e2'] }
    expect(beginDecision({ actor: BOT, waiting: 'decision', decision: d }, YOU)).toBeNull()
    expect(beginDecision({ actor: YOU, waiting: 'action', actions: [] }, YOU)).toBeNull()
    expect(beginDecision({ actor: YOU, waiting: 'decision', decision: d, over: true }, YOU)).toBeNull()
    expect(beginDecision(null, YOU)).toBeNull()
  })
})

describe('the opening hand (protocol 6)', () => {
  // As the built engine sent them on 2026-09-24, seed 1 with Portal goblins:
  // the first offer, the offer after one mulligan, and the cards to bottom.
  const KEEP = { index: 0, type: 'KeepHand', description: 'Keep this hand', affordable: true, meaningful: true, mulligans: 0, bottom: 0 }
  const TAKE = { index: 1, type: 'TakeMulligan', description: 'Take a mulligan', affordable: true, meaningful: true, mulligans: 0, draws: 7, bottom: 1 }
  const HAND = ['e31', 'e16', 'e10', 'e28', 'e34', 'e33', 'e24']
  const BOTTOM = { index: 0, type: 'BottomCards', description: 'Put 1 card on the bottom of your library', affordable: true, meaningful: true, mulligans: 1, bottom: 1, candidates: HAND }
  const at = (...actions) => ({ actor: YOU, waiting: 'action', actions })

  it('needs nothing chosen to keep or to take a mulligan, which a press sends as it is', () => {
    expect(beginPlay(KEEP, CAN)).toBeNull()
    expect(beginPlay(TAKE, CAN)).toBeNull()
    expect(heldBackBy(KEEP, NO_CHOICES)).toBeNull()
    expect(beginBottom(at(KEEP, TAKE), YOU)).toBeNull()
  })

  it('begins the cards to put on the bottom from the stop that asks, one tap finishing one card', () => {
    const ch = beginBottom(at(BOTTOM), YOU)
    expect(ch).toMatchObject({ from: 'bottom', offer: BOTTOM })
    expect(stepOf(ch)).toEqual({ kind: 'bottom', min: 1, max: 1, legal: HAND, picked: [] })
    expect(pickable(ch)).toEqual(HAND)
    const picked = toggle(ch, 'e28')
    expect(complete(picked)).toBe(true)
    const { ch: done, done: finished } = advance(picked)
    expect(finished).toBe(true)
    // Sent as the offer's act, in the shape Server.kt reads.
    expect(answerOf(done)).toEqual({ cards: ['e28'] })
    // The actions panel's press begins the same choice.
    expect(beginPlay(BOTTOM, NO_CHOICES)).toEqual(ch)
  })

  it('waits for the press where more than one is owed, and takes exactly as many as that', () => {
    const ch = beginBottom(at({ ...BOTTOM, mulligans: 2, bottom: 2, description: 'Put 2 cards on the bottom of your library' }), YOU)
    let step = toggle(ch, 'e31')
    expect(complete(step)).toBe(false)
    expect(ready(step)).toBe(false)
    step = toggle(step, 'e16')
    expect(ready(step)).toBe(true)
    expect(complete(step)).toBe(false)
    // A third replaces the last rather than making three.
    step = toggle(step, 'e10')
    expect(stepOf(step).picked).toEqual(['e31', 'e10'])
    expect(answerOf(advance(step).ch)).toEqual({ cards: ['e31', 'e10'] })
  })

  it('begins nothing at another seat\'s stop, at the game\'s end, or for an offer that names nothing to choose from', () => {
    expect(beginBottom({ ...at(BOTTOM), actor: BOT }, YOU)).toBeNull()
    expect(beginBottom({ ...at(BOTTOM), over: true }, YOU)).toBeNull()
    expect(beginBottom({ actor: YOU, waiting: 'decision', decision: { type: 'SelectCards' } }, YOU)).toBeNull()
    expect(beginBottom(at({ ...BOTTOM, candidates: null }), YOU)).toBeNull()
    expect(beginBottom(at({ ...BOTTOM, bottom: 'one' }), YOU)).toBeNull()
    expect(beginBottom(at({ ...BOTTOM, bottom: 0 }), YOU)).toBeNull()
    expect(beginBottom(null, YOU)).toBeNull()
    // More owed than the hand holds is read as the whole hand, never as more than it.
    expect(stepOf(beginBottom(at({ ...BOTTOM, bottom: 9, candidates: ['e1', 'e2'] }), YOU))).toMatchObject({ min: 2, max: 2 })
  })
})
