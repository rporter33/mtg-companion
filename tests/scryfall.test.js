import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearCache, putCards, getCard, pinCards, evictStale, CARD_TTL_MS } from '../src/lib/cache.js'
import {
  searchCards, getCardById, getCardsByIds, getRulings, autocomplete,
  ScryfallError, OfflineError, __internals,
} from '../src/lib/scryfall.js'
import { BEAR, COUNTERSPELL } from './fixtures.js'

const ok = (payload) => ({
  ok: true, status: 200, json: async () => payload,
})
const fail = (status, payload = {}) => ({
  ok: false, status, json: async () => ({ object: 'error', status, ...payload }),
})

const searchPayload = (cards, extra = {}) => ok({
  object: 'list', data: cards, total_cards: cards.length, has_more: false, ...extra,
})

beforeEach(async () => {
  await clearCache()
  vi.stubGlobal('navigator', { onLine: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('searchCards', () => {
  it('returns cards and caches them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchPayload([BEAR]))
    vi.stubGlobal('fetch', fetchMock)

    const first = await searchCards('bears')
    expect(first.cards).toHaveLength(1)
    expect(first.fromCache).toBe(false)
    expect(await getCard(BEAR.id)).toBeTruthy()

    const second = await searchCards('bears')
    expect(second.fromCache).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1) // served from cache, no second call
  })

  it('does not call the network for an empty query', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await searchCards('   ')
    expect(result.cards).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a 404 as zero results, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(404, { details: 'no cards found' })))
    const result = await searchCards('kjhgfdsa')
    expect(result.cards).toEqual([])
    expect(result.notFound).toBe(true)
  })

  it('surfaces a malformed-query error to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      fail(400, { details: 'Invalid expression "c>>w"' })))
    await expect(searchCards('c>>w')).rejects.toThrow(/Invalid expression/)
  })

  it('passes Scryfall query syntax through untouched', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchPayload([]))
    vi.stubGlobal('fetch', fetchMock)
    await searchCards('t:creature f:modern cmc<=3')
    const url = new URL(fetchMock.mock.calls[0][0])
    // URLSearchParams form-encodes spaces as '+', which Scryfall accepts.
    // What matters is that the operators survive the round trip intact.
    expect(url.searchParams.get('q')).toBe('t:creature f:modern cmc<=3')
  })
})

describe('retry behaviour', () => {
  it('retries a 503 and succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(searchPayload([BEAR]))
    vi.stubGlobal('fetch', fetchMock)
    const result = await searchCards('bears')
    expect(result.cards).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a 429 and eventually gives up with a clear message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(429))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchCards('bears')).rejects.toThrow(ScryfallError)
    expect(fetchMock).toHaveBeenCalledTimes(4) // initial + 3 retries
  }, 15000)

  it('does not retry a 400 — it is a real answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(400, { details: 'bad query' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchCards('x')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the queue alive after a failure', async () => {
    // A rejected request must not stall everything queued behind it.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(400, { details: 'bad' }))
      .mockResolvedValueOnce(searchPayload([BEAR]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchCards('bad')).rejects.toThrow()
    const result = await searchCards('good')
    expect(result.cards).toHaveLength(1)
  })
})

describe('rate limiting', () => {
  it('spaces consecutive requests by at least the minimum interval', async () => {
    const times = []
    vi.stubGlobal('fetch', vi.fn(async () => {
      times.push(Date.now())
      return searchPayload([])
    }))
    await Promise.all([searchCards('a'), searchCards('b'), searchCards('c')])
    expect(times).toHaveLength(3)
    for (let i = 1; i < times.length; i++) {
      // Allow a small scheduler tolerance below the nominal interval.
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(__internals.MIN_INTERVAL_MS - 15)
    }
  }, 10000)
})

describe('offline behaviour', () => {
  it('refuses to hit the network when the browser reports offline', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { onLine: false })
    await expect(searchCards('bears')).rejects.toThrow(OfflineError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still serves pinned deck cards while offline', async () => {
    await putCards([BEAR, COUNTERSPELL], { pinned: true })
    vi.stubGlobal('navigator', { onLine: false })
    vi.stubGlobal('fetch', vi.fn())
    const found = await getCardsByIds([BEAR.id, COUNTERSPELL.id])
    expect(found.size).toBe(2)
    expect(found.get(BEAR.id).name).toBe('Grizzly Bears')
  })

  it('returns partial results rather than nothing when some cards are missing', async () => {
    await putCards([BEAR], { pinned: true })
    vi.stubGlobal('navigator', { onLine: false })
    const found = await getCardsByIds([BEAR.id, 'never-seen'])
    expect(found.size).toBe(1)
  })
})

describe('getCardsByIds', () => {
  it('chunks requests at the 75-identifier limit', async () => {
    const ids = Array.from({ length: 160 }, (_, i) => `card-${i}`)
    const fetchMock = vi.fn(async (_url, opts) => {
      const identifiers = JSON.parse(opts.body).identifiers
      expect(identifiers.length).toBeLessThanOrEqual(75)
      return ok({ data: identifiers.map(({ id }) => ({ ...BEAR, id })) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const found = await getCardsByIds(ids)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 75 + 75 + 10
    expect(found.size).toBe(160)
  }, 10000)

  it('skips the network entirely when everything is cached', async () => {
    await putCards([BEAR, COUNTERSPELL])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const found = await getCardsByIds([BEAR.id, COUNTERSPELL.id])
    expect(found.size).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates ids before asking', async () => {
    const fetchMock = vi.fn(async (_url, opts) => {
      expect(JSON.parse(opts.body).identifiers).toHaveLength(1)
      return ok({ data: [BEAR] })
    })
    vi.stubGlobal('fetch', fetchMock)
    await getCardsByIds([BEAR.id, BEAR.id, BEAR.id])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('rulings and autocomplete', () => {
  it('caches rulings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: [{ comment: 'A ruling.' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await getRulings(BEAR.id)
    await getRulings(BEAR.id)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not autocomplete on a single character', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await autocomplete('a')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('cache pinning and eviction', () => {
  it('evicts stale unpinned cards but keeps pinned ones', async () => {
    await putCards([BEAR])
    await putCards([COUNTERSPELL])
    await pinCards([COUNTERSPELL.id])

    // Age both entries past the TTL.
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('mtg-companion', 1)
      r.onsuccess = () => resolve(r.result)
    })
    await new Promise((resolve) => {
      const store = db.transaction('cards', 'readwrite').objectStore('cards')
      const all = store.getAll()
      all.onsuccess = () => {
        for (const record of all.result) {
          store.put({ ...record, fetchedAt: Date.now() - CARD_TTL_MS - 1000 })
        }
        resolve()
      }
    })

    const removed = await evictStale()
    expect(removed).toBe(1)
    expect(await getCard(BEAR.id)).toBeNull()
    expect(await getCard(COUNTERSPELL.id)).toBeTruthy()
  })

  it('does not unpin a card just because a search also returned it', async () => {
    await putCards([BEAR], { pinned: true })
    await putCards([BEAR], { pinned: false })
    const record = await getCard(BEAR.id)
    expect(record.pinned).toBe(true)
  })
})
