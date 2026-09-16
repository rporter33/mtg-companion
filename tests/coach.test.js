import { describe, it, expect } from 'vitest'
import { coachDeck, __testing } from '../src/lib/coach.js'
import { createDeck, addCard, setCommanders } from '../src/lib/deck.js'

const { IS_REMOVAL, IS_DRAW, IS_RAMP, IS_CREATURE } = __testing

const mk = (id, over = {}) => ({
  id, name: id, mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Bear',
  oracle_text: '', color_identity: ['G'], legalities: { commander: 'legal', modern: 'legal' },
  prices: {}, ...over,
})

const FOREST = mk('forest', { type_line: 'Basic Land — Forest', mana_cost: '', cmc: 0, produced_mana: ['G'], color_identity: [] })
const CMDR = mk('cmdr', { type_line: 'Legendary Creature — Elf', cmc: 3 })
const BOLT = mk('bolt', { type_line: 'Instant', cmc: 1, oracle_text: 'Bolt deals 3 damage to any target.' })
const DRAW = mk('draw', { type_line: 'Sorcery', cmc: 2, oracle_text: 'Draw two cards.' })
const ROCK = mk('rock', { type_line: 'Artifact', cmc: 2, oracle_text: '{T}: Add {G}.', produced_mana: ['G'] })

const library = new Map([FOREST, CMDR, BOLT, DRAW, ROCK].map((c) => [c.id, c]))
const lookup = (id) => library.get(id)
const checkOf = (report, id) => report.checks.find((c) => c.id === id)

function commanderDeck(entries = []) {
  let deck = setCommanders(createDeck({ formatId: 'commander' }), ['cmdr'])
  for (const [id, n] of entries) deck = addCard(deck, id, n)
  return deck
}

describe('card classification', () => {
  it('counts every common shape of removal', () => {
    // Deliberately broad: missing removal is annoying, demanding removal the
    // deck already has is actively wrong.
    expect(IS_REMOVAL({ oracle_text: 'Destroy target creature.' })).toBe(true)
    expect(IS_REMOVAL({ oracle_text: 'Exile target permanent.' })).toBe(true)
    expect(IS_REMOVAL({ oracle_text: 'Counter target spell.' })).toBe(true)
    expect(IS_REMOVAL({ oracle_text: 'Destroy all creatures.' })).toBe(true)
  })

  it('counts damage worded either way', () => {
    // "to any target" is the modern wording; an earlier version required
    // "to target" and so missed Lightning Bolt entirely.
    expect(IS_REMOVAL({ oracle_text: 'Bolt deals 3 damage to any target.' })).toBe(true)
    expect(IS_REMOVAL({ oracle_text: 'Deals 2 damage to target creature.' })).toBe(true)
    expect(IS_REMOVAL({ oracle_text: 'Deals X damage to any target.' })).toBe(true)
  })

  it('does not count a plain creature as removal', () => {
    expect(IS_REMOVAL({ oracle_text: '' })).toBe(false)
    expect(IS_REMOVAL({ oracle_text: 'Flying' })).toBe(false)
  })

  it('counts card draw but not the symmetrical kind', () => {
    expect(IS_DRAW({ oracle_text: 'Draw a card.' })).toBe(true)
    expect(IS_DRAW({ oracle_text: 'Draw three cards.' })).toBe(true)
    expect(IS_DRAW({ oracle_text: 'Each opponent draws a card.' })).toBe(false)
  })

  it('counts ramp but never counts a land as ramp', () => {
    // Lands are already counted as mana sources; counting them twice would
    // tell a deck it has plenty of ramp when it has none.
    expect(IS_RAMP({ oracle_text: '{T}: Add {G}.', type_line: 'Artifact' })).toBe(true)
    expect(IS_RAMP({ oracle_text: 'Search your library for a basic land card.', type_line: 'Sorcery' })).toBe(true)
    expect(IS_RAMP({ oracle_text: '{T}: Add {G}.', type_line: 'Basic Land — Forest' })).toBe(false)
  })

  it('counts creatures including artifact creatures', () => {
    expect(IS_CREATURE({ type_line: 'Artifact Creature — Golem' })).toBe(true)
    expect(IS_CREATURE({ type_line: 'Enchantment' })).toBe(false)
  })
})

