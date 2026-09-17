import { describe, it, expect } from 'vitest'
import { parseDecklist } from '../src/lib/decklist.js'

// This parser is the front door for every deck anyone imports, and it reads
// text written by half a dozen sites that each format it slightly differently.
// Everything below is a shape one of them actually emits.
describe('parseDecklist', () => {
  it('reads a bare quantity and name', () => {
    expect(parseDecklist('4 Lightning Bolt')).toEqual([
      { quantity: 4, name: 'Lightning Bolt', section: 'main' },
    ])
  })

  it('accepts the 4x spelling', () => {
    expect(parseDecklist('4x Lightning Bolt')[0].name).toBe('Lightning Bolt')
    expect(parseDecklist('4 x Lightning Bolt')[0].quantity).toBe(4)
  })

  it('strips a trailing set code and collector number', () => {
    expect(parseDecklist('4 Lightning Bolt (2X2) 117')[0].name).toBe('Lightning Bolt')
    expect(parseDecklist('1 Sol Ring [CMD]')[0].name).toBe('Sol Ring')
  })

  it('keeps the double slash in a split card name', () => {
    expect(parseDecklist('1 Fire // Ice')[0].name).toBe('Fire // Ice')
  })

  it('does not strip parentheses that are part of the name', () => {
    // "Erase (Not the Urza's Legacy One)" is a real card; the set-code stripper
    // only fires on a trailing group, so an internal one has to survive.
    const line = parseDecklist("1 Erase (Not the Urza's Legacy One) (UNH) 7")[0]
    expect(line.name).toBe("Erase (Not the Urza's Legacy One)")
  })

  it('tracks section headers', () => {
    const lines = parseDecklist([
      'Commander', '1 Atraxa, Praetors\' Voice', '',
      'Deck', '1 Sol Ring', '',
      'Sideboard', '2 Pithing Needle',
    ].join('\n'))
    expect(lines.map((l) => l.section)).toEqual(['commander', 'main', 'sideboard'])
  })

  it('accepts the header spellings different sites use', () => {
    expect(parseDecklist('Mainboard\n1 Sol Ring')[0].section).toBe('main')
    expect(parseDecklist('SB:\n1 Sol Ring')[0].section).toBe('sideboard')
    expect(parseDecklist('Commanders\n1 Sol Ring')[0].section).toBe('commander')
  })

  it('ignores comments, blanks and prose', () => {
    expect(parseDecklist('// notes\n\n# heading\nthis is not a card line')).toEqual([])
  })

  it('strips a UTF-8 byte order mark from a Windows-saved file', () => {
    expect(parseDecklist('\uFEFF1 Sol Ring')[0].name).toBe('Sol Ring')
    expect(parseDecklist('\uFEFFCommander\n1 Sol Ring')[0].section).toBe('commander')
  })

  it('tolerates Windows line endings', () => {
    const lines = parseDecklist('Commander\r\n1 Sol Ring\r\n')
    expect(lines).toEqual([{ quantity: 1, name: 'Sol Ring', section: 'commander' }])
  })

  it('returns nothing for empty input rather than throwing', () => {
    expect(parseDecklist(null)).toEqual([])
    expect(parseDecklist('')).toEqual([])
  })
})
