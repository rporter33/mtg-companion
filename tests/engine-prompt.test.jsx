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
 * on 2026-09-24. Since M4's capture the run also holds the opening hand and a
 * targets decision, and the prompt is rendered against those as sent.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { EnginePrompt, placeWords, stopLine } from '../src/features/game/Table.jsx'
import { Teaching } from '../src/features/game/EnginePrompt.jsx'
import { applyDelta, boardFromView } from '../src/lib/engine/board.js'
import { glowsAt, offeredElsewhere, GLOW_SAYS } from '../src/lib/engine/glow.js'
import { STEPS } from '../src/data/turn-structure.js'
import PaceChoice from '../src/features/game/PaceChoice.jsx'
import { PAYING_LINE, PRESET_LINES, STACK_LINE, chosenPace, fixedLine } from '../src/lib/engine/pace.js'
import { TURN_PANEL_LINE, teachingFor } from '../src/lib/engine/teach.js'
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

describe('the captured run\'s opening hand and its targets decision (M4)', () => {
  const inHand = (s) => (id) => (s.board.cards[id] ? { zone: s.board.cards[id].zone, owner: s.board.cards[id].owner ?? null } : null)

  it('asks to keep the hand the engine dealt, in the engine\'s numbers, and sends the offer pressed', async () => {
    const first = stops[0]
    const hand = first.board.zones[YOU].hand.length
    const sent = []
    const el = await render({ status: first.status, handSize: hand, active: first.board.active, players: first.board.players, onAct: (index) => sent.push(index) })
    expect(el.querySelector('.prompt').getAttribute('aria-label')).toBe('Your opening hand')
    expect(el.querySelector('.prompt__sub').textContent).toBe(`${hand} cards. ${first.board.active === YOU ? 'You play first, so you skip your first draw (103.8a).' : 'The engine plays first.'} Or take a mulligan: the hand goes back, your library is shuffled and you draw 7, then put 1 on the bottom once you keep. This is the London mulligan (103.5).`)
    const take = [...el.querySelectorAll('button')].find((b) => b.textContent.startsWith('Mulligan'))
    await act(async () => { take.click() })
    expect(sent).toEqual([first.status.actions.find((a) => a.type === 'TakeMulligan').index])
  })

  it('asks for the card to put on the bottom from the hand the view shows, counting down', async () => {
    const at = stops.find((s) => s.status.actions?.some((a) => a.type === 'BottomCards'))
    const el = await render({ status: at.status, placeOf: inHand(at), players: at.board.players })
    expect(el.querySelector('.prompt__title').textContent).toBe('Put 1 card on the bottom of your library')
    expect(el.querySelector('.prompt__sub').textContent).toBe('Tap the card to put on the bottom of your library, for the mulligan you took. The cards in your hand glow. 1 more to choose.')
  })

  it('asks where Sparkmage Apprentice is aimed, rendered from the status alone, the seats offered by name', async () => {
    const at = stops.find((s) => s.status.waiting === 'decision' && s.status.decision?.type === 'ChooseTargets')
    const el = await render({ status: at.status, placeOf: inHand(at), players: at.board.players, nameOf: (id) => at.view.cards?.[id]?.name ?? id })
    expect(el.querySelector('.prompt__title').textContent).toBe('Choose targets for Sparkmage Apprentice')
    expect(el.querySelector('.prompt__sub').textContent).toBe('Tap what Sparkmage Apprentice is aimed at: the legal targets glow.')
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Aim at yourself', 'Aim at the engine', 'Let the engine chooseIt will say what it chose'])
  })
})

describe('what the step is for, where the person asked for the steps to be explained (§3 item 24)', () => {
  // An empty window at the engine's upkeep, as a table stopped at every window is offered one.
  const window = { stop: 4, turn: 2, phase: 'BEGINNING', step: 'UPKEEP', actor: YOU, waiting: 'action', actions: [{ index: 0, type: 'PassPriority', description: 'Pass priority', affordable: true, meaningful: false }], autoPassed: 0, decided: [] }
  const upkeep = STEPS.find((s) => s.id === 'upkeep')

  it('is said under the prompt\'s own words where the turn panel stands beside it: the head, and where to look for the rest', async () => {
    const el = await render({ status: window, step: upkeep, teach: teachingFor('upkeep'), active: YOU })
    expect(el.querySelector('.prompt__title').textContent).toBe('Upkeep')
    expect(el.querySelector('.prompt__sub').textContent).toBe('Nothing to do here but pass.')
    // The upkeep has no note of its own, and what happens in it is the turn panel's, beside.
    expect(el.querySelector('.prompt__teach').textContent).toBe(`Beginning phase · Upkeep (503.) ${TURN_PANEL_LINE}`)
    // The pass is still the one thing to press.
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Pass →or press Space'])
  })

  it('is said at an attack too, the step\'s note alone, and not at all where nobody asked for it', async () => {
    const attack = stops.find((s) => s.status.actions?.some((a) => a.type === 'DeclareAttackers' && a.meaningful))
    const declaring = attack.status.actions.find((a) => a.type === 'DeclareAttackers')
    const el = await render({ status: attack.status, step: STEPS.find((s) => s.id === 'attackers'), declaring, teach: teachingFor('attackers') })
    expect(el.querySelector('.prompt').getAttribute('aria-label')).toBe('Your attack')
    expect(el.querySelector('.prompt__teach').textContent).toBe('Combat phase · Declare attackers (508.) If nothing attacks, declare blockers and combat damage are skipped entirely.')
    await act(async () => { root.unmount() })
    container.remove()
    root = null
    const plain = await render({ status: window, step: upkeep })
    expect(plain.querySelector('.prompt__teach')).toBeNull()
  })

  it('is said whole where it stands under the battlefield, the note first', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<Teaching teach={teachingFor('attackers')} className="game__teach" />) })
    const said = container.querySelector('.game__teach.teaching')
    expect(said.tagName).toBe('P')
    expect(said.textContent).toBe('Combat phase · Declare attackers (508.) If nothing attacks, declare blockers and combat damage are skipped entirely. The active player declares attackers, and what each is attacking. (508.1)')
  })
})

