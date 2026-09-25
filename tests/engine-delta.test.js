// @vitest-environment node
/**
 * Deltas on the wire, and the run of views a seat is sent.
 *
 * The heart of this file is the captured run in
 * `tests/fixtures/engine-views.json` (`scripts/engine-capture.mjs`): a real
 * game, from a fixed seed, recorded at every stop as both the `StateDelta`
 * since the stop before it and — at the moments worth pinning — the whole
 * state the engine would have sent instead. Walking the run applying deltas
 * and holding the result against the engine's own full view is the only test
 * that can say `applyDelta` agrees with Argentum's `StateDiffCalculator`
 * rather than with this app's reading of it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyDelta, boardFromView, eventsBetween, THINKING, thinkingAt } from '../src/lib/engine/board.js'
import { nothingHeld, receiveView } from '../src/lib/engine/stream.js'

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/engine-views.json', import.meta.url), 'utf8'))
const RUN = FIXTURE.run
const SEATS = FIXTURE.seats
const YOU = 'e0'
const BOT = 'e1'

/** Zones are a set named by key; the order they arrive in is nobody's promise. */
const zoneMap = (view) => Object.fromEntries((view.zones ?? []).map((z) => [`${z.zoneId?.ownerId}:${z.zoneId?.zoneType}`, z]))
const sameTable = (applied, whole, where) => {
  expect(applied.cards, `${where}: cards`).toEqual(whole.cards)
  expect(zoneMap(applied), `${where}: zones`).toEqual(zoneMap(whole))
  expect(applied.players, `${where}: players`).toEqual(whole.players)
  expect(applied.combat ?? null, `${where}: combat`).toEqual(whole.combat ?? null)
  expect(applied.deck ?? null, `${where}: deck`).toEqual(whole.deck ?? null)
  for (const key of ['currentPhase', 'currentStep', 'activePlayerId', 'priorityPlayerId', 'turnNumber', 'isGameOver', 'winnerId']) {
    expect(applied[key] ?? null, `${where}: ${key}`).toEqual(whole[key] ?? null)
  }
}

describe('the captured run', () => {
  it('holds the engine\'s turn caught mid-flight, a combat and the offer to block it', () => {
    expect(RUN.views.length).toBeGreaterThan(8)
    expect(RUN.views.filter((v) => v.status.waiting === 'engine').length).toBeGreaterThan(1)
    expect(RUN.views.some((v) => v.state?.combat?.attackers?.length)).toBe(true)
    expect(RUN.views.some((v) => (v.status.actions ?? []).some((a) => a.type === 'DeclareBlockers'))).toBe(true)
    expect(RUN.views.some((v) => v.status.autoPassed > 0)).toBe(true)
    // The first is the table whole and every later one a delta against it.
    expect(RUN.views[0].state).toBeTruthy()
    expect(RUN.views[0].delta).toBeUndefined()
    expect(RUN.views.slice(1).every((v) => v.delta)).toBe(true)
  })

  it('and, since M4, blockers declared on the board, a decision put to the person, and the opening hand', () => {
    // M2's item left short (PLAN.md): no view a client was sent carried either.
    expect(RUN.views.some((v) => v.state?.combat?.attackers?.some((a) => a.blockedBy?.length))).toBe(true)
    expect(RUN.views.some((v) => v.status.waiting === 'decision' && v.status.decision?.type === 'ChooseTargets')).toBe(true)
    // The engine's attack is a stop of its own too, not only the offer to block it.
    expect(RUN.views.some((v) => v.status.waiting === 'engine' && v.status.step === 'DECLARE_ATTACKERS')).toBe(true)
    expect(RUN.views[0].status.actions.map((a) => a.type)).toEqual(['KeepHand', 'TakeMulligan'])
    expect(RUN.views.some((v) => (v.status.actions ?? []).some((a) => a.type === 'BottomCards'))).toBe(true)
    // What the capture says it holds is what it holds (scripts/engine-capture.mjs, `marks`).
    expect(RUN.held).toEqual(expect.arrayContaining(['aimed only', 'blockable', 'blocks', 'bottom', 'combat', 'decision', 'engine', 'mulligan', 'passed']))
    expect(RUN.protocol).toBe(6)
  })
})

