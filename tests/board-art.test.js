import { describe, it, expect } from 'vitest'
import { treatmentOf, treatmentName, describePrinting, orderPrintings, finishFor, FINISHES } from '../src/lib/board/art.js'

/**
 * Every answer here comes out of Scryfall's own fields rather than a list of
 * set codes someone has to keep up to date, which is the whole point: a set
 * printed next year gets its showcase frame recognised without a release.
 */

const print = (id, extra = {}) => ({
  id, oracle_id: 'o-1', name: 'Sol Ring', set: 'tst', set_name: 'Test Set',
  collector_number: '1', finishes: ['nonfoil', 'foil'], border_color: 'black',
  image_uris: { art_crop: `https://example.test/${id}.jpg` },
  ...extra,
})

describe('what a printing is', () => {
  it('reads a showcase, a borderless and an extended-art frame', () => {
    expect(treatmentName(print('a', { frame_effects: ['showcase'] }))).toBe('showcase')
    expect(treatmentName(print('b', { border_color: 'borderless' }))).toBe('borderless')
    expect(treatmentName(print('c', { frame_effects: ['extendedart'] }))).toBe('extended art')
    expect(treatmentName(print('d', { full_art: true }))).toBe('full art')
    expect(treatmentName(print('e'))).toBe(null)
  })

  it('knows which finishes a copy can exist in', () => {
    expect(treatmentOf(print('a')).foilable).toBe(true)
    expect(treatmentOf(print('b', { finishes: ['nonfoil'] })).foilable).toBe(false)
    expect(treatmentOf(print('c', { finishes: ['foil'] })).foilOnly).toBe(true)
    expect(treatmentOf(print('d', { finishes: ['etched'] })).etchable).toBe(true)
    // A card with nothing said about it is an ordinary copy, not a crash.
    expect(treatmentOf(null).finishes).toEqual(['nonfoil'])
  })

  it('says where a printing is from in one line', () => {
    expect(describePrinting(print('a', { frame_effects: ['showcase'] })))
      .toBe('Test Set · #1 · showcase · foil available')
    expect(describePrinting(print('b', { finishes: ['foil'] })))
      .toBe('Test Set · #1 · foil only')
    expect(describePrinting(null)).toBe('')
  })

  it('offers the copy in the deck first, then ones with a painting', () => {
    const list = [
      print('old'),
      print('no-art', { image_uris: undefined }),
      print('digital', { digital: true }),
      print('current'),
    ]
    expect(orderPrintings(list, 'current').map((c) => c.id)).toEqual(['current', 'old', 'digital', 'no-art'])
  })

  it('drops a printing listed twice, and copes with nothing at all', () => {
    const twice = [print('a'), print('a'), print('b')]
    expect(orderPrintings(twice).map((c) => c.id)).toEqual(['a', 'b'])
    expect(orderPrintings(null)).toEqual([])
  })

  it('will not give a card a sheen it cannot have', () => {
    expect(finishFor(print('a'), 'foil')).toBe('foil')
    expect(finishFor(print('b', { finishes: ['nonfoil'] }), 'foil')).toBe('normal')
    expect(finishFor(print('c', { finishes: ['etched'] }), 'etched')).toBe('etched')
    // A printing that only exists in foil is a foil copy whatever was asked.
    expect(finishFor(print('d', { finishes: ['foil'] }), 'normal')).toBe('foil')
  })

  it('knows only the three finishes a card is actually sold in', () => {
    expect(FINISHES).toEqual(['normal', 'foil', 'etched'])
  })
})
