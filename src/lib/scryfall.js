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

import {
  getCard, getCards, getCardRecords, putCards, markCardsChecked, getQuery, putQuery,
  CARD_TTL_MS, QUERY_TTL_MS,
} from './cache.js'
import { LOCKOUT_MS, MIN_INTERVAL_MS, SLOW_INTERVAL_MS, spacingFor } from './scryfall-limits.js'
import { isReleasedPaper } from './release.js'
import { refreshDue, dayOf } from './card-refresh.js'
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
//
// One line, one request at a time, each spaced for its endpoint, in two
// lanes. A request somebody is waiting on (a search, a deck opening, an
// import) is in the foreground lane. Refreshing cards a deck already has is
// in the background lane, and a background request only goes when no
// foreground request is queued: a foreground request that arrives behind
// background ones goes before them, and waits at most for the one request
// already under way and its spacing. A second line would not help, because
// Scryfall's spacing is per application, and the refresh cannot simply pause
// between batches, because it does not know when somebody is about to search.
// The launch watch refreshes every deck's cards in one pass, so twenty
// Commander decks of a hundred different cards each, all due at once, are
// twenty-seven requests of 75 cards, and a search made meanwhile still goes
// next.
const lanes = { foreground: [], background: [] }
let draining = false
let lastRequestAt = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const nextInLine = () => lanes.foreground[0] ?? lanes.background[0]

function enqueue(task, spacing = MIN_INTERVAL_MS, { background = false, signal } = {}) {
  return new Promise((resolve, reject) => {
    lanes[background ? 'background' : 'foreground'].push({ task, spacing, signal, resolve, reject })
    drain()
  })
}

async function drain() {
  if (draining) return
  draining = true
  // Everything queued in this same moment is in line before the first goes,
  // so a foreground request made alongside background ones goes first.
  await null
  try {
    for (let next = nextInLine(); next; next = nextInLine()) {
      // The spacing is waited out before whichever request goes next, which
      // is looked at again after the wait: a foreground request may have
      // arrived during it.
      let wait = next.spacing - (Date.now() - lastRequestAt)
      while (wait > 0) {
        await sleep(wait)
        next = nextInLine()
        wait = next.spacing - (Date.now() - lastRequestAt)
      }
      const lane = lanes.foreground[0] === next ? lanes.foreground : lanes.background
      lane.shift()
      // A request whose caller has gone is dropped without spending a slot.
      if (next.signal?.aborted) {
        next.reject(new DOMException('The request was abandoned.', 'AbortError'))
        continue
      }
      lastRequestAt = Date.now()
      // A failure is its caller's to handle. The line moves on either way, or
      // one failure would stall every request queued behind it.
      try {
        next.resolve(await next.task())
      } catch (error) {
        next.reject(error)
      }
    }
  } finally {
    draining = false
  }
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// --- the background lane's pause ---------------------------------------------
//
// A background request that fails leaves the background lane quiet for a
// while. Nobody is waiting on a refresh, and a Scryfall that has just refused
// or could not be reached will very likely do so again a moment later, so the
// decks after the first, a return to the Decks screen and the device coming
// back online ask nothing until the pause is over. After a 429 it lasts until
// the lockout ends (Retry-After, or LOCKOUT_MS); after a 5xx, or a failure to
// reach Scryfall at all, a few minutes. A background request made during it
// is refused at once without being sent, as if it had failed. A foreground
// request is never held back by it: somebody is waiting on that one.
const BACKGROUND_PAUSE_MS = 5 * 60 * 1000
let backgroundQuietUntil = 0

function pauseBackground(ms) {
  backgroundQuietUntil = Math.max(backgroundQuietUntil, Date.now() + ms)
}

function backgroundPaused() {
  return Date.now() < backgroundQuietUntil
}

const pausedError = () => new ScryfallError(
  'Scryfall could not be reached a moment ago, so this background refresh waits.',
  { code: 'background_paused' },
)

/** A failure that says Scryfall is down or unreachable, rather than an answer. */
const isOutage = (error) => error instanceof OfflineError
  || (error instanceof ScryfallError && (error.status ?? 0) >= 500)

/**
 * One call to Scryfall, through the queue.
 *
 * `background` puts it in the background lane (see above), and it is also
 * asked once only: a background refresh keeps the cached copy when a request
 * fails and tries again another day, whereas four retries backing off for
 * thirty seconds would hold the one line that a search is waiting in. A 429
 * is still waited out before the line moves on, because during a lockout the
 * next request, whoever made it, would be refused too. A background request
 * that fails pauses the background lane, and one made or reached in the
 * line during the pause is not sent (see above).
 */
async function request(path, { method = 'GET', body, signal, background = false } = {}) {
  if (isOffline()) throw new OfflineError()
  if (background && backgroundPaused()) throw pausedError()
  const retries = background ? 0 : MAX_RETRIES
  const lockoutRetries = background ? 0 : MAX_LOCKOUT_RETRIES

  const task = async () => {
    let lastError
    for (let attempt = 0; attempt <= retries; attempt++) {
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
          if (attempt < (lockedOut ? lockoutRetries : retries)) {
            await sleep(lockedOut ? lockoutWait(response) : 2 ** attempt * backoffBaseMs)
            continue
          }
          if (lockedOut && background) {
            // Paused from now until the lockout is over, so a background
            // request made while this one waits it out is refused at once
            // rather than lined up behind it.
            pauseBackground(lockoutWait(response))
            await sleep(lockoutWait(response))
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
            if (attempt < (lockedOut ? lockoutRetries : retries)) {
              await sleep(lockedOut ? lockoutMs : 2 ** attempt * backoffBaseMs)
              continue
            }
          }
          throw error
        }
        // Network-level failure: the fetch never landed.
        lastError = new OfflineError('Could not reach Scryfall. Showing cached cards only.')
        if (attempt < retries) {
          await sleep(2 ** attempt * backoffBaseMs)
          continue
        }
        throw lastError
      }
    }
    throw lastError ?? new ScryfallError('Request failed.')
  }

  if (!background) return enqueue(task, spacingFor(path), { signal })
  return enqueue(async () => {
    if (backgroundPaused()) throw pausedError()
    try {
      return await task()
    } catch (error) {
      if (isOutage(error)) pauseBackground(BACKGROUND_PAUSE_MS)
      throw error
    }
  }, spacingFor(path), { background, signal })
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
  request(`/cards/${encodeURIComponent(id)}`, { background: true })
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
 *
 * With `refresh`, the cached records that are due (see card-refresh.js) are
 * fetched again as well, in the background lane, and what comes back
 * replaces them; see refreshCards. It is not tried after a request for the
 * missing ids has failed, which would only ask a Scryfall that has just not
 * answered. `background` puts the fetch of missing ids in the background
 * lane too, for a caller nobody is waiting on. With either, an id Scryfall
 * has lately said it has no card for is not asked about again until a day
 * has passed. `now` is the clock the refresh works to, a time in
 * milliseconds. Offline, the cache is the answer.
 */
