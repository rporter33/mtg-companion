import { describe, it, expect } from 'vitest'
import { diagnoseHand, proposeChange, applyChange, oddsFor, describeChange } from '../src/lib/practice.js'
import { addCard, createDeck, setCommanders } from '../src/lib/deck.js'
import { openingHandOdds } from '../src/lib/probability.js'
import { card, FOREST, ISLAND, BEAR, COUNTERSPELL, COMMANDER_BEAR } from './fixtures.js'

const SWAMP = card({ id: 'swamp', name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0, produced_mana: ['B'], color_identity: [] })
const BIG = card({ id: 'big', name: 'Craw Wurm', mana_cost: '{4}{G}{G}', cmc: 6, type_line: 'Creature — Wurm', color_identity: ['G'] })
const CANTRIP = card({ id: 'cantrip', name: 'Opt', mana_cost: '{U}', cmc: 1, type_line: 'Instant', color_identity: ['U'] })
const ALL = { forest: FOREST, island: ISLAND, swamp: SWAMP, bear: BEAR, counterspell: COUNTERSPELL, big: BIG, cantrip: CANTRIP, legend: COMMANDER_BEAR }
const lookup = (id) => ALL[id]

describe('reading a hand', () => {
  it('says what the lands make and which spells have no source', () => {
    const read = diagnoseHand([FOREST, FOREST, BEAR, COUNTERSPELL, BIG, CANTRIP, BEAR])
    expect(read.lands).toBe(2)
    expect(read.colors).toEqual(['G'])
    expect(read.uncastable.map((u) => u.name)).toEqual(['Counterspell', 'Opt'])
    expect(read.notes).toContain('Counterspell needs blue, and nothing here makes it.')
  })
  it('counts the plays by turn three from these lands, one land a turn', () => {
    const read = diagnoseHand([FOREST, FOREST, BEAR, BEAR, BIG, BIG, BIG])
    expect(read.early).toEqual(['Grizzly Bears', 'Grizzly Bears'])
    expect(read.notes.some((n) => /2 plays by turn three/.test(n))).toBe(true)
    const one = diagnoseHand([FOREST, BEAR, BIG, BIG, BIG, BIG, BIG])
    expect(one.early).toEqual([]) // a two-drop with one land is not a play by turn three... until turn two, which needs a second land
  })
  it('notices a hand that does nothing early', () => {
    const read = diagnoseHand([FOREST, FOREST, FOREST, BIG, BIG, BIG, BIG])
    expect(read.expensive).toBe(4)
    expect(read.notes).toContain('Nothing to cast by turn three from these lands.')
    expect(read.notes).toContain('Every spell costs five or more.')
  })
  it('calls the textbook mulligans what they are', () => {
    expect(diagnoseHand([BEAR, BEAR, BEAR, BEAR, BEAR, BEAR, BEAR]).notes[0]).toBe('No lands. Nothing here can be cast.')
    expect(diagnoseHand([FOREST, FOREST, FOREST, FOREST, FOREST, FOREST, FOREST]).notes[0]).toBe('All lands. Nothing here to cast.')
    expect(diagnoseHand([]).keepable).toBe(false)
  })
})

describe('trying a change', () => {
  const landLight = () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, FOREST.id, 28)
    deck = addCard(deck, BEAR.id, 60)
    deck = addCard(deck, BIG.id, 11)
    return deck
  }
  it('proposes a basic for the costliest spell when the deck is short of sources', () => {
    const change = proposeChange(landLight(), lookup)
    expect(change.kind).toBe('more-lands')
    expect(change.remove.name).toBe('Craw Wurm')
    expect(change.addBasic).toBe('Forest')
    expect(change.before.lands).toBe(28)
    expect(change.after.lands).toBe(29)
    expect(change.after.twoLands).toBeGreaterThan(change.before.twoLands)
    expect(change.after.size).toBe(change.before.size) // one for one
    expect(change.assumptions).toMatch(/99 cards the commander is not among/)
  })
  it('proposes a basic of a short colour for a basic of a colour with lands to spare', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    // Forty lands, plenty for this curve; two of them blue against twenty Counterspells.
    deck = addCard(deck, FOREST.id, 38)
    deck = addCard(deck, ISLAND.id, 2)
    deck = addCard(deck, BEAR.id, 39)
    deck = addCard(deck, COUNTERSPELL.id, 20)
    const change = proposeChange(deck, lookup)
    expect(change.kind).toBe('swap-basic')
    expect(change.addBasic).toBe('Island')
    expect(change.remove.name).toBe('Forest')
    expect(change.reason).toMatch(/Blue is \d+ sources? short/)
  })
  it('has nothing to say to a deck that wants nothing', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, FOREST.id, 40)
    deck = addCard(deck, BEAR.id, 59)
    expect(proposeChange(deck, lookup)).toBeNull()
    expect(proposeChange(createDeck({ formatId: 'commander' }), lookup)).toBeNull()
  })
  it('applies one for one, reusing a basic already in the deck, and leaves the original alone', () => {
    const deck = landLight()
    const change = proposeChange(deck, lookup)
    const next = applyChange(deck, change, lookup)
    const count = (d, id) => d.main.find((e) => e.cardId === id)?.quantity ?? 0
    expect(count(next, 'forest')).toBe(29)
    expect(count(next, 'big')).toBe(10)
    expect(count(deck, 'forest')).toBe(28)
    expect(count(deck, 'big')).toBe(11)
    expect(next.main.reduce((n, e) => n + e.quantity, 0)).toBe(99)
  })
  it('needs the basic looked up when the deck has none of that colour', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, FOREST.id, 36)
    deck = addCard(deck, COUNTERSPELL.id, 63)
    const change = proposeChange(deck, lookup)
    expect(change.addBasic).toBe('Island')
    expect(applyChange(deck, change, lookup)).toBe(deck)
    const next = applyChange(deck, change, lookup, ISLAND)
    expect(next.main.find((e) => e.cardId === 'island')?.quantity).toBe(1)
  })
  it('judges by lands only, from the library without the commander', () => {
    const odds = oddsFor(landLight(), lookup)
    expect(odds.size).toBe(99)
    expect(odds.twoLands).toBeCloseTo(openingHandOdds(99, 28, 2), 12)
  })
  it('names the change in a line', () => {
    expect(describeChange({ addBasic: 'Forest', remove: { name: 'Craw Wurm' } })).toBe('+1 Forest, −1 Craw Wurm')
  })
})

describe('addCard leaves the deck it was given alone', () => {
  it('does not change the entry it found', () => {
    const deck = addCard(createDeck({ formatId: 'modern' }), 'bear', 4)
    const before = deck.main[0]
    const next = addCard(deck, 'bear', 1)
    expect(before.quantity).toBe(4)
    expect(next.main[0].quantity).toBe(5)
    expect(next.main[0]).not.toBe(before)
  })
})
