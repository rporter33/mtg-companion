import { describe, it, expect } from 'vitest'
import { SET_THEMES, curatedThemeFor, schoolsFor, schoolsForColor, loreFor, canonicalSetName } from '../src/data/set-themes.js'
import { buildSeasonTheme } from '../src/lib/season.js'
import { themeSetFor } from '../src/lib/theme-set.js'
import { curationStatus, themeNote } from '../src/lib/curation.js'
import { releaseLabel } from '../src/lib/release.js'
import { compare } from '../scripts/check-tokens.mjs'

const set = (code, releasedAt, extra = {}) => ({
  code, name: code.toUpperCase(), releasedAt, setType: 'expansion', digital: false, cardCount: 250,
  iconSvgUri: `https://svgs.scryfall.io/sets/${code}.svg`, ...extra,
})
const TODAY = '2026-09-16'

describe('curated set themes', () => {
  it('every entry is dated and sourced, keeps its author’s provisional note, and dates any check', () => {
    for (const entry of Object.values(SET_THEMES)) {
      expect(entry.curatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof entry.provisional).toBe('boolean')
      expect(Array.isArray(entry.sources)).toBe(true)
      if (entry.checkedAt !== undefined) expect(entry.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  it('an entry without an accent applies nothing', () => {
    const saved = { ...SET_THEMES.fra }
    try {
      SET_THEMES.fra.accent = null
      expect(curatedThemeFor('fra')).toBeNull()
    } finally { Object.assign(SET_THEMES.fra, saved) }
    expect(curatedThemeFor('nope')).toBeNull()
  })
  it('Reality Fracture is written in from its reference: cyan accent, indigo shell fonts, art, voice', () => {
    const theme = curatedThemeFor('fra')
    expect(theme.accent).toBe('#77E4EF')
    expect(theme.headingFont).toMatch(/Cormorant Garamond/)
    expect(theme.art.wide.src).toMatch(/echoverse-hero\.webp$/)
    expect(theme.art.portrait.srcset).toMatch(/480w/)
    expect(theme.voice.tagline).toBe('One world. Another possibility.')
    // The entry as written, dates included; buildSeasonTheme decides from the
    // release date whether it is still provisional.
    expect(theme.curatedAt).toBe('2026-09-17')
    // Null until the owner records a check against the released cards.
    expect(theme.checkedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(theme.checkedAt)).toBe(true)
    expect(theme.provisional).toBe(true)
  })
  it('takes precedence over the derived accent, and only for its set', () => {
    const theme = buildSeasonTheme([set('fra', '2026-11-14')], TODAY,
      { counts: { W: 0, U: 0, B: 0, R: 100, G: 0 }, total: 100 })
    expect(theme.derivedFrom).toBe('curated')
    expect(theme.accent).toBe('#77E4EF')
    const other = buildSeasonTheme([set('zzz', '2026-11-14')], TODAY)
    expect(other.derivedFrom).toBe('code')
  })
  it('the five schools are the five allied pairs in wheel order, each with discipline, virtue, horror and an emblem', () => {
    const schools = schoolsFor('fra')
    expect(Object.keys(schools)).toEqual(['WU', 'UB', 'BR', 'RG', 'GW'])
    for (const s of Object.values(schools)) {
      expect(s.name).toBeTruthy(); expect(s.discipline).toBeTruthy()
      expect(s.virtue.length).toBeGreaterThan(10); expect(s.horror.length).toBeGreaterThan(10)
      expect(s.emblem).toMatch(/schools\/[a-z]+\.svg$/)
      expect(s.accents).toHaveLength(3)
    }
    expect(schools.WU.name).toBe('Fatehold')
    expect(schools.UB.name).toBe('Theorix')
    expect(schools.BR.name).toBe('Stingerquill')
    expect(schools.RG.name).toBe('Konstrari')
    expect(schools.GW.name).toBe('Vigorbloom')
  })
  it('a single colour belongs to the two schools beside it on the wheel', () => {
    expect(schoolsForColor('W', 'fra').map((s) => s.name)).toEqual(['Fatehold', 'Vigorbloom'])
    expect(schoolsForColor('B', 'fra').map((s) => s.name)).toEqual(['Theorix', 'Stingerquill'])
    expect(schoolsForColor('W', 'nope')).toEqual([])
  })
  it('has no default set for schools: the caller names the one the season is on', () => {
    expect(schoolsFor()).toBeNull()
    expect(schoolsFor(null)).toBeNull()
    expect(schoolsForColor('W')).toEqual([])
    expect(schoolsFor('FRA')).toBe(schoolsFor('fra'))
    expect(loreFor('fra')).toMatchObject({ setName: 'Reality Fracture', academy: 'Hexhaven' })
    expect(loreFor('trk')).toBeNull()
    expect(loreFor(undefined)).toBeNull()
  })
  it('the schools follow the season focus: shown while it is Reality Fracture, gone once it moves on', () => {
    // The chain App.jsx and the first-deck flow run: season theme, the theme
    // set the shell wears, the lore written for it.
    const sets = [set('hob', '2026-08-14'), set('fra', '2026-10-02'), set('trk', '2026-11-13')]
    const loreOn = (day) => loreFor(themeSetFor(buildSeasonTheme(sets, day)))?.setName ?? null
    expect(loreOn('2026-09-21')).toBe('Reality Fracture')
    expect(loreOn('2026-10-02')).toBe('Reality Fracture')
    expect(loreOn('2026-10-23')).toBe('Reality Fracture')
    expect(loreOn('2026-10-24')).toBeNull()
    expect(loreOn('2026-12-01')).toBeNull()
    expect(themeSetFor(null)).toBeNull()
    expect(themeSetFor({ derivedFrom: 'code', set: { code: 'trk' } })).toBeNull()
  })
  it('the banner says the theme is the app’s reading, and how current it is, by the date', () => {
    // The entry without a check, so this holds once the owner adds one.
    const entry = { ...curatedThemeFor('fra'), checkedAt: null }
    // "17 Sep 2026" or "17 Sept 2026", as the runtime's own British date data
    // abbreviates September; tests/release.test.js checks the format itself.
    const written = releaseLabel(entry.curatedAt)
    const note = (day) => themeNote(curationStatus(entry, '2026-10-02', day))
    expect(note('2026-09-21')).toBe('Colours and lore here are the app’s own reading of public previews, not official.')
    expect(note('2026-10-02')).toBe('Colours and lore here are the app’s own reading, not official. '
      + `Written on ${written} from previews, before release on 2 Oct 2026; not yet checked against the released cards.`)
    expect(themeNote(curationStatus({ ...entry, checkedAt: '2026-10-09' }, '2026-10-02', '2026-10-20')))
      .toBe('Colours and lore here are the app’s own reading, not official. '
        + `Written on ${written} from previews, before release on 2 Oct 2026; checked against the released cards on 9 Oct 2026.`)
  })
  it('never shows the alias: "Shattered Reality" is Reality Fracture', () => {
    expect(canonicalSetName('Shattered Reality')).toBe('Reality Fracture')
    expect(canonicalSetName('shattered reality')).toBe('Reality Fracture')
    expect(canonicalSetName('Bloomburrow')).toBe('Bloomburrow')
  })
  it('every shipped asset the theme names exists', async () => {
    const { existsSync } = await import('node:fs')
    const entry = SET_THEMES.fra
    const paths = [entry.art.wide.src, entry.art.portrait.src, ...Object.values(entry.schools).map((s) => s.emblem)]
    for (const p of paths) expect(existsSync(`public/${p}`), p).toBe(true)
  })
})

describe('the token check', () => {
  it('reads tokens out of css blocks and diffs them against the stylesheet', () => {
    const doc = 'text\n```css\n:root { --accent: #fff; --new-thing: 1px; }\n.x { color: var(--text); }\n```\nnot css\n```js\n--not-counted\n```'
    const sheet = ':root { --accent: #000; --text: #eee; --only-here: 0; }'
    const r = compare([doc], sheet)
    expect(r.documented).toEqual(['--accent', '--new-thing', '--text'])
    expect(r.missingInStylesheet).toEqual(['--new-thing'])
    expect(r.undocumented).toEqual(['--only-here'])
  })
  it('has nothing to say with no documents', () => {
    expect(compare([], ':root { --a: 1 }').documented).toEqual([])
  })
})
