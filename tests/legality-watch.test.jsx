import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import useLegalityWatch from '../src/features/decks/useLegalityWatch.js'
import { saveDeck, getDeck, deleteDeck, useBackend } from '../src/lib/storage.js'
import { memoryBackend } from '../src/lib/storage-backend.js'
import { clearCache, getCardRecords } from '../src/lib/cache.js'
import { createDeck, addCard } from '../src/lib/deck.js'
import { captureSnapshot } from '../src/lib/snapshot.js'
import { __internals } from '../src/lib/scryfall.js'
import { legalEverywhere, FOREST, BEAR } from './fixtures.js'

/**
 * The launch legality watch, with its refresh.
 *
 * Before comparing, the watch fetches each deck's due cards again, so a ban
 * announced this week reaches a deck saved last month. The cards here were
 * released long ago or have fixed dates in the past, and the records' ages
 * are counted back from the moment the test runs, so nothing depends on
 * which day it is.
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DAY = 24 * 60 * 60 * 1000
const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })

const BOLT = legalEverywhere({ id: 'bolt', name: 'Lightning Bolt', released_at: '2010-07-16' })
const withLegality = (card, format, status) => ({ ...card, legalities: { ...card.legalities, [format]: status } })

async function seed(cards, fetchedAt) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('mtg-companion', 1)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readwrite')
    for (const card of cards) tx.objectStore('cards').put({ id: card.id, name: card.name, card, fetchedAt, pinned: true })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/** Scryfall's collection endpoint, answering from `cards`. */
const scryfall = (cards, { gate } = {}) => vi.fn(async (_url, opts) => {
  if (gate) await gate
  const ids = JSON.parse(opts.body).identifiers.map((i) => i.id)
  return ok({ object: 'list', data: cards.filter((c) => ids.includes(c.id)), not_found: [] })
})

function modernDeck(id, cards, snapshotCards, capturedAt) {
  let deck = { ...createDeck({ formatId: 'modern', name: id }), id }
  for (const [card, n] of cards) deck = addCard(deck, card.id, n)
  const snapshot = { ...captureSnapshot(deck, new Map(snapshotCards.map((c) => [c.id, c]))), capturedAt }
  return { ...deck, snapshot }
}

let root
async function watch() {
  const seen = []
  function Probe() {
    seen.push(useLegalityWatch())
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => { root.render(<Probe />) })
  return () => seen.at(-1)
}

// Timed by performance.now(), which keeps moving when a test holds the Date clock.
async function until(done, ms = 8000) {
  const started = performance.now()
  while (!done()) {
    if (performance.now() - started > ms) throw new Error('timed out')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
}

const unmount = async () => { await act(async () => { root?.unmount() }); root = null }
const down = () => vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })

