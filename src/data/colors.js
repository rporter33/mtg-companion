// The five colours, for someone choosing their first deck.
//
// Every page here is written for a person who has never built a deck: what
// the colour cares about, how it tends to win, where it struggles, and three
// cards that sum it up. The pairs are the ten two-colour combinations, each
// with the name players use and a sentence on what the pair does together.
// This is the app's own writing, not a quotation of anything official, and
// the screen says so.

export const COLOR_PAGES = {
  W: {
    id: 'W',
    name: 'White',
    values: 'Order, community, protection. White wants everyone to follow the same rules — and to have written them.',
    wins: 'A wide board of small creatures made bigger together, or a board wiped clean while it keeps its own pieces safe.',
    weak: 'Drawing cards and making extra mana. White runs out of gas if the game goes long and nothing helps it refill.',
    signature: ['Swords to Plowshares', 'Wrath of God', 'Serra Angel'],
    style: { pace: 'fast', threat: 'creatures', table: 'political', depth: 'simple' },
  },
  U: {
    id: 'U',
    name: 'Blue',
    values: 'Knowledge, patience, control. Blue would rather know what you are about to do than stop you from doing it — though it can do that too.',
    wins: 'Countering the spells that matter, drawing far more cards than anyone else, then landing one threat nobody can answer.',
    weak: 'Dealing with a creature already on the battlefield. Blue bounces and steals; it rarely destroys.',
    signature: ['Counterspell', 'Brainstorm', 'Rhystic Study'],
    style: { pace: 'patient', threat: 'spells', table: 'solo', depth: 'intricate' },
  },
  B: {
    id: 'B',
    name: 'Black',
    values: 'Ambition at any price. Black will pay life, cards or creatures for power, and it does not apologise.',
    wins: 'Killing whatever stands in the way, bringing its own creatures back from the graveyard, and draining life from the whole table.',
    weak: 'Artifacts and enchantments. Black answers creatures beautifully and everything else awkwardly.',
    signature: ['Demonic Tutor', 'Doom Blade', 'Gray Merchant of Asphodel'],
    style: { pace: 'patient', threat: 'creatures', table: 'solo', depth: 'intricate' },
  },
  R: {
    id: 'R',
    name: 'Red',
    values: 'Passion, freedom, now. Red acts first and thinks about it later, and is usually right to.',
    wins: 'Attacking early and often, pointing burn spells at faces, and turning every small creature into a hasty threat.',
    weak: 'The long game. Red spends its hand fast and has few ways to refill it; a stalled board is its worst enemy.',
    signature: ['Lightning Bolt', 'Goblin Guide', 'Chaos Warp'],
    style: { pace: 'fast', threat: 'spells', table: 'solo', depth: 'simple' },
  },
  G: {
    id: 'G',
    name: 'Green',
    values: 'Growth, instinct, the natural order. Green trusts that the biggest thing on the table should win, and makes sure it is the biggest.',
    wins: 'Making more mana than anyone by turn four, then casting creatures too large to fight through.',
    weak: 'Flyers and spells. Green fights on the ground with creatures; it has almost no counterspells and few ways to stop a flying attacker.',
    signature: ['Llanowar Elves', 'Cultivate', 'Craterhoof Behemoth'],
    style: { pace: 'patient', threat: 'creatures', table: 'political', depth: 'simple' },
  },
}

/** Wheel order. Adjacent colours are allies; the strip runs W→U→B→R→G→W. */
export const WHEEL = ['W', 'U', 'B', 'R', 'G']

