import { describe, it, expect } from 'vitest'
import { targetsFor, rolesFor, roleOf, roleCounts } from '../src/lib/skeleton.js'
import { coachDeck } from '../src/lib/coach.js'
import { ROLES } from '../src/lib/first-deck.js'
import { getFormat } from '../src/lib/formats.js'

/**
 * One skeleton, read by the coach and the first-deck flow. These tests
 * exist so the two can never drift apart again without a test saying so.
 */
const card = (id, over = {}) => ({ id, name: id, type_line: 'Creature — Elf', oracle_text: '', prices: {}, ...over })

describe('the skeleton', () => {
  it('has Commander targets that add up to the 99 beside the commander', () => {
    const roles = rolesFor(getFormat('commander'))
    expect(roles.reduce((n, r) => n + r.target, 0)).toBe(99)
    expect(roles.map((r) => r.id)).toEqual(['lands', 'ramp', 'draw', 'removal', 'theme'])
  })
  it('has no ramp role for a sixty-card format, where lands do that work', () => {
    const roles = rolesFor(getFormat('modern'))
    expect(roles.find((r) => r.id === 'ramp')).toBeUndefined()
    expect(roles.reduce((n, r) => n + r.target, 0)).toBe(60)
  })
  it('sorts a card into one role, lands first', () => {
    expect(roleOf(card('f', { type_line: 'Basic Land — Forest' }))).toBe('lands')
    expect(roleOf(card('r', { type_line: 'Artifact', oracle_text: '{T}: Add {C}.' }))).toBe('ramp')
    expect(roleOf(card('d', { type_line: 'Instant', oracle_text: 'Draw two cards.' }))).toBe('draw')
    expect(roleOf(card('k', { type_line: 'Instant', oracle_text: 'Destroy target creature.' }))).toBe('removal')
    expect(roleOf(card('b'))).toBe('theme')
    expect(roleOf(undefined)).toBe('theme')
  })
})

describe('the coach and the first-deck flow agree', () => {
  it('the first-deck roles are the skeleton\'s Commander roles', () => {
    expect(ROLES).toEqual(rolesFor(getFormat('commander')))
  })
  it('the coach wants what the skeleton says, in both formats', () => {
    for (const formatId of ['commander', 'modern']) {
      const format = getFormat(formatId)
      const t = targetsFor(format)
      const cards = new Map([['x', card('x')]])
      const deck = { id: 'd', formatId, commanders: formatId === 'commander' ? ['x'] : [], main: [{ cardId: 'x', quantity: 1 }], sideboard: [] }
      const report = coachDeck(deck, (id) => cards.get(id))
      const want = Object.fromEntries(report.checks.map((c) => [c.id, c.want]))
      expect(want.removal).toBe(t.removal)
      expect(want.draw).toBe(t.draw)
      expect(want.creatures).toBe(t.creatureFloor)
      if (formatId === 'commander') expect(want.ramp).toBe(t.ramp)
      else expect(want.ramp).toBeUndefined()
    }
  })
  it('counts the same cards into the same roles the coach counts', () => {
    const cards = new Map([
      ['r', card('r', { type_line: 'Artifact', oracle_text: '{T}: Add {C}.' })],
      ['k', card('k', { type_line: 'Instant', oracle_text: 'Destroy target creature.' })],
    ])
    const deck = { id: 'd', formatId: 'commander', commanders: [], main: [{ cardId: 'r', quantity: 3 }, { cardId: 'k', quantity: 2 }], sideboard: [] }
    const counts = Object.fromEntries(roleCounts(deck, (id) => cards.get(id), getFormat('commander')).map((r) => [r.id, r.have]))
    const report = coachDeck(deck, (id) => cards.get(id))
    const have = Object.fromEntries(report.checks.map((c) => [c.id, c.have]))
    expect(counts.ramp).toBe(have.ramp)
    expect(counts.removal).toBe(have.removal)
  })
})
