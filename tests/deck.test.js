import { describe, it, expect } from 'vitest'
import {
  createDeck, addCard, setQuantity, removeCard, setCommanders,
  validateDeck, deckSize, combinedCounts, unionColorIdentity, deckVerdict, gameCardKey,
} from '../src/lib/deck.js'
import { getFormat } from '../src/lib/formats.js'
import {
  card, legalEverywhere, FOREST, ISLAND, BEAR, COUNTERSPELL,
  COMMANDER_BEAR, RELENTLESS_RATS,
} from './fixtures.js'

const lookup = new Map([
  [FOREST.id, FOREST], [ISLAND.id, ISLAND], [BEAR.id, BEAR],
  [COUNTERSPELL.id, COUNTERSPELL], [COMMANDER_BEAR.id, COMMANDER_BEAR],
  [RELENTLESS_RATS.id, RELENTLESS_RATS],
])

const withCard = (map, c) => new Map([...map, [c.id, c]])
const errorsOf = (r) => r.violations.filter((v) => v.severity === 'error')
const codes = (r) => errorsOf(r).map((v) => v.code)

/** A legal 60-card Modern deck: 24 Forest, 4 Bears, 32 filler basics. */
function modernDeck() {
  let deck = createDeck({ formatId: 'modern', name: 'Test' })
  deck = addCard(deck, FOREST.id, 56)
  deck = addCard(deck, BEAR.id, 4)
  return deck
}

/** A legal 100-card Commander deck led by Legendary Bear. */
function commanderDeck() {
  let deck = createDeck({ formatId: 'commander' })
  deck = setCommanders(deck, [COMMANDER_BEAR.id])
  deck = addCard(deck, FOREST.id, 99)
  return deck
}

describe('deck mutation', () => {
  it('adds, merges and removes quantities immutably', () => {
    const a = createDeck({ formatId: 'modern' })
    const b = addCard(a, BEAR.id, 2)
    const c = addCard(b, BEAR.id, 2)
    expect(a.main).toHaveLength(0)
    expect(c.main).toEqual([{ cardId: BEAR.id, quantity: 4 }])
  })

  it('drops an entry when its quantity reaches zero', () => {
    let deck = addCard(createDeck(), BEAR.id, 3)
    deck = setQuantity(deck, BEAR.id, 0)
    expect(deck.main).toHaveLength(0)
  })

  it('keeps main and sideboard separate', () => {
    let deck = addCard(createDeck({ formatId: 'modern' }), BEAR.id, 2)
    deck = addCard(deck, BEAR.id, 2, 'sideboard')
    expect(deck.main).toEqual([{ cardId: BEAR.id, quantity: 2 }])
    expect(deck.sideboard).toEqual([{ cardId: BEAR.id, quantity: 2 }])
  })
})

describe('combinedCounts', () => {
  it('counts copies across main and sideboard together', () => {
    // The four-copy rule applies to the combined total, not per zone.
    let deck = addCard(createDeck({ formatId: 'modern' }), BEAR.id, 3)
    deck = addCard(deck, BEAR.id, 2, 'sideboard')
    expect(combinedCounts(deck).get(BEAR.id)).toBe(5)
  })

  it('counts the commander', () => {
    const deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    expect(combinedCounts(deck).get(COMMANDER_BEAR.id)).toBe(1)
  })
})

