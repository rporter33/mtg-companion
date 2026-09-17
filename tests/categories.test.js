import { describe, it, expect } from 'vitest'
import {
  categoryOf, setCategory, renameCategory, clearCategory,
  categoryNames, moveCategory, deckSections, isChosen, COMMANDER_CATEGORY,
} from '../src/lib/categories.js'

const card = (name, type_line, prices = { usd: '1.00' }) => ({
  name, type_line, prices, cmc: 2, colors: [],
})

const CARDS = {
  elf: card('Llanowar Elves', 'Creature — Elf Druid'),
  bolt: card('Lightning Bolt', 'Instant'),
  ring: card('Sol Ring', 'Artifact', { usd: '2.00' }),
  forest: card('Forest', 'Basic Land — Forest', {}),
  atraxa: card('Atraxa', 'Legendary Creature — Angel'),
}
const lookup = (id) => CARDS[id]

const deck = () => ({
  id: 'd1',
  commanders: ['atraxa'],
  signatureSpell: null,
  main: [
    { cardId: 'elf', quantity: 1 },
    { cardId: 'bolt', quantity: 1 },
    { cardId: 'ring', quantity: 1 },
    { cardId: 'forest', quantity: 8 },
  ],
  sideboard: [],
  categoryOrder: [],
})

describe('categoryOf', () => {
  it('uses the type when nobody has chosen one', () => {
    expect(categoryOf({ cardId: 'elf' }, CARDS.elf)).toBe('Creatures')
  })

  it('prefers a chosen name', () => {
    expect(categoryOf({ cardId: 'elf', category: 'Ramp' }, CARDS.elf)).toBe('Ramp')
  })

  it('ignores a name that is only whitespace', () => {
    expect(categoryOf({ cardId: 'elf', category: '   ' }, CARDS.elf)).toBe('Creatures')
  })

  it('trims what it is given', () => {
    expect(categoryOf({ cardId: 'elf', category: '  Ramp  ' }, CARDS.elf)).toBe('Ramp')
  })

  it('has an answer for a card that has not loaded', () => {
    expect(categoryOf({ cardId: 'unknown' }, undefined)).toBe('Other')
  })
})

describe('setCategory', () => {
  it('files a card where it is told', () => {
    const next = setCategory(deck(), 'bolt', 'Removal')
    expect(next.main.find((e) => e.cardId === 'bolt').category).toBe('Removal')
  })

  it('leaves every other card alone', () => {
    const next = setCategory(deck(), 'bolt', 'Removal')
    expect(next.main.find((e) => e.cardId === 'elf').category).toBeUndefined()
  })

  // Clearing must remove the key, not set it to null — "null" is a section name
  // a player would then see on screen.
  it('clearing puts the card back under its type', () => {
    const next = clearCategory(setCategory(deck(), 'bolt', 'Removal'), 'Removal')
    const entry = next.main.find((e) => e.cardId === 'bolt')
    expect('category' in entry).toBe(false)
    expect(categoryOf(entry, CARDS.bolt)).toBe('Instants')
  })

  it('treats an empty name as clearing', () => {
    const next = setCategory(setCategory(deck(), 'bolt', 'Removal'), 'bolt', '   ')
    expect('category' in next.main.find((e) => e.cardId === 'bolt')).toBe(false)
  })

  it('records that the deck changed', () => {
    expect(setCategory(deck(), 'bolt', 'Removal').updatedAt).toBeTruthy()
  })
})

describe('renameCategory', () => {
  it('renames a section somebody chose', () => {
    const one = setCategory(deck(), 'bolt', 'Removal')
    const two = renameCategory(one, 'Removal', 'Interaction')
    expect(two.main.find((e) => e.cardId === 'bolt').category).toBe('Interaction')
  })

  // Nothing says "Creatures" anywhere — those cards simply are creatures. So a
  // rename has to write the new name onto them, or it silently does nothing.
  it('renaming a derived section writes the name onto its cards', () => {
    const next = renameCategory(deck(), 'Creatures', 'Beaters', ['elf'])
    expect(next.main.find((e) => e.cardId === 'elf').category).toBe('Beaters')
    expect(deckSections(next, lookup).map((s) => s.name)).toContain('Beaters')
  })

  it('does not drag in cards that were not in that section', () => {
    const next = renameCategory(deck(), 'Creatures', 'Beaters', ['elf'])
    expect(next.main.find((e) => e.cardId === 'bolt').category).toBeUndefined()
  })

  it('keeps the section in the same place in the order', () => {
    const one = { ...setCategory(deck(), 'bolt', 'Removal'), categoryOrder: ['Removal', 'Creatures'] }
    expect(renameCategory(one, 'Removal', 'Interaction').categoryOrder).toEqual(['Interaction', 'Creatures'])
  })

  it('refuses an empty or unchanged name rather than making a mess', () => {
    const before = setCategory(deck(), 'bolt', 'Removal')
    expect(renameCategory(before, 'Removal', '  ')).toBe(before)
    expect(renameCategory(before, 'Removal', 'Removal')).toBe(before)
  })
})

