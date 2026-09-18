/**
 * Lesson: lands, mana and a first creature.
 *
 * Three fixtures. A is guided: the coach names each move and the screen
 * highlights it. B is the same skill on a different board with no
 * highlights, and a second B board where the total is enough but the
 * colour is not. C is paper: the same payment with real cards on a real
 * table, self-reported. The opponent passes on everything.
 *
 * The learner is on the play: turn 1 has no draw (103.8a), so the library
 * is there only so a turn boundary never draws from nothing.
 */
import { GOALS } from '../objectives.js'
import { hand, battlefield, cardOf } from '../model.js'

const LESSON = 'mana-first-creature'

const inHand = (state, cardId) => hand(state, 'you').some((c) => c.cardId === cardId)
const onTable = (state, cardId) => battlefield(state, 'you').some((c) => c.cardId === cardId)
const onStack = (state, cardId) => state.stack.some((s) => state.cards[s.instanceId].cardId === cardId)
const poolOf = (state) => state.pool.you
const castingIs = (state, cardId) => state.casting && state.cards[state.casting.instanceId].cardId === cardId

export const MANA_GUIDED = {
  id: 'mana-guided',
  lessonId: LESSON,
  variant: 'guided',
  title: 'Cast your first creature',
  summary: 'Two lands, one creature, and the whole payment shown a step at a time.',
  opponent: 'passive',
  setup: {
    turn: 1, active: 'you', step: 'main1', firstPlayer: 'you', turnsBy: { you: 1, foe: 0 },
    you: { battlefield: ['forest', 'mountain'], hand: ['grizzlyBears'], library: ['forest', 'forest', 'forest'] },
    foe: { battlefield: [], hand: [], library: ['mountain', 'mountain', 'mountain'] },
  },
  goals: [
    { ...GOALS.resolved('grizzlyBears'), label: 'Grizzly Bears is on the battlefield' },
    { ...GOALS.explained('what-untaps'), label: 'Say what untaps next turn' },
  ],
  coach: {
    intro: 'It is your first main phase. You have a Forest and a Mountain on the table, both untapped, and Grizzly Bears in hand. Nothing is on the stack. Look at the card first: inspecting it changes nothing.',
    steps: [
      {
        id: 'begin',
        when: (state) => !state.casting && inHand(state, 'grizzlyBears'),
        say: 'Grizzly Bears costs {1}{G}: one generic mana, which any mana can pay, and one that must be green. Select the card, then choose Cast. Nothing is paid yet; casting starts with announcing.',
        highlight: { kind: 'hand', cardId: 'grizzlyBears' },
      },
      {
        id: 'green',
        when: (state) => castingIs(state, 'grizzlyBears') && poolOf(state).G < 1,
        say: 'The cost is showing. Tap the Forest: it turns sideways and adds one green mana to your pool. The Forest stays on the table; the mana is what you spend.',
        highlight: { kind: 'battlefield', cardId: 'forest' },
      },
      {
        id: 'generic',
        when: (state) => castingIs(state, 'grizzlyBears') && poolOf(state).G >= 1 && poolOf(state).R < 1 && state.casting.assigned.length < 2,
        say: 'One green in the pool. The {1} can be paid with anything, so tap the Mountain for a red mana. Green could have paid it too, but then nothing would be left for the {G}.',
        highlight: { kind: 'battlefield', cardId: 'mountain' },
      },
      {
        id: 'assign',
        when: (state) => castingIs(state, 'grizzlyBears') && poolOf(state).G >= 1 && poolOf(state).R >= 1 && state.casting.assigned.length < 2,
        say: 'Two mana in the pool. Put the green on {G} and the red on {1}. Try the red on {G} if you like: the table will tell you why not.',
        highlight: { kind: 'control', id: 'pay' },
      },
      {
        id: 'commit',
        when: (state) => castingIs(state, 'grizzlyBears') && state.casting.assigned.length >= 2,
        say: 'Paid. Choose Cast to commit. The card leaves your hand for the stack, not the battlefield: a spell waits there until everyone has had a chance to respond.',
        highlight: { kind: 'control', id: 'commit' },
      },
      {
        id: 'stack',
        when: (state) => onStack(state, 'grizzlyBears'),
        say: 'Grizzly Bears is on the stack and you have priority again. Pass. Your opponent passes too, and with both of you passing in succession the top of the stack resolves.',
        highlight: { kind: 'control', id: 'pass' },
      },
      {
        id: 'done',
        when: (state) => onTable(state, 'grizzlyBears'),
        say: 'It resolved: Grizzly Bears is on the battlefield, summoning sick until your next turn begins. Both lands are still tapped, and the mana is gone. One question before you go.',
      },
    ],
  },
  explain: {
    id: 'what-untaps',
    question: 'Your turn ends and your next one begins. What untaps?',
    options: [
      { text: 'The Forest and the Mountain', correct: true, why: 'Your untap step untaps your permanents. The mana they made was spent, and any left over would have emptied at the end of the step anyway. Lands come back; mana does not.' },
      { text: 'The mana you spent comes back to the pool', correct: false, why: 'Spent mana is gone for good, and unspent mana empties at the end of every step. What untaps is the lands, ready to make new mana.' },
      { text: 'Nothing until you pay again', correct: false, why: 'Untapping is free and automatic: the first thing that happens on your turn is every permanent you control untapping.' },
    ],
  },
  paper: {
    needs: ['Two basic lands of different colours', 'A creature that costs one generic and one coloured mana, such as {1}{G}'],
    steps: [
      'Lay the two lands in front of you, upright. Put the creature in your hand.',
      'Say the creature’s cost out loud, and which land pays which part.',
      'Turn each land sideways as you name its mana. Say what colour it made.',
      'Put the creature on the table, sideways lands still sideways.',
    ],
    say: ['"Tapping Forest for green, tapping Mountain for the one. Casting Grizzly Bears."', '"It resolves. The lands stay tapped until my next untap step."'],
    check: 'Can you say what is left in your pool after paying, and what happens to the lands at the start of your next turn?',
  },
}

