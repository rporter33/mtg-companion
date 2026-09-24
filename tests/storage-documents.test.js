import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useBackend, saveDeck, listDecks, deleteDeck, loadState, update, exportAll, importAll,
  clearAll, corruptBackup, discardCorruptBackup, setPref, getPrefs, STORAGE_CHANGED_EVENT, DECK_SAVED_EVENT,
} from '../src/lib/storage.js'
import { memoryBackend } from '../src/lib/storage-backend.js'

/**
 * Decks are documents of their own. The root holds the small whole-app
 * things; each deck sits under its own key with its own updatedAt. This is
 * the layout a sync backend needs, and it is also why a quantity tap no
 * longer rewrites every deck.
 */
const ROOT = 'mtg-companion:v1'
const deckKey = (id) => `${ROOT}:deck:${id}`
const deck = (id, over = {}) => ({
  id, name: id, formatId: 'commander', commanders: [], main: [{ cardId: 'x', quantity: 1 }], sideboard: [],
  categoryOrder: [], versions: [], createdAt: `2026-01-0${id.slice(-1)}T00:00:00Z`, updatedAt: '2026-02-01T00:00:00Z', ...over,
})

/** A backend that records every write, so a test can say what a save touched. */
const recording = () => {
  const inner = memoryBackend()
  const writes = []
  return { backend: { ...inner, write(key, v) { writes.push(key); return inner.write(key, v) } }, inner, writes }
}

beforeEach(() => { localStorage.clear(); discardCorruptBackup() })

