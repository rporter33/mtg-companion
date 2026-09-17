import { describe, it, expect } from 'vitest'
import {
  dialToColors, colorsToDial, pairKey, suggestColors, commanderQuery, stapleQueries,
  roleCounts, basicSplit, fillPlan, identityKeyOf, fitsIdentity, ROLES, DIAL_MAX,
} from '../src/lib/first-deck.js'
import { COLOR_PAGES, PAIRS, STYLE_AXES, FIRST_COMMANDERS, WHEEL } from '../src/data/colors.js'

describe('the colour data', () => {
  it('has a page for every colour with the three parts a beginner needs', () => {
    for (const c of WHEEL) {
      const page = COLOR_PAGES[c]
      expect(page.values.length).toBeGreaterThan(40)
      expect(page.wins.length).toBeGreaterThan(40)
      expect(page.weak.length).toBeGreaterThan(40)
      expect(page.signature).toHaveLength(3)
    }
  })
  it('names all ten pairs, each reachable from either spelling', () => {
    expect(Object.keys(PAIRS)).toHaveLength(10)
    for (const key of Object.keys(PAIRS)) {
      expect(key).toHaveLength(2)
      expect(pairKey(key[0], key[1])).toBe(key)
      expect(pairKey(key[1], key[0])).toBe(key)
    }
  })
  it('recommends two first commanders for every choice, each with a reason', () => {
    for (const key of [...WHEEL, ...Object.keys(PAIRS)]) {
      expect(FIRST_COMMANDERS[key], key).toHaveLength(2)
      for (const pick of FIRST_COMMANDERS[key]) expect(pick.why.length).toBeGreaterThan(30)
    }
  })
  it('every style answer leans somewhere', () => {
    for (const axis of STYLE_AXES) for (const o of axis.options) expect(Object.keys(o.leans).length).toBeGreaterThan(0)
  })
})

describe('the dial', () => {
  it('rests on a colour at each hundred and on the allied pair between', () => {
    expect(dialToColors(0)).toBe('W')
    expect(dialToColors(100)).toBe('U')
    expect(dialToColors(50)).toBe('WU')
    expect(dialToColors(150)).toBe('UB')
    expect(dialToColors(250)).toBe('BR')
    expect(dialToColors(350)).toBe('RG')
    expect(dialToColors(450)).toBe('GW')
    expect(dialToColors(DIAL_MAX)).toBe('W')
  })
  it('snaps to a colour near it, so a slightly off thumb is not a pair', () => {
    expect(dialToColors(20)).toBe('W')
    expect(dialToColors(80)).toBe('U')
    expect(dialToColors(26)).toBe('WU')
  })
  it('round-trips every allied pair and colour', () => {
    for (const c of ['W', 'U', 'B', 'R', 'G', 'WU', 'UB', 'BR', 'RG', 'GW']) expect(dialToColors(colorsToDial(c))).toBe(c)
  })
  it('has no spot for an enemy pair, which the chips cover', () => {
    expect(colorsToDial('WB')).toBeNull()
    expect(colorsToDial('UR')).toBeNull()
  })
  it('clamps junk', () => {
    expect(dialToColors(-5)).toBe('W')
    expect(dialToColors(9999)).toBe('W')
    expect(dialToColors('x')).toBe('W')
  })
})

describe('pairKey', () => {
  it('orders any two colours the way the game names them', () => {
    expect(pairKey('U', 'W')).toBe('WU')
    expect(pairKey('W', 'G')).toBe('GW')
    expect(pairKey('R', 'U')).toBe('UR')
    expect(pairKey('B', 'W')).toBe('WB')
    expect(pairKey('G')).toBe('G')
    expect(pairKey('G', 'G')).toBe('G')
  })
})