describe('a stop in the engine\'s turn, for a person stopped at every window (review of §3 item 24)', () => {
  const theirUpkeep = { stop: 9, turn: 2, phase: 'BEGINNING', step: 'UPKEEP', actor: YOU, waiting: 'action', actions: [{ index: 0, type: 'PassPriority', description: 'Pass priority', affordable: true, meaningful: false }], autoPassed: 0, decided: [] }
  const upkeep = STEPS.find((s) => s.id === 'upkeep')

  it('says whose turn it is, as the log says the step, and its button is Done', async () => {
    const el = await render({ status: theirUpkeep, step: upkeep, active: THEM })
    expect(el.querySelector('.prompt__title').textContent).toBe('The engine\'s upkeep')
    expect(el.querySelector('.prompt').getAttribute('aria-label')).toBe('The engine\'s upkeep')
    const done = el.querySelector('.prompt button')
    expect(done.textContent).toBe('Done →or press Space')
    expect(done.getAttribute('aria-keyshortcuts')).toBe('Space')
  })

  it('and in the person\'s own turn is the step and Pass, as before', async () => {
    const el = await render({ status: theirUpkeep, step: upkeep, active: YOU })
    expect(el.querySelector('.prompt__title').textContent).toBe('Upkeep')
    expect(el.querySelector('.prompt').getAttribute('aria-label')).toBe('Your stop')
    expect(el.querySelector('.prompt button').textContent).toBe('Pass →or press Space')
  })
})