export async function getCardsByIds(ids, options = {}) {
  const { records } = await getCardRecordsByIds(ids, options)
  return new Map([...records].map(([id, record]) => [id, record.card]))
}

/**
 * getCardsByIds with each card's record rather than the card alone, for a
 * caller that needs to know how old its data is: `records` maps each id found
 * to { card, fetchedAt }, fetchedAt being `now` for a card fetched here.
 * `failed` says that a request failed, not merely that Scryfall had no card
 * for an id, so a caller working through several decks can stop asking for
 * the rest of its run. The cache is read once, and the refresh works from
 * what was read.
 */
export async function getCardRecordsByIds(ids, { signal, refresh = false, background = false, now = Date.now() } = {}) {
  const unique = [...new Set((ids ?? []).filter(Boolean))]
  const records = await getCardRecords(unique)
  let missing = unique.filter((id) => !records.has(id))
  if (!missing.length && !refresh) return { records, failed: false }

  if (isOffline()) return { records, failed: false }
  if (refresh || background) missing = await notKnownMissing(missing, now)

  let failed = false
  for (let i = 0; i < missing.length; i += 75) {
    const chunk = missing.slice(i, i + 75)
    try {
      const payload = await request('/cards/collection', {
        method: 'POST',
        body: { identifiers: chunk.map((id) => ({ id })) },
        signal,
        background,
      })
      const cards = payload.data ?? []
      await putCards(cards, { pinned: true, fetchedAt: now })
      for (const card of cards) records.set(card.id, { card, fetchedAt: now })
      await rememberNotFound(payload, chunk, now)
    } catch (error) {
      if (error.name === 'AbortError') throw error
      failed = failed || !isNotFound(error)
      // Partial results beat no results — a deck with three unresolved cards
      // should still open and say so.
      break
    }
  }

  if (refresh && !failed) {
    const result = await refreshRecords(records, { signal, now })
    for (const [id, card] of result.fresh) records.set(id, { card, fetchedAt: now })
    failed = result.failed
  }
  return { records, failed }
}

