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
    expect(hello.protocol).toBe(4)
    // The levels, weakest first, each Argentum's own profile (Server.kt, LEVELS).
    expect(hello.levels).toEqual({ easy: 'v0', intermediate: 'production-raceclock', hard: 'production-candidate-expiring' })
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

  it('will not take a meld result as a card for a deck, though Scryfall lists it as one', async () => {
    // Argentum registers Chittering Host so Graf Rats and Midnight Scavengers can
    // meld into it, and keeps it out of every pool of cards a player can own.
    const reply = await engine.call('check', { deck: { 'Chittering Host': 1, Mountain: 1 } })
    expect(reply.unknown).toEqual(['Chittering Host'])
    const { names } = await engine.call('cards')
    expect(names).not.toContain('Chittering Host')
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
    // Every line of the log has its words, including the ones the engine
    // computes as a default: without them a land played went unsaid.
    const { log } = await engine.call('view', { viewer: you })
    expect(log.length).toBeGreaterThan(10)
    expect(log.filter((l) => typeof l.description !== 'string' || !l.description)).toEqual([])
    expect(log.some((l) => l.type === 'permanentEntered' && /entered the battlefield/.test(l.description))).toBe(true)
    // And none names a card in the other seat's hand or library. This deck
    // bounces and tutors nothing, so a line of a card going to a hand or a
    // library is one drawn, dealt or put back after a mulligan: theirs is
    // hidden, and yours going to hand is already said by the draw.
    const moved = log.filter((l) => l.type === 'permanentLeft' && ['hand', 'library'].includes(l.destination))
    expect(moved.filter((l) => l.ownerId === bot)).toEqual([])
    expect(moved.filter((l) => l.destination === 'hand')).toEqual([])
    expect(log.filter((l) => l.type === 'cardDrawn' && l.playerId === bot && l.cardName)).toEqual([])
    expect(log.some((l) => l.type === 'cardDrawn' && l.playerId === bot)).toBe(true)
    // Each line after the deal names the step it happened in: the engine's
    // draws on its own turns are in its draw step, not where you next stopped.
    expect(log.some((l) => l.type === 'cardDrawn' && l.playerId === bot && l.step === 'DRAW')).toBe(true)
    expect(log.filter((l) => l.type === 'permanentEntered' && typeof l.step !== 'string')).toEqual([])
    // Taps, untaps and mana are left out, as Argentum's own server leaves them out.
    expect(log.filter((l) => ['permanentTapped', 'permanentUntapped', 'manaAdded'].includes(l.type))).toEqual([])
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

  // The human seat these tests play: the first thing worth doing that needs no
  // target, else a pass. The same choice as every other game here, so a paced
  // game and an unpaced one are played by the same player.
  // The first play the table itself could make — nothing needing a target, and
  // no cost with a choice in it, since `act` carries neither — else a pass.
  const plainest = (status) =>
    status.actions.find((a) => a.meaningful && a.affordable && !a.requiresTargets && !a.additionalCost)
      ?? status.actions.find((a) => a.type === 'PassPriority')

  it('stops after each of the engine\'s plays when the table is paced, and says whose they are', async () => {
    let status = await engine.call('new', {
      players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'heuristic' }],
      seed: 20260922,
      // A number of milliseconds is the relay's own pace between steps; the
      // engine reads it only as a yes, and never waits itself.
      pace: 600,
    })
    expect(status.paced).toBe(true)
    const you = status.seats[0].id
    const bot = status.seats[1].id

    // The whole log once, then only what each delta adds: appending them must
    // rebuild the log exactly, or a watched turn would draw a wrong one.
    const first = await engine.call('view', { viewer: you })
    expect(first.state).toBeDefined()
    const assembled = first.log.map((l) => JSON.stringify(l))
    let longestDelta = 0
    let refusedMidTurn = false
    // How often the engine's own turn was watched in pieces, by turn number.
    const stopsInTurn = new Map()

    for (let steps = 0; !status.over && steps < 250; steps++) {
      const v = await engine.call('view', { viewer: you, delta: true })
      expect(v.delta).toBeDefined()
      expect(v.state).toBeUndefined()
      expect(v.log.filter((l) => typeof l.description !== 'string' || !l.description)).toEqual([])
      assembled.push(...v.log.map((l) => JSON.stringify(l)))
      longestDelta = Math.max(longestDelta, v.log.length)

      if (status.waiting === 'engine') {
        // The seat that acted, and nothing to do about it: this is a stop to
        // watch, not one to answer.
        expect(status.actor).toBe(bot)
        expect(status.actions).toBeUndefined()
        expect(status.decision).toBeUndefined()
        stopsInTurn.set(status.turn, (stopsInTurn.get(status.turn) ?? 0) + 1)
        status = await engine.call('continue')
      } else if (status.waiting === 'decision') {
        status = await engine.call('decide', { auto: true })
      } else if (status.waiting === 'action') {
        expect(status.actor).toBe(you)
        if (!refusedMidTurn) {
          // Waiting on the player is not waiting on the engine, and a relay that
          // asks anyway is told so rather than left believing it stepped.
          await expect(engine.call('continue')).rejects.toThrow(/Nothing is waiting on the engine/)
          refusedMidTurn = true
        }
        status = await engine.call('act', { index: plainest(status).index })
      } else break
    }

    // The engine's turn arrives in pieces, not as one jump: more than one stop
    // inside a turn of its own, each after a single play of its own. And none
    // inside a turn of yours — it passes priority in every window of those, and
    // a pace waited out for a pass would pace a turn it is only watching.
    expect(Math.max(...stopsInTurn.values())).toBeGreaterThan(1)
    expect([...stopsInTurn.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(10)
    expect(refusedMidTurn).toBe(true)
    // Two seats, you start, and nothing in this deck takes an extra turn, so the
    // engine's turns are the even ones and every stop should be in one of them.
    expect([...stopsInTurn.keys()].filter((t) => t % 2 === 1)).toEqual([])

    // One last delta for whatever the final act did, then the whole log: the
    // lines appended along the way are exactly it, in order and once each.
    const last = await engine.call('view', { viewer: you, delta: true })
    assembled.push(...last.log.map((l) => JSON.stringify(l)))
    const whole = await engine.call('view', { viewer: you })
    expect(whole.state).toBeDefined()
    expect(assembled).toEqual(whole.log.map((l) => JSON.stringify(l)))
    expect(whole.log.length).toBeGreaterThan(30)
    // And no delta carried the log over again: the point of sending only what
    // is new is that a turn watched at 600 ms does not resend it every time.
    expect(longestDelta).toBeLessThan(whole.log.length / 2)
  }, 300_000)

  it('plays the same game paced and unpaced, so the stopping is all a pace changed', async () => {
    // The same seed, the same decks, the same player: the course is every stop
    // the player was given and what was done there, and then who won.
    const playOut = async (paced) => {
      let status = await engine.call('new', {
        players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'heuristic' }],
        seed: 20260922,
        ...(paced ? { pace: true } : {}),
      })
      expect(status.paced).toBe(paced ? true : undefined)
      const you = status.seats[0].id
      const opening = (await engine.call('view', { viewer: you })).state
      const hand = opening.zones.find((z) => z.zoneId.zoneType === 'Hand' && z.zoneId.ownerId === you)
      const course = [hand.cardIds.map((id) => opening.cards[id].name).join(', ')]
      let engineStops = 0
      // Held to the same number of the player's own stops either way, so the two
      // runs cover the same game however far it gets; the guard is only there so
      // a paced run's many small steps cannot spin.
      for (let guard = 0; !status.over && course.length < 120 && guard < 20_000; guard++) {
        if (status.waiting === 'engine') { engineStops++; status = await engine.call('continue') }
        else if (status.waiting === 'decision') status = await engine.call('decide', { auto: true })
        else if (status.waiting === 'action') {
          const pick = plainest(status)
          course.push(`${status.turn} ${status.step}: ${pick.description}`)
          status = await engine.call('act', { index: pick.index })
        } else break
      }
      course.push(`won by ${status.winner}`)
      return { course, engineStops }
    }

    const plain = await playOut(false)
    const paced = await playOut(true)
    expect(paced.course).toEqual(plain.course)
    // An end, not a shared cap: this game is won, and both runs win it the same
    // way on the same turn. And the paced run really did stop along the way,
    // which is the only difference there was to make.
    expect(plain.course.at(-1)).toMatch(/^won by e/)
    expect(plain.course.length).toBeGreaterThan(10)
    expect(plain.engineStops).toBe(0)
    expect(paced.engineStops).toBeGreaterThan(5)
  }, 420_000)

  describe('at each level', () => {
    // One short game at each, against the plainest player there is: the seat
    // says which level and which of Argentum's profiles it took, the clock says
    // that profile did the choosing, and the engine plays its side of the table.
    for (const level of ['easy', 'intermediate', 'hard']) {
      it(`plays at ${level}, with the profile the level names`, async () => {
        let status = await engine.call('new', {
          players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'heuristic', level }],
          seed: 20260924,
          pace: true,
        })
        const [you, bot] = status.seats
        expect(bot).toMatchObject({ ai: 'heuristic', level, profile: hello.levels[level] })
        // A person's seat is not the engine's to play, and says nothing of either.
        expect(you).not.toHaveProperty('level')
        expect(you).not.toHaveProperty('profile')
        let engineStops = 0
        for (let steps = 0; !status.over && steps < 60; steps++) {
          if (status.waiting === 'engine') { engineStops++; status = await engine.call('continue') }
          else if (status.waiting === 'decision') status = await engine.call('decide', { auto: true })
          else if (status.waiting === 'action') status = await engine.call('act', { index: plainest(status).index })
          else break
        }
        // The engine made plays of its own that the table stopped to show.
        expect(engineStops).toBeGreaterThan(3)
        const clock = await engine.call('clock')
        expect(clock.seats).toHaveLength(1)
        expect(clock.seats[0]).toMatchObject({ id: bot.id, ai: 'heuristic', level, profile: hello.levels[level] })
        expect(clock.seats[0].choices.filter((c) => c.meaningful).length).toBeGreaterThan(3)
        expect(clock.seats[0].choices.every((c) => typeof c.ms === 'number' && c.ms >= 0)).toBe(true)
        // Asked again, the clock has started over.
        expect((await engine.call('clock')).seats[0].choices).toEqual([])
        // Its plays are in the log, said by the engine for the other seat.
        const { log } = await engine.call('view', { viewer: you.id })
        expect(log.some((l) => l.type === 'permanentEntered' && l.controllerId === bot.id)).toBe(true)
      }, 300_000)
    }

    it('plays as every engine before levels did when asked for none, or for one it has not got', async () => {
      for (const asked of [{}, { level: 'grandmaster' }]) {
        const status = await engine.call('new', {
          players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'heuristic', ...asked }],
          seed: 3,
        })
        // CURRENT is LEGACY_V0 under another id: the one way the engine played until now.
        expect(status.seats[1]).toMatchObject({ ai: 'heuristic', level: null, profile: 'current' })
      }
      // A level's word as the kind of player is read as that level, the shape M3 first sketched.
      const sketched = await engine.call('new', { players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'hard' }], seed: 3 })
      expect(sketched.seats[1]).toMatchObject({ ai: 'heuristic', level: 'hard', profile: 'production-candidate-expiring' })
      // A random player has no levels, and says none.
      const random = await engine.call('new', { players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'random', level: 'hard' }], seed: 3 })
      expect(random.seats[1].ai).toBe('random')
      expect(random.seats[1]).not.toHaveProperty('level')
    }, 60_000)

    it('refuses a profile it does not have, naming those it has, so a measurement never plays another', async () => {
      await expect(engine.call('new', {
        players: [{ name: 'A', deck, ai: 'heuristic', profile: 'made-up' }, { name: 'B', deck, ai: 'heuristic' }],
      })).rejects.toThrow(/No AI profile "made-up" here; these are: .*production-candidate-expiring/)
    }, 60_000)

    it('plays a different game at each level, and easy the very game the engine played before levels', async () => {
      // The label on the seat is Server.kt's own echo of what was asked, and a
      // level that reached AIPlayer as another profile would still carry it. So
      // the levels are held to what they do: from one seed, each against easy,
      // intermediate and hard each play a game of their own, and easy plays
      // exactly the game a seat asked for no level plays — the one way every
      // engine before protocol 4 fielded, `current`, which is `v0` under
      // another id. Were the profile dropped on the way to the player, all four
      // would be the same game. Seed 20260924 was checked to part them on
      // 2026-09-24; the whole log is compared, so any one choice made
      // differently shows.
      const game = async (level) => {
        const seat = (name, asked) => ({ name, deck, ai: 'heuristic', ...(asked ? { level: asked } : {}) })
        const status = await engine.call('new', { players: [seat('A', level), seat('B', 'easy')], seed: 20260924 })
        expect(status.over).toBe(true)
        const { log } = await engine.call('view', { viewer: status.seats[0].id })
        await engine.call('clock')
        return { winner: status.winner, turn: status.turn, lines: log.map((l) => l.description) }
      }
      const none = await game(null)
      const easy = await game('easy')
      const intermediate = await game('intermediate')
      const hard = await game('hard')
      expect(easy).toEqual(none)
      expect(intermediate.lines).not.toEqual(easy.lines)
      expect(hard.lines).not.toEqual(easy.lines)
      expect(hard.lines).not.toEqual(intermediate.lines)
    }, 300_000)

    it('plays a whole game between two levels inside one "new", the same game from the same seed', async () => {
      // The measurement's own shape (scripts/engine-levels.mjs): both seats the
      // engine's, the game played before the reply, and the clock read after.
      const game = async () => {
        const status = await engine.call('new', {
          players: [{ name: 'A', deck, ai: 'heuristic', level: 'hard' }, { name: 'B', deck, ai: 'heuristic', level: 'easy' }],
          seed: 20260924,
        })
        const clock = await engine.call('clock')
        return { over: status.over, winner: status.winner, turn: status.turn, choices: clock.seats.map((s) => [s.profile, s.choices.length]) }
      }
      const first = await game()
      expect(first.over).toBe(true)
      expect(first.winner).toMatch(/^e/)
      expect(first.choices.map(([p]) => p)).toEqual(['production-candidate-expiring', 'v0'])
      expect(first.choices.every(([, n]) => n > 10)).toBe(true)
      // Hard's search is budgeted in work rather than time (Argentum's
      // SearchAllowances), so its choices come out the same on a second run.
      expect(await game()).toEqual(first)
    }, 300_000)
  })

  it('says when an offer\'s cost has a choice in it, which a bare act cannot make', async () => {
    // Found by M3's measurement: Flamecache Gecko's "{1}{R}, Discard a card:
    // Draw a card" is offered as affordable and worth making, so the engine
    // stops the player for it, and `act` has no way to say which card goes.
    // The offer now says so, in Argentum's own words, and the table holds it
    // back as it holds back one needing a target (lib/engine/glow.js).
    const gecko = { Mountain: 20, 'Flamecache Gecko': 20 }
    let status = await engine.call('new', { players: [{ name: 'You', deck: gecko, autoPass: true }, { name: 'Bot', deck: gecko, ai: 'heuristic' }], seed: 1 })
    let offer = null
    for (let steps = 0; !status.over && steps < 400 && !offer; steps++) {
      if (status.waiting === 'decision') { status = await engine.call('decide', { auto: true }); continue }
      if (status.waiting !== 'action') break
      offer = status.actions.find((a) => a.type === 'ActivateAbility' && a.affordable && !a.mana && a.additionalCost)
      if (!offer) status = await engine.call('act', { index: plainest(status).index })
    }
    expect(offer).toMatchObject({ description: '{1}{R}, Discard a card: Draw a card', meaningful: true, requiresTargets: false, additionalCost: 'DiscardCard', additionalCostText: 'Discard a card' })
    // The stop was made for it alone, which is why the prompt has to say so.
    expect(status.actions.filter((a) => a.meaningful && a.affordable).every((a) => a.additionalCost)).toBe(true)
    await expect(engine.call('act', { index: offer.index })).rejects.toThrow(/Must choose 1 card\(s\) to discard/)
    // An offer with no such cost says nothing of one.
    expect(status.actions.filter((a) => a.type === 'PassPriority' || a.mana).every((a) => !('additionalCost' in a))).toBe(true)
  }, 120_000)

  it('refuses to be continued at a table that was never paced', async () => {
    await engine.call('new', {
      players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'random' }],
      seed: 12,
    })
    await expect(engine.call('continue')).rejects.toThrow(/not paced/)
  }, 60_000)
})

if (!command) {
  describe('the engine on the wire', () => {
    it.skip('is not built here: run scripts/engine-build.sh or set ENGINE_CMD', () => {})
  })
}
