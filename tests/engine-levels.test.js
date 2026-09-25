/**
 * The engine's levels as the app names them (src/lib/engine/levels.js).
 *
 * Three words, one default the owner chose, and a reading of whatever storage
 * or a relay hands back that never guesses: a word this build does not know
 * is no level. And the log's one line about the level says what the engine is
 * really playing at, in each of the ways a room can answer.
 */
import { describe, it, expect } from 'vitest'
import { chosenLevel, DEFAULT_LEVEL, LEVEL_LINES, LEVEL_NAMES, LEVELS, LEVELS_MEASURED, levelLine, levelOf, roomLevel } from '../src/lib/engine/levels.js'

describe('the levels', () => {
  it('are easy, intermediate and hard, weakest first, and a first game is intermediate', () => {
    expect(LEVELS).toEqual(['easy', 'intermediate', 'hard'])
    // The owner's answer to M3's question, 2026-09-24 (HANDOFF.md §3).
    expect(DEFAULT_LEVEL).toBe('intermediate')
    expect(Object.keys(LEVEL_NAMES)).toEqual(LEVELS)
    expect(Object.keys(LEVEL_LINES)).toEqual(LEVELS)
  })

  it('reads a level forgivingly, from storage or the wire, and never guesses one', () => {
    expect(levelOf('hard')).toBe('hard')
    for (const junk of ['Hard', 'expert', '', null, undefined, 3, {}, ['easy']]) expect(levelOf(junk)).toBeNull()
    expect(chosenLevel('easy')).toBe('easy')
    // Nothing kept, or something no build of this app wrote: the default.
    expect(chosenLevel(undefined)).toBe('intermediate')
    expect(chosenLevel('grandmaster')).toBe('intermediate')
  })

  it('says, on screen, that its descriptions are measured rather than claimed', () => {
    // Every level's line says how long it takes, which was measured; the
    // strength claims live in one sentence that carries its date.
    expect(LEVELS_MEASURED).toMatch(/^Measured here on \d{1,2} [A-Z][a-z]+ 20\d\d/)
    for (const l of LEVELS) expect(LEVEL_LINES[l].length).toBeGreaterThan(20)
  })
})

describe('the log\'s line about the level', () => {
  it('names the level the engine took, and only that one', () => {
    expect(levelLine('hard', 'hard')).toBe('The engine is playing at the hard level.')
    expect(levelLine('easy', null)).toBe('The engine is playing at the easy level.')
    // Chosen again since the deal, on a reload: the game keeps its own.
    expect(levelLine('easy', 'hard')).toMatch(/^The engine is playing at the easy level, the one this table was dealt at; the hard level you have chosen since is for your next table\.$/)
  })

  it('says an older engine plays its one way, not the level chosen', () => {
    expect(levelLine(null, 'hard')).toBe("This relay's engine is older than the levels and plays one way only, so it is not playing at the hard level you chose.")
    expect(levelLine(null, null)).toBe("This relay's engine is older than the levels and plays one way only.")
  })

  it('does not name a level it has no word for, from a relay newer than this app', () => {
    expect(levelLine('grandmaster', 'hard')).toBe('The engine is playing at a level this version of the app has no name for.')
    expect(levelLine(7, 'hard')).toBe('The engine is playing at a level this version of the app has no name for.')
  })

  it('says an older relay never asked for one', () => {
    expect(levelLine(undefined, 'intermediate')).toBe('This relay is older than the levels, so the engine plays the one way it always has there, not at the intermediate level you chose.')
    expect(levelLine(undefined, null)).toBeNull()
  })
})

describe('what a lobby can say of a table the engine holds', () => {
  it('offers the choice before anything is started', () => {
    expect(roomLevel({ started: false, level: 'hard' })).toEqual({ stage: 'open', level: 'hard' })
    expect(roomLevel(null)).toEqual({ stage: 'open', level: null })
  })

  it('says the engine is dealing while it loads, at the level asked, not that the game is under way', () => {
    // Found in M3's review: the engine process is started some seconds before
    // the deal, and a lobby that read "started" as dealt said the game was under
    // way, one way only, while the corpus loaded.
    expect(roomLevel({ started: true, dealt: false, level: 'hard' })).toEqual({ stage: 'dealing', level: 'hard' })
    // A room from M3 itself, which has no `dealt`: it names what was played only once dealt.
    expect(roomLevel({ started: true, level: 'hard' })).toEqual({ stage: 'dealing', level: 'hard' })
  })

  it('says the game is under way at the level the engine took, or at none', () => {
    expect(roomLevel({ started: true, dealt: true, level: 'hard', played: 'hard' })).toEqual({ stage: 'dealt', level: 'hard' })
    expect(roomLevel({ started: true, level: 'hard', played: null })).toEqual({ stage: 'dealt', level: null })
    // A relay from before levels says neither, and "started" is all there is.
    expect(roomLevel({ started: true })).toEqual({ stage: 'dealt', level: null })
    expect(roomLevel({ started: true, dealt: true, played: 'grandmaster' })).toEqual({ stage: 'dealt', level: null })
  })
})
