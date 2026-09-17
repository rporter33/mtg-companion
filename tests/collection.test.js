import { describe, it, expect } from 'vitest'
import {
  keyOf, ownedOf, setOwned, collectionSize, missingFor, missingCost, ownEverythingIn,
} from '../src/lib/collection.js'

const card = (oracle, name, usd) => ({
  oracle_id: oracle, id: `${oracle}-bbd`, name, prices: usd === null ? {} : { usd },
})
const RING = card('o-ring', 'Sol Ring', '2.00')
const ELF = card('o-elf', 'Llanowar Elves', '1.00')
const CMDR = card('o-cmdr', 'Atraxa', '25.00')
const NEW = card('o-new', 'Unpriced Card', null)

const lookup = (id) => ({ ring: RING, elf: ELF, cmdr: CMDR, fresh: NEW }[id])
const deck = () => ({
  commanders: ['cmdr'],
  signatureSpell: null,
  main: [{ cardId: 'ring', quantity: 1 }, { cardId: 'elf', quantity: 4 }],
  sideboard: [],
})

describe('what a card is owned under', () => {
  // Owning a card means owning THAT CARD, not one printing of it. Keying on
  // printing would tell a player with a C21 Sol Ring to buy a second one.
  it('is the oracle id, so printings do not matter', () => {
    expect(keyOf(card('o-ring', 'Sol Ring', '2.00'))).toBe('o-ring')
    expect(keyOf({ oracle_id: 'o-ring', id: 'different-print' })).toBe('o-ring')
  })

  it('falls back to the card id when there is no oracle id', () => {
    expect(keyOf({ id: 'token-thing' })).toBe('token-thing')
  })

  it('is null for nothing', () => {
    expect(keyOf(null)).toBeNull()
    expect(keyOf({})).toBeNull()
  })
})

describe('recording what you own', () => {
  it('stores a count', () => {
    expect(ownedOf(setOwned({}, RING, 3), RING)).toBe(3)
  })

  it('matches a different printing of the same card', () => {
    const owned = setOwned({}, card('o-ring', 'Sol Ring', '9.99'), 1)
    expect(ownedOf(owned, RING)).toBe(1)
  })

  // A list of zeroes is a list of everything you ever looked at.
  it('removes the entry at zero rather than storing a zero', () => {
    const owned = setOwned(setOwned({}, RING, 2), RING, 0)
    expect('o-ring' in owned).toBe(false)
  })

  it('refuses a negative or fractional count', () => {
    expect(ownedOf(setOwned({}, RING, -3), RING)).toBe(0)
    expect(ownedOf(setOwned({}, RING, 2.7), RING)).toBe(2)
  })

  it('ignores a card it cannot key', () => {
    expect(setOwned({}, {}, 4)).toEqual({})
  })

  it('does not modify what it was given', () => {
    const before = { 'o-ring': 1 }
    setOwned(before, ELF, 4)
    expect(before).toEqual({ 'o-ring': 1 })
  })

  it('counts both distinct cards and total pieces', () => {
    const owned = setOwned(setOwned({}, RING, 1), ELF, 4)
    expect(collectionSize(owned)).toEqual({ distinct: 2, total: 5 })
  })

  it('reports an empty collection as empty', () => {
    expect(collectionSize(undefined)).toEqual({ distinct: 0, total: 0 })
  })
})

describe('what a deck still needs', () => {
  it('lists everything when you own nothing', () => {
    expect(missingFor(deck(), lookup, {}).map((m) => `${m.card.name} x${m.quantity}`))
      .toEqual(['Atraxa x1', 'Llanowar Elves x4', 'Sol Ring x1'])
  })

  // A deck you cannot lead is a deck you cannot play.
  it('counts the commander', () => {
    expect(missingFor(deck(), lookup, {}).some((m) => m.card.name === 'Atraxa')).toBe(true)
  })

  it('counts the sideboard, which you still have to bring', () => {
    const withBoard = { ...deck(), sideboard: [{ cardId: 'fresh', quantity: 2 }] }
    expect(missingFor(withBoard, lookup, {}).find((m) => m.card.name === 'Unpriced Card').quantity).toBe(2)
  })

  it('subtracts what you already have', () => {
    const owned = setOwned({}, ELF, 2)
    expect(missingFor(deck(), lookup, owned).find((m) => m.card.name === 'Llanowar Elves').quantity).toBe(2)
  })

  it('drops a card entirely once you own enough', () => {
    const owned = setOwned({}, ELF, 9)
    expect(missingFor(deck(), lookup, owned).some((m) => m.card.name === 'Llanowar Elves')).toBe(false)
  })

  it('reports what was wanted alongside what is missing', () => {
    const owned = setOwned({}, ELF, 1)
    const elf = missingFor(deck(), lookup, owned).find((m) => m.card.name === 'Llanowar Elves')
    expect(elf).toMatchObject({ wanted: 4, owned: 1, quantity: 3 })
  })

  it('adds up copies of the same card across zones', () => {
    const both = { ...deck(), sideboard: [{ cardId: 'elf', quantity: 2 }] }
    expect(missingFor(both, lookup, {}).find((m) => m.card.name === 'Llanowar Elves').quantity).toBe(6)
  })

  it('skips cards that have not loaded rather than inventing them', () => {
    const withGhost = { ...deck(), main: [...deck().main, { cardId: 'ghost', quantity: 1 }] }
    expect(missingFor(withGhost, lookup, {})).toHaveLength(3)
  })

  it('handles an empty deck', () => {
    expect(missingFor({ main: [], sideboard: [], commanders: [] }, lookup, {})).toEqual([])
    expect(missingFor(undefined, lookup, {})).toEqual([])
  })
})

describe('what it would cost', () => {
  it('multiplies by how many are still needed', () => {
    // 25 for the commander, 1 for the ring, 4 x 1 for the elves.
    expect(missingCost(missingFor(deck(), lookup, {}), 'usd').total).toBe(31)
  })

  it('reports what it could not price instead of dropping it', () => {
    const withNew = { ...deck(), main: [{ cardId: 'fresh', quantity: 3 }] }
    expect(missingCost(missingFor(withNew, lookup, {}), 'usd')).toMatchObject({ unpriced: 3, total: 25 })
  })

  it('costs nothing when nothing is missing', () => {
    expect(missingCost([], 'usd').total).toBe(0)
  })
})

describe('owning a whole deck at once', () => {
  it('leaves nothing missing', () => {
    const owned = ownEverythingIn({}, deck(), lookup)
    expect(missingFor(deck(), lookup, owned)).toEqual([])
  })

  it('records the right counts', () => {
    expect(collectionSize(ownEverythingIn({}, deck(), lookup))).toEqual({ distinct: 3, total: 6 })
  })

  // Two decks each wanting four elves does not mean eight elves.
  it('does not stack on top of what you already had more of', () => {
    const owned = ownEverythingIn(setOwned({}, ELF, 9), deck(), lookup)
    expect(ownedOf(owned, ELF)).toBe(9)
  })
})
