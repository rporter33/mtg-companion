import { describe, it, expect, beforeEach } from 'vitest'
import { migrate, SCHEMA_VERSION, useBackend, importAll, exportAll, listDecks } from '../src/lib/storage.js'

/**
 * Migrations run against the only copy of a user's decks that exists. There are
 * no accounts and no server, so a step that drops a field drops it for good.
 */
describe('migrate', () => {
  const v1 = () => ({
    version: 1,
    decks: [{ id: 'd1', name: 'Old Deck', formatId: 'commander', commanders: ['c'], main: [{ cardId: 'x', quantity: 4 }], sideboard: [] }],
    games: [{ id: 'g1' }],
    guide: { completedLessons: ['l1'], tutorialState: null, seenGlossary: [] },
    prefs: { showCardImages: false },
  })

  it('brings an old file up to the current version', () => {
    expect(migrate(v1()).version).toBe(SCHEMA_VERSION)
  })

  it('keeps every deck, and everything in them', () => {
    const out = migrate(v1())
    expect(out.decks).toHaveLength(1)
    expect(out.decks[0]).toMatchObject({ id: 'd1', name: 'Old Deck', main: [{ cardId: 'x', quantity: 4 }] })
  })

  it('keeps the parts it is not migrating', () => {
    const out = migrate(v1())
    expect(out.games).toEqual([{ id: 'g1' }])
    expect(out.guide.completedLessons).toEqual(['l1'])
    expect(out.prefs.showCardImages).toBe(false)
  })

  it('gives the state somewhere to record a collection', () => {
    expect(migrate(v1()).collection).toEqual({})
  })

  it('does not wipe a collection that already exists', () => {
    const state = { ...v1(), version: 2, collection: { 'o-ring': 3 } }
    expect(migrate(state).collection).toEqual({ 'o-ring': 3 })
  })

  it('gives every deck somewhere to record its history', () => {
    expect(migrate(v1()).decks[0].versions).toEqual([])
  })

  it('does not discard a history a deck already has', () => {
    const state = { ...v1(), version: 3, collection: {} }
    state.decks[0].versions = [{ id: 'v_keep', at: '2026-01-01T00:00:00Z', label: 'kept', auto: false, main: [], sideboard: [], commanders: [] }]
    expect(migrate(state).decks[0].versions[0].id).toBe('v_keep')
  })

  it('gives every deck somewhere to record a category order', () => {
    expect(migrate(v1()).decks[0].categoryOrder).toEqual([])
  })

  it('does not overwrite an order a deck already has', () => {
    const state = v1()
    state.decks[0].categoryOrder = ['Ramp']
    expect(migrate(state).decks[0].categoryOrder).toEqual(['Ramp'])
  })

  it('is a no-op on current data, and safe to run twice', () => {
    const once = migrate(v1())
    expect(migrate(once)).toBe(once)
  })

  // A stale service worker can serve an old bundle against newer data. Forcing
  // that backwards would discard fields the newer build is still using.
  it('leaves state from a newer build alone', () => {
    const future = { version: SCHEMA_VERSION + 5, decks: [], somethingNew: true }
    expect(migrate(future)).toBe(future)
  })

  it('treats a file with no version as the oldest one', () => {
    expect(migrate({ decks: [] }).version).toBe(SCHEMA_VERSION)
  })

  it('survives a file with no decks array at all', () => {
    expect(() => migrate({ version: 1 })).not.toThrow()
    expect(migrate({ version: 1 }).decks).toEqual([])
  })
})

describe('importing a backup', () => {
  beforeEach(() => { useBackend() })

  const oldExport = JSON.stringify({
    version: 1,
    decks: [{ id: 'old', name: 'From Backup', formatId: 'modern', commanders: [], main: [], sideboard: [] }],
    games: [], guide: { completedLessons: [], tutorialState: null, seenGlossary: [] }, prefs: {},
  })

  it('migrates a backup written by an older build', () => {
    importAll(oldExport, { replace: true })
    expect(JSON.parse(exportAll()).version).toBe(SCHEMA_VERSION)
    expect(listDecks()[0].categoryOrder).toEqual([])
  })

  // Replacing used to pin the store to version 1, writing the whole thing back
  // to an older schema on every restore.
  it('does not drag the store back to an old version', () => {
    importAll(oldExport, { replace: true })
    expect(JSON.parse(exportAll()).version).not.toBe(1)
  })

  it('still keeps local work when merging rather than replacing', () => {
    importAll(oldExport, { replace: true })
    importAll(oldExport, { replace: false })
    expect(listDecks()).toHaveLength(2)
  })
})
