/**
 * The prompt panel while a person chooses (Table.jsx, `EnginePrompt`, with
 * `ChoosingPrompt` and `DecisionPrompt` inside it; HANDOFF.md, M4).
 *
 * Rendered against the offers and decisions the built engine sent on
 * 2026-09-24 at protocol 5 (the same ones `tests/engine-choose.test.js` reads),
 * and the opening hand's offers at protocol 6, and pressed: what each prompt
 * says, that every one of its answers is a button saying what it does, and
 * what pressing them sends — the `act` or the `decide` Server.kt reads. Every
 * prompt that chooses keeps "Let the engine choose"; keeping a hand or taking
 * a mulligan is a choice of two, and has none.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { EnginePrompt } from '../src/features/game/Table.jsx'
import { ALWAYS_ASKED, ANSWERS, advance, beginPlay, choicesFrom, setX, toggle } from '../src/lib/engine/choose.js'
import { STEPS } from '../src/data/turn-structure.js'

const YOU = 'e0'
const BOT = 'e1'
const CAN = choicesFrom({ choices: { act: ['targets', 'x', 'damage', 'cost', 'auto'], costs: ['DiscardCard'], decisions: [...ALWAYS_ASKED, ...ANSWERS] } })
const NAMES = { e21: 'Raging Goblin', e22: 'Mountain', e29: 'Arc Lightning', e30: 'Volcanic Hammer', e36: 'Blaze', e39: 'Tormenting Voice', e71: 'Raging Goblin', e79: 'Goblin Bully', e27: 'Hill Giant' }
const PLACES = { e21: { zone: 'battlefield', owner: BOT }, e22: { zone: 'hand', owner: YOU }, e30: { zone: 'hand', owner: YOU }, e29: { zone: 'hand', owner: YOU }, e36: { zone: 'hand', owner: YOU }, e39: { zone: 'hand', owner: YOU } }

const HAMMER = { index: 1, type: 'CastSpell', description: 'Cast Volcanic Hammer', card: 'e30', affordable: true, meaningful: true, requiresTargets: true, targetRequirements: [{ index: 0, description: 'any target', min: 1, max: 1, legal: ['e21', YOU, BOT] }] }
const ARC = { index: 1, type: 'CastSpell', description: 'Cast Arc Lightning', card: 'e29', affordable: true, meaningful: true, requiresTargets: true, targetRequirements: [{ index: 0, description: '3 targets', min: 1, max: 3, legal: [YOU, BOT, 'e21'] }], divide: { total: 3, min: 1 } }
const BLAZE = { index: 4, type: 'CastSpell', description: 'Cast Blaze', card: 'e36', affordable: true, meaningful: true, requiresTargets: true, targetRequirements: [{ index: 0, description: 'any target', min: 1, max: 1, legal: [YOU, BOT] }], x: { min: 0, max: 3 } }
const VOICE = { index: 2, type: 'CastSpell', description: 'Cast Tormenting Voice', card: 'e39', affordable: true, meaningful: true, requiresTargets: false, additionalCost: 'DiscardCard', additionalCostText: 'Discard a card', costChoice: { min: 1, max: 1, candidates: ['e22', 'e30'] } }
const stop = (actions) => ({ actor: YOU, waiting: 'action', stop: 3, actions: [{ index: 0, type: 'PassPriority', description: 'Pass priority', affordable: true, meaningful: false }, ...actions] })
const asked = (decision) => ({ actor: YOU, waiting: 'decision', stop: 4, decision: { id: 'r0', player: YOU, ...decision } })

let root = null
let container = null
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  root = null; container = null
})
/** The prompt, with every press it makes written down. */
const render = async (props) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const sent = { acts: [], decides: [], picks: [], done: 0, auto: 0, letGo: 0, changed: [] }
  await act(async () => {
    root.render(
      <EnginePrompt
        step={STEPS[0]} me={YOU} players={[YOU, BOT]} can={CAN}
        nameOf={(id) => NAMES[id] ?? id} nameOfSeat={(p) => (p === YOU ? 'You' : 'The engine')} placeOf={(id) => PLACES[id] ?? null}
        onAct={(index, extra) => sent.acts.push({ index, ...extra })} onDecide={(p) => sent.decides.push(p)}
        onPick={(id) => sent.picks.push(id)} onDone={() => { sent.done++ }} onChooseForMe={() => { sent.auto++ }} onLetGo={() => { sent.letGo++ }}
        onChange={(ch) => sent.changed.push(ch)}
        {...props}
      />,
    )
  })
  return { el: container, sent }
}
const sub = (el) => el.querySelector('.prompt__sub').textContent
const buttons = (el) => [...el.querySelectorAll('button')].map((b) => b.textContent)
const press = async (el, name) => {
  const button = [...el.querySelectorAll('button')].find((b) => b.textContent.startsWith(name) || b.getAttribute('aria-label') === name)
  if (!button) throw new Error(`no button "${name}" among ${buttons(el).join(' | ')}`)
  await act(async () => { button.click() })
}

