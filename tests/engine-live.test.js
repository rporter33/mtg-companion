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
    expect(hello.protocol).toBe(6)
    // The levels, weakest first, each Argentum's own profile (Server.kt, LEVELS).
    expect(hello.levels).toEqual({ easy: 'v0', intermediate: 'production-raceclock', hard: 'production-candidate-expiring' })
    // What a person may choose (protocol 5): what `act` takes, the costs it can
    // pay with a choice, and the decisions it can put to them; and since
    // protocol 6, the cards put on the bottom after a mulligan.
    expect(hello.choices.act).toEqual(['targets', 'x', 'damage', 'cost', 'auto', 'cards'])
    expect(hello.choices.costs).toContain('DiscardCard')
    expect(hello.choices.decisions).toEqual(expect.arrayContaining(['ChooseTargets', 'YesNo', 'ChooseOption', 'SelectCards', 'OrderObjects', 'ReorderLibrary', 'Distribute', 'CombatResolution', 'SelectManaSources', 'ChooseNumber', 'ChooseColor', 'ChooseMode', 'BatchYesNo']))
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

  it('stops after the engine\'s attacks and its blocks, and after a spell it aims, which are plays as much as a land is', async () => {
    // Until M4 the engine's choice was matched to its offer by equality, and a
    // choice comes back filled in — its attackers, its blockers, its targets —
    // so none of those was ever a stop: eight paced games measured on
    // 2026-09-24 stopped only in main phases. The person here attacks with
    // everything, so the engine has attacks to block.
    let status = await engine.call('new', {
      players: [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'heuristic', level: 'easy' }],
      seed: 1,
      pace: true,
    })
    const [you, bot] = status.seats.map((s) => s.id)
    const seen = { attacks: 0, blocks: 0, aimed: 0, empty: 0 }
    let heard = 0
    for (let steps = 0; !status.over && steps < 400; steps++) {
      // What was said since the stop before this one: at one of the engine's,
      // what it did to earn the stop.
      const { state, log } = await engine.call('view', { viewer: you })
      const since = log.slice(heard).map((l) => l.description)
      heard = log.length
      if (status.waiting === 'engine') {
        const combat = state.combat
        // A spell resolves inside the step that casts it (the gym's step passes
        // for both players while the stack holds anything), so an aimed spell
        // is watched once it has landed. It is counted only where this stop is
        // the Hammer's own: its lines end with the Hammer resolving and what that
        // did, and nothing the engine did after it — an attack, a block, a land,
        // another cast. Were the Hammer no stop, its lines would arrive with the
        // next stop's, behind that stop's own action (found in M4's review: the
        // last cast alone was still the Hammer's at the attack that followed it).
        const cast = since.findLastIndex((d) => /^Opponent cast /.test(d))
        const after = cast >= 0 && /^Opponent cast Volcanic Hammer targeting /.test(since[cast]) ? since.slice(cast + 1) : null
        if (after && after.includes('Volcanic Hammer resolved') && !after.some((d) => / attacked$| blocked |entered the battlefield$/.test(d))) seen.aimed++
        if (status.step === 'DECLARE_ATTACKERS') {
          if (combat?.attackingPlayerId === bot && combat.attackers.length) seen.attacks++
          else seen.empty++
        }
        if (status.step === 'DECLARE_BLOCKERS') {
          if (combat?.blockers?.length) seen.blocks++
          else seen.empty++
        }
        status = await engine.call('continue')
        continue
      }
      if (status.waiting === 'decision') { status = await engine.call('decide', { auto: true }); continue }
      if (status.waiting !== 'action') break
      const attack = status.actions.find((a) => a.type === 'DeclareAttackers' && a.meaningful)
      const block = status.actions.find((a) => a.type === 'DeclareBlockers')
      if (attack) status = await engine.call('act', { index: attack.index, attackers: Object.fromEntries(attack.validAttackers.map((id) => [id, attack.validAttackTargets[0]])) })
      else if (block) status = await engine.call('act', { index: block.index, blockers: {} })
      else status = await engine.call('act', { index: plainest(status).index })
    }
    expect(seen.attacks).toBeGreaterThan(0)
    expect(seen.blocks).toBeGreaterThan(0)
    // Volcanic Hammer, cast by the engine at a target of its choosing, watched as a play of its own.
    expect(seen.aimed).toBeGreaterThan(0)
    // A declaration of nothing is still no play, and no stop.
    expect(seen.empty).toBe(0)
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

  it('says when an offer\'s cost has a choice in it, which a bare act cannot make and a chosen one can', async () => {
    // Found by M3's measurement: Flamecache Gecko's "{1}{R}, Discard a card:
    // Draw a card" is offered as affordable and worth making, so the engine
    // stops the player for it. The offer says so, in Argentum's own words; sent
    // bare it is refused, and since protocol 5 `act` can say which card goes.
    // A table told nothing of that holds it back (lib/engine/glow.js).
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
    // What it may take is listed, and the card chosen from them is the one discarded.
    expect(offer.costChoice).toMatchObject({ min: 1, max: 1 })
    const you = status.actor
    const drop = offer.costChoice.candidates[0]
    status = await engine.call('act', { index: offer.index, cost: [drop] })
    const state = (await engine.call('view', { viewer: you })).state
    expect(state.zones.find((z) => z.zoneId.zoneType === 'Graveyard' && z.zoneId.ownerId === you).cardIds).toContain(drop)
  }, 120_000)

  describe('what a person chooses (protocol 5)', () => {
    // Every decision this app's table can show, as the client says in its sit.
    const ANSWERS = ['SelectCards', 'OrderObjects', 'ReorderLibrary', 'Distribute', 'CombatResolution', 'SelectManaSources', 'ChooseNumber', 'ChooseColor', 'ChooseMode', 'BatchYesNo']
    const passOf = (s) => s.actions.find((a) => a.type === 'PassPriority') ?? s.actions.find((a) => /^Declare/.test(a.type))
    const stateOf = async (who) => (await engine.call('view', { viewer: who })).state
    const lives = async (who) => Object.fromEntries((await stateOf(who)).players.map((p) => [p.playerId, p.life]))
    const zoneIds = (state, owner, type) => state.zones.find((z) => z.zoneId.zoneType === type && z.zoneId.ownerId === owner)?.cardIds ?? []
    /** The first stop offering a play `wanted` finds, playing the plainest thing and passing on the way. */
    const until = async (status, wanted, { steps = 300 } = {}) => {
      for (let i = 0; i < steps && !status.over; i++) {
        if (status.waiting === 'decision') { status = await engine.call('decide', { auto: true }); continue }
        if (status.waiting !== 'action') break
        const offer = wanted(status)
        if (offer) return { status, offer }
        status = await engine.call('act', { index: plainest(status).index })
      }
      return { status, offer: null }
    }
    /** Passes until the stack is empty again, so what was cast has resolved. */
    const resolve = async (status, you) => {
      for (let i = 0; i < 12 && status.waiting === 'action' && status.actor === you; i++) {
        const stack = (await stateOf(you)).zones.find((z) => z.zoneId.zoneType === 'Stack')
        if (!stack?.cardIds?.length && !stack?.size) break
        status = await engine.call('act', { index: passOf(status).index })
      }
      return status
    }

    it('casts a spell at the target the person chose, and it resolves: Volcanic Hammer takes three from the engine', async () => {
      // Until protocol 5 this was refused before the engine would ask, with "No
      // valid targets available" (PLAN.md, M2): `act` sent none.
      let status = await engine.call('new', {
        players: [{ name: 'You', deck, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck, ai: 'heuristic' }],
        seed: 1,
      })
      const [you, bot] = status.seats.map((s) => s.id)
      expect(status.seats[0].asked).toEqual(['ChooseTargets', 'YesNo', 'ChooseOption', ...ANSWERS])
      const found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Volcanic Hammer' && a.affordable))
      expect(found.offer).toBeTruthy()
      // One requirement, said the same way whether Argentum listed it or not.
      expect(found.offer.targetRequirements).toEqual([{ index: 0, description: 'any target', min: 1, max: 1, legal: found.offer.validTargets }])
      expect(found.offer.validTargets).toContain(bot)
      const before = await lives(you)
      status = await engine.call('act', { index: found.offer.index, targets: { 0: [bot] } })
      status = await resolve(status, you)
      const after = await lives(you)
      expect(after[bot]).toBe(before[bot] - 3)
      expect(after[you]).toBe(before[you])
      // And the Hammer is in its owner's graveyard, spent.
      const state = await stateOf(you)
      expect(zoneIds(state, you, 'Graveyard').map((id) => state.cards[id].name)).toContain('Volcanic Hammer')
    }, 120_000)

    it('refuses a target that is not a legal one, in the engine\'s words, and nothing is cast', async () => {
      let status = await engine.call('new', {
        players: [{ name: 'You', deck, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck, ai: 'heuristic' }],
        seed: 1,
      })
      const you = status.seats[0].id
      const found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Volcanic Hammer' && a.affordable))
      const land = zoneIds(await stateOf(you), you, 'Battlefield')[0]
      expect(found.offer.validTargets).not.toContain(land)
      await expect(engine.call('act', { index: found.offer.index, targets: { 0: [land] } })).rejects.toThrow(/The engine refused that/)
      const hand = zoneIds(await stateOf(you), you, 'Hand')
      expect(hand).toContain(found.offer.card)
    }, 120_000)

    it('divides a spell\'s damage as the person chose, and takes an X', async () => {
      // Arc Lightning: 3 damage divided among one, two or three targets, the
      // division announced with the targets; Blaze: X damage to any target.
      const burn = { Mountain: 24, 'Arc Lightning': 8, Blaze: 8 }
      let status = await engine.call('new', {
        players: [{ name: 'You', deck: burn, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck: { Mountain: 40 }, ai: 'heuristic' }],
        seed: 2,
      })
      const [you, bot] = status.seats.map((s) => s.id)
      let found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Arc Lightning' && a.affordable))
      expect(found.offer.divide).toEqual({ total: 3, min: 1 })
      expect(found.offer.targetRequirements[0]).toMatchObject({ min: 1, max: 3 })
      let before = await lives(you)
      status = await engine.call('act', { index: found.offer.index, targets: { 0: [bot, you] }, damage: { [bot]: 2, [you]: 1 } })
      status = await resolve(status, you)
      let after = await lives(you)
      expect(after[bot]).toBe(before[bot] - 2)
      expect(after[you]).toBe(before[you] - 1)
      // A division that does not add up is refused, not rounded.
      found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Arc Lightning' && a.affordable))
      await expect(engine.call('act', { index: found.offer.index, targets: { 0: [bot, you] }, damage: { [bot]: 1, [you]: 1 } })).rejects.toThrow(/Total distributed damage/)

      found = await until(found.status, (s) => s.actions.find((a) => a.description === 'Cast Blaze' && a.affordable && a.x?.max >= 2))
      expect(found.offer.x).toMatchObject({ min: 0 })
      before = await lives(you)
      status = await engine.call('act', { index: found.offer.index, targets: { 0: [bot] }, x: 2 })
      status = await resolve(status, you)
      after = await lives(you)
      expect(after[bot]).toBe(before[bot] - 2)
    }, 180_000)

    it('pays a cost with the card the person chose: Tormenting Voice discards it', async () => {
      const voice = { Mountain: 24, 'Tormenting Voice': 16 }
      let status = await engine.call('new', {
        players: [{ name: 'You', deck: voice, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck: { Mountain: 40 }, ai: 'heuristic' }],
        seed: 2,
      })
      const you = status.seats[0].id
      const found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Tormenting Voice' && a.affordable))
      expect(found.offer).toMatchObject({ additionalCost: 'DiscardCard', costChoice: { min: 1, max: 1 } })
      const drop = found.offer.costChoice.candidates.find((id) => id !== found.offer.card)
      status = await engine.call('act', { index: found.offer.index, cost: [drop] })
      status = await resolve(status, you)
      expect(zoneIds(await stateOf(you), you, 'Graveyard')).toContain(drop)
      // A discard with no card chosen is passed on, and Argentum refuses it in
      // its own words; nothing is cast.
      const bare = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Tormenting Voice' && a.affordable))
      expect(bare.offer).toBeTruthy()
      await expect(engine.call('act', { index: bare.offer.index, cost: [] })).rejects.toThrow(/The engine refused that: You must discard 1 card\(s\) to cast this spell/)
      expect(zoneIds(await stateOf(you), you, 'Hand')).toContain(bare.offer.card)
    }, 120_000)

    it('refuses in its own words a cost chosen for a play that has none, or of a kind it cannot pay with a choice', async () => {
      // Server.kt's two refusals of `cost` (`paymentOf`), neither of which
      // Argentum is ever shown: Volcanic Hammer has no cost beyond mana, and
      // Fire Bowman's "Sacrifice this creature" is Argentum's `SacrificeSelf`,
      // which it pays by itself and `act` has no field for.
      let status = await engine.call('new', {
        players: [{ name: 'You', deck: { Mountain: 20, 'Fire Bowman': 12, 'Volcanic Hammer': 8 }, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck: { Mountain: 40 }, ai: 'heuristic' }],
        seed: 2,
      })
      const you = status.seats[0].id
      let found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Volcanic Hammer' && a.affordable))
      expect(found.offer).toBeTruthy()
      expect(found.offer).not.toHaveProperty('additionalCost')
      const other = zoneIds(await stateOf(you), you, 'Hand').find((id) => id !== found.offer.card)
      await expect(engine.call('act', { index: found.offer.index, cost: [other] })).rejects.toThrow(/That offer has no cost to choose anything for\./)
      found = await until(found.status, (s) => s.actions.find((a) => a.type === 'ActivateAbility' && a.additionalCost === 'SacrificeSelf' && a.affordable))
      expect(found.offer).toMatchObject({ additionalCostText: 'Sacrifice this permanent', requiresTargets: true })
      expect(found.offer).not.toHaveProperty('costChoice')
      await expect(engine.call('act', { index: found.offer.index, cost: [found.offer.card] })).rejects.toThrow(/This protocol cannot pay a SacrificeSelf cost with a choice; ask the engine to choose\./)
      // And the Bowman is still on the battlefield: nothing was sent.
      expect(zoneIds(await stateOf(you), you, 'Battlefield')).toContain(found.offer.card)
    }, 180_000)

    it('lets the engine choose a play\'s targets for the person, when asked to', async () => {
      let status = await engine.call('new', {
        players: [{ name: 'You', deck, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck, ai: 'heuristic' }],
        seed: 1,
      })
      const you = status.seats[0].id
      const found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Volcanic Hammer' && a.affordable))
      status = await engine.call('act', { index: found.offer.index, auto: true })
      status = await resolve(status, you)
      const state = await stateOf(you)
      expect(zoneIds(state, you, 'Graveyard').map((id) => state.cards[id].name)).toContain('Volcanic Hammer')
    }, 120_000)

    it('asks the person which card to discard at cleanup when their client can show it, and answers it for them when not', async () => {
      // 514.1: the active player discards down to their maximum hand size. A
      // deck of Hill Giants and nothing to cast them with holds eight cards at
      // the end of its second turn.
      const giants = { 'Hill Giant': 40 }
      let status = await engine.call('new', {
        players: [{ name: 'You', deck: giants, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck: { Mountain: 40 }, ai: 'heuristic' }],
        seed: 1,
      })
      const you = status.seats[0].id
      for (let i = 0; i < 20 && status.waiting === 'action'; i++) status = await engine.call('act', { index: passOf(status).index })
      expect(status.waiting).toBe('decision')
      expect(status.decision).toMatchObject({ type: 'SelectCards', player: you, min: 1, max: 1 })
      expect(status.decision.prompt).toMatch(/Discard down to 7/)
      const drop = status.decision.options[0]
      status = await engine.call('decide', { cards: [drop] })
      expect(zoneIds(await stateOf(you), you, 'Graveyard')).toEqual([drop])
      expect(status.decided).toEqual([])

      // The same seat whose client said nothing: the engine discards for them,
      // and says so, as every engine before protocol 5 did.
      status = await engine.call('new', {
        players: [{ name: 'You', deck: giants, autoPass: true }, { name: 'Bot', deck: { Mountain: 40 }, ai: 'heuristic' }],
        seed: 1,
      })
      expect(status.seats[0].asked).toEqual(['ChooseTargets', 'YesNo', 'ChooseOption'])
      expect(status.decided.some((d) => d.type === 'SelectCards' && /Discard down to 7/.test(d.prompt))).toBe(true)
    }, 120_000)

    it('asks what to put on the bottom and then the order of the rest, for a scry', async () => {
      // Magma Jet: 2 damage to any target, then scry 2 — Argentum asks which of
      // the two go to the bottom, then the order of those left on top.
      let status = await engine.call('new', {
        players: [{ name: 'You', deck: { Mountain: 20, 'Magma Jet': 20 }, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck: { Mountain: 40 }, ai: 'heuristic' }],
        seed: 1,
      })
      const [you, bot] = status.seats.map((s) => s.id)
      const found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Magma Jet' && a.affordable))
      status = await engine.call('act', { index: found.offer.index, targets: { 0: [bot] } })
      expect(status.decision).toMatchObject({ type: 'SelectCards', min: 0, max: 2, selectedLabel: 'Put on bottom', remainderLabel: 'Put on top' })
      // The cards looked at have their names in the decision: the view does not show a library.
      expect(Object.keys(status.decision.cards).sort()).toEqual([...status.decision.options].sort())
      status = await engine.call('decide', { cards: [] })
      // Going back on top of the person's own library, the first card first.
      expect(status.decision).toMatchObject({ type: 'ReorderLibrary', placement: 'top', library: you })
      expect(status.decision.objects).toHaveLength(2)
      status = await engine.call('decide', { order: [...status.decision.objects].reverse() })
      expect(status.waiting).not.toBe('decision')
      expect(status.decided).toEqual([])
    }, 120_000)

    it('says when the cards being ordered go to the bottom of the library, which Argentum asks the same way as the top', async () => {
      // Prophetic Bolt: 4 damage, then one of the top four into the hand and
      // the rest on the bottom in any order (`lookAtTopAndKeep`). The order is
      // a ReorderLibrary like a scry's, and its first card is not the top of
      // anything (found in M4's review, where the prompt said it was).
      let status = await engine.call('new', {
        players: [{ name: 'You', deck: { Island: 12, Mountain: 12, 'Prophetic Bolt': 16 }, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck: { Mountain: 40 }, ai: 'heuristic' }],
        seed: 1,
      })
      const [you, bot] = status.seats.map((s) => s.id)
      const found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Prophetic Bolt' && a.affordable), { steps: 600 })
      expect(found.offer).toBeTruthy()
      status = await engine.call('act', { index: found.offer.index, targets: { 0: [bot] } })
      for (let i = 0; i < 4 && status.decision?.type === 'SelectCards'; i++) status = await engine.call('decide', { cards: status.decision.options.slice(0, status.decision.min || 1) })
      expect(status.decision).toMatchObject({ type: 'ReorderLibrary', placement: 'bottom', library: you })
      expect(status.decision.objects).toHaveLength(3)
      status = await engine.call('decide', { order: status.decision.objects })
      expect(status.waiting).not.toBe('decision')
      expect(status.decided).toEqual([])
    }, 180_000)

    it('asks the attacking player how to divide combat damage among blockers, and deals it that way', async () => {
      // Two people, neither the engine: a Hill Giant (3/3) attacks and is
      // blocked by two Raging Goblins (1/1), so it has damage to divide
      // (510.1c). Argentum asks it as one board for the step, its own split
      // already in it; this seat gives all three to the first goblin and none
      // to the second, which lives. A split that killed both would prove
      // nothing: the engine's own kills both too, and so does any answer that
      // was dropped for it (found in M4's review).
      const ALL = { autoPass: true, answers: ANSWERS }
      let status = await engine.call('new', {
        players: [{ name: 'A', deck: { Mountain: 20, 'Hill Giant': 20 }, ...ALL }, { name: 'B', deck: { Mountain: 20, 'Raging Goblin': 20 }, ...ALL }],
        seed: 1,
      })
      const [a, b] = status.seats.map((s) => s.id)
      let board = null
      for (let i = 0; i < 400 && !status.over && !board; i++) {
        if (status.waiting === 'decision') {
          if (status.decision.type === 'CombatResolution') { board = status.decision; break }
          status = await engine.call('decide', { auto: true }); continue
        }
        if (status.waiting !== 'action') break
        const land = status.actions.find((x) => x.type === 'PlayLand')
        const cast = status.actions.find((x) => x.type === 'CastSpell' && x.affordable)
        const attack = status.actions.find((x) => x.type === 'DeclareAttackers')
        const block = status.actions.find((x) => x.type === 'DeclareBlockers')
        if (land) status = await engine.call('act', { index: land.index })
        else if (cast) status = await engine.call('act', { index: cast.index })
        else if (attack) {
          // B's goblins never attack; A's giant attacks once there are goblins to block it.
          const giant = status.actor === a && status.turn >= 9 ? attack.validAttackers?.[0] : null
          status = await engine.call('act', { index: attack.index, attackers: giant ? { [giant]: b } : {} })
        } else if (block) {
          const attacker = (await stateOf(b)).combat.attackers[0].creatureId
          status = await engine.call('act', { index: block.index, blockers: Object.fromEntries(block.validBlockers.slice(0, 2).map((id) => [id, [attacker]])) })
        } else status = await engine.call('act', { index: passOf(status).index })
      }
      expect(board).toBeTruthy()
      expect(board.player).toBe(a)
      const mine = board.edges.filter((e) => e.mine)
      expect(mine).toHaveLength(2)
      expect(board.attackers[0]).toMatchObject({ name: 'Hill Giant', power: 3 })
      const blockers = mine.map((e) => e.target)
      status = await engine.call('decide', { edges: { [mine[0].id]: 3, [mine[1].id]: 0 } })
      const field = zoneIds(await stateOf(b), b, 'Battlefield')
      expect(blockers.filter((id) => field.includes(id))).toEqual([mine[1].target])
      // And nothing was answered for the seat on the way.
      expect(status.decided).toEqual([])
    }, 180_000)

    it('refuses targets it would read in the wrong order, or for a requirement the play has not got, rather than cast at what nobody chose', async () => {
      // Argentum reads a play's targets by position. A requirement given fewer
      // than it could take, with a target for a later one, would be read wrong;
      // the process says so. Boulder Dash has two requirements, two damage to
      // one target and one to another. Left out altogether, the first counts as
      // given none (found in M4's review: only the keys sent were walked, and a
      // lone "1" went to Argentum flat, as the first requirement's).
      let status = await engine.call('new', {
        players: [{ name: 'You', deck: { Mountain: 24, 'Boulder Dash': 16 }, autoPass: true, answers: ANSWERS }, { name: 'Bot', deck: { Mountain: 40 }, ai: 'heuristic' }],
        seed: 2,
      })
      const [you, bot] = status.seats.map((s) => s.id)
      const found = await until(status, (s) => s.actions.find((a) => a.description === 'Cast Boulder Dash' && a.affordable))
      expect(found.offer.targetRequirements.map((r) => [r.index, r.min, r.max])).toEqual([[0, 1, 1], [1, 1, 1]])
      await expect(engine.call('act', { index: found.offer.index, targets: { 1: [you] } })).rejects.toThrow(/reads a play's targets in order/)
      await expect(engine.call('act', { index: found.offer.index, targets: { 0: [], 1: [you] } })).rejects.toThrow(/reads a play's targets in order/)
      // A requirement the play has not got is refused by its number, not read as another's.
      await expect(engine.call('act', { index: found.offer.index, targets: { 0: [bot], 2: [you] } })).rejects.toThrow(/This play has no target requirement "2"; it has "0", "1"\./)
      await expect(engine.call('act', { index: found.offer.index, targets: { 0: [bot], first: [you] } })).rejects.toThrow(/no target requirement "first"/)
      // Given in order, each target takes what its requirement deals.
      const before = await lives(you)
      status = await engine.call('act', { index: found.offer.index, targets: { 0: [bot], 1: [you] } })
      status = await resolve(status, you)
      const after = await lives(you)
      expect(after[bot]).toBe(before[bot] - 2)
      expect(after[you]).toBe(before[you] - 1)
    }, 120_000)
  })

  describe('the opening hand (protocol 6)', () => {
    const view = (who) => engine.call('view', { viewer: who })
    const zoneOf = (state, owner, type) => state.zones.find((z) => z.zoneId.zoneType === type && z.zoneId.ownerId === owner)
    const offer = (status, type) => status.actions?.find((a) => a.type === type) ?? null
    const players = [{ name: 'You', deck, autoPass: true }, { name: 'Bot', deck, ai: 'heuristic', level: 'easy' }]

    it('opens with the hand to keep, where asked, and deals a mulligan as Argentum does: seven again, one on the bottom, six kept', async () => {
      let status = await engine.call('new', { players, seed: 1, mulligans: true })
      expect(status.mulligans).toBe(true)
      const [you, bot] = status.seats.map((s) => s.id)
      // Before the first turn, and nothing on offer but the hand: Argentum's
      // legal actions know nothing of the mulligan phase, and asked, would
      // offer a spell in the untap step.
      expect(status).toMatchObject({ waiting: 'action', actor: you, turn: 1, phase: 'BEGINNING', step: 'UNTAP' })
      expect(status.actions.map((a) => a.type)).toEqual(['KeepHand', 'TakeMulligan'])
      expect(offer(status, 'KeepHand')).toMatchObject({ mulligans: 0, bottom: 0, affordable: true, meaningful: true })
      expect(offer(status, 'TakeMulligan')).toMatchObject({ mulligans: 0, draws: 7, bottom: 1 })
      expect(zoneOf((await view(you)).state, you, 'Hand').cardIds).toHaveLength(7)

      status = await engine.call('act', { index: offer(status, 'TakeMulligan').index })
      expect(offer(status, 'KeepHand')).toMatchObject({ mulligans: 1, bottom: 1 })
      expect(offer(status, 'TakeMulligan')).toMatchObject({ mulligans: 1, draws: 7, bottom: 2 })
      // Seven again, not six: the London mulligan bottoms after keeping (Argentum's MulliganHandler).
      const before = (await view(you)).state
      const drawn = zoneOf(before, you, 'Hand').cardIds
      expect(drawn).toHaveLength(7)

      status = await engine.call('act', { index: offer(status, 'KeepHand').index })
      expect(status.actions.map((a) => a.type)).toEqual(['BottomCards'])
      const bottom = offer(status, 'BottomCards')
      expect(bottom).toMatchObject({ mulligans: 1, bottom: 1, description: 'Put 1 card on the bottom of your library' })
      expect([...bottom.candidates].sort()).toEqual([...drawn].sort())
      // Sent bare, or short, it is refused in words and the table stays where it was.
      await expect(engine.call('act', { index: bottom.index })).rejects.toThrow(/needs "cards"/)
      await expect(engine.call('act', { index: bottom.index, cards: [] })).rejects.toThrow(/Put exactly 1 on the bottom: 0 were chosen\./)
      const card = bottom.candidates[0]
      const name = before.cards[card].name
      status = await engine.call('act', { index: bottom.index, cards: [card] })

      // The game has begun, at the person's first stop, with six in hand.
      expect(status.waiting).toBe('action')
      expect(status.actions.some((a) => ['KeepHand', 'TakeMulligan', 'BottomCards'].includes(a.type))).toBe(false)
      const { state, log } = await view(you)
      expect(zoneOf(state, you, 'Hand').cardIds).toHaveLength(6)
      expect(zoneOf(state, you, 'Hand').cardIds).not.toContain(card)
      expect(zoneOf(state, you, 'Library').size).toBe(Object.values(deck).reduce((a, b) => a + b, 0) - 6)
      // Said once as the mulligan it was, not as seven cards put away, and the
      // card bottomed named to its owner alone.
      const said = log.map((l) => l.description)
      expect(said.filter((d) => d === 'You took a mulligan')).toHaveLength(1)
      expect(said).toContain(`You put ${name} on the bottom of your library`)
      expect(said.some((d) => /went to library/.test(d))).toBe(false)
      const theirs = (await view(bot)).log.map((l) => l.description)
      expect(theirs).toContain('Opponent took a mulligan')
      expect(theirs.some((d) => /bottom/.test(d))).toBe(false)
    }, 120_000)

    it('takes each card on the bottom once, and exactly as many as are owed, or none of them', async () => {
      // Argentum counts the cards and checks each is in hand, and no more: two
      // owed and one card named twice passed, moved one card, and settled the
      // mulligan with a card kept that was owed (found in M4's review).
      let status = await engine.call('new', { players, seed: 1, mulligans: true })
      const you = status.seats[0].id
      status = await engine.call('act', { index: offer(status, 'TakeMulligan').index })
      status = await engine.call('act', { index: offer(status, 'TakeMulligan').index })
      status = await engine.call('act', { index: offer(status, 'KeepHand').index })
      const bottom = offer(status, 'BottomCards')
      expect(bottom).toMatchObject({ mulligans: 2, bottom: 2 })
      const [first, second] = bottom.candidates
      await expect(engine.call('act', { index: bottom.index, cards: [first, first] })).rejects.toThrow(/Each card goes on the bottom once/)
      await expect(engine.call('act', { index: bottom.index, cards: [first] })).rejects.toThrow(/Put exactly 2 on the bottom: 1 was chosen\./)
      await expect(engine.call('act', { index: bottom.index, cards: [first, second, bottom.candidates[2]] })).rejects.toThrow(/Put exactly 2 on the bottom: 3 were chosen\./)
      // Refused, the hand is as it was and the same offer is still there.
      expect(zoneOf((await view(you)).state, you, 'Hand').cardIds).toHaveLength(7)
      status = await engine.call('turn')
      expect(offer(status, 'BottomCards')).toMatchObject({ bottom: 2 })
      status = await engine.call('act', { index: bottom.index, cards: [first, second] })
      const hand = zoneOf((await view(you)).state, you, 'Hand').cardIds
      expect(hand).toHaveLength(5)
      expect(hand).not.toContain(first)
      expect(hand).not.toContain(second)
    }, 120_000)

    it('puts on the bottom what the engine picks, when the person asks it to choose', async () => {
      let status = await engine.call('new', { players, seed: 1, mulligans: true })
      const you = status.seats[0].id
      status = await engine.call('act', { index: offer(status, 'TakeMulligan').index })
      status = await engine.call('act', { index: offer(status, 'KeepHand').index })
      status = await engine.call('act', { index: offer(status, 'BottomCards').index, auto: true })
      const { state, log } = await view(you)
      expect(zoneOf(state, you, 'Hand').cardIds).toHaveLength(6)
      expect(log.filter((l) => /^You put .+ on the bottom of your library$/.test(l.description))).toHaveLength(1)
    }, 120_000)

    it('mulligans the engine\'s own seat by Argentum\'s responder, and tells the person so without naming what it bottoms', async () => {
      // Seed 25 with the engine first deals it a hand of one land, which
      // Argentum's responder (EngineAiPlayerController) sends back; its next
      // seven it keeps, and bottoms one (measured 2026-09-24).
      let status = await engine.call('new', { players, seed: 25, mulligans: true, startingPlayer: 1 })
      const [you, bot] = status.seats.map((s) => s.id)
      expect(status.actor).toBe(you)
      expect((await view(you)).log.map((l) => l.description)).toContain('Opponent took a mulligan')
      status = await engine.call('act', { index: offer(status, 'KeepHand').index })
      const theirs = (await view(bot)).log.map((l) => l.description)
      expect(theirs).toContain('You took a mulligan')
      expect(theirs.filter((d) => /^You put .+ on the bottom of your library$/.test(d))).toHaveLength(1)
      expect((await view(you)).log.some((l) => /bottom/.test(l.description))).toBe(false)
    }, 120_000)

    it('deals every hand kept where not asked, and everyone keeping plays the very game that would have been played', async () => {
      // What the engine's browser spec leans on: a seeded game is the same game
      // whether it opened with the hands to keep or not, so long as both keep.
      const playOut = async (mulligans) => {
        let status = await engine.call('new', { players, seed: 1, ...(mulligans ? { mulligans: true } : {}) })
        const course = []
        for (let stops = 0; !status.over && stops < 300; stops++) {
          if (status.waiting === 'decision') { status = await engine.call('decide', { auto: true }); continue }
          if (status.waiting !== 'action') { status = await engine.call('turn'); continue }
          const keep = offer(status, 'KeepHand')
          if (keep) { status = await engine.call('act', { index: keep.index }); continue }
          const pick = plainest(status)
          course.push(`${status.turn} ${status.step}: ${pick.description}`)
          status = await engine.call('act', { index: pick.index })
        }
        return { course, winner: status.winner }
      }
      const plain = await playOut(false)
      expect(plain.course[0]).not.toMatch(/Keep/)
      const kept = await playOut(true)
      expect(kept.course).toEqual(plain.course)
      expect(kept.winner).toBe(plain.winner)
    }, 300_000)
  })

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
