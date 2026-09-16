// The contextual explainer layer.
//
// Every term here is tappable anywhere in the app. Written for someone who has
// never played: no term is explained using another term the reader would also
// have to look up, and each entry says why the rule exists, not just what it is.

export const GLOSSARY = {
  // --- the board and its zones ---
  battlefield: {
    term: 'Battlefield',
    short: 'The table in front of you, where your lands and creatures sit.',
    long: 'Anything you have successfully played and that stays around — lands, creatures, artifacts, enchantments, planeswalkers — lives on the battlefield. Spells like instants and sorceries never go here; they resolve and then head to the graveyard.',
  },
  hand: {
    term: 'Hand',
    short: 'The cards you are holding. You start with seven.',
    long: 'You draw one card at the start of each of your turns. If you have more than seven cards in hand when your turn ends, you discard down to seven — so holding cards forever is not free.',
  },
  library: {
    term: 'Library',
    short: 'Your deck, face down. You draw from the top.',
    long: 'It is called your library, not your deck, once the game starts. Running out of cards is a real way to lose: if you ever need to draw from an empty library, you lose the game.',
  },
  graveyard: {
    term: 'Graveyard',
    short: 'The discard pile. Face up, and anyone can look through it.',
    long: 'Creatures that die, spells that have finished resolving, and cards you discard all go here. Plenty of cards care about the graveyard, so it is not a dead zone — it is a resource.',
  },
  exile: {
    term: 'Exile',
    short: 'Removed from the game entirely — a stronger graveyard.',
    long: 'Exile is where cards go when something removes them for good. Far fewer cards can retrieve things from exile than from the graveyard, which is why "exile it" is usually a better answer than "destroy it".',
  },
  stack: {
    term: 'The stack',
    short: 'Where spells wait before they happen. Last in, first out.',
    long: 'When you cast a spell it does not take effect immediately. It goes on the stack, and your opponent gets a chance to respond. If they respond, their spell goes on top of yours — and resolves first. This is the single biggest thing that separates Magic from most card games, and it is why instants matter.',
    seeAlso: ['priority', 'instant'],
  },

  // --- mana ---
  mana: {
    term: 'Mana',
    short: 'The resource you spend to cast spells. It comes from lands.',
    long: 'Mana comes in five colours — white, blue, black, red, green — plus colourless. You produce it by tapping lands, and it empties at the end of each step, so unspent mana is wasted rather than saved.',
  },
  land: {
    term: 'Land',
    short: 'Your mana source. You may play one per turn.',
    long: 'Lands are not spells: playing one does not use the stack and cannot be responded to. The one-per-turn limit is the pacing mechanism of the whole game — it is why a five-cost spell is a turn-five spell.',
  },
  manaValue: {
    term: 'Mana value',
    short: 'The total cost of a card, ignoring what colours it needs.',
    long: 'A spell costing {2}{U}{U} has mana value 4. It used to be called converted mana cost. It is what "three-drop" and "curve" refer to.',
  },
  colorIdentity: {
    term: 'Colour identity',
    short: 'Every colour a card mentions anywhere, not just in its cost.',
    long: 'Colour identity includes the mana cost and any coloured mana symbols in the rules text. It only matters in Commander, where every card in your deck must fall inside your commander’s colour identity — a green commander cannot lead a deck containing a card with {U} anywhere on it.',
  },
  tapped: {
    term: 'Tapped',
    short: 'Turned sideways, meaning it has been used this turn.',
    long: 'You tap lands to produce mana and tap creatures to attack. Tapped creatures cannot block. Everything you control untaps at the start of your own turn.',
  },

  // --- the turn ---
  untapStep: {
    term: 'Untap step',
    short: 'Everything you control turns back upright. Automatic.',
    long: 'The first thing that happens on your turn. Nobody can respond during the untap step — it just happens.',
  },
  upkeep: {
    term: 'Upkeep',
    short: 'A brief window right after untapping, before you draw.',
    long: 'Some cards trigger "at the beginning of your upkeep". If none do, this step passes in a second — but it exists, and it is the first point in your turn where anyone can respond to anything.',
  },
  drawStep: {
    term: 'Draw step',
    short: 'You draw one card.',
    long: 'The player who goes first skips their draw step on turn one — otherwise going first would be too strong an advantage.',
  },
  mainPhase: {
    term: 'Main phase',
    short: 'When you actually do things: play a land, cast your spells.',
    long: 'You get two main phases, one before combat and one after. Sorceries, creatures, artifacts, enchantments and planeswalkers can only be cast during your own main phase when the stack is empty.',
  },
  combat: {
    term: 'Combat',
    short: 'Attack, block, damage. Five steps, but it moves fast.',
    long: 'You declare attackers, then your opponent declares blockers, then damage happens simultaneously. Crucially, the attacker chooses who attacks and the defender chooses how to block — so attacking always hands your opponent a decision.',
    seeAlso: ['firstStrike', 'trample'],
  },
  endStep: {
    term: 'End step',
    short: 'The last window of your turn, then cleanup.',
    long: 'A common place to cast instants: anything you do here happens after your opponent can no longer profit from the information, and untapping on your turn means you lose nothing by waiting.',
  },
  priority: {
    term: 'Priority',
    short: 'Whose turn it is to act right now.',
    long: 'The active player gets priority first in each step. Nothing resolves until every player passes priority in a row. In casual play nobody says the word out loud — but it is the reason your opponent can respond to your spell before it happens.',
    seeAlso: ['stack'],
  },

  // --- card types ---
  creature: {
    term: 'Creature',
    short: 'A permanent that can attack and block.',
    long: 'The numbers in the bottom right are power and toughness: power is how much damage it deals, toughness is how much it takes to kill it. A creature cannot attack the turn it arrives unless it has haste.',
    seeAlso: ['summoningSickness', 'haste'],
  },
  instant: {
    term: 'Instant',
    short: 'A spell you can cast at almost any time, including your opponent’s turn.',
    long: 'This is the flexibility that the stack exists to enable. Holding an instant open is a real strategic option — your opponent has to play around it without knowing whether you have it.',
    seeAlso: ['stack'],
  },
  sorcery: {
    term: 'Sorcery',
    short: 'Like an instant, but only on your own turn, main phase, empty stack.',
    long: 'Sorceries are usually stronger than comparable instants precisely because they are so much more restricted about timing.',
  },
  artifact: {
    term: 'Artifact',
    short: 'A colourless permanent — an object rather than a being.',
    long: 'Artifacts go in any deck regardless of colour, which is why mana rocks and equipment show up everywhere.',
  },
  enchantment: {
    term: 'Enchantment',
    short: 'A permanent that changes the rules while it is out.',
    long: 'Enchantments sit on the battlefield and keep doing their thing. An Aura is an enchantment that attaches to something else.',
  },
  planeswalker: {
    term: 'Planeswalker',
    short: 'An ally with loyalty counters, who does one thing per turn.',
    long: 'Planeswalkers enter with loyalty counters and you activate exactly one ability per turn, on your turn. Your opponents can attack them directly. They are removal magnets, and that is the point.',
  },

  // --- keywords new players hit first ---
  flying: {
    term: 'Flying',
    short: 'Can only be blocked by creatures with flying or reach.',
    long: 'The most common evasion ability. A 2/2 flier often gets more damage through than a 4/4 on the ground.',
  },
  trample: {
    term: 'Trample',
    short: 'Excess combat damage carries over to the player.',
    long: 'If your 6/6 trampler is blocked by a 1/1, you assign 1 damage to the blocker and the other 5 to your opponent. It makes chump-blocking much less effective.',
  },
  firstStrike: {
    term: 'First strike',
    short: 'Deals its combat damage before creatures without it.',
    long: 'If a first striker kills its blocker before normal damage, the blocker never deals damage back. A 2/2 first striker beats a 2/2 without it, cleanly.',
  },
  deathtouch: {
    term: 'Deathtouch',
    short: 'Any amount of damage it deals to a creature is lethal.',
    long: 'A 1/1 deathtoucher trades with anything, no matter how large. It makes attacking into it a genuinely bad idea.',
  },
  lifelink: {
    term: 'Lifelink',
    short: 'Damage it deals also gains you that much life.',
    long: 'Works on any damage, not just combat — so a lifelink creature blocking still gains you life.',
  },
  vigilance: {
    term: 'Vigilance',
    short: 'Attacking does not tap it, so it can still block.',
    long: 'Removes the usual trade-off of attacking. A vigilant creature is on offence and defence at once.',
  },
  haste: {
    term: 'Haste',
    short: 'Can attack and tap the turn it arrives.',
    long: 'Without haste, a creature must wait a full turn cycle before attacking.',
    seeAlso: ['summoningSickness'],
  },
  summoningSickness: {
    term: 'Summoning sickness',
    short: 'A creature cannot attack the turn you play it.',
    long: 'It can block immediately, though — blocking is never restricted by summoning sickness. The restriction is only on attacking and on abilities with a tap symbol in their cost.',
  },
  ward: {
    term: 'Ward',
    short: 'Opponents must pay extra to target it, or their spell is countered.',
    long: 'Ward is a tax, not a prohibition. Your opponent can still kill the creature, but it costs them more than they planned.',
  },


  // --- the rest of the evergreen keywords ---
  defender: {
    term: 'Defender',
    short: 'Cannot attack. That is the whole downside.',
    long: 'Defenders block and never attack, so they are usually much bigger than their cost would otherwise allow. A 0/6 wall stops almost anything on the ground for two mana.',
  },
  doubleStrike: {
    term: 'Double strike',
    short: 'Deals its combat damage twice — once early, once normally.',
    long: 'A double striker deals first-strike damage and then regular damage, so a 3/3 with double strike deals 6 in a turn. Combined with lifelink or trample it gets out of hand quickly, which is why it is rare and expensive.',
    seeAlso: ['firstStrike', 'trample', 'lifelink'],
  },
  flash: {
    term: 'Flash',
    short: 'You may cast it any time you could cast an instant.',
    long: 'Flash turns a creature into something you can deploy at the end of your opponent\u2019s turn, or in the middle of combat as a surprise blocker. It does not make the creature able to attack immediately — that is haste.',
    seeAlso: ['instant', 'haste', 'stack'],
  },
  hexproof: {
    term: 'Hexproof',
    short: 'Your opponents cannot target it. You still can.',
    long: 'Hexproof stops targeted removal and targeted effects from opponents. It does not stop everything: a board wipe that destroys all creatures does not target, so hexproof will not save you from it.',
    seeAlso: ['ward', 'removal'],
  },
  indestructible: {
    term: 'Indestructible',
    short: 'Cannot be destroyed by damage or by "destroy" effects.',
    long: 'Indestructible turns off the two most common ways things die. It does not stop exile, sacrifice, or a creature\u2019s toughness being reduced to zero — which is exactly how experienced players answer it.',
    seeAlso: ['exile', 'stateBasedActions'],
  },
  menace: {
    term: 'Menace',
    short: 'Cannot be blocked by only one creature.',
    long: 'Blocking a creature with menace takes two blockers or none. Against an opponent with a small board it is close to unblockable, and it makes attacking far safer.',
  },
  protection: {
    term: 'Protection',
    short: 'Cannot be damaged, enchanted, blocked or targeted by that quality.',
    long: 'Protection from red means: damage from red sources is prevented, red auras and equipment fall off, red creatures cannot block it, and red spells cannot target it. The memory aid is DEBT — Damage, Enchant/Equip, Block, Target. It does not stop a red board wipe that destroys without targeting.',
    seeAlso: ['hexproof', 'indestructible'],
  },
  reach: {
    term: 'Reach',
    short: 'Can block creatures with flying.',
    long: 'Reach does not let a creature fly — it only lets it block fliers. It is how green, which gets very few fliers, answers them.',
    seeAlso: ['flying'],
  },

  // --- how a card is written ---
  triggeredAbility: {
    term: 'Triggered ability',
    short: 'Starts with When, Whenever, or At. Happens by itself.',
    long: 'If a line of rules text begins with When, Whenever, or At, it is a triggered ability — it fires on its own when its condition is met, and nobody has to choose to use it. The shape is always the same: [When/Whenever/At] [something happens], [effect]. It is not optional unless the text says "may".',
    seeAlso: ['stack', 'activatedAbility', 'staticAbility'],
  },
  activatedAbility: {
    term: 'Activated ability',
    short: 'Written cost, then a colon, then what it does.',
    long: 'Anything of the form "cost: effect" is an activated ability, and you choose when to use it. The cost might be mana, tapping, sacrificing something, or a mix. If you can pay it you may activate it, as often as you can afford unless the card says otherwise.',
    seeAlso: ['triggeredAbility', 'tapped', 'stack'],
  },
  staticAbility: {
    term: 'Static ability',
    short: 'Just true, all the time. No trigger, no cost.',
    long: 'A static ability is simply a fact about the game while the card is on the battlefield — "creatures you control get +1/+1", or a keyword like flying. It never uses the stack and cannot be responded to.',
    seeAlso: ['triggeredAbility', 'stack'],
  },
  reflexiveTrigger: {
    term: '"When you do"',
    short: 'A second trigger that only happens if you took the optional action.',
    long: 'You will see text like "You may sacrifice a creature. When you do, draw two cards." The second sentence is a reflexive trigger: it only fires if you actually did the optional thing. If you decline, nothing else happens. It is written this way so the reward cannot be taken without the cost.',
    seeAlso: ['triggeredAbility', 'mayKeyword'],
  },
  mayKeyword: {
    term: '"May"',
    short: 'The one word that makes an ability optional.',
    long: 'Triggered abilities are mandatory by default — if the condition happens, the effect happens, whether or not you want it to. "May" is the only thing that gives you a choice. This matters: "whenever a creature dies, you lose 1 life" will kill you if you are not careful.',
    seeAlso: ['triggeredAbility'],
  },
  abilityWord: {
    term: 'Ability word',
    short: 'An italic label with no rules meaning at all.',
    long: 'Landfall, raid, delirium, constellation and the like are ability words. They do nothing. Delete the word from the card and it behaves identically — the actual rule is the text that follows it. They exist to group cards that share a theme and to make them easier to talk about. This is the opposite of a keyword like flying, which really is a rule.',
    seeAlso: ['landfall', 'triggeredAbility'],
  },
  landfall: {
    term: 'Landfall',
    short: 'Shorthand for "whenever a land enters the battlefield under your control".',
    long: 'Every landfall card is a triggered ability with that condition. The word itself does nothing — it is an ability word, and the real rule is always written out after it. Because you may play a land every turn, landfall is a reward you can count on rather than one you have to build toward.',
    seeAlso: ['abilityWord', 'triggeredAbility', 'land'],
  },

  // --- mechanics you will meet early, beyond the evergreen set ---
  scry: {
    term: 'Scry',
    short: 'Look at the top card or cards, and leave them or bin them.',
    long: 'Scry 2 means look at the top two cards of your library and put any number of them on the bottom, the rest back on top in any order. It does not draw you anything — it improves what you are about to draw.',
    seeAlso: ['library'],
  },
  surveil: {
    term: 'Surveil',
    short: 'Like scry, but the cards you reject go to your graveyard.',
    long: 'Surveil 2 looks at the top two cards and puts any number into your graveyard instead of the bottom of your library. In a deck that wants cards in its graveyard, that is an upside rather than a cost.',
    seeAlso: ['scry', 'graveyard'],
  },
  cycling: {
    term: 'Cycling',
    short: 'Pay the cost, discard it, draw a card.',
    long: 'Cycling is an activated ability you use from your hand. It turns a card you do not need right now into a fresh one, which is why cards with cycling are much easier to include — the worst case is that you paid a little to draw something else.',
    seeAlso: ['activatedAbility', 'hand'],
  },
  kicker: {
    term: 'Kicker',
    short: 'An optional extra cost for a bigger effect.',
    long: 'You may pay the kicker cost as you cast the spell for an additional or improved effect. It makes a card useful early and still useful late, which is exactly what you want from a deck that has to function across a whole game.',
  },
  flashback: {
    term: 'Flashback',
    short: 'Cast it once more from your graveyard, then it is exiled.',
    long: 'After the spell has resolved and gone to your graveyard, you may cast it again for its flashback cost. Then it is exiled rather than returning. Effectively two cards in one.',
    seeAlso: ['graveyard', 'exile'],
  },
  convoke: {
    term: 'Convoke',
    short: 'Tap your creatures to help pay for it.',
    long: 'Each creature you tap pays for one generic mana, or one mana of that creature\u2019s colour. It lets a board full of small creatures cast something far above your land count.',
    seeAlso: ['tapped', 'mana'],
  },
  prowess: {
    term: 'Prowess',
    short: 'Gets +1/+1 until end of turn whenever you cast a noncreature spell.',
    long: 'A triggered ability, so it fires on its own and it stacks — two spells in a turn means +2/+2. It rewards decks full of cheap instants and sorceries.',
    seeAlso: ['triggeredAbility'],
  },

  // --- game concepts ---
  mulligan: {
    term: 'Mulligan',
    short: 'Redraw a fresh seven, then put one card on the bottom.',
    long: 'Under the London mulligan you always draw seven, then bottom one card per mulligan you took. Because you choose which to bottom, mulliganing a hand with no lands is almost always right — keeping a broken hand loses far more games than taking a six.',
  },
  curve: {
    term: 'Curve',
    short: 'The spread of your spells across mana values.',
    long: 'Playing "on curve" means spending all your mana every turn — a two-drop on turn two, a three-drop on turn three. A deck whose spells all cost five does nothing for four turns.',
  },
  removal: {
    term: 'Removal',
    short: 'Cards that kill or neutralise your opponent’s things.',
    long: 'Every deck needs some. A deck with no answers loses to the first threat it cannot block.',
  },
  ramp: {
    term: 'Ramp',
    short: 'Getting extra mana ahead of schedule.',
    long: 'Cards that fetch extra lands or produce mana themselves, letting you cast your five-drop on turn three. Central to Commander.',
  },
  commander: {
    term: 'Commander',
    short: 'A legendary creature who leads your deck and can be recast all game.',
    long: 'Your commander starts in the command zone, not your library, so you can always cast it. Each time it dies and returns to the command zone, recasting it costs {2} more. Everything in your deck must match its colour identity.',
    seeAlso: ['colorIdentity', 'commandZone', 'commanderDamage'],
  },
  commandZone: {
    term: 'Command zone',
    short: 'A special place where your commander waits.',
    long: 'If your commander would go to the graveyard, exile, hand or library, you may put it back in the command zone instead — which is why it is a threat your opponents cannot permanently answer.',
  },
  commanderDamage: {
    term: 'Commander damage',
    short: '21 combat damage from a single commander kills you.',
    long: 'Tracked separately per commander, on top of your normal 40 life. It is an alternate way to lose that exists so that a huge commander is a real clock even at 40 life.',
  },
  singleton: {
    term: 'Singleton',
    short: 'Only one copy of each card, basic lands excepted.',
    long: 'Commander is a singleton format. It makes every game play out differently and is a large part of why the format is popular.',
  },
  sideboard: {
    term: 'Sideboard',
    short: 'Up to 15 extra cards you can swap in between games.',
    long: 'Matches are best-of-three. After game one you know what your opponent is doing, and you swap cards from your sideboard to answer it. Commander does not use sideboards.',
  },
  stateBasedActions: {
    term: 'State-based actions',
    short: 'Automatic cleanup: dead creatures die, players at 0 life lose.',
    long: 'Nobody has to do anything or announce anything. The moment a creature has damage equal to its toughness it dies, checked constantly. This is why you cannot respond to a creature dying — it is already gone.',
  },
  legendRule: {
    term: 'Legend rule',
    short: 'You may only control one of each legendary permanent by name.',
    long: 'If you end up with two, you choose one to keep and the other goes to the graveyard. It applies per player, so you and your opponent can each have your own copy.',
  },
}

