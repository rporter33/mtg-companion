// The guided first game.
//
// This is a *scripted* game, not a rules engine. Every beat declares the exact
// board state the player is looking at, so the tutorial can never desync,
// never present an illegal board, and never depend on a network call. Writing
// a real rules engine that covers even ten cards correctly is a much larger
// project, and it would not teach any better than this does.
//
// Each beat has: the board, what the coach says, and what the player must do to
// advance. The player genuinely plays — they click their own land, choose their
// own block, cast their own combat trick — but the outcomes are authored.
//
// Because the outcomes are authored, the boards have to be right by hand. The
// rules this script keeps, checked by tests/tutorial.test.js:
//
// - A permanent untaps only in its controller's untap step, so your Forest
//   tapped for a spell stays tapped through their turn, and their attacker
//   stays tapped through yours.
// - Casting a spell taps the lands that paid for it, in the same beat the
//   spell arrives.
// - A creature is marked summoning sick until its controller's next turn
//   begins; it can still block while sick, and the script uses that.
// - The phase shown is the phase the action belongs to: a land is played in
//   a main phase, attackers are chosen in the declare attackers step, blocks
//   in the declare blockers step.
// - "Tap" means the rules action. The gesture on this screen is "select".

const you = (over) => ({ life: 20, hand: [], board: [], graveyard: [], ...over })
const foe = (over) => ({ life: 20, hand: 0, board: [], graveyard: [], ...over })

/** A permanent on the battlefield. `sick` means it cannot attack or tap yet; it can block. */
const perm = (id, over = {}) => ({ id, tapped: false, sick: false, ...over })
const tapped = (id, over = {}) => perm(id, { tapped: true, ...over })

const CONTINUE = { type: 'continue', label: 'Next' }
const click = (cardId, zone, label, hint) => ({ type: 'click', cardId, zone, label, hint })

/**
 * The steps a beat can sit in. `attack`, `block` and `damage` are the three
 * combat steps a beginner has to tell apart; the beginning and end of combat
 * steps are not shown, since nothing in this script happens in them.
 */
export const PHASES = {
  untap: 'Untap step',
  draw: 'Draw step',
  main1: 'Main phase',
  attack: 'Combat · declare attackers',
  block: 'Combat · declare blockers',
  damage: 'Combat · damage',
  main2: 'Second main phase',
  end: 'End step',
}