describe('suggestColors', () => {
  it('says nothing when nothing was answered', () => {
    expect(suggestColors({})).toBeNull()
  })
  it('lands on a pair that fits the answers', () => {
    expect(suggestColors({ pace: 'fast', threat: 'creatures', table: 'political', depth: 'simple' })).toBe('GW')
    expect(suggestColors({ pace: 'patient', threat: 'spells', table: 'solo', depth: 'intricate' })).toBe('UB')
  })
  it('picks one colour when the answers point overwhelmingly one way', () => {
    expect(suggestColors({ threat: 'spells' })).toBe('UR')
    expect(suggestColors({ depth: 'intricate' })).toBe('UB')
  })
  it('never returns something the pair list does not know', () => {
    for (const pace of ['fast', 'patient']) for (const threat of ['creatures', 'spells']) for (const table of ['political', 'solo']) for (const depth of ['simple', 'intricate']) {
      const c = suggestColors({ pace, threat, table, depth })
      expect(c.length === 1 ? COLOR_PAGES[c] : PAIRS[c], c).toBeTruthy()
    }
  })
})

describe('queries', () => {
  it('asks for commanders of exactly the chosen colours, paper-legal', () => {
    expect(commanderQuery('WU')).toBe('is:commander legal:commander game:paper id=wu')
  })
  it('caps staples by price and keeps them in identity, with a fallback per role', () => {
    const [first, ...rest] = stapleQueries('BR', 'ramp')
    expect(first).toContain('id<=br')
    expect(first).toContain('usd<=4')
    expect(first).toContain('otag:ramp')
    expect(rest.length).toBeGreaterThan(0)
    expect(stapleQueries('G', 'lands', { capUsd: 2 })[0]).toContain('usd<=2')
  })
})

const card = (id, over = {}) => ({ id, name: id, type_line: 'Creature — Elf', oracle_text: '', ...over })
const L = { forest: card('forest', { type_line: 'Basic Land — Forest' }), rock: card('rock', { type_line: 'Artifact', oracle_text: '{T}: Add {C}.' }),
  cantrip: card('cantrip', { type_line: 'Instant', oracle_text: 'Draw a card.' }), kill: card('kill', { type_line: 'Instant', oracle_text: 'Destroy target creature.' }),
  bear: card('bear'), cmdr: card('cmdr') }
const lookup = (id) => L[id]

describe('roleCounts', () => {
  it('sorts a deck into the skeleton by the coach\'s own classifiers', () => {
    const deck = { main: [{ cardId: 'forest', quantity: 30 }, { cardId: 'rock', quantity: 2 }, { cardId: 'cantrip', quantity: 1 }, { cardId: 'kill', quantity: 1 }, { cardId: 'bear', quantity: 5 }] }
    const counts = Object.fromEntries(roleCounts(deck, lookup).map((r) => [r.id, r]))
    expect(counts.lands).toMatchObject({ have: 30, short: 6 })
    expect(counts.ramp).toMatchObject({ have: 2, short: 8 })
    expect(counts.draw).toMatchObject({ have: 1, short: 9 })
    expect(counts.removal).toMatchObject({ have: 1, short: 9 })
    expect(counts.theme).toMatchObject({ have: 5, short: 28 })
  })
  it('targets add up to a 99-card list', () => {
    expect(ROLES.reduce((n, r) => n + r.target, 0)).toBe(99)
  })
})

describe('basicSplit', () => {
  it('splits evenly and gives the remainder to the first colour', () => {
    expect(basicSplit('WU', 7)).toEqual([{ color: 'W', name: 'Plains', quantity: 4 }, { color: 'U', name: 'Island', quantity: 3 }])
    expect(basicSplit('G', 5)).toEqual([{ color: 'G', name: 'Forest', quantity: 5 }])
    expect(basicSplit('G', 0)).toEqual([])
  })
})

