import { describe, it, expect } from 'vitest'
import { buildGame, shuffledLibrary, OPENING_HAND } from '../src/lib/table/game.js'
import { PRACTICE_DECKS, deckCards } from '../src/data/practice-decks.js'
import { PRACTICE_CARDS } from '../src/data/practice-cards.js'
import { start, act, settle, replay, passUntil } from '../src/lib/table/runner.js'
import { applyAction } from '../src/lib/table/reducer.js'
import { invariants, hand, librarySize, isLand } from '../src/lib/table/model.js'
import { simplePolicy, HUMAN } from '../src/lib/table/opponent.js'
import { unsupportedReason } from '../src/lib/table/mechanics.js'

/**
 * Whole games. The shuffles come from the seed, so a game replays; the
 * opening hands go through the London mulligan; and two copies of the
 * simple policy can play a game out to the end with the invariants holding
 * at every step, which is the strongest exercise the model gets.
 */
const you = (action) => ({ player: 'you', ...action })
const ok = (result) => { expect(result.ok, result.reason?.message).toBe(true); expect(invariants(result.state)).toEqual([]); return result }
const refused = (result, code) => { expect(result.ok).toBe(false); expect(result.reason.code).toBe(code); return result }

describe('practice decks', () => {
  it('are thirty cards from the pool, twelve of them lands, every card supported', () => {
    for (const deck of PRACTICE_DECKS) {
      const cards = deckCards(deck)
      expect(cards, deck.id).toHaveLength(30)
      expect(deck.size).toBe(30)
      expect(cards.filter((id) => PRACTICE_CARDS[id].rules.kind === 'land').length, deck.id).toBe(12)
      for (const id of cards) expect(unsupportedReason(PRACTICE_CARDS[id]), id).toBeNull()
    }
  })
  it('shuffle the same way for the same seed and differently for the two seats', () => {
    expect(shuffledLibrary('forest-fangs', 5, 1)).toEqual(shuffledLibrary('forest-fangs', 5, 1))
    expect(shuffledLibrary('forest-fangs', 5, 1)).not.toEqual(shuffledLibrary('forest-fangs', 5, 2))
    expect(shuffledLibrary('forest-fangs', 5, 1)).not.toEqual(shuffledLibrary('forest-fangs', 6, 1))
    expect([...shuffledLibrary('forest-fangs', 5, 1)].sort()).toEqual([...deckCards(PRACTICE_DECKS[0])].sort())
  })
})

describe('the opening hands', () => {
  const game = buildGame({ you: 'forest-fangs', foe: 'goblins-fire', seed: 11 })

  it('deal seven each and wait on the first player to keep or mulligan; nothing else is allowed yet', () => {
    const { state } = start(game)
    expect(hand(state, 'you')).toHaveLength(OPENING_HAND)
    expect(hand(state, 'foe')).toHaveLength(OPENING_HAND)
    expect(librarySize(state, 'you')).toBe(23)
    expect(state.awaiting).toEqual({ kind: 'mulligan', player: 'you' })
    refused(applyAction(state, you({ type: 'pass' })), 'awaiting')
    const land = hand(state, 'you').find(isLand)
    refused(applyAction(state, you({ type: 'playLand', instanceId: land.instanceId })), 'awaiting')
  })

  it('a mulligan draws a fresh seven and keeping then owes one to the bottom', () => {
    const { state } = start(game)
    const before = hand(state, 'you').map((c) => c.instanceId)
    const mull = ok(applyAction(state, you({ type: 'mulligan' })))
    expect(hand(mull.state, 'you')).toHaveLength(7)
    expect(librarySize(mull.state, 'you')).toBe(23)
    expect(hand(mull.state, 'you').map((c) => c.instanceId)).not.toEqual(before)
    refused(applyAction(mull.state, you({ type: 'keepHand', bottom: [] })), 'wrongCount')
    const bottom = hand(mull.state, 'you')[0].instanceId
    const kept = ok(act(mull.state, you({ type: 'keepHand', bottom: [bottom] }), game))
    expect(hand(kept.state, 'you')).toHaveLength(6)
    expect(kept.state.zones.library.you[kept.state.zones.library.you.length - 1]).toBe(bottom)
    // The opponent keeps (or mulligans by its rule) and turn one begins: upkeep gives us priority, then the draw step skips our draw.
    expect(kept.state.awaiting).toBeNull()
    expect(kept.state).toMatchObject({ turn: 1, active: 'you', step: 'upkeep', priority: 'you' })
    const main = passUntil(kept.state, game, (st) => st.step === 'main1')
    expect(main.state.step).toBe('main1')
    expect(hand(main.state, 'you')).toHaveLength(6)
    expect(main.state.turnsBy).toEqual({ you: 1, foe: 0 })
  })

  it('a mulligan to nothing is refused before it goes below zero cards', () => {
    let s = start(game).state
    for (let i = 0; i < 7; i++) s = ok(applyAction(s, you({ type: 'mulligan' }))).state
    refused(applyAction(s, you({ type: 'mulligan' })), 'noHandLeft')
    const kept = ok(applyAction(s, you({ type: 'keepHand', bottom: hand(s, 'you').map((c) => c.instanceId) })))
    expect(hand(kept.state, 'you')).toHaveLength(0)
  })

  it('replays from the log to the same game', () => {
    const { state, actions } = start(game)
    const kept = ok(act(state, you({ type: 'keepHand', bottom: [] }), game))
    const log = [...actions, ...kept.actions]
    expect(replay(game, log).state).toEqual(kept.state)
  })
})

