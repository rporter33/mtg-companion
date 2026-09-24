import { describe, it, expect, beforeEach } from 'vitest'
import {
  getFormat, formatLabel, cardLegality, legalityStatus, poolQuery, effectiveCopyLimit, canBeCommander,
} from '../src/lib/formats.js'
import {
  createDeck, addCard, setCommanders, validateDeck, deckSize, deckVerdict, upgradeDeck, stampNames,
} from '../src/lib/deck.js'
import { captureSnapshot, diffSnapshot, SNAPSHOT_VERSION } from '../src/lib/snapshot.js'
import { coachDeck } from '../src/lib/coach.js'
import { analyzeDeck } from '../src/lib/analysis.js'
import { seatDeck } from '../src/lib/engine/deck.js'
import { memoryBackend } from '../src/lib/storage-backend.js'
import { useBackend, clearAll, getDeck, listDecks, saveDeck, importAll } from '../src/lib/storage.js'
import { card, BEAR, FOREST, COMMANDER_BEAR, NAZGUL } from './fixtures.js'

/**
 * A deck whose formatId this build does not know: written by a newer build,
 * or a hand-edited backup. It has no format rules here. Every rule helper
 * takes the null getFormat gives for it to mean exactly that, so the deck
 * screens open, list, search and add without a guard of their own, and the
 * stored formatId is left as it was. The day is passed in wherever a rule
 * reads one, so none of this changes its answer with the calendar.
 */

const NOW = '2026-09-24'

const unknownDeck = (formatId = 'made-up-format') => {
  let deck = createDeck({ name: 'From a newer build', formatId })
  deck = addCard(deck, BEAR.id, 7)
  deck = addCard(deck, FOREST.id, 20)
  deck = { ...deck, sideboard: [{ cardId: BEAR.id, quantity: 2 }] }
  return setCommanders(deck, [COMMANDER_BEAR.id])
}
const cards = new Map([BEAR, FOREST, COMMANDER_BEAR].map((c) => [c.id, c]))

describe('getFormat', () => {
  it('knows nothing of a format this build does not have', () => {
    expect(getFormat('made-up-format')).toBe(null)
    expect(getFormat(undefined)).toBe(null)
    expect(getFormat(null)).toBe(null)
    expect(getFormat('')).toBe(null)
  })

  it('reads only its own formats, not what every object inherits', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(getFormat(id), id).toBe(null)
    }
  })

  it('takes an id only as a string', () => {
    expect(getFormat(['commander'])).toBe(null)
    expect(getFormat({ toString: () => 'commander' })).toBe(null)
    expect(getFormat('commander').name).toBe('Commander')
  })
})

describe('formatLabel', () => {
  it('names a known format', () => {
    expect(formatLabel('modern')).toBe('Modern')
  })

  it('gives the id the deck names for a format this build does not know', () => {
    expect(formatLabel('made-up-format')).toBe('made-up-format')
    expect(formatLabel('constructor')).toBe('constructor')
  })

  it('says unknown when there is no id to give', () => {
    expect(formatLabel(undefined)).toBe('Unknown format')
    expect(formatLabel('   ')).toBe('Unknown format')
    expect(formatLabel(42)).toBe('Unknown format')
  })
})

describe('the rule helpers with no format', () => {
  it('says nothing of a card\'s legality', () => {
    const banned = card({ legalities: { commander: 'banned', modern: 'banned' } })
    expect(cardLegality(banned, null)).toBe('unknown')
    expect(legalityStatus(banned, null, NOW)).toBe('unknown')
    // Not out yet and not legal anywhere: still nothing said either way.
    const notOut = card({ released_at: '2099-01-01', legalities: { standard: 'not_legal', future: 'legal' } })
    expect(legalityStatus(notOut, null, NOW)).toBe('unknown')
    // Out this week with a record that lists it nowhere: not 'catching_up'
    // either, which is a reading of a format's rules.
    const justOut = card({ released_at: '2026-09-22', legalities: { commander: 'not_legal', vintage: 'not_legal', legacy: 'not_legal' } })
    expect(legalityStatus(justOut, null, NOW)).toBe('unknown')
  })

  it('scopes a search to no card pool', () => {
    expect(poolQuery(null)).toBe(null)
  })

  it('sets no copy limit, while a card\'s own clause still holds', () => {
    expect(effectiveCopyLimit(BEAR, null)).toBe(Infinity)
    expect(effectiveCopyLimit(FOREST, null)).toBe(Infinity)
    expect(effectiveCopyLimit(NAZGUL, null)).toBe(9)
  })

  it('has no commander rules to check a card against', () => {
    const check = canBeCommander(COMMANDER_BEAR, null)
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/does not know this format/)
  })
})

