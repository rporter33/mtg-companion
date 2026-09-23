import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import useDeckCards from '../src/features/decks/useDeckCards.js'
import { clearCache } from '../src/lib/cache.js'
import { createDeck, addCard, stampNames } from '../src/lib/deck.js'
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
    seen.push({ ...useDeckCards(deck) })
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

/**
 * A printing Scryfall no longer has. The deck holds a preview id; Scryfall
 * lists it in not_found, and /migrations says what became of it.
 */
describe('useDeckCards when a printing has gone', () => {
  const PREVIEW = legalEverywhere({ id: 'fra-preview', name: 'Fractured Scholar', set: 'fra', released_at: '2026-10-02' })
  const MERGED = { ...PREVIEW, id: 'fra-merged', collector_number: '53' }
  // The deck was saved with the scholar's name stamped on it, as the editor
  // does, and its printing has since gone.
  const held = stampNames(addCard(createDeck({ formatId: 'modern' }), PREVIEW.id, 4), { [PREVIEW.id]: PREVIEW })

  const answers = (page, cards) => vi.fn(async (url, opts) => {
    if (String(url).includes('/migrations')) return page
    const ids = JSON.parse(opts.body).identifiers.map((i) => i.id)
    return ok({
      object: 'list',
      data: cards.filter((c) => ids.includes(c.id)),
      not_found: ids.filter((id) => !cards.some((c) => c.id === id)).map((id) => ({ id })),
    })
  })

  const migrations = (data) => ok({ object: 'list', has_more: false, data })

  it('follows a merge and shows the card Scryfall points at', async () => {
    vi.stubGlobal('fetch', answers(migrations([{
      object: 'migration', id: 'm1', performed_at: '2026-09-23', migration_strategy: 'merge',
      old_scryfall_id: PREVIEW.id, new_scryfall_id: MERGED.id,
    }]), [MERGED]))
    const seen = await open(held)
    await until(() => seen.at(-1).moved.length > 0)
    const last = seen.at(-1)
    // Under the old id too, because the deck still names it until the editor
    // writes the new one in.
    expect(last.cards.get(PREVIEW.id)).toEqual(MERGED)
    expect(last.cards.get(MERGED.id)).toEqual(MERGED)
    expect(last.moved).toEqual([{ cardId: PREVIEW.id, newId: MERGED.id, card: MERGED, name: 'Fractured Scholar' }])
    expect(last.missing).toEqual([])
    expect(last.gone).toEqual([])
  })

  it('keeps a deleted printing, under the name the deck stamped', async () => {
    vi.stubGlobal('fetch', answers(migrations([{
      object: 'migration', id: 'm2', performed_at: '2026-09-18', migration_strategy: 'delete',
      old_scryfall_id: PREVIEW.id,
    }]), []))
    const seen = await open(held)
    await until(() => seen.at(-1).gone.length > 0)
    const last = seen.at(-1)
    expect(last.gone).toEqual([{ cardId: PREVIEW.id, name: 'Fractured Scholar', at: '2026-09-18' }])
    expect(last.moved).toEqual([])
    // Not also reported as a card that merely did not load: there is a reason.
    expect(last.missing).toEqual([])
    expect(last.cards.size).toBe(0)
  })

  it('says a printing is gone even where Scryfall has no migration for it', async () => {
    vi.stubGlobal('fetch', answers(migrations([]), []))
    const seen = await open(held)
    await until(() => seen.at(-1).gone.length > 0)
    expect(seen.at(-1).gone).toEqual([{ cardId: PREVIEW.id, name: 'Fractured Scholar', at: null }])
  })

  it('asks nothing about migrations while every card loads', async () => {
    const fetchMock = answers(migrations([]), [PREVIEW])
    vi.stubGlobal('fetch', fetchMock)
    const seen = await open(held)
    await until(() => seen.at(-1).cards.size === 1)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/migrations'))).toBe(true)
    expect(seen.at(-1).moved).toEqual([])
    expect(seen.at(-1).gone).toEqual([])
  })

  it('leaves the deck as it was when the card request fails', async () => {
    // Nothing came back from Scryfall, so nothing it says is acted on.
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const seen = await open(held)
    await until(() => seen.at(-1).missing.length > 0)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
    expect(seen.at(-1).moved).toEqual([])
    expect(seen.at(-1).gone).toEqual([])
    expect(seen.at(-1).missing).toEqual([PREVIEW.id])
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/migrations'))).toBe(true)
  })

  it('says nothing at all when a merge is known but its card did not arrive', async () => {
    // Scryfall says the printing was merged, so it was not deleted — but the
    // record at the new id could not be fetched. Announcing a deletion here
    // would contradict the answer in hand, so the card falls back to the
    // ordinary "could not be loaded" and the next open asks again.
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).includes('/migrations')) {
        return migrations([{
          object: 'migration', id: 'm3', performed_at: '2026-09-23', migration_strategy: 'merge',
          old_scryfall_id: PREVIEW.id, new_scryfall_id: MERGED.id,
        }])
      }
      const ids = JSON.parse(opts.body).identifiers.map((i) => i.id)
      if (ids.includes(MERGED.id)) return { ok: false, status: 503, json: async () => ({}) }
      return ok({ object: 'list', data: [], not_found: ids.map((id) => ({ id })) })
    }))
    const seen = await open(held)
    await until(() => seen.at(-1).missing.length > 0)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
    const last = seen.at(-1)
    expect(last.gone).toEqual([])
    expect(last.moved).toEqual([])
    expect(last.missing).toEqual([PREVIEW.id])
    expect(last.cards.size).toBe(0)
  })

  it('leaves the deck as it was when the migrations request fails', async () => {
    vi.stubGlobal('fetch', answers({ ok: false, status: 503, json: async () => ({}) }, []))
    const seen = await open(held)
    await until(() => seen.at(-1).gone.length > 0)
    const last = seen.at(-1)
    // Scryfall's own not_found is still its word, so the row says the printing
    // is gone; nothing is followed, and no id is rewritten.
    expect(last.moved).toEqual([])
    expect(last.gone).toEqual([{ cardId: PREVIEW.id, name: 'Fractured Scholar', at: null }])
  })
})
