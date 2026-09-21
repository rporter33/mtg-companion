import { describe, it, expect } from 'vitest'
import { seatDeck } from '../src/lib/engine/deck.js'

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

  it('reads an entry with no quantity as one copy, and no deck as an empty one', () => {
    expect(seatDeck({ main: [{ cardId: 'c' }] }, lookup)).toMatchObject({ deck: { 'Raging Goblin': 1 }, total: 1 })
    expect(seatDeck(null, lookup)).toEqual({ deck: {}, sideboard: {}, total: 0, unloaded: 0 })
  })
})
