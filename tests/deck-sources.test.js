import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  looksLikeUrl, identifySource, planForUrl, fetchFromSource,
  parseArchidekt, parseMoxfield, toDecklistText, SOURCES,
} from '../src/lib/deck-sources.js'
import { toExampleEntry, exampleToDecklist, exampleSize } from '../src/data/example-decks.js'

afterEach(() => vi.unstubAllGlobals())

describe('looksLikeUrl', () => {
  it('recognises a single-line http address', () => {
    expect(looksLikeUrl('https://moxfield.com/decks/abc')).toBe(true)
  })

  it('does not mistake a decklist for a URL', () => {
    expect(looksLikeUrl('4 Lightning Bolt')).toBe(false)
    expect(looksLikeUrl('https://x.com/a\n4 Bolt')).toBe(false)
  })
})

describe('identifySource', () => {
  it('recognises the sites people actually use', () => {
    expect(identifySource('https://moxfield.com/decks/JAJNhQ').source.id).toBe('moxfield')
    expect(identifySource('https://www.archidekt.com/decks/123456').source.id).toBe('archidekt')
    expect(identifySource('https://deckstats.net/decks/1/x').source.id).toBe('deckstats')
    expect(identifySource('https://tappedout.net/mtg-decks/thing/').source.id).toBe('tappedout')
  })

  it('pulls the deck id out', () => {
    expect(identifySource('https://moxfield.com/decks/JAJNhQHxg0qfdq4ULGcj5g').id)
      .toBe('JAJNhQHxg0qfdq4ULGcj5g')
    expect(identifySource('https://archidekt.com/decks/987654').id).toBe('987654')
  })

  it('returns null for anything else', () => {
    expect(identifySource('https://example.com/deck')).toBeNull()
  })
})

describe('planForUrl', () => {
  it('never plans to fetch a source that does not permit it', () => {
    // This is the whole point: no user-agent spoofing, no scraping proxy.
    // A site that has not opened its API to browsers is simply not fetched.
    for (const source of SOURCES.filter((s) => s.browserReadable === false)) {
      const plan = planForUrl(`https://${source.id === 'mtggoldfish' ? 'mtggoldfish.com/deck/1' : ''}`)
      if (plan) expect(plan.kind).not.toBe('fetch')
    }
    expect(planForUrl('https://moxfield.com/decks/abc').kind).toBe('manual')
  })

  it('tells you exactly which button to press instead', () => {
    const plan = planForUrl('https://moxfield.com/decks/abc')
    expect(plan.hint).toMatch(/Export/)
    expect(plan.message).toMatch(/does not let other sites read decks/)
  })

  it('will attempt a source that publishes an API', () => {
    const plan = planForUrl('https://archidekt.com/decks/123')
    expect(plan.kind).toBe('fetch')
    expect(plan.id).toBe('123')
  })

  it('is helpful about an unrecognised link rather than silent', () => {
    const plan = planForUrl('https://example.com/my-deck')
    expect(plan.kind).toBe('unknown')
    expect(plan.hint).toMatch(/Export or Download/)
  })

  it('returns null for something that is not a link at all', () => {
    expect(planForUrl('4 Lightning Bolt')).toBeNull()
  })
})

describe('fetchFromSource', () => {
  const archidekt = SOURCES.find((s) => s.id === 'archidekt')

  it('parses a deck into sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        name: 'Test Deck',
        cards: [
          { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Atraxa' } } },
          { quantity: 4, categories: [], card: { oracleCard: { name: 'Lightning Bolt' } } },
          { quantity: 2, categories: ['Sideboard'], card: { oracleCard: { name: 'Duress' } } },
        ],
      }),
    }))
    const deck = await fetchFromSource({ source: archidekt, id: '1' })
    expect(deck.name).toBe('Test Deck')
    expect(deck.commanders).toEqual([{ name: 'Atraxa', quantity: 1 }])
    expect(deck.main).toEqual([{ name: 'Lightning Bolt', quantity: 4 }])
    expect(deck.sideboard).toEqual([{ name: 'Duress', quantity: 2 }])
  })

  it('explains a CORS refusal without pretending to know it was CORS', async () => {
    // A blocked cross-origin request and being offline are indistinguishable
    // from script, so the message covers both and points at the export route.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchFromSource({ source: archidekt, id: '1' }))
      .rejects.toMatchObject({ code: 'blocked' })
  })

  it('distinguishes a missing deck from a broken one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(fetchFromSource({ source: archidekt, id: '1' }))
      .rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses to fetch a source with no API', async () => {
    const moxfield = SOURCES.find((s) => s.id === 'moxfield')
    await expect(fetchFromSource({ source: moxfield, id: 'x' })).rejects.toThrow(/cannot be read/)
  })
})

describe('parseArchidekt', () => {
  it('survives a malformed payload', () => {
    expect(parseArchidekt({}).main).toEqual([])
    expect(parseArchidekt(null).commanders).toEqual([])
  })

  it('skips entries with no card name', () => {
    expect(parseArchidekt({ cards: [{ quantity: 1, card: {} }] }).main).toEqual([])
  })

  it('treats a maybeboard as a sideboard rather than dropping it', () => {
    const deck = parseArchidekt({
      cards: [{ quantity: 1, categories: ['Maybeboard'], card: { name: 'Thing' } }],
    })
    expect(deck.sideboard).toHaveLength(1)
  })
})

