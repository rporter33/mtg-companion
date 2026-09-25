// @vitest-environment node
/**
 * What glows at the engine's table (src/lib/engine/glow.js).
 *
 * Held against the captured run first (`tests/fixtures/engine-views.json`,
 * `scripts/engine-capture.mjs`): real statuses from a real game, with the
 * board each one belongs to rebuilt by walking the run's deltas, so the zones
 * the glow reads are the engine's and not a guess. The run holds plays, a
 * declaration of attackers, the offer to block, the engine's own stops and a
 * stop where the only play is a spell that needs a target; and since M4's
 * capture, the opening hand and a targets decision, which M2's could not reach.
 * What no capture holds is built in Server.kt's own shape.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyDelta, boardFromView } from '../src/lib/engine/board.js'
import { glowsAt, heldBack, offeredElsewhere, pileHolding, unaimed, unpaid, GLOW_SAYS } from '../src/lib/engine/glow.js'
import { ANSWERS, beginBottom, beginDecision, beginPlay, choicesFrom, toggle } from '../src/lib/engine/choose.js'

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/engine-views.json', import.meta.url), 'utf8'))
const RUN = FIXTURE.run
const YOU = RUN.you

/** Every stop of the run with the board it was drawn on. */
const stops = (() => {
  const out = []
  let view = null
  let board = null
  for (const entry of RUN.views) {
    view = entry.delta ? applyDelta(view, entry.delta, { log: entry.log }) : { ...entry.state, log: entry.fullLog }
    board = boardFromView(view, { prev: board })
    out.push({ at: entry.at, status: entry.status, board })
  }
  return out
})()
const zoneIn = (board) => (id) => board.cards[id]?.zone
const kinds = (glows) => Object.fromEntries([...glows].map(([id, g]) => [id, g.kind]))

describe('a play: the cards in hand the engine will take', () => {
  const plays = stops.filter((s) => s.status.waiting === 'action' && !s.status.actions.some((a) => /^Declare/.test(a.type)))

  it('glows exactly the hand cards with a meaningful, affordable offer, at every stop of the run', () => {
    expect(plays.length).toBeGreaterThan(5)
    for (const { at, status, board } of plays) {
      const glows = glowsAt({ status, me: YOU, zoneOf: zoneIn(board) })
      const expected = new Set(status.actions
        .filter((a) => a.card && a.meaningful && a.affordable && !a.mana && !a.requiresTargets)
        .map((a) => a.card))
      expect(new Set(glows.keys()), `stop ${at}`).toEqual(expected)
      for (const [id, glow] of glows) {
        expect(board.cards[id].zone, `stop ${at}: ${id}`).toBe('hand')
        expect(glow).toEqual({ kind: 'playable', says: GLOW_SAYS.play })
      }
    }
  })

  it('never glows a spell that needs a target at a seat told it cannot send one', () => {
    const aimed = plays.filter((s) => s.status.actions.some((a) => a.requiresTargets && a.affordable))
    expect(aimed.length).toBeGreaterThan(0)
    for (const { at, status, board } of aimed) {
      const glows = glowsAt({ status, me: YOU, zoneOf: zoneIn(board) })
      for (const a of status.actions.filter((x) => x.requiresTargets)) expect(glows.has(a.card), `stop ${at}: ${a.description}`).toBe(false)
    }
  })

  it('and names it instead, where it is the only reason for the stop', () => {
    const only = plays.find((s) => s.status.actions.filter((a) => a.meaningful && a.affordable).every((a) => a.requiresTargets))
    expect(only, 'the run has a stop made for Volcanic Hammer alone').toBeTruthy()
    expect(glowsAt({ status: only.status, me: YOU, zoneOf: zoneIn(only.board) }).size).toBe(0)
    expect(unaimed(only.status).map((a) => a.description)).toEqual(['Cast Volcanic Hammer'])
  })

  it('never glows a land for its mana ability', () => {
    for (const { status, board } of plays) {
      const glows = glowsAt({ status, me: YOU, zoneOf: zoneIn(board) })
      for (const a of status.actions.filter((x) => x.mana)) expect(glows.has(a.card)).toBe(false)
    }
  })

  it('glows a permanent with an ability that is not a mana ability, and says so differently', () => {
    const status = { actor: YOU, waiting: 'action', actions: [
      { index: 0, type: 'PassPriority', affordable: true, meaningful: false },
      { index: 1, type: 'ActivateAbility', card: 'e40', affordable: true, meaningful: true, requiresTargets: false },
      { index: 2, type: 'ActivateAbility', card: 'e41', affordable: true, meaningful: false, mana: true },
      { index: 3, type: 'ActivateAbility', card: 'e42', affordable: true, meaningful: true, requiresTargets: true, validTargets: ['e1'] },
      { index: 4, type: 'ActivateAbility', card: 'e43', affordable: false, meaningful: true },
    ] }
    const glows = glowsAt({ status, me: YOU, zoneOf: () => 'battlefield' })
    expect(kinds(glows)).toEqual({ e40: 'playable' })
    expect(glows.get('e40').says).toBe(GLOW_SAYS.ability)
  })
})