export function lookupTerm(key) {
  return GLOSSARY[key] ?? null
}

export const GLOSSARY_KEYS = Object.keys(GLOSSARY)

/** Groups terms for the reference list in the guide. */
export const GLOSSARY_SECTIONS = [
  { title: 'Zones', keys: ['battlefield', 'hand', 'library', 'graveyard', 'exile', 'stack', 'commandZone'] },
  { title: 'Mana', keys: ['mana', 'land', 'manaValue', 'colorIdentity', 'tapped', 'ramp'] },
  { title: 'The turn', keys: ['untapStep', 'upkeep', 'drawStep', 'mainPhase', 'combat', 'endStep', 'priority'] },
  { title: 'Card types', keys: ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'] },
  { title: 'Keywords — in almost every set', keys: ['flying', 'trample', 'firstStrike', 'doubleStrike', 'deathtouch', 'lifelink', 'vigilance', 'haste', 'reach', 'menace', 'defender', 'flash', 'hexproof', 'indestructible', 'protection', 'ward', 'summoningSickness'] },
  { title: 'How a card is written', keys: ['triggeredAbility', 'activatedAbility', 'staticAbility', 'reflexiveTrigger', 'mayKeyword', 'abilityWord', 'landfall'] },
  { title: 'Mechanics you will meet early', keys: ['scry', 'surveil', 'cycling', 'kicker', 'flashback', 'convoke', 'prowess'] },
  { title: 'Playing and building', keys: ['mulligan', 'curve', 'removal', 'sideboard', 'singleton', 'stateBasedActions', 'legendRule'] },
  { title: 'Commander', keys: ['commander', 'commanderDamage'] },
]