describe('round trip through decklist text', () => {
  it('renders a parsed deck into the text the importer already reads', () => {
    const text = toDecklistText({
      commanders: [{ name: 'Atraxa', quantity: 1 }],
      main: [{ name: 'Forest', quantity: 30 }],
      sideboard: [{ name: 'Duress', quantity: 2 }],
    })
    expect(text).toContain('Commander\n1 Atraxa')
    expect(text).toContain('30 Forest')
    expect(text).toContain('Sideboard\n2 Duress')
  })
})

describe('example decks', () => {
  const lookup = (id) => ({
    cmdr: { id: 'cmdr', name: 'Test Commander' },
    a: { id: 'a', name: 'Zebra Card' },
    b: { id: 'b', name: 'Apple Card' },
  }[id])

  const deck = {
    id: 'd1', name: 'My Deck', formatId: 'commander',
    commanders: ['cmdr'], signatureSpell: null,
    main: [{ cardId: 'a', quantity: 1 }, { cardId: 'b', quantity: 2 }],
    sideboard: [],
  }

  it('stores names rather than printing ids', () => {
    // A printing id pins an example to one art from one set and breaks when
    // that printing is not cached. A name resolves against any printing.
    const entry = toExampleEntry(deck, lookup)
    expect(entry.commanders).toEqual(['Test Commander'])
    expect(entry.main.every((c) => typeof c.name === 'string')).toBe(true)
    expect(JSON.stringify(entry)).not.toContain('"cardId"')
  })

  it('sorts so an unchanged deck re-exports identically', () => {
    const entry = toExampleEntry(deck, lookup)
    expect(entry.main.map((c) => c.name)).toEqual(['Apple Card', 'Zebra Card'])
    expect(JSON.stringify(toExampleEntry(deck, lookup).main))
      .toBe(JSON.stringify(entry.main))
  })

  it('drops cards that have not loaded rather than writing nulls', () => {
    const withGhost = { ...deck, main: [...deck.main, { cardId: 'missing', quantity: 1 }] }
    expect(toExampleEntry(withGhost, lookup).main).toHaveLength(2)
  })

  it('records who chose it and when', () => {
    const entry = toExampleEntry(deck, lookup, { credit: 'Robert', note: 'Good starter' })
    expect(entry.credit).toBe('Robert')
    expect(entry.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('converts back into importable text', () => {
    const text = exampleToDecklist(toExampleEntry(deck, lookup))
    expect(text).toContain('1 Test Commander')
    expect(text).toContain('2 Apple Card')
  })

  it('counts the commander toward the size', () => {
    expect(exampleSize(toExampleEntry(deck, lookup))).toBe(4)
  })
})

describe('parseMoxfield', () => {
  // Both shapes are inferred from payloads in the wild, not from documentation,
  // which is exactly why the parser walks instead of asserting a path.
  const v3 = {
    name: 'Fracture Tempo',
    boards: {
      commanders: { cards: { a1: { quantity: 1, card: { name: 'Kenrith, the Returned King' } } } },
      mainboard: {
        cards: {
          b1: { quantity: 1, card: { name: 'Sol Ring' } },
          b2: { quantity: 8, card: { name: 'Island' } },
        },
      },
      sideboard: { cards: {} },
    },
  }

  const v2 = {
    name: 'Fracture Tempo',
    commanders: { 'Kenrith, the Returned King': { quantity: 1, card: { name: 'Kenrith, the Returned King' } } },
    mainboard: {
      'Sol Ring': { quantity: 1, card: { name: 'Sol Ring' } },
      Island: { quantity: 8, card: { name: 'Island' } },
    },
    sideboard: {},
  }

  it('reads the nested board shape', () => {
    const deck = parseMoxfield(v3)
    expect(deck.name).toBe('Fracture Tempo')
    expect(deck.commanders).toEqual([{ name: 'Kenrith, the Returned King', quantity: 1 }])
    expect(deck.main).toContainEqual({ name: 'Island', quantity: 8 })
    expect(deck.sideboard).toEqual([])
  })

  it('reads the flat board shape identically', () => {
    expect(parseMoxfield(v2)).toEqual(parseMoxfield(v3))
  })

  it('forces the commander to a single copy', () => {
    const doubled = structuredClone(v3)
    doubled.boards.commanders.cards.a1.quantity = 4
    expect(parseMoxfield(doubled).commanders[0].quantity).toBe(1)
  })

  it('survives a payload with nothing it recognises', () => {
    expect(parseMoxfield({})).toEqual({
      name: 'Imported deck', commanders: [], main: [], sideboard: [],
    })
    expect(parseMoxfield(null).main).toEqual([])
  })

  it('skips entries with no card name rather than emitting a null', () => {
    const broken = structuredClone(v3)
    broken.boards.mainboard.cards.b3 = { quantity: 2 }
    expect(parseMoxfield(broken).main).toHaveLength(2)
  })
})

describe('EDHREC', () => {
  it('recognises a precon link', () => {
    const plan = planForUrl('https://edhrec.com/precon/some-deck')
    expect(plan.kind).toBe('manual')
    expect(plan.source.id).toBe('edhrec')
  })

  it('is never fetched, because nobody has checked whether it would allow it', () => {
    const edhrec = SOURCES.find((s) => s.id === 'edhrec')
    expect(edhrec.browserReadable).toBe(false)
    expect(edhrec.api).toBeUndefined()
  })
})