describe('a cost with a choice in it', () => {
  // Server.kt's describe() for Flamecache Gecko's ability, as the live engine
  // sent it (checked 2026-09-24 against the built engine at the pin).
  const gecko = { index: 3, type: 'ActivateAbility', description: '{1}{R}, Discard a card: Draw a card', card: 'e27', affordable: true, meaningful: true, manaCost: '{1}{R}', requiresTargets: false, additionalCost: 'DiscardCard', additionalCostText: 'Discard a card' }
  const pass = { index: 0, type: 'PassPriority', description: 'Pass priority', affordable: true, meaningful: false }
  const status = { actor: YOU, waiting: 'action', actions: [pass, gecko] }

  it('is held back, and does not glow, at a seat whose act carries no payment, since Argentum refuses it bare', () => {
    expect(heldBack(gecko)).toBe('cost')
    expect(glowsAt({ status, me: YOU, zoneOf: () => 'battlefield' }).size).toBe(0)
    expect(unpaid(status).map((a) => a.card)).toEqual(['e27'])
    expect(unaimed(status)).toEqual([])
  })

  it('but a cost with nothing to choose in it glows as it always did: the source itself, or life', () => {
    for (const additionalCost of ['SacrificeSelf', 'PayLife']) {
      const offer = { ...gecko, additionalCost }
      expect(heldBack(offer)).toBeNull()
      expect(kinds(glowsAt({ status: { ...status, actions: [pass, offer] }, me: YOU, zoneOf: () => 'battlefield' }))).toEqual({ e27: 'playable' })
    }
  })

  it('and forage is a choice whatever its kind says', () => {
    expect(heldBack({ ...gecko, additionalCost: undefined, requiresForage: true })).toBe('cost')
  })

  it('reads an offer from an engine that names no cost as one with none, and a target before a cost', () => {
    const { additionalCost, additionalCostText, ...older } = gecko
    expect(heldBack(older)).toBeNull()
    expect(heldBack({ ...gecko, requiresTargets: true })).toBe('target')
    for (const odd of [null, undefined, 3, 'x', { additionalCost: 7 }]) expect(() => heldBack(odd)).not.toThrow()
    expect(heldBack({ additionalCost: 7 })).toBeNull()
  })
})

