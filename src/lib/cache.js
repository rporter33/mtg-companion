// IndexedDB card cache.
//
// Scryfall asks clients to cache rather than re-fetch, and the app needs viewed
// cards and deck contents to survive a dead connection at a game store. Cards
// referenced by a saved deck are *pinned*: they are never evicted, so a deck you
// built at home still opens on a phone with no signal.

const DB_NAME = 'mtg-companion'
const DB_VERSION = 1
const STORE_CARDS = 'cards'
const STORE_QUERIES = 'queries'
const STORE_META = 'meta'

// Prices and legalities move; oracle text does not. A week keeps the app honest
// about ban list updates without re-fetching constantly.
export const CARD_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const QUERY_TTL_MS = 24 * 60 * 60 * 1000

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_CARDS)) {
        const store = db.createObjectStore(STORE_CARDS, { keyPath: 'id' })
        store.createIndex('name', 'name', { unique: false })
        store.createIndex('pinned', 'pinned', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_QUERIES)) {
        db.createObjectStore(STORE_QUERIES, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store)
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Every cache read is best-effort. A browser in private mode, with storage
 * disabled, or over quota should degrade to "no cache", never to a broken app —
 * so failures here resolve to a miss instead of rejecting.
 */
async function safely(fn, fallback) {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

export async function getCard(id) {
  return safely(async () => {
    const db = await openDb()
    const record = await wrap(tx(db, STORE_CARDS, 'readonly').get(id))
    if (!record) return null
    // A record with no readable fetchedAt is from an older build: read as old.
    const stale = !Number.isFinite(record.fetchedAt) || Date.now() - record.fetchedAt > CARD_TTL_MS
    return { card: record.card, stale, pinned: !!record.pinned }
  }, null)
}

export async function getCards(ids) {
  const out = new Map()
  await safely(async () => {
    const db = await openDb()
    const store = tx(db, STORE_CARDS, 'readonly')
    await Promise.all(ids.map(async (id) => {
      const record = await wrap(store.get(id))
      if (record) out.set(id, record.card)
    }))
  }, null)
  return out
}

/**
 * The cached records themselves, with when each was fetched, for deciding
 * which are due to be asked for again (see card-refresh.js). A record with no
 * readable fetchedAt, as an older build may have left, comes back with
 * fetchedAt null, which is read as old; one with no card in it is left out,
 * as a miss. `checkedAt` (see markCardsChecked) is there only when it is a
 * time.
 */
export async function getCardRecords(ids) {
  const out = new Map()
  await safely(async () => {
    const db = await openDb()
    const store = tx(db, STORE_CARDS, 'readonly')
    await Promise.all(ids.map(async (id) => {
      const record = await wrap(store.get(id))
      if (!record?.card || typeof record.card !== 'object') return
      const fetchedAt = Number.isFinite(record.fetchedAt) ? record.fetchedAt : null
      out.set(id, {
        card: record.card,
        fetchedAt,
        ...(Number.isFinite(record.checkedAt) ? { checkedAt: record.checkedAt } : {}),
      })
    }))
  }, null)
  return out
}

/**
 * Notes on saved records that Scryfall was asked about at `checkedAt` and
 * said it has no card with that id, as it does for a preview it has since
 * merged or deleted. The record is kept, since it may be the only one of
 * what the card was, and the note keeps it from being asked about again for
 * a week (see refreshDue). A fresh copy saved later replaces the note with
 * the record.
 */
export async function markCardsChecked(ids, checkedAt) {
  return safely(async () => {
    const db = await openDb()
    const store = tx(db, STORE_CARDS, 'readwrite')
    for (const id of ids) {
      const record = await wrap(store.get(id))
      if (record) store.put({ ...record, checkedAt })
    }
    return true
  }, false)
}

/**
 * `fetchedAt` is when Scryfall answered. It is now, except where the caller
 * works to a clock of its own, as the refresh does, so that a record it has
 * just fetched is never due again by that clock.
 */
export async function putCards(cards, { pinned = false, fetchedAt } = {}) {
  return safely(async () => {
    const db = await openDb()
    const store = tx(db, STORE_CARDS, 'readwrite')
    const now = Number.isFinite(fetchedAt) ? fetchedAt : Date.now()
    for (const card of cards) {
      if (!card?.id) continue
      // Never downgrade a pinned card to unpinned just because it was also
      // returned by a search.
      const existing = await wrap(store.get(card.id))
      store.put({
        id: card.id,
        name: card.name,
        card,
        fetchedAt: now,
        pinned: pinned || !!existing?.pinned,
      })
    }
    return true
  }, false)
}

/** Marks the cards a deck depends on so eviction leaves them alone. */
export async function pinCards(ids) {
  return safely(async () => {
    const db = await openDb()
    const store = tx(db, STORE_CARDS, 'readwrite')
    for (const id of ids) {
      const record = await wrap(store.get(id))
      if (record) store.put({ ...record, pinned: true })
    }
    return true
  }, false)
}

export async function unpinCards(ids) {
  return safely(async () => {
    const db = await openDb()
    const store = tx(db, STORE_CARDS, 'readwrite')
    for (const id of ids) {
      const record = await wrap(store.get(id))
      if (record) store.put({ ...record, pinned: false })
    }
    return true
  }, false)
}

export async function getQuery(key) {
  return safely(async () => {
    const db = await openDb()
    const record = await wrap(tx(db, STORE_QUERIES, 'readonly').get(key))
    if (!record) return null
    if (Date.now() - record.fetchedAt > QUERY_TTL_MS) return null
    return record.value
  }, null)
}

export async function putQuery(key, value) {
  return safely(async () => {
    const db = await openDb()
    tx(db, STORE_QUERIES, 'readwrite').put({ key, value, fetchedAt: Date.now() })
    return true
  }, false)
}

/** Drops unpinned cards older than the TTL. Called on startup, never blocking. */
export async function evictStale() {
  return safely(async () => {
    const db = await openDb()
    const store = tx(db, STORE_CARDS, 'readwrite')
    const cutoff = Date.now() - CARD_TTL_MS
    const cursorRequest = store.openCursor()
    let removed = 0
    await new Promise((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) return resolve()
        const record = cursor.value
        if (!record.pinned && record.fetchedAt < cutoff) {
          cursor.delete()
          removed++
        }
        cursor.continue()
      }
      cursorRequest.onerror = () => reject(cursorRequest.error)
    })
    return removed
  }, 0)
}

export async function cacheStats() {
  return safely(async () => {
    const db = await openDb()
    const store = tx(db, STORE_CARDS, 'readonly')
    const total = await wrap(store.count())
    return { cards: total }
  }, { cards: 0 })
}

export async function clearCache() {
  return safely(async () => {
    const db = await openDb()
    for (const name of [STORE_CARDS, STORE_QUERIES]) {
      tx(db, name, 'readwrite').clear()
    }
    return true
  }, false)
}

/** Test seam — drops the memoized connection so a fresh DB can be opened. */
export function __resetForTests() {
  dbPromise = null
}
