import { describe, it, expect } from 'vitest'
import {
  findSeason, daysBetween, accentForSet, describeCountdown, buildSeasonTheme,
} from '../src/lib/season.js'

const set = (code, releasedAt, over = {}) => ({
  code, name: `Set ${code.toUpperCase()}`, releasedAt,
  setType: 'expansion', digital: false, iconSvgUri: `https://svgs.scryfall.io/sets/${code}.svg`,
  ...over,
})

const SETS = [
  set('old', '2026-03-06'),
  set('now', '2026-08-01'),
  set('nxt', '2026-11-14'),
  set('dig', '2026-10-01', { digital: true }),
  set('cmd', '2026-10-05', { setType: 'commander' }),
  set('mst', '2026-10-20', { setType: 'masters' }),
]
const TODAY = '2026-09-16'

describe('findSeason', () => {
  it('picks the soonest upcoming paper set and the latest released one', () => {
    const season = findSeason(SETS, TODAY)
    expect(season.next.code).toBe('nxt')
    expect(season.current.code).toBe('now')
  })

  it('ignores digital-only sets', () => {
    // Arena-only releases are not "what is next in paper".
    expect(findSeason(SETS, TODAY).next.code).not.toBe('dig')
  })

  it('ignores supplemental products', () => {
    // Commander decks and Masters sets are products, not the seasonal release.
    const codes = [findSeason(SETS, TODAY).next.code]
    expect(codes).not.toContain('cmd')
    expect(codes).not.toContain('mst')
  })

  it('treats a set releasing today as released, not upcoming', () => {
    const season = findSeason([set('tdy', TODAY)], TODAY)
    expect(season.current.code).toBe('tdy')
    expect(season.next).toBeNull()
  })

  it('handles having nothing announced yet', () => {
    const season = findSeason([set('old', '2026-03-06')], TODAY)
    expect(season.next).toBeNull()
    expect(season.current.code).toBe('old')
    expect(season.daysUntilNext).toBeNull()
  })

  it('survives an empty or malformed list', () => {
    expect(findSeason([], TODAY).next).toBeNull()
    expect(findSeason(undefined, TODAY).current).toBeNull()
    expect(findSeason([set('bad', null)], TODAY).current).toBeNull()
  })
})

describe('daysBetween', () => {
  it('counts forward and backward', () => {
    expect(daysBetween('2026-09-16', '2026-09-17')).toBe(1)
    expect(daysBetween('2026-09-17', '2026-09-16')).toBe(-1)
    expect(daysBetween('2026-09-16', '2026-09-16')).toBe(0)
  })

  it('crosses a month and a leap day without drifting', () => {
    expect(daysBetween('2026-01-31', '2026-03-01')).toBe(29)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2) // 2028 is a leap year
  })

  it('returns null rather than NaN for junk', () => {
    expect(daysBetween('nonsense', '2026-01-01')).toBeNull()
  })
})

describe('accentForSet', () => {
  it('is stable for the same code', () => {
    expect(accentForSet('abc').hue).toBe(accentForSet('abc').hue)
  })

  it('separates codes that differ by one character', () => {
    // Consecutive set codes should not look identical.
    const a = accentForSet('aaa').hue
    const b = accentForSet('aab').hue
    expect(Math.abs(a - b)).toBeGreaterThan(20)
  })

  it('stays inside the hue wheel', () => {
    for (const code of ['a', 'zzz', 'mh3', 'fdn', '', 'averylongsetcode']) {
      const accent = accentForSet(code)
      if (!accent) continue
      expect(accent.hue).toBeGreaterThanOrEqual(0)
      expect(accent.hue).toBeLessThan(360)
    }
  })

  it('fixes saturation and lightness so no set renders illegibly', () => {
    // The hue is the only free variable; a set must never get near-black.
    for (const code of ['aaa', 'bbb', 'ccc', 'ddd']) {
      expect(accentForSet(code).accent).toMatch(/62% 62%\)$/)
    }
  })

  it('returns null for a missing code', () => {
    expect(accentForSet(null)).toBeNull()
  })
})

describe('describeCountdown', () => {
  it('reads naturally across the range', () => {
    expect(describeCountdown(0)).toBe('out today')
    expect(describeCountdown(1)).toBe('out tomorrow')
    expect(describeCountdown(9)).toBe('9 days away')
    expect(describeCountdown(21)).toBe('3 weeks away')
    expect(describeCountdown(60)).toBe('about 2 months away')
  })

  it('does not claim false precision far out', () => {
    // Release dates months away move. Saying "63 days" implies we know better.
    expect(describeCountdown(63)).toMatch(/about/)
  })

  it('handles a date that has passed', () => {
    expect(describeCountdown(-3)).toBe('out now')
    expect(describeCountdown(null)).toBeNull()
  })
})

describe('buildSeasonTheme', () => {
  it('focuses the upcoming set when there is one', () => {
    const theme = buildSeasonTheme(SETS, TODAY)
    expect(theme.set.code).toBe('nxt')
    expect(theme.isUpcoming).toBe(true)
    expect(theme.countdown).toMatch(/months away/)
    expect(theme.searchQuery).toBe('set:nxt')
  })

  it('falls back to the most recent set when nothing is announced', () => {
    const theme = buildSeasonTheme([set('now', '2026-08-01')], TODAY)
    expect(theme.isUpcoming).toBe(false)
    expect(theme.countdown).toBeNull()
    expect(theme.daysSinceRelease).toBe(46)
  })

  it('returns null when there is nothing worth showing', () => {
    // The caller renders nothing rather than an empty shell.
    expect(buildSeasonTheme([], TODAY)).toBeNull()
    expect(buildSeasonTheme([set('cmd', '2026-10-05', { setType: 'commander' })], TODAY)).toBeNull()
  })

  it('carries an accent the UI can apply directly', () => {
    const theme = buildSeasonTheme(SETS, TODAY)
    expect(theme.accent).toMatch(/^hsl\(/)
    expect(theme.accentDim).toMatch(/^hsl\(/)
  })
})
