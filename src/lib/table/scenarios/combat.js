/**
 * Lesson: attacking, blocking and damage.
 *
 * One attacker and one potential blocker, no keywords, no tricks. The
 * learner predicts the result before declaring, then sees it. Then the
 * same shape with different numbers, then an opponent who does not block,
 * then the readiness example: haste against summoning sickness.
 *
 * The opponent's behaviour is a named policy and is written on the screen.
 */
import { GOALS } from '../objectives.js'
import { battlefield } from '../model.js'

const LESSON = 'combat-basics'
const onTable = (state, cardId, player = 'you') => battlefield(state, player).some((c) => c.cardId === cardId)

const inCombat = (state) => ['declareAttackers', 'declareBlockers', 'combatDamage'].includes(state.step)

export const COMBAT_TRADE = {
  id: 'combat-trade',
  lessonId: LESSON,
  version: 1,
  variant: 'guided',
  title: 'Attack into a blocker',
  summary: 'Your 2/2 attacks, their 2/1 blocks. Say what happens before it does.',
  opponent: 'blocker',
  setup: {
    turn: 5, active: 'you', step: 'main1', firstPlayer: 'you', turnsBy: { you: 3, foe: 2 },
    you: { battlefield: ['forest', 'forest', 'grizzlyBears'], hand: [], library: ['forest', 'forest', 'forest'] },
    foe: { battlefield: ['mountain', 'mountain', 'goblinPiker'], hand: [], library: ['mountain', 'mountain', 'mountain'] },
  },
  goals: [
    { ...GOALS.predicted('bears-into-piker'), label: 'Predict the block before it happens' },
    { ...GOALS.killed('goblinPiker'), label: 'Goblin Piker is dealt with' },
  ],
  predict: [
    {
      id: 'bears-into-piker',
      when: (state) => state.step === 'main1' && state.active === 'you' && onTable(state, 'grizzlyBears') && onTable(state, 'goblinPiker', 'foe'),
      question: 'Your 2/2 Grizzly Bears attacks and their 2/1 Goblin Piker blocks. What happens?',
      options: [
        { text: 'Both die', correct: true, why: 'Damage is dealt at the same time: 2 to a 2/1 is lethal, and 2 to a 2/2 is lethal too. Neither creature strikes first without first strike.' },
        { text: 'Only the Piker dies', correct: false, why: 'The Piker deals its 2 damage at the same moment it takes 2. A 2/2 with 2 damage marked is dead as well.' },
        { text: 'Only the Bears dies', correct: false, why: 'Both deal damage at once. The Piker takes 2, which is more than its toughness of 1.' },
      ],
    },
  ],
  coach: {
    intro: 'Your third turn. Grizzly Bears has been with you since last turn, so it can attack. Their Goblin Piker is untapped and will block if it can: this opponent blocks whatever it can. Before anything happens, say what will.',
    steps: [
      { id: 'attack', when: (state) => state.step === 'main1' && state.active === 'you' && onTable(state, 'grizzlyBears'), say: 'Pass priority to move into combat. In the declare attackers step, choose Grizzly Bears. Attacking taps it.' },
      { id: 'declare', when: (state) => state.awaiting?.kind === 'attackers' && state.awaiting.player === 'you', say: 'Choose your attackers. Only creatures that have been with you since the turn began, and are untapped, can be chosen.', highlight: { kind: 'control', id: 'attack' } },
      { id: 'blocked', when: (state) => state.step === 'declareBlockers' && Object.keys(state.blocks).length > 0, say: 'They blocked. Blocking did not tap the Piker. Everyone gets priority before damage: this is where a trick would go. Pass, and damage is dealt.', highlight: { kind: 'control', id: 'pass' } },
      { id: 'after', when: (state) => !onTable(state, 'goblinPiker', 'foe') && !inCombat(state), say: 'Both took lethal damage at the same moment and both went to the graveyard. A trade. Neither player lost life, because a blocked creature deals its damage to the blocker.' },
    ],
  },
  hints: [{ id: 'move', say: 'Nothing happens until you pass priority: that moves the game into the beginning of combat, then to declare attackers.' }],
  paper: {
    needs: ['A 2/2 creature and a 2/1 creature'],
    steps: ['Turn the 2/2 sideways and say it attacks.', 'Put the 2/1 in front of it as a blocker. Do not turn it sideways.', 'Say how much damage each deals, and to what. Move both to the graveyard together.'],
    say: ['"Attacking with Grizzly Bears." "Piker blocks." "Two damage each way. Both die."'],
    check: 'Which creature was tapped at the end, and why was the other not?',
  },
}

