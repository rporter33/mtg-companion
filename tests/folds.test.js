import { describe, it, expect } from 'vitest'
import { openSectionFor, withOpenSection, openAfterRename, resolveOpen, toggledOpen } from '../src/lib/folds.js'

describe('openSectionFor', () => {
  it('reads the remembered section, and null for none or a blank', () => {
    expect(openSectionFor({ deckOpen: { d1: 'Lands' } }, 'd1')).toBe('Lands')
    expect(openSectionFor({ deckOpen: { d1: 'Lands' } }, 'd2')).toBeNull()
    expect(openSectionFor({ deckOpen: { d1: '' } }, 'd1')).toBeNull()
    expect(openSectionFor({}, 'd1')).toBeNull()
    expect(openSectionFor(undefined, 'd1')).toBeNull()
  })
})

describe('withOpenSection', () => {
  it('sets a deck without touching the others', () => {
    const prefs = { deckOpen: { d2: 'Instants' } }
    expect(withOpenSection(prefs, 'd1', 'Lands')).toEqual({ d1: 'Lands', d2: 'Instants' })
    expect(prefs.deckOpen).toEqual({ d2: 'Instants' })
  })
  it('removes the key when everything is open, so the map cannot grow with taps', () => {
    expect(withOpenSection({ deckOpen: { d1: 'Lands', d2: 'Instants' } }, 'd1', null)).toEqual({ d2: 'Instants' })
    expect(withOpenSection({}, 'd1', null)).toEqual({})
  })
})

describe('openAfterRename', () => {
  it('follows a rename of the open section', () => {
    expect(openAfterRename({ deckOpen: { d1: 'Instants' } }, 'd1', 'Instants', 'Interaction')).toEqual({ d1: 'Interaction' })
  })
  it('leaves another section alone', () => {
    expect(openAfterRename({ deckOpen: { d1: 'Lands' } }, 'd1', 'Instants', 'Interaction')).toEqual({ d1: 'Lands' })
    expect(openAfterRename({}, 'd1', 'Instants', 'Interaction')).toEqual({})
  })
})

describe('resolveOpen', () => {
  it('opens the remembered section only while it exists', () => {
    expect(resolveOpen('Lands', ['Creatures', 'Lands'])).toBe('Lands')
    expect(resolveOpen('Lands', ['Creatures'])).toBeNull()
    expect(resolveOpen(null, ['Creatures'])).toBeNull()
  })
})

describe('toggledOpen', () => {
  it('opens a section, and a second tap reopens everything', () => {
    expect(toggledOpen(null, 'Lands')).toBe('Lands')
    expect(toggledOpen('Lands', 'Creatures')).toBe('Creatures')
    expect(toggledOpen('Lands', 'Lands')).toBeNull()
  })
})
