import { describe, it, expect } from 'vitest'
import { normalize, termsOf, haystackOf, matches, filterSections, statusLine, parseFind, matchesFind } from '../src/lib/deck-find.js'

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

/**
 * The prefixes the module's own comment promised.
 *
 * A bare query still reads names and type lines only — "draw" must not light
 * up half a deck — and rules text is reachable only when you ask for it by
 * name. The vocabulary is Scryfall's, which is also Moxgate's, so nobody has
 * to learn a third one.
 */
describe('finding with a prefix', () => {
  const bear = { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' }
  const bolt = { name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.' }
  const wrenn = {
    name: 'Wrenn and Six',
    type_line: 'Legendary Planeswalker — Wrenn',
    oracle_text: 'Return up to one target land card from your graveyard to your hand.',
  }
  const room = {
    name: 'Bottomless Pool // Locker Room',
    card_faces: [
      { name: 'Bottomless Pool', type_line: 'Enchantment — Room', oracle_text: 'When you unlock this door, return a creature.' },
      { name: 'Locker Room', type_line: 'Enchantment — Room', oracle_text: 'Creatures you control get +1/+1.' },
    ],
  }
  const all = [bear, bolt, wrenn, room]
  const found = (query) => all.filter((card) => matchesFind(card, parseFind(query))).map((card) => card.name)

  it('reads the type line with t:', () => {
    expect(found('t:creature')).toEqual(['Grizzly Bears'])
    expect(found('t:planeswalker')).toEqual(['Wrenn and Six'])
  })

  it('reads rules text with o:, which a bare query still will not', () => {
    expect(found('o:damage')).toEqual(['Lightning Bolt'])
    expect(found('damage')).toEqual([])
  })

  it('reads the name alone with name:', () => {
    // "bolt" is in Lightning Bolt's rules text as well as its name, so this
    // only proves anything because the type line does not carry it.
    expect(found('name:wrenn')).toEqual(['Wrenn and Six'])
  })

  it('takes type: and text: written out', () => {
    expect(found('type:instant')).toEqual(['Lightning Bolt'])
    expect(found('text:graveyard')).toEqual(['Wrenn and Six'])
  })

  it('combines a prefix with plain words', () => {
    expect(found('t:creature bear')).toEqual(['Grizzly Bears'])
    expect(found('t:creature bolt')).toEqual([])
  })

  it('combines two prefixes', () => {
    expect(found('t:instant o:damage')).toEqual(['Lightning Bolt'])
    expect(found('t:instant o:graveyard')).toEqual([])
  })

  it('reads both faces of a double-faced card', () => {
    expect(found('name:locker')).toEqual(['Bottomless Pool // Locker Room'])
    expect(found('o:unlock')).toEqual(['Bottomless Pool // Locker Room'])
    expect(found('t:room')).toEqual(['Bottomless Pool // Locker Room'])
  })

  it('treats an unknown prefix as ordinary words, so a real name still finds it', () => {
    expect(parseFind('zz:nope').fielded).toEqual([])
    expect(parseFind('zz:nope').terms).toEqual(['zz', 'nope'])
  })

  it('ignores a prefix with nothing after it rather than matching everything', () => {
    expect(parseFind('t:').fielded).toEqual([])
    expect(found('t: bear')).toEqual(['Grizzly Bears'])
  })

  it('matches everything on an empty query, and nothing on a missing card', () => {
    expect(found('')).toEqual(all.map((card) => card.name))
    expect(matchesFind(null, parseFind('bear'))).toBe(false)
  })
})
