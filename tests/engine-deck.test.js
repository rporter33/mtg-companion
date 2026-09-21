import { describe, it, expect } from 'vitest'
import { seatDeck, engineName } from '../src/lib/engine/deck.js'

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
    expect(seatDeck(null, lookup)).toEqual({ deck: {}, sideboard: {}, total: 0, unloaded: 0 })
  })
})
