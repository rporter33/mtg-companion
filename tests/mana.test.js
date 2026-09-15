import { describe, it, expect } from 'vitest'
import { parseManaCost, classifySymbol, countPips, faceManaCost } from '../src/lib/mana.js'

describe('parseManaCost', () => {
  it('splits a plain cost into symbol bodies', () => {
    expect(parseManaCost('{2}{W}{U}')).toEqual(['2', 'W', 'U'])
  })

  it('returns an empty array for lands and missing costs', () => {
    expect(parseManaCost('')).toEqual([])
    expect(parseManaCost(null)).toEqual([])
    expect(parseManaCost(undefined)).toEqual([])
  })

  it('keeps compound symbols intact', () => {
    expect(parseManaCost('{X}{B/R}{W/P}{2/U}')).toEqual(['X', 'B/R', 'W/P', '2/U'])
  })
})

describe('classifySymbol', () => {
  it('reads generic, variable and colourless symbols', () => {
    expect(classifySymbol('3')).toMatchObject({ kind: 'generic', generic: 3 })
    expect(classifySymbol('X')).toMatchObject({ kind: 'variable' })
    expect(classifySymbol('C')).toMatchObject({ kind: 'colorless' })
    expect(classifySymbol('S')).toMatchObject({ kind: 'snow' })
  })

  it('reads the five colours', () => {
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      expect(classifySymbol(c)).toMatchObject({ kind: 'colored', colors: [c] })
    }
  })

  it('distinguishes hybrid from monocolour hybrid from phyrexian', () => {
    expect(classifySymbol('B/R')).toMatchObject({ kind: 'hybrid', colors: ['B', 'R'] })
    expect(classifySymbol('2/U')).toMatchObject({ kind: 'monocolor-hybrid', colors: ['U'], generic: 2 })
    expect(classifySymbol('W/P')).toMatchObject({ kind: 'phyrexian', colors: ['W'] })
  })

  it('handles two-colour phyrexian symbols', () => {
    expect(classifySymbol('B/G/P')).toMatchObject({ kind: 'phyrexian', colors: ['B', 'G'] })
  })
})

describe('countPips', () => {
  it('counts coloured pips and ignores generic', () => {
    expect(countPips('{2}{U}{U}')).toMatchObject({ U: 2, W: 0, B: 0, R: 0, G: 0 })
  })

  it('counts a hybrid pip toward both of its colours', () => {
    // Deliberate over-count: we would rather advise more sources than fewer.
    expect(countPips('{B/R}')).toMatchObject({ B: 1, R: 1 })
  })

  it('counts phyrexian pips toward their colour', () => {
    expect(countPips('{W/P}{W/P}')).toMatchObject({ W: 2 })
  })

  it('ignores X entirely', () => {
    expect(countPips('{X}{X}{R}')).toMatchObject({ R: 1 })
  })
})

describe('faceManaCost', () => {
  it('falls back to the front face for double-faced cards', () => {
    const dfc = { card_faces: [{ mana_cost: '{1}{R}' }, { mana_cost: '' }] }
    expect(faceManaCost(dfc)).toBe('{1}{R}')
  })

  it('prefers a top-level cost when present', () => {
    expect(faceManaCost({ mana_cost: '{G}', card_faces: [{ mana_cost: '{U}' }] })).toBe('{G}')
  })
})