/**
 * Fetches again the cached records among `ids` that are due, and returns
 * only the cards that came back, so a screen already showing the cache can
 * tell whether it has anything new to show. `records`, when the caller has
 * just read them (getCardRecordsByIds), saves reading the cache again.
 *
 * Every request is in the background lane, 75 ids at a time. What comes
 * back replaces the cached record and stays pinned. An id Scryfall says it
 * has no card for keeps its cached copy, which may be the only record of what
 * the card was, and is noted on it so that it is asked about a week on rather
 * than daily (see markCardsChecked). A request that fails keeps every cached
 * copy, the batches after it are not sent, and the background lane pauses
 * (see above), so the next deck opened meanwhile asks nothing. Offline,
 * nothing is asked.
 */
export async function refreshCards(ids, { signal, now = Date.now(), records } = {}) {
  if (isOffline()) return new Map()
  const unique = [...new Set((ids ?? []).filter(Boolean))]
  const held = records instanceof Map
    ? new Map(unique.filter((id) => records.has(id)).map((id) => [id, records.get(id)]))
    : await getCardRecords(unique)
  return (await refreshRecords(held, { signal, now })).fresh
}

/**
 * The refresh itself, over records already read: { fresh, failed }.
 *
 * The due records are asked for, and when their last batch has room, it is
 * filled with records that are not due yet, oldest first, among those at
 * least a day old (QUERY_TTL_MS) and not lately found missing. A deck's
 * records are fetched on different days as searches and imports bring its
 * cards back one by one, so without this each group would fall due on its own
 * day and cost a small request of its own every time; filling the batch lets
 * them fall due together again, and costs no request that was not being made.
 */
async function refreshRecords(records, { signal, now }) {
  const fresh = new Map()
  if (isOffline()) return { fresh, failed: false }
  const day = dayOf(now)
  const due = []
  const spare = []
  for (const [id, record] of records) {
    if (refreshDue(record, now, day)) due.push(id)
    else if (fillsBatch(record, now)) spare.push([id, record.fetchedAt])
  }
  const room = (BATCH - (due.length % BATCH)) % BATCH
  const ids = due.length
    ? [...due, ...spare.sort((a, b) => a[1] - b[1]).slice(0, room).map(([id]) => id)]
    : []

  let failed = false
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    let payload
    try {
      payload = await request('/cards/collection', {
        method: 'POST',
        body: { identifiers: chunk.map((id) => ({ id })) },
        signal,
        background: true,
      })
    } catch (error) {
      if (error.name === 'AbortError') throw error
      failed = !isNotFound(error)
      break
    }
    // Only the records asked for are replaced: a card Scryfall sends under
    // another id is not a newer copy of one of these.
    const asked = new Set(chunk)
    const cards = (payload?.data ?? []).filter((card) => asked.has(card?.id))
    await putCards(cards, { pinned: true, fetchedAt: now })
    for (const card of cards) fresh.set(card.id, card)
    await markCardsChecked(notFoundIn(payload, chunk), now)
  }
  return { fresh, failed }
}

const BATCH = 75

/** A record not due that may fill a batch: a day old or more, and not lately found missing. */
function fillsBatch(record, now) {
  const { fetchedAt, checkedAt } = record ?? {}
  if (Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt <= CARD_TTL_MS) return false
  return Number.isFinite(fetchedAt) && fetchedAt <= now && now - fetchedAt >= QUERY_TTL_MS
}

const isNotFound = (error) => error instanceof ScryfallError && error.status === 404

// Scryfall lists what it could not find in a collection request's
// `not_found`, as the identifiers that were sent. A cached record it does not
// find is noted on the record itself (markCardsChecked). An id with no record
// to note it on, one a deck names but this device never saved, is kept in the
// query store, which forgets it after QUERY_TTL_MS by the device's clock; the
// time stored with each is checked against the caller's clock as well.
const notFoundKey = (id) => `notfound:${id}`

function notFoundIn(payload, chunk) {
  const asked = new Set(chunk)
  return (Array.isArray(payload?.not_found) ? payload.not_found : [])
    .map((identifier) => identifier?.id)
    .filter((id) => typeof id === 'string' && asked.has(id))
}

async function rememberNotFound(payload, chunk, now) {
  await Promise.all(notFoundIn(payload, chunk).map((id) => putQuery(notFoundKey(id), now)))
}

async function notKnownMissing(ids, now) {
  const known = await Promise.all(ids.map(async (id) => {
    const at = await getQuery(notFoundKey(id))
    return Number.isFinite(at) && at <= now && now - at < QUERY_TTL_MS
  }))
  return ids.filter((_, i) => !known[i])
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
  BACKGROUND_PAUSE_MS,
  /** Test seam: ends the background lane's pause, so each test starts unpaused. */
  resumeBackground() {
    backgroundQuietUntil = 0
  },
}
