import { describe, it, expect } from 'vitest'
import { createBoard, invariants, battlefield, handOf, librarySize, nameOf, stacked, ZONES } from '../src/lib/board/model.js'
import { apply } from '../src/lib/board/reducer.js'
import { act, undo, newRun, applyAll, snapshot, restore, UNDO_DEPTH } from '../src/lib/board/runner.js'
import { clampToField, overlaps, cardAt, freeSpot, tidy, pointToField, CARD_W, CARD_H } from '../src/lib/board/geometry.js'
import { notesFor, manaAvailable, looksCastable } from '../src/lib/board/coach.js'

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

/** A board with a seated player, returning the board and a finder for its cards. */
function seated(cards = ['forest', 'forest', 'bear', 'bolt', 'island'], options = {}) {
  const board = createBoard({ seed: 7, ...options })
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
    const set = ok(apply(board, { type: 'setTurn', turn: 3, active: 'them', step: 'combat' })).board
    expect(set).toMatchObject({ turn: 3, active: 'them', step: 'combat' })
    const back = ok(apply(set, { type: 'nextTurn' })).board
    expect(back).toMatchObject({ turn: 4, active: 'you', step: null })
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
    expect(notes(tapped).find((n) => n.id === `sick:${bear}`).text).toMatch(/haste/)
  })

  it('says nothing about a creature with haste, or one that has been out a turn', () => {
    const hasty = table({ field: ['hasty'] })
    const hastyId = battlefield(hasty.board, 'you')[0].id
    expect(ids(act(hasty, { type: 'tap', id: hastyId }))).not.toContain(`sick:${hastyId}`)

    let settled = table({ field: ['bear'] })
    const bear = battlefield(settled.board, 'you')[0].id
    settled = act(act(settled, { type: 'nextTurn' }), { type: 'tap', id: bear })
    expect(ids(settled)).not.toContain(`sick:${bear}`)
  })

  it('treats an arrow off a new creature as an attack it should mention', () => {
    const run = table({ field: ['bear'] })
    const bear = battlefield(run.board, 'you')[0].id
    const attacking = act(run, { type: 'arrow', from: bear, to: 'you' })
    expect(ids(attacking)).toContain(`sick:${bear}`)
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
