import { describe, it, expect, vi } from 'vitest'
import { isNewer, minutesAgo, describeBuild, checkForUpdate, BUILD } from '../src/lib/version.js'

const current = { id: 'aaaaaaa', sha: 'aaaaaaa', at: '2026-09-17T06:00:00.000Z' }

describe('isNewer', () => {
  it('is true for a different build published later', () => {
    expect(isNewer({ id: 'bbbbbbb', sha: 'bbbbbbb', at: '2026-09-17T06:14:00.000Z' }, current)).toBe(true)
  })
  it('is false for the same build', () => {
    expect(isNewer({ ...current }, current)).toBe(false)
  })
  it('is false for an older build, so a stale CDN copy never nags anyone backwards', () => {
    expect(isNewer({ id: 'ccccccc', sha: 'ccccccc', at: '2026-09-17T05:00:00.000Z' }, current)).toBe(false)
  })
  it('is false when either side has no usable time', () => {
    expect(isNewer({ id: 'x', sha: 'x', at: 'not a date' }, current)).toBe(false)
    expect(isNewer({ id: 'x', sha: 'x', at: '2026-09-17T07:00:00.000Z' }, { id: 'dev', sha: 'dev', at: null })).toBe(false)
    expect(isNewer(null, current)).toBe(false)
  })
})

describe('describeBuild and minutesAgo', () => {
  it('names the commit and the publish time in UTC', () => {
    expect(describeBuild(current)).toMatch(/^aaaaaaa, published .*2026.*UTC$/)
  })
  it('says dev with no build baked in', () => {
    expect(describeBuild({ id: 'dev', sha: 'dev', at: null })).toBe('dev')
  })
  it('counts whole minutes and never goes negative', () => {
    const now = Date.parse('2026-09-17T06:10:30.000Z')
    expect(minutesAgo(current, now)).toBe(11)
    expect(minutesAgo({ at: '2026-09-17T06:20:00.000Z' }, now)).toBe(0)
    expect(minutesAgo({ at: 'nope' }, now)).toBeNull()
  })
})

describe('checkForUpdate', () => {
  it('asks for the version file past every cache', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...BUILD }) })
    await checkForUpdate({ fetchImpl, base: '/app/' })
    expect(fetchImpl).toHaveBeenCalledWith('/app/version.json', expect.objectContaining({ cache: 'no-store' }))
  })
  it('returns null when the file is missing, the network is away, or nothing is newer', async () => {
    expect(await checkForUpdate({ fetchImpl: vi.fn().mockResolvedValue({ ok: false }), base: '/' })).toBeNull()
    expect(await checkForUpdate({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('offline')), base: '/' })).toBeNull()
    expect(await checkForUpdate({ fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...BUILD }) }), base: '/' })).toBeNull()
    expect(await checkForUpdate({ fetchImpl: undefined, base: '/' })).toBeNull()
  })
  it('returns the newer build when there is one', async () => {
    const newer = { id: 'zzzzzzz', sha: 'zzzzzzz', at: '2999-01-01T00:00:00.000Z' }
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => newer })
    expect(await checkForUpdate({ fetchImpl, base: '/' })).toEqual(newer)
  })
})
