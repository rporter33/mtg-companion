import { describe, it, expect } from 'vitest'
import { describeChoice, printingLabel } from '../src/lib/printing-choice.js'

/**
 * What the import review says about each line's printing. Every call is given
 * the day, so the words read the same after the dates in it have passed.
 */

const NOW = '2026-09-21'
const TRK_ISLAND = { name: 'Island', set: 'trk', set_name: 'Star Trek', collector_number: '319', released_at: '2026-11-13' }
const HOB_ISLAND = { name: 'Island', set: 'hob', set_name: 'The Hobbit', collector_number: '195', released_at: '2026-08-14' }

describe('the printing each import line adds', () => {
  it('names the printing, and adds nothing when Scryfall’s pick or the typed one stands', () => {
    for (const how of ['exact', 'set', 'newest']) {
      expect(describeChoice({ card: HOB_ISLAND, how }, NOW)).toEqual({ printing: 'The Hobbit #195', note: null })
    }
  })

  // Scryfall's pick for a name is its own choice, not always its newest
  // printing, so the note calls it the pick and claims nothing more.
  it('says why Scryfall’s pick was passed over, with its set and date', () => {
    const { printing, note } = describeChoice({ card: HOB_ISLAND, how: 'released', newest: TRK_ISLAND }, NOW)
    expect(printing).toBe('The Hobbit #195')
    expect(note).toBe("Scryfall's pick for the name, Star Trek, is not out until 13 Nov 2026, so the app took the newest paper printing that is out.")
    expect(note).not.toMatch(/newest printing,/)
  })

  it('says when the pick was passed over for being digital only', () => {
    const digital = { ...HOB_ISLAND, set_name: 'Alchemy: Somewhere', released_at: '2026-09-01', digital: true }
    expect(describeChoice({ card: HOB_ISLAND, how: 'released', newest: digital }, NOW).note)
      .toBe("Scryfall's pick for the name, Alchemy: Somewhere, is digital only, so the app took the newest paper printing that is out.")
  })

  it('says when no paper printing is out yet, and leaves the date to the chip', () => {
    // The search asks after paper printings only, so a digital one that is
    // out is not denied.
    expect(describeChoice({ card: TRK_ISLAND, how: 'unreleased-only' }, NOW).note)
      .toBe('Scryfall lists no paper printing of it that is out yet.')
    const arenaOnly = { name: 'A-Card', set: 'yneo', set_name: 'Alchemy', collector_number: '1', released_at: '2022-03-17', digital: true }
    expect(describeChoice({ card: arenaOnly, how: 'unreleased-only' }, NOW).note)
      .toBe('Scryfall lists no paper printing of it.')
  })

  it('names the typed printing Scryfall does not have, and what was used', () => {
    expect(describeChoice({ card: HOB_ISLAND, how: 'fallback', byName: 'newest', set: 'zzz', number: '9' }, NOW))
      .toEqual({ printing: '', note: 'Scryfall has no ZZZ 9; the app used The Hobbit #195 instead.' })
    expect(describeChoice({ card: HOB_ISLAND, how: 'fallback', byName: 'newest', set: 'zzz' }, NOW).note)
      .toBe('Scryfall has no ZZZ printing of it; the app used The Hobbit #195 instead.')
    expect(describeChoice({ card: HOB_ISLAND, how: 'fallback', byName: 'released', newest: TRK_ISLAND, set: 'zzz', number: '9' }, NOW).note)
      .toBe("Scryfall has no ZZZ 9; the app used The Hobbit #195 instead. Scryfall's pick for the name, Star Trek, is not out until 13 Nov 2026, so the app took the newest paper printing that is out.")
  })

  it('does not say Scryfall has no printing it was never asked about', () => {
    const unasked = { card: TRK_ISLAND, how: 'fallback', byName: 'newest', unasked: true, set: 'hob', number: '195' }
    const { printing, note } = describeChoice(unasked, NOW)
    expect(printing).toBe('')
    expect(note).toBe('Scryfall could not be asked for HOB 195; the app used Star Trek #319 instead.')
    expect(note).not.toMatch(/has no/)
    expect(describeChoice({ ...unasked, number: undefined }, NOW).note)
      .toBe('Scryfall could not be asked for the HOB printing; the app used Star Trek #319 instead.')
  })

  it('does not claim anything about a pick it could not check', () => {
    expect(describeChoice({ card: TRK_ISLAND, how: 'newest', unchecked: true }, NOW).note)
      .toBe('Scryfall could not be asked for a printing that is out.')
  })

  it('reads a card record an older build cached with fields missing', () => {
    expect(printingLabel({ name: 'Island' })).toBe('')
    expect(printingLabel({ name: 'Island', set: 'hob' })).toBe('HOB')
    expect(printingLabel(null)).toBe('')
    expect(describeChoice({ card: { name: 'Island' }, how: 'fallback', set: 'zzz', number: '9' }, NOW).note)
      .toBe("Scryfall has no ZZZ 9; the app used Scryfall's pick for the name instead.")
    expect(describeChoice({ card: HOB_ISLAND, how: 'released' }, NOW).note).toBeNull()
  })
})
