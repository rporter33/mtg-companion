// Guide layer two: structured lesson modules.
//
// Four tracks, because a returning player and someone who has never held a card
// need opposite things. Every lesson is short, ends in a question with a real
// wrong answer, and explains *why* rather than restating the rule.

export const TRACKS = [
  {
    id: 'beginner',
    name: 'Never played a card game',
    blurb: 'Start from zero. What the pieces are, what a turn is, how you win.',
    lessons: ['goal', 'turn', 'castingSpells', 'combatBasics', 'theStack', 'mulliganing', 'fiveColors'],
  },
  {
    id: 'arena',
    name: 'I play Arena, new to paper',
    blurb: 'You know the rules because the client enforced them. Here is what it was doing for you.',
    lessons: ['theStack', 'priorityInPaper', 'formatsPaper', 'commanderIntro', 'sideboarding'],
  },
  {
    id: 'tcg',
    name: 'I play other card games',
    blurb: 'Hearthstone, Pokémon, Yu-Gi-Oh. Here is what Magic does differently.',
    lessons: ['landSystem', 'fiveColors', 'theStack', 'combatBasics', 'mulliganing', 'formatsPaper'],
  },
  {
    id: 'returning',
    name: 'I played years ago',
    blurb: 'The delta. What changed, and what Commander became while you were away.',
    lessons: ['whatChanged', 'commanderIntro', 'formatsPaper', 'sideboarding'],
  },
]