describe('a play offered for a card in a pile', () => {
  // A flashback, as the live engine offered one (Think Twice, 2026-09-24):
  // a CastSpell of its own kind, with the card in the graveyard.
  const flashback = { index: 4, type: 'CastWithFlashback', description: 'Cast Think Twice (Flashback)', card: 'e27', affordable: true, meaningful: true, manaCost: '{2}{U}', requiresTargets: false }
  const unearth = { index: 5, type: 'ActivateAbility', description: 'Unearth {R}', card: 'e28', affordable: true, meaningful: true, requiresTargets: false }
  const zones = { e27: 'graveyard', e28: 'graveyard', e30: 'hand' }
  const zoneOf = (id) => zones[id]

  it('does not glow, since no tap on the table reaches it, and is named instead', () => {
    const status = { actor: YOU, waiting: 'action', actions: [{ index: 0, type: 'PassPriority', affordable: true, meaningful: false }, flashback, unearth] }
    expect(glowsAt({ status, me: YOU, zoneOf }).size).toBe(0)
    expect(offeredElsewhere(status, zoneOf).map(({ offer, zone }) => [offer.card, zone])).toEqual([['e27', 'graveyard'], ['e28', 'graveyard']])
  })

  it('leaves out what is in hand or on the battlefield, what is held back, and a second offer for the same card', () => {
    const inHand = { ...flashback, index: 6, type: 'CastSpell', card: 'e30' }
    const aimed = { ...flashback, index: 7, card: 'e31', requiresTargets: true }
    const status = { actor: YOU, waiting: 'action', actions: [flashback, { ...flashback, index: 8 }, inHand, aimed] }
    expect(offeredElsewhere(status, (id) => ({ ...zones, e31: 'graveyard' })[id]).map(({ offer }) => offer.index)).toEqual([4])
  })
})

describe('combat, declared by tapping', () => {
  const declaring = stops.find((s) => s.status.actions?.some((a) => a.type === 'DeclareAttackers' && a.meaningful))
  const blocking = stops.find((s) => s.status.actions?.some((a) => a.type === 'DeclareBlockers' && a.meaningful))

  it('glows exactly the engine\'s valid attackers, and nothing in hand', () => {
    const offer = declaring.status.actions.find((a) => a.type === 'DeclareAttackers')
    const glows = glowsAt({ status: declaring.status, me: YOU, zoneOf: zoneIn(declaring.board) })
    expect(new Set(glows.keys())).toEqual(new Set(offer.validAttackers))
    for (const glow of glows.values()) expect(glow).toEqual({ kind: 'target', says: GLOW_SAYS.attacker })
  })

  it('and a chosen attacker stays lit, saying it attacks', () => {
    const offer = declaring.status.actions.find((a) => a.type === 'DeclareAttackers')
    const [first, ...rest] = offer.validAttackers
    const glows = glowsAt({ status: declaring.status, me: YOU, zoneOf: zoneIn(declaring.board), chosen: new Set([first]) })
    expect(glows.get(first)).toEqual({ kind: 'chosen', says: GLOW_SAYS.attacking })
    for (const id of rest) expect(glows.get(id).kind).toBe('target')
  })

  it('glows the valid blockers, lights one picked or placed, and never claims an attacker is blockable', () => {
    const offer = blocking.status.actions.find((a) => a.type === 'DeclareBlockers')
    const zoneOf = zoneIn(blocking.board)
    expect(kinds(glowsAt({ status: blocking.status, me: YOU, zoneOf }))).toEqual(Object.fromEntries(offer.validBlockers.map((id) => [id, 'target'])))
    const [b] = offer.validBlockers
    expect(glowsAt({ status: blocking.status, me: YOU, zoneOf, blocker: b }).get(b)).toEqual({ kind: 'chosen', says: GLOW_SAYS.blocking })
    const placed = glowsAt({ status: blocking.status, me: YOU, zoneOf, blocks: { [b]: ['e99'] } })
    expect(placed.get(b).kind).toBe('chosen')
    expect(placed.has('e99')).toBe(false)
  })
})

