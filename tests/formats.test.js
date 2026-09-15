import { describe, it, expect } from 'vitest'
import {
  FORMATS, getFormat, copyLimitOverride, effectiveCopyLimit,
  isBasicLand, canBeCommander, cardLegality, typeLineOf, oracleTextOf,
} from '../src/lib/formats.js'
import { card, FOREST, BEAR, COMMANDER_BEAR, RELENTLESS_RATS, NAZGUL } from './fixtures.js'

describe('format definitions', () => {
  it('covers every format the app claims to support', () => {
    for (const id of ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper',
      'commander', 'duel', 'brawl', 'oathbreaker']) {
      expect(getFormat(id), `${id} missing`).toBeTruthy()
    }
  })

  it('gives every format a legality key and coherent deck bounds', () => {
    for (const f of Object.values(FORMATS)) {
      expect(f.legalityKey, `${f.id} legalityKey`).toBeTruthy()
      expect(f.deck.min).toBeGreaterThan(0)
      if (f.deck.max) expect(f.deck.max).toBeGreaterThanOrEqual(f.deck.min)
    }
  })

  it('makes every singleton format a one-copy format', () => {
    for (const f of Object.values(FORMATS)) {
      if (f.singleton) expect(f.maxCopies, `${f.id}`).toBe(1)
    }
  })

  it('gives commander formats a commander requirement and no sideboard', () => {
    for (const f of Object.values(FORMATS)) {
      if (f.group !== 'commander') continue
      expect(f.commander?.required, `${f.id}`).toBe(true)
      expect(f.sideboard.max, `${f.id}`).toBe(0)
    }
  })
})

describe('copyLimitOverride', () => {
  it('reads an unlimited clause out of rules text', () => {
    expect(copyLimitOverride(RELENTLESS_RATS)).toBe(Infinity)
  })

  it('reads a numeric cap written as a word', () => {
    expect(copyLimitOverride(NAZGUL)).toBe(9)
  })

  it('returns null for ordinary cards', () => {
    expect(copyLimitOverride(BEAR)).toBeNull()
  })
})

describe('effectiveCopyLimit', () => {
  it('lets basic lands be unlimited even in singleton formats', () => {
    expect(effectiveCopyLimit(FOREST, FORMATS.commander)).toBe(Infinity)
    expect(effectiveCopyLimit(FOREST, FORMATS.modern)).toBe(Infinity)
  })

  it('caps ordinary cards at four in constructed and one in singleton', () => {
    expect(effectiveCopyLimit(BEAR, FORMATS.modern)).toBe(4)
    expect(effectiveCopyLimit(BEAR, FORMATS.commander)).toBe(1)
  })

  it('honours an unlimited clause even in singleton formats', () => {
    // This is exactly how Relentless Rats decks are legal in Commander.
    expect(effectiveCopyLimit(RELENTLESS_RATS, FORMATS.commander)).toBe(Infinity)
  })
})

describe('isBasicLand', () => {
  it('accepts basics and rejects nonbasics', () => {
    expect(isBasicLand(FOREST)).toBe(true)
    expect(isBasicLand(card({ type_line: 'Land — Forest Island' }))).toBe(false)
    expect(isBasicLand(BEAR)).toBe(false)
  })

  it('accepts Snow Basic Lands', () => {
    expect(isBasicLand(card({ type_line: 'Basic Snow Land — Forest' }))).toBe(true)
  })
})

describe('canBeCommander', () => {
  it('accepts a legendary creature', () => {
    expect(canBeCommander(COMMANDER_BEAR, FORMATS.commander).ok).toBe(true)
  })

  it('rejects a nonlegendary creature with a reason', () => {
    const result = canBeCommander(BEAR, FORMATS.commander)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/legendary creature/i)
  })

  it('accepts a card that says it can be your commander', () => {
    const planar = card({
      type_line: 'Legendary Planeswalker — Rowan',
      oracle_text: 'Rowan can be your commander.',
    })
    expect(canBeCommander(planar, FORMATS.commander).ok).toBe(true)
  })

  it('rejects a bare planeswalker in Commander but accepts it in Brawl', () => {
    const pw = card({ type_line: 'Legendary Planeswalker — Jace' })
    expect(canBeCommander(pw, FORMATS.commander).ok).toBe(false)
    expect(canBeCommander(pw, FORMATS.brawl).ok).toBe(true)
  })

  it('requires a planeswalker for Oathbreaker', () => {
    expect(canBeCommander(COMMANDER_BEAR, FORMATS.oathbreaker).ok).toBe(false)
    expect(canBeCommander(card({ type_line: 'Legendary Planeswalker — Jace' }), FORMATS.oathbreaker).ok).toBe(true)
  })
})

describe('cardLegality', () => {
  it('passes Scryfall status straight through', () => {
    const banned = card({ legalities: { modern: 'banned' } })
    expect(cardLegality(banned, FORMATS.modern)).toBe('banned')
  })

  it('reports unknown rather than guessing when data is absent', () => {
    expect(cardLegality(card({ legalities: {} }), FORMATS.modern)).toBe('unknown')
  })
})

describe('multi-face cards', () => {
  it('flattens type lines and oracle text across faces', () => {
    const dfc = {
      card_faces: [
        { type_line: 'Creature — Human', oracle_text: 'front' },
        { type_line: 'Creature — Werewolf', oracle_text: 'back' },
      ],
    }
    expect(typeLineOf(dfc)).toContain('Werewolf')
    expect(oracleTextOf(dfc)).toContain('back')
  })
})
