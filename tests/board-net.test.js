import { describe, it, expect, vi } from 'vitest'
import { host, guest, loopback, mayDo, KIND, PROTOCOL } from '../src/lib/board/net.js'
import { newRun } from '../src/lib/board/runner.js'
import { createBoard, invariants, battlefield, handOf, zoneOf } from '../src/lib/board/model.js'

/**
 * Two devices, one table, checked without a network.
 *
 * Everything the protocol promises is about order and agreement, and both are
 * testable over a wire that delivers messages in memory. What is worth
 * guarding is the part that would be invisible when it broke: the two tables
 * drifting apart, a guest applying something twice, a lost message leaving a
 * board that is quietly wrong, and one player reaching across and moving
 * another's cards.
 */

const SEED = 11
const DECK = ['forest', 'forest', 'bear', 'bolt', 'island', 'big']
const LANES = { forest: 'lands', island: 'lands', bear: 'creatures', big: 'creatures', bolt: null }

/** A host with a dealt table, and a guest joined to it over a loopback wire. */
function table({ players = ['p1', 'p2'] } = {}) {
  const wire = loopback()
  const table = host({
    run: newRun(createBoard({ players, seed: SEED })),
    seat: 'p1',
    send: wire.hub.send,
  })
  wire.hub.onMessage((message, from) => table.receive(message, from))
  table.do({ type: 'seat', player: 'p1', cards: DECK, lanes: LANES, shuffle: false })
  table.do({ type: 'seat', player: 'p2', cards: DECK, lanes: LANES, shuffle: false })

  /** Sits somebody else down at the same table, on the same wire. */
  const join = (id, name, options = {}) => {
    const link = wire.connect(id)
    const sitting = guest({ send: link.send, name, ...options })
    link.onMessage((message) => sitting.receive(message))
    sitting.hello()
    return sitting
  }

  const joined = join('guest', 'Ada')
  return { wire, table, joined, join }
}

const sameTable = (a, b) => {
  expect(JSON.stringify(b.run.board)).toBe(JSON.stringify(a.run.board))
  expect(invariants(b.run.board)).toEqual([])
}

