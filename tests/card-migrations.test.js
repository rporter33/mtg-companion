import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearCache, getCardRecords, getQuery, QUERY_TTL_MS } from '../src/lib/cache.js'
import { getCardRecordsByIds, migrationsFor, __internals } from '../src/lib/scryfall.js'
import {
  indexMigrations, migrationFor, movedNote, goneNote, movedTableNote, goneTableNote, MIGRATIONS_KEY,
} from '../src/lib/card-migrations.js'
import { legalEverywhere } from './fixtures.js'

/**
 * Following Scryfall when it stops having a printing.
 *
 * Scryfall merges or deletes ids — most often preview printings, which is what
 * a deck built during a spoiler season holds. The app asks /migrations about an
 * id only when Scryfall has just said, in a collection call's not_found, that it
 * has no card for it; it follows a merge, and leaves a deletion alone.
 *
 * The objects here are shaped as api.scryfall.com/migrations?page=1 answered on
 * 2026-09-23, and every time is passed in, so this means the same on any day.
 */

const HOUR = 60 * 60 * 1000
const at = (iso) => Date.parse(iso)
const NOW = at('2026-09-23T12:00:00Z')

// The preview printing a deck holds, and the record Scryfall merged it into.
const PREVIEW = { id: 'preview-scholar', name: 'Fractured Scholar', set: 'fra', collector_number: '53' }
const MERGED = legalEverywhere({ id: 'merged-scholar', name: 'Fractured Scholar', set: 'fra', collector_number: '53' })
const KEPT = legalEverywhere({ id: 'kept-bear', name: 'Grizzly Bears', set: 'hob', collector_number: '12' })
const DELETED = { id: 'deleted-beast', name: 'Beast' }

const migration = (over) => ({
  object: 'migration',
  id: `mig-${over.old_scryfall_id}`,
  uri: `https://api.scryfall.com/migrations/mig-${over.old_scryfall_id}`,
  performed_at: '2026-09-23',
  ...over,
})

const PAGE = {
  object: 'list',
  has_more: true,
  next_page: 'https://api.scryfall.com/migrations?page=2',
  data: [
    migration({ migration_strategy: 'merge', old_scryfall_id: PREVIEW.id, new_scryfall_id: MERGED.id, note: 'Duplicate preview' }),
    migration({ migration_strategy: 'delete', old_scryfall_id: DELETED.id, performed_at: '2026-09-18', note: 'Mapped to wrong Beast' }),
  ],
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })
const fail = (status) => ({ ok: false, status, json: async () => ({ object: 'error', status }) })

/** Writes cache records exactly as given. */
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

const saved = (card, fetchedAt) => ({ id: card.id, name: card.name, card, fetchedAt, pinned: true })

/**
 * Scryfall answering both endpoints this uses: the collection from `cards`,
 * with everything else listed not_found, and the migrations page from `page`.
 * Every request is recorded in `asked` as its path or the ids it sent.
 */
