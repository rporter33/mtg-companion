import { describe, it, expect } from 'vitest'
import { SET_MECHANICS, mechanicsForSet, curationAgeDays } from '../src/data/set-mechanics.js'
import { curationStatus, curationNote } from '../src/lib/curation.js'
import { releaseLabel } from '../src/lib/release.js'
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
      // Added by hand once the entry has been checked against the released cards.
      if (entry.checkedAt !== undefined) expect(entry.checkedAt, `${entry.setCode} checkedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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

// What "What's new" says about how current Reality Fracture's entry is, by the
// day. The release date is the one Scryfall's set list gave on 2026-09-21,
// passed in the way SeasonBanner passes the focus set's. The entry is the
// shipped one without any checkedAt, so these still hold once the owner adds
// one; the check itself is covered below and in tests/curation.test.js.
describe('Reality Fracture’s mechanics, before and after release', () => {
  const RELEASE = '2026-10-02'
  const UNCHECKED = { ...SET_MECHANICS.fra, checkedAt: undefined }
  const noteOn = (day, entry = UNCHECKED) => curationNote(curationStatus(entry, RELEASE, day))
  // "16 Sep 2026" or "16 Sept 2026", as the runtime's own British date data
  // abbreviates September; tests/release.test.js checks the format itself.
  const WRITTEN = releaseLabel(SET_MECHANICS.fra.curatedAt)

  it('is provisional while the set is not out', () => {
    expect(SET_MECHANICS.fra.curatedAt).toBe('2026-09-16')
    expect(curationStatus(SET_MECHANICS.fra, RELEASE, '2026-10-01')).toMatchObject({ state: 'preview', provisional: true })
    expect(noteOn('2026-09-21')).toBe(`Written on ${WRITTEN} from previews; the set comes out on 2 Oct 2026, and wording sometimes changes before release.`)
  })

  it('says from release day that it was written before and not checked since', () => {
    expect(curationStatus(UNCHECKED, RELEASE, RELEASE)).toMatchObject({ state: 'unchecked', provisional: false })
    expect(noteOn(RELEASE)).toBe(`Written on ${WRITTEN} from previews, before release on 2 Oct 2026; not yet checked against the released cards.`)
    // And goes on saying so, however long it has been.
    expect(noteOn('2027-03-01')).toBe(noteOn(RELEASE))
  })

  it('says when it was checked once the owner adds checkedAt, and not before that day', () => {
    const checked = { ...SET_MECHANICS.fra, checkedAt: '2026-10-09' }
    expect(noteOn('2026-10-20', checked)).toBe(`Written on ${WRITTEN} from previews, before release on 2 Oct 2026; checked against the released cards on 9 Oct 2026.`)
    expect(noteOn(RELEASE, checked)).toBe(noteOn(RELEASE))
  })

  it('dates any check the shipped entry carries on or after release day', () => {
    const { checkedAt } = SET_MECHANICS.fra
    if (checkedAt !== undefined) expect(checkedAt >= RELEASE).toBe(true)
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
