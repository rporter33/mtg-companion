import { describe, it, expect } from 'vitest'
import {
  captureSnapshot, diffSnapshot, diffAllDecks, summarise, oldestFetch, checkedAgainst,
} from '../src/lib/snapshot.js'
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

describe('a card coming out', () => {
  // A Reality Fracture card, saved in a Commander deck before its release on
  // 2 Oct 2026, when Scryfall listed it not_legal everywhere.
  const RELEASE = '2026-10-02'
  const preview = legalEverywhere({
    id: 'fra-scholar', name: 'Fractured Scholar', released_at: RELEASE,
    legalities: { ...legalEverywhere().legalities, commander: 'not_legal', standard: 'not_legal' },
  })
  const out = withLegality(preview, 'commander', 'legal')
  const deck = addCard(addCard(setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id]), FOREST.id, 97), preview.id, 1)
  const takenAt = (capturedAt, card = preview) => ({ ...captureSnapshot(deck, mapOf(FOREST, COMMANDER_BEAR, card)), capturedAt })

  it('is not announced when the snapshot was taken before release', () => {
    const snapshot = takenAt('2026-09-21T12:00:00.000Z')
    expect(snapshot.cards[preview.id].status).toBe('not_legal')
    expect(diffSnapshot(snapshot, deck, mapOf(FOREST, COMMANDER_BEAR, out))).toEqual([])
    expect(diffAllDecks([{ ...deck, snapshot }], { [deck.id]: mapOf(FOREST, COMMANDER_BEAR, out) })).toEqual([])
  })

  it('is not announced from a snapshot taken in the week after release, which may be of a record from before it', () => {
    for (const capturedAt of ['2026-10-02T00:05:00.000Z', '2026-10-08T23:59:00.000Z']) {
      expect(diffSnapshot(takenAt(capturedAt), deck, mapOf(FOREST, COMMANDER_BEAR, out))).toEqual([])
    }
  })

  it('is announced as before from a snapshot taken once that week is over', () => {
    const changes = diffSnapshot(takenAt('2026-10-09T00:00:00.000Z'), deck, mapOf(FOREST, COMMANDER_BEAR, out))
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ from: 'not_legal', to: 'legal', severity: 'good' })
  })

  it('still announces a ban, whenever the snapshot was taken', () => {
    const banned = withLegality(preview, 'commander', 'banned')
    const changes = diffSnapshot(takenAt('2026-09-21T12:00:00.000Z'), deck, mapOf(FOREST, COMMANDER_BEAR, banned))
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ from: 'not_legal', to: 'banned', severity: 'error' })
  })

  it('still announces an unban and a card rotating out', () => {
    const wasBanned = takenAt('2026-09-21T12:00:00.000Z', withLegality(preview, 'commander', 'banned'))
    expect(diffSnapshot(wasBanned, deck, mapOf(FOREST, COMMANDER_BEAR, out))[0].message).toMatch(/unbanned/)
    const wasLegal = takenAt('2026-09-21T12:00:00.000Z', out)
    expect(diffSnapshot(wasLegal, deck, mapOf(FOREST, COMMANDER_BEAR, preview))[0].severity).toBe('error')
  })

  // The record as Scryfall lists a card before release: not_legal in every
  // paper format, Future Standard aside.
  const unlisted = {
    ...preview,
    legalities: { ...Object.fromEntries(Object.keys(preview.legalities).map((k) => [k, 'not_legal'])), future: 'legal' },
  }

  it('notes an entry read from a record that lists the card nowhere, and only such an entry', () => {
    const snapshot = takenAt('2026-09-21T12:00:00.000Z', unlisted)
    expect(snapshot.cards[unlisted.id]).toEqual({ name: 'Fractured Scholar', status: 'not_legal', listedNowhere: true })
    expect(snapshot.cards[FOREST.id]).toEqual({ name: 'Forest', status: 'legal' })
    // Not legal in Commander but listed elsewhere: Scryfall's word, no note.
    expect(takenAt('2026-09-21T12:00:00.000Z').cards[preview.id]).toEqual({ name: 'Fractured Scholar', status: 'not_legal' })
  })

  it('is not announced from such an entry whenever the snapshot was taken, as when a stale record is saved again after release', () => {
    for (const capturedAt of ['2026-10-10T12:00:00.000Z', '2027-03-01T00:00:00.000Z', undefined]) {
      expect(diffSnapshot(takenAt(capturedAt, unlisted), deck, mapOf(FOREST, COMMANDER_BEAR, out))).toEqual([])
    }
    // A ban is still news.
    const banned = withLegality(out, 'commander', 'banned')
    expect(diffSnapshot(takenAt('2026-10-10T12:00:00.000Z', unlisted), deck, mapOf(FOREST, COMMANDER_BEAR, banned))[0])
      .toMatchObject({ from: 'not_legal', to: 'banned', severity: 'error' })
  })

  it('announces as before when it cannot tell: no snapshot time, or no release date', () => {
    const { capturedAt, ...untimed } = takenAt('2026-09-21T12:00:00.000Z')
    expect(capturedAt).toBeTruthy()
    expect(diffSnapshot(untimed, deck, mapOf(FOREST, COMMANDER_BEAR, out))).toHaveLength(1)
    expect(diffSnapshot({ ...untimed, capturedAt: 'last week' }, deck, mapOf(FOREST, COMMANDER_BEAR, out))).toHaveLength(1)
    const { released_at, ...undated } = out
    expect(released_at).toBe(RELEASE)
    expect(diffSnapshot(takenAt('2026-09-21T12:00:00.000Z'), deck, mapOf(FOREST, COMMANDER_BEAR, undated))).toHaveLength(1)
  })
})

describe('the date of the data compared', () => {
  const at = (iso) => Date.parse(iso)

  it('is the oldest fetch among the records compared', () => {
    expect(oldestFetch([
      { card: BEAR, fetchedAt: at('2026-10-02T00:30:00Z') },
      { card: FOREST, fetchedAt: at('2026-09-14T08:00:00Z') },
    ])).toBe(at('2026-09-14T08:00:00Z'))
    expect(oldestFetch(new Map([['a', { fetchedAt: 5 }]]).values())).toBe(5)
  })

  it('is not known when there is nothing, or a record has no time', () => {
    expect(oldestFetch([])).toBeNull()
    expect(oldestFetch(undefined)).toBeNull()
    expect(oldestFetch([{ fetchedAt: 5 }, { card: BEAR }])).toBeNull()
    expect(oldestFetch([{ fetchedAt: 5 }, { fetchedAt: null }])).toBeNull()
  })

  it('is given in the banner as a day, never as "current"', () => {
    // August, because the short name ICU gives September in en-GB has
    // changed between versions ("Sep", "Sept").
    expect(checkedAgainst(at('2026-08-14T08:00:00Z')))
      .toBe('Checked against Scryfall data from 14 Aug 2026, not a list baked into this app.')
    // The day is UTC's, as every release date in the app is.
    expect(checkedAgainst(at('2026-10-01T23:30:00Z'))).toMatch(/from 1 Oct 2026/)
    expect(checkedAgainst(null))
      .toBe('Checked against the Scryfall data saved on this device, not a list baked into this app.')
    expect(checkedAgainst(1e20)).toMatch(/saved on this device/)
    for (const oldest of [at('2026-08-14T08:00:00Z'), null]) expect(checkedAgainst(oldest)).not.toMatch(/current/)
  })
})