describe('constructed validation', () => {
  it('passes a legal 60-card deck', () => {
    const result = validateDeck(modernDeck(), lookup)
    expect(codes(result)).toEqual([])
    expect(result.legal).toBe(true)
    expect(result.counts.total).toBe(60)
  })

  it('rejects a deck under 60 cards and says how short it is', () => {
    const deck = addCard(createDeck({ formatId: 'modern' }), FOREST.id, 40)
    const result = validateDeck(deck, lookup)
    expect(codes(result)).toContain('deck_too_small')
    expect(errorsOf(result)[0].message).toMatch(/20 short/)
  })

  it('has no maximum deck size in constructed', () => {
    const deck = addCard(createDeck({ formatId: 'modern' }), FOREST.id, 250)
    expect(codes(validateDeck(deck, lookup))).not.toContain('deck_too_large')
  })

  it('rejects a fifth copy split across main and sideboard', () => {
    let deck = modernDeck()
    deck = addCard(deck, BEAR.id, 1, 'sideboard')
    const result = validateDeck(deck, lookup)
    expect(codes(result)).toContain('too_many_copies')
    expect(errorsOf(result).find((v) => v.code === 'too_many_copies').message).toMatch(/5/)
  })

  it('allows unlimited basic lands', () => {
    const deck = addCard(createDeck({ formatId: 'modern' }), FOREST.id, 60)
    expect(codes(validateDeck(deck, lookup))).toEqual([])
  })

  it('rejects an oversized sideboard', () => {
    let deck = modernDeck()
    deck = addCard(deck, FOREST.id, 16, 'sideboard')
    expect(codes(validateDeck(deck, lookup))).toContain('sideboard_too_large')
  })

  it('rejects a banned card', () => {
    const banned = legalEverywhere({ id: 'banned', name: 'Bad Card', legalities: { modern: 'banned' } })
    let deck = modernDeck()
    deck = addCard(deck, banned.id, 1)
    const result = validateDeck(deck, withCard(lookup, banned))
    expect(codes(result)).toContain('banned')
    expect(errorsOf(result).find((v) => v.code === 'banned').message).toMatch(/Bad Card is banned in Modern/)
  })

  it('rejects a card outside the format pool', () => {
    const notLegal = card({ id: 'old', name: 'Old Card', legalities: { modern: 'not_legal' } })
    let deck = modernDeck()
    deck = addCard(deck, notLegal.id, 1)
    expect(codes(validateDeck(deck, withCard(lookup, notLegal)))).toContain('not_legal')
  })

  it('allows one copy of a Vintage-restricted card but not two', () => {
    const restricted = legalEverywhere({
      id: 'lotus', name: 'Power Card', legalities: { vintage: 'restricted' },
    })
    const map = withCard(lookup, restricted)
    let one = addCard(createDeck({ formatId: 'vintage' }), FOREST.id, 59)
    one = addCard(one, restricted.id, 1)
    expect(codes(validateDeck(one, map))).toEqual([])

    let two = addCard(createDeck({ formatId: 'vintage' }), FOREST.id, 58)
    two = addCard(two, restricted.id, 2)
    expect(codes(validateDeck(two, map))).toContain('restricted')
  })

  it('warns rather than failing when a card has not loaded', () => {
    const deck = addCard(modernDeck(), 'unknown-id', 1)
    const result = validateDeck(deck, lookup)
    expect(codes(result)).not.toContain('card_not_loaded')
    expect(result.violations.some((v) => v.code === 'card_not_loaded' && v.severity === 'warning')).toBe(true)
  })
})

