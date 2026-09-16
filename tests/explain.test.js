import { describe, it, expect } from 'vitest'
import {
  explainCard, explainLine, explainCost, KEYWORD_TERMS, ABILITY_WORDS,
} from '../src/lib/explain.js'
import { GLOSSARY } from '../src/data/glossary.js'

const card = (over) => ({
  name: 'Test', mana_cost: '', type_line: 'Creature — Bear', oracle_text: '', ...over,
})
const only = (over) => explainCard(card(over)).lines[0]

describe('triggered abilities', () => {
  it('recognises all three trigger words', () => {
    expect(only({ oracle_text: 'When this creature dies, draw a card.' }).kind).toBe('triggered')
    expect(only({ oracle_text: 'Whenever you cast a spell, scry 1.' }).kind).toBe('triggered')
    expect(only({ oracle_text: 'At the beginning of your upkeep, draw a card.' }).kind).toBe('triggered')
  })

  it('distinguishes once from every time', () => {
    expect(only({ oracle_text: 'When this dies, draw a card.' }).explanation).toMatch(/once/)
    expect(only({ oracle_text: 'Whenever a land enters, draw a card.' }).explanation).toMatch(/every time/)
  })

  it('separates the condition from the effect', () => {
    const line = only({ oracle_text: 'Whenever a creature dies, you gain 1 life.' })
    expect(line.condition).toBe('Whenever a creature dies')
    expect(line.effect).toBe('you gain 1 life.')
  })

  it('says plainly that a trigger without "may" is mandatory', () => {
    // The most expensive beginner misunderstanding: triggers are not optional.
    const line = only({ oracle_text: 'Whenever a creature dies, you lose 1 life.' })
    expect(line.optional).toBe(false)
    expect(line.explanation).toMatch(/not optional/)
  })

  it('notices "may" and says you get a choice', () => {
    const line = only({ oracle_text: 'At the beginning of your upkeep, you may draw a card.' })
    expect(line.optional).toBe(true)
    expect(line.explanation).toMatch(/you choose/)
    expect(line.terms).toContain('mayKeyword')
  })

  it('does not mistake a comma inside reminder text for the end of the condition', () => {
    const line = only({
      oracle_text: 'Whenever this attacks, it gains flying (It can only be blocked by fliers, or reach.) until end of turn.',
    })
    expect(line.condition).toBe('Whenever this attacks')
  })
})

describe('reflexive triggers — "when you do"', () => {
  // The hardest common case: it sits in the second sentence of a line whose
  // first sentence reads like an ordinary instruction.
  it('is caught even though the line does not start with a trigger word', () => {
    const line = only({
      type_line: 'Sorcery',
      oracle_text: 'You may sacrifice a creature. When you do, draw two cards.',
    })
    expect(line.reflexive).toBe(true)
    expect(line.explanation).toMatch(/only fires if you actually took the optional action/)
    expect(line.terms).toContain('reflexiveTrigger')
  })

  it('is caught on a permanent too', () => {
    const line = only({
      oracle_text: 'When this enters, you may discard a card. When you do, draw a card.',
    })
    expect(line.reflexive).toBe(true)
  })

  it('handles the negative form', () => {
    expect(only({ oracle_text: "You may pay {2}. When you don't, sacrifice this." }).reflexive).toBe(true)
  })

  it('does not fire on an ordinary "when"', () => {
    expect(only({ oracle_text: 'When this enters, draw a card.' }).reflexive).toBe(false)
  })
})

describe('activated abilities', () => {
  it('splits cost from effect', () => {
    const line = only({ oracle_text: '{T}: Add {G}.' })
    expect(line.kind).toBe('activated')
    expect(line.cost).toBe('{T}')
    expect(line.effect).toBe('Add {G}.')
  })

  it('explains what the tap symbol implies', () => {
    const line = only({ oracle_text: '{T}: Add {G}.' })
    expect(line.explanation).toMatch(/once per turn/)
    expect(line.terms).toContain('summoningSickness')
  })

  it('flags a sacrifice cost as irreversible', () => {
    expect(only({ oracle_text: 'Sacrifice a creature: Draw a card.' }).explanation)
      .toMatch(/cannot take back/)
  })

  it('does not mistake a sentence containing a colon for an ability', () => {
    // A long left-hand side is prose, not a cost.
    const line = only({
      oracle_text: 'Choose one — this creature gets +2/+2 until end of turn; or target creature gains flying: this is not a cost.',
    })
    expect(line.kind).not.toBe('activated')
  })

  it('does not mistake a trigger for an activated ability', () => {
    expect(only({ oracle_text: 'When this enters: draw a card.' }).kind).toBe('triggered')
  })
})

