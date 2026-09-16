import { describe, it, expect, beforeEach } from 'vitest'
import { memoryBackend, localStorageBackend } from '../src/lib/storage-backend.js'
import {
  useBackend, backendName, loadState, saveDeck, listDecks, deleteDeck,
  markLessonComplete, getGuideProgress, exportAll, importAll, clearAll, setPref, getPrefs,
} from '../src/lib/storage.js'
import { createDeck } from '../src/lib/deck.js'

beforeEach(() => {
  useBackend(memoryBackend())
  clearAll()
})

describe('backend interface', () => {
  it('round-trips through the memory backend', () => {
    const b = memoryBackend()
    expect(b.read()).toBeNull()
    expect(b.write('hello')).toBe(true)
    expect(b.read()).toBe('hello')
    b.remove()
    expect(b.read()).toBeNull()
  })

  it('survives a localStorage that throws on every access', () => {
    // Safari private mode: the object exists, the write throws.
    const hostile = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('quota') },
      removeItem() { throw new Error('denied') },
    }
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: hostile, configurable: true })
    try {
      const b = localStorageBackend('k')
      expect(b.read()).toBeNull()
      expect(b.write('x')).toBe(false)
      expect(() => b.remove()).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })

  it('reports which backend is in use', () => {
    useBackend(memoryBackend())
    expect(backendName()).toBe('memory')
  })
})

describe('app state survives an unwritable backend', () => {
  it('keeps working for the session when writes fail', () => {
    // Durability is lost across a reload; the session is not.
    useBackend({ name: 'readonly', read: () => null, write: () => false, remove() {} })
    const deck = createDeck({ name: 'Ephemeral', formatId: 'modern' })
    saveDeck(deck)
    expect(listDecks().map((d) => d.name)).toContain('Ephemeral')
  })
})

describe('decks', () => {
  it('saves, updates in place, and deletes', () => {
    const deck = createDeck({ name: 'Test', formatId: 'modern' })
    saveDeck(deck)
    expect(listDecks()).toHaveLength(1)

    saveDeck({ ...deck, name: 'Renamed' })
    expect(listDecks()).toHaveLength(1)
    expect(listDecks()[0].name).toBe('Renamed')

    deleteDeck(deck.id)
    expect(listDecks()).toHaveLength(0)
  })
})

describe('guide progress', () => {
  it('does not double-record a completed lesson', () => {
    markLessonComplete('goal')
    markLessonComplete('goal')
    expect(getGuideProgress().completedLessons).toEqual(['goal'])
  })
})

describe('export and import', () => {
  it('round-trips a full export', () => {
    saveDeck(createDeck({ name: 'Mine', formatId: 'commander' }))
    markLessonComplete('turn')
    const json = exportAll()

    clearAll()
    expect(listDecks()).toHaveLength(0)

    importAll(json)
    expect(listDecks().map((d) => d.name)).toEqual(['Mine'])
    expect(getGuideProgress().completedLessons).toContain('turn')
  })

  it('keeps both decks when an import collides with a local one', () => {
    // An imported deck must never silently overwrite work done locally.
    const deck = createDeck({ name: 'Original', formatId: 'modern' })
    saveDeck(deck)
    const json = JSON.stringify({ decks: [{ ...deck, name: 'Theirs' }] })

    importAll(json)
    const names = listDecks().map((d) => d.name).sort()
    expect(names).toEqual(['Original', 'Theirs (imported)'])
  })

  it('replaces wholesale only when asked', () => {
    saveDeck(createDeck({ name: 'Original', formatId: 'modern' }))
    const other = createDeck({ name: 'Theirs', formatId: 'modern' })
    importAll(JSON.stringify({ decks: [other] }), { replace: true })
    expect(listDecks().map((d) => d.name)).toEqual(['Theirs'])
  })

  it('rejects a file that is not an export, with a readable message', () => {
    expect(() => importAll('not json')).toThrow(/not valid JSON/i)
    expect(() => importAll('{"hello":1}')).toThrow(/does not look like/i)
  })
})

describe('prefs', () => {
  it('merges new prefs over defaults rather than replacing them', () => {
    setPref('currency', 'eur')
    const prefs = getPrefs()
    expect(prefs.currency).toBe('eur')
    expect(prefs.showCardImages).toBe(true) // default preserved
  })

  it('tolerates state written by an older build that lacks a section', () => {
    useBackend(memoryBackend(JSON.stringify({ version: 1, decks: [] })))
    const state = loadState()
    expect(state.guide.completedLessons).toEqual([])
    expect(state.prefs.currency).toBe('usd')
  })
})
