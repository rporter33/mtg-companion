import { describe, it, expect } from 'vitest'
import { captureSnapshot, diffSnapshot, diffAllDecks, summarise } from '../src/lib/snapshot.js'
import { createDeck, addCard, setCommanders } from '../src/lib/deck.js'
import { legalEverywhere, FOREST, BEAR, COUNTERSPELL, COMMANDER_BEAR } from './fixtures.js'

const mapOf = (...cards) => new Map(cards.map((c) => [c.id, c]))

/** The same card, restated with a different legality in one format. */
const withLegality = (card, format, status) =>
  ({ ...card, legalities: { ...card.legalities, [format]: status } })

function modernDeck() {
  let deck = createDeck({ formatId: 'modern', name: 'Test' })
  deck = addCard(deck, FOREST.id, 56)
  deck = addCard(deck, BEAR.id, 4)
  return deck
}

describe('captureSnapshot', () => {
  it('records every loaded card with its current status', () => {
    const snapshot = captureSnapshot(modernDeck(), mapOf(FOREST, BEAR))
    expect(snapshot.formatId).toBe('modern')
    expect(snapshot.cards[BEAR.id]).toEqual({ name: 'Grizzly Bears', status: 'legal' })
    expect(snapshot.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('omits cards that had not loaded rather than recording them as unknown', () => {
    // Recording an unloaded card would later read as "changed from unknown to
    // legal", which is noise dressed up as news.
    const deck = addCard(modernDeck(), 'never-seen', 1)
    const snapshot = captureSnapshot(deck, mapOf(FOREST, BEAR))
    expect(snapshot.cards['never-seen']).toBeUndefined()
  })

  it('includes the commander', () => {
    let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    deck = addCard(deck, FOREST.id, 99)
    const snapshot = captureSnapshot(deck, mapOf(FOREST, COMMANDER_BEAR))
    expect(snapshot.cards[COMMANDER_BEAR.id]).toBeDefined()
  })

  it('returns null for an unknown format instead of a bogus snapshot', () => {
    expect(captureSnapshot({ ...modernDeck(), formatId: 'nonsense' }, mapOf(FOREST))).toBeNull()
  })
})

describe('diffSnapshot', () => {
  const deck = modernDeck()
  const before = captureSnapshot(deck, mapOf(FOREST, BEAR))

  it('is silent when nothing changed', () => {
    // The common case. An app that announces "nothing happened" every launch
    // trains you to ignore it.
    expect(diffSnapshot(before, deck, mapOf(FOREST, BEAR))).toEqual([])
  })

  it('reports a ban in plain language', () => {
    const banned = withLegality(BEAR, 'modern', 'banned')
    const changes = diffSnapshot(before, deck, mapOf(FOREST, banned))
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ from: 'legal', to: 'banned', severity: 'error' })
    expect(changes[0].message).toBe('Grizzly Bears has been banned in Modern.')
  })

  it('reports an unban as good news', () => {
    const wasBanned = captureSnapshot(deck, mapOf(FOREST, withLegality(BEAR, 'modern', 'banned')))
    const changes = diffSnapshot(wasBanned, deck, mapOf(FOREST, BEAR))
    expect(changes[0]).toMatchObject({ to: 'legal', severity: 'good' })
    expect(changes[0].message).toMatch(/unbanned/)
  })

  it('reports rotation distinctly from a ban', () => {
    const rotated = withLegality(BEAR, 'modern', 'not_legal')
    const changes = diffSnapshot(before, deck, mapOf(FOREST, rotated))
    expect(changes[0].message).toMatch(/rotated out/)
  })

  it('reports a new restriction', () => {
    const restricted = withLegality(BEAR, 'modern', 'restricted')
    const changes = diffSnapshot(before, deck, mapOf(FOREST, restricted))
    expect(changes[0].message).toMatch(/one copy only/)
    expect(changes[0].severity).toBe('error')
  })

  it('puts bad news first', () => {
    // Snapshot a deck that holds both cards, with Counterspell already banned,
    // then flip each one the other way: Bears gets banned, Counterspell freed.
    const withBoth = addCard(deck, COUNTERSPELL.id, 1)
    const snapshot = captureSnapshot(withBoth, mapOf(FOREST, BEAR,
      withLegality(COUNTERSPELL, 'modern', 'banned')))
    const changes = diffSnapshot(snapshot, withBoth, mapOf(
      FOREST, withLegality(BEAR, 'modern', 'banned'), COUNTERSPELL))
    expect(changes).toHaveLength(2)
    expect(changes[0].severity).toBe('error')
    expect(changes[1].severity).toBe('good')
  })

  it('says nothing about a card that is merely not loaded now', () => {
    // Offline is not a rules change.
    expect(diffSnapshot(before, deck, mapOf(FOREST))).toEqual([])
  })

  it('treats a data gap as a gap, not as a change', () => {
    const noData = { ...BEAR, legalities: {} }
    expect(diffSnapshot(before, deck, mapOf(FOREST, noData))).toEqual([])
  })

  it('reports a format change as its own event rather than as mass illegality', () => {
    const moved = { ...deck, formatId: 'pauper' }
    const changes = diffSnapshot(before, moved, mapOf(FOREST, BEAR))
    expect(changes).toHaveLength(1)
    expect(changes[0].kind).toBe('format_changed')
  })

  it('ignores a snapshot written by a future version', () => {
    expect(diffSnapshot({ ...before, version: 999 }, deck, mapOf(FOREST, BEAR))).toEqual([])
  })

  it('handles a missing snapshot without throwing', () => {
    expect(diffSnapshot(null, deck, mapOf(FOREST, BEAR))).toEqual([])
  })
})

describe('diffAllDecks', () => {
  it('returns only decks that actually changed', () => {
    const a = { ...modernDeck(), id: 'a', name: 'Changed' }
    const b = { ...modernDeck(), id: 'b', name: 'Untouched' }
    a.snapshot = captureSnapshot(a, mapOf(FOREST, BEAR))
    b.snapshot = captureSnapshot(b, mapOf(FOREST, BEAR))

    const report = diffAllDecks([a, b], {
      a: mapOf(FOREST, withLegality(BEAR, 'modern', 'banned')),
      b: mapOf(FOREST, BEAR),
    })
    expect(report).toHaveLength(1)
    expect(report[0].deckName).toBe('Changed')
  })

  it('skips decks that have never been snapshotted', () => {
    const deck = { ...modernDeck(), id: 'x' }
    expect(diffAllDecks([deck], { x: mapOf(FOREST, BEAR) })).toEqual([])
  })
})

describe('summarise', () => {
  const entry = (changes) => [{ deckId: 'a', deckName: 'A', formatId: 'modern', changes }]

  it('returns null when there is nothing to say', () => {
    expect(summarise([])).toBeNull()
  })

  it('leads with the bad news', () => {
    expect(summarise(entry([{ severity: 'error' }]))).toMatch(/1 card in your deck is no longer playable/)
  })

  it('counts both directions when both happened', () => {
    const text = summarise(entry([{ severity: 'error' }, { severity: 'good' }, { severity: 'good' }]))
    expect(text).toMatch(/1 card restricted or banned and 2 freed up/)
  })

  it('pluralises the deck noun when more than one deck is affected', () => {
    const one = [{ deckId: 'a', deckName: 'A', changes: [{ severity: 'good' }] }]
    const two = [
      { deckId: 'a', deckName: 'A', changes: [{ severity: 'good' }] },
      { deckId: 'b', deckName: 'B', changes: [{ severity: 'good' }] },
    ]
    expect(summarise(one)).toMatch(/your deck /)
    expect(summarise(two)).toMatch(/your decks /)
  })
})