export const TUTORIAL = [
  // --- setup -------------------------------------------------------------
  {
    id: 'intro',
    title: 'How you win',
    coach: 'You and your opponent each start at 20 life. Reduce them to zero and you win. Almost everything in Magic is in service of that one sentence.',
    you: you(), foe: foe(),
    turn: 0, phase: null, active: 'you',
    action: CONTINUE,
  },
  {
    id: 'hand',
    title: 'Your opening hand',
    coach: 'Seven cards. Four of them are Forests — your mana. The other three are things you want to do with that mana. A hand with no lands is unplayable, which is why you may take a mulligan: shuffle back, draw seven again, then put one card on the bottom. This hand is fine. You are going first, so you skip your first draw.',
    term: 'mulligan',
    you: you({ hand: ['forest', 'forest', 'forest', 'forest', 'llanowarElves', 'grizzlyBears', 'crawWurm'] }),
    foe: foe({ hand: 7 }),
    turn: 0, phase: null, active: 'you',
    action: CONTINUE,
  },

  // --- your turn one ------------------------------------------------------
  {
    id: 't1-land',
    title: 'Turn one',
    coach: 'Lands are your mana, and you may play exactly one per turn — no more, no matter how many you are holding. That single restriction is the pacing mechanism of the whole game. Playing a land is not casting a spell: it does not use the stack and cannot be responded to. Play a Forest.',
    term: 'land',
    you: you({ hand: ['forest', 'forest', 'forest', 'forest', 'llanowarElves', 'grizzlyBears', 'crawWurm'] }),
    foe: foe({ hand: 7 }),
    turn: 1, phase: 'main1', active: 'you',
    action: click('forest', 'hand', 'Play a Forest', 'Select a Forest in your hand.'),
  },
  {
    id: 't1-elves',
    title: 'Spending mana',
    coach: 'Tapping that Forest — turning it sideways — produces one green mana. Llanowar Elves costs exactly {G}, so you can cast it right now. When you do, the Forest taps to pay for it.',
    term: 'mana',
    you: you({ hand: ['forest', 'forest', 'forest', 'llanowarElves', 'grizzlyBears', 'crawWurm'], board: [perm('forest')] }),
    foe: foe({ hand: 7 }),
    turn: 1, phase: 'main1', active: 'you',
    action: click('llanowarElves', 'hand', 'Cast Llanowar Elves', 'Select Llanowar Elves in your hand.'),
  },
  {
    id: 't1-sick',
    title: 'Summoning sickness',
    coach: 'The Forest is tapped: it paid for the Elves. Llanowar Elves can tap to make mana — but not this turn. A creature cannot attack or use an ability with {T} in its cost until you have controlled it since the start of your turn. It can still block, though. Blocking is never restricted this way. Nothing else to do: pass the turn.',
    term: 'summoningSickness',
    you: you({ hand: ['forest', 'forest', 'forest', 'grizzlyBears', 'crawWurm'], board: [tapped('forest'), perm('llanowarElves', { sick: true })] }),
    foe: foe({ hand: 7 }),
    turn: 1, phase: 'main1', active: 'you',
    action: { type: 'continue', label: 'Pass the turn' },
  },

  // --- opponent turn one --------------------------------------------------
  {
    id: 'foe-t1',
    title: 'Their turn',
    coach: 'Your Forest stays tapped: permanents untap only at the start of their controller’s turn, so what you spent stays spent until your next untap step. They draw, play a Mountain and cast Raging Goblin. It has haste, which is exactly the exception to the rule you just learned — haste means it can attack the turn it arrives.',
    term: 'haste',
    you: you({ hand: ['forest', 'forest', 'forest', 'grizzlyBears', 'crawWurm'], board: [tapped('forest'), perm('llanowarElves', { sick: true })] }),
    foe: foe({ hand: 6, board: [tapped('mountain'), perm('ragingGoblin')] }),
    turn: 1, phase: 'main1', active: 'foe',
    action: CONTINUE,
  },
  {
    id: 'foe-t1-attack',
    title: 'Block, or take it?',
    coach: 'The goblin attacks, and now you choose blockers. You could block with Llanowar Elves — summoning sickness never stops a block — but a 1/1 blocking a 1/1 means both die, and your Elves are worth far more than one damage. Take it.',
    you: you({ hand: ['forest', 'forest', 'forest', 'grizzlyBears', 'crawWurm'], board: [tapped('forest'), perm('llanowarElves', { sick: true })] }),
    foe: foe({ hand: 6, board: [tapped('mountain'), tapped('ragingGoblin', { attacking: true })] }),
    turn: 1, phase: 'block', active: 'foe',
    action: { type: 'continue', label: 'Take 1' },
  },

  // --- your turn two ------------------------------------------------------
  {
    id: 't2-untap',
    title: 'Turn two',
    coach: 'You took 1. Then your turn began: in the untap step everything you control untapped, and in the draw step you drew Giant Growth. Your Elves have been with you since the turn started, so they can tap for mana now. Two Forests would be two mana; the Elves make it three. First, your land for the turn.',
    term: 'untapStep',
    you: you({ life: 19, hand: ['forest', 'forest', 'forest', 'grizzlyBears', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('llanowarElves')] }),
    foe: foe({ hand: 6, board: [tapped('mountain'), tapped('ragingGoblin')] }),
    turn: 2, phase: 'main1', active: 'you',
    action: click('forest', 'hand', 'Play a Forest', 'Select a Forest in your hand.'),
  },
  {
    id: 't2-bears',
    title: 'Your first real threat',
    coach: 'Grizzly Bears costs {1}{G} — one generic mana, which any mana can pay, plus one specifically green. Two Forests covers it. Cast it.',
    term: 'manaValue',
    you: you({ life: 19, hand: ['forest', 'forest', 'grizzlyBears', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('llanowarElves')] }),
    foe: foe({ hand: 6, board: [tapped('mountain'), tapped('ragingGoblin')] }),
    turn: 2, phase: 'main1', active: 'you',
    action: click('grizzlyBears', 'hand', 'Cast Grizzly Bears', 'Select Grizzly Bears in your hand.'),
  },
  {
    id: 't2-pass',
    title: 'Nothing worth attacking with',
    coach: 'Both Forests tapped to pay for the Bears, which is summoning sick. Your Elves could attack — their goblin is still tapped from attacking, so nothing could block — but one damage is not worth much, and a tapped Elves could not block on their turn or make mana for a trick. Not every turn has an attack in it. Pass.',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [tapped('forest'), tapped('forest'), perm('llanowarElves'), perm('grizzlyBears', { sick: true })] }),
    foe: foe({ hand: 6, board: [tapped('mountain'), tapped('ragingGoblin')] }),
    turn: 2, phase: 'main1', active: 'you',
    action: { type: 'continue', label: 'Pass the turn' },
  },

  // --- opponent turn two: blocking ----------------------------------------
  {
    id: 'foe-t2',
    title: 'They commit',
    coach: 'They untap and draw, play a second Mountain and cast Goblin Piker, tapping both Mountains. Then Raging Goblin attacks again. Your Bears is summoning sick, but blocking is never restricted — and a 2/2 is looking at a 1/1 attacker.',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [tapped('forest'), tapped('forest'), perm('llanowarElves'), perm('grizzlyBears', { sick: true })] }),
    foe: foe({ hand: 5, board: [tapped('mountain'), tapped('mountain'), tapped('ragingGoblin', { attacking: true }), perm('goblinPiker', { sick: true })] }),
    turn: 2, phase: 'block', active: 'foe',
    action: click('grizzlyBears', 'board', 'Block with Grizzly Bears', 'Select your Grizzly Bears to block with it.'),
  },
  {
    id: 't2-block-result',
    title: 'How combat damage works',
    coach: 'Blocking does not tap your Bears. Both creatures deal damage equal to their power, at the same time. The goblin deals 1 to your 2/2 — not enough to kill it, and that damage is removed at the end of the turn. Your Bears deals 2 to a 1/1. The goblin dies. You took nothing.',
    term: 'combat',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [tapped('forest'), tapped('forest'), perm('llanowarElves'), perm('grizzlyBears', { sick: true })] }),
    foe: foe({ hand: 5, board: [tapped('mountain'), tapped('mountain'), perm('goblinPiker', { sick: true })], graveyard: ['ragingGoblin'] }),
    turn: 2, phase: 'damage', active: 'foe',
    action: CONTINUE,
  },

  // --- your turn three: the stack -----------------------------------------
  {
    id: 't3-land',
    title: 'Turn three',
    coach: 'Untap, draw — another Forest. Play it. With the Elves that is four mana available — but hold on before you spend it. Their Mountains are still tapped from casting the Piker, so they have no mana to spend on your turn.',
    you: you({ life: 19, hand: ['forest', 'forest', 'forest', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')] }),
    foe: foe({ hand: 5, board: [tapped('mountain'), tapped('mountain'), perm('goblinPiker', { sick: true })], graveyard: ['ragingGoblin'] }),
    turn: 3, phase: 'main1', active: 'you',
    action: click('forest', 'hand', 'Play a Forest', 'Select a Forest in your hand.'),
  },
  {
    id: 't3-attack',
    title: 'Attacking is a question, not an answer',
    coach: 'Combat begins, and you choose attackers. Your 2/2 Bears can attack; attacking taps it. Their Goblin Piker is a 2/1 and can block — sickness does not stop a block — and if it does, both creatures die. That trade is fine for them. But you are holding Giant Growth. Attack anyway.',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')] }),
    foe: foe({ hand: 5, board: [tapped('mountain'), tapped('mountain'), perm('goblinPiker', { sick: true })], graveyard: ['ragingGoblin'] }),
    turn: 3, phase: 'attack', active: 'you',
    action: click('grizzlyBears', 'board', 'Attack with Grizzly Bears', 'Select your Grizzly Bears to attack with it.'),
  },
  {
    id: 't3-blocked',
    title: 'They block',
    coach: 'Goblin Piker blocks. Right now, before damage, everyone gets a chance to act. This window is the single most important thing that separates Magic from most card games. Cast Giant Growth on your Bears; the Elves will tap to pay for it.',
    term: 'priority',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), tapped('grizzlyBears', { attacking: true })] }),
    foe: foe({ hand: 5, board: [tapped('mountain'), tapped('mountain'), perm('goblinPiker', { sick: true, blocking: true })], graveyard: ['ragingGoblin'] }),
    turn: 3, phase: 'block', active: 'you',
    action: click('giantGrowth', 'hand', 'Cast Giant Growth on your Bears', 'Select Giant Growth in your hand.'),
  },
  {
    id: 't3-stack',
    title: 'The stack',
    coach: 'Giant Growth does not happen immediately. It is on the stack, waiting, and your opponent gets a chance to respond. If they had a trick of their own, theirs would go on top of yours and resolve first — last on, first off. They have no untapped Mountain and nothing to cast. They pass, and it resolves.',
    term: 'stack',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), tapped('llanowarElves'), tapped('grizzlyBears', { attacking: true })] }),
    foe: foe({ hand: 5, board: [tapped('mountain'), tapped('mountain'), perm('goblinPiker', { sick: true, blocking: true })], graveyard: ['ragingGoblin'] }),
    turn: 3, phase: 'block', active: 'you',
    action: CONTINUE,
  },
  {
    id: 't3-result',
    title: 'What a combat trick buys',
    coach: 'Your Bears is a 5/5 until end of turn. It deals 5 to a 2/1 — dead — and takes 2, which a 5/5 shrugs off. You spent one card to kill one card and keep your creature: an even trade in cards that leaves you ahead on the board. That is what a combat trick buys you.',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), tapped('llanowarElves'), tapped('grizzlyBears', { buff: '+3/+3' })], graveyard: ['giantGrowth'] }),
    foe: foe({ hand: 5, board: [tapped('mountain'), tapped('mountain')], graveyard: ['ragingGoblin', 'goblinPiker'] }),
    turn: 3, phase: 'damage', active: 'you',
    action: CONTINUE,
  },
  {
    id: 't3-no-damage',
    title: 'Blocked means blocked',
    coach: 'Note that your opponent took no damage. A blocked creature deals its damage to the blocker, not to the player — even a 5/5 against a 2/1. Only creatures with trample push the excess through. Combat is over, and you are in your second main phase with nothing left worth casting. Pass the turn.',
    term: 'trample',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), tapped('llanowarElves'), tapped('grizzlyBears', { buff: '+3/+3' })], graveyard: ['giantGrowth'] }),
    foe: foe({ hand: 5, board: [tapped('mountain'), tapped('mountain')], graveyard: ['ragingGoblin', 'goblinPiker'] }),
    turn: 3, phase: 'main2', active: 'you',
    action: { type: 'continue', label: 'Pass the turn' },
  },

  // --- opponent turn three: removal ---------------------------------------
  {
    id: 'foe-t3',
    title: 'Removal',
    coach: 'They untap, draw and play a third Mountain, then Shock your Grizzly Bears — 2 damage to a 2/2 kills it. This is removal, and every deck needs some. You could have responded if you had an instant: their Shock sat on the stack first, exactly like your Giant Growth did.',
    term: 'removal',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), tapped('llanowarElves')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 4, board: [tapped('mountain'), perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock'] }),
    turn: 3, phase: 'main1', active: 'foe',
    action: CONTINUE,
  },

  // --- your turn four: the curve ------------------------------------------
  {
    id: 't4-curve',
    title: 'Turn four — the card you cannot cast yet',
    coach: 'You untap, draw a Forest and play it. Four Forests and the Elves is five mana. Craw Wurm costs six. One short — and this is what people mean by "curve": a deck full of expensive cards does nothing for the first four turns.',
    term: 'curve',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 4, board: [tapped('mountain'), perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock'] }),
    turn: 4, phase: 'main1', active: 'you',
    action: { type: 'continue', label: 'Pass the turn' },
  },
  {
    id: 'foe-t4',
    title: 'They rebuild',
    coach: 'They untap and draw, play a fourth Mountain and cast Hill Giant — a 3/3 for four mana, tapping all four Mountains. Bigger than anything you have on the table. It is summoning sick, so it cannot attack this turn.',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 3, board: [tapped('mountain'), tapped('mountain'), tapped('mountain'), tapped('mountain'), perm('hillGiant', { sick: true })], graveyard: ['ragingGoblin', 'goblinPiker', 'shock'] }),
    turn: 4, phase: 'main1', active: 'foe',
    action: CONTINUE,
  },

  // --- your turn five: the payoff -----------------------------------------
  {
    id: 't5-wurm',
    title: 'Turn five — the payoff',
    coach: 'Untap, draw — a fifth Forest — and play it. Five lands plus Llanowar Elves is six mana, and Craw Wurm costs exactly six: {4}{G}{G}, four of any kind and two green. That one-mana creature you played on turn one is why you are casting a six-drop on turn five instead of turn six. That is ramp.',
    term: 'ramp',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 3, board: [tapped('mountain'), tapped('mountain'), tapped('mountain'), tapped('mountain'), perm('hillGiant', { sick: true })], graveyard: ['ragingGoblin', 'goblinPiker', 'shock'] }),
    turn: 5, phase: 'main1', active: 'you',
    action: click('crawWurm', 'hand', 'Cast Craw Wurm', 'Select Craw Wurm in your hand.'),
  },
  {
    id: 'foe-t5',
    title: 'They attack into a 6/4',
    coach: 'Everything you had tapped to pay for the Wurm. They untap and draw, and Hill Giant attacks anyway — perhaps hoping you will not block. Your Wurm is summoning sick, but blocking is never restricted. A 6/4 kills their 3/3 and takes 3, which four toughness survives. Block.',
    you: you({ life: 19, hand: ['forest', 'forest'], board: [tapped('forest'), tapped('forest'), tapped('forest'), tapped('forest'), tapped('forest'), tapped('llanowarElves'), perm('crawWurm', { sick: true })], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 4, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('mountain'), tapped('hillGiant', { attacking: true })], graveyard: ['ragingGoblin', 'goblinPiker', 'shock'] }),
    turn: 5, phase: 'block', active: 'foe',
    action: click('crawWurm', 'board', 'Block with Craw Wurm', 'Select your Craw Wurm to block with it.'),
  },
  {
    id: 't6-attack',
    title: 'Turn six — now you are the beatdown',
    coach: 'Their Giant is in the graveyard and their board has no creatures. You untap and draw. Your 6/4 has been with you since the turn began, so it can attack. Attack.',
    you: you({ life: 19, hand: ['forest', 'forest', 'forest'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('crawWurm')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 4, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock', 'hillGiant'] }),
    turn: 6, phase: 'attack', active: 'you',
    action: click('crawWurm', 'board', 'Attack with Craw Wurm', 'Select your Craw Wurm to attack with it.'),
  },
  {
    id: 'timeskip',
    title: 'A few turns later',
    coach: 'Unblocked, Craw Wurm takes them from 20 to 14. They find no answer for it over the next two turns, and it connects twice more. They are at 2, and it is your turn again.',
    you: you({ life: 19, hand: ['forest', 'forest', 'forest'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('crawWurm')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ life: 2, hand: 5, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock', 'hillGiant'] }),
    turn: 8, phase: 'attack', active: 'you',
    action: click('crawWurm', 'board', 'Attack for the win', 'Select your Craw Wurm one more time.'),
  },
  {
    id: 'win',
    title: 'You win',
    coach: 'Six damage into 2 life. They are at zero, and the game ends immediately — nobody has to do anything or announce anything. That automatic check is called a state-based action, and it is also what kills creatures the moment they have lethal damage.',
    term: 'stateBasedActions',
    you: you({ life: 19, hand: ['forest', 'forest', 'forest'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), tapped('crawWurm', { attacking: true })], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ life: 0, hand: 5, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock', 'hillGiant'] }),
    turn: 8, phase: 'damage', active: 'you',
    won: true,
    action: { type: 'continue', label: 'Finish' },
  },
]

export const TUTORIAL_LENGTH = TUTORIAL.length

/**
 * The beat order the first release shipped, so a numeric position saved by
 * that build lands on the same beat by id rather than on whatever now sits
 * at that index. Saved positions are ids from now on.
 */
export const LEGACY_BEAT_IDS = [
  'intro', 'hand', 't1-land', 't1-elves', 't1-sick', 'foe-t1', 'foe-t1-attack',
  't2-untap', 't2-bears', 't2-pass', 'foe-t2', 't2-block-result',
  't3-land', 't3-attack', 't3-blocked', 't3-stack', 't3-result', 't3-no-damage',
  'foe-t3', 't4-curve', 'foe-t4-attack', 'foe-t4-shock',
  't5-wurm', 'foe-t5', 't6-attack', 'timeskip', 'win',
]

/** Beats that no longer exist map to the beat that now teaches the same moment. */
const RETIRED_BEATS = { 'foe-t4-attack': 'foe-t4', 'foe-t4-shock': 'foe-t3' }

/**
 * Where a saved position points now: a beat id, or a number from the first
 * release. Anything unknown starts over, which is the honest answer to a
 * position the script no longer has.
 */
export function beatIndexFor(saved) {
  let id = saved
  if (typeof saved === 'number') id = LEGACY_BEAT_IDS[saved] ?? null
  if (typeof id !== 'string') return 0
  id = RETIRED_BEATS[id] ?? id
  const index = TUTORIAL.findIndex((beat) => beat.id === id)
  return index >= 0 ? index : 0
}
