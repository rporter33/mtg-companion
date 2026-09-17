import { describe, it, expect } from 'vitest'
import {
  EXAMPLE_DECKS, exampleDecksFor, exampleToDecklist, exampleSize,
} from '../src/data/example-decks.js'
import { parseDecklist } from '../src/lib/decklist.js'
import { FORMATS } from '../src/lib/formats.js'

const BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'])

// These are shipped data, not code, and a broken one is a broken example for
// every reader. Card names cannot be checked without the network — that is what
// `npm run examples:verify` is for — but everything about their shape can.
describe('the shipped example decks', () => {
  it('ships at least one', () => {
    expect(EXAMPLE_DECKS.length).toBeGreaterThan(0)
  })

  it.each(EXAMPLE_DECKS.map((d) => [d.id, d]))('%s is well formed', (_id, deck) => {
    expect(deck.name).toBeTruthy()
    expect(FORMATS[deck.formatId]).toBeDefined()
    expect(deck.commanders.length).toBeGreaterThan(0)
    expect(deck.main.length).toBeGreaterThan(0)
    expect(deck.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each(EXAMPLE_DECKS.map((d) => [d.id, d]))('%s has clean card names', (_id, deck) => {
    for (const { name, quantity } of [...deck.main, ...deck.sideboard]) {
      expect(name).toBe(name.trim())
      expect(name.length).toBeGreaterThan(0)
      expect(quantity).toBeGreaterThan(0)
      // A leftover quantity prefix means the parser ate the line wrong.
      expect(name).not.toMatch(/^\d+\s*[xX]?\s/)
    }
  })

  it.each(EXAMPLE_DECKS.map((d) => [d.id, d]))('%s lists each card once', (_id, deck) => {
    const names = deck.main.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(EXAMPLE_DECKS.filter((d) => d.formatId === 'commander').map((d) => [d.id, d]))(
    '%s obeys the singleton rule', (_id, deck) => {
      const repeated = deck.main.filter((c) => c.quantity > 1 && !BASICS.has(c.name))
      expect(repeated.map((c) => c.name)).toEqual([])
    },
  )

  // One deck was supplied at 99 cards. Rather than pad it with a card nobody
  // chose, or drop it, the rule is that an irregular example must say so — so
  // a reader is never quietly handed an illegal deck.
  it.each(EXAMPLE_DECKS.filter((d) => d.formatId === 'commander').map((d) => [d.id, d]))(
    '%s is either exactly 100 cards or explains itself', (_id, deck) => {
      if (exampleSize(deck) !== 100) expect(deck.note).toBeTruthy()
    },
  )

  it('gives every deck a unique id', () => {
    const ids = EXAMPLE_DECKS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('credits whoever chose them', () => {
    for (const deck of EXAMPLE_DECKS) expect(deck.credit).toBeTruthy()
  })
})

// The round trip is how a reader actually opens an example: it is rendered to
// text and handed to the importer, so the importer has to read back what was
// written without losing or inventing a card.
describe('example round trip', () => {
  it.each(EXAMPLE_DECKS.map((d) => [d.id, d]))('%s survives text and back', (_id, deck) => {
    const lines = parseDecklist(exampleToDecklist(deck))
    const total = lines.reduce((n, l) => n + l.quantity, 0)
    expect(total).toBe(exampleSize(deck))
    expect(lines.filter((l) => l.section === 'commander').map((l) => l.name))
      .toEqual(deck.commanders)
  })
})

describe('exampleDecksFor', () => {
  it('finds a deck by its commander', () => {
    expect(exampleDecksFor('Commodore Guff')).toHaveLength(1)
  })

  it('is case insensitive', () => {
    expect(exampleDecksFor('commodore guff')).toHaveLength(1)
  })

  it('finds a double-faced commander by its full Scryfall name', () => {
    // This is the name the commanders browser actually holds.
    expect(exampleDecksFor('Esika, God of the Tree // The Prismatic Bridge')).toHaveLength(1)
  })

  it('finds it by the front face too', () => {
    expect(exampleDecksFor('Esika, God of the Tree')).toHaveLength(1)
  })

  it('returns nothing for a commander with no example', () => {
    expect(exampleDecksFor('Atraxa, Praetors\' Voice')).toEqual([])
    expect(exampleDecksFor('')).toEqual([])
    expect(exampleDecksFor(null)).toEqual([])
  })
})
