import { describe, it, expect } from 'vitest'
import {
  tokenize, parseColorSet, parseQuery, serialiseQuery,
  hasActiveFilters, clearFilters, emptyFilters, getSort, SORT_OPTIONS,
} from '../src/lib/query.js'

const round = (query) => serialiseQuery(parseQuery(query))

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('c:r t:goblin')).toEqual(['c:r', 't:goblin'])
  })

  it('keeps quoted strings whole', () => {
    expect(tokenize('o:"draw a card" c:u')).toEqual(['o:"draw a card"', 'c:u'])
  })

  it('keeps parenthesised groups whole', () => {
    expect(tokenize('(r:rare or r:mythic) c:g')).toEqual(['(r:rare or r:mythic)', 'c:g'])
  })

  it('collapses runs of whitespace', () => {
    expect(tokenize('  c:r    t:goblin  ')).toEqual(['c:r', 't:goblin'])
  })

  it('survives unbalanced quotes and parens rather than hanging', () => {
    expect(tokenize('o:"unclosed')).toEqual(['o:"unclosed'])
    expect(tokenize('(unclosed c:r')).toEqual(['(unclosed c:r'])
  })

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize(null)).toEqual([])
  })
})

describe('parseColorSet', () => {
  it('reads letters in any order and normalises to WUBRG', () => {
    expect(parseColorSet('gr')).toEqual({ colors: ['r', 'g'], colorless: false })
    expect(parseColorSet('rg')).toEqual({ colors: ['r', 'g'], colorless: false })
  })

  it('expands guild and shard names', () => {
    expect(parseColorSet('esper').colors).toEqual(['w', 'u', 'b'])
    expect(parseColorSet('boros').colors).toEqual(['w', 'r'])
    expect(parseColorSet('temur').colors).toEqual(['u', 'r', 'g'])
  })

  it('recognises colourless', () => {
    expect(parseColorSet('c')).toEqual({ colors: [], colorless: true })
    expect(parseColorSet('colorless').colorless).toBe(true)
  })

  it('rejects anything that is not a colour set', () => {
    expect(parseColorSet('goblin')).toBeNull()
    expect(parseColorSet('')).toBeNull()
    expect(parseColorSet('wx')).toBeNull()
  })
})

describe('parseQuery', () => {
  it('reads colour with each operator', () => {
    expect(parseQuery('c>=rg').colors).toMatchObject({ mode: 'includes', values: ['r', 'g'] })
    expect(parseQuery('c=rg').colors).toMatchObject({ mode: 'exactly' })
    expect(parseQuery('c<=rg').colors).toMatchObject({ mode: 'atMost' })
  })

  it('treats bare c: as "includes", which is what Scryfall does', () => {
    expect(parseQuery('c:rg').colors.mode).toBe('includes')
  })

  it('treats bare id: as "at most", which is the Commander question', () => {
    // "What may this deck legally contain" is id<=, not id>=.
    expect(parseQuery('id:wu').identity.mode).toBe('atMost')
  })

  it('reads types, mana value, format, rarity and price', () => {
    const filters = parseQuery('t:creature t:goblin cmc<=3 f:modern r:rare usd<=5')
    expect(filters.types).toEqual(['creature', 'goblin'])
    expect(filters.manaValue).toEqual({ op: '<=', value: 3 })
    expect(filters.format).toBe('modern')
    expect(filters.rarities).toEqual(['rare'])
    expect(filters.maxPrice).toBe(5)
  })

  it('normalises cmc: to cmc=', () => {
    expect(parseQuery('cmc:3').manaValue).toEqual({ op: '=', value: 3 })
  })

  it('accepts mv as an alias for cmc', () => {
    expect(parseQuery('mv>=6').manaValue).toEqual({ op: '>=', value: 6 })
  })

  it('collects free text separately from operators', () => {
    const filters = parseQuery('lightning bolt c:r')
    expect(filters.text).toBe('lightning bolt')
    expect(filters.colors.values).toEqual(['r'])
  })
})

