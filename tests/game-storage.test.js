import { describe, it, expect, beforeEach } from 'vitest'
import {
  getGameTable, saveGameTable, clearGameTable, getTable, saveTable, loadState, useBackend,
} from '../src/lib/storage.js'
import { memoryBackend } from '../src/lib/storage-backend.js'

/**
 * The rebuilt table keeps its own board.
 *
 * Two tables, one slot, would mean starting a game at #/game silently threw
 * away a game left in progress at #/table. So the new one has a slot of its
 * own, defaulted the same forgiving way: a file written before the slot
 * existed reads as "nothing saved", never as a missing key.
 */
const ROOT = 'mtg-companion:v1'
const board = (deckId) => ({ version: 1, deckId, board: { players: ['you'] } })

// A fresh backend each time: storage is read once and cached, so clearing
// localStorage alone would leave the last test's board in memory.
let backend
beforeEach(() => { backend = useBackend(memoryBackend()) })

describe('the rebuilt table\'s slot', () => {
  it('is empty until something is saved', () => {
    expect(getGameTable()).toBe(null)
  })

  it('keeps one board, and gives it back', () => {
    saveGameTable(board('d1'))
    expect(getGameTable()).toEqual(board('d1'))
    clearGameTable()
    expect(getGameTable()).toBe(null)
  })

  it('leaves the free table\'s board alone, and is left alone by it', () => {
    saveTable(board('old'))
    saveGameTable(board('new'))
    expect(getTable()).toEqual(board('old'))
    expect(getGameTable()).toEqual(board('new'))
    saveTable(null)
    expect(getGameTable()).toEqual(board('new'))
  })

  it('reads a file written before the slot existed', () => {
    backend.write(ROOT, JSON.stringify({ version: 4, decks: [], table: { saved: board('old') } }))
    useBackend(backend)
    expect(loadState().game).toEqual({ saved: null })
    expect(getGameTable()).toBe(null)
    expect(getTable()).toEqual(board('old'))
  })
})