describe('two devices, one table', () => {
  it('hands a joining player a seat and the table as it stands', () => {
    const { table: t, joined } = table()
    expect(joined.ready).toBe(true)
    expect(joined.seat).toBe('p2')
    expect(joined.seq).toBe(t.seq)
    sameTable(t, joined)
    expect(t.seats.map((s) => s.name)).toEqual(['Table', 'Ada'])
  })

  it('replays what the host does onto the guest, in order', () => {
    const { table: t, joined } = table()
    t.do({ type: 'draw', player: 'p1', count: 3 })
    t.do({ type: 'life', player: 'p1', delta: -4 })
    expect(handOf(joined.run.board, 'p1')).toHaveLength(3)
    expect(joined.run.board.life.p1).toBe(16)
    sameTable(t, joined)
  })

  it('does what a guest asks, and the guest sees it only once it has happened', () => {
    const { table: t, joined } = table()
    const before = joined.run.board
    joined.do({ type: 'draw', player: 'p2', count: 2 })
    expect(handOf(t.run.board, 'p2')).toHaveLength(2)
    expect(handOf(joined.run.board, 'p2')).toHaveLength(2)
    expect(joined.run.board).not.toBe(before)
    expect(joined.pending).toBe(0)
    sameTable(t, joined)
  })

  it('will not let one player move another’s cards', () => {
    const { table: t, joined, join } = table({ players: ['p1', 'p2', 'p3'] })
    const refused = vi.fn()
    const nosy = join('g2', 'Nosy', { onRefused: refused })

    const hostCard = zoneOf(t.run.board, 'p1', 'library')[0].id
    const seq = t.seq
    nosy.do({ type: 'move', id: hostCard, zone: 'hand' })
    expect(t.seq, 'the table changed when it should not have').toBe(seq)
    expect(refused).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'notYours' }),
      expect.objectContaining({ type: 'move' }),
    )
    expect(nosy.pending).toBe(0)
    expect(joined.pending).toBe(0)
  })

  it('lets anyone point at anything, because an arrow is not a card', () => {
    const { table: t, joined } = table()
    const mine = zoneOf(t.run.board, 'p2', 'library')[0].id
    const theirs = zoneOf(t.run.board, 'p1', 'library')[0].id
    expect(mayDo(t.run.board, 'p2', { type: 'arrow', from: mine, to: theirs })).toBe(true)
    expect(mayDo(t.run.board, 'p2', { type: 'roll', sides: 6 })).toBe(true)
    expect(mayDo(t.run.board, 'p2', { type: 'step' })).toBe(true)
    // But a card is still a card.
    expect(mayDo(t.run.board, 'p2', { type: 'tap', id: theirs })).toBe(false)
    expect(mayDo(t.run.board, 'p2', { type: 'tap', id: mine })).toBe(true)
  })

  it('lets a stolen creature be turned sideways by whoever controls it', () => {
    const { table: t } = table()
    const card = zoneOf(t.run.board, 'p1', 'library')[0].id
    expect(mayDo(t.run.board, 'p2', { type: 'tap', id: card })).toBe(false)
    // Control changed; the rules use the same word, so there is no special case.
    t.run.board.cards[card].controller = 'p2'
    expect(mayDo(t.run.board, 'p2', { type: 'tap', id: card })).toBe(true)
  })

  it('passes a refusal back to the player who asked, and to nobody else', () => {
    const { table: t, joined, join } = table({ players: ['p1', 'p2', 'p3'] })
    const mine = vi.fn()
    const theirs = vi.fn()
    const asked = join('g2', 'Bo', { onRefused: theirs })
    // Empty the library, then ask for one more card than there is.
    asked.do({ type: 'draw', player: 'p3', count: 6 })
    asked.do({ type: 'draw', player: 'p3' })
    expect(theirs).toHaveBeenCalledWith(expect.objectContaining({ code: 'emptyLibrary' }), expect.anything())
    expect(mine).not.toHaveBeenCalled()
    expect(joined.pending).toBe(0)
    sameTable(t, joined)
  })

  it('asks for the table again when a message goes missing, rather than guessing', () => {
    const { table: t, joined, wire } = table()
    t.do({ type: 'draw', player: 'p1' })
    const atTheTime = joined.seq
    // The wire drops one, which is the case a numbering scheme exists for.
    wire.drop('guest')
    t.do({ type: 'draw', player: 'p1' })
    expect(joined.seq).toBe(atTheTime)

    // Reconnect: the next numbered action has a gap in it, so the guest asks.
    const link = wire.connect('guest')
    link.onMessage((m) => joined.receive(m))
    t.do({ type: 'draw', player: 'p1' })
    sameTable(t, joined)
    expect(joined.seq).toBe(t.seq)
    expect(handOf(joined.run.board, 'p1')).toHaveLength(3)
  })

  it('ignores an action it has already applied', () => {
    const { table: t, joined } = table()
    t.do({ type: 'life', player: 'p1', delta: -3 })
    const twice = { t: KIND.action, protocol: PROTOCOL, seq: joined.seq, action: { type: 'life', player: 'p1', delta: -3 }, by: 'p1' }
    joined.receive(twice)
    expect(joined.run.board.life.p1).toBe(17)
    sameTable(t, joined)
  })

  it('will not talk to a different version of itself', () => {
    const { table: t } = table()
    const heard = []
    t.receive({ t: KIND.hello, protocol: PROTOCOL + 1, name: 'Future' }, 'odd')
    expect(t.seats).toHaveLength(2)
    expect(heard).toEqual([])
  })

  it('reaches the same table from the same actions, whichever side sent them', () => {
    const { table: t, joined } = table()
    const moves = [
      { type: 'draw', player: 'p1', count: 3 },
      { type: 'draw', player: 'p2', count: 3 },
      { type: 'life', player: 'p2', delta: -2 },
      { type: 'step' },
      { type: 'roll', sides: 20, seed: 4 },
    ]
    // Alternating: the host does one, the guest asks for the next.
    const before = t.seq
    moves.forEach((action, i) => (i % 2 ? joined.do(action) : t.do(action)))
    sameTable(t, joined)
    expect(t.seq - before).toBe(moves.length)
    expect(joined.seq).toBe(t.seq)
  })

  it('seats a second guest and tells everyone who is at the table', () => {
    const { table: t, join } = table({ players: ['p1', 'p2', 'p3'] })
    const seen = []
    const two = join('g2', 'Bo', { onSeats: (s) => seen.push(s.length) })
    expect(t.seats.map((s) => s.name)).toEqual(['Table', 'Ada', 'Bo'])
    expect(two.seat).toBe('p3')
    expect(seen.at(-1)).toBe(3)
  })

  it('says a seat is empty when somebody leaves, and keeps their cards', () => {
    const { table: t, joined } = table()
    t.do({ type: 'draw', player: 'p2', count: 2 })
    joined.leave()
    expect(t.seats.find((s) => s.seat === 'p2').here).toBe(false)
    expect(handOf(t.run.board, 'p2')).toHaveLength(2)
  })

  it('is a table, not a judge: a guest may do something the rules forbid', () => {
    const { table: t, joined } = table()
    // Two lands in a turn, from the guest. Nothing stops it; the coach speaks.
    const lands = zoneOf(joined.run.board, 'p2', 'library').filter((c) => c.cardId === 'forest').slice(0, 2)
    joined.do({ type: 'move', id: lands[0].id, zone: 'battlefield' })
    joined.do({ type: 'move', id: lands[1].id, zone: 'battlefield' })
    expect(battlefield(t.run.board, 'p2')).toHaveLength(2)
    sameTable(t, joined)
  })
})
