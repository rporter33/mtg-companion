import { describe, it, expect } from 'vitest'
import { TUTORIAL } from '../src/data/tutorial.js'
import { TUTORIAL_CARDS } from '../src/data/tutorial-cards.js'
import { GLOSSARY, GLOSSARY_KEYS, GLOSSARY_SECTIONS } from '../src/data/glossary.js'

const cardIds = new Set(Object.keys(TUTORIAL_CARDS))
const cardsIn = (beat) => [
  ...beat.you.hand,
  ...beat.you.board.map((p) => p.id),
  ...beat.you.graveyard,
  ...beat.foe.board.map((p) => p.id),
  ...beat.foe.graveyard,
]

describe('tutorial script', () => {
  it('has unique beat ids', () => {
    const ids = TUTORIAL.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only ever references bundled cards', () => {
    // The tutorial must work with no network, so every card it shows has to be
    // one we ship. A typo here would render an empty frame mid-lesson.
    for (const beat of TUTORIAL) {
      for (const id of cardsIn(beat)) {
        expect(cardIds.has(id), `${beat.id} references unknown card "${id}"`).toBe(true)
      }
    }
  })

  it('always asks the player to click something that is actually there', () => {
    for (const beat of TUTORIAL) {
      if (beat.action.type !== 'click') continue
      const zone = beat.action.zone === 'hand'
        ? beat.you.hand
        : beat.you.board.map((p) => p.id)
      expect(
        zone.includes(beat.action.cardId),
        `${beat.id} asks for "${beat.action.cardId}" in your ${beat.action.zone}, which is not there`,
      ).toBe(true)
    }
  })

  it('resolves every glossary reference', () => {
    for (const beat of TUTORIAL) {
      if (!beat.term) continue
      expect(GLOSSARY[beat.term], `${beat.id} cites unknown term "${beat.term}"`).toBeTruthy()
    }
  })

  it('gives every beat coach text and an action', () => {
    for (const beat of TUTORIAL) {
      expect(beat.coach?.length, `${beat.id} has no coach text`).toBeGreaterThan(20)
      expect(['continue', 'click']).toContain(beat.action.type)
      expect(beat.action.label, `${beat.id} action has no label`).toBeTruthy()
    }
  })

  it('never shows a negative life total, and ends with the opponent at zero', () => {
    for (const beat of TUTORIAL) {
      expect(beat.you.life).toBeGreaterThanOrEqual(0)
      expect(beat.foe.life).toBeGreaterThanOrEqual(0)
    }
    const last = TUTORIAL[TUTORIAL.length - 1]
    expect(last.won).toBe(true)
    expect(last.foe.life).toBe(0)
  })

  it('never lets a life total increase — nothing in this script gains life', () => {
    // A rising life total would mean a scripting slip, since no card here has lifelink.
    let you = TUTORIAL[0].you.life
    let foe = TUTORIAL[0].foe.life
    for (const beat of TUTORIAL) {
      expect(beat.you.life, `${beat.id} raised your life`).toBeLessThanOrEqual(you)
      expect(beat.foe.life, `${beat.id} raised their life`).toBeLessThanOrEqual(foe)
      you = beat.you.life
      foe = beat.foe.life
    }
  })

  it('never shrinks a graveyard — cards do not come back in this script', () => {
    let you = 0
    let foe = 0
    for (const beat of TUTORIAL) {
      expect(beat.you.graveyard.length, `${beat.id} shrank your graveyard`).toBeGreaterThanOrEqual(you)
      expect(beat.foe.graveyard.length, `${beat.id} shrank their graveyard`).toBeGreaterThanOrEqual(foe)
      you = beat.you.graveyard.length
      foe = beat.foe.graveyard.length
    }
  })

  it('never plays more than one land per turn', () => {
    // The tutorial teaches this rule, so it had better not break it.
    const landsByTurn = new Map()
    for (const beat of TUTORIAL) {
      const lands = beat.you.board.filter((p) => p.id === 'forest').length
      const previous = landsByTurn.get(beat.turn) ?? lands
      landsByTurn.set(beat.turn, Math.max(previous, lands))
    }
    const turns = [...landsByTurn.keys()].sort((a, b) => a - b)
    for (let i = 1; i < turns.length; i++) {
      const growth = landsByTurn.get(turns[i]) - landsByTurn.get(turns[i - 1])
      const turnsElapsed = turns[i] - turns[i - 1]
      expect(growth, `lands grew by ${growth} across ${turnsElapsed} turn(s)`).toBeLessThanOrEqual(turnsElapsed)
    }
  })
})

describe('glossary', () => {
  it('resolves every see-also cross reference', () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      for (const related of entry.seeAlso ?? []) {
        expect(GLOSSARY[related], `${key} points at missing term "${related}"`).toBeTruthy()
      }
    }
  })

  it('files every term under exactly one section', () => {
    const filed = GLOSSARY_SECTIONS.flatMap((s) => s.keys)
    expect(new Set(filed).size, 'a term is filed twice').toBe(filed.length)
    for (const key of GLOSSARY_KEYS) {
      expect(filed.includes(key), `"${key}" is not in any section`).toBe(true)
    }
    for (const key of filed) {
      expect(GLOSSARY[key], `section lists unknown term "${key}"`).toBeTruthy()
    }
  })

  it('gives every term a short and a long form', () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.term, `${key} has no display name`).toBeTruthy()
      expect(entry.short.length, `${key} short form too short`).toBeGreaterThan(10)
      expect(entry.long.length, `${key} long form too short`).toBeGreaterThan(40)
    }
  })
})