export const COMBAT_SURVIVE = {
  id: 'combat-survive',
  lessonId: LESSON,
  version: 1,
  variant: 'independent',
  title: 'A bigger attacker',
  summary: 'Your 3/3 into their 2/1. Predict it, then see the damage wear off.',
  opponent: 'blocker',
  setup: {
    turn: 7, active: 'you', step: 'main1', firstPlayer: 'you', turnsBy: { you: 4, foe: 3 },
    you: { battlefield: ['forest', 'forest', 'forest', 'centaurCourser'], hand: [], library: ['forest', 'forest', 'forest'] },
    foe: { battlefield: ['mountain', 'mountain', 'goblinPiker'], hand: [], library: ['mountain', 'mountain', 'mountain'] },
  },
  goals: [
    { ...GOALS.predicted('courser-into-piker'), label: 'Predict the block' },
    { ...GOALS.killed('goblinPiker'), label: 'Goblin Piker is dealt with' },
    { ...GOALS.survives('centaurCourser'), label: 'Centaur Courser survives' },
    { ...GOALS.explained('damage-wears-off'), label: 'Say what happens to the damage' },
  ],
  predict: [
    {
      id: 'courser-into-piker',
      when: (state) => state.step === 'main1' && state.active === 'you' && onTable(state, 'centaurCourser') && onTable(state, 'goblinPiker', 'foe'),
      question: 'Your 3/3 Centaur Courser attacks and their 2/1 Goblin Piker blocks. What happens?',
      options: [
        { text: 'The Piker dies; the Courser survives with 2 damage marked', correct: true, why: '3 damage kills a 2/1. The 2 damage the Courser takes is less than its toughness of 3, so it stays, damaged until the turn ends.' },
        { text: 'Both die', correct: false, why: 'The Courser takes 2 and has toughness 3. Damage only kills when it reaches toughness.' },
        { text: 'The Courser becomes a 3/1', correct: false, why: 'Damage does not lower toughness. The Courser is still a 3/3 with 2 damage marked on it; the difference matters once more damage comes in.' },
      ],
    },
  ],
  explain: {
    id: 'damage-wears-off',
    question: 'After combat the Courser has 2 damage marked. When does that go away?',
    options: [
      { text: 'At the end of the turn, in the cleanup step', correct: true, why: 'Damage is removed in the cleanup step of every turn, all at once. Until then the Courser is one more point of damage from dying.' },
      { text: 'Immediately after combat', correct: false, why: 'Damage stays marked for the rest of the turn. A Shock after combat would finish the Courser.' },
      { text: 'Never, until it is healed', correct: false, why: 'There is no healing to do. The cleanup step removes all damage from every creature, every turn.' },
    ],
  },
  coach: {
    intro: 'Same shape, different numbers. Centaur Courser is a 3/3; their Goblin Piker is a 2/1 and this opponent blocks whatever it can. Predict, then attack with the Courser, then watch the damage.',
    steps: [
      { id: 'after', when: (state) => !onTable(state, 'goblinPiker', 'foe') && state.step === 'main2', say: 'The Piker is gone and the Courser stands, with 2 damage marked. It is not a 3/1: it is a 3/3 with damage on it. End the turn and watch what cleanup does.' },
      { id: 'clean', when: (state) => onTable(state, 'centaurCourser') && state.active === 'foe' && battlefield(state, 'you').some((c) => c.cardId === 'centaurCourser' && c.damage === 0) && !onTable(state, 'goblinPiker', 'foe'), say: 'Cleanup removed the damage. One question.' },
    ],
  },
  hints: [{ id: 'end-turn', say: 'After combat you are in your second main phase. "End the turn" passes through the end step and cleanup.' }],
  paper: {
    needs: ['A 3/3 creature, a 2/1 creature, and a die or counter to mark damage'],
    steps: ['Attack with the 3/3; block with the 2/1.', 'Mark 2 damage on the 3/3 with the die. Move the 2/1 to the graveyard.', 'At the end of the turn, take the die off and say why.'],
    say: ['"Three damage to the Piker, it dies. Two damage on the Courser, it lives."', '"Cleanup: damage comes off."'],
    check: 'If they had a Shock after combat, would the Courser have survived the turn?',
  },
}

