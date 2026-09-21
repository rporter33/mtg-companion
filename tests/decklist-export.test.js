import { describe, it, expect } from 'vitest'
import { parseDecklist, deckToText, printingText, decklistLine } from '../src/lib/decklist.js'
import { toDecklistText } from '../src/lib/deck-sources.js'

/**
 * The decklist the app writes carries each card's printing, and reads back to
 * the same printing. Card records here are hand-written in Scryfall's shape.
 */

const cards = {
  cmdr: { id: 'cmdr', name: 'Esika, God of the Tree // The Prismatic Bridge', set: 'khm', collector_number: '168' },
  island: { id: 'island', name: 'Island', set: 'hob', collector_number: '195' },
  list: { id: 'list', name: 'Lightning Bolt', set: 'plst', collector_number: 'CLB-187' },
  lair: { id: 'lair', name: 'Lightning Bolt', set: 'sld', collector_number: 'IFIYW-7' },
  star: { id: 'star', name: 'Sol Ring', set: 'cmm', collector_number: '12★' },
  alchemy: { id: 'alchemy', name: 'A-Sol Ring', set: 'yone', collector_number: 'A-12' },
  erase: { id: 'erase', name: "Erase (Not the Urza's Legacy One)", set: 'unh', collector_number: '7' },
  odd: { id: 'odd', name: 'Odd Number', set: 'sld', collector_number: 'not a number' },
  noset: { id: 'noset', name: 'No Set' },
}
const lookup = (id) => cards[id]

const deck = {
  commanders: ['cmdr'],
  signatureSpell: null,
  main: ['island', 'list', 'lair', 'star', 'alchemy', 'erase', 'odd', 'noset'].map((cardId, i) => ({ cardId, quantity: i + 1 })),
  sideboard: [{ cardId: 'island', quantity: 2 }],
}

describe('the decklist the app writes', () => {
  it('writes each card with its set and collector number', () => {
    const text = deckToText(deck, lookup)
    expect(text).toContain('Commander\n1 Esika, God of the Tree // The Prismatic Bridge (KHM) 168\n\nDeck')
    expect(text).toContain('1 Island (HOB) 195')
    expect(text).toContain('2 Lightning Bolt (PLST) CLB-187')
    expect(text).toContain('3 Lightning Bolt (SLD) IFIYW-7')
    expect(text).toContain('Sideboard\n2 Island (HOB) 195')
  })

  it('reads back to the same printing, line for line', () => {
    const parsed = parseDecklist(deckToText(deck, lookup))
    const written = [
      ...deck.commanders.map((id) => ['commander', id]),
      ...deck.main.map((e) => ['main', e.cardId]),
      ...deck.sideboard.map((e) => ['sideboard', e.cardId]),
    ]
    expect(parsed).toHaveLength(written.length)
    parsed.forEach((line, i) => {
      const [section, id] = written[i]
      const card = cards[id]
      expect(line.section).toBe(section)
      expect(line.name).toBe(card.name)
      if (id === 'odd') {
        // A number the parser could not read back goes unwritten; the set stays.
        expect(line).toMatchObject({ set: 'sld' })
        expect(line.number).toBeUndefined()
      } else if (id === 'noset') {
        expect(line.set).toBeUndefined()
      } else {
        expect(line.set).toBe(card.set)
        expect(line.number).toBe(card.collector_number)
      }
    })
  })

  it('writes a card that has not loaded as it always has', () => {
    const text = deckToText({ commanders: [], main: [{ cardId: 'abcdef1234567890', quantity: 1 }], sideboard: [] }, () => undefined)
    expect(text).toBe('Deck\n1 (unloaded abcdef12)')
  })

  it('reads a deck an older build saved without its sections', () => {
    expect(deckToText({ main: [{ cardId: 'island', quantity: 4 }, null] }, lookup)).toBe('Deck\n4 Island (HOB) 195')
    expect(deckToText(null, lookup)).toBe('Deck')
  })

  it('writes only what the parser reads back', () => {
    expect(printingText({ set: 'hob', number: '195' })).toBe('(HOB) 195')
    expect(printingText({ set: 'hob', number: 'x y' })).toBe('(HOB)')
    expect(printingText({ set: 'not a set', number: '1' })).toBe('')
    expect(printingText({})).toBe('')
    expect(decklistLine(4, 'Island')).toBe('4 Island')
  })
})

describe('the parser reads the collector numbers sites write', () => {
  it('reads The List and lettered Secret Lair numbers as numbers', () => {
    expect(parseDecklist('1 Lightning Bolt (PLST) CLB-187')[0]).toMatchObject({ name: 'Lightning Bolt', set: 'plst', number: 'CLB-187' })
    expect(parseDecklist('1 Lightning Bolt (sld) IFIYW-7')[0]).toMatchObject({ name: 'Lightning Bolt', set: 'sld', number: 'IFIYW-7' })
    expect(parseDecklist('1x Lightning Bolt (plst) 2XM-117 [Removal]')[0])
      .toMatchObject({ name: 'Lightning Bolt', set: 'plst', number: '2XM-117', category: 'Removal' })
  })
})

describe('a parsed deck written back as text', () => {
  it('keeps a printing an entry carries, and writes a name alone as a name', () => {
    const text = toDecklistText({
      commanders: [{ name: 'Atraxa', quantity: 1, set: 'c16', number: '28' }],
      main: [{ name: 'Forest', quantity: 30 }, { name: 'Lightning Bolt', quantity: 1, set: 'plst', number: 'CLB-187' }],
    })
    expect(text).toContain('Commander\n1 Atraxa (C16) 28')
    expect(text).toContain('30 Forest\n1 Lightning Bolt (PLST) CLB-187')
    const parsed = parseDecklist(text)
    expect(parsed[2]).toMatchObject({ name: 'Lightning Bolt', set: 'plst', number: 'CLB-187' })
  })
})
