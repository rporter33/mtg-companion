import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearCache, getCardRecords, CARD_TTL_MS, QUERY_TTL_MS } from '../src/lib/cache.js'
import { refreshDue, dayOf } from '../src/lib/card-refresh.js'
import { justOut, releaseStart } from '../src/lib/release.js'
import { getCardsByIds, getCardRecordsByIds, refreshCards, searchCards, __internals } from '../src/lib/scryfall.js'
import { BEAR, legalEverywhere } from './fixtures.js'

/**
 * Saved cards fetched again, so a deck reads what Scryfall says now.
 *
 * Every time here is fixed and passed in, never read from the clock, so the
 * suite means the same before Reality Fracture's release on 2 Oct 2026, after
 * it, and for years after. The cards are shaped as Scryfall sent Reality
 * Fracture before release: a new card not_legal everywhere.
 */

const HOUR = 60 * 60 * 1000
const at = (iso) => Date.parse(iso)
const LONG_AGO = at('2026-01-01T00:00:00Z')

const FRA = {
  id: 'fra-scholar', name: 'Fractured Scholar', set: 'fra', released_at: '2026-10-02',
  legalities: { standard: 'not_legal', commander: 'not_legal', future: 'legal' },
}
const FRA_OUT = { ...FRA, legalities: { standard: 'legal', commander: 'legal', future: 'legal' } }
// The Hobbit, out since 14 Aug 2026.
const HOB = legalEverywhere({ id: 'hob-card', name: 'Hobbit Card', set: 'hob', released_at: '2026-08-14' })

const record = (card, fetchedAt) => ({ card, fetchedAt })