export const COMBAT_UNBLOCKED = {
  id: 'combat-unblocked',
  lessonId: LESSON,
  version: 1,
  variant: 'independent',
  title: 'When they do not block',
  summary: 'The same attack against an opponent who lets it through.',
  opponent: 'passive',
  setup: {
    turn: 5, active: 'you', step: 'main1', firstPlayer: 'you', turnsBy: { you: 3, foe: 2 },
    you: { battlefield: ['forest', 'forest', 'centaurCourser'], hand: [], library: ['forest', 'forest', 'forest'] },
    foe: { battlefield: ['mountain', 'mountain', 'goblinPiker'], hand: [], library: ['mountain', 'mountain', 'mountain'] },
  },
  goals: [
    { ...GOALS.predicted('unblocked'), label: 'Predict what an unblocked attacker does' },
    { ...GOALS.lifeAtMost('foe', 17), label: 'Your opponent takes the damage' },
  ],
  predict: [
    {
      id: 'unblocked',
      when: (state) => state.step === 'main1' && state.active === 'you' && state.life.foe === 20,
      question: 'This opponent never blocks. Your 3/3 Centaur Courser attacks. What happens?',
      options: [
        { text: 'Your opponent goes from 20 to 17', correct: true, why: 'An unblocked creature deals its damage to the player it attacked. 3 power, 3 life.' },
        { text: 'Their Goblin Piker takes 3 and dies', correct: false, why: 'A creature only takes combat damage if it blocks. Nothing forces a block, and this opponent declines.' },
        { text: 'Nothing, because they have an untapped creature', correct: false, why: 'Having a creature is not blocking with it. The block is a choice, and they chose not to.' },
      ],
    },
  ],
  coach: {
    intro: 'The board looks like last time, but this opponent never blocks. Predict, then attack.',
    steps: [
      { id: 'after', when: (state) => state.life.foe <= 17, say: 'Three damage to your opponent. Their Piker was never in it: blocking is a choice, and the defender makes it after seeing the attack.' },
    ],
  },
  paper: {
    needs: ['A creature and a life counter or paper'],
    steps: ['Attack with the creature and say who it attacks.', 'Say "no blocks" as the defender.', 'Reduce the defender’s life by the creature’s power and say the new total.'],
    say: ['"Attacking you with the Courser." "No blocks." "Three damage: 20 to 17."'],
    check: 'Who decides whether a block happens, and when?',
  },
}

export const COMBAT_READINESS = {
  id: 'combat-readiness',
  lessonId: LESSON,
  version: 1,
  variant: 'independent',
  title: 'Who can attack this turn',
  summary: 'Two creatures cast this turn, and only one of them can attack.',
  opponent: 'passive',
  setup: {
    turn: 3, active: 'you', step: 'main1', firstPlayer: 'you', turnsBy: { you: 2, foe: 1 },
    you: { battlefield: [{ cardId: 'mountain', tapped: true }, { cardId: 'forest', tapped: true }, { cardId: 'forest', tapped: true }, { cardId: 'ragingGoblin', sick: true }, { cardId: 'grizzlyBears', sick: true }], hand: [], library: ['forest', 'forest', 'forest'] },
    foe: { battlefield: ['mountain', 'mountain'], hand: [], library: ['mountain', 'mountain', 'mountain'] },
  },
  goals: [
    { ...GOALS.predicted('who-can-attack'), label: 'Say which creature can attack' },
    { ...GOALS.lifeAtMost('foe', 19), label: 'Attack with the one that can' },
  ],
  predict: [
    {
      id: 'who-can-attack',
      when: (state) => state.step === 'main1' && state.active === 'you' && state.life.foe === 20,
      question: 'You cast Raging Goblin and Grizzly Bears this turn. Which can attack now?',
      options: [
        { text: 'Only Raging Goblin, because it has haste', correct: true, why: 'A creature attacks only if it has been under your control since your turn began, unless it has haste. The Goblin has haste; the Bears waits for your next turn.' },
        { text: 'Neither: both arrived this turn', correct: false, why: 'Haste is exactly the exception. Raging Goblin can attack the turn it arrives.' },
        { text: 'Both: creatures can always attack', correct: false, why: 'Summoning sickness stops the Bears. Try to choose it and the table will say so.' },
      ],
    },
  ],
  coach: {
    intro: 'You cast Raging Goblin and Grizzly Bears this turn and your lands are tapped. Predict which can attack, then go to combat and choose. Choosing the Bears is allowed to fail: read what the table says.',
    steps: [
      { id: 'after', when: (state) => state.life.foe <= 19, say: 'One damage from the Goblin. The Bears stayed home, and it can still block on their turn: summoning sickness never stops a block.' },
    ],
  },
  paper: {
    needs: ['Two creatures, one with haste'],
    steps: ['Put both on the table as if cast this turn.', 'Say which can attack and why. Turn only that one sideways.'],
    say: ['"Raging Goblin has haste, so it attacks. Grizzly Bears is summoning sick."'],
    check: 'Can the Bears block on their turn?',
  },
}

export const COMBAT_SCENARIOS = [COMBAT_TRADE, COMBAT_SURVIVE, COMBAT_UNBLOCKED, COMBAT_READINESS]
