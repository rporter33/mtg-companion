import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import useDeckCards from '../src/features/decks/useDeckCards.js'
import { clearCache } from '../src/lib/cache.js'
import { createDeck, addCard } from '../src/lib/deck.js'
import { __internals } from '../src/lib/scryfall.js'
import { legalEverywhere, FOREST } from './fixtures.js'

/**
 * An open deck shows its cached cards at once, then what Scryfall says now.
 *
 * The record ages are counted back from the moment the test runs and the
 * card was released long ago, so nothing here depends on which day it is.
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DAY = 24 * 60 * 60 * 1000
const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })

const BOLT = legalEverywhere({ id: 'bolt', name: 'Lightning Bolt', released_at: '2010-07-16' })
const BANNED = { ...BOLT, legalities: { ...BOLT.legalities, modern: 'banned' } }

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

let root
async function open(deck) {
  const seen = []
  function Probe() {
    const { cards, loading, missing } = useDeckCards(deck)
    seen.push({ cards, loading, missing })
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => { root.render(<Probe />) })
  return seen
}

async function until(done, ms = 8000) {
  const started = Date.now()
  while (!done()) {
    if (Date.now() - started > ms) throw new Error('timed out')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
}

beforeEach(async () => {
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

describe('useDeckCards', () => {
  const deck = addCard(addCard(createDeck({ formatId: 'modern' }), FOREST.id, 56), BOLT.id, 4)

  it('shows the cached cards at once, then the refreshed ones, without holding loading for the refresh', async () => {
    await seed([FOREST, BOLT], Date.now() - 30 * DAY)
    let answer
    const answered = new Promise((resolve) => { answer = resolve })
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      await answered
      const ids = JSON.parse(opts.body).identifiers.map((i) => i.id)
      return ok({ object: 'list', data: [FOREST, BANNED].filter((c) => ids.includes(c.id)), not_found: [] })
    }))

    const seen = await open(deck)
    await until(() => seen.at(-1).cards.size === 2 && !seen.at(-1).loading)
    // The cache, while the refresh is still out.
    expect(seen.at(-1).cards.get(BOLT.id).legalities.modern).toBe('legal')
    expect(seen.at(-1).missing).toEqual([])

    answer()
    await until(() => seen.at(-1).cards.get(BOLT.id).legalities.modern === 'banned')
    expect(seen.at(-1).cards.size).toBe(2)
  })

  it('draws nothing again when no record is due', async () => {
    await seed([FOREST, BOLT], Date.now() - 60 * 60 * 1000)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const seen = await open(deck)
    await until(() => seen.at(-1).cards.size === 2 && !seen.at(-1).loading)
    const renders = seen.length
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(seen.length).toBe(renders)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps showing the cache when the refresh fails', async () => {
    await seed([FOREST, BOLT], Date.now() - 30 * DAY)
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const seen = await open(deck)
    await until(() => fetchMock.mock.calls.length > 0)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(seen.at(-1).cards.get(BOLT.id).legalities.modern).toBe('legal')
    expect(seen.at(-1).missing).toEqual([])
  })
})