describe('a play being chosen', () => {
  it('asks where Volcanic Hammer is aimed, with the legal targets glowing and each seat by name', async () => {
    const { el, sent } = await render({ status: stop([HAMMER]), choosing: beginPlay(HAMMER, CAN) })
    expect(el.querySelector('.prompt').getAttribute('aria-label')).toBe('Choosing for Volcanic Hammer')
    expect(el.querySelector('.prompt__title').textContent).toBe('Cast Volcanic Hammer')
    expect(sub(el)).toBe('Tap what Volcanic Hammer is aimed at: the legal targets glow.')
    // One target: a tap is the whole choice, so there is no Done to press.
    expect(buttons(el)).toEqual(['Aim at yourself', 'Aim at the engine', 'Let the engine chooseIt makes every choice for this play', 'Never mind'])
    await press(el, 'Aim at the engine')
    expect(sent.picks).toEqual([BOT])
    await press(el, 'Let the engine choose')
    expect(sent.auto).toBe(1)
    await press(el, 'Never mind')
    expect(sent.letGo).toBe(1)
  })

  it('asks for Blaze\'s X with a number set by buttons that say what they do', async () => {
    const { el, sent } = await render({ status: stop([BLAZE]), choosing: beginPlay(BLAZE, CAN) })
    expect(sub(el)).toBe("Choose X for Blaze: from 0 to 3, which is all this seat's mana can pay for.")
    expect(el.querySelector('output').getAttribute('aria-label')).toBe('X is 3')
    await press(el, 'Lower X')
    expect(sent.changed.at(-1).steps[0].value).toBe(2)
    await press(el, 'X is 3 →')
    expect(sent.done).toBe(1)
  })

  it('asks for Arc Lightning\'s targets and then how its three damage is divided', async () => {
    let ch = beginPlay(ARC, CAN)
    let { el } = await render({ status: stop([ARC]), choosing: toggle(ch, BOT) })
    // Up to three: the count is said, and Done waits for the person.
    expect(sub(el)).toBe('Tap what Arc Lightning is aimed at (3 targets): the legal targets glow. 1 of up to 3 chosen.')
    expect(buttons(el)).toContain('Done →')
    // "Let the engine choose" makes the whole play again, and the engine reads
    // nothing sent beside it (Server.kt, `auto`): once a choice has been made
    // here, the button says it will not be kept (found in M4's review, where it
    // said "It chooses the rest for you").
    expect(buttons(el)).toContain('Let the engine chooseIt makes every choice for this play, redoing yours')
    ch = advance(toggle(toggle(ch, BOT), 'e21')).ch
    await act(async () => { root.unmount() })
    ;({ el } = await render({ status: stop([ARC]), choosing: ch }))
    expect(sub(el)).toBe('Divide 3 damage among the targets, at least 1 each: 3 of 3 divided.')
    expect([...el.querySelectorAll('output')].map((o) => o.getAttribute('aria-label'))).toEqual(['2 damage to the engine', '1 damage to Raging Goblin'])
    expect(buttons(el)).toContain('Let the engine chooseIt makes every choice for this play, redoing yours')
  })

  it('asks which card pays Tormenting Voice\'s cost, never the card being cast', async () => {
    const { el } = await render({ status: stop([VOICE]), choosing: beginPlay(VOICE, CAN) })
    expect(sub(el)).toBe('Discard a card: tap the card to pay with. The ones that can pay glow.')
  })
})

