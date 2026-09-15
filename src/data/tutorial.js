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

const you = (over) => ({ life: 20, hand: [], board: [], graveyard: [], ...over })
const foe = (over) => ({ life: 20, hand: 0, board: [], graveyard: [], ...over })

/** A permanent on the battlefield. `sick` means it cannot attack yet. */
const perm = (id, over = {}) => ({ id, tapped: false, sick: false, ...over })

const CONTINUE = { type: 'continue', label: 'Next' }
const click = (cardId, zone, label, hint) => ({ type: 'click', cardId, zone, label, hint })

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
    coach: 'Seven cards. Four of them are Forests — your mana. The other three are things you want to do with that mana. A hand with no lands is unplayable, which is why you may take a mulligan: shuffle back, draw seven again, then put one card on the bottom. This hand is fine.',
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
    coach: 'Lands are your mana, and you may play exactly one per turn — no more, no matter how many you are holding. That single restriction is the pacing mechanism of the whole game. Play a Forest.',
    term: 'land',
    you: you({ hand: ['forest', 'forest', 'forest', 'forest', 'llanowarElves', 'grizzlyBears', 'crawWurm'] }),
    foe: foe({ hand: 7 }),
    turn: 1, phase: 'main1', active: 'you',
    action: click('forest', 'hand', 'Play a Forest', 'Tap the Forest in your hand.'),
  },
  {
    id: 't1-elves',
    title: 'Spending mana',
    coach: 'Tapping that Forest produces one green mana. Llanowar Elves costs exactly {G}, so you can cast it right now. Go ahead.',
    term: 'mana',
    you: you({ hand: ['forest', 'forest', 'forest', 'llanowarElves', 'grizzlyBears', 'crawWurm'], board: [perm('forest')] }),
    foe: foe({ hand: 7 }),
    turn: 1, phase: 'main1', active: 'you',
    action: click('llanowarElves', 'hand', 'Cast Llanowar Elves', 'Tap Llanowar Elves in your hand.'),
  },
  {
    id: 't1-sick',
    title: 'Summoning sickness',
    coach: 'Llanowar Elves can tap to make mana — but not this turn. A creature cannot attack or use an ability with {T} in its cost until you have controlled it since the start of your turn. It can still block, though. Blocking is never restricted this way.',
    term: 'summoningSickness',
    you: you({ hand: ['forest', 'forest', 'forest', 'grizzlyBears', 'crawWurm'], board: [perm('forest', { tapped: true }), perm('llanowarElves', { sick: true })] }),
    foe: foe({ hand: 7 }),
    turn: 1, phase: 'main1', active: 'you',
    action: { type: 'continue', label: 'Pass the turn' },
  },

  // --- opponent turn one --------------------------------------------------
  {
    id: 'foe-t1',
    title: 'Their turn',
    coach: 'They play a Mountain and cast Raging Goblin. It has haste, which is exactly the exception to the rule you just learned — haste means it can attack the turn it arrives.',
    term: 'haste',
    you: you({ hand: ['forest', 'forest', 'forest', 'grizzlyBears', 'crawWurm'], board: [perm('forest'), perm('llanowarElves')] }),
    foe: foe({ hand: 5, board: [perm('mountain', { tapped: true }), perm('ragingGoblin')] }),
    turn: 1, phase: 'main1', active: 'foe',
    action: CONTINUE,
  },
  {
    id: 'foe-t1-attack',
    title: 'You take one',
    coach: 'The goblin attacks. You could block with Llanowar Elves — but a 1/1 blocking a 1/1 means both die, and your Elves are worth far more than one damage. Take it.',
    you: you({ life: 19, hand: ['forest', 'forest', 'forest', 'grizzlyBears', 'crawWurm'], board: [perm('forest'), perm('llanowarElves')] }),
    foe: foe({ hand: 5, board: [perm('mountain', { tapped: true }), perm('ragingGoblin', { tapped: true })] }),
    turn: 1, phase: 'combat', active: 'foe',
    action: CONTINUE,
  },

  // --- your turn two ------------------------------------------------------
  {
    id: 't2-untap',
    title: 'Turn two',
    coach: 'Everything you control untaps, and you draw a card. Your Elves are no longer summoning sick, so they can tap for mana now. Two Forests would be two mana; the Elves make it three.',
    term: 'untapStep',
    you: you({ life: 19, hand: ['forest', 'forest', 'forest', 'grizzlyBears', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('llanowarElves')] }),
    foe: foe({ hand: 5, board: [perm('mountain'), perm('ragingGoblin')] }),
    turn: 2, phase: 'draw', active: 'you',
    action: click('forest', 'hand', 'Play a Forest', 'Tap a Forest in your hand.'),
  },
  {
    id: 't2-bears',
    title: 'Your first real threat',
    coach: 'Grizzly Bears costs {1}{G} — one generic mana plus one specifically green. Two Forests covers it. Cast it.',
    term: 'manaValue',
    you: you({ life: 19, hand: ['forest', 'forest', 'grizzlyBears', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('llanowarElves')] }),
    foe: foe({ hand: 5, board: [perm('mountain'), perm('ragingGoblin')] }),
    turn: 2, phase: 'main1', active: 'you',
    action: click('grizzlyBears', 'hand', 'Cast Grizzly Bears', 'Tap Grizzly Bears in your hand.'),
  },
  {
    id: 't2-pass',
    title: 'Nothing to attack with',
    coach: 'Bears is summoning sick, and attacking with your 1/1 Elves into their untapped 1/1 goblin just trades away your mana creature. Not every turn has an attack in it. Pass.',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [perm('forest', { tapped: true }), perm('forest', { tapped: true }), perm('llanowarElves'), perm('grizzlyBears', { sick: true })] }),
    foe: foe({ hand: 5, board: [perm('mountain'), perm('ragingGoblin')] }),
    turn: 2, phase: 'main1', active: 'you',
    action: { type: 'continue', label: 'Pass the turn' },
  },

  // --- opponent turn two: blocking ----------------------------------------
  {
    id: 'foe-t2',
    title: 'They commit',
    coach: 'A second Mountain, a Goblin Piker, and Raging Goblin attacks again. This time you have a 2/2 untapped — and the attacker is a 1/1.',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')] }),
    foe: foe({ hand: 3, board: [perm('mountain'), perm('mountain', { tapped: true }), perm('ragingGoblin', { tapped: true, attacking: true }), perm('goblinPiker', { sick: true })] }),
    turn: 2, phase: 'combat', active: 'foe',
    action: click('grizzlyBears', 'board', 'Block with Grizzly Bears', 'Tap your Grizzly Bears to block.'),
  },
  {
    id: 't2-block-result',
    title: 'How combat damage works',
    coach: 'Both creatures deal damage equal to their power, at the same time. The goblin deals 1 to your 2/2 — not enough to kill it, and that damage wears off at end of turn. Your Bears deals 2 to a 1/1. The goblin dies. You took nothing.',
    term: 'combat',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')] }),
    foe: foe({ hand: 3, board: [perm('mountain'), perm('mountain', { tapped: true }), perm('goblinPiker', { sick: true })], graveyard: ['ragingGoblin'] }),
    turn: 2, phase: 'combat', active: 'foe',
    action: CONTINUE,
  },

  // --- your turn three: the stack -----------------------------------------
  {
    id: 't3-land',
    title: 'Turn three',
    coach: 'Play your third Forest. With the Elves that is four mana available — but hold on before you spend it.',
    you: you({ life: 19, hand: ['forest', 'forest', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')] }),
    foe: foe({ hand: 3, board: [perm('mountain'), perm('mountain'), perm('goblinPiker')], graveyard: ['ragingGoblin'] }),
    turn: 3, phase: 'main1', active: 'you',
    action: click('forest', 'hand', 'Play a Forest', 'Tap a Forest in your hand.'),
  },
  {
    id: 't3-attack',
    title: 'Attacking is a question, not an answer',
    coach: 'Your 2/2 Bears can attack. Their Goblin Piker is a 2/1 and can block it — and if it does, both creatures die. That trade is fine for them. But you are holding Giant Growth. Attack anyway.',
    you: you({ life: 19, hand: ['forest', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')] }),
    foe: foe({ hand: 3, board: [perm('mountain'), perm('mountain'), perm('goblinPiker')], graveyard: ['ragingGoblin'] }),
    turn: 3, phase: 'main1', active: 'you',
    action: click('grizzlyBears', 'board', 'Attack with Grizzly Bears', 'Tap your Grizzly Bears to attack.'),
  },
  {
    id: 't3-blocked',
    title: 'They block',
    coach: 'Goblin Piker blocks. Right now, before damage, everyone gets a chance to act. This window is the single most important thing that separates Magic from most card games.',
    term: 'priority',
    you: you({ life: 19, hand: ['forest', 'crawWurm', 'giantGrowth'], board: [perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears', { tapped: true, attacking: true })] }),
    foe: foe({ hand: 3, board: [perm('mountain'), perm('mountain'), perm('goblinPiker', { blocking: true })], graveyard: ['ragingGoblin'] }),
    turn: 3, phase: 'combat', active: 'you',
    action: click('giantGrowth', 'hand', 'Cast Giant Growth on your Bears', 'Tap Giant Growth in your hand.'),
  },
  {
    id: 't3-stack',
    title: 'The stack',
    coach: 'Giant Growth does not happen immediately. It goes on the stack, and your opponent gets one more chance to respond. If they had a trick of their own, theirs would go on top of yours and resolve first — last on, first off. They have nothing. It resolves.',
    term: 'stack',
    you: you({ life: 19, hand: ['forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves', { tapped: true }), perm('grizzlyBears', { tapped: true, attacking: true, buff: '+3/+3' })] }),
    foe: foe({ hand: 3, board: [perm('mountain'), perm('mountain'), perm('goblinPiker', { blocking: true })], graveyard: ['ragingGoblin'] }),
    turn: 3, phase: 'combat', active: 'you',
    action: CONTINUE,
  },
  {
    id: 't3-result',
    title: 'A two-for-one',
    coach: 'Your Bears is a 5/5 until end of turn. It deals 5 to a 2/1 — dead — and takes 2, which a 5/5 shrugs off. You spent one card to kill one card and keep your creature. That is what a combat trick buys you.',
    you: you({ life: 19, hand: ['forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves', { tapped: true }), perm('grizzlyBears', { tapped: true })], graveyard: ['giantGrowth'] }),
    foe: foe({ hand: 3, board: [perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker'] }),
    turn: 3, phase: 'combat', active: 'you',
    action: CONTINUE,
  },
  {
    id: 't3-no-damage',
    title: 'Blocked means blocked',
    coach: 'Note that your opponent took no damage. A blocked creature deals its damage to the blocker, not to the player — even a 5/5 against a 2/1. Only creatures with trample push the excess through.',
    term: 'trample',
    you: you({ life: 19, hand: ['forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves', { tapped: true }), perm('grizzlyBears', { tapped: true })], graveyard: ['giantGrowth'] }),
    foe: foe({ hand: 3, board: [perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker'] }),
    turn: 3, phase: 'combat', active: 'you',
    action: { type: 'continue', label: 'Pass the turn' },
  },

  // --- opponent turn three and four: removal ------------------------------
  {
    id: 'foe-t3',
    title: 'They rebuild',
    coach: 'Third Mountain, and a Hill Giant — a 3/3. Bigger than your Bears. You will not be attacking into that profitably.',
    you: you({ life: 19, hand: ['forest', 'crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')], graveyard: ['giantGrowth'] }),
    foe: foe({ hand: 2, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('hillGiant', { sick: true })], graveyard: ['ragingGoblin', 'goblinPiker'] }),
    turn: 3, phase: 'main1', active: 'foe',
    action: CONTINUE,
  },
  {
    id: 't4-curve',
    title: 'Turn four — the card you cannot cast yet',
    coach: 'You draw a fourth Forest and play it. With the Elves that is five mana. Craw Wurm costs six. One short — and this is what people mean by "curve": a deck full of expensive cards does nothing for the first four turns.',
    term: 'curve',
    you: you({ life: 19, hand: ['crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')], graveyard: ['giantGrowth'] }),
    foe: foe({ hand: 2, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('hillGiant')], graveyard: ['ragingGoblin', 'goblinPiker'] }),
    turn: 4, phase: 'main1', active: 'you',
    action: { type: 'continue', label: 'Pass the turn' },
  },
  {
    id: 'foe-t4-attack',
    title: 'Block, or take it?',
    coach: 'Hill Giant attacks. Blocking with your 2/2 kills your Bears and leaves their 3/3 standing — you lose a card to save 3 life at 19. Do not block.',
    you: you({ life: 19, hand: ['crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('grizzlyBears')], graveyard: ['giantGrowth'] }),
    foe: foe({ hand: 2, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('hillGiant', { tapped: true, attacking: true })], graveyard: ['ragingGoblin', 'goblinPiker'] }),
    turn: 4, phase: 'combat', active: 'foe',
    action: { type: 'continue', label: 'Take 3' },
  },
  {
    id: 'foe-t4-shock',
    title: 'Removal',
    coach: 'Then they Shock your Grizzly Bears — 2 damage to a 2/2 kills it. This is removal, and every deck needs some. Note that you could have responded if you had an instant: their Shock sits on the stack first, exactly like your Giant Growth did.',
    term: 'removal',
    you: you({ life: 16, hand: ['crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 1, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('hillGiant', { tapped: true })], graveyard: ['ragingGoblin', 'goblinPiker', 'shock'] }),
    turn: 4, phase: 'main2', active: 'foe',
    action: CONTINUE,
  },

  // --- your turn five: the payoff -----------------------------------------
  {
    id: 't5-wurm',
    title: 'Turn five — the payoff',
    coach: 'Fifth Forest. Five lands plus Llanowar Elves is six mana, and Craw Wurm costs exactly six. That one-mana creature you played on turn one is why you are casting a six-drop on turn five instead of turn six. That is ramp.',
    term: 'ramp',
    you: you({ life: 16, hand: ['crawWurm'], board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 1, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('hillGiant')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock'] }),
    turn: 5, phase: 'main1', active: 'you',
    action: click('crawWurm', 'hand', 'Cast Craw Wurm', 'Tap Craw Wurm in your hand.'),
  },
  {
    id: 'foe-t5',
    title: 'They attack into a 6/4',
    coach: 'They swing with Hill Giant anyway — perhaps hoping you will not block. Block. Your 6/4 kills their 3/3 and takes 3, which a 4-toughness creature survives.',
    you: you({ life: 16, board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('crawWurm')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 1, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('hillGiant', { tapped: true, attacking: true })], graveyard: ['ragingGoblin', 'goblinPiker', 'shock'] }),
    turn: 5, phase: 'combat', active: 'foe',
    action: click('crawWurm', 'board', 'Block with Craw Wurm', 'Tap your Craw Wurm to block.'),
  },
  {
    id: 't6-attack',
    title: 'Turn six — now you are the beatdown',
    coach: 'Their board is empty. Your 6/4 is not summoning sick any more. Attack.',
    you: you({ life: 16, board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('crawWurm')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ hand: 1, board: [perm('mountain'), perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock', 'hillGiant'] }),
    turn: 6, phase: 'main1', active: 'you',
    action: click('crawWurm', 'board', 'Attack with Craw Wurm', 'Tap your Craw Wurm to attack.'),
  },
  {
    id: 'timeskip',
    title: 'A few turns later',
    coach: 'Unblocked, Craw Wurm takes them from 20 to 14. They find no answer for it over the next two turns, and it connects twice more. They are at 2, and it is your turn.',
    you: you({ life: 16, board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('crawWurm')], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ life: 2, hand: 2, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock', 'hillGiant'] }),
    turn: 8, phase: 'main1', active: 'you',
    action: click('crawWurm', 'board', 'Attack for the win', 'Tap your Craw Wurm one more time.'),
  },
  {
    id: 'win',
    title: 'You win',
    coach: 'Six damage into 2 life. They are at zero, and the game ends immediately — nobody has to do anything or announce anything. That automatic check is called a state-based action, and it is also what kills creatures the moment they have lethal damage.',
    term: 'stateBasedActions',
    you: you({ life: 16, board: [perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('forest'), perm('llanowarElves'), perm('crawWurm', { tapped: true, attacking: true })], graveyard: ['giantGrowth', 'grizzlyBears'] }),
    foe: foe({ life: 0, hand: 2, board: [perm('mountain'), perm('mountain'), perm('mountain'), perm('mountain')], graveyard: ['ragingGoblin', 'goblinPiker', 'shock', 'hillGiant'] }),
    turn: 8, phase: 'combat', active: 'you',
    won: true,
    action: { type: 'continue', label: 'Finish' },
  },
]

export const TUTORIAL_LENGTH = TUTORIAL.length
