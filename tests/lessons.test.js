import { describe, it, expect } from 'vitest'
import { TRACKS, LESSONS, LESSON_IDS } from '../src/data/lessons.js'
import { GLOSSARY } from '../src/data/glossary.js'

/**
 * The written lessons had no tests before the learning review: a lesson
 * without a question crashed the screen, and a track could point at a lesson
 * that did not exist. These hold the shape the guide renders from.
 */
describe('lessons', () => {
  it('key and id agree, and every lesson has body text', () => {
    for (const [key, lesson] of Object.entries(LESSONS)) {
      expect(lesson.id).toBe(key)
      expect(lesson.title).toBeTruthy()
      expect(lesson.minutes).toBeGreaterThan(0)
      expect(lesson.body.length).toBeGreaterThan(0)
      for (const paragraph of lesson.body) expect(paragraph.length).toBeGreaterThan(40)
    }
  })

  it('every lesson ends in a question with exactly one right answer and a reason for each option', () => {
    for (const lesson of Object.values(LESSONS)) {
      expect(lesson.quiz?.question, `${lesson.id} has no question`).toBeTruthy()
      expect(lesson.quiz.options.length, `${lesson.id} needs at least two options`).toBeGreaterThanOrEqual(2)
      expect(lesson.quiz.options.filter((o) => o.correct).length, `${lesson.id} must have one right answer`).toBe(1)
      for (const option of lesson.quiz.options) {
        expect(option.text, `${lesson.id} has an option with no text`).toBeTruthy()
        expect(option.why?.length, `${lesson.id}: "${option.text}" has no explanation`).toBeGreaterThan(20)
      }
    }
  })

  it('every term a lesson cites is in the glossary', () => {
    for (const lesson of Object.values(LESSONS)) {
      for (const term of lesson.terms ?? []) {
        expect(GLOSSARY[term], `${lesson.id} cites unknown term "${term}"`).toBeTruthy()
      }
    }
  })

  it('only names interactive hooks the screen knows', () => {
    for (const lesson of Object.values(LESSONS)) {
      if (lesson.interactive) expect(['firstDeck']).toContain(lesson.interactive)
    }
  })

  it('keeps the words that trip beginners apart', () => {
    const all = Object.values(LESSONS).flatMap((l) => [...l.body, l.quiz.question, ...l.quiz.options.flatMap((o) => [o.text, o.why])]).join('\n')
    // Generic and colourless are different things, and the casting lesson says so.
    expect(LESSONS.castingSpells.body.join(' ')).toMatch(/colourless is not generic/i)
    // No quiz calls a generic cost "colourless".
    expect(all).not.toMatch(/mana cost is colourless/i)
    // The Commander ban list is not attributed to a body that no longer keeps it.
    expect(all).not.toMatch(/separate group/i)
  })
})

describe('tracks', () => {
  it('point only at lessons that exist, with no repeats inside a track', () => {
    for (const track of TRACKS) {
      expect(track.id && track.name && track.blurb).toBeTruthy()
      expect(new Set(track.lessons).size).toBe(track.lessons.length)
      for (const id of track.lessons) expect(LESSONS[id], `${track.id} lists unknown lesson "${id}"`).toBeTruthy()
    }
  })

  it('reach every lesson from at least one track', () => {
    const reachable = new Set(TRACKS.flatMap((t) => t.lessons))
    for (const id of LESSON_IDS) expect(reachable.has(id), `${id} is in no track`).toBe(true)
  })

  it('have distinct ids', () => {
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length)
  })
})
