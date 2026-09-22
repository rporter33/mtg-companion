import { describe, it, expect } from 'vitest'
import {
  findSeason, daysBetween, accentForSet, describeCountdown, buildSeasonTheme,
  accentFromColorProfile,
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
    expect(findSeason([null, set('odd', 'soon'), set('bad', 20261002)], TODAY).focus).toBeNull()
  })
})

// The owner's rule, 2026-09-21: the latest released set stays the focus until
// the next set is nearer in days, and on a tie the released set stays. These
// are the real sets around it, as Scryfall listed them that day, with the
// Commander products that come out beside them; every day is given, so the
// suite means the same after these dates as before them.
describe('the season focus', () => {
  const REAL = [
    set('hob', '2026-08-14'),
    set('fra', '2026-10-02'),
    set('frc', '2026-10-02', { setType: 'commander' }),
    set('trk', '2026-11-13'),
    set('trc', '2026-11-13', { setType: 'commander' }),
  ]
  const focusOn = (day) => findSeason(REAL, day).focus?.code

  it('is the upcoming set while it is nearer than the released one', () => {
    // 38 days since The Hobbit, 11 to Reality Fracture.
    expect(focusOn('2026-09-21')).toBe('fra')
  })

  it('stays on a set on its release day', () => {
    const season = findSeason(REAL, '2026-10-02')
    expect(season.focus.code).toBe('fra')
    expect(season.focus).toBe(season.current)
    expect(season.next.code).toBe('trk')
  })

  it('stays on the released set while it is nearer', () => {
    // 20 days since Reality Fracture, 22 to Star Trek.
    expect(focusOn('2026-10-22')).toBe('fra')
  })

  it('stays on the released set on a tie', () => {
    const season = findSeason(REAL, '2026-10-23')
    expect([season.daysSinceCurrent, season.daysUntilNext]).toEqual([21, 21])
    expect(season.focus.code).toBe('fra')
  })

  it('moves to the next set the day it is nearer', () => {
    // 22 days since Reality Fracture, 20 to Star Trek.
    expect(focusOn('2026-10-24')).toBe('trk')
  })

  it('is the released set when nothing is announced, and the upcoming one when nothing is out', () => {
    expect(findSeason([set('hob', '2026-08-14')], '2027-06-01').focus.code).toBe('hob')
    expect(findSeason([set('fra', '2026-10-02')], '2026-01-01').focus.code).toBe('fra')
    expect(findSeason([], '2026-09-21').focus).toBeNull()
  })

  it('never focuses a supplemental product released beside a set', () => {
    for (const day of ['2026-09-21', '2026-10-02', '2026-10-23', '2026-11-13']) {
      expect(['frc', 'trc']).not.toContain(focusOn(day))
    }
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
  it('focuses the upcoming set once it is nearer than the released one', () => {
    // 55 days since 'now', 50 to 'nxt'.
    const theme = buildSeasonTheme(SETS, '2026-09-25')
    expect(theme.set.code).toBe('nxt')
    expect(theme.isUpcoming).toBe(true)
    expect(theme.countdown).toMatch(/months away/)
    expect(theme.following).toBeNull()
    expect(theme.searchQuery).toBe('set:nxt')
  })

  it('keeps the released set while it is the nearer, and names the one that follows', () => {
    // 46 days since 'now', 59 to 'nxt'.
    const theme = buildSeasonTheme(SETS, TODAY)
    expect(theme.set.code).toBe('now')
    expect(theme.isUpcoming).toBe(false)
    expect(theme.countdown).toBeNull()
    expect(theme.daysSinceRelease).toBe(46)
    expect(theme.following.code).toBe('nxt')
    expect(theme.searchQuery).toBe('set:now')
  })

  it('falls back to the most recent set when nothing is announced', () => {
    const theme = buildSeasonTheme([set('now', '2026-08-01')], TODAY)
    expect(theme.isUpcoming).toBe(false)
    expect(theme.countdown).toBeNull()
    expect(theme.daysSinceRelease).toBe(46)
    expect(theme.following).toBeNull()
  })

  it('says a curated theme is provisional exactly while its set is not out', () => {
    // Reality Fracture's entry is written with provisional: true; the date
    // decides what the screen says, not the flag.
    const sets = [set('hob', '2026-08-14'), set('fra', '2026-10-02'), set('trk', '2026-11-13')]
    const before = buildSeasonTheme(sets, '2026-10-01')
    expect([before.set.code, before.derivedFrom, before.provisional]).toEqual(['fra', 'curated', true])
    const out = buildSeasonTheme(sets, '2026-10-02')
    expect([out.set.code, out.derivedFrom, out.provisional, out.isUpcoming]).toEqual(['fra', 'curated', false, false])
    expect(out.following.code).toBe('trk')
    const moved = buildSeasonTheme(sets, '2026-10-24')
    expect([moved.set.code, moved.derivedFrom, moved.provisional]).toEqual(['trk', 'code', undefined])
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

describe('accentFromColorProfile', () => {
  const profile = (counts) => ({ counts, total: Object.values(counts).reduce((a, b) => a + b, 0) })

  it('tints toward the colour a set actually leans on', () => {
    const blue = accentFromColorProfile(profile({ W: 10, U: 90, B: 10, R: 5, G: 5 }))
    // Blue sits near 205 on the wheel.
    expect(Math.abs(blue.hue - 205)).toBeLessThan(25)
    expect(blue.derivedFrom).toBe('colors')
  })

  it('averages hues circularly, not arithmetically', () => {
    // Red is 5 and black is 267. A naive mean is 136 — green — which is the
    // classic bug that makes colour averaging look broken.
    const both = accentFromColorProfile(profile({ B: 50, R: 50 }))
    expect(both.hue).toBeGreaterThan(280)
    expect(both.hue).toBeLessThan(360)
  })

  it('desaturates an evenly spread set instead of asserting a hue', () => {
    const even = accentFromColorProfile(profile({ W: 40, U: 40, B: 40, R: 40, G: 40 }))
    const lopsided = accentFromColorProfile(profile({ W: 2, U: 96, B: 2, R: 0, G: 0 }))
    expect(even.balance).toBeLessThan(0.1)
    expect(even.accent).toMatch(/ 3\d% /)          // low saturation
    expect(lopsided.accent).toMatch(/ [67]\d% /)   // high saturation
  })

  it('returns null when there is nothing to derive from', () => {
    expect(accentFromColorProfile(null)).toBeNull()
    expect(accentFromColorProfile({ counts: {}, total: 0 })).toBeNull()
    expect(accentFromColorProfile({ counts: { W: 0, U: 0 }, total: 0 })).toBeNull()
  })
})

describe('buildSeasonTheme with a colour profile', () => {
  it('prefers real colour data over the code hash', () => {
    const withProfile = buildSeasonTheme(SETS, TODAY,
      { counts: { W: 0, U: 100, B: 0, R: 0, G: 0 }, total: 100 })
    expect(withProfile.derivedFrom).toBe('colors')
    expect(Math.abs(withProfile.hue - 205)).toBeLessThan(25)
  })

  it('falls back to the code hash when no profile is available', () => {
    expect(buildSeasonTheme(SETS, TODAY).derivedFrom).toBe('code')
    expect(buildSeasonTheme(SETS, TODAY, null).derivedFrom).toBe('code')
  })
})
