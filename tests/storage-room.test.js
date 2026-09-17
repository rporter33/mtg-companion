import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  useBackend, update, saveDeck, listDecks, ROOM_MADE_EVENT, PERSIST_FAILED_EVENT,
  checkpointsDroppedToFit, lastSaveSucceeded, exportAll, importAll, markExported,
} from '../src/lib/storage.js'
import { memoryBackend } from '../src/lib/storage-backend.js'

/**
 * When the browser refuses a write, the app has exactly one thing it may throw
 * away to make it fit: automatic version checkpoints. This is the behaviour
 * of that retry, against a backend that refuses anything over a size.
 */
const cappedBackend = (cap) => {
  const inner = memoryBackend()
  return { ...inner, name: 'capped', write(v) { if (v.length > cap) return false; return inner.write(v) } }
}

const version = (id, auto, at) => ({ id, auto, at, label: auto ? '' : id, main: [{ cardId: 'x', quantity: 1 }], sideboard: [], commanders: [] })
const bigDeck = () => ({
  id: 'd1', name: 'Big', formatId: 'commander', commanders: [], main: [{ cardId: 'x', quantity: 4 }], sideboard: [],
  categoryOrder: [],
  versions: [
    version('keep', false, '2026-03-01'),
    ...Array.from({ length: 12 }, (_, i) => version(`auto${i}`, true, `2026-01-${String(12 - i).padStart(2, '0')}`)),
  ],
  updatedAt: '2026-03-01T00:00:00Z',
})

afterEach(() => vi.restoreAllMocks())

describe('a write the browser refuses', () => {
  it('is retried after dropping automatic checkpoints, and lands', () => {
    useBackend(cappedBackend(1800))
    const made = vi.fn()
    window.addEventListener(ROOM_MADE_EVENT, made)
    saveDeck(bigDeck())
    window.removeEventListener(ROOM_MADE_EVENT, made)
    expect(lastSaveSucceeded()).toBe(true)
    expect(made).toHaveBeenCalledTimes(1)
    expect(checkpointsDroppedToFit()).toBeGreaterThan(0)
  })

  it('keeps the change that was being saved', () => {
    useBackend(cappedBackend(1800))
    saveDeck(bigDeck())
    expect(listDecks()[0].name).toBe('Big')
  })

  it('never drops a labelled version to make room', () => {
    useBackend(cappedBackend(1800))
    saveDeck(bigDeck())
    expect(listDecks()[0].versions.map((v) => v.id)).toContain('keep')
  })

  it('drops the oldest checkpoints, not the newest', () => {
    useBackend(cappedBackend(1800))
    saveDeck(bigDeck())
    const left = listDecks()[0].versions.filter((v) => v.auto).map((v) => v.id)
    expect(left).toContain('auto0')
    expect(left).not.toContain('auto11')
  })

  it('says how many it dropped', () => {
    useBackend(cappedBackend(1800))
    let detail = null
    const onMade = (e) => { detail = e.detail }
    window.addEventListener(ROOM_MADE_EVENT, onMade)
    saveDeck(bigDeck())
    window.removeEventListener(ROOM_MADE_EVENT, onMade)
    expect(detail.removed).toBe(checkpointsDroppedToFit())
  })

  // Nothing disposable left: this is the failure the banner exists for.
  it('still announces a failure when there is nothing left to drop', () => {
    useBackend(cappedBackend(50))
    const failed = vi.fn()
    window.addEventListener(PERSIST_FAILED_EVENT, failed)
    saveDeck({ ...bigDeck(), versions: [version('keep', false, '2026-03-01')] })
    window.removeEventListener(PERSIST_FAILED_EVENT, failed)
    expect(failed).toHaveBeenCalledTimes(1)
    expect(lastSaveSucceeded()).toBe(false)
  })

  it('does not thin history when the write simply fits', () => {
    useBackend(memoryBackend())
    saveDeck(bigDeck())
    expect(listDecks()[0].versions).toHaveLength(13)
  })
})

describe('a backup carries everything', () => {
  it('round-trips the fields added since version 1', () => {
    useBackend(memoryBackend())
    const deck = {
      ...bigDeck(),
      main: [{ cardId: 'x', quantity: 4, category: 'Ramp' }],
      categoryOrder: ['Ramp', 'Creatures'],
    }
    saveDeck(deck)
    update((s) => ({ ...s, collection: { 'o-x': 3 } }))
    const file = exportAll()

    useBackend(memoryBackend())
    importAll(file, { replace: true })
    const back = listDecks()[0]
    expect(back.main[0].category).toBe('Ramp')
    expect(back.categoryOrder).toEqual(['Ramp', 'Creatures'])
    expect(back.versions).toHaveLength(13)
    expect(back.versions.find((v) => v.id === 'keep').label).toBe('keep')
    expect(JSON.parse(exportAll()).collection).toEqual({ 'o-x': 3 })
  })

  it('records when a backup was taken', () => {
    useBackend(memoryBackend())
    markExported('2026-09-17T12:00:00Z')
    expect(JSON.parse(exportAll()).prefs.lastExportedAt).toBe('2026-09-17T12:00:00Z')
  })
})
