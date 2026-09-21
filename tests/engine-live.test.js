// @vitest-environment node
/**
 * The engine process, actually driven: a whole game over the wire.
 *
 * This runs only where scripts/engine-build.sh has been run (or ENGINE_CMD
 * points at a launcher). Everywhere else it is skipped and says so, because a
 * JVM and a five-minute compile are not something `npm test` may demand.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startEngine, findEngine } from '../scripts/engine-bridge.mjs'

const command = findEngine()
// Portal, the one set the first build registers: creatures to attack with and a burn spell that needs a target.
const deck = { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 }

describe.skipIf(!command)('the engine on the wire', () => {
  let engine
  beforeAll(() => { engine = startEngine({ command, timeoutMs: 120_000 }) })
  afterAll(async () => { await engine?.close() })

  it('says who it is and what it knows', async () => {
    const hello = await engine.call('hello')
    expect(hello.engine).toBe('argentum')
    expect(hello.protocol).toBe(1)
    const { names } = await engine.call('cards')
    expect(names).toContain('Raging Goblin')
    expect(names.length).toBe(hello.cards)
  }, 60_000)

  it('refuses a deck it cannot enforce, naming the cards', async () => {
    await expect(engine.call('new', {
      players: [{ name: 'A', deck: { Mountain: 10, 'Made-Up Card': 2 } }, { name: 'B', deck }],
    })).rejects.toThrow(/Made-Up Card/)
  }, 60_000)

  it('plays a game against the engine, passing for the human only where nothing is affordable', async () => {
    let status = await engine.call('new', {
      players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'random' }],
    })
    expect(status.seats).toHaveLength(2)
    const you = status.seats[0].id
    const bot = status.seats[1].id

    const first = await engine.call('view', { viewer: you })
    expect(first.state.viewingPlayerId).toBe(you)
    const hand = (state, owner) => state.zones.find((z) => z.zoneId.zoneType === 'Hand' && z.zoneId.ownerId === owner)
    const mine = hand(first.state, you)
    const theirs = hand(first.state, bot)
    expect(mine.size).toBe(7)
    expect(mine.isVisible).toBe(true)
    expect(mine.cardIds.filter((id) => first.state.cards[id]?.name).length).toBe(7)
    // Their hand arrives as a count and nothing else: no ids, no names.
    expect(theirs.size).toBe(7)
    expect(theirs.isVisible).toBe(false)
    expect(theirs.cardIds).toHaveLength(0)

    let stops = 0
    let passed = 0
    let acted = 0
    let deltaBytes = []
    while (!status.over && stops < 300) {
      passed += status.autoPassed
      if (status.waiting === 'decision') {
        status = await engine.call('decide', { auto: true })
      } else if (status.waiting === 'action') {
        // Every stop must be one where the human can actually do something
        // worth doing: tapping a land for nothing does not count.
        expect(status.actions.some((a) => a.meaningful && a.affordable)).toBe(true)
        const pick = status.actions.find((a) => a.meaningful && a.affordable && !a.requiresTargets)
          ?? status.actions.find((a) => a.type === 'PassPriority')
        status = await engine.call('act', { index: pick.index })
        acted++
        const v = await engine.call('view', { viewer: you, delta: true })
        expect(v.delta).toBeDefined()
        deltaBytes.push(JSON.stringify(v.delta).length)
      } else {
        status = await engine.call('turn')
      }
      stops++
    }
    expect(acted).toBeGreaterThan(5)
    expect(passed).toBeGreaterThan(0)
    expect(status.turn).toBeGreaterThan(1)
    const full = JSON.stringify(first.state).length
    const median = deltaBytes.sort((a, b) => a - b)[Math.floor(deltaBytes.length / 2)]
    expect(median).toBeLessThan(full)
  }, 300_000)

  it('refuses an action that was not offered', async () => {
    await expect(engine.call('act', { index: 999 })).rejects.toThrow(/No action 999|No actions are on offer|not waiting on anyone/)
  }, 60_000)

  it('plays the same game again from the same seed, and says which seed a game was', async () => {
    // A game's whole course as a person would see it: the opening hand, then
    // each stop's turn and step and what was done there, then who won.
    const playOut = async (seed) => {
      let status = await engine.call('new', {
        players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'heuristic' }],
        ...(seed == null ? {} : { seed }),
      })
      const chosen = status.seed
      const you = status.seats[0].id
      const opening = (await engine.call('view', { viewer: you })).state
      const hand = opening.zones.find((z) => z.zoneId.zoneType === 'Hand' && z.zoneId.ownerId === you)
      const course = [hand.cardIds.map((id) => opening.cards[id].name).join(', ')]
      for (let stops = 0; !status.over && stops < 300; stops++) {
        if (status.waiting === 'decision') status = await engine.call('decide', { auto: true })
        else if (status.waiting === 'action') {
          const pick = status.actions.find((a) => a.meaningful && a.affordable && !a.requiresTargets)
            ?? status.actions.find((a) => a.type === 'PassPriority')
          course.push(`${status.turn} ${status.step}: ${pick.description}`)
          status = await engine.call('act', { index: pick.index })
        } else status = await engine.call('turn')
      }
      course.push(`won by ${status.winner}`)
      return { seed: chosen, course }
    }

    const a = await playOut(20260921)
    const b = await playOut(20260921)
    expect(a.seed).toBe(20260921)
    expect(b.course).toEqual(a.course)
    // Left to choose, the engine says which seed it chose, and the seed comes
    // through JavaScript whole: playing it again gives the same game.
    const c = await playOut()
    expect(Number.isSafeInteger(c.seed)).toBe(true)
    expect((await playOut(c.seed)).course).toEqual(c.course)
  }, 300_000)
})

if (!command) {
  describe('the engine on the wire', () => {
    it.skip('is not built here: run scripts/engine-build.sh or set ENGINE_CMD', () => {})
  })
}
