// Scryfall API client.
//
// Scryfall is a volunteer-funded free service with no API key and an explicit
// request to be gentle: 50–100ms between requests, cache what you get back.
// Every call in this app goes through the queue below so that holds even when
// several components fetch at once.
//
// Note on User-Agent: Scryfall's docs ask for a descriptive one, but browsers
// forbid scripts from setting that header, so we cannot comply from the client.
// The rate limiting and caching are the parts we *can* honour, and do.

import { getCard, getCards, putCards, getQuery, putQuery } from './cache.js'

const API = 'https://api.scryfall.com'
const MIN_INTERVAL_MS = 100
// Four attempts backing off 2s / 4s / 8s / 16s — the same shape used by the
// Socrata pipelines, so retry behaviour is consistent across projects.
//
// The base is mutable so tests can exercise the real retry *logic* without
// sleeping thirty seconds to do it. Production never changes it.
const MAX_RETRIES = 4
let backoffBaseMs = 2000

export class ScryfallError extends Error {
  constructor(message, { status, code, warnings } = {}) {
    super(message)
    this.name = 'ScryfallError'
    this.status = status
    this.code = code
    this.warnings = warnings ?? []
  }
}

export class OfflineError extends Error {
  constructor(message = 'You are offline, so only cached cards are available.') {
    super(message)
    this.name = 'OfflineError'
  }
}

// --- request queue --------------------------------------------------------
let chain = Promise.resolve()
let lastRequestAt = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function enqueue(task) {
  const run = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt)
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
    return task()
  })
  // Keep the chain alive even when a task rejects, or one failure stalls
  // every request queued behind it.
  chain = run.then(() => undefined, () => undefined)
  return run
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