describe('refreshDue', () => {
  const SAVED = at('2026-09-30T12:00:00Z')

  it('leaves a record alone while its card is not out and it is under a week old', () => {
    expect(refreshDue(record(FRA, SAVED), at('2026-10-01T12:00:00Z'))).toBe(false)
    expect(refreshDue(record(FRA, SAVED), at('2026-10-01T23:59:59Z'))).toBe(false)
  })

  it("asks again just after midnight UTC on release day, for a record from before it", () => {
    expect(refreshDue(record(FRA, SAVED), at('2026-10-02T00:05:00Z'))).toBe(true)
    expect(refreshDue(record(FRA, at('2026-10-01T23:59:00Z')), at('2026-10-02T00:05:00Z'))).toBe(true)
  })

  it('does not ask again within a day of a fetch made on release day', () => {
    const fetched = at('2026-10-02T00:01:00Z')
    expect(refreshDue(record(FRA, fetched), at('2026-10-02T00:05:00Z'))).toBe(false)
    expect(refreshDue(record(FRA, fetched), at('2026-10-02T23:00:00Z'))).toBe(false)
  })

  it('asks daily in the week after release, since when Scryfall settles a new set is not known', () => {
    expect(refreshDue(record(FRA, at('2026-10-02T00:01:00Z')), at('2026-10-03T00:30:00Z'))).toBe(true)
    expect(refreshDue(record(FRA, at('2026-10-03T00:10:00Z')), at('2026-10-03T00:30:00Z'))).toBe(false)
    expect(refreshDue(record(FRA, at('2026-10-07T12:00:00Z')), at('2026-10-08T13:00:00Z'))).toBe(true)
  })

  it('goes back to weekly once the week after release is over', () => {
    // A day and a half old, eight and a half days after release: not due.
    expect(refreshDue(record(FRA, at('2026-10-09T00:00:00Z')), at('2026-10-10T12:00:00Z'))).toBe(false)
    // Older than a week: due, as any record is.
    expect(refreshDue(record(FRA, at('2026-10-02T12:00:00Z')), at('2026-10-10T12:00:00Z'))).toBe(true)
  })

  it('asks about any record older than a week, released long ago or not at all', () => {
    const now = at('2026-10-02T00:30:00Z')
    expect(refreshDue(record(HOB, now - CARD_TTL_MS - 1), now)).toBe(true)
    expect(refreshDue(record(HOB, now - CARD_TTL_MS + HOUR), now)).toBe(false)
    expect(refreshDue(record(BEAR, now - CARD_TTL_MS - 1), now)).toBe(true)
    expect(refreshDue(record(BEAR, now - HOUR), now)).toBe(false)
  })

  it('reads a record with no readable fetchedAt as old, as an older build may have left it', () => {
    const now = at('2026-10-02T00:30:00Z')
    expect(refreshDue({ card: HOB }, now)).toBe(true)
    expect(refreshDue({ card: HOB, fetchedAt: 'yesterday' }, now)).toBe(true)
    expect(refreshDue({ card: HOB, fetchedAt: null }, now)).toBe(true)
    expect(refreshDue(null, now)).toBe(true)
    // A fetch after "now" only a clock set back can produce: asked once more.
    expect(refreshDue(record(HOB, now + HOUR), now)).toBe(true)
  })

  it('does not trip over a card with no readable release date', () => {
    const now = at('2026-10-02T00:30:00Z')
    expect(refreshDue(record({ ...FRA, released_at: 'soon' }, at('2026-09-30T12:00:00Z')), now)).toBe(false)
    expect(refreshDue(record({ id: 'x' }, now - HOUR), now)).toBe(false)
  })

  it("takes today's date separately when it is given", () => {
    // A day given as still before release: nothing about release applies.
    expect(refreshDue(record(FRA, at('2026-09-30T12:00:00Z')), at('2026-10-02T00:30:00Z'), '2026-10-01')).toBe(false)
    expect(dayOf(at('2026-10-02T00:30:00Z'))).toBe('2026-10-02')
    expect(dayOf(NaN)).toBe('')
  })

  it('agrees with the legality grace on when the week after release ends', () => {
    expect(releaseStart(FRA)).toBe(at('2026-10-02T00:00:00Z'))
    expect(releaseStart({ released_at: 'soon' })).toBeNull()
    expect(justOut(FRA, '2026-10-01')).toBe(false)
    expect(justOut(FRA, '2026-10-02')).toBe(true)
    expect(justOut(FRA, '2026-10-08')).toBe(true)
    expect(justOut(FRA, '2026-10-09')).toBe(false)
    expect(justOut(FRA, 'nonsense')).toBe(false)
    // The daily refresh ends at the same moment, midnight UTC on 9 Oct: a
    // record a day and more old, and under a week, fetched after release
    // began, is due half an hour before it and not half an hour after.
    expect(refreshDue(record(FRA, at('2026-10-07T20:00:00Z')), at('2026-10-08T23:30:00Z'))).toBe(true)
    expect(refreshDue(record(FRA, at('2026-10-08T00:00:00Z')), at('2026-10-09T00:30:00Z'))).toBe(false)
  })

  it('leaves a record Scryfall lately said it has no card for until a week has passed', () => {
    const now = at('2026-10-02T00:30:00Z')
    // Old enough, and from before release: due, but for the note.
    const gone = (checkedAt) => ({ ...record(FRA, at('2026-09-01T00:00:00Z')), checkedAt })
    expect(refreshDue(gone(now - HOUR), now)).toBe(false)
    expect(refreshDue(gone(now - 6 * 24 * HOUR), now)).toBe(false)
    expect(refreshDue(gone(now - CARD_TTL_MS - 1), now)).toBe(true)
    // A note that is not a time, or is after now, counts for nothing.
    expect(refreshDue(gone('yesterday'), now)).toBe(true)
    expect(refreshDue(gone(now + HOUR), now)).toBe(true)
  })
})

// --- the cache and the network ---------------------------------------------

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })
const fail = (status) => ({ ok: false, status, json: async () => ({ object: 'error', status }) })

/** Writes cache records exactly as given, the way an older build may have. */
async function seed(records) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('mtg-companion', 1)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction('cards', 'readwrite')
    for (const r of records) tx.objectStore('cards').put(r)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

const saved = (card, fetchedAt, pinned = true) => ({ id: card.id, name: card.name, card, fetchedAt, pinned })

