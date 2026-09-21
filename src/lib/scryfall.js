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
import { isReleasedPaper } from './release.js'
import { today } from './season.js'
import { oracleIdOf } from './formats.js'

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
 * is two requests, plus a search for each fifteen picks that are not out (see
 * below). It matches names exactly though, where the old path matched
 * fuzzily, so anything it does not find is retried one at a time — the slow
 * path still exists, it just runs over the handful of names that need it
 * instead of all of them.
 *
 * An entry may be a name or { name, set, number }. With a printing, the
 * identifier is the set and collector number, which is exact: no spelling to
 * get wrong, and the card that comes back is the one the person actually owns,
 * which is what their prices should be quoted on. With a set and no number
 * ("4 Lightning Bolt (2X2)", "1 Sol Ring [CMD]") it is the name within that
 * set; the set used to be thrown away. A printing that Scryfall does not know
 * (a set code from a site's own vocabulary, a promo it lists differently)
 * falls back to the name in a second bulk pass, never to the slow path on
 * its own account, and the line says so. So does a printing Scryfall could
 * not be asked about, because the request for it failed: that line also
 * falls back to the name, but it is marked `unasked`, since Scryfall never
 * said it had no such printing.
 *
 * A name alone gets Scryfall's pick for it. That is Scryfall's own choice of
 * printing, not always its newest, and it can be from a set Scryfall lists
 * before it is out: on 2026-09-21 a bare "Island" came back as a Star Trek
 * printing due on 13 November. So when the app is the one choosing, a pick
 * that is not out, or exists only in a digital game, is swapped for the
 * newest printing that is out on paper (see findReleasedPrintings); a pick
 * that is out on paper stands. A printing the person typed is never swapped:
 * that is their choice, released or not, and neither is one whose lookup
 * failed, since nobody chose the name's pick over it.
 *
 * Progress is reported as (done, total, stage): stage "bulk" counts entries
 * through the collection passes, stage "single" counts the names on the slow
 * path, and stage "released" counts the picks being checked for a printing
 * that is out, so the caller can say which is running — the slow path is the
 * one that can take a while, and it used to be invisible.
 *
 * Returns one result per entry, in the order given: { line, card, how }, with
 * card null for a name nothing matched. `how` says how the printing was
 * chosen, because the import review shows it:
 *   exact            the set and collector number typed
 *   set              the typed set, by name within it
 *   newest           Scryfall's pick for the name, kept as it is (the name
 *                    of the rule, not a claim about the printing)
 *   released         Scryfall's pick was not out, or not on paper, so the
 *                    newest released paper printing was taken; `newest` is
 *                    the pick passed over
 *   unreleased-only  no released paper printing exists, so the preview stays
 *   fallback         the typed printing is not on Scryfall, or with
 *                    `unasked` could not be asked for; the name chose, and
 *                    `byName` is which of the three above it came to
 * A pick that could not be checked (Scryfall unreachable, a 429) is kept as
 * it is and marked `unchecked`, rather than claimed to be the only one.
 *
 * Each distinct line is its own lookup, so "2 Island (HOB) 195" and "2 Island
 * (TRK) 319" in one list stay two printings; before, the second took the
 * first's card and the deck merged them.
 */