function scryfall({ cards = [], page = PAGE, migrationsAnswer = null }, asked = []) {
  return vi.fn(async (url, opts = {}) => {
    if (String(url).includes('/migrations')) {
      asked.push('migrations')
      return migrationsAnswer ?? ok(page)
    }
    const identifiers = JSON.parse(opts.body ?? '{}').identifiers ?? []
    asked.push(identifiers.map((i) => i.id))
    const data = identifiers.map((i) => cards.find((c) => c.id === i.id)).filter(Boolean)
    const not_found = identifiers.filter((i) => !cards.some((c) => c.id === i.id))
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

describe('reading Scryfall’s migrations', () => {
  it('reads a page into what became of each id', () => {
    const index = indexMigrations(PAGE)
    expect(index[PREVIEW.id]).toEqual({ strategy: 'merge', newId: MERGED.id, at: '2026-09-23' })
    expect(index[DELETED.id]).toEqual({ strategy: 'delete', at: '2026-09-18' })
    expect(migrationFor(index, PREVIEW.id).newId).toBe(MERGED.id)
    expect(migrationFor(index, 'never-migrated')).toBe(null)
  })

  it('reads whatever shape it is given without throwing', () => {
    expect(indexMigrations(null)).toEqual({})
    expect(indexMigrations({ data: 'nonsense' })).toEqual({})
    expect(indexMigrations({ data: [null, 7, {}, { old_scryfall_id: 5 }] })).toEqual({})
    // A merge with nothing to point at is the deletion it amounts to.
    expect(indexMigrations({ data: [migration({ migration_strategy: 'merge', old_scryfall_id: 'x' })] }))
      .toEqual({ x: { strategy: 'delete', at: '2026-09-23' } })
    // A strategy this build does not know says nothing about the id.
    expect(indexMigrations({ data: [migration({ migration_strategy: 'split', old_scryfall_id: 'y' })] })).toEqual({})
    expect(migrationFor(null, 'x')).toBe(null)
    expect(migrationFor({ x: 'merged' }, 'x')).toBe(null)
    expect(migrationFor({ x: { strategy: 'merge' } }, 'x')).toBe(null)
  })

  it('keeps the newest record of an id migrated more than once', () => {
    const index = indexMigrations({ data: [
      migration({ migration_strategy: 'merge', old_scryfall_id: 'a', new_scryfall_id: 'now', performed_at: '2026-09-23' }),
      migration({ migration_strategy: 'merge', old_scryfall_id: 'a', new_scryfall_id: 'then', performed_at: '2025-01-01' }),
    ] })
    expect(index.a).toEqual({ strategy: 'merge', newId: 'now', at: '2026-09-23' })
  })

  it('follows a chain to the printing that still resolves', () => {
    // One preview record merged into a second in March; that one merged into the
    // released printing in June. Stopping at the first hop hands back an id that
    // no longer resolves either, and the card is then reported gone for good
    // while this very index says where it went.
    const index = indexMigrations({ data: [
      migration({ migration_strategy: 'merge', old_scryfall_id: 'b', new_scryfall_id: 'c', performed_at: '2026-06-01' }),
      migration({ migration_strategy: 'merge', old_scryfall_id: 'a', new_scryfall_id: 'b', performed_at: '2026-03-01' }),
    ] })
    expect(migrationFor(index, 'a')).toEqual({ strategy: 'merge', newId: 'c', at: '2026-06-01' })
    expect(migrationFor(index, 'b')).toEqual({ strategy: 'merge', newId: 'c', at: '2026-06-01' })
  })

  it('reads a chain that ends in a deletion as the deletion it is', () => {
    const index = indexMigrations({ data: [
      migration({ migration_strategy: 'delete', old_scryfall_id: 'b', performed_at: '2026-06-01' }),
      migration({ migration_strategy: 'merge', old_scryfall_id: 'a', new_scryfall_id: 'b', performed_at: '2026-03-01' }),
    ] })
    expect(migrationFor(index, 'a')).toEqual({ strategy: 'delete', at: '2026-06-01' })
  })

  it('does not spin on a chain that loops back on itself', () => {
    const index = { a: { strategy: 'merge', newId: 'b', at: null }, b: { strategy: 'merge', newId: 'a', at: null } }
    expect(migrationFor(index, 'a')).toEqual({ strategy: 'merge', newId: 'b', at: null })
    expect(migrationFor({ a: { strategy: 'merge', newId: 'a', at: null } }, 'a')).toBe(null)
  })
})

describe('what the app says about it', () => {
  it('says what it did and whose word it acted on', () => {
    expect(movedNote([{ name: 'Fractured Scholar' }])).toEqual([
      'Scryfall has replaced its record of Fractured Scholar: this deck now holds its new printing.',
    ])
    expect(movedNote([{ cardId: 'x' }])).toEqual([])
    expect(movedNote(null)).toEqual([])
  })

  it('says a printing is gone under the name the deck kept, and keeps the entry', () => {
    expect(goneNote([{ cardId: 'abcdef1234', name: 'Fractured Scholar' }])[0])
      .toBe('Scryfall no longer has a record of the printing of Fractured Scholar in this deck, so its price and legality cannot be read. The deck keeps it under the name saved with it.')
    expect(goneNote([{ cardId: 'abcdef1234567890', name: null }])[0])
      .toBe("Scryfall no longer has a record of one of this deck's printings (abcdef12), and this device never saved its name.")
  })

  it('says it at the table as what the player is looking at there', () => {
    // Only the editor writes a merge into the deck, so the table says the deck
    // is unchanged rather than substituting a printing without a word.
    expect(movedTableNote([{ name: 'Fractured Scholar' }])[0])
      .toBe('Scryfall has replaced its record of Fractured Scholar: this table is playing its new printing. The deck still holds the old one until you open it in the editor.')
    expect(goneTableNote([{ cardId: 'abcdef1234', name: 'Fractured Scholar' }])[0])
      .toBe("Scryfall no longer has a record of this deck's printing of Fractured Scholar, so its copies are on the table with no painting and no printed face. They are still in the deck, under the name saved with it.")
    // Price and legality, which the deck's own banner mentions, are not what is
    // in front of anybody at a table.
    expect(goneTableNote([{ cardId: 'abcdef1234', name: 'X' }])[0]).not.toMatch(/legality/)
    expect(movedTableNote(null)).toEqual([])
    expect(goneTableNote(null)).toEqual([])
  })
})

describe('what a collection call says was not found', () => {
  it('names the ids Scryfall listed in not_found, and nothing else', async () => {
    // The card that came back is not in it, and neither is a card in the cache
    // that was never asked about.
    const asked = []
    vi.stubGlobal('fetch', scryfall({ cards: [KEPT] }, asked))
    const { records, notFound, failed } = await getCardRecordsByIds([KEPT.id, PREVIEW.id], { now: NOW })
    expect(records.has(KEPT.id)).toBe(true)
    expect(notFound).toEqual([PREVIEW.id])
    expect(failed).toBe(false)
  })

  it('says nothing was not found when the request failed: that is not Scryfall’s word', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(503)))
    const { notFound, failed } = await getCardRecordsByIds([PREVIEW.id], { now: NOW })
    expect(notFound).toEqual([])
    expect(failed).toBe(true)
  })

  it('says nothing was not found for a card the cache already has', async () => {
    await seed([saved(KEPT, NOW - HOUR)])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { notFound } = await getCardRecordsByIds([KEPT.id], { now: NOW })
    expect(notFound).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still says so for an id it was told about lately enough not to ask again', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ cards: [] }, asked))
    const first = await getCardRecordsByIds([PREVIEW.id], { background: true, now: NOW })
    expect(first.notFound).toEqual([PREVIEW.id])
    expect(asked).toEqual([[PREVIEW.id]])
    // An hour on it is not asked about again, and it is still not found.
    const again = await getCardRecordsByIds([PREVIEW.id], { background: true, now: NOW + HOUR })
    expect(again.notFound).toEqual([PREVIEW.id])
    expect(asked).toHaveLength(1)
    // A day on it is asked about again.
    await getCardRecordsByIds([PREVIEW.id], { background: true, now: NOW + QUERY_TTL_MS + 1 })
    expect(asked).toHaveLength(2)
  })
})

