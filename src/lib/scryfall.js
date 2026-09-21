// Scryfall API client.
//
// Scryfall is a volunteer-funded free service with no API key, and it asks to
// be left room. Its limits are per endpoint and live in ./scryfall-limits.js,
// read from Scryfall's own page rather than remembered. Every call in this app
// goes through the queue below, so the spacing holds even when several
// components fetch at once.
//
// Note on User-Agent: Scryfall requires one, and for browser JavaScript its
// docs say to "keep the browser's User-Agent intact" — so the right thing here
// is to leave the header alone, which a browser enforces anyway. There is no
// non-compliance to apologise for. The Accept header it also requires is set
// on every request below. The Node scripts under scripts/ are not browsers and
// do send a descriptive one.

import { getCard, getCards, putCards, getQuery, putQuery } from './cache.js'
import { LOCKOUT_MS, MIN_INTERVAL_MS, SLOW_INTERVAL_MS, spacingFor } from './scryfall-limits.js'

const API = 'https://api.scryfall.com'

// Four attempts backing off 2s / 4s / 8s / 16s — the same shape used by the
// Socrata pipelines, so retry behaviour is consistent across projects.
//
// The base is mutable so tests can exercise the real retry *logic* without
// sleeping thirty seconds to do it. Production never changes it.
const MAX_RETRIES = 4
let backoffBaseMs = 2000

// A 429 is not a wobble to back off from. Scryfall has shut this application
// out for a fixed thirty seconds, so the first three exponential waits would
// all land inside that window and be exactly the overage it asked us to stop.
// It gets one retry, taken after the lockout has actually elapsed — or after
// Retry-After, when the response carries one. Holding the whole queue for that
// is right rather than unfortunate: during a lockout every other request would
// be refused too.
const MAX_LOCKOUT_RETRIES = 1
let lockoutMs = LOCKOUT_MS

/** What a 429 costs: Scryfall's own Retry-After if it sent one, else the lockout. */
function lockoutWait(response) {
  const after = Number(response?.headers?.get?.('retry-after'))
  return Number.isFinite(after) && after > 0 ? after * 1000 : lockoutMs
}

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