/** A collection endpoint that answers each id from `cards`, and lists the rest as not found. */
function collectionFrom(cards, calls = []) {
  return vi.fn(async (url, opts) => {
    const identifiers = JSON.parse(opts.body).identifiers
    calls.push(identifiers.map((i) => i.id))
    const data = []
    const not_found = []
    for (const identifier of identifiers) {
      const card = cards.find((c) => c.id === identifier.id)
      if (card) data.push(card)
      else not_found.push(identifier)
    }
    return ok({ object: 'list', data, not_found })
  })
}

beforeEach(async () => {
  await clearCache()
  vi.stubGlobal('navigator', { onLine: true })
  __internals.setBackoffBase(1)
  __internals.setLockoutMs(1)
  __internals.resumeBackground()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getCardRecords', () => {
  it('returns each record with when it was fetched, and a missing time as null', async () => {
    await seed([
      saved(FRA, at('2026-09-30T12:00:00Z')),
      { id: HOB.id, name: HOB.name, card: HOB, pinned: true },
      { id: 'no-card', name: 'Nothing', fetchedAt: 1, pinned: true },
    ])
    const records = await getCardRecords([FRA.id, HOB.id, 'no-card', 'never-seen'])
    expect(records.get(FRA.id)).toEqual({ card: FRA, fetchedAt: at('2026-09-30T12:00:00Z') })
    expect(records.get(HOB.id)).toEqual({ card: HOB, fetchedAt: null })
    expect(records.has('no-card')).toBe(false)
    expect(records.has('never-seen')).toBe(false)
  })
})

