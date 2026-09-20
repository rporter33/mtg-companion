import { describe, it, expect } from 'vitest'
import { readLog, readLogNamed } from '../src/lib/board/log.js'
import { newRun, act } from '../src/lib/board/runner.js'
import { createBoard } from '../src/lib/board/model.js'

/**
 * The log is the only part of the table that has to be read rather than
 * looked at, so what is tested here is whether it reads: that a turn nobody
 * did anything in collapses to one line, that the newest turn is first, and
 * that a card's name reaches the sentence it belongs in.
 */

const board = {
  cards: {
    'you:0:forest': { id: 'you:0:forest', cardId: 'forest', owner: 'you' },
    'you:1:bear': { id: 'you:1:bear', cardId: 'bear', owner: 'you' },
    'them:0:isle': { id: 'them:0:isle', cardId: 'island', owner: 'them' },
  },
}

const NAMES = { forest: 'Forest', bear: 'Grizzly Bears', island: 'Island' }
const nameFor = (id) => NAMES[id] ?? null

describe('reading the log', () => {
  it('groups by turn, newest first', () => {
    const turns = readLog([
      { type: 'turnBegan', turn: 1, active: 'you', seq: 1 },
      { type: 'drew', player: 'you', instanceId: 'you:0:forest', turn: 1, seq: 2 },
      { type: 'turnBegan', turn: 2, active: 'you', seq: 3 },
      { type: 'life', player: 'you', value: 39, turn: 2, seq: 4 },
    ], board)
    expect(turns.map((t) => t.turn)).toEqual([2, 1])
    expect(turns[0].items[0].text).toBe('went to 39 life')
  })

  it('keeps the order within a turn, because a turn read backwards is nonsense', () => {
    const turns = readLog([
      { type: 'drew', player: 'you', instanceId: 'you:0:forest', turn: 1, seq: 1 },
      { type: 'moved', instanceId: 'you:0:forest', from: 'hand', to: 'battlefield', turn: 1, seq: 2 },
      { type: 'tapped', instanceId: 'you:0:forest', turn: 1, seq: 3 },
    ], board)
    expect(turns[0].items.map((i) => i.text)).toEqual([
      'drew a card', 'put a card onto the battlefield', 'tapped a card',
    ])
  })

  it('collapses the steps nothing happened in into one line', () => {
    const turns = readLog([
      { type: 'stepped', from: 'untap', to: 'upkeep', turn: 1, seq: 1 },
      { type: 'stepped', from: 'upkeep', to: 'draw', turn: 1, seq: 2 },
      { type: 'stepped', from: 'draw', to: 'main1', turn: 1, seq: 3 },
    ], board)
    expect(turns[0].items).toEqual([{ kind: 'passed', steps: ['upkeep', 'draw', 'main1'] }])
  })

  it('but breaks the run when something happens in the middle', () => {
    const turns = readLog([
      { type: 'stepped', from: 'untap', to: 'upkeep', turn: 1, seq: 1 },
      { type: 'drew', player: 'you', instanceId: 'you:0:forest', turn: 1, seq: 2 },
      { type: 'stepped', from: 'upkeep', to: 'draw', turn: 1, seq: 3 },
    ], board)
    expect(turns[0].items.map((i) => i.kind)).toEqual(['step', 'entry', 'passed'])
    expect(turns[0].items[0]).toEqual({ kind: 'step', step: 'upkeep', passed: [] })
  })

  it('says where a card went in the words a player would use', () => {
    const said = (from, to) => readLog([{ type: 'moved', instanceId: 'you:1:bear', from, to, turn: 1, seq: 1 }], board)[0].items[0].text
    expect(said('hand', 'battlefield')).toBe('put a card onto the battlefield')
    expect(said('stack', 'battlefield')).toBe('resolved a card onto the battlefield')
    expect(said('stack', 'graveyard')).toBe('resolved a card into the graveyard')
    expect(said('battlefield', 'graveyard')).toBe('put a card into the graveyard')
    expect(said('battlefield', 'exile')).toBe('exiled a card')
    expect(said('graveyard', 'hand')).toBe('returned a card to hand')
  })

  it('never says cast, because this table has no such thing', () => {
    const all = readLog([
      { type: 'moved', instanceId: 'you:1:bear', from: 'hand', to: 'stack', turn: 1, seq: 1 },
      { type: 'moved', instanceId: 'you:1:bear', from: 'stack', to: 'battlefield', turn: 1, seq: 2 },
    ], board)[0].items.map((i) => i.text).join(' ')
    expect(all).not.toMatch(/cast/i)
  })

  it('leaves out the bookkeeping nobody would recount', () => {
    const turns = readLog([
      { type: 'slid', instanceId: 'you:1:bear', x: 0.2, y: 0.3, turn: 1, seq: 1 },
      { type: 'arrowDrawn', from: 'a', to: 'b', turn: 1, seq: 2 },
      { type: 'noted', turn: 1, seq: 3 },
    ], board)
    expect(turns).toEqual([])
  })

  it('names the seat you are in "You" and leaves the others as they are', () => {
    const turns = readLog([
      { type: 'drew', player: 'you', instanceId: 'you:0:forest', turn: 1, seq: 1 },
      { type: 'drew', player: 'them', instanceId: 'them:0:isle', turn: 1, seq: 2 },
    ], board)
    expect(turns[0].items.map((i) => i.who)).toEqual(['You', 'them'])
  })

  it('carries the card it is about, so a thumbnail can be shown beside it', () => {
    const turns = readLog([{ type: 'drew', player: 'you', instanceId: 'you:1:bear', turn: 1, seq: 1 }], board)
    expect(turns[0].items[0].cardId).toBe('bear')
  })

  it('fills in the name once the cards have arrived', () => {
    const turns = readLogNamed([
      { type: 'drew', player: 'you', instanceId: 'you:1:bear', turn: 1, seq: 1 },
    ], board, nameFor)
    expect(turns[0].items[0].text).toBe('drew Grizzly Bears')
  })

  it('does not mistake a counter name for a card name', () => {
    const turns = readLogNamed([
      { type: 'countered', instanceId: 'you:1:bear', name: '+1/+1', value: 2, turn: 1, seq: 1 },
    ], board, nameFor)
    expect(turns[0].items[0].text).toBe('Grizzly Bears now has 2 +1/+1')
  })

  it('reads a real run rather than a fixture', () => {
    let run = newRun(createBoard({ players: ['you'], seed: 4 }))
    run = act(run, { type: 'seat', player: 'you', cards: ['forest', 'bear'], lanes: { forest: 'lands', bear: 'creatures' }, shuffle: false })
    run = act(run, { type: 'draw', player: 'you', count: 1 })
    run = act(run, { type: 'step' })
    const turns = readLog(run.events, run.board)
    expect(turns.length).toBeGreaterThan(0)
    expect(turns[0].items.some((i) => i.kind === 'entry')).toBe(true)
  })

  it('survives an empty game and a board it was given nothing about', () => {
    expect(readLog([], null)).toEqual([])
    expect(readLog(undefined, undefined)).toEqual([])
    expect(readLog([{ type: 'drew', player: 'you', instanceId: 'gone', turn: 1, seq: 1 }], null)[0].items[0].cardId).toBe(null)
  })
})