function enqueue(task, spacing = MIN_INTERVAL_MS) {
  const run = chain.then(async () => {
    const wait = spacing - (Date.now() - lastRequestAt)
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
          const lockedOut = response.status === 429
          lastError = new ScryfallError(
            lockedOut
              ? 'Scryfall is rate limiting this app. Slowing down.'
              : 'Scryfall is having trouble right now.',
            { status: response.status },
          )
          if (attempt < (lockedOut ? MAX_LOCKOUT_RETRIES : MAX_RETRIES)) {
            await sleep(lockedOut ? lockoutWait(response) : 2 ** attempt * backoffBaseMs)
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
            const lockedOut = error.status === 429
            lastError = error
            if (attempt < (lockedOut ? MAX_LOCKOUT_RETRIES : MAX_RETRIES)) {
              await sleep(lockedOut ? lockoutMs : 2 ** attempt * backoffBaseMs)
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
  }, spacingFor(path))
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
 * Bulk fetch by name, for importing a decklist.
 *
 * The importer used to resolve one card per request. A 100-card list was 100
 * sequential calls at Scryfall's requested 100ms apart, plus one more for every
 * name that missed — roughly twenty seconds when nothing went wrong, and minutes
 * once a rate limit kicked in and the backoff compounded. In practice it looked
 * like the import had hung, because it effectively had.
 *
 * The collection endpoint takes 75 identifiers at a time, so a Commander deck
 * is two requests. It matches names exactly though, where the old path matched
 * fuzzily, so anything it does not find is retried one at a time — the slow
 * path still exists, it just runs over the handful of names that need it
 * instead of all of them.
 *
 * An entry may be a name or { name, set, number }. With a printing, the
 * identifier is the set and collector number, which is exact: no spelling to
 * get wrong, and the card that comes back is the one the person actually owns,
 * which is what their prices should be quoted on. A printing that Scryfall
 * does not know (a set code from a site's own vocabulary, a promo it lists
 * differently) falls back to the name in a second bulk pass, never to the
 * slow path on its own account.
 *
 * Progress is reported as (done, total, stage): stage "bulk" counts entries
 * through the collection passes, stage "single" counts the names on the slow
 * path, so the caller can say which of the two is running — the second is
 * the one that can take a while, and it used to be invisible.
 *
 * Returns a Map keyed by the name as it was asked for, not as Scryfall spells
 * it, so the caller can line results back up with the lines the user typed.
 */
export async function getCardsByNames(names, { signal, onProgress } = {}) {
  const wanted = new Map()
  for (const item of names) {
    const entry = typeof item === 'string' ? { name: item } : item
    if (!entry?.name || wanted.has(entry.name)) continue
    wanted.set(entry.name, entry)
  }
  const found = new Map()
  const total = wanted.size

  const byPrinting = (entry) => entry.set && entry.number
    ? { set: String(entry.set).toLowerCase(), collector_number: String(entry.number) }
    : null

  const matches = (cards, entry, identifier) => {
    if (identifier.collector_number) {
      return cards.find((c) => c.set === identifier.set && c.collector_number === identifier.collector_number)
    }
    // Scryfall answers with its own spelling, and for a double-faced card
    // that is "Front // Back" against a request for "Front".
    const lower = entry.name.toLowerCase()
    return cards.find((c) => c.name.toLowerCase() === lower)
      ?? cards.find((c) => c.name.toLowerCase().split(' // ')[0] === lower)
  }

  /** One bulk pass; returns the entries it could not resolve. */
  const collect = async (entries, identify) => {
    const missed = []
    for (let i = 0; i < entries.length; i += 75) {
      const chunk = entries.slice(i, i + 75)
      const identifiers = chunk.map(identify)
      try {
        const payload = await request('/cards/collection', {
          method: 'POST',
          body: { identifiers },
          signal,
        })
        const cards = payload.data ?? []
        await putCards(cards, { pinned: true })
        chunk.forEach((entry, j) => {
          const card = matches(cards, entry, identifiers[j])
          if (card) found.set(entry.name, card)
          else missed.push(entry)
        })
      } catch (error) {
        if (error.name === 'AbortError') throw error
        // Fall through to the next pass for this chunk rather than losing it.
        missed.push(...chunk)
      }
      onProgress?.(found.size, total, 'bulk')
    }
    return missed
  }

  const entries = [...wanted.values()]
  const withPrinting = entries.filter(byPrinting)
  const byNameOnly = entries.filter((entry) => !byPrinting(entry))

  // Pass one: exact printings for the lines that named one, names for the rest.
  // Pass two: whatever a printing did not find, by name.
  const unknownPrinting = await collect(withPrinting, byPrinting)
  const missedByName = await collect([...byNameOnly, ...unknownPrinting], (entry) => ({ name: entry.name }))
  onProgress?.(found.size, total, 'bulk')

  // Only the leftovers pay the per-request cost, and fuzzy matching is what
  // rescues a name with a typo or the wrong punctuation.
  let checked = 0
  for (const entry of missedByName) {
    onProgress?.(checked, missedByName.length, 'single')
    try {
      found.set(entry.name, await getCardByName(entry.name, { exact: false, signal }))
    } catch (error) {
      if (error.name === 'AbortError') throw error
      /* genuinely not found; the caller reports it */
    }
    checked++
  }
  onProgress?.(checked, missedByName.length, 'single')

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
  SLOW_INTERVAL_MS,
  spacingFor,
  MAX_RETRIES,
  MAX_LOCKOUT_RETRIES,
  LOCKOUT_MS,
  /** Test seam: shrink the backoff so retry paths are testable in milliseconds. */
  setBackoffBase(ms) {
    const previous = backoffBaseMs
    backoffBaseMs = ms
    return previous
  },
  /** Test seam: the same, for the thirty-second 429 lockout. */
  setLockoutMs(ms) {
    const previous = lockoutMs
    lockoutMs = ms
    return previous
  },
}
