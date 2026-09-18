import { describe, it, expect } from 'vitest'
import {
  LANES, laneById, laneFor, isPermanent, refuseBattlefield, snapToLane, laneAt, zoneWhenPlayed,
} from '../src/lib/board/placement.js'

/**
 * Every answer comes from the type line, so these read as a list of type
 * lines and where each one goes. The cases worth having are the ones with two
 * types on them, because those are where a rule of thumb quietly picks wrong.
 */

const card = (type_line) => ({ type_line })

describe('where a card belongs', () => {
  it('puts each kind of permanent in its own lane', () => {
    expect(laneFor(card('Basic Land — Forest'))).toBe('lands')
    expect(laneFor(card('Creature — Bear'))).toBe('creatures')
    expect(laneFor(card('Legendary Planeswalker — Jace'))).toBe('siege')
    expect(laneFor(card('Battle — Siege'))).toBe('siege')
    expect(laneFor(card('Artifact'))).toBe('other')
    expect(laneFor(card('Enchantment — Aura'))).toBe('other')
    expect(laneFor(card('Artifact Creature — Golem'))).toBe('creatures')
  })

  it('files a card that is two things where its owner will look for it', () => {
    // Dryad Arbor is a land first: that is the row a hand reaches for.
    expect(laneFor(card('Land Creature — Forest Dryad'))).toBe('lands')
    // A planeswalker that is also a creature is still the thing being attacked.
    expect(laneFor(card('Legendary Artifact Creature — Planeswalker'))).toBe('siege')
  })

  it('says an instant and a sorcery do not stay on the battlefield at all', () => {
    expect(laneFor(card('Instant'))).toBe(null)
    expect(laneFor(card('Sorcery — Arcane'))).toBe(null)
    expect(isPermanent(card('Instant'))).toBe(false)
    expect(isPermanent(card('Creature — Bear'))).toBe(true)
  })

  it('explains the refusal rather than just refusing', () => {
    expect(refuseBattlefield(card('Instant'))).toMatch(/goes on the stack/)
    expect(refuseBattlefield(card('Sorcery'))).toMatch(/main phase/)
    expect(refuseBattlefield(card('Creature — Bear'))).toBe(null)
  })

  it('finds somewhere for a card nothing can identify', () => {
    expect(laneFor(null)).toBe('other')
    expect(laneFor(card(''))).toBe('other')
    expect(refuseBattlefield(card(''))).toBe(null)
    // A blank card written at the table carries its own type line.
    expect(laneFor(null, { custom: { typeLine: 'Token Creature — Beast' } })).toBe('creatures')
    expect(laneFor(null, { custom: { typeLine: 'Instant' } })).toBe(null)
  })

  it('keeps the across-the-table freedom and decides only the row', () => {
    expect(snapToLane('lands', { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: laneById('lands').y })
    expect(snapToLane('creatures', { x: 0.8 }).x).toBe(0.8)
    expect(snapToLane(null, { x: 0.3, y: 0.7 })).toEqual({ x: 0.3, y: 0.7 })
  })

  it('reads which lane a drop is over', () => {
    expect(laneAt(0.02)).toBe('siege')
    expect(laneAt(0.36)).toBe('creatures')
    expect(laneAt(0.99)).toBe('lands')
  })

  it('sends a spell to the stack and a permanent to the battlefield', () => {
    expect(zoneWhenPlayed(card('Instant'))).toBe('stack')
    expect(zoneWhenPlayed(card('Creature — Bear'))).toBe('battlefield')
    expect(zoneWhenPlayed(card('Basic Land — Island'))).toBe('battlefield')
  })

  it('lays the lanes out back to front, without overlapping', () => {
    expect(LANES.map((l) => l.id)).toEqual(['siege', 'creatures', 'other', 'lands'])
    for (let i = 1; i < LANES.length; i++) {
      expect(LANES[i].y, LANES[i].id).toBeGreaterThan(LANES[i - 1].y)
      const gap = LANES[i].y - LANES[i - 1].y
      expect(gap, `${LANES[i - 1].id} to ${LANES[i].id}`).toBeGreaterThanOrEqual((LANES[i].band + LANES[i - 1].band) / 2 - 0.01)
    }
  })
})