describe('categoryNames and isChosen', () => {
  it('lists chosen sections before derived ones', () => {
    const next = setCategory(deck(), 'bolt', 'Removal')
    expect(categoryNames(next, lookup)[0]).toBe('Removal')
  })

  it('does not list the same section twice', () => {
    const next = setCategory(setCategory(deck(), 'bolt', 'Removal'), 'ring', 'Removal')
    expect(categoryNames(next, lookup).filter((n) => n === 'Removal')).toHaveLength(1)
  })

  it('knows which sections a person made', () => {
    const next = setCategory(deck(), 'bolt', 'Removal')
    expect(isChosen(next, 'Removal')).toBe(true)
    expect(isChosen(next, 'Creatures')).toBe(false)
  })
})

describe('moveCategory', () => {
  it('moves a section down', () => {
    const next = moveCategory(deck(), 'Creatures', 1, ['Creatures', 'Instants', 'Artifacts'])
    expect(next.categoryOrder.indexOf('Creatures')).toBe(1)
  })

  it('will not move a section off either end', () => {
    const start = { ...deck(), categoryOrder: ['Creatures', 'Instants'] }
    expect(moveCategory(start, 'Creatures', -1)).toBe(start)
    expect(moveCategory(start, 'Instants', 1)).toBe(start)
  })

  it('changes the order sections come back in', () => {
    const next = moveCategory(deck(), 'Artifacts', -2, ['Creatures', 'Instants', 'Artifacts'])
    const names = deckSections(next, lookup).map((s) => s.name)
    expect(names.indexOf('Artifacts')).toBeLessThan(names.indexOf('Instants'))
  })
})

describe('deckSections', () => {
  it('always leads with the commander', () => {
    expect(deckSections(deck(), lookup)[0].name).toBe(COMMANDER_CATEGORY)
  })

  it('files everything else by type until told otherwise', () => {
    expect(deckSections(deck(), lookup).map((s) => s.name))
      .toEqual([COMMANDER_CATEGORY, 'Creatures', 'Instants', 'Artifacts', 'Lands'])
  })

  it('counts by quantity and prices each section', () => {
    const lands = deckSections(deck(), lookup).find((s) => s.name === 'Lands')
    expect(lands.count).toBe(8)
    expect(lands.price).toMatchObject({ total: 0, missing: 8 })
    expect(deckSections(deck(), lookup).find((s) => s.name === 'Artifacts').price.total).toBe(2)
  })

  it('marks which sections a person made', () => {
    const next = setCategory(deck(), 'bolt', 'Removal')
    expect(deckSections(next, lookup).find((s) => s.name === 'Removal').chosen).toBe(true)
  })

  it('keeps the sideboard last wherever it is', () => {
    const next = { ...deck(), sideboard: [{ cardId: 'bolt', quantity: 2 }] }
    expect(deckSections(next, lookup).at(-1).name).toBe('Sideboard')
  })

  it('ignores a category written on a sideboard card, which has its own section', () => {
    const next = { ...deck(), sideboard: [{ cardId: 'bolt', quantity: 2, category: 'Removal' }] }
    expect(deckSections(next, lookup).at(-1).name).toBe('Sideboard')
  })

  it('does not crash on a card that has not loaded', () => {
    const next = { ...deck(), main: [...deck().main, { cardId: 'ghost', quantity: 1 }] }
    expect(() => deckSections(next, lookup)).not.toThrow()
    expect(deckSections(next, lookup).some((s) => s.name === 'Other')).toBe(true)
  })

  it('handles an empty deck', () => {
    expect(deckSections({ commanders: [], main: [], sideboard: [] }, lookup)).toEqual([])
  })
})