describe('keyword lines', () => {
  it('recognises a line that is nothing but keywords', () => {
    const line = only({ oracle_text: 'Flying, vigilance' })
    expect(line.kind).toBe('keywords')
    expect(line.terms).toEqual(expect.arrayContaining(['flying', 'vigilance']))
  })

  it('handles keywords that carry a parameter', () => {
    expect(only({ oracle_text: 'Ward {2}' }).kind).toBe('keywords')
    expect(only({ oracle_text: 'Protection from red' }).kind).toBe('keywords')
  })

  it('links keywords mentioned inside a sentence too', () => {
    const line = only({ oracle_text: 'Target creature gains trample until end of turn.', type_line: 'Instant' })
    expect(line.terms).toContain('trample')
  })

  it('does not treat a sentence as a keyword line', () => {
    expect(only({ oracle_text: 'Creatures you control get +1/+1.' }).kind).toBe('static')
  })
})

describe('ability words', () => {
  it('identifies one and says it does nothing', () => {
    const line = only({
      oracle_text: 'Landfall — Whenever a land enters the battlefield under your control, draw a card.',
    })
    expect(line.abilityWord).toBe('Landfall')
    expect(line.abilityWordNote).toMatch(/no rules meaning/)
    expect(line.terms).toContain('abilityWord')
  })

  it('still classifies the rule after the dash', () => {
    const line = only({ oracle_text: 'Landfall — Whenever a land enters, draw a card.' })
    expect(line.kind).toBe('triggered')
  })

  it('does not treat an unknown word before a dash as an ability word', () => {
    const line = only({ oracle_text: 'Equip {2} — this is not an ability word.' })
    expect(line.abilityWord).toBeNull()
  })
})

describe('static abilities and spell instructions', () => {
  it('calls untriggered text on a permanent static', () => {
    const line = only({ oracle_text: 'Creatures you control get +1/+1.' })
    expect(line.kind).toBe('static')
    expect(line.explanation).toMatch(/cannot be responded to/)
  })

  it('calls the same text on an instant an instruction', () => {
    const line = only({ type_line: 'Instant', oracle_text: 'Destroy target creature.' })
    expect(line.kind).toBe('instruction')
    expect(line.explanation).toMatch(/graveyard/)
  })
})

describe('explainCost', () => {
  it('reads a mixed cost in plain words', () => {
    expect(explainCost('{2}{W}{W}')).toBe('Costs 2 mana of any kind, 2 white.')
  })

  it('mentions X', () => {
    expect(explainCost('{X}{R}')).toMatch(/X/)
  })

  it('returns null for a land', () => {
    expect(explainCost('')).toBeNull()
  })
})

describe('explainCard', () => {
  it('explains power and toughness', () => {
    const result = explainCard(card({ power: '2', toughness: '3' }))
    expect(result.stats).toMatch(/deals 2 damage/)
    expect(result.stats).toMatch(/taken 3/)
  })

  it('explains loyalty for a planeswalker', () => {
    const result = explainCard(card({ type_line: 'Legendary Planeswalker — Jace', loyalty: '4' }))
    expect(result.stats).toMatch(/4 loyalty/)
  })

  it('says something kind about a card with no rules text', () => {
    const result = explainCard(card({ power: '2', toughness: '2' }))
    expect(result.lines).toEqual([])
    expect(result.vanillaNote).toMatch(/no rules text/)
  })

  it('explains each line of a multi-line card separately', () => {
    const result = explainCard(card({
      oracle_text: 'Flying\nWhen this enters, draw a card.\n{T}: Add {W}.',
    }))
    expect(result.lines.map((l) => l.kind)).toEqual(['keywords', 'triggered', 'activated'])
  })

  it('uses the front face of a double-faced card', () => {
    const result = explainCard({
      name: 'Two Faces', type_line: 'Creature — Human // Creature — Werewolf',
      card_faces: [
        { type_line: 'Creature — Human', mana_cost: '{1}{R}', oracle_text: 'Flying' },
        { type_line: 'Creature — Werewolf', oracle_text: 'Trample' },
      ],
    })
    expect(result.typeLine).toBe('Creature — Human')
  })

  it('returns null for no card at all', () => {
    expect(explainCard(null)).toBeNull()
  })
})

describe('cross-references resolve', () => {
  it('every keyword maps to a real glossary term', () => {
    for (const [keyword, term] of Object.entries(KEYWORD_TERMS)) {
      expect(GLOSSARY[term], `"${keyword}" maps to missing term "${term}"`).toBeTruthy()
    }
  })

  it('every term the explainer cites exists', () => {
    const samples = [
      'When this dies, draw a card.',
      '{T}: Add {G}.',
      'Flying, vigilance',
      'Creatures you control get +1/+1.',
      'You may sacrifice a creature. When you do, draw two cards.',
      'Landfall — Whenever a land enters, draw a card.',
    ]
    for (const text of samples) {
      for (const term of explainLine(text).terms) {
        expect(GLOSSARY[term], `"${text}" cites missing term "${term}"`).toBeTruthy()
      }
    }
  })

  it('ability words are lowercase for case-insensitive matching', () => {
    for (const word of ABILITY_WORDS) expect(word).toBe(word.toLowerCase())
  })
})