describe('copies are counted per card, across its printings', () => {
  // Two printings of one card, as an import of "4 Grizzly Bears" and "1
  // Grizzly Bears (XYZ) 7" lands them: two ids, one oracle id. The copy limit
  // is a rule about the card, so they count together.
  const BEAR_A = { ...BEAR, id: 'bear-a', oracle_id: 'o-bear', set: 'aaa' }
  const BEAR_B = { ...BEAR, id: 'bear-b', oracle_id: 'o-bear', set: 'bbb' }
  const FOREST_B = { ...FOREST, id: 'forest-b', set: 'bbb' }
  const map = new Map([...lookup, ...[BEAR_A, BEAR_B, FOREST_B].map((c) => [c.id, c])])

  it('fails five of a card split over two printings in Modern, as one problem', () => {
    let deck = addCard(createDeck({ formatId: 'modern' }), FOREST.id, 55)
    deck = addCard(deck, BEAR_A.id, 3)
    deck = addCard(deck, BEAR_B.id, 2)
    const result = validateDeck(deck, map)
    const copies = errorsOf(result).filter((v) => v.code === 'too_many_copies')
    expect(copies).toHaveLength(1)
    expect(copies[0].message).toBe('At most 4 copies of Grizzly Bears are allowed, but this deck has 5.')
    expect(copies[0].cardId).toBe(BEAR_A.id)
    expect(copies[0].cardIds).toEqual([BEAR_A.id, BEAR_B.id])
    expect(deckVerdict(deck, result, map)).toEqual({ tone: 'error', text: '1 problem' })
  })

  it('counts a printing in the sideboard with another in the main deck', () => {
    let deck = addCard(createDeck({ formatId: 'modern' }), FOREST.id, 56)
    deck = addCard(deck, BEAR_A.id, 4)
    deck = addCard(deck, BEAR_B.id, 1, 'sideboard')
    expect(codes(validateDeck(deck, map))).toEqual(['too_many_copies'])
    // Four across both printings is within the limit.
    expect(codes(validateDeck(setQuantity(deck, BEAR_A.id, 3), map))).not.toContain('too_many_copies')
  })

  it('fails one each of two printings in Commander as not singleton', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, BEAR_A.id, 1)
    deck = addCard(deck, BEAR_B.id, 1)
    deck = addCard(deck, FOREST.id, 97)
    const copies = errorsOf(validateDeck(deck, map)).filter((v) => v.code === 'too_many_copies')
    expect(copies).toHaveLength(1)
    expect(copies[0].message).toMatch(/singleton — only one Grizzly Bears, but this deck has 2/)
  })

  it('restricts a card, not a printing', () => {
    const lotusA = legalEverywhere({ id: 'lotus-a', oracle_id: 'o-lotus', name: 'Power Card', legalities: { vintage: 'restricted' } })
    const lotusB = { ...lotusA, id: 'lotus-b' }
    let deck = addCard(createDeck({ formatId: 'vintage' }), FOREST.id, 58)
    deck = addCard(deck, lotusA.id, 1)
    deck = addCard(deck, lotusB.id, 1)
    const result = validateDeck(deck, withCard(withCard(lookup, lotusA), lotusB))
    expect(codes(result)).toEqual(['restricted'])
    expect(errorsOf(result)[0].cardIds).toEqual(['lotus-a', 'lotus-b'])
  })

  it('leaves basic lands unlimited whatever their printings', () => {
    let deck = addCard(createDeck({ formatId: 'modern' }), FOREST.id, 30)
    deck = addCard(deck, FOREST_B.id, 30)
    expect(codes(validateDeck(deck, map))).toEqual([])
  })

  it('counts a card that has not loaded on its own', () => {
    // Nothing is known of it, so it is never added to another card's count.
    let deck = addCard(createDeck({ formatId: 'modern' }), FOREST.id, 55)
    deck = addCard(deck, BEAR_A.id, 4)
    deck = addCard(deck, 'not-loaded', 1)
    const result = validateDeck(deck, map)
    expect(codes(result)).toEqual([])
    expect(result.violations.map((v) => v.code)).toEqual(['card_not_loaded'])
  })

  it('knows a card by its oracle id, on a reversible card its face’s, else its name', () => {
    expect(gameCardKey(BEAR_A)).toBe('oracle:o-bear')
    expect(gameCardKey({ id: 'rev', name: 'Relic // Relic', card_faces: [{ oracle_id: 'o-rev' }, { oracle_id: 'o-rev' }] })).toBe('oracle:o-rev')
    // An older record with no oracle id still counts with its namesakes.
    expect(gameCardKey(BEAR)).toBe('name:Grizzly Bears')
    expect(gameCardKey(undefined, 'some-id')).toBe('id:some-id')
    let deck = addCard(createDeck({ formatId: 'modern' }), FOREST.id, 55)
    deck = addCard(deck, BEAR.id, 4)
    deck = addCard(deck, 'bear-old', 1)
    expect(codes(validateDeck(deck, withCard(lookup, { ...BEAR, id: 'bear-old' })))).toEqual(['too_many_copies'])
  })
})