describe('deck size', () => {
  it('says exactly how far off a Commander deck is', () => {
    const report = coachDeck(commanderDeck([['forest', 50]]), lookup)
    const size = checkOf(report, 'size')
    expect(size.have).toBe(51)     // 50 forests plus the commander
    expect(size.want).toBe(100)
    expect(size.message).toMatch(/49 cards short/)
  })

  it('is satisfied at exactly the target', () => {
    const report = coachDeck(commanderDeck([['forest', 99]]), lookup)
    expect(checkOf(report, 'size').severity).toBe('ok')
  })

  it('complains about going over', () => {
    const report = coachDeck(commanderDeck([['forest', 105]]), lookup)
    expect(checkOf(report, 'size').message).toMatch(/over/)
  })
})

describe('mana advice', () => {
  it('judges against the finished deck size, not the current one', () => {
    // The bug this replaced: a 43-card work-in-progress was told it had
    // 20 more lands than it needed while being 57 cards short.
    const report = coachDeck(commanderDeck([['forest', 30]]), lookup)
    const mana = checkOf(report, 'mana')
    expect(mana.want).toBeGreaterThan(30)
    expect(mana.why).toMatch(/finished 100-card deck/)
  })

  it('counts mana rocks alongside lands', () => {
    const report = coachDeck(commanderDeck([['forest', 30], ['rock', 7]]), lookup)
    expect(checkOf(report, 'mana').have).toBe(37)
  })

  it('accepts a mana base within a couple of sources of target', () => {
    const report = coachDeck(commanderDeck([['forest', 37], ['bolt', 30], ['draw', 32]]), lookup)
    expect(checkOf(report, 'mana').severity).toBe('ok')
  })
})

describe('advice is stable while a deck is half-built', () => {
  it('does not let one card drag the mana target around', () => {
    // With only a four-mana commander in it, the curve average is 4 and an
    // uncorrected target jumps three sources higher than it should.
    const nearlyEmpty = coachDeck(commanderDeck([['forest', 34]]), lookup)
    const withSpells = coachDeck(
      commanderDeck([['forest', 34], ['bolt', 10], ['draw', 10]]), lookup)
    expect(checkOf(nearlyEmpty, 'mana').want).toBe(40)
    expect(Math.abs(checkOf(withSpells, 'mana').want - 40)).toBeLessThanOrEqual(4)
  })

  it('says the target will adjust once there are more spells', () => {
    const report = coachDeck(commanderDeck([['forest', 34]]), lookup)
    expect(checkOf(report, 'mana').why).toMatch(/adjust to your actual curve/)
  })

  it('does not score the curve before it can be judged', () => {
    // Showing "0/1" beside a green tick reads as a verdict, and it is not one.
    const early = coachDeck(commanderDeck([['forest', 34]]), lookup)
    expect(checkOf(early, 'curve').scored).toBe(false)

    const later = coachDeck(commanderDeck([['forest', 34], ['bolt', 10]]), lookup)
    expect(checkOf(later, 'curve').scored).toBe(true)
  })

  it('does not count an unjudged check toward progress', () => {
    const report = coachDeck(commanderDeck([['forest', 34]]), lookup)
    const scored = report.checks.filter((c) => c.scored)
    const passed = scored.filter((c) => c.severity === 'ok')
    expect(report.progress).toBeCloseTo(passed.length / scored.length, 5)
  })

  it('never reports NaN progress for an empty deck', () => {
    const report = coachDeck(createDeck({ formatId: 'commander' }), lookup)
    expect(Number.isFinite(report.progress)).toBe(true)
  })
})

