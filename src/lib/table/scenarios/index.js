/**
 * Every scenario the practice table can run, and the lessons they belong to.
 * A lesson is a sequence of scenarios: guided, then independent, then paper.
 */
import { MANA_SCENARIOS } from './mana.js'
import { COMBAT_SCENARIOS } from './combat.js'
import { RESPONSE_SCENARIOS } from './responses.js'

export const SCENARIOS = Object.fromEntries([...MANA_SCENARIOS, ...COMBAT_SCENARIOS, ...RESPONSE_SCENARIOS].map((s) => [s.id, s]))

export const LESSONS = [
  {
    id: 'mana-first-creature',
    title: 'Lands, mana and a first creature',
    skill: 'Pay for a spell with the right colours',
    minutes: 6,
    scenarios: MANA_SCENARIOS.map((s) => s.id),
  },
  {
    id: 'combat-basics',
    title: 'Attacking, blocking and damage',
    skill: 'Predict a fight before declaring it',
    minutes: 8,
    scenarios: COMBAT_SCENARIOS.map((s) => s.id),
  },
  {
    id: 'responses',
    title: 'Responding, and the stack',
    skill: 'See what the stack will do before you pass',
    minutes: 6,
    scenarios: RESPONSE_SCENARIOS.map((s) => s.id),
  },
]

export const scenarioById = (id) => SCENARIOS[id] ?? null
export const lessonById = (id) => LESSONS.find((l) => l.id === id) ?? null