describe('fillPlan', () => {
  const deck = { commanders: ['cmdr'], main: [{ cardId: 'bear', quantity: 1 }], colors: 'G' }
  const candidates = {
    ramp: Array.from({ length: 12 }, (_, i) => card(`ramp${i}`)),
    draw: [card('draw0'), card('bear')],
    removal: [],
    theme: [card('cmdr'), card('t0')],
    lands: Array.from({ length: 10 }, (_, i) => card(`land${i}`, { type_line: 'Land' })),
  }
  const plan = fillPlan(deck, lookup, candidates)
  it('fills each role up to its target from the candidates', () => {
    expect(plan.filter((a) => a.role === 'ramp')).toHaveLength(10)
  })
  it('never adds a card already in the deck, nor the commander', () => {
    expect(plan.some((a) => a.card?.id === 'bear')).toBe(false)
    expect(plan.some((a) => a.card?.id === 'cmdr')).toBe(false)
  })
  it('stops when a role has no candidates rather than inventing any', () => {
    expect(plan.filter((a) => a.role === 'removal')).toHaveLength(0)
  })
  it('meets the land shortfall with a few nonbasics and then basics', () => {
    const lands = plan.filter((a) => a.role === 'lands')
    expect(lands.filter((a) => a.card)).toHaveLength(6)
    expect(lands.filter((a) => a.basic)).toEqual([{ basic: 'Forest', role: 'lands', quantity: 30 }])
  })

  const total = (p) => p.reduce((n, a) => n + a.quantity, 0)
  it('never grows the list past the cap', () => {
    // 36 lands plus the twelve spells the candidates can supply: under the cap, by the candidates.
    const capped = fillPlan(deck, lookup, candidates, { max: 50 })
    expect(total(capped)).toBe(48)
    expect(total(fillPlan(deck, lookup, candidates, { max: 40 }))).toBe(39)
    expect(total(fillPlan(deck, lookup, candidates, { max: 1 }))).toBe(0)
  })
  it('gives the lands their room before the spells', () => {
    const capped = fillPlan(deck, lookup, candidates, { max: 50 })
    expect(total(capped.filter((a) => a.role === 'lands'))).toBe(36)
    expect(total(capped.filter((a) => a.role !== 'lands'))).toBe(12)
    const tight = fillPlan(deck, lookup, candidates, { max: 20 })
    expect(total(tight)).toBe(19)
    expect(tight.every((a) => a.role === 'lands')).toBe(true)
  })
  it('a role already over its target cannot push the total over', () => {
    const heavy = { ...deck, main: [...Array.from({ length: 40 }, (_, i) => ({ cardId: `ramp${i}`, quantity: 1 }))] }
    const look = (id) => (id.startsWith('ramp') ? card(id, { type_line: 'Artifact', oracle_text: '{T}: Add {C}.' }) : lookup(id))
    const plan = fillPlan(heavy, look, candidates, { max: 99 })
    expect(40 + total(plan)).toBeLessThanOrEqual(99)
  })
})

describe('a commander\u2019s identity as the flow spells it', () => {
  it('reads one colour, a pair in the game\u2019s spelling, or colourless', () => {
    expect(identityKeyOf({ color_identity: ['G'] })).toBe('G')
    expect(identityKeyOf({ color_identity: ['W', 'G'] })).toBe('GW')
    expect(identityKeyOf({ color_identity: ['B', 'U'] })).toBe('UB')
    expect(identityKeyOf({ color_identity: [] })).toBe('C')
    expect(identityKeyOf({ color_identity: ['W', 'U', 'B'] })).toBeNull()
    expect(identityKeyOf(undefined)).toBeNull()
  })
  it('says whether the dial\u2019s colours fit inside it', () => {
    expect(fitsIdentity('G', 'GW')).toBe(true)
    expect(fitsIdentity('GW', 'GW')).toBe(true)
    expect(fitsIdentity('UB', 'GW')).toBe(false)
    expect(fitsIdentity('G', 'UB')).toBe(false)
    expect(fitsIdentity('C', 'C')).toBe(true)
    expect(fitsIdentity('G', 'C')).toBe(false)
  })
})
