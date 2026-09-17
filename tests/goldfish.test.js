import { describe, it, expect } from 'vitest'
import {
  rng, shuffle, buildLibrary, newGame, mulligan, bottomCount, keep, draw, nextTurn,
  describeHand, skipsFirstDraw, OPENING_HAND,
} from '../src/lib/goldfish.js'

const LAND = { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest' }
const SPELL = { id: 'elf', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' }
const CMDR = { id: 'cmdr', name: 'Test Commander', type_line: 'Legendary Creature — Elf' }
const lookup = (id) => ({ forest: LAND, elf: SPELL, cmdr: CMDR }[id])
const isLand = (card) => /\bLand\b/.test(card.type_line)

// 40 lands + 59 spells + 1 commander = a legal hundred.
const deck = () => ({
  commanders: ['cmdr'],
  main: [{ cardId: 'forest', quantity: 40 }, { cardId: 'elf', quantity: 59 }],
  sideboard: [],
})

describe('shuffling', () => {
  it('is reproducible from a seed', () => {
    const cards = Array.from({ length: 40 }, (_, i) => i)
    expect(shuffle(cards, rng(9))).toEqual(shuffle(cards, rng(9)))
  })

  it('differs between seeds', () => {
    const cards = Array.from({ length: 40 }, (_, i) => i)
    expect(shuffle(cards, rng(1))).not.toEqual(shuffle(cards, rng(2)))
  })

  it('loses nothing and duplicates nothing', () => {
    const cards = Array.from({ length: 99 }, (_, i) => i)
    expect([...shuffle(cards, rng(3))].sort((a, b) => a - b)).toEqual(cards)
  })

  it('does not modify what it was given', () => {
    const cards = [1, 2, 3, 4, 5]
    shuffle(cards, rng(5))
    expect(cards).toEqual([1, 2, 3, 4, 5])
  })

  it('actually moves cards', () => {
    const cards = Array.from({ length: 60 }, (_, i) => i)
    expect(shuffle(cards, rng(11))).not.toEqual(cards)
  })
})

describe('buildLibrary', () => {
  // The commander starts in the command zone. Shuffling it into the ninety-nine
  // is an off-by-one that skews every number drawn from this.
  it('leaves the commander out of the library', () => {
    const library = buildLibrary(deck(), lookup)
    expect(library).toHaveLength(99)
    expect(library.some((c) => c.id === 'cmdr')).toBe(false)
  })

  it('expands quantities into individual cards', () => {
    expect(buildLibrary(deck(), lookup).filter((c) => c.id === 'forest')).toHaveLength(40)
  })

  it('skips a card that has not loaded rather than shuffling in a hole', () => {
    const withGhost = { ...deck(), main: [...deck().main, { cardId: 'ghost', quantity: 3 }] }
    expect(buildLibrary(withGhost, lookup)).toHaveLength(99)
  })

  it('handles an empty deck', () => {
    expect(buildLibrary({ main: [] }, lookup)).toEqual([])
    expect(buildLibrary(undefined, lookup)).toEqual([])
  })
})

describe('the opening hand', () => {
  it('is seven cards, and the rest is the library', () => {
    const game = newGame(deck(), lookup, { seed: 1 })
    expect(game.hand).toHaveLength(OPENING_HAND)
    expect(game.library).toHaveLength(99 - OPENING_HAND)
  })

  it('is the same hand for the same seed', () => {
    const names = (g) => g.hand.map((c) => c.id).join(',')
    expect(names(newGame(deck(), lookup, { seed: 4 }))).toBe(names(newGame(deck(), lookup, { seed: 4 })))
  })
})

describe('the London mulligan', () => {
  it('draws a fresh seven every time, not six then five', () => {
    let game = newGame(deck(), lookup, { seed: 2 })
    for (let i = 0; i < 3; i++) {
      game = mulligan(game, deck(), lookup)
      expect(game.hand).toHaveLength(OPENING_HAND)
    }
  })

  it('counts the mulligans taken', () => {
    let game = newGame(deck(), lookup, { seed: 2 })
    game = mulligan(game, deck(), lookup)
    game = mulligan(game, deck(), lookup)
    expect(game.mulligans).toBe(2)
    expect(bottomCount(game)).toBe(2)
  })

  it('shuffles the whole deck back in each time', () => {
    const game = mulligan(newGame(deck(), lookup, { seed: 2 }), deck(), lookup)
    expect(game.hand.length + game.library.length).toBe(99)
  })

  it('keeps which side of the table the player is on', () => {
    const game = mulligan(newGame(deck(), lookup, { seed: 2, onPlay: false }), deck(), lookup)
    expect(game.onPlay).toBe(false)
  })

  it('gives a different hand than the one refused', () => {
    const first = newGame(deck(), lookup, { seed: 2 })
    const second = mulligan(first, deck(), lookup)
    expect(second.hand.map((c) => c.id)).not.toEqual(first.hand.map((c) => c.id))
  })
})

describe('keeping', () => {
  const afterTwo = () => {
    let game = newGame(deck(), lookup, { seed: 6 })
    game = mulligan(game, deck(), lookup)
    return mulligan(game, deck(), lookup)
  }

  // Which cards to bottom IS the mulligan decision. Choosing for the player
  // would remove the thing being practised.
  it('refuses the wrong number rather than picking for you', () => {
    const result = keep(afterTwo(), [0])
    expect(result.error).toMatch(/exactly 2/)
    expect(result.kept).toBeFalsy()
  })

  it('bottoms exactly the cards chosen', () => {
    const game = afterTwo()
    const doomed = [game.hand[0], game.hand[3]]
    const result = keep(game, [0, 3])
    expect(result.hand).toHaveLength(5)
    expect(result.library.slice(-2)).toEqual(doomed)
  })

  it('puts them on the bottom, not the top', () => {
    const game = afterTwo()
    const result = keep(game, [0, 1])
    expect(result.library[0]).toEqual(game.library[0])
  })

  it('keeps a first hand with nothing to bottom', () => {
    const result = keep(newGame(deck(), lookup, { seed: 6 }), [])
    expect(result.kept).toBe(true)
    expect(result.hand).toHaveLength(7)
  })

  it('draws for turn one when on the draw', () => {
    expect(keep(newGame(deck(), lookup, { seed: 6, onPlay: false }), []).hand).toHaveLength(8)
  })

  it('does not when on the play', () => {
    expect(keep(newGame(deck(), lookup, { seed: 6, onPlay: true }), []).hand).toHaveLength(7)
  })
})

describe('drawing', () => {
  const started = () => keep(newGame(deck(), lookup, { seed: 8 }), [])

  it('moves cards from the top of the library to the hand', () => {
    const game = started()
    const top = game.library[0]
    const after = draw(game, 1)
    expect(after.hand.at(-1)).toEqual(top)
    expect(after.library).toHaveLength(game.library.length - 1)
  })

  it('says so rather than pretending when the library runs out', () => {
    const game = { ...started(), library: [LAND] }
    const after = draw(game, 3)
    expect(after.error).toMatch(/empty/)
    expect(after.library).toEqual([])
  })

  it('always draws on a new turn', () => {
    const game = nextTurn(started())
    expect(game.turn).toBe(2)
    expect(game.hand).toHaveLength(8)
  })

  // An earlier version skipped the turn-two draw for anyone who had drawn a
  // card on turn one, because it tested "has anything been drawn yet".
  it('draws on turn two even after a cantrip on turn one', () => {
    const cantripped = draw(started(), 1)
    expect(nextTurn(cantripped).hand).toHaveLength(9)
  })
})

describe('describeHand', () => {
  it('counts lands and spells', () => {
    expect(describeHand([LAND, LAND, SPELL], isLand)).toMatchObject({ size: 3, lands: 2, spells: 1 })
  })

  it('calls a no-land hand unkeepable', () => {
    expect(describeHand([SPELL, SPELL], isLand).keepable).toBe(false)
  })

  it('calls an all-land hand unkeepable too', () => {
    expect(describeHand([LAND, LAND], isLand).keepable).toBe(false)
  })

  it('calls a mixed hand keepable', () => {
    expect(describeHand([LAND, SPELL], isLand).keepable).toBe(true)
  })

  it('handles an empty hand', () => {
    expect(describeHand([], isLand)).toMatchObject({ size: 0, lands: 0, keepable: false })
  })
})

describe('how many at the table', () => {
  it('two players: the one going first skips the first draw', () => {
    const game = keep(newGame(deck(), lookup, { seed: 3, onPlay: true, multiplayer: false }), [])
    expect(game.hand).toHaveLength(7)
    expect(skipsFirstDraw(game)).toBe(true)
  })
  it('two players: the one going second draws', () => {
    const game = keep(newGame(deck(), lookup, { seed: 3, onPlay: false, multiplayer: false }), [])
    expect(game.hand).toHaveLength(8)
  })
  it('three or more: nobody skips it, even on the play', () => {
    const game = keep(newGame(deck(), lookup, { seed: 3, onPlay: true, multiplayer: true }), [])
    expect(game.hand).toHaveLength(8)
    expect(skipsFirstDraw(game)).toBe(false)
  })
  it('a mulligan remembers the table', () => {
    const game = mulligan(newGame(deck(), lookup, { seed: 3, onPlay: true, multiplayer: true }), deck(), lookup)
    expect(game.multiplayer).toBe(true)
    expect(keep(game, [0]).hand).toHaveLength(7) // six kept, one drawn
  })
  it('defaults to the two-player rule when not told', () => {
    expect(skipsFirstDraw(newGame(deck(), lookup, { seed: 1 }))).toBe(true)
  })
})