describe('applyDelta, against the engine\'s own diffs', () => {
  it('walks the whole run and lands on the state the engine would have sent', () => {
    let view = { ...RUN.views[0].state, log: RUN.views[0].fullLog }
    let pinned = 0
    for (const entry of RUN.views.slice(1)) {
      const next = applyDelta(view, entry.delta, { log: entry.log })
      expect(next, `view ${entry.at} could not be applied`).not.toBeNull()
      view = next
      if (!entry.state) continue
      pinned++
      sameTable(view, entry.state, `view ${entry.at}`)
      // The log travels as the lines added since; appended, it is the whole
      // log the engine holds for that seat.
      expect(view.log, `view ${entry.at}: log`).toEqual(entry.fullLog)
    }
    expect(pinned).toBeGreaterThan(2)
  })

  it('draws the same board whether the view was sent whole or built from deltas', () => {
    let view = { ...RUN.views[0].state, log: RUN.views[0].fullLog }
    let checked = 0
    for (const entry of RUN.views.slice(1)) {
      view = applyDelta(view, entry.delta, { log: entry.log })
      if (!entry.state) continue
      checked++
      expect(boardFromView(view, { seats: SEATS }), `view ${entry.at}`).toEqual(boardFromView(entry.state, { seats: SEATS }))
    }
    expect(checked).toBeGreaterThan(2)
  })

  it('says the same things happened, in the same order, either way', () => {
    // The log is what the table reads; a delta's lines are only the new ones,
    // so the events between two views must come out the same as they would
    // from two full views.
    const [first, ...rest] = RUN.views
    let view = { ...first.state, log: first.fullLog }
    for (const entry of rest) {
      const next = applyDelta(view, entry.delta, { log: entry.log })
      if (entry.state) {
        const fromWhole = eventsBetween(view, { ...entry.state, log: entry.fullLog })
        const fromDelta = eventsBetween(view, next)
        expect(fromDelta.map((e) => [e.type, e.turn, e.text ?? e.to ?? null]), `view ${entry.at}`)
          .toEqual(fromWhole.map((e) => [e.type, e.turn, e.text ?? e.to ?? null]))
      }
      view = next
    }
  })
})

