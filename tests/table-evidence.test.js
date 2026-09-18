import { describe, it, expect, beforeEach } from 'vitest'
import { memoryBackend } from '../src/lib/storage-backend.js'
import { useBackend, recordCompletion, recordEvidence, getPractice, markPaperPractice, exportAll, importAll, clearAll } from '../src/lib/storage.js'
import { evidenceFor, nextScenario, withCompletion, DEMONSTRATION_RUNS } from '../src/lib/table/evidence.js'
import { LESSONS } from '../src/lib/table/scenarios/index.js'

/**
 * Viewed, practiced and demonstrated are separate evidence. A view never
 * implies skill; a hint keeps a run from counting toward a demonstration
 * but loses nothing; paper practice is listed and not counted; revisiting
 * never removes what was earned.
 */
beforeEach(() => { useBackend(memoryBackend()) })

const mana = LESSONS[0]

describe('evidence', () => {
  it('starts as new, becomes viewed on a view, and viewing alone is never practiced', () => {
    expect(evidenceFor(mana.id, getPractice())).toMatchObject({ status: 'new', viewed: false, practiced: false, demonstrated: false })
    recordEvidence(mana.id, 'viewed')
    expect(evidenceFor(mana.id, getPractice())).toMatchObject({ status: 'viewed', viewed: true, practiced: false, demonstrated: false })
  })

  it('a completion with hints is practiced; two different exercises without hints are a demonstration', () => {
    recordCompletion(mana.id, mana.scenarios[0], { hints: 1 })
    let e = evidenceFor(mana.id, getPractice())
    expect(e).toMatchObject({ status: 'practiced', practiced: true, demonstrated: false, clean: 0 })
    recordCompletion(mana.id, mana.scenarios[0], { hints: 0 })
    e = evidenceFor(mana.id, getPractice())
    expect(e.clean).toBe(1)
    expect(e.demonstrated).toBe(false)
    // The same exercise again does not count twice.
    recordCompletion(mana.id, mana.scenarios[0], { hints: 0 })
    expect(evidenceFor(mana.id, getPractice()).demonstrated).toBe(false)
    recordCompletion(mana.id, mana.scenarios[1], { hints: 0 })
    e = evidenceFor(mana.id, getPractice())
    expect(e).toMatchObject({ status: 'demonstrated', demonstrated: true, clean: DEMONSTRATION_RUNS })
    expect(getPractice().evidence[mana.id].demonstrated.at).toBeTruthy()
  })

  it('never loses evidence: a later run with more hints keeps the cleaner record, and the first date', () => {
    recordCompletion(mana.id, 'mana-guided', { hints: 0 })
    const first = getPractice().evidence[mana.id].completions['mana-guided']
    recordCompletion(mana.id, 'mana-guided', { hints: 3 })
    expect(getPractice().evidence[mana.id].completions['mana-guided']).toEqual(first)
    expect(withCompletion({ completions: { a: { hints: 2, at: 't1' } } }, 'a', { hints: 0, at: 't2' }).completions.a).toEqual({ hints: 0, at: 't1' })
  })

  it('paper practice is recorded and not counted', () => {
    markPaperPractice('mana-guided')
    expect(evidenceFor(mana.id, getPractice()).status).toBe('new')
  })

  it('points at the next exercise not yet done, then at ones done with hints, then nowhere', () => {
    expect(nextScenario(getPractice())).toMatchObject({ scenario: { id: 'mana-guided' }, why: 'not yet done' })
    recordCompletion(mana.id, 'mana-guided', { hints: 1 })
    expect(nextScenario(getPractice()).scenario.id).toBe('mana-independent')
    for (const lesson of LESSONS) for (const id of lesson.scenarios) if (id !== 'mana-guided') recordCompletion(lesson.id, id, { hints: 0 })
    // Everything done without hints, except the guided one, which was done with one hint: that is the one to try again.
    expect(nextScenario(getPractice())).toMatchObject({ scenario: { id: 'mana-guided' }, why: 'done with hints' })
    recordCompletion(mana.id, 'mana-guided', { hints: 0 })
    expect(nextScenario(getPractice())).toBeNull()
  })

  it('merges completions on import, keeping the fewest hints and the earliest date', () => {
    recordCompletion(mana.id, 'mana-guided', { hints: 2 })
    const json = exportAll()
    clearAll()
    recordCompletion(mana.id, 'mana-guided', { hints: 0 })
    recordCompletion(mana.id, 'mana-independent', { hints: 1 })
    importAll(json)
    const record = getPractice().evidence[mana.id].completions
    expect(record['mana-guided'].hints).toBe(0)
    expect(record['mana-independent'].hints).toBe(1)
  })
})