describe('commander validation', () => {
  it('passes a legal 100-card Commander deck', () => {
    const result = validateDeck(commanderDeck(), lookup)
    expect(codes(result)).toEqual([])
    expect(result.counts.total).toBe(100)
  })

  it('counts the commander toward the 100', () => {
    const format = getFormat('commander')
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, FOREST.id, 99)
    expect(deckSize(deck, format)).toBe(100)
  })

  it('rejects 99 cards plus a commander as one short', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, FOREST.id, 98)
    const result = validateDeck(deck, lookup)
    expect(codes(result)).toContain('deck_too_small')
    expect(errorsOf(result)[0].message).toMatch(/exactly 100/)
  })

  it('requires a commander', () => {
    const deck = addCard(createDeck({ formatId: 'commander' }), FOREST.id, 100)
    expect(codes(validateDeck(deck, lookup))).toContain('missing_commander')
  })

  it('rejects a nonlegendary commander', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [BEAR.id])
    deck = addCard(deck, FOREST.id, 99)
    expect(codes(validateDeck(deck, lookup))).toContain('invalid_commander')
  })

  it('enforces singleton', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, BEAR.id, 2)
    deck = addCard(deck, FOREST.id, 97)
    const result = validateDeck(deck, lookup)
    expect(codes(result)).toContain('too_many_copies')
    expect(errorsOf(result).find((v) => v.code === 'too_many_copies').message).toMatch(/singleton/i)
  })

  it('still allows any-number cards in singleton', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, RELENTLESS_RATS.id, 20)
    deck = addCard(deck, FOREST.id, 79)
    expect(codes(validateDeck(deck, lookup))).not.toContain('too_many_copies')
  })

  it('enforces colour identity', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id]) // mono-green
    deck = addCard(deck, COUNTERSPELL.id, 1) // blue
    deck = addCard(deck, FOREST.id, 98)
    const result = validateDeck(deck, lookup)
    expect(codes(result)).toContain('color_identity')
    expect(errorsOf(result).find((v) => v.code === 'color_identity').message).toMatch(/Counterspell/)
  })

  it('allows colourless cards under any commander', () => {
    const rock = legalEverywhere({
      id: 'rock', name: 'Mana Rock', mana_cost: '{2}', cmc: 2,
      type_line: 'Artifact', color_identity: [], produced_mana: ['C'],
    })
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, rock.id, 1)
    deck = addCard(deck, FOREST.id, 98)
    expect(codes(validateDeck(deck, withCard(lookup, rock)))).toEqual([])
  })

  it('rejects any sideboard at all', () => {
    let deck = commanderDeck()
    deck = addCard(deck, FOREST.id, 1, 'sideboard')
    const result = validateDeck(deck, lookup)
    expect(codes(result)).toContain('sideboard_too_large')
    expect(errorsOf(result).find((v) => v.code === 'sideboard_too_large').message).toMatch(/does not use a sideboard/)
  })
})

describe('oathbreaker validation', () => {
  const walker = legalEverywhere({
    id: 'walker', name: 'Test Walker', mana_cost: '{2}{G}', cmc: 3,
    type_line: 'Legendary Planeswalker — Test', color_identity: ['G'],
  })
  const spell = legalEverywhere({
    id: 'spell', name: 'Test Bolt', mana_cost: '{G}', cmc: 1,
    type_line: 'Sorcery', color_identity: ['G'],
  })
  const map = withCard(withCard(lookup, walker), spell)

  it('passes a legal 60-card Oathbreaker deck', () => {
    let deck = setCommanders(createDeck({ formatId: 'oathbreaker' }), [walker.id])
    deck = { ...deck, signatureSpell: spell.id }
    deck = addCard(deck, FOREST.id, 58)
    expect(codes(validateDeck(deck, map))).toEqual([])
  })

  it('requires a signature spell', () => {
    let deck = setCommanders(createDeck({ formatId: 'oathbreaker' }), [walker.id])
    deck = addCard(deck, FOREST.id, 59)
    expect(codes(validateDeck(deck, map))).toContain('missing_signature_spell')
  })

  it('rejects a creature as a signature spell', () => {
    let deck = setCommanders(createDeck({ formatId: 'oathbreaker' }), [walker.id])
    deck = { ...deck, signatureSpell: BEAR.id }
    deck = addCard(deck, FOREST.id, 58)
    expect(codes(validateDeck(deck, map))).toContain('invalid_signature_spell')
  })
})

describe('unionColorIdentity', () => {
  it('unions partners and keeps WUBRG order', () => {
    const a = card({ color_identity: ['G'] })
    const b = card({ color_identity: ['W', 'U'] })
    expect(unionColorIdentity([a, b])).toEqual(['W', 'U', 'G'])
  })

  it('is empty for colourless', () => {
    expect(unionColorIdentity([card({ color_identity: [] })])).toEqual([])
  })
})