describe('applyDelta, on the DTO\'s own terms', () => {
  const view = {
    viewingPlayerId: YOU,
    cards: { c1: { id: 'c1', name: 'Mountain' }, c2: { id: 'c2', name: 'Raging Goblin' } },
    zones: [
      { zoneId: { ownerId: YOU, zoneType: 'Battlefield' }, cardIds: ['c1'], size: 1, isVisible: true },
      { zoneId: { ownerId: YOU, zoneType: 'Hand' }, cardIds: ['c2'], size: 1, isVisible: true },
    ],
    players: [{ playerId: YOU, life: 20 }, { playerId: BOT, life: 20 }],
    currentPhase: 'PRECOMBAT_MAIN', currentStep: 'PRECOMBAT_MAIN',
    activePlayerId: YOU, priorityPlayerId: YOU, turnNumber: 3,
    isGameOver: false, winnerId: null, combat: null, log: [{ description: 'You drew a card' }],
  }
  const players = [{ playerId: YOU, life: 17 }, { playerId: BOT, life: 20 }]

  it('leaves a field the delta says nothing about exactly as it was', () => {
    const next = applyDelta(view, { players })
    expect(next.currentStep).toBe('PRECOMBAT_MAIN')
    expect(next.turnNumber).toBe(3)
    expect(next.cards).toEqual(view.cards)
    expect(next.zones).toEqual(view.zones)
    expect(next.players).toEqual(players)
    expect(next.log).toEqual(view.log)
    expect(view.players[0].life).toBe(20) // and never changes the view it was given
  })

  it('takes a scalar that changed, false and zero included', () => {
    const next = applyDelta({ ...view, isGameOver: true }, { players, isGameOver: false, turnNumber: 4, winnerId: BOT })
    expect(next.isGameOver).toBe(false)
    expect(next.turnNumber).toBe(4)
    expect(next.winnerId).toBe(BOT)
  })

  it('adds, replaces and removes cards, and replaces a zone by its name', () => {
    const next = applyDelta(view, {
      players,
      addedCards: { c3: { id: 'c3', name: 'Lava Axe' } },
      updatedCards: { c1: { id: 'c1', name: 'Mountain', isTapped: true } },
      removedCardIds: ['c2'],
      updatedZones: [
        { zoneId: { ownerId: YOU, zoneType: 'Hand' }, cardIds: ['c3'], size: 1, isVisible: true },
        { zoneId: { ownerId: BOT, zoneType: 'Graveyard' }, cardIds: [], size: 0, isVisible: true },
      ],
    })
    expect(Object.keys(next.cards).sort()).toEqual(['c1', 'c3'])
    expect(next.cards.c1.isTapped).toBe(true)
    expect(next.zones).toHaveLength(3)
    expect(next.zones.find((z) => z.zoneId.zoneType === 'Hand').cardIds).toEqual(['c3'])
    expect(next.zones[2].zoneId.ownerId).toBe(BOT)
  })

  it('says a combat that has ended with combatCleared, not by leaving it out', () => {
    const inCombat = applyDelta(view, { players, combat: { attackingPlayerId: YOU, attackers: [{ creatureId: 'c2' }] } })
    expect(inCombat.combat.attackers).toHaveLength(1)
    expect(applyDelta(inCombat, { players }).combat).toEqual(inCombat.combat)
    expect(applyDelta(inCombat, { players, combatCleared: true }).combat).toBeNull()
  })

  it('appends the lines the wire carried, and the DTO\'s own if it ever fills them', () => {
    const next = applyDelta(view, { players, newLogEntries: [{ description: 'A trigger' }] }, { log: [{ description: 'You played a Mountain' }] })
    expect(next.log.map((l) => l.description)).toEqual(['You drew a card', 'A trigger', 'You played a Mountain'])
    expect(applyDelta(view, { players }).log).toEqual(view.log)
  })

  it('clears a hijack by its absence, and keeps what never changes', () => {
    const under = applyDelta(view, { players, youAreHijackedBy: BOT, hotseat: false })
    expect(under.youAreHijackedBy).toBe(BOT)
    expect(applyDelta(under, { players }).youAreHijackedBy).toBeNull()
    expect(applyDelta({ ...view, hotseat: true }, { players }).hotseat).toBe(true)
  })

  it('returns null rather than guess at a delta it cannot make sense of', () => {
    expect(applyDelta(view, { addedCards: {} })).toBeNull() // no players: not a delta
    expect(applyDelta(view, { players, addedCards: [] })).toBeNull()
    expect(applyDelta(view, { players, updatedCards: 'lots' })).toBeNull()
    expect(applyDelta(view, { players, removedCardIds: 'c2' })).toBeNull()
    expect(applyDelta(view, { players, updatedZones: [{ cardIds: [] }] })).toBeNull() // a zone with no name
    expect(applyDelta(view, null)).toBeNull()
    expect(applyDelta(null, { players })).toBeNull()
  })
})

