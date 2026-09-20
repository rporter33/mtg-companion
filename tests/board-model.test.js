import { describe, it, expect } from 'vitest'
import { createBoard, invariants, battlefield, handOf, librarySize, nameOf, stacked, zoneOf, attachedTo, hostOf, ZONES } from '../src/lib/board/model.js'
import { laneById } from '../src/lib/board/placement.js'
import { apply } from '../src/lib/board/reducer.js'
import { act, undo, newRun, applyAll, snapshot, restore, UNDO_DEPTH } from '../src/lib/board/runner.js'
import { clampToField, overlaps, cardAt, freeSpot, tidy, pointToField, fan, CARD_W, CARD_H } from '../src/lib/board/geometry.js'
import { notesFor, manaAvailable, looksCastable } from '../src/lib/board/coach.js'
import { libraryOf, dealAction, openingActions, mulliganActions, swapPrinting, OPENING_HAND } from '../src/lib/board/deck.js'

/**
 * The board is a table, not a judge, so almost none of these tests are about
 * rules. They are about the table staying coherent: a card in exactly one
 * place, a token that stops existing when it leaves, a position that survives
 * a phone rotation. The one place a rule appears is the coach, and it only
 * ever speaks.
 */

// A handful of cards shaped the way Scryfall serves them. Nothing here needs
// a rules engine: the coach reads these same fields for any card ever printed.
const CARDS = {
  forest: { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', produced_mana: ['G'], mana_cost: '' },
  island: { id: 'island', name: 'Island', type_line: 'Basic Land — Island', produced_mana: ['U'], mana_cost: '' },
  bear: { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', mana_cost: '{1}{G}', oracle_text: '' },
  hasty: { id: 'hasty', name: 'Raging Goblin', type_line: 'Creature — Goblin', mana_cost: '{R}', oracle_text: 'Haste' },
  big: { id: 'big', name: 'Colossal Dreadmaw', type_line: 'Creature — Dinosaur', mana_cost: '{4}{G}{G}', oracle_text: 'Trample' },
  bolt: { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Deal 3 damage to any target.' },
}
const lookup = (id) => CARDS[id] ?? null

const ok = (result) => {
  expect(result.ok, result.reason?.message).toBe(true)
  expect(invariants(result.board)).toEqual([])
  return result
}
const refused = (result, code) => {
  expect(result.ok).toBe(false)
  expect(result.reason.code).toBe(code)
  return result
}

/**
 * A board with a seated player, returning the board and a finder for its cards.
 *
 * Unguided by default: most of what these tests are about is the bare table,
 * where a card goes exactly where it is put. The marked playmat has a
 * describe block of its own further down.
 */
function seated(cards = ['forest', 'forest', 'bear', 'bolt', 'island'], options = {}) {
  const board = createBoard({ seed: 7, guided: false, ...options })
  const result = ok(apply(board, { type: 'seat', player: 'you', cards, shuffle: false }))
  const find = (cardId, zone = null) => Object.values(result.board.cards).find((c) => c.cardId === cardId && (!zone || c.zone === zone))
  return { board: result.board, find }
}

/** Applies actions in order, checking the invariants after each one. */
function run(board, actions) {
  let state = board
  for (const action of actions) state = ok(apply(state, action)).board
  return state
}

describe('geometry', () => {
  it('keeps a whole card inside the field however far it is dragged', () => {
    expect(clampToField(-5, 5)).toEqual({ x: CARD_W / 2, y: 1 - CARD_H / 2 })
    expect(clampToField(0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 })
    expect(clampToField(NaN, undefined)).toEqual({ x: CARD_W / 2, y: CARD_H / 2 })
  })

  it('reads a pile as a pile and two cards as two cards', () => {
    expect(overlaps({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 })).toBe(true)
    expect(overlaps({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 })).toBe(false)
  })

  it('picks the card on top, because later cards are drawn last', () => {
    const cards = [{ id: 'under', x: 0.5, y: 0.5 }, { id: 'over', x: 0.51, y: 0.5 }]
    expect(cardAt({ x: 0.51, y: 0.5 }, cards).id).toBe('over')
    expect(cardAt({ x: 0.9, y: 0.9 }, cards)).toBe(null)
  })

  it('never drops a card exactly onto another by accident', () => {
    const taken = [{ x: 0.5, y: 0.5 }]
    const spot = freeSpot({ x: 0.5, y: 0.5 }, taken)
    expect(spot).not.toEqual({ x: 0.5, y: 0.5 })
    expect(overlaps(spot, taken[0], { share: 0.35 })).toBe(false)
  })

  it('tidies lands to the back row and everything else in front', () => {
    const cards = [
      { id: 'a', x: 0.1, y: 0.9 }, { id: 'b', x: 0.9, y: 0.1 },
      { id: 'l1', x: 0.3, y: 0.3 }, { id: 'l2', x: 0.4, y: 0.4 },
    ]
    const placed = tidy(cards, { isLand: (c) => c.id.startsWith('l') })
    const at = (id) => placed.find((c) => c.id === id)
    expect(at('l1').y).toBeGreaterThan(at('a').y)
    expect(at('l1').x).not.toBe(at('l2').x)
    for (const card of placed) expect(card).toEqual({ ...cards.find((c) => c.id === card.id), x: card.x, y: card.y })
  })

  it('turns a pointer inside a box into fractions, and copes with no box', () => {
    expect(pointToField({ x: 50, y: 25 }, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: 0.5, y: 0.25 })
    expect(pointToField({ x: 0, y: 0 }, null)).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('the table', () => {
  it('deals a deck into a library and nowhere else', () => {
    const { board } = seated()
    expect(librarySize(board, 'you')).toBe(5)
    expect(handOf(board, 'you')).toEqual([])
    expect(Object.keys(board.cards)).toHaveLength(5)
  })

  it('shuffles the same way twice from the same seed, and differently from another', () => {
    const cards = ['forest', 'island', 'bear', 'bolt', 'big', 'hasty']
    const order = (seed) => apply(createBoard({ seed }), { type: 'seat', cards }).board.zones.you.library
    expect(order(7)).toEqual(order(7))
    expect(order(7)).not.toEqual(order(8))
  })

  it('refuses to draw from an empty library, because that is the only thing that is impossible', () => {
    const { board } = seated(['forest'])
    const drawn = ok(apply(board, { type: 'draw', player: 'you' })).board
    expect(handOf(drawn, 'you')).toHaveLength(1)
    refused(apply(drawn, { type: 'draw', player: 'you' }), 'emptyLibrary')
  })

  it('draws what it can and says the library ran out', () => {
    const { board } = seated(['forest', 'island'])
    const result = ok(apply(board, { type: 'draw', count: 5 }))
    expect(handOf(result.board, 'you')).toHaveLength(2)
    expect(result.events.map((e) => e.type)).toContain('libraryEmpty')
  })

  it('keeps every card in exactly one zone, whatever is done to it', () => {
    const { board, find } = seated()
    const bear = find('bear').id
    const state = run(board, [
      { type: 'draw', count: 3 },
      { type: 'move', id: bear, zone: 'battlefield' },
      { type: 'move', id: bear, zone: 'graveyard' },
      { type: 'move', id: bear, zone: 'exile' },
      { type: 'move', id: bear, zone: 'library', to: 'bottom' },
      { type: 'move', id: bear, zone: 'command' },
    ])
    const zones = ZONES.filter((z) => state.zones.you[z].includes(bear))
    expect(zones).toEqual(['command'])
  })

  it('honours a dropped position and finds a free one when none is given', () => {
    const { board, find } = seated()
    const a = find('forest').id
    const b = find('bear').id
    const dropped = ok(apply(board, { type: 'move', id: a, zone: 'battlefield', x: 0.2, y: 0.8 })).board
    expect(dropped.cards[a]).toMatchObject({ x: 0.2, y: 0.8 })

    // Neither of these says where to go, so the second has to step aside.
    const stackedUp = run(board, [
      { type: 'move', id: a, zone: 'battlefield' },
      { type: 'move', id: b, zone: 'battlefield' },
    ])
    expect(stackedUp.cards[a]).toMatchObject({ x: 0.5, y: 0.5 })
    expect(overlaps(stackedUp.cards[b], stackedUp.cards[a], { share: 0.35 })).toBe(false)
    expect(stackedUp.cards[b].z).toBeGreaterThan(stackedUp.cards[a].z)
    expect(stacked(stackedUp, 'you').map((c) => c.id)).toEqual([a, b])
  })

  it('forgets everything that only meant something on the battlefield', () => {
    const { board, find } = seated()
    const bear = find('bear').id
    const played = run(board, [
      { type: 'move', id: bear, zone: 'battlefield', x: 0.3, y: 0.3 },
      { type: 'tap', id: bear },
      { type: 'counter', id: bear, name: '+1/+1', delta: 2 },
      { type: 'note', id: bear, text: 'blocking the big one' },
    ])
    expect(played.cards[bear]).toMatchObject({ tapped: true, counters: { '+1/+1': 2 }, note: 'blocking the big one' })
    const dead = ok(apply(played, { type: 'move', id: bear, zone: 'graveyard' })).board
    expect(dead.cards[bear]).toMatchObject({ tapped: false, x: 0.5, y: 0.5, counters: {}, note: '' })
  })

  it('lets a token exist only on the battlefield, as a real one does', () => {
    const { board } = seated()
    const made = ok(apply(board, { type: 'makeToken', cardId: 'bear', count: 2 }))
    expect(made.events.filter((e) => e.type === 'tokenMade')).toHaveLength(2)
    expect(battlefield(made.board, 'you')).toHaveLength(2)

    const token = battlefield(made.board, 'you')[0].id
    const gone = ok(apply(made.board, { type: 'move', id: token, zone: 'graveyard' }))
    expect(gone.board.cards[token]).toBeUndefined()
    expect(gone.board.zones.you.graveyard).toEqual([])
    expect(gone.events[0].type).toBe('tokenGone')
  })

  it('names a made-up card whatever it was called', () => {
    const { board } = seated()
    const custom = { name: 'The Ur-Dragon, but worse', typeLine: 'Creature — Dragon' }
    const made = ok(apply(board, { type: 'makeToken', custom })).board
    const id = battlefield(made, 'you')[0].id
    expect(nameOf(made, id, lookup)).toBe('The Ur-Dragon, but worse')
    refused(apply(board, { type: 'makeToken' }), 'needsACard')
  })

  it('invents the same token ids on a replay', () => {
    const { board } = seated()
    const once = apply(board, { type: 'makeToken', cardId: 'bear', count: 3 }).board
    const twice = apply(board, { type: 'makeToken', cardId: 'bear', count: 3 }).board
    expect(Object.keys(once.cards)).toEqual(Object.keys(twice.cards))
  })

  it('taps and untaps only on the battlefield', () => {
    const { board, find } = seated()
    const bear = find('bear').id
    refused(apply(board, { type: 'tap', id: bear }), 'notOnBattlefield')
    const played = ok(apply(board, { type: 'move', id: bear, zone: 'battlefield' })).board
    const tapped = ok(apply(played, { type: 'tap', id: bear }))
    expect(tapped.board.cards[bear].tapped).toBe(true)
    expect(tapped.events[0].type).toBe('tapped')
    expect(ok(apply(tapped.board, { type: 'tap', id: bear })).board.cards[bear].tapped).toBe(false)
    expect(ok(apply(tapped.board, { type: 'tap', id: bear, value: true })).board.cards[bear].tapped).toBe(true)
  })

  it('untaps everything a player controls at once', () => {
    const { board, find } = seated()
    const ids = [find('forest').id, find('island').id]
    let state = board
    for (const id of ids) state = run(state, [{ type: 'move', id, zone: 'battlefield' }, { type: 'tap', id }])
    const result = ok(apply(state, { type: 'untapAll', player: 'you' }))
    expect(result.events[0]).toMatchObject({ type: 'untappedAll', count: 2 })
    expect(battlefield(result.board, 'you').every((c) => !c.tapped)).toBe(true)
  })

  it('removes a counter rather than keeping a zero', () => {
    const { board, find } = seated()
    const bear = find('bear').id
    const state = run(board, [
      { type: 'move', id: bear, zone: 'battlefield' },
      { type: 'counter', id: bear, name: '+1/+1', delta: 1 },
      { type: 'counter', id: bear, name: '+1/+1', delta: -1 },
    ])
    expect(state.cards[bear].counters).toEqual({})
  })

  it('tracks life and player counters as plain numbers', () => {
    const { board } = seated([], { players: ['you', 'them'] })
    const state = run(board, [
      { type: 'life', player: 'you', delta: -3 },
      { type: 'life', player: 'them', value: 40 },
      { type: 'playerCounter', player: 'you', name: 'poison', delta: 2 },
      { type: 'playerCounter', player: 'you', name: 'poison', delta: -2 },
    ])
    expect(state.life).toEqual({ you: 17, them: 40 })
    expect(state.counters.you).toEqual({})
    refused(apply(state, { type: 'life', player: 'nobody', delta: 1 }), 'noSuchPlayer')
  })

  it('shuffles a pile whose order is hidden, and refuses one that is not', () => {
    const { board } = seated(['forest', 'island', 'bear', 'bolt', 'big', 'hasty'])
    const shuffled = ok(apply(board, { type: 'shuffle', player: 'you', seed: 3 }))
    expect(shuffled.board.zones.you.library).toHaveLength(6)
    expect(shuffled.board.zones.you.library).not.toEqual(board.zones.you.library)
    expect(apply(board, { type: 'shuffle', seed: 3 }).board.zones.you.library)
      .toEqual(apply(board, { type: 'shuffle', seed: 3 }).board.zones.you.library)
    refused(apply(board, { type: 'shuffle', zone: 'hand' }), 'cannotShuffle')
    refused(apply(board, { type: 'shuffle', zone: 'battlefield' }), 'cannotShuffle')
  })

  it('takes cards off the top for a mill, a scry or a dig', () => {
    const { board } = seated(['forest', 'island', 'bear', 'bolt'])
    const top = board.zones.you.library.slice(0, 2)
    const milled = ok(apply(board, { type: 'fromTop', count: 2, zone: 'graveyard' }))
    expect(milled.board.zones.you.graveyard).toEqual(top)
    expect(librarySize(milled.board, 'you')).toBe(2)
    expect(milled.events[0]).toMatchObject({ type: 'fromTop', count: 2 })
  })

  it('puts a card back on top or on the bottom of the library', () => {
    const { board } = seated(['forest', 'island', 'bear'])
    const bear = board.zones.you.library[2]
    const onTop = ok(apply(board, { type: 'move', id: bear, zone: 'library', to: 'top' })).board
    expect(onTop.zones.you.library[0]).toBe(bear)
    const onBottom = ok(apply(onTop, { type: 'move', id: bear, zone: 'library', to: 'bottom' })).board
    expect(onBottom.zones.you.library.at(-1)).toBe(bear)
  })

  it('shows a card to everyone and hides it again', () => {
    const { board, find } = seated()
    const bolt = find('bolt').id
    const shown = ok(apply(board, { type: 'reveal', id: bolt }))
    expect(shown.board.revealed).toEqual([bolt])
    expect(ok(apply(shown.board, { type: 'reveal', id: bolt })).board.revealed).toEqual([])
  })

  it('turns a card face down wherever it is', () => {
    const { board, find } = seated()
    const bear = find('bear').id
    const down = ok(apply(board, { type: 'flip', id: bear }))
    expect(down.board.cards[bear].faceDown).toBe(true)
    expect(down.events[0].type).toBe('turnedDown')
  })

  it('draws an arrow, takes it back when drawn again, and drops it when a card leaves', () => {
    const { board, find } = seated([], { players: ['you', 'them'] })
    const made = ok(apply(board, { type: 'makeToken', cardId: 'bear' })).board
    const token = battlefield(made, 'you')[0].id

    const drawn = ok(apply(made, { type: 'arrow', from: token, to: 'them', kind: 'attack' }))
    expect(drawn.board.arrows).toHaveLength(1)
    expect(ok(apply(drawn.board, { type: 'arrow', from: token, to: 'them' })).board.arrows).toEqual([])

    refused(apply(drawn.board, { type: 'arrow', from: token, to: 'nowhere' }), 'noSuchEnd')
    refused(apply(drawn.board, { type: 'arrow', from: token, to: token }), 'sameEnd')

    const gone = ok(apply(drawn.board, { type: 'move', id: token, zone: 'graveyard' })).board
    expect(gone.arrows).toEqual([])
  })

  it('clears every arrow at once, for the end of combat', () => {
    const { board } = seated([], { players: ['you', 'them'] })
    const made = ok(apply(board, { type: 'makeToken', cardId: 'bear', count: 2 })).board
    let state = made
    for (const inst of battlefield(made, 'you')) state = ok(apply(state, { type: 'arrow', from: inst.id, to: 'them' })).board
    expect(state.arrows).toHaveLength(2)
    expect(ok(apply(state, { type: 'clearArrows' })).board.arrows).toEqual([])
  })

  it('rolls a die the same way from the same seed, and keeps the last six', () => {
    const { board } = seated()
    const one = ok(apply(board, { type: 'roll', sides: 20, seed: 4 })).board
    expect(apply(board, { type: 'roll', sides: 20, seed: 4 }).board.dice[0].value).toBe(one.dice[0].value)
    expect(one.dice[0].value).toBeGreaterThanOrEqual(1)
    expect(one.dice[0].value).toBeLessThanOrEqual(20)
    let state = board
    for (let i = 0; i < 8; i++) state = ok(apply(state, { type: 'roll', seed: i })).board
    expect(state.dice).toHaveLength(6)
  })

  it('straightens the board without moving a card out of its zone', () => {
    const { board, find } = seated()
    const forest = find('forest').id
    const bear = find('bear').id
    const messy = run(board, [
      { type: 'move', id: forest, zone: 'battlefield', x: 0.9, y: 0.1 },
      { type: 'move', id: bear, zone: 'battlefield', x: 0.05, y: 0.95 },
    ])
    const neat = ok(apply(messy, { type: 'tidy', player: 'you', lands: [forest] })).board
    expect(neat.cards[forest].y).toBeGreaterThan(neat.cards[bear].y)
    expect(battlefield(neat, 'you')).toHaveLength(2)
  })

  it('leaves the turn to the player', () => {
    const { board } = seated([], { players: ['you', 'them'] })
    const set = ok(apply(board, { type: 'setTurn', turn: 3, active: 'them', step: 'damage' })).board
    expect(set).toMatchObject({ turn: 3, active: 'them', step: 'damage' })
    const back = ok(apply(set, { type: 'nextTurn' })).board
    expect(back).toMatchObject({ turn: 4, active: 'you', step: 'untap' })
    const onward = ok(apply(back, { type: 'nextTurn' })).board
    expect(onward).toMatchObject({ turn: 4, active: 'them' })
  })

  it('counts a turn in a game of one', () => {
    const { board } = seated()
    const next = ok(apply(board, { type: 'nextTurn' })).board
    expect(next).toMatchObject({ turn: 2, active: 'you' })
  })

  it('refuses only what is not physically possible', () => {
    const { board } = seated()
    refused(apply(board, { type: 'move', id: 'no-such', zone: 'hand' }), 'noSuchCard')
    refused(apply(board, { type: 'move', id: board.zones.you.library[0], zone: 'nowhere' }), 'noSuchZone')
    refused(apply(board, { type: 'sacrificeEverything' }), 'unknownAction')
    refused(apply(board, null), 'badAction')
  })

  it('re-seating a player forgets the arrows that pointed at their old cards', () => {
    const { board } = seated([], { players: ['you', 'them'] })
    const made = ok(apply(board, { type: 'makeToken', cardId: 'bear' })).board
    const token = battlefield(made, 'you')[0].id
    const pointed = ok(apply(made, { type: 'arrow', from: token, to: 'them' })).board
    const reseated = ok(apply(pointed, { type: 'seat', player: 'you', cards: ['forest'] })).board
    expect(reseated.arrows).toEqual([])
    expect(reseated.revealed).toEqual([])
  })

  it('never mutates the board it was given', () => {
    const { board, find } = seated()
    const before = JSON.stringify(board)
    apply(board, { type: 'move', id: find('bear').id, zone: 'battlefield' })
    apply(board, { type: 'draw', count: 3 })
    expect(JSON.stringify(board)).toBe(before)
  })
})

describe('one card on another', () => {
  /**
   * Two real cards on the battlefield at known spots — not tokens, because a
   * token that leaves stops existing and these tests are about what happens
   * to the card underneath.
   */
  function pair() {
    const { board, find } = seated()
    const host = find('bear').id
    const aura = find('bolt').id
    let state = ok(apply(board, { type: 'move', id: host, zone: 'battlefield', x: 0.4, y: 0.4 })).board
    state = ok(apply(state, { type: 'move', id: aura, zone: 'battlefield', x: 0.7, y: 0.6 })).board
    return { state, host, aura }
  }

  it('puts a card on another and remembers which way round', () => {
    const { state, host, aura } = pair()
    const on = ok(apply(state, { type: 'attach', id: aura, to: host }))
    expect(on.board.cards[aura].attachedTo).toBe(host)
    expect(hostOf(on.board, aura).id).toBe(host)
    expect(attachedTo(on.board, host).map((c) => c.id)).toEqual([aura])
    expect(on.events[0]).toMatchObject({ type: 'attached', to: host })
    // It moves onto what it is attached to, down and to the right, far enough
    // that the card underneath still reads and close enough to be one thing.
    const host_ = on.board.cards[host]
    const rider = on.board.cards[aura]
    expect(rider.x).toBeGreaterThan(host_.x)
    expect(rider.y).toBeGreaterThan(host_.y)
    expect(overlaps(rider, host_, { share: 1 })).toBe(true)
  })

  it('takes the aura with the creature', () => {
    const { state, host, aura } = pair()
    const on = ok(apply(state, { type: 'attach', id: aura, to: host })).board
    const offset = { x: on.cards[aura].x - on.cards[host].x, y: on.cards[aura].y - on.cards[host].y }
    const moved = ok(apply(on, { type: 'move', id: host, zone: 'battlefield', x: 0.8, y: 0.2 })).board
    expect(moved.cards[host]).toMatchObject({ x: 0.8, y: 0.2 })
    expect(moved.cards[aura].x - moved.cards[host].x).toBeCloseTo(offset.x, 5)
    expect(moved.cards[aura].y - moved.cards[host].y).toBeCloseTo(offset.y, 5)
  })

  it('drops the aura when the creature leaves the table', () => {
    const { state, host, aura } = pair()
    const on = ok(apply(state, { type: 'attach', id: aura, to: host })).board
    const dead = ok(apply(on, { type: 'move', id: host, zone: 'graveyard' })).board
    expect(dead.cards[aura].attachedTo).toBe(null)
    expect(dead.cards[aura].zone).toBe('battlefield')
    expect(invariants(dead)).toEqual([])
  })

  it('takes itself off when it leaves', () => {
    const { state, host, aura } = pair()
    const on = ok(apply(state, { type: 'attach', id: aura, to: host })).board
    const gone = ok(apply(on, { type: 'move', id: aura, zone: 'graveyard' })).board
    expect(gone.cards[aura].attachedTo).toBe(null)
    expect(attachedTo(gone, host)).toEqual([])
  })

  it('comes off by hand, and lands somewhere its own', () => {
    const { state, host, aura } = pair()
    const on = ok(apply(state, { type: 'attach', id: aura, to: host })).board
    const off = ok(apply(on, { type: 'detach', id: aura }))
    expect(off.board.cards[aura].attachedTo).toBe(null)
    expect(off.board.cards[aura].y).toBeGreaterThan(on.cards[aura].y)
    expect(off.events[0]).toMatchObject({ type: 'detached', from: host })
    refused(apply(off.board, { type: 'detach', id: aura }), 'notAttached')
  })

  it('refuses the two impossible cases and nothing else', () => {
    const { state, host, aura } = pair()
    refused(apply(state, { type: 'attach', id: aura, to: aura }), 'sameEnd')
    refused(apply(state, { type: 'attach', id: aura, to: 'nowhere' }), 'noSuchCard')
    const inHand = zoneOf(state, 'you', 'library')[0].id
    refused(apply(state, { type: 'attach', id: inHand, to: host }), 'notOnBattlefield')
    const on = ok(apply(state, { type: 'attach', id: aura, to: host })).board
    refused(apply(on, { type: 'attach', id: host, to: aura }), 'wouldLoop')
  })

  it('stacks a second card on the same host below the first', () => {
    const { state, host, aura } = pair()
    let on = ok(apply(state, { type: 'attach', id: aura, to: host })).board
    const second = zoneOf(on, 'you', 'library').find((c) => c.cardId === 'forest').id
    on = ok(apply(on, { type: 'move', id: second, zone: 'battlefield', x: 0.2, y: 0.9 })).board
    const both = ok(apply(on, { type: 'attach', id: second, to: host }))
    expect(both.board.cards[second].y).toBeGreaterThan(both.board.cards[aura].y)
    expect(attachedTo(both.board, host)).toHaveLength(2)
    expect(invariants(both.board)).toEqual([])
  })

  it('tidies the creature and lets the aura ride along', () => {
    const { state, host, aura } = pair()
    const on = ok(apply(state, { type: 'attach', id: aura, to: host })).board
    const offset = { x: on.cards[aura].x - on.cards[host].x, y: on.cards[aura].y - on.cards[host].y }
    const neat = ok(apply(on, { type: 'tidy', player: 'you' })).board
    expect(neat.cards[aura].x - neat.cards[host].x).toBeCloseTo(offset.x, 5)
    expect(invariants(neat)).toEqual([])
  })

  it('comes apart when the token underneath stops existing', () => {
    const { board, find } = seated()
    const aura = find('bolt').id
    let state = ok(apply(board, { type: 'move', id: aura, zone: 'battlefield', x: 0.5, y: 0.5 })).board
    state = ok(apply(state, { type: 'makeToken', cardId: 'bear', x: 0.3, y: 0.3 })).board
    const token = battlefield(state, 'you').find((c) => c.token).id
    state = ok(apply(state, { type: 'attach', id: aura, to: token })).board
    // The token is destroyed, so there is nothing left to be attached to.
    const after = ok(apply(state, { type: 'move', id: token, zone: 'graveyard' })).board
    expect(after.cards[aura].attachedTo).toBe(null)
  })

  it('remembers which copy of a printing this is', () => {
    const { board, find } = seated()
    const bear = find('bear').id
    const foil = ok(apply(board, { type: 'finish', id: bear, value: 'foil' }))
    expect(foil.board.cards[bear].finish).toBe('foil')
    expect(foil.events[0]).toMatchObject({ type: 'finished', value: 'foil' })
    refused(apply(board, { type: 'finish', id: bear, value: 'holographic' }), 'noSuchFinish')
  })

  it('swaps every copy of a printing for a nicer one, changing nothing else', () => {
    const { board } = seated(['forest', 'forest', 'bear'])
    const played = run(board, [
      { type: 'draw', count: 3 },
      { type: 'move', id: board.zones.you.library[0], zone: 'battlefield', x: 0.3, y: 0.3 },
      { type: 'tap', id: board.zones.you.library[0] },
    ])
    const before = zoneOf(played, 'you', 'battlefield')[0]
    const swapped = ok(apply(played, { type: 'reprint', from: 'forest', to: 'forest-showcase', finish: 'foil' }))
    const copies = Object.values(swapped.board.cards).filter((c) => c.cardId === 'forest-showcase')
    expect(copies).toHaveLength(2)
    expect(swapped.events[0]).toMatchObject({ type: 'reprinted', count: 2 })
    // The same card in different clothes: same instance, same spot, still tapped.
    const after = zoneOf(swapped.board, 'you', 'battlefield')[0]
    expect(after).toMatchObject({ id: before.id, x: before.x, y: before.y, tapped: true, finish: 'foil' })
    expect(Object.values(swapped.board.cards).some((c) => c.cardId === 'forest')).toBe(false)
  })

  it('refuses a swap of a printing that is not on the table', () => {
    const { board } = seated()
    refused(apply(board, { type: 'reprint', from: 'nothing', to: 'else' }), 'noSuchCard')
    refused(apply(board, { type: 'reprint', from: 'forest' }), 'needsACard')
  })

  it('flips a coin as a two-sided die', () => {
    const { board } = seated()
    const flip = ok(apply(board, { type: 'roll', sides: 2, seed: 11, label: 'Who starts' }))
    expect([1, 2]).toContain(flip.board.dice[0].value)
    expect(flip.events[0]).toMatchObject({ type: 'rolled', sides: 2, label: 'Who starts' })
  })
})

describe('the marked playmat', () => {
  /**
   * A guided board, with each card told which row it belongs in — which is
   * how the screen deals one: placement.js reads the type line, the seat
   * action carries the answer, and the reducer never learns what a card is.
   */
  const LANES = { forest: 'lands', bear: 'creatures', island: 'lands', bolt: null, big: 'siege' }
  function playmat(cards = ['forest', 'bear', 'bolt', 'island'], options = {}) {
    const board = createBoard({ seed: 7, guided: true, ...options })
    const result = ok(apply(board, { type: 'seat', player: 'you', cards, lanes: LANES, shuffle: false }))
    const find = (cardId, zone = null) => Object.values(result.board.cards).find((c) => c.cardId === cardId && (!zone || c.zone === zone))
    return { board: result.board, find }
  }

  it('puts a card in the row its type belongs to, wherever it was dropped', () => {
    const { board, find } = playmat()
    const forest = find('forest').id
    const bear = find('bear').id
    const laid = run(board, [
      { type: 'move', id: forest, zone: 'battlefield', x: 0.3, y: 0.1 },
      { type: 'move', id: bear, zone: 'battlefield', x: 0.7, y: 0.95 },
    ])
    // The row is decided by the card; the place along it is still yours.
    expect(laid.cards[forest]).toMatchObject({ x: 0.3, y: laneById('lands').y })
    expect(laid.cards[bear]).toMatchObject({ x: 0.7, y: laneById('creatures').y })
    expect(laid.cards[bear].y).toBeLessThan(laid.cards[forest].y)
  })

  it('will not leave an instant on the battlefield, and says so', () => {
    const { board, find } = playmat()
    const bolt = find('bolt').id
    const refusal = refused(apply(board, { type: 'move', id: bolt, zone: 'battlefield' }), 'notAPermanent')
    expect(refusal.reason.message).toMatch(/does not stay on the battlefield/)
    // It goes to the stack instead, which is where a spell actually goes.
    const cast = ok(apply(board, { type: 'move', id: bolt, zone: 'stack' }))
    expect(cast.board.cards[bolt].zone).toBe('stack')
    expect(invariants(cast.board)).toEqual([])
  })

  it('lets the same instant sit anywhere once the table is bare', () => {
    const { board, find } = playmat()
    const bolt = find('bolt').id
    const bare = ok(apply(board, { type: 'setGuided', value: false })).board
    expect(bare.guided).toBe(false)
    const laid = ok(apply(bare, { type: 'move', id: bolt, zone: 'battlefield', x: 0.2, y: 0.2 }))
    expect(laid.board.cards[bolt]).toMatchObject({ x: 0.2, y: 0.2 })
    expect(invariants(laid.board)).toEqual([])
  })

  it('tidies each row along its own line', () => {
    const { board, find } = playmat(['forest', 'forest', 'bear', 'island'])
    let state = board
    for (const inst of zoneOf(board, 'you', 'library')) {
      if (LANES[inst.cardId]) state = ok(apply(state, { type: 'move', id: inst.id, zone: 'battlefield' })).board
    }
    const neat = ok(apply(state, { type: 'tidy', player: 'you' })).board
    const rows = new Map()
    for (const inst of battlefield(neat, 'you')) {
      rows.set(inst.lane, [...(rows.get(inst.lane) ?? []), inst])
    }
    for (const [lane, cards] of rows) {
      for (const inst of cards) expect(inst.y, lane).toBeCloseTo(laneById(lane).y, 5)
      const xs = cards.map((c) => c.x)
      expect(new Set(xs).size, `${lane} rows overlap`).toBe(xs.length)
    }
  })

  it('makes a token into a row too', () => {
    const { board } = playmat()
    const made = ok(apply(board, { type: 'makeToken', cardId: 'bear', lane: 'creatures' })).board
    const token = battlefield(made, 'you').find((c) => c.token)
    expect(token.y).toBeCloseTo(laneById('creatures').y, 5)
    refused(apply(board, { type: 'makeToken', cardId: 'bolt', lane: null }), 'notAPermanent')
  })

  it('walks the turn one step at a time, and skips first strike unless it is there', () => {
    const { board } = playmat()
    expect(board.step).toBe('untap')
    let state = board
    const walk = (n, options) => { for (let i = 0; i < n; i++) state = ok(apply(state, { type: 'step', ...options })).board }
    walk(6)
    expect(state.step).toBe('blockers')
    walk(1)
    expect(state.step).toBe('damage')     // no first strike in combat
    state = ok(apply(board, { type: 'setTurn', step: 'blockers' })).board
    state = ok(apply(state, { type: 'step', hasFirstStrike: true })).board
    expect(state.step).toBe('firstStrike')
  })

  it('counts a turn when the steps roll over, not before', () => {
    const { board } = playmat()
    let state = ok(apply(board, { type: 'setTurn', step: 'end' })).board
    state = ok(apply(state, { type: 'step' })).board
    expect(state).toMatchObject({ step: 'cleanup', turn: 1 })
    const over = ok(apply(state, { type: 'step' }))
    expect(over.board).toMatchObject({ step: 'untap', turn: 2 })
    expect(over.events.map((e) => e.type)).toContain('turnBegan')
  })

  it('refuses a step that is not in a turn', () => {
    const { board } = playmat()
    refused(apply(board, { type: 'step', to: 'teatime' }), 'noSuchStep')
    expect(ok(apply(board, { type: 'step', to: 'main1' })).board.step).toBe('main1')
  })
})

describe('running a table', () => {
  const start = () => newRun(seated().board)

  it('keeps the events, stamped with the turn they happened on', () => {
    let run = start()
    const bear = Object.values(run.board.cards).find((c) => c.cardId === 'bear').id
    run = act(run, { type: 'setTurn', turn: 4 })
    run = act(run, { type: 'move', id: bear, zone: 'battlefield' })
    expect(run.lastEvents[0]).toMatchObject({ type: 'moved', turn: 4 })
    expect(run.events.at(-1).turn).toBe(4)
  })

  it('hands a refusal back without disturbing the table', () => {
    let run = start()
    const before = run.board
    run = act(run, { type: 'draw', count: 99 })
    run = act(run, { type: 'draw' })
    expect(run.refusal).toMatchObject({ code: 'emptyLibrary' })
    expect(run.board).not.toBe(before)
    expect(handOf(run.board, 'you')).toHaveLength(5)
  })

  it('walks back one action at a time, and stops at the beginning', () => {
    let run = start()
    const first = run.board
    run = act(run, { type: 'draw', count: 2 })
    run = act(run, { type: 'life', delta: -5 })
    expect(run.board.life.you).toBe(15)
    run = undo(run)
    expect(run.board.life.you).toBe(20)
    expect(handOf(run.board, 'you')).toHaveLength(2)
    run = undo(run)
    expect(run.board).toEqual(first)
    expect(undo(run).board).toEqual(first)
  })

  it('remembers only the last forty actions, because a game is long', () => {
    let run = start()
    for (let i = 0; i < UNDO_DEPTH + 10; i++) run = act(run, { type: 'life', delta: -1 })
    expect(run.past).toHaveLength(UNDO_DEPTH)
    expect(run.board.life.you).toBe(20 - (UNDO_DEPTH + 10))
  })

  it('applies a list of actions and stops at the first that will not go', () => {
    const { run, applied, refusal } = applyAll(start(), [
      { type: 'draw', count: 2 },
      { type: 'shuffle', zone: 'hand' },
      { type: 'draw' },
    ])
    expect(applied).toBe(1)
    expect(refusal.code).toBe('cannotShuffle')
    expect(handOf(run.board, 'you')).toHaveLength(2)
  })

  it('saves the board and comes back to the same table', () => {
    let run = start()
    const bear = Object.values(run.board.cards).find((c) => c.cardId === 'bear').id
    run = act(run, { type: 'move', id: bear, zone: 'battlefield', x: 0.3, y: 0.7 })
    run = act(run, { type: 'tap', id: bear })
    const saved = JSON.parse(JSON.stringify(snapshot(run, { deckId: 'deck-1' })))
    const back = restore(saved)
    expect(back.board).toEqual(run.board)
    expect(back.restored).toBe(true)
    expect(saved.deckId).toBe('deck-1')
  })

  it('refuses a save it does not understand rather than showing a broken table', () => {
    const run = start()
    expect(restore(null)).toBe(null)
    expect(restore({ version: 99, board: run.board })).toBe(null)
    expect(restore({ version: 1, board: { players: [] } })).toBe(null)
    const broken = JSON.parse(JSON.stringify(run.board))
    broken.zones.you.library = []
    expect(restore({ version: 1, board: broken })).toBe(null)
  })
})

describe('the coach', () => {
  /**
   * A board with the given cards already on the battlefield and in hand, put
   * there the way a player would: drawn, then played from hand, so the coach
   * sees the land drops it counts. `rest` is what stays in the library, since
   * an empty one is a note of its own.
   */
  function table({ field = [], hand = [], turn = 1, rest = 12 } = {}) {
    const deck = [...field, ...hand, ...Array(rest).fill('forest')]
    let run = newRun(seated(deck, { seed: 5 }).board)
    if (turn > 1) run = act(run, { type: 'setTurn', turn })
    const drawn = []
    for (let i = 0; i < field.length + hand.length; i++) {
      const id = run.board.zones.you.library[0]
      drawn.push(id)
      run = act(run, { type: 'move', id, zone: 'hand' })
    }
    for (const id of drawn.slice(0, field.length)) run = act(run, { type: 'move', id, zone: 'battlefield' })
    return run
  }
  const notes = (run) => notesFor(run.board, run.events, lookup)
  const ids = (run) => notes(run).map((n) => n.id)

  it('counts what an untapped board could pay for', () => {
    const run = table({ field: ['forest', 'forest', 'island'] })
    expect(manaAvailable(run.board, 'you', lookup)).toMatchObject({ G: 2, U: 1, sources: 3 })
    const tapped = act(run, { type: 'tap', id: battlefield(run.board, 'you')[0].id })
    expect(manaAvailable(tapped.board, 'you', lookup).sources).toBe(2)
  })

  it('is generous about what looks castable, because a wrong no is worse than a missed yes', () => {
    const three = { G: 2, U: 1, W: 0, B: 0, R: 0, C: 0, sources: 3 }
    expect(looksCastable(CARDS.bear, three)).toBe(true)
    expect(looksCastable(CARDS.big, three)).toBe(false)
    expect(looksCastable(CARDS.bolt, three)).toBe(false)
    expect(looksCastable({ mana_cost: '{X}{G}' }, three)).toBe(true)
    expect(looksCastable({ mana_cost: '{G/U}{G/U}' }, three)).toBe(true)
  })

  it('mentions a second land this turn, and says whose rule it is', () => {
    const one = table({ field: ['forest'] })
    expect(ids(one)).not.toContain('lands')
    const two = table({ field: ['forest', 'forest'] })
    const note = notes(two).find((n) => n.id === 'lands')
    expect(note.severity).toBe('warn')
    expect(note.text).toMatch(/2 lands this turn/)
  })

  it('forgets the land count when the turn moves on', () => {
    const two = table({ field: ['forest', 'forest'] })
    expect(ids(act(two, { type: 'nextTurn' }))).not.toContain('lands')
  })

  it('points out a creature that arrived this turn and is already tapped', () => {
    const run = table({ field: ['bear'] })
    const bear = battlefield(run.board, 'you')[0].id
    const tapped = act(run, { type: 'tap', id: bear })
    expect(notes(tapped).find((n) => n.id === 'sick').text).toMatch(/Grizzly Bears.*haste/)
  })

  it('says nothing about a creature with haste, or one that has been out a turn', () => {
    const hasty = table({ field: ['hasty'] })
    const hastyId = battlefield(hasty.board, 'you')[0].id
    expect(ids(act(hasty, { type: 'tap', id: hastyId }))).not.toContain('sick')

    let settled = table({ field: ['bear'] })
    const bear = battlefield(settled.board, 'you')[0].id
    settled = act(act(settled, { type: 'nextTurn' }), { type: 'tap', id: bear })
    expect(ids(settled)).not.toContain('sick')
  })

  it('treats an arrow off a new creature as an attack it should mention', () => {
    const run = table({ field: ['bear'] })
    const bear = battlefield(run.board, 'you')[0].id
    const attacking = act(run, { type: 'arrow', from: bear, to: 'you' })
    expect(ids(attacking)).toContain('sick')
  })

  it('notices untapped mana and something in hand it would pay for', () => {
    const run = table({ field: ['forest', 'island'], hand: ['bear'] })
    const note = notes(run).find((n) => n.id === 'castable')
    expect(note.text).toMatch(/Grizzly Bears/)
    const spent = act(act(run, { type: 'tap', id: battlefield(run.board, 'you')[0].id }),
      { type: 'tap', id: battlefield(run.board, 'you')[1].id })
    expect(ids(spent)).not.toContain('castable')
  })

  it('does not count a land in hand as something to cast', () => {
    const run = table({ field: ['forest'], hand: ['forest'] })
    expect(ids(run)).not.toContain('castable')
  })

  it('says one sentence about three sick creatures, not three', () => {
    let run = table({ field: ['bear', 'bear', 'hasty'] })
    for (const inst of battlefield(run.board, 'you')) run = act(run, { type: 'tap', id: inst.id })
    const sick = notes(run).filter((n) => n.id === 'sick')
    expect(sick).toHaveLength(1)
    // Two copies of one card are one name, and the hasty one is not in it.
    expect(sick[0].text).toMatch(/^Grizzly Bears arrived this turn/)
    expect(sick[0].text).not.toMatch(/Raging Goblin/)
  })

  it('never says more than three things at once, and cuts the mildest', () => {
    const run = table({ field: ['forest', 'forest', 'bear'], hand: ['bear', 'bolt'], rest: 2 })
    const all = notes(run)
    expect(all.length).toBeLessThanOrEqual(3)
    // Whatever is left, the warnings are at the top of it.
    const firstInfo = all.findIndex((n) => n.severity !== 'warn')
    if (firstInfo >= 0) expect(all.slice(firstInfo).every((n) => n.severity !== 'warn')).toBe(true)
  })

  it('counts a hand over seven, and a library running out', () => {
    const big = table({ hand: ['forest', 'forest', 'island', 'bear', 'bolt', 'big', 'hasty', 'bolt'], rest: 0 })
    expect(notes(big).find((n) => n.id === 'handsize').text).toMatch(/8 cards in hand/)
    expect(notes(big).find((n) => n.id === 'library')).toMatchObject({ severity: 'warn' })
  })

  it('says nothing at all about an empty table', () => {
    const run = newRun(seated(Array(20).fill('forest')).board)
    expect(notesFor(run.board, run.events, lookup)).toEqual([])
  })

  it('reminds a player who has not untapped, but only on their own later turns', () => {
    const run = table({ field: ['forest'] })
    const forest = battlefield(run.board, 'you')[0].id
    expect(ids(act(run, { type: 'tap', id: forest }))).not.toContain('untap')
    const later = act(act(run, { type: 'tap', id: forest }), { type: 'nextTurn' })
    expect(notes(later).find((n) => n.id === 'untap').text).toMatch(/untap/)
  })

  it('says nothing about a card it has never heard of', () => {
    const run = table({ field: ['bear'] })
    const bear = battlefield(run.board, 'you')[0].id
    const tapped = act(run, { type: 'tap', id: bear })
    expect(notesFor(tapped.board, tapped.events, () => null)).toEqual([])
  })
})

describe('one of your own decks', () => {
  const deck = {
    id: 'd1',
    name: 'Bears',
    commanders: ['big'],
    main: [
      { cardId: 'forest', quantity: 10 },
      { cardId: 'bear', quantity: 2 },
      { cardId: 'big', quantity: 1 },     // a commander also listed in the ninety-nine
      { cardId: 'bolt', quantity: 0 },
    ],
  }

  it('expands quantities and keeps the commander out of the library', () => {
    const library = libraryOf(deck)
    expect(library).toHaveLength(12)
    expect(library.filter((id) => id === 'forest')).toHaveLength(10)
    expect(library).not.toContain('big')
    expect(library).not.toContain('bolt')
  })

  it('deals the commander to the command zone, where a game starts it', () => {
    const board = ok(apply(createBoard({ seed: 2 }), dealAction(deck))).board
    expect(board.zones.you.command.map((id) => board.cards[id].cardId)).toEqual(['big'])
    expect(librarySize(board, 'you')).toBe(12)
  })

  it('opens with seven cards, from the same actions a reload would replay', () => {
    const { run, refusal } = applyAll(newRun(createBoard({ seed: 2 })), openingActions(deck, { seed: 2 }))
    expect(refusal).toBe(null)
    expect(handOf(run.board, 'you')).toHaveLength(OPENING_HAND)
    expect(librarySize(run.board, 'you')).toBe(12 - OPENING_HAND)
    expect(invariants(run.board)).toEqual([])
  })

  it('deals nothing but a library for an empty deck, and does not try to draw', () => {
    const actions = openingActions({ main: [], commanders: [] })
    expect(actions).toHaveLength(1)
    const { run } = applyAll(newRun(createBoard()), actions)
    expect(librarySize(run.board, 'you')).toBe(0)
  })

  it('mulligans to seven again, with the old hand shuffled back in', () => {
    let { run } = applyAll(newRun(createBoard({ seed: 2 })), openingActions(deck, { seed: 2 }))
    const first = handOf(run.board, 'you').map((c) => c.cardId)
    const again = applyAll(run, mulliganActions(run.board, { seed: 99 }))
    expect(again.refusal).toBe(null)
    run = again.run
    expect(handOf(run.board, 'you')).toHaveLength(OPENING_HAND)
    expect(librarySize(run.board, 'you')).toBe(12 - OPENING_HAND)
    expect(invariants(run.board)).toEqual([])
    // Whatever the new hand is, every one of the twelve cards is still in the
    // deck: a mulligan that quietly loses a card is the bug worth catching.
    const everywhere = [...handOf(run.board, 'you'), ...zoneOf(run.board, 'you', 'library')].map((c) => c.cardId).sort()
    expect(everywhere).toHaveLength(12)
    expect(first).toHaveLength(OPENING_HAND)
  })

  it('swaps a printing through the deck, merging an entry it collides with', () => {
    const list = {
      main: [{ cardId: 'forest', quantity: 10 }, { cardId: 'forest-nice', quantity: 2 }, { cardId: 'bear', quantity: 1 }],
      sideboard: [{ cardId: 'forest', quantity: 1 }],
      commanders: ['big'],
      artCardId: 'forest',
    }
    const swapped = swapPrinting(list, 'forest', 'forest-nice')
    expect(swapped.main).toEqual([{ cardId: 'forest-nice', quantity: 12 }, { cardId: 'bear', quantity: 1 }])
    expect(swapped.sideboard).toEqual([{ cardId: 'forest-nice', quantity: 1 }])
    expect(swapped.artCardId).toBe('forest-nice')
    expect(swapped.updatedAt).toBeTruthy()
  })

  it('swaps a commander too, and leaves a deck it does not touch alone', () => {
    const list = { main: [{ cardId: 'forest', quantity: 1 }], commanders: ['big'], sideboard: [] }
    expect(swapPrinting(list, 'big', 'big-showcase').commanders).toEqual(['big-showcase'])
    expect(swapPrinting(list, 'elsewhere', 'other')).toBe(list)
    expect(swapPrinting(list, 'forest', 'forest')).toBe(list)
    expect(swapPrinting(null, 'a', 'b')).toBe(null)
  })

  it('leaves the commander in the command zone across a mulligan', () => {
    const { run } = applyAll(newRun(createBoard({ seed: 2 })), openingActions(deck, { seed: 2 }))
    const after = applyAll(run, mulliganActions(run.board, { seed: 5 })).run
    expect(after.board.zones.you.command.map((id) => after.board.cards[id].cardId)).toEqual(['big'])
  })
})

/**
 * The fan is pure arithmetic over one number, so what is worth pinning is the
 * behaviour at the edges: that it stays inside its strip however many cards
 * are held, that it never overlaps a card into invisibility, and that the
 * badge lands somewhere a player can actually see.
 */
describe('the fan of cards in your hand', () => {
  const width = (n) => fan(n).span

  it('lays one card flat and dead centre', () => {
    expect(fan(1)).toEqual({ overlap: 0, span: 1, cards: [{ angle: 0, drop: 0, badge: 0.5 }] })
  })

  it('has nothing to fan for an empty hand', () => {
    expect(fan(0)).toEqual({ overlap: 0, span: 0, cards: [] })
  })

  it('leaves two cards side by side rather than stacking them', () => {
    expect(fan(2).overlap).toBe(0)
  })

  it('keeps a hand of any size inside the same strip', () => {
    // The whole point: seven cards and sixty cards cost the same width, so a
    // full grip never pushes the table off the screen.
    for (const n of [7, 20, 60]) expect(width(n)).toBeLessThanOrEqual(3.6)
  })

  it('reports a span the overlap actually adds up to', () => {
    // The stylesheet sizes the cards from `span` and lays them out from
    // `overlap`. If the two disagree the hand is either short of the edge or
    // over it, so they are rounded to agree to within a rounding.
    for (const n of [2, 5, 7, 13, 40]) {
      const { overlap, span, cards } = fan(n)
      expect(1 + (cards.length - 1) * (1 - overlap)).toBeCloseTo(span, 1)
    }
  })

  it('has no span at all for an empty hand', () => {
    expect(fan(0).span).toBe(0)
    expect(fan(1).span).toBe(1)
  })

  it('opens wider as cards are added, until the strip is full', () => {
    // Up to four cards they lie side by side and the hand simply gets wider.
    expect(width(2)).toBe(2)
    expect(width(3)).toBe(3)
    // After that the strip is full, so the cards overlap instead.
    expect(width(5)).toBeCloseTo(width(12), 1)
  })

  it('is symmetrical about the middle', () => {
    const { cards } = fan(7)
    expect(cards[0].angle).toBe(-cards[6].angle)
    expect(cards[1].angle).toBe(-cards[5].angle)
    expect(cards[3].angle).toBe(0)
  })

  it('turns the outermost cards furthest and drops them lowest', () => {
    const { cards } = fan(7)
    expect(Math.abs(cards[0].angle)).toBeGreaterThan(Math.abs(cards[2].angle))
    expect(cards[0].drop).toBeGreaterThan(cards[3].drop)
    expect(cards[3].drop).toBe(0)
  })

  it('never opens a small hand as wide as a large one', () => {
    const wide = Math.abs(fan(3).cards[0].angle)
    const many = Math.abs(fan(12).cards[0].angle)
    expect(wide).toBeLessThan(many)
  })

  it('caps the whole arc however many cards are held', () => {
    for (const n of [7, 12, 30]) {
      const { cards } = fan(n)
      expect(Math.abs(cards[0].angle) + Math.abs(cards[n - 1].angle)).toBeLessThanOrEqual(26)
    }
  })

  it('puts every badge over the part of its card that is still visible', () => {
    const { overlap, cards } = fan(9)
    const showing = 1 - overlap
    // Every card but the last is covered from `showing` rightwards, so a
    // badge at or past that line is a badge nobody can read.
    for (const card of cards.slice(0, -1)) expect(card.badge).toBeLessThan(showing)
    expect(cards.at(-1).badge).toBe(0.5)
  })

  it('survives being asked about a hand that is not a number', () => {
    expect(fan(NaN).cards).toEqual([])
    expect(fan(-3).cards).toEqual([])
    expect(fan(2.7).cards).toHaveLength(2)
  })
})

describe('a card put down without a point', () => {
  it('takes the next free place along its row rather than the middle', async () => {
    const { freeAlong, CARD_W } = await import('../src/lib/board/geometry.js')
    const taken = []
    const spots = []
    for (let i = 0; i < 4; i++) {
      const spot = freeAlong(0.35, taken)
      spots.push(spot)
      taken.push(spot)
    }
    expect(spots[0]).toEqual({ x: 0.5, y: 0.35 })
    expect(spots[1].x).toBeGreaterThan(0.5)
    expect(spots[2].x).toBeLessThan(0.5)
    expect(spots[3].x).toBeGreaterThan(spots[1].x)
    // Every one sits on the row, and none share a place.
    expect(spots.every((s) => s.y === 0.35)).toBe(true)
    expect(new Set(spots.map((s) => s.x)).size).toBe(4)
    expect(Math.abs(spots[1].x - spots[0].x)).toBeGreaterThanOrEqual(CARD_W)
  })

  it('gives up gracefully when the row is full', async () => {
    const { freeAlong } = await import('../src/lib/board/geometry.js')
    const taken = Array.from({ length: 40 }, (_, i) => ({ x: i / 40, y: 0.35 }))
    expect(freeAlong(0.35, taken)).toEqual({ x: 0.5, y: 0.35 })
  })
})

describe('tokens made without a point', () => {
  it('take their own places along the row rather than one pile', async () => {
    const { createBoard } = await import('../src/lib/board/model.js')
    const { apply } = await import('../src/lib/board/reducer.js')
    let board = createBoard({ seed: 1 })
    for (let i = 0; i < 3; i++) {
      const r = apply(board, { type: 'makeToken', custom: { name: 'Treasure', typeLine: 'Token Artifact' }, lane: 'other' })
      expect(r.ok).toBe(true)
      board = r.board
    }
    const spots = board.zones.you.battlefield.map((id) => board.cards[id]).map((c) => `${c.x},${c.y}`)
    expect(new Set(spots).size).toBe(3)
    expect(new Set(board.zones.you.battlefield.map((id) => board.cards[id].y)).size).toBe(1)
  })
})