describe('getCardsByIds with refresh', () => {
  const RELEASE_NIGHT = at('2026-10-02T00:30:00Z')

  it('leaves the default as it was: cached records are returned, however old', async () => {
    await seed([saved(FRA, at('2026-01-01T00:00:00Z')), { id: HOB.id, name: HOB.name, card: HOB, pinned: true }])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const found = await getCardsByIds([FRA.id, HOB.id])
    expect(found.get(FRA.id).legalities.standard).toBe('not_legal')
    expect(found.size).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the due records again by id, and what comes back replaces them, still pinned', async () => {
    await seed([saved(FRA, at('2026-09-30T12:00:00Z')), saved(HOB, RELEASE_NIGHT - HOUR)])
    const calls = []
    vi.stubGlobal('fetch', collectionFrom([FRA_OUT, HOB], calls))

    const found = await getCardsByIds([FRA.id, HOB.id], { refresh: true, now: RELEASE_NIGHT })
    // Only the Reality Fracture card was due: saved before its release day.
    expect(calls).toEqual([[FRA.id]])
    expect(found.get(FRA.id).legalities.standard).toBe('legal')
    expect(found.get(HOB.id)).toEqual(HOB)

    const records = await getCardRecords([FRA.id])
    expect(records.get(FRA.id)).toEqual({ card: FRA_OUT, fetchedAt: RELEASE_NIGHT })
    const raw = await rawRecord(FRA.id)
    expect(raw.pinned).toBe(true)

    // Fetched now, so not due again tonight.
    await getCardsByIds([FRA.id, HOB.id], { refresh: true, now: RELEASE_NIGHT + HOUR })
    expect(calls).toHaveLength(1)
  })

  it('asks in batches of 75 identifiers', async () => {
    const cards = Array.from({ length: 160 }, (_, i) => ({ ...BEAR, id: `bear-${i}` }))
    await seed(cards.map((c) => saved(c, LONG_AGO)))
    const calls = []
    vi.stubGlobal('fetch', collectionFrom(cards, calls))
    const found = await getCardsByIds(cards.map((c) => c.id), { refresh: true, now: RELEASE_NIGHT })
    expect(calls.map((ids) => ids.length)).toEqual([75, 75, 10])
    expect(found.size).toBe(160)
  }, 10000)

  it('keeps the cached copy of an id Scryfall no longer finds, and does not ask again for a week', async () => {
    await seed([saved(FRA, at('2026-09-30T12:00:00Z'))])
    const calls = []
    vi.stubGlobal('fetch', collectionFrom([], calls))

    const first = await getCardsByIds([FRA.id], { refresh: true, now: RELEASE_NIGHT })
    expect(calls).toEqual([[FRA.id]])
    expect(first.get(FRA.id)).toEqual(FRA)
    // The record is kept as it was, with a note of when Scryfall said so.
    expect((await getCardRecords([FRA.id])).get(FRA.id))
      .toEqual({ card: FRA, fetchedAt: at('2026-09-30T12:00:00Z'), checkedAt: RELEASE_NIGHT })

    // Still due by its age, but Scryfall said it has nothing: not asked, a
    // day on or six.
    for (const later of [12 * HOUR, QUERY_TTL_MS + 1, 6 * QUERY_TTL_MS]) {
      await getCardsByIds([FRA.id], { refresh: true, now: RELEASE_NIGHT + later })
    }
    expect(calls).toHaveLength(1)

    // A week on, it is asked about again, as any record is.
    await getCardsByIds([FRA.id], { refresh: true, now: RELEASE_NIGHT + CARD_TTL_MS + 1 })
    expect(calls).toHaveLength(2)
  })

  it('remembers a missing id Scryfall does not find, for the refresh, while the default asks as before', async () => {
    const calls = []
    vi.stubGlobal('fetch', collectionFrom([], calls))
    expect((await getCardsByIds(['gone'], { refresh: true, now: RELEASE_NIGHT })).size).toBe(0)
    expect(calls).toEqual([['gone']])
    await getCardsByIds(['gone'], { refresh: true, now: RELEASE_NIGHT + HOUR })
    expect(calls).toHaveLength(1)
    await getCardsByIds(['gone'])
    expect(calls).toHaveLength(2)
  })

  it('keeps every cached copy when a request fails, and does not send the batches after it', async () => {
    const cards = Array.from({ length: 80 }, (_, i) => ({ ...FRA, id: `fra-${i}` }))
    await seed(cards.map((c) => saved(c, at('2026-09-30T12:00:00Z'))))
    const fetchMock = vi.fn().mockResolvedValue(fail(503))
    vi.stubGlobal('fetch', fetchMock)
    const found = await getCardsByIds(cards.map((c) => c.id), { refresh: true, now: RELEASE_NIGHT })
    expect(found.size).toBe(80)
    expect(found.get('fra-0').legalities.standard).toBe('not_legal')
    // The refresh is background, asked once: no retries, no second batch.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns the cache and asks nothing offline', async () => {
    await seed([saved(FRA, at('2026-09-30T12:00:00Z'))])
    vi.stubGlobal('navigator', { onLine: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const found = await getCardsByIds([FRA.id, 'never-seen'], { refresh: true, now: RELEASE_NIGHT })
    expect(found.get(FRA.id)).toEqual(FRA)
    expect(found.size).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await refreshCards([FRA.id], { now: RELEASE_NIGHT })).size).toBe(0)
  })

  it('fetches missing ids as before, alongside the refresh', async () => {
    await seed([saved(FRA, at('2026-09-30T12:00:00Z'))])
    const calls = []
    vi.stubGlobal('fetch', collectionFrom([FRA_OUT, HOB], calls))
    const found = await getCardsByIds([FRA.id, HOB.id], { refresh: true, now: RELEASE_NIGHT })
    expect(calls).toEqual([[HOB.id], [FRA.id]])
    expect(found.get(HOB.id)).toEqual(HOB)
    expect(found.get(FRA.id)).toEqual(FRA_OUT)
  }, 10000)

  it('does not refresh after fetching the missing ids has failed, and says it failed', async () => {
    await seed([saved(FRA, at('2026-09-30T12:00:00Z'))])
    const fetchMock = vi.fn().mockResolvedValue(fail(503))
    vi.stubGlobal('fetch', fetchMock)
    const { records, failed } = await getCardRecordsByIds([FRA.id, HOB.id], { refresh: true, background: true, now: RELEASE_NIGHT })
    // One request, for the missing card; the due one is not asked about.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(failed).toBe(true)
    expect(records.get(FRA.id)).toEqual({ card: FRA, fetchedAt: at('2026-09-30T12:00:00Z') })
    expect(records.has(HOB.id)).toBe(false)
  })

  it('gives each record with when it was fetched: then for the cache, now for what it fetched', async () => {
    await seed([saved(FRA, at('2026-09-30T12:00:00Z')), saved(BEAR, RELEASE_NIGHT - HOUR)])
    vi.stubGlobal('fetch', collectionFrom([FRA_OUT, HOB]))
    const { records, failed } = await getCardRecordsByIds([FRA.id, HOB.id, BEAR.id], { refresh: true, now: RELEASE_NIGHT })
    expect(failed).toBe(false)
    expect(records.get(FRA.id)).toEqual({ card: FRA_OUT, fetchedAt: RELEASE_NIGHT })
    expect(records.get(HOB.id)).toEqual({ card: HOB, fetchedAt: RELEASE_NIGHT })
    expect(records.get(BEAR.id)).toEqual({ card: BEAR, fetchedAt: RELEASE_NIGHT - HOUR })
  }, 10000)
})

