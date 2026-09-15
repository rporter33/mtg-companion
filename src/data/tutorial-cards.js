// Card data for the guided first game.
//
// Bundled rather than fetched, for two reasons. A tutorial that dies on venue
// wifi is a bad tutorial, and the guided game needs these exact cards in this
// exact order — a live lookup could return a different printing with different
// art and break the script.
//
// These are real cards with their real rules text, deliberately chosen from the
// simplest end of the game: no triggered abilities, no keywords beyond haste,
// nothing that needs a rules lawyer. They are shaped like Scryfall card objects
// so they render through the same components as everything else in the app.

const base = (card) => ({
  object: 'card',
  legalities: {},
  prices: {},
  color_identity: [],
  ...card,
})

export const TUTORIAL_CARDS = {
  forest: base({
    id: 'forest', name: 'Forest', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Forest',
    oracle_text: '({T}: Add {G}.)',
    produced_mana: ['G'], color_identity: ['G'], rarity: 'common',
  }),
  mountain: base({
    id: 'mountain', name: 'Mountain', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Mountain',
    oracle_text: '({T}: Add {R}.)',
    produced_mana: ['R'], color_identity: ['R'], rarity: 'common',
  }),
  llanowarElves: base({
    id: 'llanowarElves', name: 'Llanowar Elves', mana_cost: '{G}', cmc: 1,
    type_line: 'Creature — Elf Druid',
    oracle_text: '{T}: Add {G}.',
    power: '1', toughness: '1',
    produced_mana: ['G'], color_identity: ['G'], rarity: 'common',
  }),
  grizzlyBears: base({
    id: 'grizzlyBears', name: 'Grizzly Bears', mana_cost: '{1}{G}', cmc: 2,
    type_line: 'Creature — Bear',
    oracle_text: '',
    power: '2', toughness: '2',
    color_identity: ['G'], rarity: 'common',
  }),
  giantGrowth: base({
    id: 'giantGrowth', name: 'Giant Growth', mana_cost: '{G}', cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Target creature gets +3/+3 until end of turn.',
    color_identity: ['G'], rarity: 'common',
  }),
  crawWurm: base({
    id: 'crawWurm', name: 'Craw Wurm', mana_cost: '{4}{G}{G}', cmc: 6,
    type_line: 'Creature — Wurm',
    oracle_text: '',
    power: '6', toughness: '4',
    color_identity: ['G'], rarity: 'common',
  }),

  ragingGoblin: base({
    id: 'ragingGoblin', name: 'Raging Goblin', mana_cost: '{R}', cmc: 1,
    type_line: 'Creature — Goblin Berserker',
    oracle_text: 'Haste (This creature can attack and {T} as soon as it comes under your control.)',
    power: '1', toughness: '1',
    color_identity: ['R'], rarity: 'common',
  }),
  goblinPiker: base({
    id: 'goblinPiker', name: 'Goblin Piker', mana_cost: '{1}{R}', cmc: 2,
    type_line: 'Creature — Goblin Warrior',
    oracle_text: '',
    power: '2', toughness: '1',
    color_identity: ['R'], rarity: 'common',
  }),
  hillGiant: base({
    id: 'hillGiant', name: 'Hill Giant', mana_cost: '{3}{R}', cmc: 4,
    type_line: 'Creature — Giant',
    oracle_text: '',
    power: '3', toughness: '3',
    color_identity: ['R'], rarity: 'common',
  }),
  shock: base({
    id: 'shock', name: 'Shock', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Shock deals 2 damage to any target.',
    color_identity: ['R'], rarity: 'common',
  }),
}

export const tutorialCard = (id) => TUTORIAL_CARDS[id] ?? null