describe('who is speaking, at a shared table', () => {
  it('calls the other seats by name when told their names, and by seat otherwise', async () => {
    const { readLog } = await import('../src/lib/board/log.js')
    const events = [
      { type: 'life', player: 'p2', value: 18, delta: -2, seq: 1, turn: 1 },
      { type: 'life', player: 'p1', value: 19, delta: -1, seq: 2, turn: 1 },
    ]
    const board = { cards: {}, players: ['p1', 'p2'], active: 'p1', turn: 1 }
    const named = readLog(events, board, { you: 'p1', who: (p) => ({ p2: 'Bob' })[p] })
    const whos = named.flatMap((t) => t.items).filter((i) => i.kind === 'entry').map((i) => i.who)
    expect(whos).toEqual(['Bob', 'You'])
    const unnamed = readLog(events, board, { you: 'p1' })
    expect(unnamed.flatMap((t) => t.items).filter((i) => i.kind === 'entry').map((i) => i.who)).toEqual(['p2', 'You'])
  })
})

describe('the step dividers, and what is hidden', () => {
  const ev = (type, over = {}) => ({ type, turn: 1, seq: 1, ...over })
  it('puts a divider on the step something happened in, listing the steps passed through beneath it', async () => {
    const { readLog } = await import('../src/lib/board/log.js')
    const events = [
      ev('stepped', { from: 'untap', to: 'upkeep' }),
      ev('stepped', { from: 'upkeep', to: 'draw' }),
      ev('stepped', { from: 'draw', to: 'main1' }),
      ev('life', { player: 'you', value: 19, seq: 2 }),
      ev('stepped', { from: 'main1', to: 'beginCombat' }),
      ev('stepped', { from: 'beginCombat', to: 'attackers' }),
      ev('life', { player: 'you', value: 18, seq: 3 }),
    ]
    const items = readLog(events, null)[0].items
    expect(items.map((i) => i.kind)).toEqual(['step', 'entry', 'step', 'entry'])
    expect(items[0]).toEqual({ kind: 'step', step: 'main1', passed: ['upkeep', 'draw'] })
    expect(items[2]).toEqual({ kind: 'step', step: 'attackers', passed: ['beginCombat'] })
  })
  it('greys what another seat did in private, and names what they did in the open', async () => {
    const { readLog, readLogNamed } = await import('../src/lib/board/log.js')
    const board = { cards: { c1: { id: 'c1', cardId: 'bear', owner: 'p2' }, c2: { id: 'c2', cardId: 'bolt', owner: 'p2' } }, revealed: [] }
    const events = [
      ev('drew', { player: 'p2', instanceId: 'c1', seq: 1 }),
      ev('moved', { player: 'p2', instanceId: 'c2', from: 'hand', to: 'library', seq: 2 }),
      ev('moved', { player: 'p2', instanceId: 'c2', from: 'library', to: 'battlefield', seq: 3 }),
      ev('drew', { player: 'p1', instanceId: 'c1', seq: 4 }),
    ]
    const names = { bear: 'Grizzly Bears', bolt: 'Lightning Bolt' }
    const items = readLogNamed(events, board, (id) => names[id], { you: 'p1' })[0].items.filter((i) => i.kind === 'entry')
    expect(items.map((i) => i.hidden)).toEqual([true, true, false, false])
    expect(items[0].text).toBe('drew a card')
    expect(items[2].text).toBe('put Lightning Bolt onto the battlefield')
    expect(items[3].text).toBe('drew Grizzly Bears')
  })
  it('does not hide a card its owner revealed', async () => {
    const { readLog } = await import('../src/lib/board/log.js')
    const board = { cards: { c1: { id: 'c1', cardId: 'bear', owner: 'p2' } }, revealed: ['c1'] }
    const items = readLog([ev('drew', { player: 'p2', instanceId: 'c1' })], board, { you: 'p1' })[0].items
    expect(items.find((i) => i.kind === 'entry').hidden).toBe(false)
  })
})