export async function resolvePrintings(entries, { signal, onProgress, now = today() } = {}) {
  const lines = [...(entries ?? [])].map((item) => (typeof item === 'string' ? { name: item } : item ?? {}))
  const lookups = new Map()
  const keys = lines.map((line) => {
    if (typeof line.name !== 'string' || !line.name) return null
    const set = line.set ? String(line.set).toLowerCase() : ''
    const number = set && line.number ? String(line.number) : ''
    const key = `${line.name}|${set}|${number}`
    if (!lookups.has(key)) lookups.set(key, { name: line.name, set, number, card: null, how: null })
    return key
  })
  const all = [...lookups.values()]
  const total = all.length
  const done = () => all.filter((l) => l.card).length

  // Scryfall answers with its own spelling, and for a double-faced card that
  // is "Front // Back" against a request for "Front".
  const byName = (cards, name) => {
    const lower = name.toLowerCase()
    return cards.find((c) => c.name?.toLowerCase() === lower)
      ?? cards.find((c) => c.name?.toLowerCase().split(' // ')[0] === lower)
  }

  /**
   * One bulk pass. Returns the entries it could not resolve, `missed`, and
   * among them `unasked`, those whose request failed: Scryfall answered the
   * rest, and said it had nothing for them, but said nothing about these.
   */
  const collect = async (items, identify, match, settle) => {
    const missed = []
    const unasked = new Set()
    for (let i = 0; i < items.length; i += 75) {
      const chunk = items.slice(i, i + 75)
      try {
        const payload = await request('/cards/collection', {
          method: 'POST',
          body: { identifiers: chunk.map(identify) },
          signal,
        })
        const cards = payload.data ?? []
        await putCards(cards, { pinned: true })
        for (const item of chunk) {
          const card = match(cards, item)
          if (card) settle(item, card)
          else missed.push(item)
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error
        // Fall through to the next pass for this chunk rather than losing it.
        // request() has already retried it, or waited out a lockout, so it is
        // not asked for again here.
        missed.push(...chunk)
        for (const item of chunk) unasked.add(item)
      }
      onProgress?.(done(), total, 'bulk')
    }
    return { missed, unasked }
  }

  // Pass one: the printings people typed, exact or by set, in one bulk call.
  // A number typed in another case ("clb-187" for Scryfall's "CLB-187") is the
  // same printing, not a missing one.
  const sameNumber = (c, number) => String(c.collector_number ?? '').toLowerCase() === number.toLowerCase()
  const isTyped = (c, l) => c?.set === l.set && (!l.number || sameNumber(c, l.number))
  const pass1 = await collect(
    all.filter((l) => l.set),
    (l) => (l.number ? { set: l.set, collector_number: l.number } : { name: l.name, set: l.set }),
    (cards, l) => (l.number
      ? cards.find((c) => c.set === l.set && sameNumber(c, l.number))
      : byName(cards.filter((c) => c.set === l.set), l.name)),
    (l, card) => { l.card = card; l.how = l.number ? 'exact' : 'set' },
  )
  const unknownPrinting = pass1.missed

  // Pass two: bare names, and whatever a typed printing did not find, by
  // name. Each name is asked for once however many lines share it.
  for (const l of unknownPrinting) {
    l.missed = true
    if (pass1.unasked.has(l)) l.unasked = true
  }
  const wantByName = [...all.filter((l) => !l.set), ...unknownPrinting]
  const settleName = (name, card) => {
    for (const l of wantByName) {
      if (l.name !== name || l.card) continue
      l.card = card
      // The name's pick may be the very printing typed, found this way
      // because the first request failed: then it is what was typed.
      if (l.missed && isTyped(card, l)) l.how = l.number ? 'exact' : 'set'
      else if (l.missed) { l.how = 'fallback'; l.byName = 'newest' } else l.how = 'newest'
    }
  }
  const names = [...new Set(wantByName.map((l) => l.name))]
  const { missed: missedByName } = await collect(names, (name) => ({ name }), byName, settleName)
  onProgress?.(done(), total, 'bulk')

  // Only the leftovers pay the per-request cost, and fuzzy matching is what
  // rescues a name with a typo or the wrong punctuation.
  let checked = 0
  for (const name of missedByName) {
    onProgress?.(checked, missedByName.length, 'single')
    try {
      settleName(name, await getCardByName(name, { exact: false, signal }))
    } catch (error) {
      if (error.name === 'AbortError') throw error
      /* genuinely not found; the caller reports it */
    }
    checked++
  }
  onProgress?.(checked, missedByName.length, 'single')

  // Released first, for the cards the app chose and the person did not. A
  // typed printing that could not be asked for is left as the name's pick:
  // a failed request is no reason to choose against what was typed.
  const chosen = all.filter((l) => l.card
    && (l.how === 'newest' || (l.how === 'fallback' && !l.unasked)))
  await findReleasedPrintings(chosen, { signal, onProgress, now })

  return lines.map((line, i) => {
    const l = keys[i] ? lookups.get(keys[i]) : null
    if (!l?.card) return { line, card: null, how: null }
    const result = { line, card: l.card, how: l.how }
    if (l.byName) result.byName = l.byName
    if (l.newest) result.newest = l.newest
    if (l.unchecked) result.unchecked = true
    if (l.unasked && l.how === 'fallback') result.unasked = true
    return result
  })
}

// Scryfall documents a search query's maximum as 1000 Unicode characters. An
// oracle id is 36, so fifteen of them with their "oracleid:" and " or " come
// to about 780 with the rest of the query, and every batch is measured too.
const RELEASED_BATCH = 15
const QUERY_MAX = 1000
const RELEASED_TERMS = 'date<=now game:paper lang:en prefer:newest'
const releasedQuery = (ids) => `(${ids.map((id) => `oracleid:${id}`).join(' or ')}) ${RELEASED_TERMS}`

/**
 * Swaps each pick that is not out, or not on paper, for the newest printing
 * of the same card that is out on paper, and says which it did.
 *
 * Only these picks are looked at, so a released pick costs nothing, and
 * nothing here depends on how Scryfall breaks ties between printings: the
 * one promise is never a preview or a digital-only printing while a printing
 * somebody can hold exists. There is no taste in it (no frame, no treatment,
 * no Universes Beyond filter); the problem is release, not look, and the
 * printings picker is a tap away. The query asks by oracle id rather than by
 * name, because a name also matches the back face of a different card
 * ("Emeritus of Conflict // Lightning Bolt"), and a result is taken only when
 * its oracle id is the one asked for.
 *
 * `date<=now` is read by Scryfall's own clock, which may be ahead of the
 * app's by some hours on a release day, so Scryfall can return a printing
 * the app still counts as not out: the pick itself, or another from the same
 * set. That is no printing that is out, as far as the labels on screen go,
 * so the pick stays as it is, with no note, and its chip carries the date.
 *
 * A search that fails, or a device that is offline, leaves the pick as it
 * was, and the searches after it are not sent: the one that failed has been
 * through request()'s retries or a lockout already, and the next would meet
 * the same. An import is held up by one failed search at most, and labelled.
 */
async function findReleasedPrintings(lookups, { signal, onProgress, now }) {
  const byId = new Map()
  for (const l of lookups) {
    if (isReleasedPaper(l.card, now)) continue
    const id = oracleIdOf(l.card)
    // With no id there is nothing to search by, and the pick stays. An id
    // that is not an id is not put into a query.
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id) || releasedQuery([id]).length > QUERY_MAX) continue
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id).push(l)
  }
  if (!byId.size) return

  const batches = []
  for (const id of byId.keys()) {
    const last = batches.at(-1)
    if (last && last.length < RELEASED_BATCH && releasedQuery([...last, id]).length <= QUERY_MAX) last.push(id)
    else batches.push([id])
  }

  const settle = (l, how) => { if (l.how === 'fallback') l.byName = how; else l.how = how }
  let checked = 0
  for (const [b, ids] of batches.entries()) {
    onProgress?.(checked, byId.size, 'released')
    let results = []
    let answered = true
    try {
      const params = new URLSearchParams({ q: releasedQuery(ids), unique: 'cards' })
      const payload = await request(`/cards/search?${params}`, { signal })
      results = payload?.data ?? []
    } catch (error) {
      if (error.name === 'AbortError') throw error
      // Nothing matching is a 404 from Scryfall, and that is an answer: no
      // printing of these is out. Anything else is not an answer at all.
      answered = error instanceof ScryfallError && error.status === 404
    }
    if (!answered) {
      // This batch and every one after it stay as they were, unsent.
      for (const rest of batches.slice(b)) {
        for (const id of rest) for (const l of byId.get(id)) l.unchecked = true
      }
      checked = byId.size
      break
    }
    const taken = []
    for (const id of ids) {
      const found = results.find((c) => oracleIdOf(c) === id)
      for (const l of byId.get(id)) {
        // Another printing, and out by the app's day as well as Scryfall's.
        if (found && found.id !== l.card.id && isReleasedPaper(found, now)) {
          l.newest = l.card
          l.card = found
          settle(l, 'released')
          if (!taken.includes(found)) taken.push(found)
        } else if (!found) settle(l, 'unreleased-only')
      }
    }
    if (taken.length) await putCards(taken, { pinned: true })
    checked += ids.length
  }
  onProgress?.(checked, byId.size, 'released')
}

/**
 * The same lookup, as a Map keyed by the name as it was asked for, not as
 * Scryfall spells it, for callers that want one card per name (the first
 * deck's commanders and basics, a playtest's extra land, a card opened by
 * name). The first line to resolve for a name is the one it keeps.
 */
export async function getCardsByNames(names, options = {}) {
  const found = new Map()
  for (const { line, card } of await resolvePrintings(names, options)) {
    if (card && !found.has(line.name)) found.set(line.name, card)
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
