import { describe, it, expect } from 'vitest'
import { SET_THEMES, curatedThemeFor, schoolsFor, schoolsForColor, canonicalSetName, LORE_SET } from '../src/data/set-themes.js'
import { buildSeasonTheme } from '../src/lib/season.js'
import { compare } from '../scripts/check-tokens.mjs'

const set = (code, releasedAt, extra = {}) => ({
  code, name: code.toUpperCase(), releasedAt, setType: 'expansion', digital: false, cardCount: 250,
  iconSvgUri: `https://svgs.scryfall.io/sets/${code}.svg`, ...extra,
})
const TODAY = '2026-09-16'

describe('curated set themes', () => {
  it('every entry is dated and says whether it is provisional', () => {
    for (const entry of Object.values(SET_THEMES)) {
      expect(entry.curatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof entry.provisional).toBe('boolean')
      expect(Array.isArray(entry.sources)).toBe(true)
    }
  })
  it('an entry without an accent applies nothing', () => {
    const saved = { ...SET_THEMES.fra }
    try {
      SET_THEMES.fra.accent = null
      expect(curatedThemeFor('fra')).toBeNull()
    } finally { Object.assign(SET_THEMES.fra, saved) }
    expect(curatedThemeFor('nope')).toBeNull()
    expect(LORE_SET).toBe('fra')
  })
  it('Reality Fracture is written in from its reference: cyan accent, indigo shell fonts, art, voice', () => {
    const theme = curatedThemeFor('fra')
    expect(theme.accent).toBe('#77E4EF')
    expect(theme.headingFont).toMatch(/Cormorant Garamond/)
    expect(theme.art.wide.src).toMatch(/echoverse-hero\.webp$/)
    expect(theme.art.portrait.srcset).toMatch(/480w/)
    expect(theme.voice.tagline).toBe('One world. Another possibility.')
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
    expect(schoolsForColor('W').map((s) => s.name)).toEqual(['Fatehold', 'Vigorbloom'])
    expect(schoolsForColor('B').map((s) => s.name)).toEqual(['Theorix', 'Stingerquill'])
    expect(schoolsForColor('W', 'nope')).toEqual([])
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
