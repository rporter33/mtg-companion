// @vitest-environment node
/**
 * The engine's state on the table: views captured from a real game
 * (tests/fixtures/engine-views.json, by the capture in docs/table-rebuild/
 * PLAN.md Phase 3) laid onto the board model the table draws.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { boardFromView, eventsBetween, standIn, scryfallIdOf, stepIdOf } from '../src/lib/engine/board.js'
import { invariants, zoneOf, handOf, librarySize } from '../src/lib/board/model.js'
import { laneById } from '../src/lib/board/placement.js'
import { readLog } from '../src/lib/board/log.js'

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/engine-views.json', import.meta.url), 'utf8'))
const [early, later] = FIXTURE.shots.map((s) => s.view)
const YOU = 'e0'
const BOT = 'e1'

describe('a card from the engine', () => {
  it('is its Scryfall printing, read off the image link', () => {
    const goblin = Object.values(later.cards).find((c) => c.name === 'Raging Goblin')
    expect(scryfallIdOf(goblin)).toBe('fed57a17-7847-4e60-bc40-4452880f12a3')
    const stand = standIn(goblin)
    expect(stand.id).toBe('fed57a17-7847-4e60-bc40-4452880f12a3')
    expect(stand.type_line).toBe('Creature — Goblin Berserker')
    expect(stand.power).toBe('1')
    expect(stand.colors).toEqual(['R'])
    expect(stand.image_uris.normal).toMatch(/^https:\/\/cards\.scryfall\.io\//)
    expect(stand.standIn).toBe(true)
  })

  it('falls back to the engine id when there is no image', () => {
    expect(standIn({ id: 'e9', name: 'Thing', typeLine: 'Artifact' }).id).toBe('engine:e9')
    expect(scryfallIdOf({ imageUri: 'https://example.com/x.jpg' })).toBeNull()
  })
})

describe('the board from a view', () => {
  const board = boardFromView(later, { seats: FIXTURE.seats })

  it('passes the board model\'s own invariants', () => {
    expect(invariants(board)).toEqual([])
  })

  it('seats the players in room order with their life', () => {
    expect(board.players).toEqual([YOU, BOT])
    expect(board.life).toEqual({ [YOU]: 13, [BOT]: 14 })
    expect(board.turn).toBe(7)
    expect(board.active).toBe(YOU)
    expect(board.step).toBe('attackers')
  })

  it('puts every visible card in its zone, tapped as the engine says', () => {
    const mine = zoneOf(board, YOU, 'battlefield')
    expect(mine).toHaveLength(7)
    expect(mine.filter((c) => c.tapped)).toHaveLength(2)
    expect(zoneOf(board, BOT, 'battlefield')).toHaveLength(6)
    expect(zoneOf(board, BOT, 'graveyard')).toHaveLength(1)
    expect(handOf(board, YOU)).toHaveLength(2)
  })

  it('draws what the seat may not see as backs, with the right counts', () => {
    const theirs = handOf(board, BOT)
    expect(theirs).toHaveLength(3)
    expect(theirs.every((c) => c.faceDown && c.cardId === null)).toBe(true)
    expect(librarySize(board, YOU)).toBe(24)
    expect(librarySize(board, BOT)).toBe(24)
    expect(handOf(board, YOU).every((c) => !c.faceDown && c.cardId)).toBe(true)
  })

  it('lays permanents in their lanes without stacking them', () => {
    const lands = zoneOf(board, YOU, 'battlefield').filter((c) => c.lane === 'lands')
    const creatures = zoneOf(board, YOU, 'battlefield').filter((c) => c.lane === 'creatures')
    expect(lands).toHaveLength(4)
    expect(creatures).toHaveLength(3)
    for (const c of lands) expect(c.y).toBeCloseTo(laneById('lands').y, 5)
    const xs = lands.map((c) => c.x.toFixed(3))
    expect(new Set(xs).size).toBe(4)
  })

  it('marks summoning sickness and this turn\'s arrivals', () => {
    const hulk = Object.values(board.cards).find((c) => c.zone === 'battlefield' && c.sick)
    expect(hulk).toBeDefined()
    expect(hulk.enteredOnTurn).toBe(7)
  })
})

describe('the board across views', () => {
  it('keeps a card where it was, and seats a new arrival beside the rest', () => {
    const first = boardFromView(early, { seats: FIXTURE.seats })
    const mountain = zoneOf(first, YOU, 'battlefield').find((c) => c.lane === 'lands')
    mountain.x = 0.23; mountain.y = 0.81 // the player dragged it
    const next = boardFromView(later, { prev: first, seats: FIXTURE.seats })
    expect(next.cards[mountain.id].x).toBe(0.23)
    expect(next.cards[mountain.id].y).toBe(0.81)
    expect(next.cards[mountain.id].enteredOnTurn).toBe(1)
    const newer = zoneOf(next, YOU, 'battlefield').filter((c) => c.id !== mountain.id && c.lane === 'lands')
    expect(newer.every((c) => c.enteredOnTurn === 7)).toBe(true)
    expect(newer.every((c) => Math.abs(c.x - 0.23) > 0.05)).toBe(true)
  })

  it('counts up the sequence', () => {
    const first = boardFromView(early)
    expect(boardFromView(later, { prev: first }).seq).toBe(first.seq + 1)
  })
})

describe('events between views', () => {
  it('opens the turn and the step the first time', () => {
    const events = eventsBetween(null, early)
    expect(events.map((e) => e.type)).toEqual(['turnBegan', 'stepped'])
    expect(events[0]).toMatchObject({ turn: 1, active: YOU })
    expect(events[1]).toMatchObject({ to: 'attackers' })
  })

  it('says what the engine said, once, phrased for the viewer, under the turn it happened in', () => {
    const before = { ...early, log: [{ type: 'lifeChanged', description: 'You lost 3 life', playerId: YOU }] }
    const after = {
      ...later,
      log: [
        ...before.log,
        { type: 'turnChanged', turnNumber: 7, activePlayerId: later.activePlayerId, description: '--- Turn 7 ---' },
        { type: 'lifeChanged', description: 'Opponent lost 2 life', playerId: BOT },
      ],
    }
    const events = eventsBetween(before, after, { seq: 5 })
    const noted = events.filter((e) => e.type === 'said')
    expect(noted).toHaveLength(1)
    expect(noted[0]).toMatchObject({ text: 'Opponent lost 2 life', turn: 7, seq: 7 })
    expect(events.map((e) => e.type)).toEqual(['turnBegan', 'said', 'stepped'])
  })

  it('files a turn the engine played between two views under that turn, its mark a header and not a line', () => {
    // As seen in M1's run in a browser: a land played, then the engine's
    // whole turn, then yours, all arriving with one view.
    const before = { ...early, turnNumber: 1, activePlayerId: YOU, log: [] }
    const after = {
      ...early,
      turnNumber: 3,
      activePlayerId: YOU,
      log: [
        { type: 'permanentEntered', description: 'Your Mountain entered the battlefield', controllerId: YOU },
        { type: 'turnChanged', turnNumber: 2, activePlayerId: BOT, isYourTurn: false, description: "--- Turn 2 (Opponent's turn) ---" },
        { type: 'cardDrawn', description: 'Opponent drew a card', playerId: BOT },
        { type: 'turnChanged', turnNumber: 3, activePlayerId: YOU, isYourTurn: true, description: '--- Turn 3 (Your turn) ---' },
      ],
    }
    const events = eventsBetween(before, after)
    expect(events.map((e) => [e.type, e.turn])).toEqual([['said', 1], ['turnBegan', 2], ['said', 2], ['turnBegan', 3], ['stepped', 3]])
    expect(events.filter((e) => e.type === 'turnBegan').map((e) => e.active)).toEqual([BOT, YOU])
    expect(events.some((e) => /---/.test(e.text ?? ''))).toBe(false)

    const turns = readLog(events, boardFromView(after), { you: YOU })
    expect(turns.map((t) => t.turn)).toEqual([3, 2, 1])
    const theirs = turns.find((t) => t.turn === 2)
    expect(theirs.active).toBe(BOT)
    expect(theirs.items.filter((i) => i.kind === 'entry').map((i) => i.text)).toEqual(['Opponent drew a card'])
  })

  it('files each line under the step it says it happened in, not where the view stopped', () => {
    // Their upkeep, where you had priority; the next view stops in their
    // main phase, and the draw between the two was in their draw step.
    const before = { ...early, turnNumber: 2, activePlayerId: BOT, currentStep: 'UPKEEP', log: [] }
    const after = {
      ...before,
      currentStep: 'PRECOMBAT_MAIN',
      log: [
        { type: 'cardDrawn', description: 'Opponent drew a card', playerId: BOT, step: 'DRAW' },
        { type: 'permanentEntered', description: "Opponent's Mountain entered the battlefield", controllerId: BOT, step: 'PRECOMBAT_MAIN' },
      ],
    }
    const events = eventsBetween(before, after)
    expect(events.map((e) => e.type === 'stepped' ? e.to : e.type)).toEqual([stepIdOf('DRAW'), 'said', stepIdOf('PRECOMBAT_MAIN'), 'said'])

    const turns = readLog(events, boardFromView(after), { you: YOU })
    const items = turns.find((t) => t.turn === 2).items.filter((i) => i.kind !== 'passed')
    expect(items.map((i) => i.kind === 'step' ? i.step : i.text)).toEqual([
      stepIdOf('DRAW'), 'Opponent drew a card', stepIdOf('PRECOMBAT_MAIN'), "Opponent's Mountain entered the battlefield",
    ])
  })

  it('files the deal under the first turn, before the step the first view stands at', () => {
    const events = eventsBetween(null, { ...early, log: [{ type: 'cardDrawn', description: 'You drew 7 cards', playerId: YOU }] })
    expect(events.map((e) => e.type)).toEqual(['turnBegan', 'said', 'stepped'])
    expect(events[1]).toMatchObject({ turn: early.turnNumber ?? 1 })
  })

  it('reads into the game log as lines with no speaker of their own', () => {
    const board = boardFromView(later)
    const events = eventsBetween(null, { ...later, log: [{ type: 'lifeChanged', description: 'You lost 3 life' }] })
    const turns = readLog(events, board, { you: YOU })
    const entry = turns[0].items.find((i) => i.kind === 'entry')
    expect(entry.text).toBe('You lost 3 life')
    expect(entry.who).toBeNull()
  })

  it('knows every engine step by this app\'s name, and defaults sanely', () => {
    expect(stepIdOf('PRECOMBAT_MAIN')).toBe('main1')
    expect(stepIdOf('COMBAT_DAMAGE')).toBe('damage')
    expect(stepIdOf('SOMETHING_NEW')).toBe('untap')
  })
})