describe('migrationsFor', () => {
  it('asks nothing when there is no id to ask about', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await migrationsFor([], { now: NOW })).size).toBe(0)
    expect((await migrationsFor(null, { now: NOW })).size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows a merge: the card at the new id, fetched and kept', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ cards: [MERGED] }, asked))
    const found = await migrationsFor([PREVIEW.id], { now: NOW })
    expect(asked).toEqual(['migrations', [MERGED.id]])
    expect(found.get(PREVIEW.id)).toEqual({
      strategy: 'merge', newId: MERGED.id, at: '2026-09-23', card: MERGED,
    })
    // The replacement is saved and pinned, as a deck card is.
    expect((await getCardRecords([MERGED.id])).get(MERGED.id)).toEqual({ card: MERGED, fetchedAt: NOW })
  })

  it('leaves a deletion alone: nothing to follow, nothing fetched', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ cards: [] }, asked))
    const found = await migrationsFor([DELETED.id], { now: NOW })
    expect(asked).toEqual(['migrations'])
    expect(found.get(DELETED.id)).toEqual({ strategy: 'delete', at: '2026-09-18' })
  })

  it('says nothing about an id Scryfall has no migration for', async () => {
    vi.stubGlobal('fetch', scryfall({ cards: [] }))
    const found = await migrationsFor(['never-migrated'], { now: NOW })
    expect(found.size).toBe(0)
  })

  it('reads the migrations once and keeps them, the way every other query is kept', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ cards: [MERGED] }, asked))
    await migrationsFor([PREVIEW.id], { now: NOW })
    expect(await getQuery(MIGRATIONS_KEY)).toEqual(indexMigrations(PAGE))
    // A second deck opened after it asks nothing: the answer is on the device.
    await migrationsFor([DELETED.id, 'never-migrated'], { now: NOW })
    expect(asked.filter((a) => a === 'migrations')).toHaveLength(1)
  })

  it('leaves everything as it was when the migrations cannot be fetched', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ cards: [MERGED], migrationsAnswer: fail(503) }, asked))
    const found = await migrationsFor([PREVIEW.id], { now: NOW })
    expect(found.size).toBe(0)
    // Nothing was kept, so it is asked again next time rather than never.
    expect(await getQuery(MIGRATIONS_KEY)).toBe(null)
    expect(asked).toEqual(['migrations'])
  })

  it('leaves everything as it was when the replacement card cannot be fetched', async () => {
    const asked = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).includes('/migrations')) { asked.push('migrations'); return ok(PAGE) }
      asked.push(JSON.parse(opts.body).identifiers.map((i) => i.id))
      return fail(503)
    }))
    const found = await migrationsFor([PREVIEW.id, DELETED.id], { now: NOW })
    // The merge is kept with no card on it: nothing to show for it yet, and
    // nothing to rewrite the deck towards. Dropping it instead would be
    // indistinguishable from Scryfall saying nothing, and the caller would then
    // announce as deleted a printing this Map says was merged.
    expect(found.get(PREVIEW.id)).toEqual({ strategy: 'merge', newId: MERGED.id, at: '2026-09-23' })
    expect(found.get(PREVIEW.id).card).toBeUndefined()
    expect(found.get(DELETED.id)?.strategy).toBe('delete')
  })

  it('asks for the replacement in the background lane, so nothing waits on a repair', async () => {
    // Nobody asked for this; a foreground call would get four retries and thirty
    // seconds of backoff while holding the one request queue.
    const lanes = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      lanes.push(String(url).includes('/migrations') ? 'migrations' : JSON.parse(opts.body).identifiers.map((i) => i.id))
      return String(url).includes('/migrations') ? ok(PAGE) : fail(503)
    }))
    await migrationsFor([PREVIEW.id], { now: NOW })
    // One attempt at the replacement, not five.
    expect(lanes).toEqual(['migrations', [MERGED.id]])
  })

  it('asks nothing offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await migrationsFor([PREVIEW.id], { now: NOW })).size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks in the background lane, so nothing the player asked for waits behind it', async () => {
    const lanes = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/migrations')) { lanes.push('migrations'); return ok(PAGE) }
      return ok({ object: 'list', data: [MERGED], not_found: [] })
    }))
    // A background request is asked once and never retried: a 503 here would be
    // one request, which the failure test above shows.
    await migrationsFor([PREVIEW.id], { now: NOW })
    expect(lanes).toEqual(['migrations'])
  })
})