describe('preserving what we do not model', () => {
  // This is the property the whole design rests on. A filter control that
  // silently drops the parts of a query it does not understand is worse than
  // no control, because the loss is invisible.
  it('keeps unmodelled operators verbatim', () => {
    const filters = parseQuery('is:commander o:"draw a card" c:u')
    expect(filters.raw).toEqual(['is:commander', 'o:"draw a card"'])
    expect(round('is:commander o:"draw a card" c:u')).toContain('is:commander')
    expect(round('is:commander o:"draw a card" c:u')).toContain('o:"draw a card"')
  })

  it('never folds a negation into a positive control', () => {
    // -t:creature must not become "types: [creature]", which would invert it.
    const filters = parseQuery('-t:creature')
    expect(filters.types).toEqual([])
    expect(filters.raw).toEqual(['-t:creature'])
    expect(round('-t:creature')).toBe('-t:creature')
  })

  it('preserves an operator we model but with an operator we do not', () => {
    // cmc!=3 is meaningful; we cannot represent it, so it must survive.
    expect(round('cmc!=3')).toBe('cmc!=3')
    expect(round('usd>20')).toBe('usd>20')
  })

  it('preserves a rarity value outside our list', () => {
    expect(round('r:special')).toBe('r:special')
  })

  it('preserves parenthesised groups', () => {
    expect(round('(t:goblin or t:elf) c:r')).toContain('(t:goblin or t:elf)')
  })

  it('survives a query made entirely of things it does not understand', () => {
    const query = 'is:split art:nicholas -is:reprint year>=2020'
    expect(round(query).split(' ').sort()).toEqual(query.split(' ').sort())
  })
})

describe('serialiseQuery', () => {
  it('emits explicit operators rather than the ambiguous shorthand', () => {
    expect(round('c:rg')).toBe('c>=rg')
    expect(round('id:esper')).toBe('id<=wub')
  })

  it('normalises colour order so the query is stable', () => {
    expect(round('c:gr')).toBe(round('c:rg'))
  })

  it('writes colourless correctly for each mode', () => {
    const filters = emptyFilters()
    filters.colors = { mode: 'exactly', values: [], colorless: true }
    expect(serialiseQuery(filters)).toBe('c=c')
  })

  it('groups multiple rarities into an or', () => {
    const filters = emptyFilters()
    filters.rarities = ['rare', 'mythic']
    expect(serialiseQuery(filters)).toBe('(r:rare or r:mythic)')
  })

  it('quotes a multi-word type', () => {
    const filters = emptyFilters()
    filters.types = ['legendary creature']
    expect(serialiseQuery(filters)).toBe('t:"legendary creature"')
  })

  it('puts free text first, where a reader expects it', () => {
    const filters = parseQuery('c:r bolt')
    expect(serialiseQuery(filters)).toBe('bolt c>=r')
  })

  it('produces an empty string for empty filters', () => {
    expect(serialiseQuery(emptyFilters())).toBe('')
  })

  it('is idempotent — serialising twice changes nothing', () => {
    const once = round('c:rg t:creature cmc<=3 f:modern')
    expect(round(once)).toBe(once)
  })
})

describe('hasActiveFilters', () => {
  it('is false for empty filters and for free text alone', () => {
    expect(hasActiveFilters(emptyFilters())).toBe(false)
    expect(hasActiveFilters(parseQuery('lightning bolt'))).toBe(false)
  })

  it('is true for any control being set', () => {
    expect(hasActiveFilters(parseQuery('c:r'))).toBe(true)
    expect(hasActiveFilters(parseQuery('cmc<=3'))).toBe(true)
    expect(hasActiveFilters(parseQuery('usd<=5'))).toBe(true)
  })

  it('is false for a query made only of unmodelled operators', () => {
    // Nothing the controls show is set, so "Clear filters" would be a lie.
    expect(hasActiveFilters(parseQuery('is:commander'))).toBe(false)
  })
})

describe('clearFilters', () => {
  it('keeps free text and unmodelled operators', () => {
    const filters = parseQuery('bolt c:r is:commander cmc<=3')
    const cleared = clearFilters(filters)
    expect(cleared.colors.values).toEqual([])
    expect(cleared.manaValue).toBeNull()
    expect(cleared.text).toBe('bolt')
    expect(cleared.raw).toEqual(['is:commander'])
    expect(serialiseQuery(cleared)).toBe('bolt is:commander')
  })
})

describe('sort options', () => {
  it('offers the orders Scryfall supports', () => {
    for (const option of SORT_OPTIONS) {
      expect(option.order).toBeTruthy()
      expect(['asc', 'desc']).toContain(option.defaultDir)
    }
  })

  it('defaults newest-first for release date and A-Z for name', () => {
    expect(getSort('released').defaultDir).toBe('desc')
    expect(getSort('name').defaultDir).toBe('asc')
  })

  it('falls back to name for an unknown id', () => {
    expect(getSort('nonsense').id).toBe('name')
  })
})