describe('the run of views a seat is sent', () => {
  const whole = (seq) => ({ you: YOU, seq, state: { turnNumber: seq, players: [] }, log: [{ description: `line ${seq}` }] })
  const delta = (seq, players = []) => ({ you: YOU, seq, delta: { players }, log: [{ description: `line ${seq}` }] })

  it('takes the table whole, and then the deltas that follow it', () => {
    let held = nothingHeld()
    let out = receiveView(held, whole(1))
    expect(out.view.turnNumber).toBe(1)
    expect(out.resync).toBe(false)
    held = out.held
    out = receiveView(held, delta(2, [{ playerId: YOU, life: 19 }]))
    expect(out.resync).toBe(false)
    expect(out.view.players[0].life).toBe(19)
    expect(out.view.log.map((l) => l.description)).toEqual(['line 1', 'line 2'])
    expect(out.held.seq).toBe(2)
  })

  it('asks for the table whole when a number is skipped, and draws nothing meanwhile', () => {
    const first = receiveView(nothingHeld(), whole(1))
    const gap = receiveView(first.held, delta(3))
    expect(gap.resync).toBe(true)
    expect(gap.view).toBeNull()
    expect(gap.held.view).toEqual(first.held.view) // the last board known to be right stands
  })

  it('asks again when enough deltas have gone by for the ask itself to look lost', () => {
    // An ask can go missing as a view can, and a seat that asked once and
    // never heard back would draw a board that never moves and say nothing.
    let held = receiveView(nothingHeld(), whole(1)).held
    let seq = 3
    let asks = 0
    for (let i = 0; i < 12; i++) {
      const out = receiveView(held, delta(seq++))
      held = out.held
      if (out.resync) asks++
      expect(out.view).toBeNull() // and nothing is drawn meanwhile, whatever is asked
    }
    expect(asks).toBeGreaterThan(1)
    expect(asks).toBeLessThan(5)
    // And the whole view that comes of it ends the asking for good.
    const back = receiveView(held, whole(20))
    expect(back.view.turnNumber).toBe(20)
    expect(back.held.asking).toBe(false)
    expect(receiveView(back.held, delta(21)).resync).toBe(false)
  })

  it('asks once and no more while the answer is on its way', () => {
    const first = receiveView(nothingHeld(), whole(1))
    const gap = receiveView(first.held, delta(3))
    const after = receiveView(gap.held, delta(4))
    expect(after.resync).toBe(false)
    expect(after.view).toBeNull()
    // And the whole view that arrives is taken, at whatever number it carries.
    const back = receiveView(after.held, whole(6))
    expect(back.view.turnNumber).toBe(6)
    expect(back.held.asking).toBe(false)
    expect(back.held.seq).toBe(6)
    expect(receiveView(back.held, delta(7)).view).not.toBeNull()
  })

  it('asks when a delta arrives with nothing to apply it to, or cannot be applied', () => {
    expect(receiveView(nothingHeld(), delta(1)).resync).toBe(true)
    const first = receiveView(nothingHeld(), whole(1))
    // A delta with no players is not one this build can read (StateDelta.kt).
    const broken = receiveView(first.held, { you: YOU, seq: 2, delta: { addedCards: {} }, log: [] })
    expect(broken.resync).toBe(true)
    expect(broken.view).toBeNull()
  })

  it('reads an older relay forgivingly, and ignores a message with no view in it', () => {
    // A relay from before the numbering sends none; its views are always whole.
    const old = receiveView(nothingHeld(), { you: YOU, state: { turnNumber: 2, players: [] } })
    expect(old.view.turnNumber).toBe(2)
    expect(old.view.log).toEqual([])
    const nothing = receiveView(old.held, { you: YOU })
    expect(nothing.view).toBeNull()
    expect(nothing.resync).toBe(false)
    expect(nothing.held).toEqual(old.held)
  })

  it('takes the run the engine really sent, delta after delta', () => {
    let held = nothingHeld()
    let seq = 0
    let last = null
    for (const entry of RUN.views) {
      const message = entry.at === 0
        ? { you: RUN.you, seq: ++seq, state: entry.state, log: entry.fullLog }
        : { you: RUN.you, seq: ++seq, delta: entry.delta, log: entry.log }
      const out = receiveView(held, message)
      expect(out.resync, `view ${entry.at}`).toBe(false)
      expect(out.view, `view ${entry.at}`).not.toBeNull()
      held = out.held
      last = out.view
    }
    const end = RUN.views[RUN.views.length - 1]
    expect(last.log).toEqual(end.fullLog)
    expect(last.turnNumber).toBe(end.state.turnNumber)
  })
})

describe('while the engine is thinking', () => {
  it('is the seat the paced table stopped at, and nobody else', () => {
    const paused = { waiting: 'engine', actor: BOT, over: false }
    expect(thinkingAt(paused, BOT)).toBe(true)
    expect(thinkingAt(paused, YOU)).toBe(false)
    expect(thinkingAt({ waiting: 'action', actor: BOT }, BOT)).toBe(false)
    expect(thinkingAt({ waiting: 'engine', actor: BOT, over: true }, BOT)).toBe(false)
    expect(thinkingAt(null, BOT)).toBe(false)
    expect(thinkingAt(paused, null)).toBe(false)
  })

  it('says so in words', () => {
    expect(THINKING).toBe('The engine is thinking…')
  })

  it('is what the captured run stops at, twice a turn of the engine\'s', () => {
    const paused = RUN.views.filter((v) => thinkingAt(v.status, RUN.views[0].state.players.map((p) => p.playerId).find((id) => id !== RUN.you)))
    expect(paused.length).toBeGreaterThan(1)
    // Never a stop of the player's: the engine passes priority in the player's
    // windows, and passing is not a play worth watching (engine/README.md). Its
    // blocks, made in a turn of the player's, are, since M4.
    expect(paused.every((v) => v.status.actor !== RUN.you)).toBe(true)
  })
})
