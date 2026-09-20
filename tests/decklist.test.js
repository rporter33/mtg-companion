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

  it('reads the Cockatrice and MTGO "SB:" prefix on a single line', () => {
    const lines = parseDecklist('3 Island\nSB: 2 Plains\nsb:1x Forest (m21) 274\n1 Mountain')
    expect(lines.map((l) => [l.name, l.quantity, l.section])).toEqual([
      ['Island', 3, 'main'],
      ['Plains', 2, 'sideboard'],
      ['Forest', 1, 'sideboard'],
      ['Mountain', 1, 'main'],
    ])
    expect(lines[2].set).toBe('m21')
    expect(lines[2].number).toBe('274')
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

// Found by a real seven-deck export: the commander block is followed by a blank
// line and then the rest of the deck, with no "Deck" header anywhere. Without a
// rule for that, all 92 remaining cards land in the command zone.
describe('parseDecklist, an unheaded maindeck', () => {
  it('ends the commander section at the blank line that follows it', () => {
    const lines = parseDecklist([
      'Commander', '1x Jace, Multiverse Architect', '',
      '1x Sol Ring', '1x Command Tower',
    ].join('\n'))
    expect(lines.map((l) => l.section)).toEqual(['commander', 'main', 'main'])
  })

  it('keeps partners together, since no blank line separates them', () => {
    const lines = parseDecklist(['Commander', '1 Thrasios', '1 Tymna', '', '1 Sol Ring'].join('\n'))
    expect(lines.filter((l) => l.section === 'commander')).toHaveLength(2)
  })

  it('still honours an explicit Deck header after the blank line', () => {
    const lines = parseDecklist(['Commander', '1 Atraxa', '', 'Deck', '1 Sol Ring'].join('\n'))
    expect(lines.map((l) => l.section)).toEqual(['commander', 'main'])
  })

  it('does not treat a blank line inside the maindeck as anything', () => {
    const lines = parseDecklist(['Deck', '1 Sol Ring', '', '1 Command Tower'].join('\n'))
    expect(lines.map((l) => l.section)).toEqual(['main', 'main'])
  })

  it('ignores a blank line before the commander is named', () => {
    const lines = parseDecklist(['Commander', '', '1 Atraxa', '', '1 Sol Ring'].join('\n'))
    expect(lines.map((l) => l.section)).toEqual(['commander', 'main'])
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

describe('parseDecklist, site exports', () => {
  it('reads an Archidekt line: printing before the category, both kept', () => {
    // The old stripper only took "(set) 123" at the very end of the line, so
    // every Archidekt name kept its set code and a whole deck missed the bulk
    // lookup. This is the exact line that surfaced it.
    const line = parseDecklist("1x Teshar, Ancestor's Apostle (soc) 180 [Creature]")[0]
    expect(line).toMatchObject({ quantity: 1, name: "Teshar, Ancestor's Apostle", set: 'soc', number: '180', section: 'main' })
    expect(line.category).toBeUndefined()
  })

  it("keeps a category the person made, and drops Archidekt's type defaults", () => {
    expect(parseDecklist('1x Sol Ring (c21) 263 [Ramp]')[0].category).toBe('Ramp')
    expect(parseDecklist('1x Sol Ring (c21) 263 [Artifact]')[0].category).toBeUndefined()
    expect(parseDecklist('1x Sol Ring (c21) 263 [Land]')[0].category).toBeUndefined()
  })

  it('takes the first of several categories', () => {
    expect(parseDecklist('1x Swords to Plowshares (soc) 30 [Removal,Instant]')[0].category).toBe('Removal')
  })

  it('reads the Archidekt commander marker with no Commander header', () => {
    const lines = parseDecklist([
      '1x Esika, God of the Tree // The Prismatic Bridge (khm) 168 [Commander{top}]',
      '1x Sol Ring (c21) 263 [Artifact]',
    ].join('\n'))
    expect(lines[0]).toMatchObject({ name: 'Esika, God of the Tree // The Prismatic Bridge', section: 'commander' })
    expect(lines[0].category).toBeUndefined()
    expect(lines[1].section).toBe('main')
  })

  it('puts a maybeboard card in the sideboard rather than the deck', () => {
    expect(parseDecklist('1x Counterspell (mh2) 267 [Maybeboard{noDeck}]')[0].section).toBe('sideboard')
    expect(parseDecklist('1x Counterspell (mh2) 267 [Sideboard]')[0].section).toBe('sideboard')
  })

  it('reads a Moxfield line with a foil marker', () => {
    expect(parseDecklist('1 Sol Ring (C21) 263 *F*')[0])
      .toMatchObject({ name: 'Sol Ring', set: 'c21', number: '263' })
    expect(parseDecklist('1 Sol Ring (C21) 263 *E*')[0].name).toBe('Sol Ring')
  })

  it('reads an Arena line', () => {
    expect(parseDecklist('4 Lightning Bolt (STA) 42')[0]).toMatchObject({ name: 'Lightning Bolt', set: 'sta', number: '42' })
  })

  it('accepts the collector numbers real sets use', () => {
    expect(parseDecklist('1 Sol Ring (plst) A-123')[0]).toMatchObject({ name: 'Sol Ring', number: 'A-123' })
    expect(parseDecklist('1 Sol Ring (cmm) 12a')[0]).toMatchObject({ name: 'Sol Ring', number: '12a' })
    expect(parseDecklist('1 Sol Ring (cmm) 12★')[0]).toMatchObject({ name: 'Sol Ring', number: '12★' })
  })

  it('still reads a bracketed set code as a set', () => {
    expect(parseDecklist('1 Sol Ring [CMD]')[0]).toMatchObject({ name: 'Sol Ring', set: 'cmd' })
  })

  it('leaves parentheses that are part of a name alone, with no printing after them', () => {
    expect(parseDecklist("1 Erase (Not the Urza's Legacy One)")[0].name).toBe("Erase (Not the Urza's Legacy One)")
    expect(parseDecklist('1 B.F.M. (Big Furry Monster)')[0].name).toBe('B.F.M. (Big Furry Monster)')
  })

  it('carries printing and category on bare names too', () => {
    const lines = parseDecklist(Array.from({ length: 10 }, (_, i) => `Card ${i} (soc) ${i} [Ramp]`).join('\n'))
    expect(lines).toHaveLength(10)
    expect(lines[3]).toMatchObject({ name: 'Card 3', set: 'soc', number: '3', category: 'Ramp' })
  })

  it('never invents printing fields on a plain line', () => {
    const line = parseDecklist('4 Lightning Bolt')[0]
    expect('set' in line).toBe(false)
    expect('number' in line).toBe(false)
    expect('category' in line).toBe(false)
  })
})
