/**
 * Lesson: responding, and the stack.
 *
 * Their Shock is on the stack, aimed at your Grizzly Bears, and you hold
 * Giant Growth with a Forest untapped. Two branches: respond, or let it
 * resolve. The learner predicts both before choosing. The opponent is
 * scripted to cast the Shock on its own turn and pass thereafter, and the
 * screen says so.
 */
import { GOALS } from '../objectives.js'
import { battlefield, hand, cardOf, MAIN_STEPS } from '../model.js'
import { scripted } from '../opponent.js'

const LESSON = 'responses'
const onTable = (state, cardId, player = 'you') => battlefield(state, player).some((c) => c.cardId === cardId)
const onStack = (state, cardId) => state.stack.some((s) => state.cards[s.instanceId].cardId === cardId)

/** Casts Shock at Grizzly Bears once, in its own main phase, then passes on everything. */
const SHOCKS_THE_BEARS = scripted('shocks-bears', 'On its turn, casts Shock at your Grizzly Bears, then passes on everything.', [
  (state) => {
    if (state.priority !== 'foe' || state.active !== 'foe' || !MAIN_STEPS.includes(state.step) || state.stack.length) return null
    const shock = hand(state, 'foe').find((c) => c.cardId === 'shock')
    const bears = battlefield(state, 'you').find((c) => c.cardId === 'grizzlyBears')
    const mountain = battlefield(state, 'foe').find((c) => c.cardId === 'mountain' && !c.tapped)
    if (!shock || !bears || !mountain) return null
    return { type: 'castWith', player: 'foe', instanceId: shock.instanceId, sources: [mountain.instanceId], target: { kind: 'creature', id: bears.instanceId } }
  },
])

const SETUP = {
  turn: 4, active: 'foe', step: 'main1', priority: 'foe', firstPlayer: 'you', turnsBy: { you: 2, foe: 2 },
  you: { battlefield: ['forest', 'forest', 'grizzlyBears'], hand: ['giantGrowth'], library: ['forest', 'forest', 'forest'] },
  foe: { battlefield: ['mountain', 'mountain'], hand: ['shock'], library: ['mountain', 'mountain', 'mountain'] },
}

const PREDICTIONS = [
  {
    id: 'if-you-pass',
    when: (state) => onStack(state, 'shock') && state.priority === 'you' && !onStack(state, 'giantGrowth'),
    question: 'Shock is on the stack, aimed at your 2/2 Grizzly Bears. If you pass without responding, what happens?',
    options: [
      { text: 'Shock resolves and the Bears dies', correct: true, why: 'Both players passing in succession resolves the top of the stack. 2 damage to a 2/2 is lethal.' },
      { text: 'Nothing, until your turn', correct: false, why: 'A spell resolves as soon as both players pass in a row. Passing is what lets it happen.' },
      { text: 'Shock is countered because you passed', correct: false, why: 'Passing never counters anything. It is the opposite: it lets the spell resolve.' },
    ],
  },
  {
    id: 'if-you-respond',
    when: (state) => onStack(state, 'shock') && state.priority === 'you' && !onStack(state, 'giantGrowth'),
    question: 'And if you cast Giant Growth on the Bears in response?',
    options: [
      { text: 'Giant Growth resolves first, the Bears is 5/5, and Shock deals 2 to a 5/5', correct: true, why: 'Last on, first off. Your Growth goes on top of their Shock and resolves first. When Shock finally resolves, 2 damage to a 5/5 is not lethal.' },
      { text: 'Shock resolves first because it was cast first', correct: false, why: 'The stack resolves from the top. The most recently cast spell resolves first.' },
      { text: 'Giant Growth cannot be cast on their turn', correct: false, why: 'Giant Growth is an instant. Instants can be cast whenever you have priority, on any turn, including in response.' },
    ],
  },
]