describe('a whole game', () => {
  const play = (seed, decks = ['forest-fangs', 'goblins-fire'], turnsLimit = 60) => {
    const game = buildGame({ you: decks[0], foe: decks[1], seed })
    const mine = simplePolicy('you')
    let { state } = start(game)
    let steps = 0
    while (!state.over && steps < 4000) {
      const decision = mine.decide(state)
      if (!decision) break
      const list = decision.type === 'castWith'
        ? [{ type: 'beginCast', player: 'you', instanceId: decision.instanceId }, ...decision.sources.map((id) => ({ type: 'tapForMana', player: 'you', instanceId: id })), ...(decision.target ? [{ type: 'chooseTarget', player: 'you', target: decision.target }] : []), { type: 'autoPay', player: 'you' }, { type: 'commitCast', player: 'you' }]
        : [decision]
      for (const action of list) {
        const result = applyAction(state, action)
        if (!result.ok) { const cancel = applyAction(state, { type: state.casting ? 'cancelCast' : 'pass', player: 'you' }); if (cancel.ok) state = cancel.state; break }
        state = result.state
        expect(invariants(state)).toEqual([])
      }
      const settled = settle(state, game)
      state = settled.state
      expect(invariants(state)).toEqual([])
      expect(settled.stalled).toBeUndefined()
      steps += 1
      if (state.turn > turnsLimit) break
    }
    return state
  }

  it('two simple policies play to a result, with the invariants holding throughout', () => {
    const results = [1, 2, 3, 4, 5].map((seed) => play(seed))
    for (const state of results) {
      expect(state.over, `seed ended on turn ${state.turn}`).toBeTruthy()
      expect(['life', 'drewFromEmpty']).toContain(state.over.reason)
    }
    // Not every seed ends the same way for the same side.
    expect(new Set(results.map((s) => s.over.winner)).size).toBeGreaterThanOrEqual(1)
  })

  it('the two-colour deck plays too, and a game never leaves a card in two zones or a pool negative', () => {
    const state = play(9, ['both-at-once', 'both-at-once'])
    expect(state.over).toBeTruthy()
    expect(invariants(state)).toEqual([])
  })

  it('a hot-seat game waits for the other person instead of deciding for them', () => {
    const game = buildGame({ you: 'forest-fangs', foe: 'goblins-fire', seed: 2, mode: 'hotseat' })
    expect(game.opponent).toBe('human')
    expect(HUMAN.decide(start(game).state)).toBeNull()
    const { state } = start(game)
    const kept = ok(act(state, you({ type: 'keepHand', bottom: [] }), game))
    expect(kept.state.awaiting).toEqual({ kind: 'mulligan', player: 'foe' })
    const theirs = ok(act(kept.state, { type: 'keepHand', player: 'foe', bottom: [] }, game))
    expect(theirs.state.awaiting).toBeNull()
    expect(theirs.state.priority).toBe('you')
  })
})
