import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearCache, putCards, getCard, pinCards, evictStale, CARD_TTL_MS } from '../src/lib/cache.js'
import {
  searchCards, getCardById, getCardsByIds, getCardsByNames, getRulings, autocomplete,
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
  // Real backoff is 2s/4s/8s/16s. Shrink it so the retry paths are exercised
  // in milliseconds — the logic under test is the retry decision, not the wait.
  __internals.setBackoffBase(1)
  // And the same for the 429 lockout, which is a real thirty seconds. Left
  // alone it stalls the shared queue and every later test times out behind it.
  __internals.setLockoutMs(1)
  // A background failure in one test pauses the background lane for minutes;
  // each test starts with it open.
  __internals.resumeBackground()
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
    // A 429 gets one retry, not four: the other three would land inside the
    // thirty seconds Scryfall has already shut us out for.
    expect(fetchMock).toHaveBeenCalledTimes(__internals.MAX_LOCKOUT_RETRIES + 1)
  })

  it('waits out the lockout after a 429 rather than backing off exponentially', async () => {
    const previous = __internals.setLockoutMs(120)
    const times = []
    vi.stubGlobal('fetch', vi.fn(async () => { times.push(Date.now()); return fail(429) }))
    await expect(searchCards('bears')).rejects.toThrow(ScryfallError)
    __internals.setLockoutMs(previous)

    expect(times).toHaveLength(__internals.MAX_LOCKOUT_RETRIES + 1)
    // The backoff base is 1ms here, so anything near the lockout can only have
    // come from the lockout.
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(100)
  }, 10000)

  it('honours Retry-After when Scryfall sends one, in place of the lockout', async () => {
    const previous = __internals.setLockoutMs(10000)
    const times = []
    vi.stubGlobal('fetch', vi.fn(async () => {
      times.push(Date.now())
      return { ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '0.05' : null) }, json: async () => ({}) }
    }))
    await expect(searchCards('bears')).rejects.toThrow(ScryfallError)
    __internals.setLockoutMs(previous)

    expect(times).toHaveLength(__internals.MAX_LOCKOUT_RETRIES + 1)
    // Fifty milliseconds asked for, ten seconds not asked for.
    expect(times[1] - times[0]).toBeLessThan(2000)
  }, 10000)

  it('backs off exponentially rather than hammering', async () => {
    // The rule and the count, not the clock: this timed the gaps between
    // requests and failed twice on a loaded machine while the rule it guards
    // never moved. The wait doubles per attempt, and a Scryfall that keeps
    // failing is asked a bounded number of times and then let alone.
    const previous = __internals.setBackoffBase(20)
    const { backoffFor, MAX_RETRIES } = __internals
    expect(backoffFor(0)).toBe(20)
    expect(backoffFor(1)).toBe(40)
    expect(backoffFor(2)).toBe(80)

    const fetchMock = vi.fn(async () => fail(503))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchCards('bears')).rejects.toThrow()
    __internals.setBackoffBase(previous)
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1)
  }, 10000)

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
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(__internals.SLOW_INTERVAL_MS - 15)
    }
  }, 10000)

  it('holds search, named, random and collection to two a second and the rest to ten', () => {
    const { spacingFor, SLOW_INTERVAL_MS, MIN_INTERVAL_MS } = __internals
    expect(spacingFor('/cards/search?q=bear')).toBe(SLOW_INTERVAL_MS)
    expect(spacingFor('/cards/named?exact=Bear')).toBe(SLOW_INTERVAL_MS)
    expect(spacingFor('/cards/random')).toBe(SLOW_INTERVAL_MS)
    expect(spacingFor('/cards/collection')).toBe(SLOW_INTERVAL_MS)
    expect(spacingFor('/cards/autocomplete?q=be')).toBe(MIN_INTERVAL_MS)
    expect(spacingFor('/cards/abc-123')).toBe(MIN_INTERVAL_MS)
    expect(spacingFor('/cards/abc-123/rulings')).toBe(MIN_INTERVAL_MS)
    expect(spacingFor('/sets')).toBe(MIN_INTERVAL_MS)
  })
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

describe('getCardsByNames', () => {
  const collection = (data, not_found = []) => ok({ object: 'list', data, not_found })
  const printing = (card, set, collector_number) => ({ ...card, id: `${card.id}-${set}-${collector_number}`, set, collector_number })

  it('asks for a named printing by set and collector number, and gets that printing', async () => {
    const wanted = printing(BEAR, 'c21', '263')
    const fetchMock = vi.fn().mockResolvedValueOnce(collection([wanted]))
    vi.stubGlobal('fetch', fetchMock)
    const found = await getCardsByNames([{ name: BEAR.name, set: 'C21', number: '263' }])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.identifiers).toEqual([{ set: 'c21', collector_number: '263' }])
    expect(found.get(BEAR.name).id).toBe(wanted.id)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the name, in bulk, when Scryfall does not know the printing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(collection([], [{ set: 'soc', collector_number: '235' }]))
      .mockResolvedValueOnce(collection([BEAR]))
    vi.stubGlobal('fetch', fetchMock)
    const found = await getCardsByNames([{ name: BEAR.name, set: 'soc', number: '235' }])
    expect(found.get(BEAR.name).id).toBe(BEAR.id)
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second.identifiers).toEqual([{ name: BEAR.name }])
    expect(fetchMock.mock.calls.every(([url]) => /\/cards\/collection$/.test(url))).toBe(true)
  })

  it('mixes named printings and bare names in the same import', async () => {
    const withPrinting = printing(COUNTERSPELL, 'mh2', '267')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(collection([withPrinting]))
      .mockResolvedValueOnce(collection([BEAR]))
    vi.stubGlobal('fetch', fetchMock)
    const found = await getCardsByNames([BEAR.name, { name: COUNTERSPELL.name, set: 'mh2', number: '267' }])
    expect(found.get(COUNTERSPELL.name).id).toBe(withPrinting.id)
    expect(found.get(BEAR.name).id).toBe(BEAR.id)
  })

  it('reports the slow path by name count, so the caller can show which name it is on', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(collection([], [{ name: 'Nope One' }, { name: 'Nope Two' }]))
      .mockResolvedValueOnce(fail(404, { details: 'not found' }))
      .mockResolvedValueOnce(ok(BEAR))
    vi.stubGlobal('fetch', fetchMock)
    const stages = []
    const found = await getCardsByNames(['Nope One', 'Nope Two'], {
      onProgress: (done, total, stage) => stages.push([done, total, stage]),
    })
    expect(found.has('Nope One')).toBe(false)
    expect(found.get('Nope Two')).toBeTruthy()
    expect(stages.filter(([, , s]) => s === 'single')).toEqual([[0, 2, 'single'], [1, 2, 'single'], [2, 2, 'single']])
    expect(stages.at(-1)).toEqual([2, 2, 'single'])
  })
})
