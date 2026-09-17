import { describe, it, expect } from 'vitest'
import { groupDeck, typeGroupOf, colorGroupOf, manaValueGroupOf, GROUPINGS, getGrouping } from '../src/lib/grouping.js'

const card = (name, type_line, extra = {}) => ({
  name, type_line, prices: { usd: '1.00' }, colors: [], cmc: 2, ...extra,
})

describe('typeGroupOf', () => {
  it.each([
    ['Llanowar Elves', 'Creature — Elf Druid', 'creature'],
    ['Lightning Bolt', 'Instant', 'instant'],
    ['Cultivate', 'Sorcery', 'sorcery'],
    ['Sol Ring', 'Artifact', 'artifact'],
    ['Rhystic Study', 'Enchantment', 'enchantment'],
    ['Teferi', 'Legendary Planeswalker — Teferi', 'planeswalker'],
    ['Forest', 'Basic Land — Forest', 'land'],
  ])('files %s under %s', (name, line, expected) => {
    expect(typeGroupOf(card(name, line)).id).toBe(expected)
  })

  // A card is usually several types at once; the useful answer is the one a
  // player would file it under.
  it('files an artifact creature under creatures', () => {
    expect(typeGroupOf(card('Solemn Simulacrum', 'Artifact Creature — Golem')).id).toBe('creature')
  })

  it('files an artifact land under lands', () => {
    expect(typeGroupOf(card('Seat of the Synod', 'Artifact Land')).id).toBe('land')
  })

  it('files an enchantment creature under creatures', () => {
    expect(typeGroupOf(card('Sythis', 'Legendary Enchantment Creature — Nymph')).id).toBe('creature')
  })

  // The MDFC trap: "Sorcery // Land" is a sorcery you may play as a land, and
  // counting it as a land overstates the mana base.
  it('files a modal double-faced card by its front face', () => {
    const bala = card('Bala Ged Recovery', 'Sorcery // Land', {
      card_faces: [{ type_line: 'Sorcery' }, { type_line: 'Land' }],
    })
    expect(typeGroupOf(bala).id).toBe('sorcery')
  })

  it('files a genuine transforming land under lands', () => {
    const land = card('Restless Anchorage', 'Land', {
      card_faces: [{ type_line: 'Land' }, { type_line: 'Creature — Bird' }],
    })
    expect(typeGroupOf(land).id).toBe('land')
  })

  it('has somewhere to put anything it does not know', () => {
    expect(typeGroupOf(card('Weird', 'Conspiracy')).id).toBe('other')
  })
})

describe('colorGroupOf', () => {
  it.each([
    [['G'], 'G'],
    [['W', 'U'], 'multicolor'],
    [[], 'colorless'],
  ])('groups %s as %s', (colors, expected) => {
    expect(colorGroupOf(card('X', 'Creature', { colors })).id).toBe(expected)
  })

  it('keeps lands out of colourless, where they would swamp it', () => {
    expect(colorGroupOf(card('Forest', 'Basic Land — Forest', { colors: [] })).id).toBe('land')
  })
})

describe('manaValueGroupOf', () => {
  it('buckets by mana value', () => {
    expect(manaValueGroupOf(card('X', 'Instant', { cmc: 3 })).id).toBe('mv3')
  })

  it('collapses the top end, where the counts are tiny', () => {
    expect(manaValueGroupOf(card('X', 'Creature', { cmc: 11 })).id).toBe('mv7')
    expect(manaValueGroupOf(card('X', 'Creature', { cmc: 11 })).label).toBe('7+ mana')
  })

  it('separates lands, which have no meaningful mana value', () => {
    expect(manaValueGroupOf(card('Forest', 'Basic Land — Forest', { cmc: 0 })).id).toBe('land')
  })
})

describe('groupDeck', () => {
  const resolved = [
    { card: card('Forest', 'Basic Land — Forest', { prices: {} }), quantity: 8 },
    { card: card('Llanowar Elves', 'Creature — Elf Druid'), quantity: 1 },
    { card: card('Sol Ring', 'Artifact', { prices: { usd: '2.00' } }), quantity: 1 },
  ]
  const pinned = [{ card: card('Atraxa', 'Legendary Creature — Phyrexian Angel'), quantity: 1 }]

  it('puts the commander first, because that is how a deck is read', () => {
    expect(groupDeck(resolved, { pinned })[0].id).toBe('commander')
  })

  it('keeps the commander out of the creature section it would otherwise join', () => {
    const creatures = groupDeck(resolved, { pinned }).find((g) => g.id === 'creature')
    expect(creatures.entries.map((e) => e.card.name)).toEqual(['Llanowar Elves'])
  })

  it('counts by quantity, not by row', () => {
    expect(groupDeck(resolved).find((g) => g.id === 'land').count).toBe(8)
  })

  it('prices each section, and says what it could not price', () => {
    const lands = groupDeck(resolved).find((g) => g.id === 'land')
    expect(lands.price).toMatchObject({ total: 0, missing: 8 })
    expect(groupDeck(resolved).find((g) => g.id === 'artifact').price.total).toBe(2)
  })

  it('orders sections the same way every time, with lands last', () => {
    // Lands are matched first so an artifact land is a land, but they are shown
    // last — precedence and display are different orders.
    const ids = groupDeck(resolved, { pinned }).map((g) => g.id)
    expect(ids).toEqual(['commander', 'creature', 'artifact', 'land'])
  })

  it('sorts within a section by name', () => {
    const many = [
      { card: card('Zealot', 'Creature — Human'), quantity: 1 },
      { card: card('Aardvark', 'Creature — Beast'), quantity: 1 },
    ]
    expect(groupDeck(many)[0].entries.map((e) => e.card.name)).toEqual(['Aardvark', 'Zealot'])
  })

  it('leaves out sections with nothing in them', () => {
    expect(groupDeck(resolved).map((g) => g.id)).not.toContain('instant')
  })

  it('handles an empty deck', () => {
    expect(groupDeck([])).toEqual([])
    expect(groupDeck(undefined)).toEqual([])
  })

  it('groups by colour and by mana value too', () => {
    expect(groupDeck(resolved, { groupBy: 'color' }).some((g) => g.id === 'colorless')).toBe(true)
    expect(groupDeck(resolved, { groupBy: 'mana' }).some((g) => g.id === 'mv2')).toBe(true)
  })

  it('falls back to type grouping rather than breaking on an unknown mode', () => {
    expect(getGrouping('nonsense').id).toBe('type')
    expect(groupDeck(resolved, { groupBy: 'nonsense' })[0].id).toBe('creature')
  })

  it('exposes every mode it supports', () => {
    expect(GROUPINGS.map((g) => g.id)).toEqual(['type', 'color', 'mana'])
  })
})
