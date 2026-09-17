import { describe, it, expect } from 'vitest'
import { storageUsage, makeRoom, backupStatus, formatBytes, ASSUMED_CAP_BYTES } from '../src/lib/data-safety.js'

const version = (id, auto, at) => ({ id, auto, at, label: auto ? '' : id, main: [{ cardId: 'x', quantity: 1 }], sideboard: [], commanders: [] })
const deck = (id, versions = [], updatedAt = '2026-01-01T00:00:00Z') => ({
  id, name: id, formatId: 'commander', commanders: [], main: [{ cardId: 'x', quantity: 4 }], sideboard: [], versions, updatedAt,
})
const state = (decks, extra = {}) => ({ version: 4, decks, collection: {}, games: [], guide: {}, prefs: {}, ...extra })

describe('storageUsage', () => {
  it('measures the whole store and each part of it', () => {
    const u = storageUsage(state([deck('a', [version('v1', true, '2026-01-01')])]))
    expect(u.total).toBeGreaterThan(0)
    expect(u.sections.versions).toBeGreaterThan(0)
    expect(u.sections.decks).toBeGreaterThan(0)
  })

  it('does not count versions twice, inside decks and again as versions', () => {
    const big = state([deck('a', Array.from({ length: 20 }, (_, i) => version(`v${i}`, true, `2026-01-${String(i + 1).padStart(2, '0')}`)))])
    const u = storageUsage(big)
    expect(u.sections.decks + u.sections.versions).toBeLessThanOrEqual(u.total + 50)
  })

  it('reports counts a person would recognise', () => {
    const u = storageUsage(state([deck('a', [version('v1', true, 'x'), version('v2', false, 'y')]), deck('b')], { collection: { 'o-1': 2 } }))
    expect(u.counts).toMatchObject({ decks: 2, versions: 2, autoVersions: 1, collection: 1 })
  })

  it('assumes the conservative cap and says what fraction is used', () => {
    const u = storageUsage(state([]))
    expect(u.cap).toBe(ASSUMED_CAP_BYTES)
    expect(u.fraction).toBeGreaterThanOrEqual(0)
    expect(u.fraction).toBeLessThan(0.01)
  })

  it('survives an empty or absent state', () => {
    expect(storageUsage(undefined).counts.decks).toBe(0)
    expect(storageUsage({}).total).toBeGreaterThan(0)
  })
})

describe('makeRoom', () => {
  it('leaves a store that already fits alone', () => {
    const s = state([deck('a', [version('v1', true, '2026-01-01')])])
    const r = makeRoom(s)
    expect(r.removed).toBe(0)
    expect(r.state).toBe(s)
    expect(r.fits).toBe(true)
  })

  it('drops the oldest automatic checkpoint first, across decks', () => {
    const s = state([
      deck('a', [version('a-new', false, '2026-03-01'), version('a-old', true, '2026-01-01')]),
      deck('b', [version('b-new', false, '2026-03-01'), version('b-mid', true, '2026-02-01')]),
    ])
    const r = makeRoom(s, 0) // impossible target: strip everything droppable
    const left = r.state.decks.flatMap((d) => d.versions.map((v) => v.id))
    expect(left).not.toContain('a-old')
    expect(left).not.toContain('b-mid')
    expect(r.removed).toBe(2)
  })

  it('never removes a labelled version', () => {
    const s = state([deck('a', [version('keep', false, '2026-01-01'), version('keep2', false, '2025-01-01')])])
    const r = makeRoom(s, 0)
    expect(r.state.decks[0].versions.map((v) => v.id)).toEqual(['keep', 'keep2'])
    expect(r.fits).toBe(false)
  })

  it('never removes a deck newest version, even if automatic', () => {
    const s = state([deck('a', [version('newest-auto', true, '2026-01-02'), version('older-auto', true, '2026-01-01')])])
    const r = makeRoom(s, 0)
    expect(r.state.decks[0].versions.map((v) => v.id)).toEqual(['newest-auto'])
  })

  it('stops as soon as the store fits', () => {
    const many = Array.from({ length: 10 }, (_, i) => version(`v${i}`, true, `2026-01-${String(10 - i).padStart(2, '0')}`))
    const s = state([deck('a', [version('top', false, '2026-02-01'), ...many])])
    const before = storageUsage(s).total
    const r = makeRoom(s, before - 150)
    expect(r.removed).toBeGreaterThan(0)
    expect(r.removed).toBeLessThan(10)
    expect(r.fits).toBe(true)
  })

  it('says honestly when it could not make enough room', () => {
    expect(makeRoom(state([deck('a')]), 0).fits).toBe(false)
  })
})

describe('backupStatus', () => {
  const NOW = Date.parse('2026-09-17T00:00:00Z')

  it('has nothing to say about an empty store', () => {
    expect(backupStatus(state([]), NOW).level).toBe('none')
  })

  it('is loudest when decks exist and nothing was ever exported', () => {
    const r = backupStatus(state([deck('a'), deck('b')]), NOW)
    expect(r.level).toBe('never')
    expect(r.changedSince).toBe(2)
  })

  it('is quiet when the backup is newer than every edit', () => {
    const s = state([deck('a', [], '2026-09-01T00:00:00Z')], { prefs: { lastExportedAt: '2026-09-10T00:00:00Z' } })
    expect(backupStatus(s, NOW).level).toBe('fresh')
  })

  it('does not nag over one recent change', () => {
    const s = state([deck('a', [], '2026-09-16T00:00:00Z')], { prefs: { lastExportedAt: '2026-09-15T00:00:00Z' } })
    expect(backupStatus(s, NOW).level).toBe('recent')
  })

  it('calls it stale after several changed decks', () => {
    const s = state(['a', 'b', 'c'].map((id) => deck(id, [], '2026-09-16T00:00:00Z')), { prefs: { lastExportedAt: '2026-09-15T00:00:00Z' } })
    expect(backupStatus(s, NOW)).toMatchObject({ level: 'stale', changedSince: 3 })
  })

  it('calls it stale after two weeks, whatever changed', () => {
    const s = state([deck('a', [], '2026-09-16T00:00:00Z')], { prefs: { lastExportedAt: '2026-08-01T00:00:00Z' } })
    expect(backupStatus(s, NOW).level).toBe('stale')
  })
})

describe('formatBytes', () => {
  it('picks a sensible unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
  })
})
