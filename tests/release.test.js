import { describe, it, expect } from 'vitest'
import { notOutUntil, isReleasedPaper, releaseLabel, notOutText } from '../src/lib/release.js'

// Star Trek's basics, previewed on Scryfall weeks before they are out: the
// printing a bare "Island" resolved to on 2026-09-21.
const TRK_ISLAND = { name: 'Island', set: 'trk', collector_number: '319', released_at: '2026-11-13', digital: false, games: ['paper', 'mtgo', 'arena'] }
const HOB_ISLAND = { name: 'Island', set: 'hob', collector_number: '195', released_at: '2026-08-14', digital: false, games: ['paper'] }

describe('whether a printing is out', () => {
  it('is not out until its release day, and is out on it', () => {
    expect(notOutUntil(TRK_ISLAND, '2026-09-21')).toBe('2026-11-13')
    expect(notOutUntil(TRK_ISLAND, '2026-11-12')).toBe('2026-11-13')
    expect(notOutUntil(TRK_ISLAND, '2026-11-13')).toBeNull()
    expect(notOutUntil(TRK_ISLAND, '2026-11-14')).toBeNull()
    expect(notOutUntil(HOB_ISLAND, '2026-09-21')).toBeNull()
  })

  it('counts a card with no readable date as out, rather than withhold it', () => {
    expect(notOutUntil({ name: 'X' }, '2026-09-21')).toBeNull()
    expect(notOutUntil({ name: 'X', released_at: 'soon' }, '2026-09-21')).toBeNull()
    expect(notOutUntil({ name: 'X', released_at: 20261113 }, '2026-09-21')).toBeNull()
    expect(notOutUntil(null, '2026-09-21')).toBeNull()
  })

  it('asks for a released paper printing: out, not digital-only, printed on paper', () => {
    expect(isReleasedPaper(HOB_ISLAND, '2026-09-21')).toBe(true)
    expect(isReleasedPaper(TRK_ISLAND, '2026-09-21')).toBe(false)
    expect(isReleasedPaper(TRK_ISLAND, '2026-11-13')).toBe(true)
    expect(isReleasedPaper({ ...HOB_ISLAND, digital: true }, '2026-09-21')).toBe(false)
    expect(isReleasedPaper({ ...HOB_ISLAND, games: ['arena'] }, '2026-09-21')).toBe(false)
    // An old record without `games` is read forgivingly, as paper.
    expect(isReleasedPaper({ name: 'Island', released_at: '1993-08-05' }, '2026-09-21')).toBe(true)
    expect(isReleasedPaper(null)).toBe(false)
  })

  it('says the day the same way wherever the viewer is', () => {
    expect(releaseLabel('2026-11-13')).toBe('13 Nov 2026')
    expect(releaseLabel('2026-10-02')).toBe('2 Oct 2026')
    expect(releaseLabel('nonsense')).toBe('')
    expect(notOutText('2026-11-13')).toBe('Not out until 13 Nov 2026')
  })
})