export const PAIRS = {
  WU: { id: 'WU', name: 'Azorius', does: 'Control the game with counterspells and board wipes, then win with a few resilient creatures or flyers.' },
  UB: { id: 'UB', name: 'Dimir', does: 'Trickery and attrition: mill, steal, reanimate, and answer everything one for one.' },
  BR: { id: 'BR', name: 'Rakdos', does: 'Aggression with teeth: cheap creatures, sacrifice for value, and damage to every face at the table.' },
  RG: { id: 'RG', name: 'Gruul', does: 'Big creatures fast: ramp into monsters and attack with them before anyone is ready.' },
  GW: { id: 'GW', name: 'Selesnya', does: 'Go wide and go together: tokens, anthems, and life gain that keeps the team alive.' },
  WB: { id: 'WB', name: 'Orzhov', does: 'Life as a resource: drain the table, recur creatures, and grind everyone out slowly.' },
  UR: { id: 'UR', name: 'Izzet', does: 'Spells, spells, spells: draw, copy and cast them, with creatures that reward every cast.' },
  BG: { id: 'BG', name: 'Golgari', does: 'The graveyard is a second hand: fill it, bring things back, and grow while doing so.' },
  RW: { id: 'RW', name: 'Boros', does: 'Attack with everything: cheap creatures, combat tricks, and equipment that makes them lethal.' },
  GU: { id: 'GU', name: 'Simic', does: 'Value engines: ramp, draw, and creatures that keep growing with +1/+1 counters.' },
}

/**
 * Four questions, each with two honest answers. Each answer leans toward
 * the colours that play that way; the dial adds the leanings up and moves
 * to the best pair, and the person can always drag it somewhere else.
 */
export const STYLE_AXES = [
  {
    id: 'pace',
    question: 'How fast do you want games to go?',
    options: [
      { id: 'fast', label: 'Fast — I want to be attacking by turn three', leans: { R: 3, W: 2, B: 1 } },
      { id: 'patient', label: 'Patient — I like setting up something big', leans: { G: 3, U: 2, B: 1 } },
    ],
  },
  {
    id: 'threat',
    question: 'What do you want to win with?',
    options: [
      { id: 'creatures', label: 'Creatures — a board of things that attack', leans: { G: 3, W: 2, R: 1 } },
      { id: 'spells', label: 'Spells — tricks, answers and card draw', leans: { U: 3, R: 2, B: 1 } },
    ],
  },
  {
    id: 'table',
    question: 'At a table of four, how do you play?',
    options: [
      { id: 'political', label: 'Political — deals, gifts, and a helpful reputation', leans: { W: 2, G: 2, U: 1 } },
      { id: 'solo', label: 'Solo — my plan, everyone else is in the way', leans: { B: 3, R: 1, U: 1 } },
    ],
  },
  {
    id: 'depth',
    question: 'How much do you want to keep track of?',
    options: [
      { id: 'simple', label: 'Keep it simple — clear cards, clear plan', leans: { G: 2, R: 2, W: 1 } },
      { id: 'intricate', label: 'Intricate — engines, triggers, the stack', leans: { U: 3, B: 2 } },
    ],
  },
]

/**
 * A short list of commanders that make a good first deck in each colour
 * choice, and why. This is a recommendation written for this app, not a
 * ranking from anywhere: each was chosen because its plan fits on one line,
 * the deck it wants is cheap to build, and it wins games without a rules
 * degree. The live list beside it comes from Scryfall's popularity rank.
 * Names are verified against Scryfall by `npm run firstdeck:verify`.
 */