describe('a decision picked on the table, rendered from the status alone', () => {
  it('asks which card to discard at cleanup (514.1), with the cards in hand glowing', async () => {
    const { el } = await render({ status: asked({ type: 'SelectCards', prompt: 'Discard down to 7 cards (choose 1 to discard)', source: null, min: 1, max: 1, options: ['e22', 'e30'] }) })
    expect(el.querySelector('.prompt').getAttribute('aria-label')).toBe('The engine asks')
    expect(el.querySelector('.prompt__title').textContent).toBe('Discard down to 7 cards (choose 1 to discard)')
    expect(sub(el)).toBe('Tap the card to choose. The ones that can be chosen glow. 0 of 1 chosen.')
    expect(buttons(el)).toEqual(['Let the engine chooseIt will say what it chose'])
  })

  it('names the cards a scry looks at, which the table cannot show, as buttons that say whether they are chosen', async () => {
    const { el, sent } = await render({ status: asked({ type: 'SelectCards', prompt: 'Choose up to 2 cards', source: 'Magma Jet', min: 0, max: 2, options: ['e37', 'e7'], selectedLabel: 'Put on bottom', remainderLabel: 'Put on top', cards: { e37: { name: 'Magma Jet' }, e7: { name: 'Mountain' } } }) })
    expect(sub(el)).toBe('Tap the cards to choose. The ones that can be chosen are named below. 0 of up to 2 chosen. Chosen: put on bottom; the rest: put on top.')
    const listed = [...el.querySelectorAll('[aria-label="Cards to choose from"] button')]
    expect(listed.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Magma Jet', 'false'], ['Mountain', 'false']])
    await press(el, 'Mountain')
    expect(sent.picks).toEqual(['e7'])
    // Up to two, none needed: Done is there, and pressable at once.
    expect([...el.querySelectorAll('button')].find((b) => b.textContent === 'Done →').disabled).toBe(false)
  })

  it('pays for mana with the engine\'s own choice lit, or lets it pay, or declines', async () => {
    const { el, sent } = await render({ status: asked({ type: 'SelectManaSources', prompt: 'Pay {1}', source: 'Lightning Rift', cost: '{1}', canDecline: true, sources: [{ id: 'e22', name: 'Mountain' }], suggested: ['e22'] }) })
    // Sources, not lands: Argentum offers any untapped permanent with a mana ability.
    expect(sub(el)).toBe("Pay {1}: the sources chosen to pay with are lit, the engine's own choice to begin with. Tap one to change it.")
    expect(buttons(el)).toContain('Let the engine payIt picks what pays')
    await press(el, 'Let the engine pay')
    await press(el, 'Do not pay')
    expect(sent.decides).toEqual([{ autoPay: true }, { decline: true }])
    await press(el, 'Pay with these →')
    expect(sent.done).toBe(1)
  })
})

describe('a decision answered in the prompt', () => {
  it('orders the top of a library with a button up and down for each, and sends the order', async () => {
    const { el, sent } = await render({ status: asked({ type: 'ReorderLibrary', prompt: 'Look at the top 2 cards of your library. Put them back in any order.', source: 'Magma Jet', objects: ['e37', 'e7'], cards: { e37: { name: 'Magma Jet' }, e7: { name: 'Mountain' } }, placement: 'top', library: YOU }) })
    expect(sub(el)).toBe('From Magma Jet. The first is the top of your library. Move each with its buttons, then press Done.')
    expect([...el.querySelectorAll('li')].map((li) => li.querySelector('.prompt__rowname').textContent)).toEqual(['1. Magma Jet', '2. Mountain'])
    await press(el, 'Move Mountain up')
    expect([...el.querySelectorAll('li')].map((li) => li.querySelector('.prompt__rowname').textContent)).toEqual(['1. Mountain', '2. Magma Jet'])
    await press(el, 'Done →')
    expect(sent.decides).toEqual([{ order: ['e7', 'e37'] }])
    await press(el, 'Let the engine choose')
    expect(sent.decides.at(-1)).toEqual({ auto: true })
  })

  it('says which end of whose library an order goes to, as the engine says it, and only what holds either way where it does not', async () => {
    // Argentum asks an order for cards going to the bottom too — Prophetic
    // Bolt's rest (`MoveCollectionExecutor`) — and into another's library, and
    // the first of cards put on the bottom is not the top of anything (found
    // in M4's review, where every order said "the top of your library").
    const order = (over) => render({ status: asked({ type: 'ReorderLibrary', prompt: 'Put the revealed cards on the bottom of your library in any order.', source: 'Prophetic Bolt', objects: ['e37', 'e7', 'e8'], cards: {}, ...over }) })
    let { el } = await order({ placement: 'bottom', library: YOU })
    expect(sub(el)).toBe('From Prophetic Bolt. The last is the bottom of your library. Move each with its buttons, then press Done.')
    await act(async () => { root.unmount() })
    ;({ el } = await order({ placement: 'top', library: BOT }))
    expect(sub(el)).toMatch(/^From Prophetic Bolt\. The first is the top of the engine's library\. /)
    await act(async () => { root.unmount() })
    // A seat the table has no name for is "their", as Argentum says it.
    ;({ el } = await render({ status: asked({ type: 'ReorderLibrary', prompt: 'Put them back', source: 'Prophetic Bolt', objects: ['e37'], cards: {}, placement: 'bottom', library: 'e9' }), nameOfSeat: () => null }))
    expect(sub(el)).toMatch(/^From Prophetic Bolt\. The last is the bottom of their library\. /)
    await act(async () => { root.unmount() })
    // An engine from before the placement, or one that sent something unreadable.
    ;({ el } = await order({}))
    expect(sub(el)).toMatch(/^From Prophetic Bolt\. The first ends up highest in the library\. /)
    await act(async () => { root.unmount() })
    ;({ el } = await order({ placement: 'sideways', library: 7 }))
    expect(sub(el)).toMatch(/^From Prophetic Bolt\. The first ends up highest in the library\. /)
  })

  it('divides an amount with a stepper for each, and will not send a division that does not add up', async () => {
    const { el, sent } = await render({ status: asked({ type: 'Distribute', prompt: 'Divide 3 damage among 2 targets', source: 'Arc Lightning', total: 3, minPer: 1, targets: ['e21', BOT] }) })
    expect(sub(el)).toBe('From Arc Lightning. Divide 3 among them, at least 1 each: 3 of 3 divided.')
    // What is left over after the least each must take goes to the first. What
    // is divided has no name of its own here, so a screen reader hears a count
    // going to each (found in M4's review: "2 share to Raging Goblin").
    expect([...el.querySelectorAll('output')].map((o) => o.getAttribute('aria-label'))).toEqual(['2 to Raging Goblin', '1 to the engine'])
    await press(el, 'One more to the engine')
    expect(sub(el)).toMatch(/4 of 3 divided/)
    expect([...el.querySelectorAll('button')].find((b) => b.textContent === 'Done →').disabled).toBe(true)
    await press(el, 'One fewer to Raging Goblin')
    expect(sub(el)).toMatch(/3 of 3 divided/)
    // Never below the least each must take.
    expect(el.querySelector('[aria-label="One fewer to Raging Goblin"]').disabled).toBe(true)
    await press(el, 'Done →')
    expect(sent.decides).toEqual([{ distribution: { e21: 1, [BOT]: 2 } }])
  })

  it('leaves out "at least" where the least each takes is none, Argentum\'s own default', async () => {
    const { el } = await render({ status: asked({ type: 'Distribute', prompt: 'Distribute 2 +1/+1 counters', source: 'Counters', total: 2, minPer: 0, targets: ['e21', BOT] }) })
    expect(sub(el)).toBe('From Counters. Divide 2 among them: 2 of 2 divided.')
    expect(el.querySelector('[aria-label="One fewer to the engine"]').disabled).toBe(true)
  })

  it('assigns combat damage from the engine\'s own split, changed with steppers, and sends only this seat\'s edges', async () => {
    const board = {
      type: 'CombatResolution', prompt: "Assign Hill Giant's 3 combat damage", source: 'Hill Giant', firstStrike: false,
      edges: [
        { id: 'e27->e71', source: 'e27', target: 'e71', amount: 1, maximum: 3, lethal: 1, mine: true },
        { id: 'e27->e79', source: 'e27', target: 'e79', amount: 2, maximum: 3, lethal: 1, mine: true },
        { id: 'e71->e27', source: 'e71', target: 'e27', amount: 1, maximum: 1, lethal: 3, mine: false },
      ],
      attackers: [{ id: 'e27', name: 'Hill Giant', power: 3, trample: false }],
      blockers: [{ id: 'e71', name: 'Raging Goblin' }, { id: 'e79', name: 'Goblin Bully' }],
      defenders: [{ id: BOT, name: 'Player' }],
    }
    const { el, sent } = await render({ status: asked(board) })
    expect(el.querySelector('.prompt__group .prompt__rowname').textContent).toBe('Hill Giant: 3 of 3 dealt')
    await press(el, 'More damage to Raging Goblin, lethal 1')
    await press(el, 'Less damage to Goblin Bully, lethal 1')
    await press(el, 'Done →')
    expect(sent.decides).toEqual([{ edges: { 'e27->e71': 2, 'e27->e79': 1 } }])
  })

  it('chooses a number, a colour, one mode or several, and answers a question asked of several at once', async () => {
    let { el, sent } = await render({ status: asked({ type: 'ChooseNumber', prompt: 'Choose X for Wizard\'s Rockets (0-3)', source: "Wizard's Rockets", min: 0, max: 3 }) })
    await press(el, 'Raise the number')
    await press(el, 'Choose 1 →')
    expect(sent.decides).toEqual([{ number: 1 }])
    await act(async () => { root.unmount() })

    ;({ el, sent } = await render({ status: asked({ type: 'ChooseColor', prompt: 'Choose a color', source: 'Prismatic Strands', colors: ['WHITE', 'RED', 'PURPLE'] }) }))
    expect(sub(el)).toBe('From Prismatic Strands. Choose a colour.')
    expect(buttons(el)).toEqual(['White', 'Red', 'Let the engine chooseIt will say what it chose'])
    await press(el, 'Red')
    expect(sent.decides).toEqual([{ color: 'RED' }])
    await act(async () => { root.unmount() })

    ;({ el, sent } = await render({ status: asked({ type: 'ChooseMode', prompt: 'Choose 1 mode(s) for Charm', source: 'Charm', min: 1, max: 1, modes: [{ index: 0, text: 'Deal 2 damage', available: true }, { index: 1, text: 'Destroy target artifact', available: false }] }) }))
    expect([...el.querySelectorAll('button')].find((b) => b.textContent.startsWith('Destroy')).disabled).toBe(true)
    await press(el, 'Deal 2 damage')
    expect(sent.decides).toEqual([{ modes: [0] }])
    await act(async () => { root.unmount() })

    ;({ el, sent } = await render({ status: asked({ type: 'ChooseMode', prompt: 'Choose 1-2 mode(s) for Command', source: 'Command', min: 1, max: 2, modes: [{ index: 0, text: 'Draw a card', available: true }, { index: 1, text: 'Gain 3 life', available: true }] }) }))
    await press(el, 'Gain 3 life')
    await press(el, 'Draw a card')
    await press(el, 'Done →')
    expect(sent.decides).toEqual([{ modes: [1, 0] }])
    await act(async () => { root.unmount() })

    ;({ el, sent } = await render({ status: asked({ type: 'BatchYesNo', prompt: 'Use the ability?', source: 'Pingers', count: 3, yesText: 'Yes', noText: 'No' }) }))
    await press(el, 'Yes to all 3')
    await press(el, 'No, this one')
    expect(sent.decides).toEqual([{ yes: true, all: true }, { yes: false, all: false }])
  })

  it('answers a decision of a kind this build cannot show only by letting the engine choose', async () => {
    const { el, sent } = await render({ status: asked({ type: 'SplitPiles', prompt: 'Separate cards into 2 piles', source: 'Fact or Fiction' }) })
    expect(sub(el)).toBe('From Fact or Fiction.')
    expect(buttons(el)).toEqual(['Let the engine chooseIt will say what it chose'])
    await press(el, 'Let the engine choose')
    expect(sent.decides).toEqual([{ auto: true }])
  })
})

describe('the opening hand (protocol 6)', () => {
  // As the built engine sent them on 2026-09-24, seed 1 with Portal goblins.
  const KEEP = { index: 0, type: 'KeepHand', description: 'Keep this hand', affordable: true, meaningful: true, mulligans: 0, bottom: 0 }
  const TAKE = { index: 1, type: 'TakeMulligan', description: 'Take a mulligan', affordable: true, meaningful: true, mulligans: 0, draws: 7, bottom: 1 }
  const HAND = ['e31', 'e16', 'e10', 'e28', 'e34', 'e33', 'e24']
  const BOTTOM = { index: 0, type: 'BottomCards', description: 'Put 1 card on the bottom of your library', affordable: true, meaningful: true, mulligans: 1, bottom: 1, candidates: HAND }
  const opening = (...actions) => ({ actor: YOU, waiting: 'action', stop: 1, turn: 1, phase: 'BEGINNING', step: 'UNTAP', actions })
  const inHand = (id) => (HAND.includes(id) ? { zone: 'hand', owner: YOU } : null)

  it('asks to keep the hand or take a mulligan, with the engine\'s own numbers and the rules cited', async () => {
    const { el, sent } = await render({ status: opening(KEEP, TAKE), handSize: 7, active: YOU })
    expect(el.querySelector('.prompt').getAttribute('aria-label')).toBe('Your opening hand')
    expect(el.querySelector('.prompt__title').textContent).toBe('Your opening hand')
    expect(sub(el)).toBe('7 cards. You play first, so you skip your first draw (103.8a). Or take a mulligan: the hand goes back, your library is shuffled and you draw 7, then put 1 on the bottom once you keep. This is the London mulligan (103.5).')
    expect(buttons(el)).toEqual(['MulliganDraw 7 · put 1 on the bottom', 'Keep this hand →'])
    await press(el, 'Mulligan')
    await press(el, 'Keep this hand')
    expect(sent.acts).toEqual([{ index: 1 }, { index: 0 }])
  })

  it('says what keeping costs once a mulligan is taken, and who plays first when it is the engine', async () => {
    const { el } = await render({
      status: opening({ ...KEEP, mulligans: 1, bottom: 1 }, { ...TAKE, mulligans: 1, bottom: 2 }),
      handSize: 7, active: BOT,
    })
    expect(sub(el)).toBe('7 cards, after 1 mulligan: keeping them puts 1 on the bottom of your library. The engine plays first. Or take a mulligan: the hand goes back, your library is shuffled and you draw 7, then put 2 on the bottom once you keep. This is the London mulligan (103.5).')
    expect(buttons(el)).toEqual(['MulliganDraw 7 · put 2 on the bottom', 'Keep this hand →Then put 1 on the bottom'])
  })

  it('offers only keeping where the engine offers no more mulligans, and reads what it cannot as nothing said', async () => {
    const { el, sent } = await render({ status: opening({ ...KEEP, mulligans: 6, bottom: 6 }), handSize: null })
    expect(sub(el)).toBe('Your hand, after 6 mulligans: keeping them puts 6 on the bottom of your library. Another mulligan would leave no hand, so the engine offers only keeping this one (103.5).')
    expect(buttons(el)).toEqual(['Keep this hand →Then put 6 on the bottom'])
    await press(el, 'Keep this hand')
    expect(sent.acts).toEqual([{ index: 0 }])
    await act(async () => { root.unmount() })
    // Numbers that are not numbers are left unsaid rather than printed.
    const odd = await render({ status: opening({ ...KEEP, mulligans: 'x', bottom: null }, { ...TAKE, draws: undefined, bottom: -1 }), handSize: 7 })
    expect(sub(odd.el)).toBe('7 cards. Or take a mulligan: the hand goes back, your library is shuffled and you draw a new hand. This is the London mulligan (103.5).')
    expect(buttons(odd.el)).toEqual(['MulliganA new hand', 'Keep this hand →'])
  })

  it('asks which card goes on the bottom, rendered from the status alone, the hand glowing and the count going down', async () => {
    const { el, sent } = await render({ status: opening(BOTTOM), placeOf: inHand, onChooseForMe: null })
    expect(el.querySelector('.prompt').getAttribute('aria-label')).toBe('Your opening hand')
    expect(el.querySelector('.prompt__title').textContent).toBe('Put 1 card on the bottom of your library')
    expect(sub(el)).toBe('Tap the card to put on the bottom of your library, for the mulligan you took. The cards in your hand glow. 1 more to choose.')
    // One card: the tap is the whole choice. Nothing to let go of: the hand is kept.
    expect(buttons(el)).toEqual(['Let the engine chooseIt picks which go to the bottom'])
    await press(el, 'Let the engine choose')
    expect(sent.acts).toEqual([{ index: 0, auto: true }])
  })

  it('waits for the press where two are owed, and says what it will do', async () => {
    const two = { ...BOTTOM, mulligans: 2, bottom: 2, description: 'Put 2 cards on the bottom of your library' }
    let ch = beginPlay(two)
    ch = toggle(ch, 'e31')
    const one = await render({ status: opening(two), placeOf: inHand, choosing: ch })
    expect(sub(one.el)).toBe('Tap the 2 cards to put on the bottom of your library, for the 2 mulligans you took. The cards in your hand glow. 1 more to choose.')
    expect(one.el.querySelector('.prompt__btn.btn--primary').disabled).toBe(true)
    await act(async () => { root.unmount() })
    ch = toggle(ch, 'e16')
    const both = await render({ status: opening(two), placeOf: inHand, choosing: ch })
    expect(sub(both.el)).toMatch(/All chosen\.$/)
    await press(both.el, 'Put them on the bottom')
    expect(both.sent.done).toBe(1)
  })
})

describe('the opening hand at a table of several people (M11)', () => {
  const keep = { index: 0, type: 'KeepHand', description: 'Keep this hand', affordable: true, meaningful: true, mulligans: 0, bottom: 0 }
  it('names the seat that plays first, rather than calling every other seat the engine', async () => {
    const { el } = await render({ status: { actor: YOU, waiting: 'action', stop: 1, actions: [keep] }, handSize: 7, active: 'e2', nameOfSeat: (p) => ({ e2: 'Sam' })[p] ?? 'The engine' })
    expect(sub(el)).toMatch(/^7 cards\. Sam plays first\. /)
  })

  it('says the first player skips a draw only at a table of two, where 103.8a says it', async () => {
    // docs/TURN_STRUCTURE.md gives 103.8a for a two-player game alone, and
    // Argentum skips the draw only at two (`DrawPhaseManager`). An enforced
    // room may hold up to six (found in M4's review).
    const { el } = await render({ status: { actor: YOU, waiting: 'action', stop: 1, actions: [keep] }, handSize: 7, active: YOU, players: [YOU, BOT, 'e2'] })
    expect(sub(el)).toMatch(/^7 cards\. You play first\. Another mulligan/)
    expect(sub(el)).not.toMatch(/103\.8a|skip/)
    await act(async () => { root.unmount() })
    // A table whose seats are not known says no more than that either.
    const unknown = await render({ status: { actor: YOU, waiting: 'action', stop: 1, actions: [keep] }, handSize: 7, active: YOU, players: [] })
    expect(sub(unknown.el)).toMatch(/^7 cards\. You play first\. /)
  })
})

describe('the question of the command zone at a Commander table (M6)', () => {
  // Argentum's own words for it, as the built engine asked them on 2026-09-25
  // (CommanderZoneChoiceCheck), and where the commander is, which Server.kt reads
  // off the continuation Argentum suspended with the question.
  const question = (zone) => asked({
    type: 'YesNo', prompt: 'Put Rhys the Redeemed into the command zone instead of leaving it in the graveyard?', source: 'Rhys the Redeemed',
    yesText: 'Command zone', noText: 'Leave in the graveyard', commanderZone: zone,
  })

  it('says the rule that asks it, by where the commander is, and sends the answer pressed', async () => {
    const { el, sent } = await render({ status: question('graveyard') })
    expect(el.querySelector('.prompt__title').textContent).toBe('Put Rhys the Redeemed into the command zone instead of leaving it in the graveyard?')
    expect(sub(el)).toBe("From Rhys the Redeemed. A commander put into a graveyard or exile may be put into its owner's command zone, a state-based action (903.9a).")
    await press(el, 'Command zone')
    expect(sent.decides).toEqual([{ yes: true }])
  })

  it('cites 903.9b for a hand or a library, and says no rule where an engine said nothing of where it is', async () => {
    let r = await render({ status: question('library') })
    expect(sub(r.el)).toMatch(/\(903\.9b\)\.$/)
    await act(async () => { root.unmount() })
    r = await render({ status: question(undefined) })
    expect(sub(r.el)).toBe('From Rhys the Redeemed.')
    await press(r.el, 'Leave in the graveyard')
    expect(r.sent.decides).toEqual([{ yes: false }])
  })
})
