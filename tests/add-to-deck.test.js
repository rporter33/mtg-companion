import { describe, it, expect } from 'vitest'
import { addedMessage } from '../src/features/decks/AddToDeck.jsx'
import { validateDeck } from '../src/lib/deck.js'

// The sentences the sheet says after a card goes into a deck, against the
// violations validateDeck really produces rather than hand-written ones.
const card = (id, name, over = {}) => ({
  id, oracle_id: `o-${id}`, name, type_line: 'Creature — Elf', mana_cost: '{G}', cmc: 1,
  color_identity: ['G'], legalities: { commander: 'legal', modern: 'legal' }, ...over,
})

describe('what the sheet says once a card is in', () => {
  it('says where it went, and nothing else, when the deck is happy with it', () => {
    expect(addedMessage('Elves', null, null)).toEqual({ tone: 'ok', text: 'Added to Elves.' })
  })

  it('says a problem as its own sentence, with the card it is about', () => {
    const elf = card('elf', 'Llanowar Elves')
    const deck = { formatId: 'modern', main: [{ cardId: 'elf', quantity: 5 }], sideboard: [], commanders: [] }
    const problem = validateDeck(deck, new Map([['elf', elf]])).violations.find((v) => v.code === 'too_many_copies')
    const said = addedMessage('Elves', problem, null)
    expect(said.tone).toBe('warn')
    expect(said.text).toBe('Added to Elves. At most 4 copies of Llanowar Elves are allowed, but this deck has 5.')
    // No sentence begins in the middle of another one.
    expect(said.text).not.toMatch(/, but [A-Z]/)
  })

  it('keeps the card\'s name when the reason had it in front of a colon', () => {
    // A commander that cannot be one reads "<name>: <why>", which was cut away.
    const ox = card('ox', 'Plain Ox', { type_line: 'Creature — Ox' })
    const deck = { formatId: 'commander', main: [], sideboard: [], commanders: ['ox'] }
    const problem = validateDeck(deck, new Map([['ox', ox]])).violations.find((v) => v.code === 'invalid_commander')
    expect(problem).toBeTruthy()
    expect(addedMessage('Pod', problem, null).text).toMatch(/^Added to Pod\. Plain Ox: /)
  })

  it('says a card that is not out yet the same way, warned but never refused', () => {
    const note = { code: 'not_out_yet', severity: 'warning', message: 'Darklight Phoenix is not out until 2 Oct 2026.' }
    expect(addedMessage('Standard', null, note)).toEqual({
      tone: 'warn', text: 'Added to Standard. Darklight Phoenix is not out until 2 Oct 2026.',
    })
  })
})