describe('the layout', () => {
  it('stores each deck under its own key and keeps decks out of the root', () => {
    const { backend, inner } = recording()
    useBackend(backend)
    saveDeck(deck('d1'))
    saveDeck(deck('d2'))
    expect(inner.keys().sort()).toEqual([ROOT, deckKey('d1'), deckKey('d2')].sort())
    expect(JSON.parse(inner.read(ROOT)).decks).toBeUndefined()
    expect(JSON.parse(inner.read(deckKey('d1'))).name).toBe('d1')
  })

  it('a save writes only the deck that changed', () => {
    const { backend, writes } = recording()
    useBackend(backend)
    saveDeck(deck('d1'))
    saveDeck(deck('d2'))
    writes.length = 0
    saveDeck({ ...deck('d2'), name: 'renamed' })
    expect(writes).toEqual([deckKey('d2')])
  })

  it('a preference change writes only the root', () => {
    const { backend, writes } = recording()
    useBackend(backend)
    saveDeck(deck('d1'))
    writes.length = 0
    setPref('market', 'eur')
    expect(writes).toEqual([ROOT])
  })

  it('deleting a deck removes its key', () => {
    const { backend, inner } = recording()
    useBackend(backend)
    saveDeck(deck('d1'))
    deleteDeck('d1')
    expect(inner.keys()).toEqual([ROOT])
    expect(listDecks()).toEqual([])
  })

  it('deleting a deck forgets which of its sections was open, and no other deck\u2019s', () => {
    useBackend(memoryBackend())
    saveDeck(deck('d1'))
    saveDeck(deck('d2'))
    setPref('deckOpen', { d1: 'Lands', d2: 'Instants' })
    deleteDeck('d1')
    expect(getPrefs().deckOpen).toEqual({ d2: 'Instants' })
  })

  it('deleting the deck the first-deck flow was building forgets that too', () => {
    useBackend(memoryBackend())
    saveDeck(deck('d1'))
    setPref('firstDeck', { deckId: 'd1', step: 'list' })
    deleteDeck('d1')
    expect(getPrefs().firstDeck).toBeNull()
  })

  it('lists decks in the order they were made', () => {
    useBackend(memoryBackend())
    saveDeck(deck('d3'))
    saveDeck(deck('d1'))
    saveDeck(deck('d2'))
    expect(listDecks().map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
  })

  it('stamps updatedAt on a deck that has none', () => {
    useBackend(memoryBackend())
    const { updatedAt: _u, ...bare } = deck('d1')
    saveDeck(bare)
    expect(listDecks()[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('reads are free after the first: the same objects come back', () => {
    useBackend(memoryBackend())
    saveDeck(deck('d1'))
    expect(listDecks()[0]).toBe(listDecks()[0])
  })
})

describe('the old single-blob file', () => {
  it('is split into documents the first time it is read', () => {
    const blob = JSON.stringify({ version: 4, collection: { 'o-x': 1 }, decks: [deck('d1'), deck('d2')], games: [], guide: {}, prefs: {} })
    const backend = memoryBackend(blob)
    useBackend(backend)
    expect(listDecks().map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(backend.keys().sort()).toEqual([ROOT, deckKey('d1'), deckKey('d2')].sort())
    expect(JSON.parse(backend.read(ROOT)).decks).toBeUndefined()
    expect(loadState().collection).toEqual({ 'o-x': 1 })
  })

  it('is left intact when the split cannot be written, and still served from memory', () => {
    const blob = JSON.stringify({ version: 4, decks: [deck('d1')], games: [], guide: {}, prefs: {} })
    const inner = memoryBackend(blob)
    useBackend({ ...inner, write: () => false })
    expect(listDecks().map((d) => d.id)).toEqual(['d1'])
    expect(JSON.parse(inner.read(ROOT)).decks).toHaveLength(1)
  })

  it('still migrates an old schema on the way', () => {
    const blob = JSON.stringify({ version: 1, decks: [{ id: 'd1', name: 'old', formatId: 'modern', commanders: [], main: [], sideboard: [] }] })
    useBackend(memoryBackend(blob))
    const [d] = listDecks()
    expect(d.categoryOrder).toEqual([])
    expect(d.versions).toEqual([])
    expect(loadState().version).toBe(4)
  })
})

describe('backups', () => {
  it('export still carries the decks inline, so the file format is unchanged', () => {
    useBackend(memoryBackend())
    saveDeck(deck('d1'))
    const file = JSON.parse(exportAll())
    expect(file.decks).toHaveLength(1)
    expect(file.version).toBe(4)
  })

  it('a replace restore removes decks the file does not have', () => {
    const backend = memoryBackend()
    useBackend(backend)
    saveDeck(deck('d1'))
    saveDeck(deck('d2'))
    importAll(JSON.stringify({ version: 4, decks: [deck('d9')] }), { replace: true })
    expect(listDecks().map((d) => d.id)).toEqual(['d9'])
    expect(backend.keys().sort()).toEqual([ROOT, deckKey('d9')].sort())
  })

  it('clearAll removes every document', () => {
    const backend = memoryBackend()
    useBackend(backend)
    saveDeck(deck('d1'))
    clearAll()
    expect(backend.keys()).toEqual([])
    expect(listDecks()).toEqual([])
  })
})

describe('damage is contained', () => {
  it('a corrupt root no longer takes the decks with it', () => {
    const backend = memoryBackend('{"version":4,"collection":{')
    backend.write(deckKey('d1'), JSON.stringify(deck('d1')))
    useBackend(backend)
    expect(listDecks().map((d) => d.id)).toEqual(['d1'])
    expect(corruptBackup()).toBe('{"version":4,"collection":{')
  })

  it('a corrupt deck is set aside and the others still load', () => {
    const backend = memoryBackend()
    backend.write(deckKey('bad'), '{"id":"bad","name":"half a de')
    backend.write(deckKey('good'), JSON.stringify(deck('good', { createdAt: '2026-01-01' })))
    useBackend(backend)
    expect(listDecks().map((d) => d.id)).toEqual(['good'])
    expect(corruptBackup()).toBe('{"id":"bad","name":"half a de')
  })
})

describe('another tab', () => {
  it('writing the same storage makes this one re-read, and says so', () => {
    const backend = memoryBackend()
    useBackend(backend)
    saveDeck(deck('d1'))
    // Simulate the other tab: change the document underneath, then fire the
    // browser's storage event as it would.
    backend.write(deckKey('d1'), JSON.stringify({ ...deck('d1'), name: 'from the other tab' }))
    const heard = vi.fn()
    window.addEventListener(STORAGE_CHANGED_EVENT, heard)
    window.dispatchEvent(new StorageEvent('storage', { key: deckKey('d1') }))
    window.removeEventListener(STORAGE_CHANGED_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(listDecks()[0].name).toBe('from the other tab')
  })

  it('ignores storage events about other apps', () => {
    useBackend(memoryBackend())
    saveDeck(deck('d1'))
    const before = listDecks()[0]
    window.dispatchEvent(new StorageEvent('storage', { key: 'someone-else' }))
    expect(listDecks()[0]).toBe(before)
  })
})

describe('this tab', () => {
  it('says which deck was saved, once the save is in, so a screen holding decks can read them again', () => {
    // The card sheet saves to a deck while that deck's editor is open beneath
    // it; the editor's next save used to put the old list back.
    useBackend(memoryBackend())
    saveDeck(deck('d1'))
    const heard = []
    const listen = (e) => heard.push({ id: e.detail.id, name: listDecks()[0].name })
    window.addEventListener(DECK_SAVED_EVENT, listen)
    saveDeck({ ...deck('d1'), name: 'added from the card sheet' })
    window.removeEventListener(DECK_SAVED_EVENT, listen)
    expect(heard).toEqual([{ id: 'd1', name: 'added from the card sheet' }])
  })
})
