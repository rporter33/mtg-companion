import { describe, it, expect } from 'vitest'
import {
  createGame, logLife, logCommanderDamage, logCounter, logConcede, undo,
  deriveState, advanceTurn, nextPhase, gameIsOver, winnerOf, PHASES, describeLog,
} from '../src/lib/game.js'

const four = () => createGame({ formatId: 'commander', playerCount: 4 })
const duel = () => createGame({ formatId: 'modern', playerCount: 2 })

describe('starting state', () => {
  it('takes starting life from the format', () => {
    expect(createGame({ formatId: 'commander' }).startingLife).toBe(40)
    expect(createGame({ formatId: 'modern' }).startingLife).toBe(20)
    expect(createGame({ formatId: 'brawl' }).startingLife).toBe(25)
    expect(createGame({ formatId: 'oathbreaker' }).startingLife).toBe(20)
  })

  it('only tracks commander damage in formats that use it', () => {
    expect(createGame({ formatId: 'commander' }).commanderDamageThreshold).toBe(21)
    expect(createGame({ formatId: 'modern' }).commanderDamageThreshold).toBeNull()
    expect(createGame({ formatId: 'oathbreaker' }).commanderDamageThreshold).toBeNull()
  })
})

describe('life as a folded log', () => {
  it('derives life from the log rather than storing it', () => {
    let game = four()
    game = logLife(game, 0, -3)
    game = logLife(game, 0, -5)
    game = logLife(game, 0, +2)
    expect(deriveState(game)[0].life).toBe(34)
  })

  it('undoes exactly one change at a time', () => {
    let game = duel()
    game = logLife(game, 0, -10)
    game = logLife(game, 0, -5)
    expect(deriveState(game)[0].life).toBe(5)
    game = undo(game)
    expect(deriveState(game)[0].life).toBe(10)
    game = undo(game)
    expect(deriveState(game)[0].life).toBe(20)
  })

  it('is a no-op to undo an empty log', () => {
    const game = duel()
    expect(undo(game).log).toHaveLength(0)
  })
})

describe('commander damage', () => {
  it('reduces life and tracks the source in one entry', () => {
    // The classic paper mistake is these two drifting apart.
    let game = four()
    game = logCommanderDamage(game, 0, 1, 7)
    const state = deriveState(game)[0]
    expect(state.life).toBe(33)
    expect(state.commanderDamage[1]).toBe(7)
  })

  it('kills at 21 from a single commander, not 21 spread across two', () => {
    let game = four()
    game = logCommanderDamage(game, 0, 1, 11)
    game = logCommanderDamage(game, 0, 2, 10)
    const state = deriveState(game)[0]
    expect(state.life).toBe(19)   // still alive on life
    expect(state.out).toBeNull()  // and 11 + 10 from different commanders is not lethal

    game = logCommanderDamage(game, 0, 1, 10) // now 21 from player 1
    expect(deriveState(game)[0].out).toMatch(/commander damage/)
  })

  it('does not apply the commander damage rule in non-commander formats', () => {
    let game = duel()
    game = logCommanderDamage(game, 0, 1, 21)
    // 21 damage at 20 life kills on life total, but not via the commander rule.
    expect(deriveState(game)[0].out).toBe('At 0 life')
  })
})

describe('loss conditions', () => {
  it('loses at exactly 0 life, not below', () => {
    let game = duel()
    game = logLife(game, 0, -20)
    expect(deriveState(game)[0].out).toBe('At 0 life')
  })

  it('loses at ten poison counters', () => {
    let game = four()
    game = logCounter(game, 0, 'poison', 9)
    expect(deriveState(game)[0].out).toBeNull()
    game = logCounter(game, 0, 'poison', 1)
    expect(deriveState(game)[0].out).toMatch(/poison/)
  })

  it('never lets a counter go negative', () => {
    let game = four()
    game = logCounter(game, 0, 'energy', 2)
    game = logCounter(game, 0, 'energy', -5)
    expect(deriveState(game)[0].counters.energy).toBe(0)
  })

  it('records a concession', () => {
    let game = four()
    game = logConcede(game, 2)
    expect(deriveState(game)[2].out).toBe('Conceded')
  })
})

describe('turn and phase', () => {
  it('walks the phases then rolls to the next player', () => {
    let game = four()
    for (let i = 0; i < PHASES.length - 1; i++) game = nextPhase(game)
    expect(game.phase).toBe(PHASES.length - 1)
    expect(game.activePlayer).toBe(0)
    game = nextPhase(game)
    expect(game.activePlayer).toBe(1)
    expect(game.phase).toBe(0)
    expect(game.turn).toBe(1) // turn number only advances on wrap
  })

  it('increments the turn counter when play wraps to the first player', () => {
    let game = four()
    for (let i = 0; i < 4; i++) game = advanceTurn(game)
    expect(game.activePlayer).toBe(0)
    expect(game.turn).toBe(2)
  })

  it('skips players who are out', () => {
    let game = four()
    game = logConcede(game, 1)
    game = advanceTurn(game)
    expect(game.activePlayer).toBe(2)
  })

  it('stops advancing once one player is left', () => {
    let game = four()
    game = logConcede(game, 1)
    game = logConcede(game, 2)
    game = logConcede(game, 3)
    const before = game.activePlayer
    expect(advanceTurn(game).activePlayer).toBe(before)
  })
})

describe('game end', () => {
  it('reports the last player standing', () => {
    let game = four()
    game = logConcede(game, 1)
    game = logConcede(game, 2)
    expect(gameIsOver(game)).toBe(false)
    game = logLife(game, 3, -40)
    expect(gameIsOver(game)).toBe(true)
    expect(winnerOf(game).id).toBe(0)
  })
})

describe('describeLog', () => {
  it('reads back as plain sentences, newest first', () => {
    let game = four()
    game = logLife(game, 0, -3)
    game = logCommanderDamage(game, 1, 0, 5)
    const lines = describeLog(game)
    expect(lines[0].text).toBe('Player 2 took 5 commander damage from Player 1')
    expect(lines[1].text).toBe('Player 1 lost 3 life')
  })
})
