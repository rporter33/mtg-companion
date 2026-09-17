import { describe, it, expect } from 'vitest'
import { normalize, termsOf, haystackOf, matches, filterSections, statusLine } from '../src/lib/deck-find.js'

const card = (name, type_line, over = {}) => ({ id: name, name, type_line, ...over })
const BOLT = card('Lightning Bolt', 'Instant')
const ELVES = card('Llanowar Elves', 'Creature — Elf Druid')
const JOTUN = card('Jötun Grunt', 'Creature — Giant Soldier')
const VAULT = card("Lim-Dûl's Vault", 'Instant')
const ABBEY = card('Westvale Abbey // Ormendahl, Profane Prince', undefined, {
  card_faces: [
    { name: 'Westvale Abbey', type_line: 'Land' },
    { name: 'Ormendahl, Profane Prince', type_line: 'Legendary Creature — Demon' },
  ],
})

describe('normalize', () => {
  it('folds accents, case, punctuation and spacing', () => {
    expect(normalize("Lim-Dûl's Vault")).toBe('lim duls vault')
    expect(normalize('Jötun Grunt')).toBe('jotun grunt')
    expect(normalize('Jace, the Mind Sculptor')).toBe('jace the mind sculptor')
    expect(normalize('  Draw   Two ')).toBe('draw two')
  })
  it('treats a curly apostrophe like a straight one', () => {
    expect(normalize('Lim-Dûl’s')).toBe(normalize("Lim-Dûl's"))
  })
  it('is empty for blank, dashes only, and nothing', () => {
    expect(normalize('')).toBe('')
    expect(normalize('   ')).toBe('')
    expect(normalize('—')).toBe('')
    expect(normalize(undefined)).toBe('')
  })
})

describe('termsOf', () => {
  it('returns the same frozen empty array for every blank query', () => {
    expect(termsOf('')).toBe(termsOf('   '))
    expect(termsOf('')).toHaveLength(0)
    expect(Object.isFrozen(termsOf(''))).toBe(true)
  })
  it('splits on whitespace after folding', () => {
    expect(termsOf('Draw  Two')).toEqual(['draw', 'two'])
    expect(termsOf('Jötun')).toEqual(['jotun'])
  })
})

describe('haystackOf', () => {
  it('covers the name, every face name and the whole type line', () => {
    const hay = haystackOf(ABBEY)
    expect(hay).toContain('westvale abbey')
    expect(hay).toContain('ormendahl')
    expect(hay).toContain('land')
    expect(hay).toContain('demon')
  })
  it('is empty for a card that has not loaded', () => {
    expect(haystackOf(undefined)).toBe('')
    expect(haystackOf(null)).toBe('')
  })
  it('is cached per card object', () => {
    expect(haystackOf(BOLT)).toBe(haystackOf(BOLT))
    expect(haystackOf({ ...BOLT })).toBe(haystackOf(BOLT))
  })
})

describe('matches', () => {
  it('finds by name, by type line and by keyword in the type', () => {
    expect(matches(BOLT, termsOf('bolt'))).toBe(true)
    expect(matches(BOLT, termsOf('instant'))).toBe(true)
    expect(matches(ELVES, termsOf('instant'))).toBe(false)
    expect(matches(ELVES, termsOf('druid'))).toBe(true)
  })
  it('needs every word, in any order', () => {
    expect(matches(ELVES, termsOf('elf druid'))).toBe(true)
    expect(matches(ELVES, termsOf('druid elf'))).toBe(true)
    expect(matches(ELVES, termsOf('elf bolt'))).toBe(false)
  })
  it('ignores accents and apostrophes the way a phone keyboard would', () => {
    expect(matches(JOTUN, termsOf('jotun'))).toBe(true)
    expect(matches(VAULT, termsOf('duls'))).toBe(true)
    expect(matches(VAULT, termsOf("dul's"))).toBe(true)
    expect(matches(VAULT, termsOf('lim dul'))).toBe(true)
  })
  it('reads the back face of a double-faced card', () => {
    expect(matches(ABBEY, termsOf('ormendahl'))).toBe(true)
    expect(matches(ABBEY, termsOf('demon'))).toBe(true)
  })
  it('never matches a card that has not loaded, and matches everything with no terms', () => {
    expect(matches(undefined, termsOf('bolt'))).toBe(false)
    expect(matches(undefined, termsOf(''))).toBe(true)
    expect(matches(BOLT, termsOf(''))).toBe(true)
  })
})

describe('filterSections', () => {
  const entry = (card, quantity = 1) => ({ cardId: card?.id ?? 'ghost', quantity, card, zone: 'main' })
  const groups = [
    { name: 'Commander', entries: [entry(card('Test Commander', 'Legendary Creature — Elf'))], count: 1, price: { total: 5 } },
    { name: 'Creatures', entries: [entry(ELVES, 2), entry(JOTUN)], count: 3, price: { total: 2 } },
    { name: 'Instants', entries: [entry(BOLT), entry(VAULT)], count: 2, price: { total: 4 } },
    { name: 'Other', entries: [entry(undefined, 3)], count: 3, price: { total: 0 } },
  ]

  it('returns the very same groups when there is no filter', () => {
    const result = filterSections(groups, null)
    expect(result.sections).toBe(groups)
    expect(result.active).toBe(false)
    expect(result.matched).toBe(9)
    expect(result.total).toBe(9)
    expect(result.unloaded).toBe(0)
  })
  it('keeps only sections with a match, with entries intact and shown beside them', () => {
    const terms = termsOf('instant')
    const result = filterSections(groups, (e) => matches(e.card, terms))
    expect(result.sections.map((s) => s.name)).toEqual(['Instants'])
    expect(result.sections[0].entries).toBe(groups[2].entries)
    expect(result.sections[0].shown.map((e) => e.card.name)).toEqual(['Lightning Bolt', "Lim-Dûl's Vault"])
    expect(result.sections[0].shownCount).toBe(2)
    expect(result.sections[0].count).toBe(2)
    expect(result.active).toBe(true)
  })
  it('counts matches by quantity and never counts an unloaded card as matched', () => {
    const terms = termsOf('elf')
    const result = filterSections(groups, (e) => matches(e.card, terms))
    expect(result.sections.map((s) => s.name)).toEqual(['Commander', 'Creatures'])
    expect(result.matched).toBe(3)
    expect(result.total).toBe(9)
    expect(result.unloaded).toBe(3)
  })
  it('reports nothing matched without throwing', () => {
    const terms = termsOf('zzz')
    const result = filterSections(groups, (e) => matches(e.card, terms))
    expect(result.sections).toEqual([])
    expect(result.matched).toBe(0)
  })
  it('does not mutate the groups it is given', () => {
    const before = JSON.stringify(groups)
    filterSections(groups, () => true)
    expect(JSON.stringify(groups)).toBe(before)
  })
})

describe('statusLine', () => {
  it('is silent when idle and honest when searching', () => {
    expect(statusLine({ active: false, matched: 9, total: 9, unloaded: 0 })).toBe('')
    expect(statusLine({ active: true, matched: 3, total: 100, unloaded: 0 })).toBe('3 of 100 cards match')
    expect(statusLine({ active: true, matched: 0, total: 100, unloaded: 0 })).toBe('No cards match')
    expect(statusLine({ active: true, matched: 3, total: 100, unloaded: 2 })).toBe('3 of 100 cards match · 2 not loaded, not searched')
  })
})
