// The practice table's card pool.
//
// Real cards, bundled as text records like the tutorial's, each with a
// `rules` block that says exactly what the table's model does with it. The
// model has no parser for rules text: a card does only what its block says,
// and a block may only use the mechanics listed in src/lib/table/mechanics.js.
// Anything outside that list is refused with an explanation, never guessed.
//
// Green and red only, from the simplest end of the game, so a learner meets
// one idea at a time: lands, mana creatures, vanilla creatures at every
// cost, a pump spell, a burn instant, a burn sorcery, and haste.
//
// Names and rules text are the property of Wizards of the Coast, shown
// under the Fan Content Policy. `npm run tutorial:verify` checks every record
// against Scryfall on a machine that can reach it and fills the source block.

import { TUTORIAL_CARDS } from './tutorial-cards.js'

const base = (card) => ({
  object: 'card',
  legalities: {},
  prices: {},
  color_identity: [],
  source: { oracleId: null, scryfallId: null, set: null, collectorNumber: null, checkedAt: null },
  ...card,
})

const withRules = (card, rules) => ({ ...card, rules })

const land = (produces) => ({ kind: 'land', mana: [{ produces }] })
const creature = (over = {}) => ({ kind: 'creature', keywords: [], ...over })
const manaCreature = (produces) => creature({ mana: [{ produces }] })

export const PRACTICE_CARDS = {
  // --- the tutorial's ten, with rules blocks ---
  forest: withRules(TUTORIAL_CARDS.forest, land(['G'])),
  mountain: withRules(TUTORIAL_CARDS.mountain, land(['R'])),
  llanowarElves: withRules(TUTORIAL_CARDS.llanowarElves, manaCreature(['G'])),
  grizzlyBears: withRules(TUTORIAL_CARDS.grizzlyBears, creature()),
  giantGrowth: withRules(TUTORIAL_CARDS.giantGrowth, {
    kind: 'instant', effect: { kind: 'pump', power: 3, toughness: 3, target: 'creature' },
  }),
  crawWurm: withRules(TUTORIAL_CARDS.crawWurm, creature()),
  ragingGoblin: withRules(TUTORIAL_CARDS.ragingGoblin, creature({ keywords: ['haste'] })),
  goblinPiker: withRules(TUTORIAL_CARDS.goblinPiker, creature()),
  hillGiant: withRules(TUTORIAL_CARDS.hillGiant, creature()),
  shock: withRules(TUTORIAL_CARDS.shock, {
    kind: 'instant', effect: { kind: 'damage', amount: 2, target: 'any' },
  }),

  // --- more of the same shapes ---
  plains: withRules(base({
    id: 'plains', name: 'Plains', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Plains',
    oracle_text: '({T}: Add {W}.)',
    produced_mana: ['W'], color_identity: ['W'], rarity: 'common',
  }), land(['W'])),
  centaurCourser: withRules(base({
    id: 'centaurCourser', name: 'Centaur Courser', mana_cost: '{2}{G}', cmc: 3,
    type_line: 'Creature — Centaur Warrior',
    oracle_text: '',
    power: '3', toughness: '3',
    color_identity: ['G'], rarity: 'common',
  }), creature()),
  rumblingBaloth: withRules(base({
    id: 'rumblingBaloth', name: 'Rumbling Baloth', mana_cost: '{2}{G}{G}', cmc: 4,
    type_line: 'Creature — Beast',
    oracle_text: '',
    power: '4', toughness: '4',
    color_identity: ['G'], rarity: 'common',
  }), creature()),
  titanicGrowth: withRules(base({
    id: 'titanicGrowth', name: 'Titanic Growth', mana_cost: '{1}{G}', cmc: 2,
    type_line: 'Instant',
    oracle_text: 'Target creature gets +4/+4 until end of turn.',
    color_identity: ['G'], rarity: 'common',
  }), { kind: 'instant', effect: { kind: 'pump', power: 4, toughness: 4, target: 'creature' } }),
  goblinRoughrider: withRules(base({
    id: 'goblinRoughrider', name: 'Goblin Roughrider', mana_cost: '{2}{R}', cmc: 3,
    type_line: 'Creature — Goblin Knight',
    oracle_text: '',
    power: '3', toughness: '2',
    color_identity: ['R'], rarity: 'common',
  }), creature()),
  canyonMinotaur: withRules(base({
    id: 'canyonMinotaur', name: 'Canyon Minotaur', mana_cost: '{3}{R}', cmc: 4,
    type_line: 'Creature — Minotaur',
    oracle_text: '',
    power: '3', toughness: '3',
    color_identity: ['R'], rarity: 'common',
  }), creature()),
  lightningStrike: withRules(base({
    id: 'lightningStrike', name: 'Lightning Strike', mana_cost: '{1}{R}', cmc: 2,
    type_line: 'Instant',
    oracle_text: 'Lightning Strike deals 3 damage to any target.',
    color_identity: ['R'], rarity: 'common',
  }), { kind: 'instant', effect: { kind: 'damage', amount: 3, target: 'any' } }),
  volcanicHammer: withRules(base({
    id: 'volcanicHammer', name: 'Volcanic Hammer', mana_cost: '{1}{R}', cmc: 2,
    type_line: 'Sorcery',
    oracle_text: 'Volcanic Hammer deals 3 damage to any target.',
    color_identity: ['R'], rarity: 'common',
  }), { kind: 'sorcery', effect: { kind: 'damage', amount: 3, target: 'any' } }),
}

export const practiceCard = (id) => PRACTICE_CARDS[id] ?? null
export const PRACTICE_CARD_IDS = Object.keys(PRACTICE_CARDS)
