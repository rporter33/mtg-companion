import { describe, it, expect } from 'vitest'
import { SET_MECHANICS, mechanicsForSet, curationAgeDays } from '../src/data/set-mechanics.js'
import { GLOSSARY } from '../src/data/glossary.js'

describe('set mechanics', () => {
  it('looks up case-insensitively and returns null for unknown sets', () => {
    expect(mechanicsForSet('fra')).toBeTruthy()
    expect(mechanicsForSet('FRA')).toBeTruthy()
    expect(mechanicsForSet('zzz')).toBeNull()
    expect(mechanicsForSet(undefined)).toBeNull()
  })

  it('keys every entry by its own set code', () => {
    for (const [key, entry] of Object.entries(SET_MECHANICS)) {
      expect(entry.setCode).toBe(key)
    }
  })

  it('dates and sources every entry', () => {
    // This is the only hand-written content in the app. If it cannot say when it
    // was written and where it came from, it should not ship.
    for (const entry of Object.values(SET_MECHANICS)) {
      expect(entry.curatedAt, `${entry.setCode} has no curation date`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.sources?.length, `${entry.setCode} has no sources`).toBeGreaterThan(0)
      for (const url of entry.sources) expect(url).toMatch(/^https:\/\//)
    }
  })

  it('gives every mechanic a short form, a long form and a new-player note', () => {
    for (const entry of Object.values(SET_MECHANICS)) {
      expect(entry.mechanics.length).toBeGreaterThan(0)
      for (const mechanic of entry.mechanics) {
        expect(mechanic.id).toBeTruthy()
        expect(mechanic.term).toBeTruthy()
        expect(mechanic.short.length).toBeGreaterThan(10)
        expect(mechanic.long.length).toBeGreaterThan(40)
      }
    }
  })

  it('only cross-references glossary terms that exist', () => {
    for (const entry of Object.values(SET_MECHANICS)) {
      for (const mechanic of entry.mechanics) {
        for (const id of mechanic.seeAlso ?? []) {
          expect(GLOSSARY[id], `${mechanic.id} points at missing term "${id}"`).toBeTruthy()
        }
      }
    }
  })

  it('does not shadow an existing glossary term', () => {
    // A set mechanic sharing an id with an evergreen term would make the two
    // explanations diverge silently.
    for (const entry of Object.values(SET_MECHANICS)) {
      for (const mechanic of entry.mechanics) {
        expect(GLOSSARY[mechanic.id], `${mechanic.id} collides with a glossary term`).toBeUndefined()
      }
    }
  })
})

describe('curationAgeDays', () => {
  it('reports how stale an entry is', () => {
    const entry = { curatedAt: '2026-09-01' }
    expect(curationAgeDays(entry, '2026-09-16')).toBe(15)
    expect(curationAgeDays(entry, '2026-09-01')).toBe(0)
  })

  it('returns null rather than NaN when it cannot tell', () => {
    expect(curationAgeDays({}, '2026-09-16')).toBeNull()
    expect(curationAgeDays({ curatedAt: 'soon' }, '2026-09-16')).toBeNull()
    expect(curationAgeDays(null)).toBeNull()
  })
})