export const LESSONS = {
  goal: {
    id: 'goal',
    title: 'How you actually win',
    minutes: 2,
    body: [
      'You start at 20 life. So does your opponent. Get them to zero and you win — that is the whole objective, and roughly ninety percent of every card in the game exists to serve it.',
      'There are two other ways to lose that you will meet eventually. If you need to draw a card and your library is empty, you lose. And ten poison counters will do it too. Neither comes up often, but both are real.',
      'Everything else — creatures, spells, lands — is machinery pointed at that one number.',
    ],
    terms: ['library', 'mana'],
    quiz: {
      question: 'Your opponent is at 3 life and has no cards in their library. On their turn, what happens first?',
      options: [
        { text: 'They draw from an empty library and lose', correct: true,
          why: 'Their untap and upkeep steps pass with nothing to do, then the draw step arrives before anything they could do about it. Running out of cards is a real loss condition, and "decking" someone is a genuine strategy.' },
        { text: 'Nothing — you cannot lose from an empty library', correct: false,
          why: 'You can. The loss happens the moment you would draw from an empty library, not when it empties.' },
        { text: 'They shuffle their graveyard back in', correct: false,
          why: 'That is how some other card games work, but not Magic. Your graveyard stays where it is.' },
      ],
    },
  },

  turn: {
    id: 'turn',
    title: 'The shape of a turn',
    minutes: 3,
    body: [
      'Every turn runs the same sequence: untap everything you control, a brief upkeep window, draw a card, first main phase, combat, second main phase, end step.',
      'You will spend almost all of your time in the two main phases and in combat. The others usually pass in a second — but they exist, and cards trigger during them.',
      'The one rule that shapes everything: you may play one land per turn. That is why a five-cost spell is a turn-five spell, and why the first few turns of a game feel like setup.',
    ],
    terms: ['untapStep', 'mainPhase', 'combat', 'land'],
    quiz: {
      question: 'You are holding three lands on turn two. How many can you play?',
      options: [
        { text: 'One', correct: true,
          why: 'One land per turn, no exceptions unless a card specifically says otherwise. This single limit is the pacing mechanism of the entire game.' },
        { text: 'All three — lands are free', correct: false,
          why: 'Lands do not cost mana, but you are still limited to one per turn. That limit is what makes expensive cards meaningfully expensive.' },
        { text: 'Two, one per main phase', correct: false,
          why: 'The limit is per turn, not per phase. You can play your land in either main phase, but only one of them.' },
      ],
    },
  },

  castingSpells: {
    id: 'castingSpells',
    title: 'Paying for things',
    minutes: 3,
    body: [
      'A cost like {2}{G} means two mana of any kind plus one that is specifically green. The number is generic, the symbols are not. A cost of {G}{G} cannot be paid with a Forest and a Mountain.',
      'Tapping a land produces mana. That mana empties at the end of each step, so unspent mana is simply gone — there is no saving up across turns.',
      'The total, ignoring colour, is the card’s mana value. A {2}{G} spell has mana value 3, and people will call it a three-drop.',
      'One more word to keep apart: colourless is not generic. A cost of {C} — a diamond — asks for mana that is specifically colourless, the kind a few lands and artifacts make, and a Forest cannot pay it. Generic {2} takes any mana at all, colourless included. Most cards never ask for {C}, but the difference matters the first time one does.',
    ],
    terms: ['mana', 'manaValue', 'tapped', 'colorless'],
    quiz: {
      question: 'You control two Forests and two Mountains. Can you cast a spell costing {2}{R}{R}?',
      options: [
        { text: 'Yes — two Mountains for the red, two Forests for the generic', correct: true,
          why: 'Generic mana can be paid with anything. The coloured symbols are the only part that constrains you.' },
        { text: 'No — you only have four mana and it costs four', correct: false,
          why: 'Four mana is exactly enough. {2}{R}{R} has mana value 4.' },
        { text: 'No — green mana cannot pay for a red spell', correct: false,
          why: 'Green mana cannot pay the {R} symbols, but it pays generic {2} perfectly well.' },
      ],
    },
  },

  combatBasics: {
    id: 'combatBasics',
    title: 'Attacking and blocking',
    minutes: 4,
    body: [
      'You declare which of your creatures attack. Then your opponent decides how to block. That order matters enormously: the attacker commits first, and the defender gets the information.',
      'Damage is simultaneous. A 2/2 blocking a 2/2 means both die. A 2/2 blocking a 3/3 means only the 2/2 dies — and the 3/3 is back to full at the end of the turn, because damage is removed then.',
      'A blocked creature deals its damage to the blocker, not to the player, no matter how large it is. Only trample changes that.',
      'Creatures cannot attack the turn they arrive, unless they have haste. They can block immediately, though — blocking is never restricted by summoning sickness.',
    ],
    terms: ['combat', 'summoningSickness', 'haste', 'trample', 'firstStrike'],
    quiz: {
      question: 'Your 5/5 attacks. They block with a 1/1. How much damage does your opponent take?',
      options: [
        { text: 'None', correct: true,
          why: 'Blocked is blocked. All 5 damage goes to the 1/1 unless your creature has trample, which is exactly why chump-blocking works.' },
        { text: 'Four — the excess carries over', correct: false,
          why: 'That is what trample does, and your creature does not have it. Without trample, none of it gets through.' },
        { text: 'Five — the 1/1 is too small to stop it', correct: false,
          why: 'Size does not matter for whether a block is legal. Any untapped creature can block any attacker.' },
      ],
    },
  },

  theStack: {
    id: 'theStack',
    title: 'The stack, and why instants matter',
    minutes: 4,
    body: [
      'When you cast a spell it does not happen immediately. It goes on the stack and waits. Your opponent gets a chance to respond before it resolves.',
      'If they do respond, their spell goes on top of yours — and resolves first. Last on, first off. This is why a counterspell works: it resolves before the thing it is countering.',
      'Instants can be cast during this window, including on your opponent’s turn. Sorceries cannot; they need your own main phase with an empty stack. That restriction is exactly why sorceries are allowed to be stronger.',
      'The practical upshot: leaving mana open is a real play. Your opponent has to act as though you might have something.',
    ],
    terms: ['stack', 'instant', 'sorcery', 'priority'],
    quiz: {
      question: 'You cast a creature. While it is on the stack, they want to cast a spell that says "destroy target creature". What can it target?',
      options: [
        { text: 'Any creature already on the battlefield — but not the one you are casting', correct: true,
          why: 'While it is on the stack your creature is a spell, not a creature, so it cannot be the target. To stop it arriving they would need a counterspell. This is why countering and destroying are different effects.' },
        { text: 'Your creature spell — it is destroyed before it arrives', correct: false,
          why: 'Destruction affects permanents on the battlefield. A spell on the stack has to be countered, not destroyed.' },
        { text: 'Nothing — they have to wait until it resolves', correct: false,
          why: 'They can cast it now at any creature already on the table, or wait for yours to arrive and respond to your next spell. What they cannot do is point it at a spell.' },
      ],
    },
  },

  mulliganing: {
    id: 'mulliganing',
    title: 'Mulligans, and keeping bad hands',
    minutes: 3,
    body: [
      'If you do not like your opening seven, you may mulligan: shuffle back, draw a fresh seven, then put one card on the bottom. Mulligan again and you bottom two, and so on.',
      'Because you draw a full seven every time and choose what to bottom, a mulligan costs much less than it looks like it does. You keep the best six of seven.',
      'New players keep far too many bad hands. A one-land hand in a deck with 24 lands is a loss most of the time. A six-card hand that functions beats a seven-card hand that does not.',
    ],
    terms: ['mulligan', 'curve'],
    quiz: {
      question: 'Your opening seven has one land and six spells costing three or more. Keep or mulligan?',
      options: [
        { text: 'Mulligan', correct: true,
          why: 'You need at least two more lands before anything in this hand happens, and you draw one card per turn. A functional six beats a hand that does nothing until turn five.' },
        { text: 'Keep — you will draw lands', correct: false,
          why: 'Sometimes. Mostly you will not, in time. This is the single most common mistake new players make, and it is expensive.' },
      ],
    },
  },

  landSystem: {
    id: 'landSystem',
    title: 'Why Magic makes you draw your resources',
    minutes: 4,
    body: [
      'Most card games hand you a resource automatically — a mana crystal per turn, an energy counter, a free card drop. Magic makes you draw your lands out of the same deck as your spells.',
      'This is genuinely controversial and it is the source of the game’s most-complained-about experience: flooding out on lands, or missing your third land drop and losing to nothing.',
      'It is also why deck construction is a real skill here in a way it is not elsewhere. Choosing 24 lands instead of 23 is a meaningful decision that changes how your deck plays.',
      'The practical consequence for you: land count and curve are not an afterthought. They are most of whether your deck works.',
    ],
    terms: ['land', 'curve', 'mulligan'],
    quiz: {
      question: 'Why does a deck full of six-cost cards usually lose, even if every card is powerful?',
      options: [
        { text: 'It does nothing for five turns while the opponent develops', correct: true,
          why: 'One land per turn means your first action is turn six. A deck curving out from turn one has had five turns of board development by then.' },
        { text: 'Expensive cards are weaker than cheap ones', correct: false,
          why: 'They are usually stronger — that is the trade. The problem is when you get to cast them, not what they do.' },
      ],
    },
  },

  priorityInPaper: {
    id: 'priorityInPaper',
    title: 'What Arena was doing for you',
    minutes: 4,
    body: [
      'Arena stops and asks you before every window where you could act, and it holds priority automatically when you have a legal response. In paper, nobody stops for you.',
      'The practical paper version: say what you are doing, and pause after each meaningful action. "I attack with these two" — pause. "Before blockers, anything?" — pause. Experienced players do this constantly and it is not rudeness, it is how you preserve your window to respond.',
      'The other thing Arena does silently is order triggers and check state-based actions. In paper you have to notice when a creature is dead. It still dies automatically, but a table can miss it for a whole turn.',
      'You are also allowed to ask what a card does. Any card in play is public information, and asking is normal at every level of play.',
    ],
    terms: ['priority', 'stack', 'stateBasedActions'],
    quiz: {
      question: 'Your opponent says "I attack with everything" and reaches for their dice. You want to cast an instant before blockers. What do you do?',
      options: [
        { text: 'Say so — the window is still open', correct: true,
          why: 'Casual paper play is forgiving about exact timing, and declaring attackers has not moved past the point where you can respond. Saying "hold on, before blocks" is completely normal.' },
        { text: 'Nothing — you missed the window', correct: false,
          why: 'You have not. Priority passes when both players agree it has, and at a kitchen table nobody has moved past declare attackers yet.' },
      ],
    },
  },

  formatsPaper: {
    id: 'formatsPaper',
    title: 'Which format should you play?',
    minutes: 4,
    body: [
      'Commander is the answer for most people. It is by far the most-played paper format, it is multiplayer, games are long and social, and a deck is 100 singleton cards led by a legendary creature. Most local shops run it every week.',
      'Standard is the cheapest entry to competitive play and uses only the most recent sets, but it rotates — cards leave the format each year, and your deck stops being legal.',
      'Modern and Pioneer do not rotate. A deck you build stays legal, which makes the higher upfront cost easier to justify. Modern is the faster and more powerful of the two.',
      'Pauper is commons only, and it is the cheapest serious format in the game by a wide margin. It is a genuinely good place to learn without spending much.',
    ],
    terms: ['commander', 'singleton', 'sideboard'],
    quiz: {
      question: 'You want a deck that stays legal and does not cost a fortune. Which is the best fit?',
      options: [
        { text: 'Pauper', correct: true,
          why: 'Commons only, non-rotating, and complete competitive decks often cost less than a single card in other formats.' },
        { text: 'Standard', correct: false,
          why: 'Cheapest to start, but it rotates — you will be rebuying every year, which usually costs more over time.' },
        { text: 'Vintage', correct: false,
          why: 'Non-rotating, but it is the most expensive format in the game. The reserved list makes some staples cost thousands.' },
      ],
    },
  },

  fiveColors: {
    id: 'fiveColors',
    title: 'The five colours, and which one is yours',
    minutes: 4,
    body: [
      'Every card belongs to one or more of five colours, and each colour is a philosophy before it is a set of cards. White values order and community and wins with a wide board kept safe. Blue values knowledge and control and wins by knowing more and countering what matters. Black values ambition at any price and wins by killing what stands in the way and draining the table. Red values passion and speed and wins by attacking first. Green values growth and wins by making more mana and bigger creatures than anyone else.',
      'Each colour is bad at something on purpose. White struggles to draw cards, blue struggles to remove a creature already in play, black struggles with artifacts and enchantments, red runs out of gas, green cannot stop a flyer or a spell. The game is balanced by those gaps, and a two-colour deck exists to cover one of them.',
      'Neighbours on the wheel — white and blue, blue and black, and so on round to green and white — are allies with overlapping ideas. Opposites are enemies, and enemy pairs are the most interesting decks: they combine things that should not go together.',
      'The deck builder has a dial that walks the wheel and names each pair as you go, with commanders in those colours and a starting list under it. It is the practical half of this lesson.',
    ],
    terms: ['colorIdentity', 'commander'],
    interactive: 'firstDeck',
    quiz: {
      question: 'You want a deck that draws lots of cards and stops opponents\u2019 spells, but you keep losing to one big creature. Which colour would you add?',
      options: [
        { text: 'White or black — both remove a creature already in play', correct: true,
          why: 'Blue\u2019s known weakness is a creature that has already resolved. White exiles it, black destroys it; either pair covers the gap.' },
        { text: 'More blue — a second counterspell', correct: false,
          why: 'A counterspell only works before the creature lands. Once it is on the battlefield, blue can bounce it at best, and it comes straight back.' },
        { text: 'Green — bigger creatures to block it', correct: false,
          why: 'Green can outgrow it, but that is a race, not an answer, and green adds nothing to the draw-and-counter plan you already like.' },
      ],
    },
  },

  commanderIntro: {
    id: 'commanderIntro',
    title: 'What Commander is and why everyone plays it',
    minutes: 5,
    body: [
      'A hundred cards, only one copy of each except basic lands, led by a commander that starts in the command zone rather than your library. Usually that is a legendary creature; some planeswalkers and some pairs of partners say on the card that they can lead too. You can cast your commander from the command zone whenever you could cast it from your hand, and if it would die or be exiled you can put it back there and cast it again — for {2} more each time.',
      'Everything in your deck must fall inside your commander’s colour identity: every coloured mana symbol on the card, in the cost and in the rules text — though not in reminder text.',
      'You start at 40 life and usually play with three or four people. Games run long, politics is real, and the format is casual at heart — there is no sideboard, and its ban list is kept separately from the tournament formats’ and moves on its own schedule.',
      'Commander damage is the other way to die: 21 combat damage from any single commander, tracked separately per commander, on top of your normal life total.',
      'If you were away for a while: this format barely existed as an official thing and is now the centre of gravity for paper Magic. Whole products are designed for it.',
    ],
    terms: ['commander', 'commandZone', 'colorIdentity', 'commanderDamage', 'singleton'],
    quiz: {
      question: 'Your commander is mono-green. Can you play a card whose mana cost is {2} but whose text reads "add {U}"?',
      options: [
        { text: 'No — the {U} in the text is part of its colour identity', correct: true,
          why: 'Colour identity counts every coloured mana symbol anywhere on the card, not just the cost. This trips up almost everyone once.' },
        { text: 'Yes — its mana cost has no coloured symbols', correct: false,
          why: 'The mana cost is only part of it. Symbols in the rules text count too.' },
      ],
    },
  },

  sideboarding: {
    id: 'sideboarding',
    title: 'Sideboards and best-of-three',
    minutes: 3,
    body: [
      'Competitive matches are best of three. After game one you know what your opponent is doing, and between games you may swap cards from a sideboard of up to fifteen.',
      'The count matters: take out as many as you put in, and your deck must still meet the minimum size. Cards go back before the next match, not the next game.',
      'Good sideboarding is mostly about taking out your dead cards, not jamming in hate. If your opponent has no creatures, your removal is the thing that should leave.',
      'Commander does not use sideboards at all.',
    ],
    terms: ['sideboard', 'removal'],
    quiz: {
      question: 'You bring in three cards from your sideboard. How many must you take out?',
      options: [
        { text: 'Exactly three', correct: true,
          why: 'Your deck has to stay at its registered size. Swap one for one.' },
        { text: 'None — the sideboard is extra', correct: false,
          why: 'It is not additional. It is a pool you swap from, keeping the deck the same size.' },
      ],
    },
  },

  whatChanged: {
    id: 'whatChanged',
    title: 'What changed while you were away',
    minutes: 4,
    body: [
      'Mulligans work differently. The London mulligan gives you a full seven every time and asks you to put cards on the bottom afterwards, which is much friendlier than the old draw-one-fewer rule.',
      'Converted mana cost is now called mana value. Same thing, new name. "Tap" and "untap" symbols got tidied up too.',
      'The legend rule changed: you may control one legendary permanent of a given name, and if you get a second you choose which to keep. It used to destroy both, and it used to apply across all players.',
      'Planeswalkers exist and are a core part of the game. Damage no longer "uses the stack", and mana burn is long gone — unspent mana simply empties with no penalty.',
      'And the big one: Commander went from a fringe format some people played to the primary way paper Magic is played.',
    ],
    terms: ['mulligan', 'manaValue', 'legendRule', 'planeswalker', 'commander'],
    quiz: {
      question: 'You have a Legendary creature out and draw a second copy. What happens if you play it?',
      options: [
        { text: 'You choose one to keep; the other goes to the graveyard', correct: true,
          why: 'The modern legend rule. It used to destroy both copies, which is what you may remember.' },
        { text: 'Both are destroyed', correct: false,
          why: 'That was the old rule. It changed some years ago.' },
        { text: 'You cannot play the second one', correct: false,
          why: 'You can play it. The rule resolves afterwards, and you choose.' },
      ],
    },
  },
}

export const LESSON_IDS = Object.keys(LESSONS)
