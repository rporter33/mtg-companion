import { describe, it, expect } from 'vitest'
import { seatDeck, engineName, leaveOut, verdictOf, nameList } from '../src/lib/engine/deck.js'

const cards = {
  a: { name: 'Mountain' },
  b: { name: 'Mountain' },
  c: { name: 'Raging Goblin' },
}
const lookup = (id) => cards[id] ?? null

describe('a deck made ready for the engine', () => {
  it('counts each name once, however many printings it arrives as', () => {
    const seat = seatDeck({ main: [{ cardId: 'a', quantity: 10 }, { cardId: 'b', quantity: 4 }, { cardId: 'c', quantity: 6 }] }, lookup)
    expect(seat.deck).toEqual({ Mountain: 14, 'Raging Goblin': 6 })
    expect(seat.total).toBe(20)
    expect(seat.unloaded).toBe(0)
  })

  it('counts the copies whose card has not loaded instead of dropping them unremarked', () => {
    const seat = seatDeck({ main: [{ cardId: 'a', quantity: 10 }, { cardId: 'missing', quantity: 3 }] }, lookup)
    expect(seat.deck).toEqual({ Mountain: 10 })
    expect(seat.total).toBe(13)
    expect(seat.unloaded).toBe(3)
  })

  it('sends a card by the name Scryfall gives it, a double-faced card included', () => {
    expect(engineName({ name: 'Delver of Secrets // Insectile Aberration', layout: 'transform' })).toBe('Delver of Secrets // Insectile Aberration')
    expect(engineName({ name: 'Mountain', layout: 'normal' })).toBe('Mountain')
  })

  it('sends a reversible card by its single name, not the "X // X" an art card also has', () => {
    // Scryfall's own record for Lorwyn Eclipsed's reversible Temple Garden.
    const reversible = { name: 'Temple Garden // Temple Garden', layout: 'reversible_card', card_faces: [{ name: 'Temple Garden' }, { name: 'Temple Garden' }] }
    expect(engineName(reversible)).toBe('Temple Garden')
    const seat = seatDeck({ main: [{ cardId: 'r', quantity: 2 }] }, () => reversible)
    expect(seat.deck).toEqual({ 'Temple Garden': 2 })
  })

  it('reads an entry with no quantity as one copy, and no deck as an empty one', () => {
    expect(seatDeck({ main: [{ cardId: 'c' }] }, lookup)).toMatchObject({ deck: { 'Raging Goblin': 1 }, total: 1 })
    expect(seatDeck(null, lookup)).toEqual({ deck: {}, sideboard: {}, total: 0, unloaded: 0, sideboardUnloaded: 0 })
  })

  it('names the printing the player chose, and lists them when a card is in several', () => {
    const printed = {
      m1: { name: 'Mountain', set: 'por', collector_number: '208' },
      m2: { name: 'Mountain', set: 'por', collector_number: '209' },
      g: { name: 'Raging Goblin', set: 'por', collector_number: '145' },
    }
    const seat = seatDeck({ main: [{ cardId: 'm1', quantity: 10 }, { cardId: 'm2', quantity: 4 }, { cardId: 'g', quantity: 6 }] }, (id) => printed[id])
    expect(seat.deck).toEqual({
      Mountain: [{ count: 10, set: 'por', number: '208' }, { count: 4, set: 'por', number: '209' }],
      'Raging Goblin': { count: 6, set: 'por', number: '145' },
    })
    expect(seat.total).toBe(20)
    // What the gate reads from those lines is still how many copies.
    expect(verdictOf(seat, { unknown: ['Mountain'] })).toMatchObject({ known: 6, unknown: [{ name: 'Mountain', count: 14 }] })
    expect(leaveOut(seat, ['Mountain']).left).toEqual([{ name: 'Mountain', count: 14 }])
  })

  it('sends the sideboard of a format that has one, and not one that holds a maybeboard', () => {
    const deck = { main: [{ cardId: 'a', quantity: 20 }], sideboard: [{ cardId: 'c', quantity: 2 }, { cardId: 'gone', quantity: 1 }] }
    const constructed = seatDeck({ ...deck, formatId: 'standard' }, lookup)
    expect(constructed.sideboard).toEqual({ 'Raging Goblin': 2 })
    expect(constructed.sideboardUnloaded).toBe(1)
    // A sideboard card that did not load does not stop the sit; the main deck's would.
    expect(constructed.unloaded).toBe(0)
    expect(seatDeck({ ...deck, formatId: 'commander' }, lookup).sideboard).toEqual({})
    expect(seatDeck({ ...deck, formatId: 'no-such-format' }, lookup).sideboard).toEqual({})
  })
})

describe('what the engine says about a deck', () => {
  const seat = { deck: { Mountain: 14, 'Made-Up Goblin': 2, 'Raging Goblin': 4 }, sideboard: {}, total: 20, unloaded: 0 }

  it('is complete when the engine knows every card and every card loaded', () => {
    expect(verdictOf(seat, { unknown: [] })).toMatchObject({ state: 'complete', known: 20, total: 20, unknown: [] })
  })

  it('lays the unknown names against the deck\'s own counts, in the deck\'s order', () => {
    const v = verdictOf(seat, { unknown: ['Raging Goblin', 'Made-Up Goblin'] })
    expect(v.state).toBe('short')
    expect(v.unknown).toEqual([{ name: 'Made-Up Goblin', count: 2 }, { name: 'Raging Goblin', count: 4 }])
    expect(v.known).toBe(14)
  })

  it('drops a name the deck does not hold, and reads a broken answer as unreadable', () => {
    expect(verdictOf(seat, { unknown: ['Not In This Deck', 7] }).unknown).toEqual([])
    expect(verdictOf(seat, { unknown: 'Made-Up Goblin' }).state).toBe('unreadable')
    expect(verdictOf(seat, {}).state).toBe('unreadable')
  })

  it('counts a deck with cards that did not load as short, even with nothing unknown', () => {
    const v = verdictOf({ ...seat, total: 23, unloaded: 3 }, { unknown: [] })
    expect(v).toMatchObject({ state: 'short', known: 20, unloaded: 3 })
  })

  it('says so when the relay cannot check at all', () => {
    expect(verdictOf(seat, null)).toMatchObject({ state: 'cannot-check', total: 20 })
  })

  it('leaves out the named cards and says how many of each', () => {
    const { seat: without, left } = leaveOut(seat, ['Made-Up Goblin', 'Not In This Deck', 42])
    expect(without.deck).toEqual({ Mountain: 14, 'Raging Goblin': 4 })
    expect(without.total).toBe(18)
    expect(left).toEqual([{ name: 'Made-Up Goblin', count: 2 }])
    expect(leaveOut(seat, 'nonsense').left).toEqual([])
  })

  it('lists names the way a sentence does', () => {
    expect(nameList(['A'])).toBe('A')
    expect(nameList(['A', 'B'])).toBe('A and B')
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C')
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more')
    // The log's notes are the only record, so they name every card.
    expect(nameList(['Lightning Bolt', 'Island', 'Mountain', 'Delver of Secrets'], Infinity)).toBe('Lightning Bolt, Island, Mountain and Delver of Secrets')
  })
})
