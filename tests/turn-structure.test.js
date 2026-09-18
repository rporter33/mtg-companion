import { describe, it, expect } from 'vitest'
import { PHASES, STEPS, nextStep, isSorcerySpeed, hasPriority, stepAt, indexOfStep, FIRST_STEP } from '../src/data/turn-structure.js'

/**
 * The turn as the rules describe it, checked as data. What is worth guarding
 * is the shape a player would notice being wrong: the order of the steps, the
 * two places nobody gets priority, where a land may be played, and the fact
 * that first-strike damage is a step that usually does not happen.
 */

describe('the structure of a turn', () => {
  it('is the five phases, in order', () => {
    expect(PHASES.map((p) => p.id)).toEqual(['beginning', 'main1', 'combat', 'main2', 'ending'])
  })

  it('walks the steps in the order they happen', () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      'untap', 'upkeep', 'draw',
      'main1',
      'beginCombat', 'attackers', 'blockers', 'firstStrike', 'damage', 'endCombat',
      'main2',
      'end', 'cleanup',
    ])
    expect(FIRST_STEP).toBe('untap')
  })

  it('names the two steps where nobody gets priority', () => {
    const quiet = STEPS.filter((s) => !s.priority).map((s) => s.id)
    expect(quiet).toEqual(['untap', 'cleanup'])
    expect(hasPriority('untap')).toBe(false)
    expect(hasPriority('upkeep')).toBe(true)
  })

  it('allows a land and a sorcery only in the two main phases', () => {
    const sorcerySpeed = STEPS.filter((s) => s.sorcerySpeed).map((s) => s.id)
    expect(sorcerySpeed).toEqual(['main1', 'main2'])
    expect(isSorcerySpeed('main1')).toBe(true)
    expect(isSorcerySpeed('damage')).toBe(false)
  })

  it('skips the first-strike step unless something in combat has first strike', () => {
    expect(nextStep('blockers').step.id).toBe('damage')
    expect(nextStep('blockers', { hasFirstStrike: true }).step.id).toBe('firstStrike')
    expect(nextStep('firstStrike').step.id).toBe('damage')
  })

  it('rolls over from cleanup to the next turn’s untap, and says that it did', () => {
    expect(nextStep('cleanup')).toMatchObject({ step: { id: 'untap' }, wrapped: true })
    expect(nextStep('untap').wrapped).toBe(false)
  })

  it('carries the phase on every step, so the tracker can say where it is', () => {
    const damage = STEPS.find((s) => s.id === 'damage')
    expect(damage).toMatchObject({ phaseId: 'combat', phaseName: 'Combat phase' })
  })

  it('cites a rule for everything it claims', () => {
    for (const step of STEPS) {
      expect(step.rule, step.id).toMatch(/^\d/)
      for (const line of step.does) expect(line.rule, `${step.id}: ${line.text}`).toMatch(/^\d/)
    }
  })

  it('reads a step by position, whichever way it is counted', () => {
    expect(stepAt(0).id).toBe('untap')
    expect(stepAt(STEPS.length).id).toBe('untap')
    expect(stepAt(-1).id).toBe('cleanup')
    expect(indexOfStep('damage')).toBe(8)
    expect(indexOfStep('nowhere')).toBe(-1)
  })
})