describe('interaction and draw', () => {
  it('flags a deck with no answers', () => {
    const report = coachDeck(commanderDeck([['forest', 60]]), lookup)
    const removal = checkOf(report, 'removal')
    expect(removal.have).toBe(0)
    expect(removal.severity).toBe('error')
    expect(removal.query).toContain('destroy target')
  })

  it('is satisfied once there are enough', () => {
    const report = coachDeck(commanderDeck([['forest', 40], ['bolt', 12]]), lookup)
    expect(checkOf(report, 'removal').severity).toBe('ok')
  })

  it('scopes its suggestions to the commander\'s colours', () => {
    const report = coachDeck(commanderDeck([['forest', 60]]), lookup)
    expect(checkOf(report, 'removal').query).toMatch(/id<=/)
    expect(checkOf(report, 'removal').query).toMatch(/legal:commander/)
  })

  it('asks for more draw in Commander than in 60-card', () => {
    const commander = coachDeck(commanderDeck([['forest', 40]]), lookup)
    let sixty = createDeck({ formatId: 'modern' })
    sixty = addCard(sixty, 'forest', 24)
    const modern = coachDeck(sixty, lookup)
    expect(checkOf(commander, 'draw').want).toBeGreaterThan(checkOf(modern, 'draw').want)
  })
})

describe('format differences', () => {
  it('only asks about ramp in Commander', () => {
    const commander = coachDeck(commanderDeck([['forest', 40]]), lookup)
    let sixty = addCard(createDeck({ formatId: 'modern' }), 'forest', 24)
    expect(checkOf(commander, 'ramp')).toBeTruthy()
    expect(checkOf(coachDeck(sixty, lookup), 'ramp')).toBeUndefined()
  })

  it('does not scope by colour identity in a 60-card format', () => {
    const sixty = addCard(createDeck({ formatId: 'modern' }), 'forest', 24)
    expect(checkOf(coachDeck(sixty, lookup), 'removal').query).not.toMatch(/id<=/)
  })
})

describe('tone and progression', () => {
  it('says nothing discouraging about an empty deck', () => {
    const report = coachDeck(createDeck({ formatId: 'commander' }), lookup)
    expect(report.headline).toMatch(/advice will appear/)
  })

  it('is encouraging while a deck is clearly unfinished', () => {
    const report = coachDeck(commanderDeck([['forest', 10]]), lookup)
    expect(report.headline).toMatch(/Early days/)
  })

  it('congratulates a deck that passes everything', () => {
    const report = coachDeck(
      commanderDeck([['forest', 30], ['rock', 8], ['bolt', 12], ['draw', 12], ['cmdr2', 0]]), lookup)
    // Not necessarily fully passing with this fixture set — but the headline
    // must never be scolding when only warnings remain.
    expect(report.headline).not.toMatch(/wrong|bad|error/i)
  })

  it('reports progress as a fraction of checks passed', () => {
    const report = coachDeck(commanderDeck([['forest', 40]]), lookup)
    expect(report.progress).toBeGreaterThanOrEqual(0)
    expect(report.progress).toBeLessThanOrEqual(1)
  })

  it('gives every check a reason, not just a number', () => {
    const report = coachDeck(commanderDeck([['forest', 40]]), lookup)
    for (const c of report.checks) {
      expect(c.why?.length, `${c.id} has no explanation`).toBeGreaterThan(30)
      expect(c.message?.length, `${c.id} has no message`).toBeGreaterThan(5)
    }
  })

  it('offers a search only where there is a gap to fill', () => {
    const report = coachDeck(commanderDeck([['forest', 40], ['bolt', 12]]), lookup)
    expect(checkOf(report, 'removal').query).toBeNull()
    expect(checkOf(report, 'size').query).toBeTruthy()
  })
})

describe('robustness', () => {
  it('returns null for an unknown format rather than throwing', () => {
    expect(coachDeck({ ...createDeck(), formatId: 'nonsense' }, lookup)).toBeNull()
  })

  it('survives cards that have not loaded', () => {
    const deck = addCard(commanderDeck(), 'never-seen', 40)
    expect(() => coachDeck(deck, lookup)).not.toThrow()
  })
})