async function request(path, { method = 'GET', body, signal } = {}) {
  if (isOffline()) throw new OfflineError()

  return enqueue(async () => {
    let lastError
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${API}${path}`, {
          method,
          signal,
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        })

        // 429 and 5xx are worth retrying; 4xx is a real answer and is not.
        if (response.status === 429 || response.status >= 500) {
          lastError = new ScryfallError(
            response.status === 429
              ? 'Scryfall is rate limiting this app. Slowing down.'
              : 'Scryfall is having trouble right now.',
            { status: response.status },
          )
          if (attempt < MAX_RETRIES) {
            await sleep(2 ** attempt * backoffBaseMs)
            continue
          }
          throw lastError
        }

        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          throw new ScryfallError(
            payload?.details ?? `Scryfall returned ${response.status}.`,
            { status: response.status, code: payload?.code, warnings: payload?.warnings },
          )
        }
        return payload
      } catch (error) {
        if (error.name === 'AbortError') throw error
        if (error instanceof ScryfallError) {
          if (error.status === 429 || (error.status ?? 0) >= 500) {
            lastError = error
            if (attempt < MAX_RETRIES) {
              await sleep(2 ** attempt * backoffBaseMs)
              continue
            }
          }
          throw error
        }
        // Network-level failure: the fetch never landed.
        lastError = new OfflineError('Could not reach Scryfall. Showing cached cards only.')
        if (attempt < MAX_RETRIES) {
          await sleep(2 ** attempt * backoffBaseMs)
          continue
        }
        throw lastError
      }
    }
    throw lastError ?? new ScryfallError('Request failed.')
  })
}

// --- public API -----------------------------------------------------------

/**
 * Full-text card search using Scryfall's own query syntax, so everything a
 * player already knows (`t:creature`, `c>=wu`, `f:modern`, `cmc<=3`) works
 * unchanged. Results are cached for a day; the cards themselves for a week.
 */
export async function searchCards(
  query,
  { order = 'name', dir = 'auto', unique = 'cards', page = 1, signal } = {},
) {
  const trimmed = (query ?? '').trim()
  if (!trimmed) return { cards: [], totalCards: 0, hasMore: false, fromCache: false }

  const key = `search:${trimmed}:${order}:${dir}:${unique}:${page}`
  const cached = await getQuery(key)
  if (cached) {
    const cards = await getCards(cached.ids)
    // Only trust the cached result if every card it names is still present.
    if (cards.size === cached.ids.length) {
      return {
        cards: cached.ids.map((id) => cards.get(id)),
        totalCards: cached.totalCards,
        hasMore: cached.hasMore,
        fromCache: true,
      }
    }
  }

  const params = new URLSearchParams({ q: trimmed, order, dir, unique, page: String(page) })
  let payload
  try {
    payload = await request(`/cards/search?${params}`, { signal })
  } catch (error) {
    // A search that matches nothing is a 404 from Scryfall, not a failure.
    if (error instanceof ScryfallError && error.status === 404) {
      return { cards: [], totalCards: 0, hasMore: false, fromCache: false, notFound: true }
    }
    throw error
  }

  const cards = payload.data ?? []
  await putCards(cards)
  await putQuery(key, {
    ids: cards.map((c) => c.id),
    totalCards: payload.total_cards ?? cards.length,
    hasMore: !!payload.has_more,
  })

  return {
    cards,
    totalCards: payload.total_cards ?? cards.length,
    hasMore: !!payload.has_more,
    warnings: payload.warnings ?? [],
    fromCache: false,
  }
}

export async function getCardById(id, { signal, allowStale = true } = {}) {
  const cached = await getCard(id)
  if (cached && (!cached.stale || allowStale)) {
    // Refresh a stale card in the background; the UI gets the cached copy now.
    if (cached.stale) refreshInBackground(id)
    return cached.card
  }
  const card = await request(`/cards/${encodeURIComponent(id)}`, { signal })
  await putCards([card])
  return card
}

function refreshInBackground(id) {
  request(`/cards/${encodeURIComponent(id)}`)
    .then((card) => putCards([card]))
    .catch(() => {})
}

export async function getCardByName(name, { exact = false, signal } = {}) {
  const params = new URLSearchParams(exact ? { exact: name } : { fuzzy: name })
  const card = await request(`/cards/named?${params}`, { signal })
  await putCards([card])
  return card
}

export async function autocomplete(query, { signal } = {}) {
  const trimmed = (query ?? '').trim()
  if (trimmed.length < 2) return []
  const key = `autocomplete:${trimmed.toLowerCase()}`
  const cached = await getQuery(key)
  if (cached) return cached
  const payload = await request(`/cards/autocomplete?q=${encodeURIComponent(trimmed)}`, { signal })
  const names = payload.data ?? []
  await putQuery(key, names)
  return names
}

export async function getRulings(cardId, { signal } = {}) {
  const key = `rulings:${cardId}`
  const cached = await getQuery(key)
  if (cached) return cached
  const payload = await request(`/cards/${encodeURIComponent(cardId)}/rulings`, { signal })
  const rulings = payload.data ?? []
  await putQuery(key, rulings)
  return rulings
}

/** Every printing of a card, for the art-and-set picker and price comparison. */
export async function getPrintings(card, { signal } = {}) {
  if (!card?.oracle_id) return card ? [card] : []
  const key = `printings:${card.oracle_id}`
  const cached = await getQuery(key)
  if (cached) {
    const cards = await getCards(cached)
    if (cards.size === cached.length) return cached.map((id) => cards.get(id))
  }
  const params = new URLSearchParams({
    q: `oracleid:${card.oracle_id}`,
    unique: 'prints',
    order: 'released',
  })
  const payload = await request(`/cards/search?${params}`, { signal })
  const prints = payload.data ?? []
  await putCards(prints)
  await putQuery(key, prints.map((c) => c.id))
  return prints
}

/**
 * Bulk fetch by id. Scryfall's collection endpoint takes 75 identifiers per
 * call, so this chunks — and checks the cache first, which for an open deck
 * usually means no network at all.
 */
export async function getCardsByIds(ids, { signal } = {}) {
  const unique = [...new Set(ids.filter(Boolean))]
  const found = await getCards(unique)
  const missing = unique.filter((id) => !found.has(id))
  if (missing.length === 0) return found

  if (isOffline()) return found

  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75)
    try {
      const payload = await request('/cards/collection', {
        method: 'POST',
        body: { identifiers: chunk.map((id) => ({ id })) },
        signal,
      })
      const cards = payload.data ?? []
      await putCards(cards, { pinned: true })
      for (const card of cards) found.set(card.id, card)
    } catch (error) {
      if (error.name === 'AbortError') throw error
      // Partial results beat no results — a deck with three unresolved cards
      // should still open and say so.
      break
    }
  }
  return found
}

/**
 * The set list, used by the theming engine.
 *
 * Cached for a day like any other query, because set metadata changes on the
 * order of weeks and this runs on every launch.
 */
export async function getSets({ signal } = {}) {
  const cached = await getQuery('sets:all')
  if (cached) return cached
  const payload = await request('/sets', { signal })
  const sets = (payload.data ?? []).map((set) => ({
    code: set.code,
    name: set.name,
    releasedAt: set.released_at,
    setType: set.set_type,
    iconSvgUri: set.icon_svg_uri,
    cardCount: set.card_count,
    digital: !!set.digital,
  }))
  await putQuery('sets:all', sets)
  return sets
}

/**
 * The colour distribution of a set, used to tint the season banner.
 *
 * Scryfall's search API reports `total_cards` for any query, so five cheap
 * queries give the set's colour breakdown without downloading the set. During
 * spoiler season this reflects what has been previewed so far and shifts as
 * more is revealed, which is the honest thing for it to do.
 */
export async function getSetColorProfile(setCode, { signal } = {}) {
  if (!setCode) return null
  const key = `setcolors:${setCode}`
  const cached = await getQuery(key)
  if (cached) return cached

  const counts = {}
  for (const color of ['w', 'u', 'b', 'r', 'g']) {
    const params = new URLSearchParams({ q: `set:${setCode} color:${color}`, unique: 'cards' })
    try {
      const payload = await request(`/cards/search?${params}`, { signal })
      counts[color.toUpperCase()] = payload.total_cards ?? 0
    } catch (error) {
      if (error.name === 'AbortError') throw error
      // A colour with no cards is a 404 from Scryfall, which is a real answer.
      counts[color.toUpperCase()] = 0
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (!total) return null

  const profile = { counts, total }
  await putQuery(key, profile)
  return profile
}

/** Scryfall's random card endpoint, used by the guide's "show me a card" button. */
export async function randomCard({ query, signal } = {}) {
  const params = query ? `?q=${encodeURIComponent(query)}` : ''
  const card = await request(`/cards/random${params}`, { signal })
  await putCards([card])
  return card
}

export const __internals = {
  request,
  enqueue,
  MIN_INTERVAL_MS,
  MAX_RETRIES,
  /** Test seam: shrink the backoff so retry paths are testable in milliseconds. */
  setBackoffBase(ms) {
    const previous = backoffBaseMs
    backoffBaseMs = ms
    return previous
  },
}
