// @vitest-environment node
/**
 * What glows at the engine's table (src/lib/engine/glow.js).
 *
 * Held against the captured run first (`tests/fixtures/engine-views.json`,
 * `scripts/engine-capture.mjs`): real statuses from a real game, with the
 * board each one belongs to rebuilt by walking the run's deltas, so the zones
 * the glow reads are the engine's and not a guess. The run holds plays, a
 * declaration of attackers, the offer to block, the engine's own stops and a
 * stop where the only play is a spell that needs a target — every kind of
 * status the glow has to read but a targets decision, which no capture has
 * reached (PLAN.md, M2), so that one is built in Server.kt's own shape.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyDelta, boardFromView } from '../src/lib/engine/board.js'
import { glowsAt, heldBack, offeredElsewhere, unaimed, unpaid, GLOW_SAYS } from '../src/lib/engine/glow.js'

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

  it('never glows a spell that needs a target, since this table cannot send one', () => {
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

  it('is held back, and does not glow, since act carries no payment and Argentum refuses it', () => {
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
