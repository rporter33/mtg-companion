/**
 * What the prompt panel says at the engine's table (Table.jsx, `EnginePrompt`
 * and `stopLine`).
 *
 * The prompt is where a stop says what it is for, in words, so that the glow
 * is never the only thing saying it. Rendered first against a stop the engine
 * really made — the captured run's stop for Volcanic Hammer alone, where
 * nothing glows and the sentence is the only reason given — and then against
 * statuses in Server.kt's shape for the cases the capture never reached: an
 * ability whose cost needs a choice, a flashback in the graveyard, a trigger
 * aimed at a card in a pile, and a permanent's ability beside a card in hand.
 * The offers for the Gecko and the flashback are as the live engine sent them
 * on 2026-09-24.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { EnginePrompt, placeWords, stopLine } from '../src/features/game/Table.jsx'
import { applyDelta, boardFromView } from '../src/lib/engine/board.js'
import { glowsAt, offeredElsewhere, GLOW_SAYS } from '../src/lib/engine/glow.js'
import { STEPS } from '../src/data/turn-structure.js'
// Imported rather than read off disk: this file runs in a browser-shaped environment.
import FIXTURE from './fixtures/engine-views.json'

const RUN = FIXTURE.run
const YOU = RUN.you
const THEM = 'e1'

/** Every stop of the captured run, with the engine's view and the board drawn from it. */
const stops = (() => {
  const out = []
  let view = null
  let board = null
  for (const entry of RUN.views) {
    view = entry.delta ? applyDelta(view, entry.delta, { log: entry.log }) : { ...entry.state, log: entry.fullLog }
    board = boardFromView(view, { prev: board })
    out.push({ status: entry.status, view, board })
  }
  return out
})()

let root = null
let container = null
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  root = null; container = null
})
const render = async (props) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<EnginePrompt step={STEPS[0]} me={YOU} nameOfSeat={(p) => (p === YOU ? 'You' : 'The engine')} onAct={() => {}} onDecide={() => {}} {...props} />) })
  return container
}

describe('a stop made for a spell that needs a target, and nothing else', () => {
  it('says so in the prompt, in the words the engine\'s own stop earns', async () => {
    const only = stops.find((s) => s.status.waiting === 'action'
      && s.status.actions.filter((a) => a.meaningful && a.affordable).every((a) => a.requiresTargets)
      && s.status.actions.some((a) => a.requiresTargets && a.affordable))
    expect(only, 'the captured run has a stop made for Volcanic Hammer alone').toBeTruthy()
    const zoneOf = (id) => only.board.cards[id]?.zone
    const glows = glowsAt({ status: only.status, me: YOU, zoneOf })
    expect(glows.size).toBe(0)
    const el = await render({
      status: only.status, glows,
      elsewhere: offeredElsewhere(only.status, zoneOf),
      nameOf: (id) => only.view.cards?.[id]?.name ?? id,
      players: only.board.players,
    })
    expect(el.querySelector('.prompt__sub').textContent).toBe('Volcanic Hammer needs a target, which this table cannot choose yet. Pass to go on.')
    expect(el.querySelector('[aria-label="Your stop"]')).toBeTruthy()
    expect(el.querySelector('button').textContent).toMatch(/^Pass →/)
  })
})

