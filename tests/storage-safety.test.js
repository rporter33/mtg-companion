import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  useBackend, update, listDecks, saveDeck, corruptBackup, discardCorruptBackup,
  lastSaveSucceeded, PERSIST_FAILED_EVENT,
} from '../src/lib/storage.js'
import { memoryBackend } from '../src/lib/storage-backend.js'

/**
 * There are no accounts. A deck exists in one browser, and the two ways to lose
 * it silently are a save that fails without saying so and a corrupt file that
 * gets overwritten by the next save. Both used to be silent.
 */

describe('a save that does not reach storage', () => {
  afterEach(() => { vi.restoreAllMocks(); discardCorruptBackup() })

  it('is announced rather than swallowed', () => {
    const failing = { ...memoryBackend(), write: () => false }
    useBackend(failing)
    const fired = vi.fn()
    window.addEventListener(PERSIST_FAILED_EVENT, fired)
    update((state) => ({ ...state, prefs: { ...state.prefs, market: 'eur' } }))
    window.removeEventListener(PERSIST_FAILED_EVENT, fired)
    expect(fired).toHaveBeenCalledTimes(1)
    expect(lastSaveSucceeded()).toBe(false)
  })

  it('is announced once, not on every keystroke', () => {
    useBackend({ ...memoryBackend(), write: () => false })
    const fired = vi.fn()
    window.addEventListener(PERSIST_FAILED_EVENT, fired)
    for (let i = 0; i < 5; i++) update((state) => ({ ...state }))
    window.removeEventListener(PERSIST_FAILED_EVENT, fired)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it('still keeps the change for the current session', () => {
    useBackend({ ...memoryBackend(), write: () => false })
    saveDeck({ id: 'd1', name: 'Kept in memory', formatId: 'commander', commanders: [], main: [], sideboard: [] })
    expect(listDecks().map((d) => d.name)).toContain('Kept in memory')
  })

  it('clears once a later save succeeds', () => {
    let allow = false
    const flaky = { ...memoryBackend(), write(v) { if (!allow) return false; this.value = v; return true } }
    useBackend(flaky)
    update((s) => s)
    expect(lastSaveSucceeded()).toBe(false)
    allow = true
    update((s) => s)
    expect(lastSaveSucceeded()).toBe(true)
  })
})

describe('a corrupt file', () => {
  beforeEach(() => { localStorage.clear(); discardCorruptBackup() })

  it('is set aside, not overwritten by the next save', () => {
    const broken = '{"version":3,"decks":[{"id":"d1","name":"Half a dec'
    useBackend(memoryBackend(broken))
    // Reading it fails to parse; that is when it must be preserved.
    listDecks()
    expect(corruptBackup()).toBe(broken)
  })

  it('does not replace an earlier backup with a later one', () => {
    useBackend(memoryBackend('{"first":'))
    listDecks()
    useBackend(memoryBackend('{"second":'))
    listDecks()
    expect(corruptBackup()).toBe('{"first":')
  })

  it('lets the app carry on with an empty state', () => {
    useBackend(memoryBackend('not json at all'))
    expect(listDecks()).toEqual([])
  })

  it('can be discarded once the person has dealt with it', () => {
    useBackend(memoryBackend('{"x":'))
    listDecks()
    discardCorruptBackup()
    expect(corruptBackup()).toBeNull()
  })
})
