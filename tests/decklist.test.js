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

// Some pages list a singleton deck as bare names with no quantity column. That
// used to parse to nothing at all, which is a worse answer than a careful guess.
describe('parseDecklist, bare name lists', () => {
  const names = [
    'Sol Ring', 'Arcane Signet', 'Command Tower', 'Swiftfoot Boots',
    'Lightning Greaves', 'Cultivate', "Kodama's Reach", 'Rampant Growth',
    'Counterspell', 'Swords to Plowshares', 'Path to Exile', 'Beast Within',
  ]

  it('reads a list with no quantities as one of each', () => {
    const lines = parseDecklist(names.join('\n'))
    expect(lines).toHaveLength(12)
    expect(lines.every((l) => l.quantity === 1)).toBe(true)
    expect(lines[0]).toEqual({ quantity: 1, name: 'Sol Ring', section: 'main' })
  })

  it('still honours section headers in a bare list', () => {
    const lines = parseDecklist(['Commander', 'Atraxa, Praetors\' Voice', 'Deck', ...names].join('\n'))
    expect(lines[0].section).toBe('commander')
    expect(lines[1].section).toBe('main')
  })

  it('strips printing metadata from bare names too', () => {
    const lines = parseDecklist(names.map((n) => `${n} (CMD)`).join('\n'))
    expect(lines[0].name).toBe('Sol Ring')
  })

  it('never fires when the normal pass found anything', () => {
    // A real list with one quantity line must not gain eleven phantom cards.
    const lines = parseDecklist(['4 Lightning Bolt', ...names].join('\n'))
    expect(lines).toEqual([{ quantity: 4, name: 'Lightning Bolt', section: 'main' }])
  })

  it('ignores a short list, where a guess is more likely to be wrong', () => {
    expect(parseDecklist('Sol Ring\nArcane Signet\nCommand Tower')).toEqual([])
  })

  it('does not swallow prose', () => {
    const prose = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i}.`)
    expect(parseDecklist(prose.join('\n'))).toEqual([])
  })

  it('does not swallow links or long lines', () => {
    const junk = Array.from({ length: 12 }, () => 'https://edhrec.com/precon')
    expect(parseDecklist(junk.join('\n'))).toEqual([])
    expect(parseDecklist(Array.from({ length: 12 }, () => 'x'.repeat(90)).join('\n'))).toEqual([])
  })
})