export const RESPONSE_GUIDED = {
  id: 'response-guided',
  lessonId: LESSON,
  version: 1,
  variant: 'guided',
  title: 'Answer a Shock',
  summary: 'Their Shock is on the stack. Predict both outcomes, then save the Bears.',
  opponent: SHOCKS_THE_BEARS,
  setup: SETUP,
  goals: [
    { ...GOALS.predicted('if-you-pass'), label: 'Predict what passing does' },
    { ...GOALS.predicted('if-you-respond'), label: 'Predict what responding does' },
    { ...GOALS.survives('grizzlyBears'), label: 'Grizzly Bears survives the Shock' },
  ],
  predict: PREDICTIONS,
  coach: {
    intro: 'Their turn. They cast Shock at your Grizzly Bears, and now you have priority with the Shock waiting on the stack. You hold Giant Growth and have a Forest untapped. Predict both branches before you act.',
    steps: [
      { id: 'respond', when: (state) => onStack(state, 'shock') && !onStack(state, 'giantGrowth') && state.priority === 'you' && !state.casting, say: 'Respond: select Giant Growth and cast it at the Bears. It goes on top of the Shock.', highlight: { kind: 'hand', cardId: 'giantGrowth' } },
      { id: 'target', when: (state) => state.casting && cardOf(state.cards[state.casting.instanceId]).id === 'giantGrowth' && !state.casting.targets.length, say: 'Choose the target: your Grizzly Bears.', highlight: { kind: 'battlefield', cardId: 'grizzlyBears' } },
      { id: 'pay', when: (state) => state.casting && state.casting.targets.length > 0, say: 'Tap a Forest for the {G}, pay, and cast.' },
      { id: 'stacked', when: (state) => onStack(state, 'giantGrowth') && onStack(state, 'shock'), say: 'Two spells on the stack, yours on top. Pass. They pass, and Giant Growth resolves first. Then priority goes round again for the Shock: pass once more.', highlight: { kind: 'control', id: 'pass' } },
      { id: 'grown', when: (state) => !onStack(state, 'giantGrowth') && onStack(state, 'shock') && onTable(state, 'grizzlyBears'), say: 'The Bears is 5/5 until end of turn and the Shock is still waiting. Pass again so it resolves.', highlight: { kind: 'control', id: 'pass' } },
      { id: 'saved', when: (state) => !state.stack.length && onTable(state, 'grizzlyBears') && battlefield(state, 'you').some((c) => c.cardId === 'grizzlyBears' && c.damage === 2), say: 'Shock resolved: 2 damage marked on a 5/5. The Bears lives. At cleanup the damage comes off and the +3/+3 ends, at the same time.' },
    ],
  },
  paper: {
    needs: ['A 2/2 creature, a Shock or any 2-damage instant, a Giant Growth or any +3/+3 instant', 'Two lands'],
    steps: ['Put the Shock on the table between you and say it targets the 2/2.', 'Put the Giant Growth on top of it and say it targets the 2/2.', 'Resolve from the top: the 2/2 becomes 5/5, then Shock deals 2. Say the creature survives.'],
    say: ['"In response, Giant Growth on the Bears." "Growth resolves: 5/5." "Shock resolves: two damage, it lives."'],
    check: 'What would have happened if you had cast Giant Growth first, before they cast Shock?',
  },
}

export const RESPONSE_CHOICE = {
  id: 'response-choice',
  lessonId: LESSON,
  version: 1,
  variant: 'independent',
  title: 'Respond, or let it go',
  summary: 'The same Shock. Predict both branches, then take either one and watch it play out.',
  opponent: SHOCKS_THE_BEARS,
  setup: SETUP,
  goals: [
    { ...GOALS.predicted('if-you-pass'), label: 'Predict what passing does' },
    { ...GOALS.predicted('if-you-respond'), label: 'Predict what responding does' },
    { id: 'stack-empty', label: 'See the stack resolve', done: (state, events) => events.some((e) => e.type === 'spellResolved' && state.cards[e.instanceId]?.cardId === 'shock') },
  ],
  predict: PREDICTIONS,
  coach: {
    intro: 'The same moment: their Shock on the stack, your Giant Growth in hand, a Forest untapped. Predict both branches. Then choose either, and see whether the table agrees with you.',
    steps: [
      { id: 'died', when: (state) => !state.stack.length && !onTable(state, 'grizzlyBears'), say: 'You let it resolve. Shock dealt 2 to a 2/2 and the Bears died. Sometimes that is the right call, when the trick is worth more than the creature. Reset to try the other branch.' },
      { id: 'lived', when: (state) => !state.stack.length && onTable(state, 'grizzlyBears') && !hand(state, 'you').some((c) => c.cardId === 'giantGrowth'), say: 'You responded. Giant Growth resolved first and Shock hit a 5/5. Reset to see the other branch.' },
    ],
  },
  paper: {
    needs: ['The same cards as before'],
    steps: ['Play out the branch where you pass. Say what dies.', 'Play out the branch where you respond. Say the order things resolve in.'],
    say: ['"I pass. Shock resolves. Bears dies."', '"In response, Giant Growth. Growth resolves, then Shock. Bears lives."'],
    check: 'In the second branch, which spell was cast first, and which resolved first?',
  },
}

export const RESPONSE_SCENARIOS = [RESPONSE_GUIDED, RESPONSE_CHOICE]
