import { describe, it, expect } from 'vitest'
import { restore, newRun, snapshot } from '../src/lib/board/runner.js'
import { createBoard, invariants, upgrade, ZONES } from '../src/lib/board/model.js'
import { apply } from '../src/lib/board/reducer.js'

/**
 * A table outlives the code that wrote it.
 *
 * Somebody leaves a game running on a phone, the app deploys twice, and they
 * come back to it. This shipped broken once — a zone was added, the
 * invariants walked the new list of zones over a board saved before it
 * existed, and the screen died on a missing one — so the case has a test of
 * its own, with a real board from the build that broke.
 */

/** Exactly the shape the build before the playmat wrote. */
const BEFORE_THE_PLAYMAT = {
  version: 1,
  deckId: 'd1',
  deckName: 'Wren of the Deep Green',
  mulligans: 1,
  savedAt: '2026-09-18T06:00:00Z',
  board: {
    version: 1,
    players: ['you'],
    seed: 7,
    turn: 3,
    active: 'you',
    step: null,                         // the old step was a free label
    life: { you: 17 },
    counters: { you: { poison: 2 } },
    cards: {
      'you:0:forest': {
        id: 'you:0:forest', cardId: 'forest', owner: 'you', controller: 'you',
        zone: 'battlefield', x: 0.3, y: 0.8, tapped: true, faceDown: false,
        flipped: false, counters: {}, note: '', token: false, custom: null,
        attachedTo: null, finish: 'foil', enteredOnTurn: 1, z: 4,
        // No `lane`: the playmat did not exist yet.
      },
      'you:1:bear': {
        id: 'you:1:bear', cardId: 'bear', owner: 'you', controller: 'you',
        zone: 'hand', x: 0.5, y: 0.5, tapped: false, faceDown: false,
        flipped: false, counters: {}, note: '', token: false, custom: null,
        attachedTo: null, finish: 'normal', enteredOnTurn: 0, z: 0,
      },
    },
    zones: {
      // No `stack`: it did not exist yet either.
      you: { library: [], hand: ['you:1:bear'], battlefield: ['you:0:forest'], graveyard: [], exile: [], command: [] },
    },
    revealed: [], arrows: [], dice: [], notes: '', log: [], nextZ: 5, seq: 12, events: [],
  },
}

describe('a board saved by an older build', () => {
  it('opens, rather than taking the screen down with it', () => {
    const back = restore(BEFORE_THE_PLAYMAT)
    expect(back).not.toBe(null)
    expect(invariants(back.board)).toEqual([])
  })

  it('keeps everything the player had', () => {
    const { board } = restore(BEFORE_THE_PLAYMAT)
    expect(board).toMatchObject({ turn: 3, life: { you: 17 }, counters: { you: { poison: 2 } } })
    expect(board.cards['you:0:forest']).toMatchObject({ x: 0.3, y: 0.8, tapped: true, finish: 'foil' })
    expect(board.zones.you.battlefield).toEqual(['you:0:forest'])
    expect(board.zones.you.hand).toEqual(['you:1:bear'])
  })

  it('fills in the zones this build has and that one did not', () => {
    const { board } = restore(BEFORE_THE_PLAYMAT)
    for (const zone of ZONES) expect(Array.isArray(board.zones.you[zone]), zone).toBe(true)
    expect(board.zones.you.stack).toEqual([])
  })

  it('opens it as the bare table it was when it was saved', () => {
    const { board } = restore(BEFORE_THE_PLAYMAT)
    // The playmat did not exist, so nothing on it was ever sorted into a row.
    expect(board.guided).toBe(false)
  })

  it('puts a step it does not recognise back at the start of the turn', () => {
    const { board } = restore(BEFORE_THE_PLAYMAT)
    expect(board.step).toBe('untap')
    const odd = { ...BEFORE_THE_PLAYMAT, board: { ...BEFORE_THE_PLAYMAT.board, step: 'teatime' } }
    expect(restore(odd).board.step).toBe('untap')
  })

  it('can still be played once it is back', () => {
    const run = restore(BEFORE_THE_PLAYMAT)
    const played = apply(run.board, { type: 'move', id: 'you:1:bear', zone: 'battlefield', x: 0.6, y: 0.4 })
    expect(played.ok, played.reason?.message).toBe(true)
    expect(invariants(played.board)).toEqual([])
    const stepped = apply(played.board, { type: 'step' })
    expect(stepped.ok).toBe(true)
    expect(stepped.board.step).toBe('upkeep')
  })

  it('drops a save it cannot make sense of instead of breaking', () => {
    expect(restore(null)).toBe(null)
    expect(restore({ version: 99, board: BEFORE_THE_PLAYMAT.board })).toBe(null)
    // Truncated by a full disk, edited by hand, written by a build that does
    // not exist yet: none of these are worth losing the app over.
    expect(restore({ version: 1, board: { players: ['you'], zones: null, cards: 'nonsense' } })).toBe(null)
    expect(restore('not json at all')).toBe(null)
  })

  it('opens a board that is merely empty rather than dropping it', () => {
    // Nothing is lost by opening this: an empty table is what the player sees
    // anyway, and dropping it would throw away the seat they had chosen.
    const run = restore({ version: 1, board: { players: ['you'] } })
    expect(run.board.players).toEqual(['you'])
    expect(run.board.zones.you.hand).toEqual([])
    expect(invariants(run.board)).toEqual([])
  })

  it('round-trips a board this build wrote, unchanged', () => {
    const run = newRun(createBoard({ seed: 3 }))
    const dealt = apply(run.board, { type: 'seat', cards: ['forest', 'bear'], lanes: { forest: 'lands', bear: 'creatures' } })
    const saved = JSON.parse(JSON.stringify(snapshot({ ...run, board: dealt.board }, { deckId: 'd1' })))
    expect(restore(saved).board).toEqual(dealt.board)
  })

  it('upgrades a board with a player who has no zones at all', () => {
    const half = upgrade({ players: ['you', 'them'], zones: { you: { library: ['a'] } }, cards: {}, life: { you: 20 } })
    expect(Object.keys(half.zones)).toEqual(['you', 'them'])
    expect(half.zones.them.battlefield).toEqual([])
    expect(half.zones.you.library).toEqual(['a'])
  })
})
