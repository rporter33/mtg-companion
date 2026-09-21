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
// Portal goblins: creatures to attack with and a burn spell that needs a target,
// the deck the first measurements were taken with.
const deck = { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 }

describe.skipIf(!command)('the engine on the wire', () => {
  let engine
  let hello
  // The first answer waits on the whole corpus loading, so the hook is given
  // the allowance the relay gives it, and every test after asks a ready engine.
  beforeAll(async () => {
    engine = startEngine({ command, timeoutMs: 120_000 })
    hello = await engine.call('hello')
  }, 150_000)
  afterAll(async () => { await engine?.close() })

  it('says who it is, and knows the whole corpus rather than one set', async () => {
    expect(hello.engine).toBe('argentum')
    expect(hello.protocol).toBe(2)
    expect(hello.cards).toBeGreaterThan(12_000)
    expect(hello.sets.length).toBeGreaterThan(100)
    expect(hello.sets.find((s) => s.code === 'POR')).toEqual({ code: 'POR', name: 'Portal', released: '1997-05-01', incomplete: false })
    expect(hello.load.ms).toBeGreaterThan(0)
    expect(hello.load.heapMb).toBeGreaterThan(0)
    const { names } = await engine.call('cards')
    expect(names).toContain('Raging Goblin')
    expect(names).toContain('Monastery Swiftspear')
    // A deck may hold a card; a token is not one, though the engine knows it.
    expect(names).not.toContain('Treasure')
    expect(names.length).toBe(hello.cards)
  }, 60_000)

  it('refuses a deck it cannot enforce, naming the cards, and will not deal a token as a card', async () => {
    await expect(engine.call('new', {
      players: [{ name: 'A', deck: { Mountain: 10, 'Made-Up Card': 2 } }, { name: 'B', deck }],
    })).rejects.toThrow(/Made-Up Card/)
    await expect(engine.call('new', {
      players: [{ name: 'A', deck: { Mountain: 10, Treasure: 2 } }, { name: 'B', deck }],
    })).rejects.toThrow(/Treasure/)
  }, 60_000)

  it('reads a name that is not plain ASCII as the name it is', async () => {
    // Were the accents garbled on the way in, Déjà Vu would be refused as unknown.
    const status = await engine.call('new', {
      players: [{ name: 'A', deck: { Island: 16, 'Déjà Vu': 4 } }, { name: 'B', deck }],
    })
    expect(status.seats).toHaveLength(2)
  }, 60_000)

  // Names exactly as Scryfall spells them (checked against Scryfall on
  // 2026-09-21), because those are what the app sends. The first four are
  // Scryfall's transform, modal_dfc, adventure and prepare layouts, which the
  // engine knows by their fronts; the split card and the Room it knows whole.
  const scryfallNames = {
    'Delver of Secrets // Insectile Aberration': 4,
    'Barkchannel Pathway // Tidechannel Pathway': 4,
    'Dirgur Island Dragon // Skimming Strike': 4,
    'Abigale, Poet Laureate // Heroic Stanza': 4,
    'Assault // Battery': 4,
    'Bottomless Pool // Locker Room': 4,
    'Déjà Vu': 2,
  }

  it('knows a deck by the names Scryfall gives it, and not by names that are not a card', async () => {
    const reply = await engine.call('check', {
      deck: {
        ...scryfallNames,
        'Insectile Aberration': 1, // a back face alone is not a card a deck may hold
        'Delver of Secrets // Tidechannel Pathway': 1, // two cards glued together
        'Delver of Secrets // Delver of Secrets': 1, // the shape of an art-series card
        Treasure: 1, // a token
        'Made-Up Card': 1,
      },
      sideboard: { 'Made-Up Wish': 1, Island: 2 },
    })
    expect(reply.known).toBe(26)
    expect(reply.total).toBe(31)
    expect(reply.unknown).toEqual(['Delver of Secrets // Delver of Secrets', 'Delver of Secrets // Tidechannel Pathway', 'Insectile Aberration', 'Made-Up Card', 'Treasure'])
    expect(reply.unknownSideboard).toEqual(['Made-Up Wish'])
  }, 60_000)

  it('deals a deck sent under Scryfall\'s names, as the cards the engine knows', async () => {
    const status = await engine.call('new', {
      players: [
        { name: 'A', deck: { 'Delver of Secrets // Insectile Aberration': 4, 'Barkchannel Pathway // Tidechannel Pathway': 4, Island: 12 } },
        { name: 'B', deck },
      ],
      seed: 11,
    })
    const a = status.seats[0].id
    const opening = (await engine.call('view', { viewer: a })).state
    const hand = opening.zones.find((z) => z.zoneId.zoneType === 'Hand' && z.zoneId.ownerId === a)
    const names = hand.cardIds.map((id) => opening.cards[id].name)
    expect(names).toHaveLength(7)
    expect(names.every((n) => ['Delver of Secrets', 'Barkchannel Pathway', 'Island'].includes(n))).toBe(true)
  }, 60_000)

  it('deals a sideboard, and leaves out a sideboard card it does not know rather than refuse the game', async () => {
    const status = await engine.call('new', {
      players: [{ name: 'A', deck, sideboard: { 'Lava Axe': 2, 'Made-Up Wish': 1 } }, { name: 'B', deck }],
      seed: 5,
    })
    expect(status.seats[0].sideboardLeftOut).toEqual(['Made-Up Wish'])
    expect(status.seats[1].sideboardLeftOut).toEqual([])
    const a = status.seats[0].id
    const view = (await engine.call('view', { viewer: a })).state
    const side = view.zones.find((z) => /sideboard/i.test(z.zoneId.zoneType) && z.zoneId.ownerId === a)
    expect(side?.size).toBe(2)
  }, 60_000)

  it('deals the printing a deck names, and says which it does not have', async () => {
    const status = await engine.call('new', {
      players: [{
        name: 'A',
        deck: {
          // Portal's Mountain 208, whose Scryfall id is 17cf7ce4-… (checked 2026-09-21);
          // unpinned, a Mountain wears The Hobbit's.
          Mountain: { count: 20, set: 'por', number: '208' },
          // A number Portal never printed: named, not held, so the engine's own art.
          'Raging Goblin': { count: 20, set: 'por', number: '9999' },
        },
      }, { name: 'B', deck }],
      seed: 3,
    })
    expect(status.seats[0].unknownPrintings).toEqual(['Raging Goblin'])
    expect(status.seats[1].unknownPrintings).toEqual([])
    const a = status.seats[0].id
    const view = (await engine.call('view', { viewer: a })).state
    const mine = view.zones.find((z) => z.zoneId.zoneType === 'Hand' && z.zoneId.ownerId === a).cardIds.map((id) => view.cards[id])
    const mountain = mine.find((c) => c.name === 'Mountain')
    expect(mountain?.imageUri).toMatch(/17cf7ce4-d5d7-49f2-a7e4-021d1a2d58c5/)
    // The deal's own events survive being dealt outside env.reset: the log opens with the draw.
    expect((await engine.call('view', { viewer: a })).log.length).toBeGreaterThan(0)
  }, 60_000)

  it('plays a game with cards from sets other than Portal', async () => {
    const modern = { Mountain: 20, 'Monastery Swiftspear': 4, 'Heartfire Immolator': 4, 'Lightning Bolt': 4 }
    let status = await engine.call('new', {
      players: [{ name: 'You', deck: modern, autoPass: true }, { name: 'Bot', deck: modern, ai: 'heuristic' }],
      seed: 7,
    })
    const you = status.seats[0].id
    const opening = (await engine.call('view', { viewer: you })).state
    const hand = opening.zones.find((z) => z.zoneId.zoneType === 'Hand' && z.zoneId.ownerId === you)
    expect(hand.cardIds.map((id) => opening.cards[id].name).every((n) => n in modern)).toBe(true)
    // What is done, not whether it ends: this player never casts a spell that
    // needs a target, so it sits on its Lightning Bolts and the game can stall
    // for dozens of turns. It is stopped at every window while it holds one,
    // which is Law 1 working, not a hang.
    const done = []
    for (let stops = 0; !status.over && stops < 120; stops++) {
      if (status.waiting === 'decision') status = await engine.call('decide', { auto: true })
      else if (status.waiting === 'action') {
        const pick = status.actions.find((a) => a.meaningful && a.affordable && !a.requiresTargets)
          ?? status.actions.find((a) => a.type === 'PassPriority')
        done.push(pick.description)
        status = await engine.call('act', { index: pick.index })
      } else status = await engine.call('turn')
    }
    // Seed 7 deals Swiftspear early; a card from outside Portal, cast, is the claim.
    expect(done).toContain('Cast Monastery Swiftspear')
    expect(status.turn).toBeGreaterThan(3)
  }, 300_000)

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
