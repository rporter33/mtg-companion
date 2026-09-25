/**
 * What a table the engine holds says when its game comes back (M7): while it
 * is coming back, and once it is. The words are the app's own about what the
 * room reports, so what is held here is that each case is said as what it is,
 * and that anything a relay of another age might send is read without a guess.
 */
import { describe, it, expect } from 'vitest'
import { restartOf, restoredLines, restoringLine } from '../src/lib/engine/restart.js'

describe('a game coming back', () => {
  it('says which restarted, and that nothing pressed will happen until it is back', () => {
    expect(restoringLine('relay')).toBe('The relay restarted, and this game is coming back as it was at the last stop. Nothing you press will happen until it is back.')
    expect(restoringLine('engine')).toBe('The engine stopped, and is starting again with this game as it was at the last stop. Nothing you press will happen until it is back.')
  })

  it('takes a reason it does not know as the relay\'s, since only the engine\'s is said as the engine\'s', () => {
    for (const reason of [undefined, null, 'deploy', 7, {}]) {
      expect(restartOf(reason)).toBe('relay')
      expect(restoringLine(reason)).toBe(restoringLine('relay'))
    }
  })
})

describe('a game come back', () => {
  it('says which restarted and that the table is as it was at the last stop', () => {
    expect(restoredLines({ reason: 'relay', behind: 0 })).toEqual(['The relay restarted; the table is as it was at the last stop.'])
    // The brief's own words for an engine that stopped (HANDOFF.md, M7).
    expect(restoredLines({ reason: 'engine', behind: 0 })).toEqual(['The engine restarted; the table is as it was at the last stop.'])
  })

  it('says so when the table is a stop or more behind what this person last saw', () => {
    expect(restoredLines({ reason: 'relay', behind: 1 })).toEqual(['The relay restarted; the table is as it was one stop before the last you saw, the last one it had saved.'])
    expect(restoredLines({ reason: 'engine', behind: 3 })).toEqual(['The engine restarted; the table is as it was 3 stops before the last you saw, the last one it had saved.'])
  })

  it('tells the person whose move or answer was not saved when the relay restarted what became of it, and that it is theirs to make again', () => {
    expect(restoredLines({ reason: 'relay', behind: 0, lost: 'act' })).toEqual([
      'The relay restarted; the table is as it was at the last stop.',
      'Your last move was not saved in time, so the table is as it was before it: make it again if you still want to.',
    ])
    expect(restoredLines({ reason: 'relay', behind: 0, lost: 'decide' })).toEqual([
      'The relay restarted; the table is as it was at the last stop.',
      'Your last answer was not saved in time, so the question is put to you again.',
    ])
  })

  it('says a move lost when the engine stopped as the engine stopping over it, and that the same move again may end the game', () => {
    // The room starts an engine again only once before the game has gone on, so
    // "make it again" would invite the stop that ends it (M7's review).
    expect(restoredLines({ reason: 'engine', behind: 0, lost: 'act' })).toEqual([
      'The engine restarted; the table is as it was at the last stop.',
      'The engine stopped while it was answering your last move, so the table is as it was before it. If it stops again before the game has gone on, the game ends there, so making the same move again may end it.',
    ])
    expect(restoredLines({ reason: 'engine', behind: 1, lost: 'decide' })).toEqual([
      'The engine restarted; the table is as it was one stop before the last you saw, the last one it had saved.',
      'The engine stopped while it was taking your last answer, so the question is put to you again. If it stops again before the game has gone on, the game ends there, so giving the same answer again may end it.',
    ])
    expect(restoredLines({ reason: 'engine', behind: 0, lost: 'act' }).join(' ')).not.toMatch(/if you still want to/)
  })

  it('reads a relay of any age forgivingly: no number is none, and a loss it does not know is not claimed', () => {
    const plain = ['The relay restarted; the table is as it was at the last stop.']
    expect(restoredLines(undefined)).toEqual(plain)
    expect(restoredLines('restored')).toEqual(plain)
    expect(restoredLines({ behind: 'two', lost: 'fly' })).toEqual(plain)
    expect(restoredLines({ behind: -1 })).toEqual(plain)
    expect(restoredLines({ behind: 1.5 })).toEqual(plain)
  })
})