describe('a target being chosen', () => {
  // Server.kt's describe(decision, full = true) for a ChooseTargetsDecision.
  const asking = {
    actor: YOU, waiting: 'decision',
    decision: {
      id: 'd1', type: 'ChooseTargets', player: YOU, prompt: 'Choose targets for Sparkmage Apprentice', source: 'Sparkmage Apprentice',
      canCancel: false,
      requirements: [
        { index: 0, description: 'any target', min: 1, max: 1, legal: ['e30', 'e54', YOU, 'e1'] },
        { index: 1, description: 'target creature', min: 1, max: 1, legal: ['e30', 'e61'] },
      ],
    },
  }

  it('glows every legal id across every requirement, cards and seats alike, and nothing else', () => {
    const glows = glowsAt({ status: asking, me: YOU })
    expect(new Set(glows.keys())).toEqual(new Set(['e30', 'e54', YOU, 'e1', 'e61']))
    for (const glow of glows.values()) expect(glow).toEqual({ kind: 'target', says: GLOW_SAYS.target })
  })

  it('glows nothing for another seat\'s decision, or one of another kind', () => {
    expect(glowsAt({ status: { ...asking, actor: 'e1' }, me: YOU }).size).toBe(0)
    expect(glowsAt({ status: { ...asking, decision: { ...asking.decision, type: 'YesNo' } }, me: YOU }).size).toBe(0)
  })

  it('and at the captured run\'s own: Sparkmage Apprentice\'s arrival, every legal id on the board it was asked on', () => {
    // Since M4's capture the run holds a real one (PLAN.md, M2 left it short).
    const at = stops.find((s) => s.status.waiting === 'decision' && s.status.decision?.type === 'ChooseTargets')
    expect(at, 'the run holds a targets decision').toBeTruthy()
    expect(at.status.decision.source).toBe('Sparkmage Apprentice')
    const legal = at.status.decision.requirements.flatMap((r) => r.legal)
    const glows = glowsAt({ status: at.status, me: YOU, zoneOf: zoneIn(at.board) })
    expect(new Set(glows.keys())).toEqual(new Set(legal))
    // The cards among them are on the battlefield the view shows, and both seats are among them.
    for (const id of legal.filter((x) => !at.board.players.includes(x))) expect(at.board.cards[id]?.zone, id).toBe('battlefield')
    expect(at.board.players.every((p) => legal.includes(p))).toBe(true)
    // The choosing begun from it glows the same, each saying it is a legal target.
    const choosing = beginDecision(at.status, YOU)
    expect([...glowsAt({ status: at.status, me: YOU, zoneOf: zoneIn(at.board), choosing }).values()].every((g) => g.says === GLOW_SAYS.target)).toBe(true)
  })
})

