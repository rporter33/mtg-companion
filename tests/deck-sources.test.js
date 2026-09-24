import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  looksLikeUrl, identifySource, planForUrl, fetchFromSource,
  parseArchidekt, parseMoxfield, toDecklistText, SOURCES,
} from '../src/lib/deck-sources.js'
import { toExampleEntry, exampleToDecklist, exampleSize } from '../src/data/example-decks.js'
import { parseDecklist, deckToText } from '../src/lib/decklist.js'
import { resolvePrintings } from '../src/lib/scryfall.js'
import { clearCache } from '../src/lib/cache.js'
import { createDeck, addCard, setCommanders } from '../src/lib/deck.js'
import ARCHIDEKT from './fixtures/archidekt-decks.json'

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

/**
 * Two public decks as Archidekt's API sent them on 2026-09-24, trimmed
 * (tests/fixtures/archidekt-decks.json). "Precon" marks its commander;
 * "Cloud Precon" has The List's "C14-249" and a promo's "116p" among its
 * numbers. Every card in Archidekt's answer names its printing, and a fetched
 * deck used to keep only the names, so the name rule picked every card again.
 */
describe('a deck fetched from Archidekt keeps its printings', () => {
  const archidekt = SOURCES.find((s) => s.id === 'archidekt')
  const precon = ARCHIDEKT.decks['5088559']
  const cloud = ARCHIDEKT.decks['13109808']
  const NOW = '2026-09-24'

  // Each card as Archidekt named it, read straight from the fixture's fields.
  const named = (payload) => payload.cards.map(({ quantity, card }) => ({
    name: card.oracleCard.name, quantity, set: card.edition.editioncode, number: card.collectorNumber,
  }))
  const solRing = precon.cards.find((entry) => entry.card.oracleCard.name === 'Sol Ring')
  // The captured Sol Ring with some of its card's fields replaced.
  const solRingWith = (fields) => ({ ...solRing, card: { ...solRing.card, ...fields } })

  it('reads the set and collector number each card carries', () => {
    const deck = parseArchidekt(precon)
    expect(deck.name).toBe('Precon')
    expect(deck.commanders).toEqual([{ name: 'Rukarumel, Biologist', quantity: 1, set: 'cmm', number: '711' }])
    expect(deck.main).toContainEqual({ name: 'Plains', quantity: 2, set: 'cmm', number: '787' })
    expect(parseArchidekt(cloud).main).toEqual(expect.arrayContaining([
      { name: 'Mask of Memory', quantity: 1, set: 'plst', number: 'C14-249' },
      { name: 'Professional Face-Breaker', quantity: 1, set: 'psnc', number: '116p' },
      { name: 'Mountain', quantity: 3, set: 'm20', number: '276' },
    ]))
  })

  it('writes each printing into the decklist text, which reads back to the same printing', () => {
    for (const payload of [precon, cloud]) {
      const text = toDecklistText(parseArchidekt(payload))
      const lines = parseDecklist(text).map(({ name, quantity, set, number }) => ({ name, quantity, set, number }))
      expect(lines).toHaveLength(payload.cards.length)
      expect(lines).toEqual(expect.arrayContaining(named(payload)))
    }
    const text = toDecklistText(parseArchidekt(precon))
    expect(text).toMatch(/^Commander\n1 Rukarumel, Biologist \(CMM\) 711\n\nDeck\n/)
    expect(toDecklistText(parseArchidekt(cloud))).toContain('1 Mask of Memory (PLST) C14-249\n1 Professional Face-Breaker (PSNC) 116p')
  })

  it('fetches a deck whose cards keep their printings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => precon }))
    const deck = await fetchFromSource({ source: archidekt, id: '5088559' })
    expect(fetch).toHaveBeenCalledWith('https://archidekt.com/api/decks/5088559/', expect.anything())
    expect(deck.commanders[0]).toEqual({ name: 'Rukarumel, Biologist', quantity: 1, set: 'cmm', number: '711' })
    expect(deck.main.every((entry) => entry.set === 'cmm' && entry.number)).toBe(true)
  })

  it('keeps what it can make sense of and goes by the name for the rest', () => {
    const deck = parseArchidekt({ cards: [
      solRingWith({ edition: undefined }),
      solRingWith({ edition: { editioncode: { code: 'cmm' } } }),
      solRingWith({ edition: null }),
      solRingWith({ collectorNumber: null }),
      solRingWith({ collectorNumber: '' }),
      solRingWith({ collectorNumber: 410 }),
      solRingWith({ edition: { editioncode: ' CMM ' } }),
    ] })
    const sol = { name: 'Sol Ring', quantity: 1 }
    expect(deck.main).toEqual([
      // No set: a number means nothing on its own, so the name goes alone.
      sol, sol, sol,
      { ...sol, set: 'cmm' },
      { ...sol, set: 'cmm' },
      { ...sol, set: 'cmm', number: '410' },
      { ...sol, set: 'cmm', number: '410' },
    ])
    // A code the decklist cannot carry is left off the line there.
    expect(toDecklistText({ main: [{ ...sol, set: 'not a set', number: '410' }] })).toBe('Deck\n1 Sol Ring')
  })

  describe('through the import', () => {
    beforeEach(async () => {
      await clearCache()
      vi.stubGlobal('navigator', { onLine: true })
    })

    /**
     * A stand-in for Scryfall's collection endpoint that knows the fixture's
     * printings, each written in Scryfall's shape from Archidekt's own fields.
     * Anything else it is asked for, it has no card for, and any other
     * request is noted among the identifiers and answered as Scryfall answers
     * a name it has no card for, so a name looked up one at a time shows in
     * `asked` rather than as a timeout.
     */
    function scryfall(...payloads) {
      const known = payloads.flatMap((payload) => payload.cards).map(({ card }) => ({
        object: 'card', id: `${card.edition.editioncode}-${card.collectorNumber}`,
        name: card.oracleCard.name, set: card.edition.editioncode, set_name: card.edition.editionname,
        collector_number: card.collectorNumber, released_at: card.releasedAt,
        digital: false, games: ['paper'], lang: 'en',
      }))
      const asked = []
      vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        if (new URL(url).pathname !== '/cards/collection') {
          asked.push({ url: String(url) })
          return { ok: false, status: 404, json: async () => ({ object: 'error', status: 404, code: 'not_found' }) }
        }
        const { identifiers } = JSON.parse(options.body)
        asked.push(...identifiers)
        const data = []
        const notFound = []
        for (const id of identifiers) {
          const card = known.find((c) => c.set === id.set
            && (id.collector_number ? c.collector_number === id.collector_number : c.name === id.name))
          if (card) data.push(card)
          else notFound.push(id)
        }
        return { ok: true, status: 200, json: async () => ({ object: 'list', data, not_found: notFound }) }
      }))
      return asked
    }

    /** Applies resolved lines as the import does: commanders to the command zone, the rest to the deck. */
    const applied = (results) => {
      let deck = createDeck({ name: 'Fetched', formatId: 'commander' })
      for (const { line, card } of results) {
        deck = line.section === 'commander'
          ? setCommanders(deck, [...deck.commanders, card.id])
          : addCard(deck, card.id, line.quantity, line.section === 'sideboard' ? 'sideboard' : 'main')
      }
      const byId = new Map(results.map(({ card }) => [card.id, card]))
      return deckToText(deck, (id) => byId.get(id))
    }

    it('lands on the printings the list named, and exports them as it found them', async () => {
      const asked = scryfall(precon)
      const results = await resolvePrintings(parseDecklist(toDecklistText(parseArchidekt(precon))), { now: NOW })
      // Asked for by printing, every one of them, and none by name.
      expect(asked).toEqual(named(precon).map(({ set, number }) => ({ set, collector_number: number })))
      expect(results.map(({ how }) => how)).toEqual(precon.cards.map(() => 'exact'))
      expect(applied(results)).toBe([
        'Commander',
        '1 Rukarumel, Biologist (CMM) 711',
        '',
        'Deck',
        '1 Sliver Gravemother (CMM) 707',
        '1 Sol Ring (CMM) 410',
        '2 Plains (CMM) 787',
        '1 Farseek (CMM) 894',
      ].join('\n'))
    })

    it('keeps The List and promo numbers as they are', async () => {
      const asked = scryfall(cloud)
      const results = await resolvePrintings(parseDecklist(toDecklistText(parseArchidekt(cloud))), { now: NOW })
      expect(asked).toEqual(named(cloud).map(({ set, number }) => ({ set, collector_number: number })))
      expect(results.every(({ how }) => how === 'exact')).toBe(true)
      const exported = applied(results)
      expect(exported).toContain('1 Mask of Memory (PLST) C14-249')
      expect(exported).toContain('1 Professional Face-Breaker (PSNC) 116p')
      expect(exported).toContain('3 Mountain (M20) 276')
    })

    it('takes a set with no number as the card by its name within that set', async () => {
      const asked = scryfall(precon)
      const text = toDecklistText(parseArchidekt({ cards: [solRingWith({ collectorNumber: '' })] }))
      expect(text).toBe('Deck\n1 Sol Ring (CMM)')
      const [result] = await resolvePrintings(parseDecklist(text), { now: NOW })
      expect(asked).toEqual([{ name: 'Sol Ring', set: 'cmm' }])
      expect(result).toMatchObject({ how: 'set', card: { set: 'cmm', collector_number: '410' } })
    })
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