export const FIRST_COMMANDERS = {
  W: [
    { name: 'Adeline, Resplendent Cathar', why: 'Makes a token every time you attack. Your plan is "attack", and the deck fills itself with small creatures that like that.' },
    { name: 'Giada, Font of Hope', why: 'Angels, made cheaper and bigger. A tribe with obvious cards and a commander that speeds them up.' },
  ],
  U: [
    { name: 'Talrand, Sky Summoner', why: 'Every instant or sorcery makes a flying Drake. You learn what spells do while the commander turns them into an army.' },
    { name: 'Arcanis the Omnipotent', why: 'Tap: draw three cards. The simplest engine in the colour, and it teaches why blue never runs out.' },
  ],
  B: [
    { name: 'Syr Konrad, the Grim', why: 'Creatures dying anywhere ping everyone. Fill graveyards, sacrifice things, and the damage adds up on its own.' },
    { name: 'Ayara, First of Locthwain', why: 'Every black creature you play drains the table. Cheap creatures, obvious plan, steady damage.' },
  ],
  R: [
    { name: 'Krenko, Mob Boss', why: 'Tap: double your Goblins. The clearest exponential plan in the game, and Goblins are cheap.' },
    { name: 'Neheb, the Eternal', why: 'Deal damage, get mana, cast more. Red’s answer to running out of gas, on a commander.' },
  ],
  G: [
    { name: 'Goreclaw, Terror of Qal Sisma', why: 'Big creatures cost less and hit harder. Ramp, then monsters — green’s whole philosophy on one card.' },
    { name: 'Ezuri, Renegade Leader', why: 'Elves make mana, Ezuri makes Elves enormous. Cheap tribe, single plan.' },
  ],
  WU: [
    { name: 'Brago, King Eternal', why: 'Attack, then flicker your permanents to reuse their arrival effects. Teaches "enters the battlefield" better than any lesson.' },
    { name: 'Ephara, God of the Polis', why: 'Draw a card every turn you made a creature. Flash creatures, steady draw, no combo to memorise.' },
  ],
  UB: [
    { name: 'Phenax, God of Deception', why: 'Your creatures mill instead of attacking. A different win condition that is easy to see coming and fun to race.' },
    { name: 'Mirko Vosk, Mind Drinker', why: 'One flyer that mills on hit. The deck builds itself around evasion and the graveyard.' },
  ],
  BR: [
    { name: 'Rakdos, Lord of Riots', why: 'Hurt opponents, then cast huge creatures for almost nothing. Aggression that pays for the monsters.' },
    { name: 'Judith, the Scourge Diva', why: 'Your creatures hit harder and ping when they die. Cheap creatures, no bad draws.' },
  ],
  RG: [
    { name: 'Xenagos, God of Revels', why: 'Doubles a creature’s power and gives it haste each combat. Ramp into one big thing and swing.' },
    { name: 'Ruric Thar, the Unbowed', why: 'Punishes everyone for casting noncreature spells. A deck of only creatures is as simple as a deck gets.' },
  ],
  GW: [
    { name: 'Trostani, Selesnya’s Voice', why: 'Gain life for every creature, then copy your best token. Go wide, stay alive, and the numbers get silly.' },
    { name: 'Rhys the Redeemed', why: 'Doubles your tokens. Cheap, explosive, and every token card in the two colours belongs.' },
  ],
  WB: [
    { name: 'Athreos, God of Passage', why: 'Your creatures come back unless opponents pay life. Either outcome helps you, which is the Orzhov way.' },
    { name: 'Elenda, the Dusk Rose', why: 'Grows when anything dies, then leaves a board of lifelinkers. Removal and sacrifice both feed her.' },
  ],
  UR: [
    { name: 'Zaffai, Thunder Conductor', why: 'Big spells throw lightning around. It rewards casting expensive instants and sorceries, which is what you wanted to do anyway.' },
    { name: 'Niv-Mizzet, Parun', why: 'Draw, ping, repeat. Everyone’s spells draw you cards, and your draws deal damage.' },
  ],
  BG: [
    { name: 'Meren of Clan Nel Toth', why: 'Brings a creature back every end step. Sacrifice, recur, and the graveyard becomes an engine.' },
    { name: 'Jarad, Golgari Lich Lord', why: 'Sacrifice your biggest creature to drain everyone for its power. Grow something huge, then throw it.' },
  ],
  RW: [
    { name: 'Aurelia, the Warleader', why: 'Two combat phases when she attacks. Cheap creatures and equipment, and every attack counts twice.' },
    { name: 'Feather, the Redeemed', why: 'Your combat tricks come back to hand. A cheap deck of instants that never runs out.' },
  ],
  GU: [
    { name: 'Tatyova, Benthic Druid', why: 'Every land you play gains life and draws a card. Ramp becomes card draw, the friendliest engine there is.' },
    { name: 'Zegana, Utopian Speaker', why: 'Enters with counters and draws a card. A +1/+1 counters deck with an obvious payoff.' },
  ],
}