describe('a deck in a format this build does not know', () => {
  it('reports the unknown format, and only that', () => {
    const result = validateDeck(unknownDeck(), cards, { now: NOW })
    expect(result.legal).toBe(false)
    expect(result.violations).toEqual([
      expect.objectContaining({ code: 'unknown_format', severity: 'error', message: 'Unknown format "made-up-format".' }),
    ])
  })

  it('says so plainly when the deck names no format at all', () => {
    const { formatId: _gone, ...deck } = unknownDeck()
    expect(validateDeck(deck, cards, { now: NOW }).violations).toEqual([
      expect.objectContaining({ code: 'unknown_format', message: 'This deck names no format.' }),
    ])
  })

  it('does the same for an id that names an inherited property, rather than throwing', () => {
    for (const id of ['constructor', 'toString', '__proto__']) {
      expect(validateDeck(unknownDeck(id), cards, { now: NOW }).violations.map((v) => v.code), id).toEqual(['unknown_format'])
    }
  })

  it('has that one problem as its verdict, not "Legal"', () => {
    const deck = unknownDeck()
    const validation = validateDeck(deck, cards, { now: NOW })
    expect(deckVerdict(deck, validation, cards, { now: NOW })).toEqual({ tone: 'error', text: '1 problem' })
  })

  it('counts its main deck, without a commander rule to add the commander', () => {
    expect(deckSize(unknownDeck(), null)).toBe(27)
  })

  it('captures no legality snapshot, compares none, and gets no coach report', () => {
    const deck = unknownDeck()
    expect(captureSnapshot(deck, cards)).toBe(null)
    const snapshot = { version: SNAPSHOT_VERSION, formatId: deck.formatId, capturedAt: '2026-09-01T00:00:00Z', cards: { bear: { name: BEAR.name, status: 'banned' } } }
    expect(diffSnapshot(snapshot, deck, cards)).toEqual([])
    expect(coachDeck(deck, (id) => cards.get(id))).toBe(null)
  })

  it('still has an analysis, drawn from the cards it holds', () => {
    const analysis = analyzeDeck(unknownDeck(), (id) => cards.get(id))
    expect(analysis.librarySize).toBe(27)
    expect(analysis.lands.landCount).toBe(20)
    // An inherited name is no format either, and an empty deck was the one
    // that reached for its size and threw.
    expect(() => analyzeDeck({ ...unknownDeck('constructor'), main: [] }, (id) => cards.get(id))).not.toThrow()
  })

  it('sits at the engine without a sideboard, since no rule says it has one', () => {
    const seat = seatDeck(unknownDeck(), (id) => cards.get(id))
    expect(seat.total).toBe(27)
    expect(seat.sideboard).toEqual({})
  })

  it('names the format it came from once the player has chosen one', () => {
    // A snapshot a newer build took in its own format, then the player chose
    // Commander here: the change is said in the words the deck gave.
    const deck = { ...unknownDeck(), formatId: 'commander' }
    const snapshot = { version: SNAPSHOT_VERSION, formatId: 'made-up-format', capturedAt: '2026-09-01T00:00:00Z', cards: {} }
    expect(diffSnapshot(snapshot, deck, cards)).toEqual([expect.objectContaining({
      kind: 'format_changed',
      message: 'This deck moved from made-up-format to Commander, so its legality was re-checked from scratch.',
    })])
  })

  it('is never given a format it did not name', () => {
    const deck = unknownDeck()
    validateDeck(deck, cards, { now: NOW })
    captureSnapshot(deck, cards)
    coachDeck(deck, (id) => cards.get(id))
    expect(deck.formatId).toBe('made-up-format')
    expect(upgradeDeck(deck).formatId).toBe('made-up-format')
    expect(upgradeDeck(unknownDeck('constructor')).formatId).toBe('constructor')
    expect(stampNames(deck, cards).formatId).toBe('made-up-format')
  })
})

describe('a deck in a format this build does not know, read back from storage', () => {
  beforeEach(() => {
    useBackend(memoryBackend())
    clearAll()
  })

  it('opens with its format as it was, and is written back the same', () => {
    const backend = memoryBackend()
    backend.write('mtg-companion:v1:deck:strange', JSON.stringify({ ...unknownDeck(), id: 'strange' }))
    useBackend(backend)
    expect(getDeck('strange').formatId).toBe('made-up-format')
    saveDeck({ ...getDeck('strange'), name: 'Renamed' })
    expect(JSON.parse(backend.read('mtg-companion:v1:deck:strange')).formatId).toBe('made-up-format')
  })

  it('comes in from a backup with its format as it was, an inherited name included', () => {
    importAll(JSON.stringify({
      version: 4,
      decks: [{ ...unknownDeck(), id: 'newer' }, { ...unknownDeck('constructor'), id: 'edited' }],
    }))
    expect(listDecks().map((d) => [d.id, d.formatId]).sort()).toEqual([['edited', 'constructor'], ['newer', 'made-up-format']])
  })
})