describe('the choice of how to play (§3 item 24)', () => {
  const mountChoice = async (props) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const chosen = []
    await act(async () => { root.render(<PaceChoice pace={chosenPace(undefined)} onChoose={(c) => chosen.push(c)} {...props} />) })
    return { el: container, chosen }
  }
  const unmount = async () => { await act(async () => { root.unmount() }); container.remove(); root = null }
  const radios = (el) => [...el.querySelectorAll('input[type="radio"]')]
  const labelOf = (input) => input.closest('label').textContent

  it('asks, the first time, with Fast chosen and the other two a tap away, and a button that names what it plays', async () => {
    const done = []
    const { el, chosen } = await mountChoice({ first: true, onDone: () => done.push(true) })
    expect(el.querySelector('section').getAttribute('aria-labelledby')).toBe(el.querySelector('h2').id)
    expect(el.querySelector('h2').textContent).toBe('How do you want to play?')
    const presets = radios(el).slice(0, 3)
    expect(presets.map(labelOf)).toEqual([
      `FastKeep it moving${PRESET_LINES.fast}Fewer stops`,
      `ControlledSee every window${PRESET_LINES.controlled}More passing`,
      `LearningExplain as you go${PRESET_LINES.learning}Steps explained`,
    ])
    // Fast, the owner's choice since 2026-09-26 (HANDOFF.md §3 item 24), and the words say so.
    expect(presets.map((r) => r.checked)).toEqual([true, false, false])
    expect(el.querySelector('section > p').textContent).toMatch(/^Asked once\. Fast is chosen until you pick another,/)
    // Each radio is named by its preset and tagline, and described by what it does.
    const words = (r, attr) => r.getAttribute(attr).split(' ').map((id) => document.getElementById(id).textContent).join(' ')
    expect(presets.map((r) => words(r, 'aria-labelledby'))).toEqual(['Fast Keep it moving', 'Controlled See every window', 'Learning Explain as you go'])
    expect(words(presets[1], 'aria-describedby')).toBe(`${PRESET_LINES.controlled} More passing`)
    await act(async () => { presets[1].click() })
    expect(chosen).toEqual([{ preset: 'controlled' }])
    const play = [...el.querySelectorAll('button')].find((b) => b.textContent.startsWith('Play'))
    expect(play.textContent).toBe('Play Fast →')
    await act(async () => { play.click() })
    expect(done).toEqual([true])
  })

  it('shows under Advanced the settings the preset sets, which may be changed one at a time, and what no preset can set', async () => {
    const { el, chosen } = await mountChoice({ pace: chosenPace({ preset: 'learning' }) })
    const more = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Advanced'))
    const advanced = document.getElementById(more.getAttribute('aria-controls'))
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(advanced.hidden).toBe(true)
    await act(async () => { more.click() })
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(advanced.hidden).toBe(false)
    expect([...advanced.querySelectorAll('legend')].map((l) => l.textContent)).toEqual(['Where the game stops for you', 'How long each of the engine’s plays stands', 'What each step is for'])
    const on = [...advanced.querySelectorAll('input:checked')].map(labelOf)
    expect(on[0]).toMatch(/^At every window/)
    expect(on[1]).toMatch(/^Relaxed/)
    expect(on[2]).toMatch(/^The first three times/)
    expect(advanced.textContent).toContain(PAYING_LINE)
    // And what every window cannot mean at this table, with the rule it departs from.
    expect(advanced.textContent).toContain(STACK_LINE)
    expect(STACK_LINE.endsWith('(117.4).')).toBe(true)
    expect(advanced.textContent).toContain('this app’s own choices')
    const instant = [...advanced.querySelectorAll('input')].find((r) => labelOf(r).startsWith('Instant'))
    await act(async () => { instant.click() })
    expect(chosen).toEqual([{ speed: 'instant' }])
  })

  it('steps its button back while a stop waits on the person, whose prompt holds the one primary', async () => {
    const quiet = await mountChoice({ first: true, onDone: () => {} })
    const play = () => [...container.querySelectorAll('button')].find((b) => b.textContent.startsWith('Play'))
    expect(play().className).toMatch(/btn--primary/)
    await unmount()
    await mountChoice({ first: true, waiting: true, onDone: () => {} })
    expect(play().className).toMatch(/btn--ghost/)
    expect(play().className).not.toMatch(/btn--primary/)
    expect(quiet.el).toBeTruthy()
  })

  it('opens what each preset does with Advanced, marking itself open for the narrow form to show it', async () => {
    const { el } = await mountChoice({ first: true })
    const section = el.querySelector('section')
    expect(section.classList.contains('pacechoice--open')).toBe(false)
    const more = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Advanced'))
    await act(async () => { more.click() })
    expect(section.classList.contains('pacechoice--open')).toBe(true)
  })

  it('tells the table once, as the first question appears, and only the first question', async () => {
    const shown = []
    await mountChoice({ first: true, onShown: (node) => shown.push(node.tagName) })
    await act(async () => { root.render(<PaceChoice pace={chosenPace({ preset: 'fast' })} first onChoose={() => {}} onShown={(node) => shown.push(node.tagName)} />) })
    expect(shown).toEqual(['SECTION'])
    await unmount()
    await mountChoice({ onShown: (node) => shown.push(node.tagName) })
    expect(shown).toEqual(['SECTION'])
  })

  it('says a mix of the player\'s own as that, with no preset chosen', async () => {
    const { el } = await mountChoice({ pace: chosenPace({ stops: 'playable', speed: 'instant', explain: true }) })
    expect(radios(el).slice(0, 3).some((r) => r.checked)).toBe(false)
    expect(el.querySelector('.pacechoice__own').textContent).toBe('Your own mix: the game stops only where you can play, Instant, and steps explained the first three times.')
  })

  it('says where the table cannot do what is chosen, rather than let the choice look as though it took', async () => {
    const older = await mountChoice({ room: { older: true } })
    expect(older.el.querySelector('.pacechoice__note').textContent).toMatch(/^This relay is older than this choice/)
    await unmount()
    const fixed = await mountChoice({ pace: chosenPace({ preset: 'fast' }), room: { room: { stops: 'every', speed: 'brisk', ms: 600, paced: true, fixed: true } } })
    expect(fixed.el.querySelector('.pacechoice__note').textContent).toBe('This table’s engine cannot change where it stops once the game is dealt, so the game goes on stopping for you at every priority window, both turns, until your next table.')
    await unmount()
    // An engine older than 11 is dealt Law 1 whatever is asked, and Controlled says so.
    const older11 = await mountChoice({ pace: chosenPace({ preset: 'controlled' }), room: { room: { stops: 'playable', speed: 'brisk', ms: 600, paced: true, fixed: true } } })
    expect(older11.el.querySelector('.pacechoice__note').textContent).toBe(fixedLine('playable'))
    expect(fixedLine('playable')).toMatch(/^This table’s engine is older than stopping you at every window/)
    await unmount()
    const unpaced = await mountChoice({ room: { room: { stops: 'every', speed: 'brisk', ms: 0, paced: false, fixed: false } } })
    expect(unpaced.el.querySelector('.pacechoice__note').textContent).toBe('This table plays the engine’s turn in one go, so the speed sets nothing here.')
    await unmount()
    const fine = await mountChoice({ room: { room: { stops: 'every', speed: 'brisk', ms: 600, paced: true, fixed: false } } })
    expect(fine.el.querySelector('.pacechoice__note')).toBeNull()
  })
})
