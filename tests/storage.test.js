import { describe, it, expect, beforeEach } from 'vitest'
import { memoryBackend, localStorageBackend } from '../src/lib/storage-backend.js'
import {
  useBackend, backendName, loadState, saveDeck, listDecks, deleteDeck,
  markLessonComplete, saveTutorialState, getPractice, savePracticeRun, clearPracticeRun, markPaperPractice, recordEvidence, resetPractice, PRACTICE_LOG_LIMIT, getGuideProgress, exportAll, importAll, clearAll, setPref, getPrefs,
} from '../src/lib/storage.js'
import { createDeck } from '../src/lib/deck.js'

beforeEach(() => {
  useBackend(memoryBackend())
  clearAll()
})

describe('backend interface', () => {
  it('round-trips through the memory backend', () => {
    const b = memoryBackend()
    expect(b.read('k')).toBeNull()
    expect(b.write('k', 'hello')).toBe(true)
    expect(b.read('k')).toBe('hello')
    expect(b.keys()).toEqual(['k'])
    b.remove('k')
    expect(b.read('k')).toBeNull()
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
      expect(b.read('k')).toBeNull()
      expect(b.write('k', 'x')).toBe(false)
      expect(() => b.remove('k')).not.toThrow()
      expect(b.keys()).toEqual([])
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

describe('practice', () => {
  it('saves a run as its log, bounded, and clears it', () => {
    savePracticeRun('mana-guided', { log: Array.from({ length: 500 }, (_, i) => ({ type: 'pass', i })), hints: ['h'], explained: { index: 0, correct: true } })
    const run = getPractice().runs['mana-guided']
    expect(run.log).toHaveLength(PRACTICE_LOG_LIMIT)
    expect(run.log[0].i).toBe(100)
    expect(run.hints).toEqual(['h'])
    expect(run.version).toBe(1)
    clearPracticeRun('mana-guided')
    expect(getPractice().runs['mana-guided']).toBeUndefined()
  })
  it('records paper practice as self-reported and evidence once, never overwriting an earlier date', () => {
    markPaperPractice('mana-guided')
    expect(getPractice().paper['mana-guided'].selfReported).toBe(true)
    markPaperPractice('mana-guided', false)
    expect(getPractice().paper['mana-guided']).toBeUndefined()
    recordEvidence('mana-first-creature', 'viewed', { scenarioId: 'a' })
    const first = getPractice().evidence['mana-first-creature'].viewed
    recordEvidence('mana-first-creature', 'viewed', { scenarioId: 'b' })
    expect(getPractice().evidence['mana-first-creature'].viewed).toEqual(first)
    recordEvidence('mana-first-creature', 'demonstrated')
    expect(Object.keys(getPractice().evidence['mana-first-creature']).sort()).toEqual(['demonstrated', 'viewed'])
  })
  it('resets practice alone', () => {
    saveDeck(createDeck({ name: 'Keep me', formatId: 'commander' }))
    markLessonComplete('goal')
    savePracticeRun('x', { log: [{ type: 'pass' }] })
    resetPractice()
    expect(getPractice()).toEqual({ runs: {}, paper: {}, evidence: {} })
    expect(listDecks()).toHaveLength(1)
    expect(getGuideProgress().completedLessons).toEqual(['goal'])
  })
  it('merges on import: later run wins, paper and evidence are unioned', () => {
    savePracticeRun('a', { log: [{ type: 'pass' }], savedAt: '2026-01-02T00:00:00Z' })
    savePracticeRun('b', { log: [{ type: 'pass' }], savedAt: '2026-01-09T00:00:00Z' })
    markPaperPractice('a')
    recordEvidence('lesson', 'viewed')
    const json = exportAll()
    clearAll()
    savePracticeRun('a', { log: [{ type: 'pass' }, { type: 'pass' }], savedAt: '2026-01-05T00:00:00Z' })
    savePracticeRun('b', { log: [{ type: 'pass' }, { type: 'pass' }, { type: 'pass' }], savedAt: '2026-01-01T00:00:00Z' })
    markPaperPractice('c')
    recordEvidence('lesson', 'practiced')
    importAll(json)
    const practice = getPractice()
    expect(practice.runs.a.log).toHaveLength(2) // local is later
    expect(practice.runs.b.log).toHaveLength(1) // incoming is later
    expect(Object.keys(practice.paper).sort()).toEqual(['a', 'c'])
    expect(Object.keys(practice.evidence.lesson).sort()).toEqual(['practiced', 'viewed'])
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

  it('keeps a place in the guided game across a merge, preferring this device\'s own', () => {
    saveTutorialState('t3-stack')
    const json = exportAll()
    clearAll()
    importAll(json)
    expect(getGuideProgress().tutorialState).toBe('t3-stack')
    saveTutorialState('t5-wurm')
    importAll(json)
    expect(getGuideProgress().tutorialState).toBe('t5-wurm')
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
