import { describe, it, expect } from 'vitest'
import { seatDeck, engineName, leaveOut, verdictOf, nameList, recordsByName, byReason, reasonText } from '../src/lib/engine/deck.js'

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
    // No set list from the engine, so no reason: the lobby names them as before.
    expect(v.unknown).toEqual([{ name: 'Made-Up Goblin', count: 2, reason: null }, { name: 'Raging Goblin', count: 4, reason: null }])
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

  it('gives no reason for a card it has no record of, even with the engine\'s set list', () => {
    const v = verdictOf(seat, { unknown: ['Made-Up Goblin'], engineSets: [{ code: 'POR', name: 'Portal', incomplete: false }] }, new Map())
    expect(v.unknown).toEqual([{ name: 'Made-Up Goblin', count: 2, reason: null }])
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

describe('why the engine does not know a card', () => {
  // The engine's hello as the relay passes it on: codes in capitals, as
  // Argentum gives them. Portal's entry is the real engine's (engine-live.test.js);
  // the date on Star Trek Commander is Argentum's own, which Scryfall does not
  // share, and which must never reach the screen.
  const ENGINE_SETS = [
    { code: 'POR', name: 'Portal', released: '1997-05-01', incomplete: false },
    { code: 'HOB', name: 'The Hobbit', incomplete: false },
    { code: 'TRC', name: 'Star Trek Commander', released: '2026-01-23', incomplete: true },
  ]
  // Scryfall-shaped records, codes in small letters. The card names are made up.
  const printed = {
    fra: { name: 'Made-Up Rift', set: 'fra', set_name: 'Reality Fracture', collector_number: '1' },
    fra2: { name: 'Made-Up Rift Walker', set: 'fra', set_name: 'Reality Fracture', collector_number: '2' },
    trc: { name: 'Made-Up Captain', set: 'trc', set_name: 'Star Trek Commander', collector_number: '3' },
    hob: { name: 'Made-Up Hobbit', set: 'hob', set_name: 'The Hobbit', collector_number: '4' },
    por: { name: 'Made-Up Goblin', set: 'por', set_name: 'Portal', collector_number: '5' },
    mtn: { name: 'Mountain', set: 'por', set_name: 'Portal', collector_number: '208' },
  }
  const byId = (id) => printed[id] ?? null
  const deck = { main: ['mtn', 'fra', 'trc', 'hob', 'fra2', 'por'].map((cardId) => ({ cardId, quantity: cardId === 'mtn' ? 14 : 1 })) }
  const seat = seatDeck(deck, byId)
  const records = recordsByName(deck.main, byId)
  const unknownNames = ['Made-Up Rift', 'Made-Up Captain', 'Made-Up Hobbit', 'Made-Up Rift Walker', 'Made-Up Goblin']
  const reasonOf = (v, name) => v.unknown.find((u) => u.name === name)?.reason

  it('says a set the engine does not list is one it has no cards of, naming it as Scryfall does', () => {
    const v = verdictOf(seat, { unknown: unknownNames, engineSets: ENGINE_SETS }, records)
    expect(reasonOf(v, 'Made-Up Rift')).toEqual({ kind: 'no-set', set: 'Reality Fracture' })
    expect(reasonText(reasonOf(v, 'Made-Up Rift'))).toBe('The rules engine has no Reality Fracture cards yet')
  })

  it('says a set the engine marks incomplete is one it has only in part', () => {
    const v = verdictOf(seat, { unknown: unknownNames, engineSets: ENGINE_SETS }, records)
    expect(reasonOf(v, 'Made-Up Captain')).toEqual({ kind: 'part-set', set: 'Star Trek Commander' })
    expect(reasonText(reasonOf(v, 'Made-Up Captain'))).toBe('The rules engine has Star Trek Commander only in part, and not this card yet')
  })

  it('says a set the engine has in full is one where it does not know the card', () => {
    const v = verdictOf(seat, { unknown: unknownNames, engineSets: ENGINE_SETS }, records)
    expect(reasonOf(v, 'Made-Up Hobbit')?.kind).toBe('not-in-set')
    expect(reasonOf(v, 'Made-Up Goblin')?.kind).toBe('not-in-set')
    expect(reasonText(reasonOf(v, 'Made-Up Hobbit'))).toBe('The rules engine does not know this card')
  })

  it('compares codes without regard to case, and reads a bare code as a set it has', () => {
    const lower = verdictOf(seat, { unknown: ['Made-Up Hobbit'], engineSets: [{ code: 'hob' }] }, records)
    expect(reasonOf(lower, 'Made-Up Hobbit')?.kind).toBe('not-in-set')
    const bare = verdictOf(seat, { unknown: ['Made-Up Hobbit'], engineSets: ['HOB'] }, records)
    expect(reasonOf(bare, 'Made-Up Hobbit')?.kind).toBe('not-in-set')
  })

  it('does not blame a reprint\'s set: the engine knows cards by name, from whichever set printed them', () => {
    // Rhystic Study held as a Secret Lair printing. The engine lists no Secret
    // Lair, but it would know the card from any set that printed it, so the
    // set is not why; that it does not know the card is.
    const sld = { name: 'Rhystic Study', set: 'sld', set_name: 'Secret Lair Drop', collector_number: '1', reprint: true }
    const main = [{ cardId: 'sld', quantity: 1 }]
    const lookup = (id) => (id === 'sld' ? sld : null)
    const v = verdictOf(seatDeck({ main }, lookup), { unknown: ['Rhystic Study'], engineSets: ENGINE_SETS }, recordsByName(main, lookup))
    expect(v.unknown[0].reason?.kind).toBe('not-in-set')
    expect(reasonText(v.unknown[0].reason)).toBe('The rules engine does not know this card')
    expect(reasonText(v.unknown[0].reason)).not.toMatch(/Secret Lair|yet/)

    // A reprint in a set the engine has only in part keeps that reason:
    // finishing the set would bring the card.
    const trc = { ...printed.trc, reprint: true }
    const partLookup = (id) => (id === 'trc' ? trc : null)
    const partMain = [{ cardId: 'trc', quantity: 1 }]
    const part = verdictOf(seatDeck({ main: partMain }, partLookup), { unknown: ['Made-Up Captain'], engineSets: ENGINE_SETS }, recordsByName(partMain, partLookup))
    expect(part.unknown[0].reason).toEqual({ kind: 'part-set', set: 'Star Trek Commander' })

    // A first printing in a set it does not list is still that set's reason,
    // and so is a record that does not say whether it is a reprint.
    const v2 = verdictOf(seat, { unknown: unknownNames, engineSets: ENGINE_SETS }, records)
    expect(printed.fra.reprint).toBeUndefined()
    expect(reasonOf(v2, 'Made-Up Rift')).toEqual({ kind: 'no-set', set: 'Reality Fracture' })
  })

  it('lets the printing the engine comes nearest to speak for a card held in several', () => {
    const two = { fra: { ...printed.fra }, hob: { ...printed.hob, name: 'Made-Up Rift' } }
    const main = [{ cardId: 'fra', quantity: 1 }, { cardId: 'hob', quantity: 1 }]
    const lookup = (id) => two[id]
    const v = verdictOf(seatDeck({ main }, lookup), { unknown: ['Made-Up Rift'], engineSets: ENGINE_SETS }, recordsByName(main, lookup))
    expect(v.unknown).toEqual([{ name: 'Made-Up Rift', count: 2, reason: { kind: 'not-in-set', set: 'The Hobbit' } }])
  })

  it('reads a missing or broken set list, or a record with nothing to go on, as no reason at all', () => {
    for (const engineSets of [undefined, null, 'POR', [], [null, 42, {}, { code: 7 }, { code: '' }]]) {
      const v = verdictOf(seat, { unknown: unknownNames, engineSets }, records)
      expect(v.unknown.every((u) => u.reason === null)).toBe(true)
    }
    // The records are not a Map: the deck is read as it was before reasons.
    expect(verdictOf(seat, { unknown: unknownNames, engineSets: ENGINE_SETS }, 'nonsense').unknown.every((u) => u.reason === null)).toBe(true)
    // A record with no set, or no name for a set the reason would have to say.
    const bare = new Map([['Made-Up Rift', [{ name: 'Made-Up Rift' }]], ['Made-Up Captain', [{ name: 'Made-Up Captain', set: 'trc' }]], ['Made-Up Hobbit', [{ name: 'Made-Up Hobbit', set: 'HOB' }]]])
    const v = verdictOf(seat, { unknown: unknownNames, engineSets: ENGINE_SETS }, bare)
    expect(reasonOf(v, 'Made-Up Rift')).toBeNull()
    expect(reasonOf(v, 'Made-Up Captain')).toBeNull()
    // "Does not know this card" names no set, so it needs none.
    expect(reasonOf(v, 'Made-Up Hobbit')?.kind).toBe('not-in-set')
  })

  it('gathers the cards by reason in the deck\'s order, so one set is one line however many cards', () => {
    const v = verdictOf(seat, { unknown: unknownNames, engineSets: ENGINE_SETS }, records)
    const groups = byReason(v.unknown)
    expect(groups.map((g) => [reasonText(g.reason, g.cards.length > 1), g.cards.map((u) => u.name)])).toEqual([
      ['The rules engine has no Reality Fracture cards yet', ['Made-Up Rift', 'Made-Up Rift Walker']],
      ['The rules engine has Star Trek Commander only in part, and not this card yet', ['Made-Up Captain']],
      // Two sets it has in full, one reason: it does not name the set.
      ['The rules engine does not know these cards', ['Made-Up Hobbit', 'Made-Up Goblin']],
    ])
    const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `Made-Up Rift ${i}`, count: 1, reason: { kind: 'no-set', set: 'Reality Fracture' } }))
    expect(byReason(twenty)).toHaveLength(1)
    expect(byReason([{ name: 'A', count: 1, reason: null }, { name: 'B', count: 1 }])).toEqual([{ reason: null, cards: [{ name: 'A', count: 1, reason: null }, { name: 'B', count: 1 }] }])
    expect(byReason(undefined)).toEqual([])
  })

  it('words each reason for one card or several, never with a date, and no reason as before', () => {
    const texts = [
      reasonText({ kind: 'no-set', set: 'Reality Fracture' }, true),
      reasonText({ kind: 'part-set', set: 'Star Trek Commander' }, true),
      reasonText({ kind: 'not-in-set', set: 'The Hobbit' }, true),
    ]
    expect(texts).toEqual([
      'The rules engine has no Reality Fracture cards yet',
      'The rules engine has Star Trek Commander only in part, and not these cards yet',
      'The rules engine does not know these cards',
    ])
    for (const t of texts) expect(t).not.toMatch(/\d/)
    expect(reasonText(null)).toBe('Not known')
    expect(reasonText({ kind: 'something newer' })).toBe('Not known')
  })

  it('finds each name\'s cards under the name the seat sends, once each, leaving out what has not loaded', () => {
    const reversible = { name: 'Temple Garden // Temple Garden', layout: 'reversible_card', card_faces: [{ name: 'Temple Garden' }, { name: 'Temple Garden' }] }
    const lookup = (id) => ({ r: reversible, m: printed.mtn }[id] ?? null)
    const found = recordsByName([{ cardId: 'r' }, { cardId: 'm' }, { cardId: 'm' }, { cardId: 'gone' }, null], lookup)
    expect([...found.keys()]).toEqual(['Temple Garden', 'Mountain'])
    expect(found.get('Mountain')).toEqual([printed.mtn])
    expect(recordsByName(undefined, lookup).size).toBe(0)
  })
})