describe('at a seat that can choose (M4)', () => {
  // What the room says after the deal where the relay and the engine both choose.
  const can = choicesFrom({ choices: { act: ['targets', 'x', 'damage', 'cost', 'auto'], costs: ['DiscardCard'], decisions: ANSWERS } })

  it('glows a spell that needs a target like any other play, and names none as held back', () => {
    const only = stops.find((s) => s.status.waiting === 'action'
      && s.status.actions.filter((a) => a.meaningful && a.affordable).every((a) => a.requiresTargets)
      && s.status.actions.some((a) => a.requiresTargets && a.affordable))
    const hammer = only.status.actions.find((a) => a.requiresTargets && a.affordable)
    const glows = glowsAt({ status: only.status, me: YOU, zoneOf: zoneIn(only.board), can })
    expect(glows.get(hammer.card)).toEqual({ kind: 'playable', says: GLOW_SAYS.play })
    expect(unaimed(only.status, can)).toEqual([])
    // The same stop at a seat told nothing is M1b's, unchanged.
    expect(glowsAt({ status: only.status, me: YOU, zoneOf: zoneIn(only.board) }).has(hammer.card)).toBe(false)
  })

  it('glows an ability whose cost it can pay with a choice, and holds back one whose candidates were not named', () => {
    const gecko = { index: 3, type: 'ActivateAbility', description: '{1}{R}, Discard a card: Draw a card', card: 'e27', affordable: true, meaningful: true, requiresTargets: false, additionalCost: 'DiscardCard', additionalCostText: 'Discard a card', costChoice: { min: 1, max: 1, candidates: ['e27', 'e31'] } }
    const status = { actor: YOU, waiting: 'action', actions: [gecko] }
    expect(kinds(glowsAt({ status, me: YOU, zoneOf: () => 'battlefield', can }))).toEqual({ e27: 'playable' })
    expect(unpaid(status, can)).toEqual([])
    const { costChoice, ...unnamed } = gecko
    expect(unpaid({ ...status, actions: [unnamed] }, can).map((a) => a.card)).toEqual(['e27'])
  })

  it('while a play is being chosen, glows what the step may take and lights what it took, in words', () => {
    const arc = { index: 1, type: 'CastSpell', card: 'e29', affordable: true, meaningful: true, requiresTargets: true, targetRequirements: [{ index: 0, description: '3 targets', min: 1, max: 3, legal: ['e0', 'e1', 'e21'] }], divide: { total: 3, min: 1 } }
    const status = { actor: YOU, waiting: 'action', actions: [arc] }
    let ch = beginPlay(arc, can)
    expect(kinds(glowsAt({ status, me: YOU, can, choosing: ch }))).toEqual({ e0: 'target', e1: 'target', e21: 'target' })
    ch = toggle(ch, 'e1')
    const glows = glowsAt({ status, me: YOU, can, choosing: ch })
    expect(glows.get('e1')).toEqual({ kind: 'chosen', says: GLOW_SAYS.targeted })
    expect(glows.get('e21')).toEqual({ kind: 'target', says: GLOW_SAYS.target })
    // Nothing plays while something is being chosen: the Arc in hand does not glow as playable.
    expect(glows.has('e29')).toBe(false)
  })

  it('glows the cards that can pay a cost, never the one being cast, and says what each is for', () => {
    const voice = { index: 2, type: 'CastSpell', card: 'e39', affordable: true, meaningful: true, requiresTargets: false, additionalCost: 'DiscardCard', additionalCostText: 'Discard a card', costChoice: { min: 1, max: 1, candidates: ['e22', 'e39'] } }
    const glows = glowsAt({ status: { actor: YOU, waiting: 'action', actions: [voice] }, me: YOU, can, choosing: beginPlay(voice, can) })
    expect(glows.get('e22')).toEqual({ kind: 'target', says: GLOW_SAYS.payable })
    expect(glows.has('e39')).toBe(false)
  })

  it('marks a pile holding a card a cost can take as holding one that can be chosen, not a target', () => {
    // A graveyard's tile is where a player looks for it, and the words were
    // "holds a legal target" for anything lit inside it, which a card that can
    // pay a cost is not (found reading the M4 diff).
    const glows = new Map([['e40', { kind: 'target', says: GLOW_SAYS.payable }], ['e41', { kind: 'chosen', says: GLOW_SAYS.paying }]])
    expect(pileHolding(['e40', 'e41'], glows)).toBe('choice')
    expect(pileHolding(['e40', 'e42'], new Map([...glows, ['e42', { kind: 'target', says: GLOW_SAYS.target }]]))).toBe('target')
    expect(pileHolding(['e43'], glows, [{ offer: { card: 'e43', type: 'CastWithFlashback' } }])).toBe('play')
    expect(pileHolding(['e43'], glows, [{ offer: { card: 'e43', type: 'ActivateAbility' } }])).toBe('use')
    expect(pileHolding([], glows)).toBeNull()
  })

  it('glows the cards a decision may select, saying they can be chosen', () => {
    const status = { actor: YOU, waiting: 'decision', decision: { id: 'r0', type: 'SelectCards', prompt: 'Discard down to 7 cards (choose 1 to discard)', min: 1, max: 1, options: ['e15', 'e27'] } }
    const glows = glowsAt({ status, me: YOU, can, choosing: beginDecision(status, YOU) })
    expect([...glows.values()]).toEqual([{ kind: 'target', says: GLOW_SAYS.choosable }, { kind: 'target', says: GLOW_SAYS.choosable }])
  })
})