describe('refreshCards', () => {
  it('returns only the cards that came back, so a screen can tell if anything is new', async () => {
    const now = at('2026-10-03T00:30:00Z')
    await seed([saved(FRA, at('2026-10-02T00:01:00Z')), saved(HOB, now - HOUR)])
    vi.stubGlobal('fetch', collectionFrom([FRA_OUT, HOB]))
    const fresh = await refreshCards([FRA.id, HOB.id, 'never-seen'], { now })
    expect([...fresh.keys()]).toEqual([FRA.id])
    expect(fresh.get(FRA.id)).toEqual(FRA_OUT)
  })

  it('does not take a card sent under an id it did not ask for', async () => {
    const now = at('2026-10-03T00:30:00Z')
    await seed([saved(FRA, at('2026-09-01T00:00:00Z'))])
    vi.stubGlobal('fetch', vi.fn(async () => ok({ object: 'list', data: [{ ...FRA_OUT, id: 'someone-else' }], not_found: [] })))
    const fresh = await refreshCards([FRA.id], { now })
    expect(fresh.size).toBe(0)
    expect((await getCardRecords(['someone-else'])).size).toBe(0)
  })

  it('fills a batch with room in it with records not due yet, oldest first, so they fall due together again', async () => {
    const now = at('2026-10-20T12:00:00Z')
    const bears = (n, from) => Array.from({ length: n }, (_, i) => ({ ...BEAR, id: `bear-${from + i}` }))
    const due = bears(70, 0)
    const older = bears(4, 100)       // three days old: not due, the oldest
    const newer = bears(4, 200)       // two days old: not due
    const today = bears(3, 300)       // an hour old: never taken to fill a batch
    const gone = bears(1, 400)        // three days old, but lately found missing
    await seed([
      ...due.map((c) => saved(c, now - CARD_TTL_MS - HOUR)),
      ...older.map((c) => saved(c, now - 3 * QUERY_TTL_MS)),
      ...newer.map((c) => saved(c, now - 2 * QUERY_TTL_MS)),
      ...today.map((c) => saved(c, now - HOUR)),
      ...gone.map((c) => ({ ...saved(c, now - 3 * QUERY_TTL_MS), checkedAt: now - QUERY_TTL_MS })),
    ])
    const all = [...due, ...older, ...newer, ...today, ...gone]
    const calls = []
    vi.stubGlobal('fetch', collectionFrom(all, calls))
    const fresh = await refreshCards(all.map((c) => c.id), { now })

    // One request of 75: the 70 due, then the four oldest, then one of the next.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(75)
    const asked = new Set(calls[0])
    expect(due.every((c) => asked.has(c.id))).toBe(true)
    expect(older.every((c) => asked.has(c.id))).toBe(true)
    expect(newer.filter((c) => asked.has(c.id))).toHaveLength(1)
    expect(today.some((c) => asked.has(c.id)) || gone.some((c) => asked.has(c.id))).toBe(false)
    expect(fresh.size).toBe(75)
  })

  it('sends nothing to fill a batch when nothing is due', async () => {
    const now = at('2026-10-20T12:00:00Z')
    await seed([saved(HOB, now - 3 * QUERY_TTL_MS)])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await refreshCards([HOB.id], { now })).size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('works from records it is given, without reading the cache again', async () => {
    const now = at('2026-10-03T00:30:00Z')
    // The cache holds nothing; the records given say FRA is due.
    const calls = []
    vi.stubGlobal('fetch', collectionFrom([FRA_OUT], calls))
    const records = new Map([[FRA.id, record(FRA, at('2026-10-02T00:01:00Z'))], [HOB.id, record(HOB, now - HOUR)]])
    const fresh = await refreshCards([FRA.id, 'not-given'], { now, records })
    expect(calls).toEqual([[FRA.id]])
    expect(fresh.get(FRA.id)).toEqual(FRA_OUT)
  })
})

describe('the background lane', () => {
  it('lets a foreground request queued after background ones go first', async () => {
    const { enqueue } = __internals
    const order = []
    let open
    const gate = new Promise((resolve) => { open = resolve })
    const running = enqueue(async () => { order.push('under way'); await gate }, 0)
    const b1 = enqueue(async () => { order.push('background 1') }, 0, { background: true })
    const b2 = enqueue(async () => { order.push('background 2') }, 0, { background: true })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const f1 = enqueue(async () => { order.push('foreground') }, 0)
    open()
    await Promise.all([running, b1, b2, f1])
    expect(order).toEqual(['under way', 'foreground', 'background 1', 'background 2'])
  })

  it('sends a search asked for behind a refresh before the refresh', async () => {
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      urls.push(new URL(url).pathname)
      return ok({ object: 'list', data: [], not_found: [], total_cards: 0, has_more: false })
    }))
    const { request } = __internals
    const body = { identifiers: [{ id: 'x' }] }
    const refreshes = [
      request('/cards/collection', { method: 'POST', body, background: true }),
      request('/cards/collection', { method: 'POST', body, background: true }),
    ]
    const search = request('/cards/search?q=bears')
    await Promise.all([...refreshes, search])
    expect(urls).toEqual(['/cards/search', '/cards/collection', '/cards/collection'])
  }, 10000)

  it('sends a search made while a refresh is under way next, not after the whole refresh', async () => {
    const cards = Array.from({ length: 150 }, (_, i) => ({ ...FRA, id: `fra-${i}` }))
    await seed(cards.map((c) => saved(c, LONG_AGO)))
    const urls = []
    let answered = 0
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      urls.push(new URL(url).pathname)
      if (opts?.body) {
        answered++
        const ids = JSON.parse(opts.body).identifiers.map((i) => i.id)
        return ok({ object: 'list', data: cards.filter((c) => ids.includes(c.id)), not_found: [] })
      }
      return ok({ object: 'list', data: [], total_cards: 0, has_more: false })
    }))
    // Two decks' refreshes at once, as the deck editor and the launch watch
    // can be: each has a batch in the background lane.
    const refreshing = Promise.all([
      refreshCards(cards.slice(0, 75).map((c) => c.id), { now: at('2026-10-02T00:30:00Z') }),
      refreshCards(cards.slice(75).map((c) => c.id), { now: at('2026-10-02T00:30:00Z') }),
    ])
    while (!answered) await new Promise((resolve) => setTimeout(resolve, 5))
    const search = searchCards('bears')
    await Promise.all([refreshing, search])
    expect(urls).toEqual(['/cards/collection', '/cards/search', '/cards/collection'])
  }, 10000)

  it('asks a background request once, where a foreground one is retried', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(503))
    vi.stubGlobal('fetch', fetchMock)
    const { request } = __internals
    await expect(request('/cards/abc', { background: true })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(request('/cards/abc')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1 + __internals.MAX_RETRIES + 1)
  }, 10000)

  it('waits out a lockout before the line moves on, without asking again', async () => {
    const previous = __internals.setLockoutMs(120)
    const fetchMock = vi.fn().mockResolvedValue(fail(429))
    vi.stubGlobal('fetch', fetchMock)
    const started = Date.now()
    await expect(__internals.request('/cards/abc', { background: true })).rejects.toThrow(/rate limiting/)
    __internals.setLockoutMs(previous)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  }, 10000)

  it('drops a request whose caller has gone without sending it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    await expect(__internals.request('/cards/abc', { signal: controller.signal, background: true }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("the background lane's pause", () => {
  it('after a 5xx, sends no background request for a few minutes, while a foreground one still goes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(503))
    vi.stubGlobal('fetch', fetchMock)
    const { request } = __internals
    await expect(request('/cards/abc', { background: true })).rejects.toThrow(/having trouble/)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Refused at once, unsent.
    await expect(request('/cards/abc', { background: true })).rejects.toMatchObject({ code: 'background_paused' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Somebody waiting on a request is never held back by it.
    fetchMock.mockResolvedValue(ok({ object: 'card', id: 'abc' }))
    await expect(request('/cards/abc')).resolves.toMatchObject({ id: 'abc' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(__internals.BACKGROUND_PAUSE_MS).toBeGreaterThanOrEqual(60 * 1000)
  })

  it('after a failure to reach Scryfall at all, pauses the same way', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(__internals.request('/cards/abc', { background: true })).rejects.toThrow()
    await expect(__internals.request('/cards/abc', { background: true })).rejects.toMatchObject({ code: 'background_paused' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('after a 429, pauses for the lockout, and asks again once it is over', async () => {
    const previous = __internals.setLockoutMs(150)
    try {
      const fetchMock = vi.fn().mockResolvedValue(fail(429))
      vi.stubGlobal('fetch', fetchMock)
      const { request } = __internals
      // The second is made while the first waits out the lockout: not sent.
      const first = request('/cards/abc', { background: true })
      while (!fetchMock.mock.calls.length) await new Promise((resolve) => setTimeout(resolve, 5))
      await expect(request('/cards/abc', { background: true })).rejects.toMatchObject({ code: 'background_paused' })
      await expect(first).rejects.toThrow(/rate limiting/)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await new Promise((resolve) => setTimeout(resolve, 60))
      fetchMock.mockResolvedValue(ok({ object: 'card', id: 'abc' }))
      await expect(request('/cards/abc', { background: true })).resolves.toMatchObject({ id: 'abc' })
    } finally {
      __internals.setLockoutMs(previous)
    }
  }, 10000)

  it('does not pause for an answer: a 404 is Scryfall saying it has no such card', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(404))
    vi.stubGlobal('fetch', fetchMock)
    await expect(__internals.request('/cards/abc', { background: true })).rejects.toMatchObject({ status: 404 })
    await expect(__internals.request('/cards/abc', { background: true })).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops a refresh at its first failure, and a second refresh meanwhile asks nothing', async () => {
    const now = at('2026-10-02T00:30:00Z')
    const cards = Array.from({ length: 160 }, (_, i) => ({ ...FRA, id: `fra-${i}` }))
    await seed(cards.map((c) => saved(c, at('2026-09-30T12:00:00Z'))))
    const fetchMock = vi.fn().mockResolvedValue(fail(503))
    vi.stubGlobal('fetch', fetchMock)
    expect((await refreshCards(cards.map((c) => c.id), { now })).size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await refreshCards(cards.map((c) => c.id), { now })).size).toBe(0)
    expect((await getCardsByIds(cards.map((c) => c.id), { refresh: true, now })).size).toBe(160)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

async function rawRecord(id) {
  const db = await new Promise((resolve) => {
    const r = indexedDB.open('mtg-companion', 1)
    r.onsuccess = () => resolve(r.result)
  })
  const value = await new Promise((resolve) => {
    const req = db.transaction('cards', 'readonly').objectStore('cards').get(id)
    req.onsuccess = () => resolve(req.result)
  })
  db.close()
  return value
}
