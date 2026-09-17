/**
 * How a first deck might operate, two or three plans per colour choice.
 *
 * These are this app's own suggestions, written for someone building their
 * first deck: each names a plan in one line and says what to look for. They
 * are not official archetypes, rankings or a promise that the plan wins.
 * The queries are what the starting list asks Scryfall for under the
 * "does your thing" role once a plan is chosen: the first is an oracle
 * tag, community-maintained and sometimes renamed, and the rest are plain
 * rules-text searches that keep working when a tag does not. Anything the
 * search returns is still filtered by identity, legality and price first.
 */

const plan = (id, name, does, look, queries) => ({ id, name, does, look, queries })

const TOKENS = plan('tokens', 'Tokens',
  'Make lots of small creatures, then make them bigger together.',
  'Cards that create tokens, and anthems that pump the team.',
  ['otag:token-generator', 'o:"create" o:"token"'])
const COUNTERS = plan('counters', '+1/+1 counters',
  'Grow a few creatures turn after turn until they are too big to handle.',
  'Cards that put +1/+1 counters on your creatures, and things that double them.',
  ['otag:counters-matter', 'o:"+1/+1 counter"'])
const LIFEGAIN = plan('lifegain', 'Life gain',
  'Gain life steadily and turn it into cards, damage or bigger creatures.',
  'Cards that gain life, and cards that reward it.',
  ['otag:lifegain-matters', 'o:"you gain" o:"life"'])
const FLYERS = plan('flyers', 'Flyers',
  'Attack over the top with creatures most decks cannot block.',
  'Creatures with flying, and anything that gives your team flying.',
  ['t:creature o:flying'])
const CONTROL = plan('control', 'Control',
  'Say no to the scary things, wipe the board when it gets crowded, win late.',
  'Counterspells, board wipes and a few resilient finishers.',
  ['otag:board-wipe', 'o:"counter target"'])
const BLINK = plan('blink', 'Blink',
  'Flicker your own creatures to reuse their "enters" abilities again and again.',
  'Creatures that do something when they enter, and cards that exile and return them.',
  ['otag:blink', 'o:"exile" o:"return" o:"under your control"'])
const MILL = plan('mill', 'Mill',
  'Put cards from opponents’ libraries into their graveyards, and use what lands there.',
  'Cards that mill, and cards that care about graveyards.',
  ['otag:mill', 'o:mill'])
const REANIMATE = plan('reanimator', 'Reanimator',
  'Get big creatures into the graveyard cheaply, then bring them back for less.',
  'Ways to fill a graveyard, and spells that return creatures from it to the battlefield.',
  ['otag:reanimate', 'o:"from your graveyard to the battlefield"'])
const SACRIFICE = plan('sacrifice', 'Sacrifice',
  'Feed your own creatures to outlets for value, and profit every time one dies.',
  'Sacrifice outlets, cheap fodder, and cards that trigger when a creature dies.',
  ['otag:sacrifice-outlet', 'o:"sacrifice a creature"'])
const DAMAGE = plan('damage', 'Damage',
  'Point damage at every face at the table and count down their life totals.',
  'Cards that deal damage to each opponent, and cards that make damage bigger.',
  ['o:"damage to each opponent"'])
const BIG = plan('big', 'Big creatures',
  'Ramp into monsters and attack before anyone is ready.',
  'Creatures with four or more power, and the ramp to cast them early.',
  ['t:creature pow>=4'])
const LANDFALL = plan('landfall', 'Lands matter',
  'Play extra lands and get paid every time one enters.',
  'Cards with landfall, and ways to play more than one land a turn.',
  ['otag:landfall', 'o:"whenever a land enters"'])
const DRAIN = plan('drain', 'Drain',
  'Make every opponent lose life a little at a time while you gain it.',
  'Cards where each opponent loses life, and cards that do it on a trigger.',
  ['o:"each opponent loses"'])
const RECURSION = plan('recursion', 'Recursion',
  'Let creatures die and bring them back, over and over.',
  'Creatures that return from the graveyard, and spells that bring them back.',
  ['o:"return target creature card from your graveyard"'])
const SPELLS = plan('spells', 'Spells',
  'Cast lots of instants and sorceries, with creatures that reward every cast.',
  'Cheap instants and sorceries, and permanents that trigger when you cast one.',
  ['otag:spellslinger', 'o:"whenever you cast an instant or sorcery"'])
const COPY = plan('copy', 'Copy',
  'Copy your best spells and creatures so every good thing happens twice.',
  'Cards that copy spells or creatures.',
  ['o:"copy target"'])
const GRAVEYARD = plan('graveyard', 'Graveyard value',
  'Treat the graveyard as a second hand: fill it, then use what is in it.',
  'Self-mill, cards that get stronger with a full graveyard, and recursion.',
  ['otag:self-mill', 'o:"your graveyard"'])
const EQUIPMENT = plan('equipment', 'Equipment',
  'Strap swords and boots on a few creatures and swing.',
  'Equipment, and creatures that are good at carrying it.',
  ['t:equipment'])
const GO_WIDE = plan('gowide', 'Go wide',
  'Attack with everything, every turn, with pumps that make the swing lethal.',
  'Cheap creatures, anthems, and spells that pump the whole team.',
  ['o:"creatures you control get +"'])
const RAMP = plan('ramp', 'Ramp',
  'Make more mana than anyone else and use it on bigger things.',
  'Mana rocks, dorks, and cards that find or play extra lands.',
  ['otag:ramp', 'o:"search your library for a" o:"land"'])
const DRAW_ENGINE = plan('draw', 'Draw engine',
  'Draw more cards than everyone and never run out of things to do.',
  'Creatures and permanents that draw cards on a trigger.',
  ['t:creature o:"draw a card"'])

export const STRATEGIES = {
  W: [TOKENS, EQUIPMENT, LIFEGAIN],
  U: [FLYERS, SPELLS, CONTROL],
  B: [DRAIN, REANIMATE, SACRIFICE],
  R: [DAMAGE, GO_WIDE, SPELLS],
  G: [COUNTERS, BIG, LANDFALL],
  WU: [FLYERS, CONTROL, BLINK],
  UB: [MILL, REANIMATE, CONTROL],
  BR: [SACRIFICE, DAMAGE, REANIMATE],
  RG: [BIG, LANDFALL, DAMAGE],
  GW: [TOKENS, COUNTERS, LIFEGAIN],
  WB: [DRAIN, RECURSION, TOKENS],
  UR: [SPELLS, COPY, FLYERS],
  BG: [GRAVEYARD, COUNTERS, SACRIFICE],
  RW: [EQUIPMENT, GO_WIDE, TOKENS],
  GU: [COUNTERS, RAMP, DRAW_ENGINE],
}

/** The plans offered for a colour choice: a letter, a pair key, or nothing for colourless. */
export function strategiesFor(colors) {
  return STRATEGIES[colors] ?? []
}

export function strategyById(colors, id) {
  return strategiesFor(colors).find((s) => s.id === id) ?? null
}
