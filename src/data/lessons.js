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
    lessons: ['goal', 'turn', 'castingSpells', 'combatBasics', 'theStack', 'mulliganing'],
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
    lessons: ['landSystem', 'theStack', 'combatBasics', 'mulliganing', 'formatsPaper'],
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
          why: 'The draw step comes before anything they could do about it. Running out of cards is a real loss condition, and "decking" someone is a genuine strategy.' },
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
    ],
    terms: ['mana', 'manaValue', 'tapped'],
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
      'Damage is simultaneous. A 2/2 blocking a 2/2 means both die. A 2/2 blocking a 3/3 means only the 2/2 dies — and the 3/3 is fully healed at end of turn, because damage wears off.',
      'A blocked creature deals its damage to the blocker, not to the player, no matter how large it is. Only trample changes that.',
      'Creatures cannot attack the turn they arrive. They can block immediately, though — blocking is never restricted by summoning sickness.',
    ],
    terms: ['combat', 'summoningSickness', 'trample', 'firstStrike'],
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
      question: 'You cast a creature. In response, they cast a spell that destroys target creature, targeting it. What happens?',
      options: [
        { text: 'Their spell fizzles — your creature is not on the battlefield yet', correct: true,
          why: 'While on the stack your creature is a spell, not a creature. There is nothing for "destroy target creature" to target, so it cannot even be cast that way. This is why countering and destroying are different effects.' },
        { text: 'Your creature is destroyed before it arrives', correct: false,
          why: 'Destruction affects permanents on the battlefield. A spell on the stack has to be countered, not destroyed.' },
        { text: 'Your creature arrives and is then destroyed', correct: false,
          why: 'Their spell resolves first, and at that moment there is no legal target for it.' },
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

  commanderIntro: {
    id: 'commanderIntro',
    title: 'What Commander is and why everyone plays it',
    minutes: 5,
    body: [
      'A hundred cards, only one copy of each except basic lands, led by a legendary creature that starts in the command zone rather than your library. You can always cast your commander, and if it dies you can cast it again — for {2} more each time.',
      'Everything in your deck must fall inside your commander’s colour identity: every coloured mana symbol on the card, including in the rules text, not just the mana cost.',
      'You start at 40 life and usually play with three or four people. Games run long, politics is real, and the format is explicitly casual — there is no sideboard and the ban list is maintained by a separate group with different priorities.',
      'Commander damage is the other way to die: 21 combat damage from any single commander, tracked separately per commander, on top of your normal life total.',
      'If you were away for a while: this format barely existed as an official thing and is now the centre of gravity for paper Magic. Whole products are designed for it.',
    ],
    terms: ['commander', 'commandZone', 'colorIdentity', 'commanderDamage', 'singleton'],
    quiz: {
      question: 'Your commander is mono-green. Can you play a card whose mana cost is {2} but whose text reads "add {U}"?',
      options: [
        { text: 'No — the {U} in the text is part of its colour identity', correct: true,
          why: 'Colour identity counts every coloured mana symbol anywhere on the card, not just the cost. This trips up almost everyone once.' },
        { text: 'Yes — its mana cost is colourless', correct: false,
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