describe('what a stop is for', () => {
  const pass = { index: 0, type: 'PassPriority', description: 'Pass priority', affordable: true, meaningful: false }
  const names = { e20: 'Mountain', e21: 'Raging Goblin', e27: 'Think Twice', e30: 'Flamecache Gecko', e31: 'Prodigal Pyromancer' }
  const nameOf = (id) => names[id] ?? id
  const line = (actions, { glows = new Map(), zones = {}, owners = {} } = {}) => {
    const status = { actor: YOU, waiting: 'action', actions: [pass, ...actions] }
    const zoneOf = (id) => zones[id]
    return stopLine({
      status, me: YOU, glows, nameOf,
      elsewhere: offeredElsewhere(status, zoneOf),
      placeOf: (id) => (zones[id] ? { zone: zones[id], owner: owners[id] ?? YOU } : null),
      nameOfSeat: (p) => (p === YOU ? 'You' : 'The engine'),
    })
  }
  const play = { kind: 'playable', says: GLOW_SAYS.play }
  const use = { kind: 'playable', says: GLOW_SAYS.ability }

  it('names a card in hand as one you can play, as before', () => {
    expect(line([], { glows: new Map([['e20', play]]) })).toBe('The card you can play glows. Tap it, or pass.')
    expect(line([], { glows: new Map([['e20', play], ['e21', play], ['e22', play]]) })).toBe('The 3 cards you can play glow. Tap one, or pass.')
  })

  it('does not call a permanent\'s ability a card you can play', () => {
    // Found in M3's review: an ability alone lit, the prompt said "The card you
    // can play glows" while the card's own label said an ability could be used.
    expect(line([], { glows: new Map([['e31', use]]) })).toBe('The permanent with an ability you can use glows. Tap it, or pass.')
    expect(line([], { glows: new Map([['e20', play], ['e31', use]]) })).toBe('The card you can play and the permanent with an ability you can use glow. Tap one, or pass.')
    expect(line([], { glows: new Map([['e20', play], ['e21', play], ['e31', use], ['e32', use]]) }))
      .toBe('The 2 cards you can play and the 2 permanents with abilities you can use glow. Tap one, or pass.')
  })

  const flashback = { index: 4, type: 'CastWithFlashback', description: 'Cast Think Twice (Flashback)', card: 'e27', affordable: true, meaningful: true, manaCost: '{2}{U}', requiresTargets: false }

  it('names a play from the graveyard, where nothing glows, rather than say there is nothing to do', () => {
    // Found in M3's review: a stop made only for a flashback said "Nothing to do here but pass."
    expect(line([flashback], { zones: { e27: 'graveyard' } })).toBe('You can play Think Twice from your graveyard: find it under Actions, or pass.')
    expect(line([flashback], { zones: { e27: 'exile' } })).toBe('You can play Think Twice from exile: find it under Actions, or pass.')
  })

  it('and beside what glows, as something more', () => {
    expect(line([flashback], { glows: new Map([['e20', play]]), zones: { e27: 'graveyard', e20: 'hand' } }))
      .toBe('The card you can play glows. Tap it, or pass. You can also play Think Twice from your graveyard: find it under Actions.')
  })

  it('names a stop made for an ability whose cost needs a choice, and why nothing glows', () => {
    const gecko = { index: 3, type: 'ActivateAbility', description: '{1}{R}, Discard a card: Draw a card', card: 'e30', affordable: true, meaningful: true, manaCost: '{1}{R}', requiresTargets: false, additionalCost: 'DiscardCard', additionalCostText: 'Discard a card' }
    expect(line([gecko], { zones: { e30: 'battlefield' } })).toBe('Flamecache Gecko needs a choice made for its cost, which this table cannot make yet. Pass to go on.')
  })

  it('says there is nothing to do only when there is nothing', () => {
    expect(line([])).toBe('Nothing to do here but pass.')
    expect(line([{ index: 5, type: 'Special', description: 'Turn a face-down creature up', affordable: true, meaningful: true }])).toBe('Something is offered under Actions, or pass.')
  })
})

describe('a target being chosen, and where the targets are', () => {
  const decision = (legal, source = 'Gravedigger') => ({
    actor: YOU, waiting: 'decision',
    decision: { id: 'd1', type: 'ChooseTargets', player: YOU, prompt: `Choose targets for ${source}`, source, requirements: [{ index: 0, description: 'target creature card in your graveyard', min: 1, max: 1, legal }] },
  })
  const places = { e40: { zone: 'graveyard', owner: YOU }, e41: { zone: 'graveyard', owner: THEM }, e42: { zone: 'battlefield', owner: THEM }, e43: { zone: 'stack', owner: YOU } }
  const sub = async (status) => {
    const el = await render({ status, players: [YOU, THEM], placeOf: (id) => places[id] ?? null, nameOf: (id) => id })
    return el.querySelector('.prompt__sub').textContent
  }

  it('says they glow where they are in sight', async () => {
    expect(await sub(decision(['e42'], 'Sparkmage Apprentice'))).toBe('Tap what Sparkmage Apprentice is aimed at: the legal targets glow.')
  })

  it('says where they are when they are in a pile, rather than promise a glow nobody can see', async () => {
    // Found in M3's review: Gravedigger's trigger said "the legal targets glow"
    // over a table where nothing did.
    expect(await sub(decision(['e40']))).toBe('Tap what Gravedigger is aimed at: the legal targets are in your graveyard — open it to tap one.')
    expect(await sub(decision(['e40', 'e41']))).toBe('Tap what Gravedigger is aimed at: the legal targets are in your graveyard and in the engine\'s graveyard — open them to tap one.')
    expect(await sub(decision(['e42', 'e40']))).toBe('Tap what Gravedigger is aimed at: the legal targets glow, and some are in your graveyard — open it to tap one.')
    expect(await sub(decision(['e43'], 'Mystic Snake'))).toBe('Tap what Mystic Snake is aimed at: the legal targets are on the stack — tap one there.')
  })
})

describe('where a card is, in words', () => {
  const seat = (p) => (p === YOU ? 'You' : 'The engine')
  it('says nothing of a card already in sight, or one the board cannot place', () => {
    expect(placeWords({ zone: 'hand', owner: YOU }, YOU, seat)).toBeNull()
    expect(placeWords({ zone: 'battlefield', owner: THEM }, YOU, seat)).toBeNull()
    expect(placeWords(null, YOU, seat)).toBeNull()
  })
  it('and whose pile it is in, where a pile has an owner', () => {
    expect(placeWords({ zone: 'graveyard', owner: YOU }, YOU, seat)).toBe('in your graveyard')
    expect(placeWords({ zone: 'graveyard', owner: THEM }, YOU, seat)).toBe("in the engine's graveyard")
    expect(placeWords({ zone: 'exile', owner: THEM }, YOU, seat)).toBe('in exile')
    expect(placeWords({ zone: 'command', owner: YOU }, YOU, seat)).toBe('in the command zone')
    expect(placeWords({ zone: 'stack', owner: THEM }, YOU, seat)).toBe('on the stack')
  })
})
