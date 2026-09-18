import { describe, it, expect } from 'vitest'
import { untappedSources, producedBy, withinReach } from '../src/lib/board/mana.js'
import { createBoard } from '../src/lib/board/model.js'
import { apply } from '../src/lib/board/reducer.js'

/**
 * The readout is deliberately narrower than it looks like it could be, and
 * what is tested here is mostly the narrowness: that it counts sources rather
 * than mana, that it says nothing about conditions, and that it answers with
 * nothing at all rather than a guess when the card data has not arrived.
 */

const CARDS = {
  forest: { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', produced_mana: ['G'] },
  mountain: { id: 'mountain', name: 'Mountain', type_line: 'Basic Land — Mountain', produced_mana: ['R'] },
  grove: { id: 'grove', name: 'Sunpetal Grove', type_line: 'Land', produced_mana: ['G', 'W'] },
  coffers: { id: 'coffers', name: 'Cabal Coffers', type_line: 'Land', produced_mana: ['B'] },
  sol: { id: 'sol', name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}', produced_mana: ['C'] },
  bear: { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', mana_cost: '{1}{G}' },
  bolt: { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', mana_cost: '{R}' },
  fireball: { id: 'fireball', name: 'Fireball', type_line: 'Sorcery', mana_cost: '{X}{R}' },
  dfc: {
    id: 'dfc',
    name: 'A Modal Land',
    card_faces: [
      { name: 'Front', mana_cost: '{1}{U}' },
      { name: 'Back', mana_cost: '', produced_mana: ['U'] },
    ],
  },
}
const cardFor = (inst) => CARDS[inst.cardId] ?? null

/** A board with the named cards on the battlefield, all untapped. */
function table(cardIds) {
  let board = createBoard({ players: ['you'], seed: 1 })
  const result = apply(board, {
    type: 'seat',
    player: 'you',
    cards: cardIds,
    lanes: Object.fromEntries(cardIds.map((id) => [id, 'lands'])),
    shuffle: false,
  })
  board = result.board
  const ids = [...board.zones.you.hand, ...board.zones.you.library]
  for (const id of ids.slice(0, cardIds.length)) {
    board = apply(board, { type: 'move', id, zone: 'battlefield', lane: 'lands' }).board
  }
  return board
}

describe('what is untapped', () => {
  it('counts the sources and lists the colours between them', () => {
    const pool = untappedSources(table(['forest', 'mountain']), 'you', cardFor)
    expect(pool.count).toBe(2)
    expect(pool.colours).toEqual(['R', 'G'])
  })

  it('lists a colour once however many make it', () => {
    const pool = untappedSources(table(['forest', 'forest', 'forest']), 'you', cardFor)
    expect(pool.count).toBe(3)
    expect(pool.colours).toEqual(['G'])
  })

  it('gives a dual land both of its colours', () => {
    expect(untappedSources(table(['grove']), 'you', cardFor).colours).toEqual(['W', 'G'])
  })

  it('leaves out anything tapped', () => {
    let board = table(['forest', 'mountain'])
    const first = board.zones.you.battlefield[0]
    board = apply(board, { type: 'tap', id: first }).board
    expect(untappedSources(board, 'you', cardFor).count).toBe(1)
  })

  it('counts a Sol Ring as one source, because two would mean reading it', () => {
    const pool = untappedSources(table(['sol']), 'you', cardFor)
    expect(pool.count).toBe(1)
    expect(pool.colours).toEqual(['C'])
  })

  it('counts a conditional land the same as a basic, because it cannot know', () => {
    // Cabal Coffers makes nothing without a Swamp. Scryfall still says it
    // produces black, and this readout believes Scryfall rather than guessing.
    expect(untappedSources(table(['coffers']), 'you', cardFor).count).toBe(1)
  })

  it('skips a card whose data has not arrived rather than refusing to answer', () => {
    const pool = untappedSources(table(['forest', 'mountain']), 'you', () => null)
    expect(pool).toEqual({ count: 0, colours: [], sources: [] })
  })

  it('counts nothing on an empty table', () => {
    expect(untappedSources(createBoard({ players: ['you'] }), 'you', cardFor).count).toBe(0)
  })

  it('survives being handed no board at all', () => {
    expect(untappedSources(null, 'you', cardFor).count).toBe(0)
  })
})

describe('what a printing produces', () => {
  it('orders the colours the way Magic prints them', () => {
    expect(producedBy({ produced_mana: ['G', 'W', 'U'] })).toEqual(['W', 'U', 'G'])
  })

  it('reads the back of a double-faced card too', () => {
    expect(producedBy(CARDS.dfc)).toEqual(['U'])
  })

  it('is empty for a card that makes no mana', () => {
    expect(producedBy(CARDS.bear)).toEqual([])
    expect(producedBy(null)).toEqual([])
  })
})

describe('whether a cost is within reach', () => {
  const pool = (count) => ({ count, colours: ['G'], sources: [] })

  it('says yes when there are enough sources', () => {
    expect(withinReach(CARDS.bear, pool(2))).toBe('yes')
  })

  it('and no when there are not', () => {
    expect(withinReach(CARDS.bear, pool(1))).toBe('no')
  })

  it('never answers for a card with no cost', () => {
    expect(withinReach(CARDS.forest, pool(5))).toBe(null)
  })

  it('never answers without a pool to compare against', () => {
    expect(withinReach(CARDS.bolt, null)).toBe(null)
  })

  it('treats X as nothing, so a Fireball is castable for one', () => {
    expect(withinReach(CARDS.fireball, pool(1))).toBe('yes')
  })

  it('reads the front of a double-faced card', () => {
    expect(withinReach(CARDS.dfc, pool(2))).toBe('yes')
    expect(withinReach(CARDS.dfc, pool(1))).toBe('no')
  })
})
