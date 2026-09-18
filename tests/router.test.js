import { describe, it, expect } from 'vitest'
import { parseRoute, buildHash, withPatch } from '../src/lib/router.js'

describe('parseRoute', () => {
  it('reads each screen', () => {
    expect(parseRoute('#/guide').tab).toBe('guide')
    expect(parseRoute('#/play').tab).toBe('play')
    expect(parseRoute('#/decks')).toMatchObject({ tab: 'decks', deckId: null, data: false })
    expect(parseRoute('#/decks/data')).toMatchObject({ tab: 'decks', data: true, deckId: null })
    expect(parseRoute('#/decks/new')).toMatchObject({ tab: 'decks', starting: true, deckId: null, step: null })
    expect(parseRoute('#/decks/new/list')).toMatchObject({ starting: true, step: 'list' })
    expect(parseRoute('#/decks/new/elsewhere')).toMatchObject({ starting: true, step: null })
    expect(parseRoute('#/decks/abc')).toMatchObject({ tab: 'decks', deckId: 'abc', deckTab: null })
    expect(parseRoute('#/decks/abc/analysis')).toMatchObject({ deckId: 'abc', deckTab: 'analysis' })
    expect(parseRoute('#/cards?q=t%3Ainstant')).toMatchObject({ tab: 'cards', q: 't:instant' })
  })
  it('reads each place inside Learn', () => {
    expect(parseRoute('#/guide')).toMatchObject({ tab: 'guide', guide: null, trackId: null, lessonId: null })
    expect(parseRoute('#/guide/game')).toMatchObject({ guide: 'game' })
    expect(parseRoute('#/guide/glossary')).toMatchObject({ guide: 'glossary' })
    expect(parseRoute('#/guide/track/beginner')).toMatchObject({ guide: 'track', trackId: 'beginner', lessonId: null })
    expect(parseRoute('#/guide/track/beginner/goal')).toMatchObject({ guide: 'lesson', trackId: 'beginner', lessonId: 'goal' })
    expect(parseRoute('#/guide/lesson/goal')).toMatchObject({ guide: 'lesson', trackId: null, lessonId: 'goal' })
    // A place with no id is just Learn.
    expect(parseRoute('#/guide/track')).toMatchObject({ guide: null })
    expect(parseRoute('#/guide/lesson')).toMatchObject({ guide: null })
    expect(parseRoute('#/guide/elsewhere')).toMatchObject({ tab: 'guide', guide: null })
  })
  it('carries the card overlay on any screen', () => {
    expect(parseRoute('#/decks/abc?card=xyz')).toMatchObject({ deckId: 'abc', cardId: 'xyz' })
    expect(parseRoute('#/guide?card=xyz')).toMatchObject({ tab: 'guide', cardId: 'xyz' })
  })
  it('treats anything unknown as no route rather than throwing', () => {
    expect(parseRoute('').tab).toBeNull()
    expect(parseRoute('#').tab).toBeNull()
    expect(parseRoute('#/nope/what').tab).toBeNull()
    expect(parseRoute('#/decks/abc/notatab').deckTab).toBeNull()
    expect(parseRoute(undefined).tab).toBeNull()
  })
  it('decodes a deck id with awkward characters', () => {
    expect(parseRoute('#/decks/a%20b%2Fc').deckId).toBe('a b/c')
    expect(parseRoute('#/decks/%E0%A4%A').deckId).toBe('%E0%A4%A')
  })
})

describe('buildHash', () => {
  it('round-trips every shape', () => {
    for (const hash of [
      '#/guide', '#/play', '#/decks', '#/decks/data', '#/decks/new', '#/decks/new/commander', '#/decks/abc', '#/decks/abc/analysis',
      '#/cards?q=t%3Ainstant', '#/decks/abc/io?card=xyz', '#/guide?card=xyz', '#/decks/a%20b%2Fc',
      '#/guide/game', '#/guide/glossary', '#/guide/track/beginner', '#/guide/track/beginner/goal', '#/guide/lesson/goal?card=xyz',
    ]) expect(buildHash(parseRoute(hash))).toBe(hash)
  })
  it('canonicalises: the list tab is the default and is not written', () => {
    expect(buildHash({ tab: 'decks', deckId: 'abc', deckTab: 'list' })).toBe('#/decks/abc')
    // Every step is written, colours included: the bare address means "resume".
    expect(buildHash({ tab: 'decks', starting: true, step: 'colours' })).toBe('#/decks/new/colours')
    expect(buildHash({ tab: 'decks', starting: true })).toBe('#/decks/new')
  })
  it('falls back to the guide for a missing tab', () => {
    expect(buildHash({})).toBe('#/guide')
    expect(buildHash({ tab: 'bogus' })).toBe('#/guide')
  })
  it('ignores a search on a screen that has none', () => {
    expect(buildHash({ tab: 'decks', q: 'bolt' })).toBe('#/decks')
  })
})

describe('withPatch', () => {
  const inDeck = parseRoute('#/decks/abc/analysis?card=xyz')
  it('changes a tab inside the same screen', () => {
    expect(buildHash(withPatch(inDeck, { deckTab: 'coach' }))).toBe('#/decks/abc/coach?card=xyz')
  })
  it('clears a key set to null', () => {
    expect(buildHash(withPatch(inDeck, { cardId: null }))).toBe('#/decks/abc/analysis')
    expect(buildHash(withPatch(inDeck, { deckId: null, deckTab: null }))).toBe('#/decks?card=xyz')
  })
  it('switching screens drops the old screen\'s state but keeps the card overlay', () => {
    expect(buildHash(withPatch(inDeck, { tab: 'cards' }))).toBe('#/cards?card=xyz')
    expect(buildHash(withPatch(inDeck, { tab: 'cards', q: 'bolt' }))).toBe('#/cards?q=bolt&card=xyz')
  })
  it('staying on the same screen keeps its state', () => {
    expect(buildHash(withPatch(inDeck, { tab: 'decks' }))).toBe('#/decks/abc/analysis?card=xyz')
  })
  it('moves between places in Learn and leaves them on a tab switch', () => {
    const inLesson = parseRoute('#/guide/track/beginner/goal')
    expect(buildHash(withPatch(inLesson, { guide: 'track', lessonId: null }))).toBe('#/guide/track/beginner')
    expect(buildHash(withPatch(inLesson, { guide: null, trackId: null, lessonId: null }))).toBe('#/guide')
    expect(buildHash(withPatch(inLesson, { tab: 'cards' }))).toBe('#/cards')
  })
})