export const MANA_INDEPENDENT = {
  id: 'mana-independent',
  lessonId: LESSON,
  variant: 'independent',
  title: 'Cast it yourself',
  summary: 'A different creature, more sources than it needs, and no highlights.',
  opponent: 'passive',
  setup: {
    turn: 3, active: 'you', step: 'main1', firstPlayer: 'you', turnsBy: { you: 2, foe: 1 },
    you: { battlefield: ['forest', 'mountain', 'mountain', 'llanowarElves'], hand: ['centaurCourser'], library: ['forest', 'forest', 'forest'] },
    foe: { battlefield: ['mountain', 'mountain'], hand: [], library: ['mountain', 'mountain', 'mountain'] },
  },
  goals: [
    { ...GOALS.resolved('centaurCourser'), label: 'Centaur Courser is on the battlefield' },
    { ...GOALS.explained('generic-any'), label: 'Say what the generic part can take' },
  ],
  coach: {
    intro: 'Your third turn. Four sources: a Forest, two Mountains and Llanowar Elves, which has been with you since last turn. Centaur Courser costs {2}{G}. Cast it, any legal way you like.',
    steps: [
      { id: 'done', when: (state) => onTable(state, 'centaurCourser'), say: 'Centaur Courser resolved. Any two of the other three sources could have paid the {2}; only green could pay the {G}. One question.' },
    ],
  },
  hints: [
    { id: 'green-first', say: 'Only one of your four sources makes green, and the {G} needs it. Tap that one for the {G} and any two others for the {2}.' },
  ],
  explain: {
    id: 'generic-any',
    question: 'You paid the {2} with a Mountain and the Elves. Could you have used the Forest for the {2} instead?',
    options: [
      { text: 'Yes, but then nothing would be left to pay the {G}', correct: true, why: 'Generic takes any mana, green included. The reason not to is that the Forest is your only green source, and the {G} can be paid by nothing else.' },
      { text: 'No, a Forest can only pay green symbols', correct: false, why: 'A Forest makes green mana, and green mana pays generic costs as well as any other mana does. What it cannot do is pay a red or a colourless symbol.' },
    ],
  },
  paper: {
    needs: ['Four lands or mana creatures, at least one green', 'A creature costing {2}{G}'],
    steps: ['Choose which three sources you will tap before touching any of them, and say why.', 'Tap them one at a time, naming the colour each makes.', 'Cast the creature and say where it goes first.'],
    say: ['"Forest for the green. Mountain and Mountain for the two. Casting Centaur Courser."'],
    check: 'Which of your sources could not have paid the {G}? Which could have paid the {2}?',
  },
}

export const MANA_WRONG_COLOUR = {
  id: 'mana-wrong-colour',
  lessonId: LESSON,
  variant: 'independent',
  title: 'Enough mana, wrong colour',
  summary: 'Four lands and a four-mana creature that still cannot be cast.',
  opponent: 'passive',
  setup: {
    turn: 5, active: 'you', step: 'main1', firstPlayer: 'you', turnsBy: { you: 3, foe: 2 },
    you: { battlefield: ['forest', 'forest', 'forest', 'forest'], hand: ['hillGiant', 'grizzlyBears'], library: ['forest', 'forest', 'forest'] },
    foe: { battlefield: ['mountain', 'mountain', 'mountain'], hand: [], library: ['mountain', 'mountain', 'mountain'] },
  },
  goals: [
    { ...GOALS.explained('why-not-giant'), label: 'Say why Hill Giant cannot be cast' },
    { ...GOALS.resolved('grizzlyBears'), label: 'Cast something you can pay for' },
  ],
  coach: {
    intro: 'Four Forests, untapped. Hill Giant costs {3}{R}, four mana, and you have four. Try to cast it, and read what the table says. Then cast what you can.',
    steps: [
      { id: 'done', when: (state) => onTable(state, 'grizzlyBears'), say: 'Grizzly Bears resolved. Counting mana is the first check; counting colours is the second, and it is the one that fails more often.' },
    ],
  },
  hints: [
    { id: 'count-colours', say: 'Four Forests make four green. Hill Giant’s {R} needs red, and nothing here makes red. Grizzly Bears needs only green.' },
  ],
  explain: {
    id: 'why-not-giant',
    question: 'Why can Hill Giant not be cast from four Forests?',
    options: [
      { text: 'Its {R} needs red mana, and Forests make only green', correct: true, why: 'The total was fine: four sources for a four-mana spell. The coloured symbol is the constraint, and no amount of green pays a red pip.' },
      { text: 'Four lands is not enough for a four-mana spell', correct: false, why: 'Four untapped lands make four mana, which pays a four-mana cost. The count was never the problem.' },
      { text: 'Hill Giant can only be cast on turn four or later', correct: false, why: 'There is no turn requirement on any spell. Hill Giant needs {3}{R} paid, whenever that is possible.' },
    ],
  },
  paper: {
    needs: ['Four lands of one colour', 'A creature of another colour that costs four'],
    steps: ['Count the lands and the cost out loud.', 'Point at the coloured symbol and say which land would pay it.', 'Say why the spell cannot be cast, then put it back in your hand.'],
    say: ['"Four mana, but the Giant needs red and I have none. I cannot cast it."'],
    check: 'Which one land would have made the difference?',
  },
}

export const MANA_SCENARIOS = [MANA_GUIDED, MANA_INDEPENDENT, MANA_WRONG_COLOUR]
