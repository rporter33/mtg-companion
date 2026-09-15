// Minimal card fixtures shaped like Scryfall responses.
//
// These carry only the fields the app reads. They are hand-written rather than
// recorded, so they are used to pin down *our* logic, never to assert what
// Scryfall currently says about a card.

export function card(overrides = {}) {
  return {
    id: overrides.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? 'card',
    name: 'Test Card',
    mana_cost: '',
    cmc: 0,
    type_line: 'Creature — Human',
    oracle_text: '',
    color_identity: [],
    produced_mana: undefined,
    legalities: {},
    prices: {},
    ...overrides,
  }
}

const allLegal = {
  standard: 'legal', pioneer: 'legal', modern: 'legal', legacy: 'legal',
  vintage: 'legal', pauper: 'legal', commander: 'legal', duel: 'legal',
  brawl: 'legal', oathbreaker: 'legal',
}

export const legalEverywhere = (o = {}) => card({ legalities: { ...allLegal }, ...o })

export const FOREST = legalEverywhere({
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  color_identity: [], produced_mana: ['G'], cmc: 0,
})

export const ISLAND = legalEverywhere({
  id: 'island', name: 'Island', type_line: 'Basic Land — Island',
  color_identity: [], produced_mana: ['U'], cmc: 0,
})

export const BEAR = legalEverywhere({
  id: 'bear', name: 'Grizzly Bears', mana_cost: '{1}{G}', cmc: 2,
  type_line: 'Creature — Bear', color_identity: ['G'], prices: { usd: '0.10' },
})

export const COUNTERSPELL = legalEverywhere({
  id: 'counterspell', name: 'Counterspell', mana_cost: '{U}{U}', cmc: 2,
  type_line: 'Instant', color_identity: ['U'], prices: { usd: '1.50' },
})

export const COMMANDER_BEAR = legalEverywhere({
  id: 'legend', name: 'Legendary Bear', mana_cost: '{2}{G}', cmc: 3,
  type_line: 'Legendary Creature — Bear', color_identity: ['G'],
})

export const RELENTLESS_RATS = legalEverywhere({
  id: 'rats', name: 'Relentless Rats', mana_cost: '{2}{B}', cmc: 3,
  type_line: 'Creature — Rat', color_identity: ['B'],
  oracle_text: 'Relentless Rats gets +1/+1 for each other creature on the battlefield named Relentless Rats.\nA deck can have any number of cards named Relentless Rats.',
})

export const NAZGUL = legalEverywhere({
  id: 'nazgul', name: 'Nazgûl', mana_cost: '{2}{B}', cmc: 3,
  type_line: 'Creature — Wraith Knight', color_identity: ['B'],
  oracle_text: 'A deck can have up to nine cards named Nazgûl.',
})