beforeEach(async () => {
  // Every test is its own session, with its own decks.
  useBackend(memoryBackend())
  await clearCache()
  __internals.setBackoffBase(1)
  __internals.setLockoutMs(1)
  __internals.resumeBackground()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useLegalityWatch', () => {
  it('fetches a saved deck\'s cards again before comparing, so a ban this week reaches it', async () => {
    const savedAt = Date.now() - 30 * DAY
    await seed([FOREST, BOLT], savedAt)
    saveDeck(modernDeck('burn', [[FOREST, 56], [BOLT, 4]], [FOREST, BOLT], new Date(savedAt).toISOString()))
    vi.stubGlobal('fetch', scryfall([FOREST, withLegality(BOLT, 'modern', 'banned')]))

    const latest = await watch()
    await until(() => latest().report.length > 0)

    expect(latest().summary).toBe('1 card in your deck is no longer playable.')
    expect(latest().report[0].changes[0]).toMatchObject({ name: 'Lightning Bolt', from: 'legal', to: 'banned' })
    // The data compared was fetched just now, and the banner says so.
    expect(latest().dataFrom).toBeGreaterThan(savedAt)
    // Re-baselined on what Scryfall says now, so it is announced once.
    expect(getDeck('burn').snapshot.cards.bolt.status).toBe('banned')
    expect((await getCardRecords(['bolt'])).get('bolt').card.legalities.modern).toBe('banned')
  })

  it('says nothing about a card simply coming out', async () => {
    // Saved while the card was a preview, not_legal as Scryfall lists every
    // card before release; fetched again, it is legal.
    const PREVIEW = legalEverywhere({ id: 'preview', name: 'Fresh Face', released_at: '2020-06-01' })
    const before = withLegality(PREVIEW, 'modern', 'not_legal')
    const savedAt = Date.now() - 30 * DAY
    await seed([FOREST, before], savedAt)
    saveDeck(modernDeck('new', [[FOREST, 56], [PREVIEW, 4]], [FOREST, before], '2020-05-20T12:00:00.000Z'))
    vi.stubGlobal('fetch', scryfall([FOREST, PREVIEW]))

    const latest = await watch()
    await until(() => latest().dataFrom !== null)
    expect(latest().report).toEqual([])
    expect(latest().summary).toBeNull()
    expect(getDeck('new').snapshot.cards.preview.status).toBe('legal')
  })

  it('keeps the cached cards when the refresh fails, says nothing, and dates the data it had', async () => {
    const savedAt = Date.now() - 30 * DAY
    await seed([FOREST, BOLT], savedAt)
    saveDeck(modernDeck('burn', [[FOREST, 56], [BOLT, 4]], [FOREST, BOLT], new Date(savedAt).toISOString()))
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const latest = await watch()
    await until(() => latest().dataFrom !== null)
    expect(latest().report).toEqual([])
    expect(latest().dataFrom).toBe(savedAt)
    // One background request, asked once: no retries holding the line.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves a deck edited while it ran as edited, and a deck deleted meanwhile deleted', async () => {
    const savedAt = Date.now() - 30 * DAY
    await seed([FOREST, BOLT, BEAR], savedAt)
    saveDeck(modernDeck('burn', [[FOREST, 56], [BOLT, 4]], [FOREST, BOLT], new Date(savedAt).toISOString()))
    saveDeck(modernDeck('gone', [[FOREST, 60]], [FOREST], new Date(savedAt).toISOString()))
    let open
    const gate = new Promise((resolve) => { open = resolve })
    const fetchMock = scryfall([FOREST, BOLT, BEAR], { gate })
    vi.stubGlobal('fetch', fetchMock)

    const latest = await watch()
    await until(() => fetchMock.mock.calls.length > 0)
    // The player renames a deck and adds a card, and deletes another, while
    // the refresh is still out.
    saveDeck({ ...addCard(getDeck('burn'), BEAR.id, 1), name: 'Burn, edited' })
    deleteDeck('gone')
    open()
    await until(() => latest().dataFrom !== null)

    const burn = getDeck('burn')
    expect(burn.name).toBe('Burn, edited')
    expect(burn.main.find((e) => e.cardId === BEAR.id)?.quantity).toBe(1)
    expect(burn.snapshot.capturedAt > new Date(savedAt).toISOString()).toBe(true)
    expect(getDeck('gone')).toBeNull()
  }, 15000)

  it("refreshes every deck's cards in one pass, so the decks share their batches of 75", async () => {
    const savedAt = Date.now() - 30 * DAY
    const cards = Array.from({ length: 60 }, (_, i) => legalEverywhere({ id: `card-${i}`, name: `Card ${i}`, released_at: '2010-01-01' }))
    await seed(cards, savedAt)
    for (let d = 0; d < 3; d++) {
      const mine = cards.slice(d * 20, d * 20 + 20)
      saveDeck(modernDeck(`deck-${d}`, mine.map((c) => [c, 3]), mine, new Date(savedAt).toISOString()))
    }
    const fetchMock = scryfall(cards)
    vi.stubGlobal('fetch', fetchMock)

    const latest = await watch()
    await until(() => latest().dataFrom !== null)
    // Sixty cards due across three decks: one request of sixty, not three of twenty.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).identifiers).toHaveLength(60)
    expect(latest().dataFrom).toBeGreaterThan(savedAt)
  })

  it('asks once while Scryfall is down, however many decks, and nothing on a return within the pause', async () => {
    const savedAt = Date.now() - 30 * DAY
    await seed([FOREST, BOLT, BEAR], savedAt)
    // Each deck names a card this device never saved, so each would ask.
    saveDeck(modernDeck('one', [[FOREST, 55], [BOLT, 4], [{ id: 'unsaved-1' }, 1]], [FOREST, BOLT], new Date(savedAt).toISOString()))
    saveDeck(modernDeck('two', [[FOREST, 55], [BEAR, 4], [{ id: 'unsaved-2' }, 1]], [FOREST, BEAR], new Date(savedAt).toISOString()))
    saveDeck(modernDeck('three', [[FOREST, 59], [{ id: 'unsaved-3' }, 1]], [FOREST], new Date(savedAt).toISOString()))
    const fetchMock = down()
    vi.stubGlobal('fetch', fetchMock)

    let latest = await watch()
    await until(() => latest().dataFrom !== null)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Every deck was still compared, from what the device has.
    expect(latest().report).toEqual([])
    expect(latest().dataFrom).toBe(savedAt)
    for (const id of ['one', 'two', 'three']) expect(getDeck(id).snapshot.capturedAt > new Date(savedAt).toISOString()).toBe(true)

    // Back to the Decks screen a moment later: the watch runs again, and asks nothing.
    await unmount()
    latest = await watch()
    await until(() => latest().dataFrom !== null)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not announce a card coming out after a snapshot taken again, offline or on a failed refresh, from a record saved before release', async () => {
    // The clock is held on fixed days: saved on 21 Sep 2026 while Reality
    // Fracture (out 2 Oct) was a preview, launched on 10 Oct with Scryfall
    // failing, and on 11 Oct with it answering.
    const notLegal = Object.fromEntries(Object.keys(BOLT.legalities).map((k) => [k, 'not_legal']))
    const PREVIEW = legalEverywhere({ id: 'rift', name: 'Rift Card', released_at: '2026-10-02', legalities: { ...notLegal, future: 'legal' } })
    const OUT = legalEverywhere({ id: 'rift', name: 'Rift Card', released_at: '2026-10-02' })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-21T10:00:00Z'))
      await seed([FOREST, PREVIEW], Date.now())
      // A snapshot as an older build took it, with no note of the record it read.
      const deck = modernDeck('rift', [[FOREST, 56], [PREVIEW, 4]], [FOREST, PREVIEW], new Date().toISOString())
      delete deck.snapshot.cards.rift.listedNowhere
      saveDeck(deck)

      vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
      const failing = down()
      vi.stubGlobal('fetch', failing)
      let latest = await watch()
      await until(() => getDeck('rift').snapshot.capturedAt.startsWith('2026-10-10'))
      expect(failing).toHaveBeenCalledTimes(1)
      expect(latest().report).toEqual([])
      // Taken again from the record saved before release, and noted as such.
      expect(getDeck('rift').snapshot.cards.rift).toMatchObject({ status: 'not_legal', listedNowhere: true })

      await unmount()
      vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
      vi.stubGlobal('fetch', scryfall([FOREST, OUT]))
      latest = await watch()
      await until(() => getDeck('rift').snapshot.capturedAt.startsWith('2026-10-11'))
      expect(latest().report).toEqual([])
      expect(latest().summary).toBeNull()
      expect(getDeck('rift').snapshot.cards.rift).toEqual({ name: 'Rift Card', status: 'legal' })
    } finally {
      vi.useRealTimers()
    }
  }, 15000)
})