describe('the opening hand (protocol 6)', () => {
  // Server.kt's offers, as the built engine sent them on 2026-09-24.
  const KEEP = { index: 0, type: 'KeepHand', description: 'Keep this hand', affordable: true, meaningful: true, mulligans: 0, bottom: 0 }
  const TAKE = { index: 1, type: 'TakeMulligan', description: 'Take a mulligan', affordable: true, meaningful: true, mulligans: 0, draws: 7, bottom: 1 }
  const BOTTOM = { index: 0, type: 'BottomCards', description: 'Put 1 card on the bottom of your library', affordable: true, meaningful: true, mulligans: 1, bottom: 1, candidates: ['e31', 'e16', 'e10'] }
  const inHand = () => 'hand'

  it('glows nothing while the hand is being kept or sent back: no card is played before the game begins', () => {
    expect(glowsAt({ status: { actor: YOU, waiting: 'action', actions: [KEEP, TAKE] }, me: YOU, zoneOf: inHand }).size).toBe(0)
  })

  it('glows the hand while the cards for the bottom are chosen, and lights one picked, in words', () => {
    const status = { actor: YOU, waiting: 'action', actions: [BOTTOM] }
    const ch = beginBottom(status, YOU)
    expect(kinds(glowsAt({ status, me: YOU, zoneOf: inHand, choosing: ch }))).toEqual({ e31: 'target', e16: 'target', e10: 'target' })
    expect(glowsAt({ status, me: YOU, zoneOf: inHand, choosing: ch }).get('e31').says).toBe(GLOW_SAYS.bottomable)
    const picked = glowsAt({ status, me: YOU, zoneOf: inHand, choosing: toggle({ ...ch, steps: [{ ...ch.steps[0], max: 2, min: 2 }] }, 'e16') })
    expect(picked.get('e16')).toEqual({ kind: 'chosen', says: GLOW_SAYS.bottomed })
    expect(picked.get('e31')).toEqual({ kind: 'target', says: GLOW_SAYS.bottomable })
  })
})

describe('when nothing glows', () => {
  it('while the engine plays its own turn, and while it is another seat\'s stop', () => {
    const engineStops = stops.filter((s) => s.status.waiting === 'engine')
    expect(engineStops.length).toBeGreaterThan(0)
    for (const { status, board } of engineStops) expect(glowsAt({ status, me: YOU, zoneOf: zoneIn(board) }).size).toBe(0)
    const play = stops.find((s) => s.status.waiting === 'action')
    expect(glowsAt({ status: play.status, me: 'e1', zoneOf: zoneIn(play.board) }).size).toBe(0)
  })

  it('once the game is over', () => {
    const play = stops.find((s) => s.status.waiting === 'action')
    expect(glowsAt({ status: { ...play.status, over: true }, me: YOU, zoneOf: zoneIn(play.board) }).size).toBe(0)
  })

  it('and it reads what an older engine or a torn message sends without throwing', () => {
    for (const status of [
      null, undefined, {}, { actor: YOU }, { actor: YOU, waiting: 'action' }, { actor: YOU, waiting: 'action', actions: 'none' },
      { actor: YOU, waiting: 'action', actions: [null, 3, 'x', { card: 7, affordable: true, meaningful: true }] },
      { actor: YOU, waiting: 'decision' }, { actor: YOU, waiting: 'decision', decision: { type: 'ChooseTargets' } },
      { actor: YOU, waiting: 'decision', decision: { type: 'ChooseTargets', requirements: [null, { legal: 'e1' }, { legal: [4, 'e2'] }] } },
      { actor: YOU, waiting: 'action', actions: [{ type: 'DeclareAttackers', meaningful: true, validAttackers: null }] },
    ]) {
      expect(() => glowsAt({ status, me: YOU })).not.toThrow()
      expect(() => unaimed(status)).not.toThrow()
    }
    expect(kinds(glowsAt({ status: { actor: YOU, waiting: 'decision', decision: { type: 'ChooseTargets', requirements: [null, { legal: 'e1' }, { legal: [4, 'e2'] }] } }, me: YOU }))).toEqual({ e2: 'target' })
  })
})
