/**
 * Where the person is, kept in the URL.
 *
 * Navigation used to live in React state: a deck had no link, the back button
 * did nothing useful, and a reload landed on the Decks screen whatever you
 * were doing. Hash routes fix that without a server: GitHub Pages serves one
 * file, and "#/decks/abc/analysis" survives a reload, a bookmark and a paste
 * into a message. The grammar is small on purpose:
 *
 *   #/guide | #/guide/game | #/guide/glossary | #/guide/track/<id> | #/guide/track/<id>/<lesson> | #/guide/lesson/<id>
 *   #/cards?q=<search>
 *   #/decks | #/decks/new | #/decks/new/<step> | #/decks/data | #/decks/<id> | #/decks/<id>/<tab>
 *   #/play
 *   #/practice | #/practice/<scenario>   (the practice table; reached by address only until it is linked)
 *   #/game | #/game/<deckId>             (the table, with one of your own decks on it; the Table tab)
 *   #/game/room/<code> | #/game/room/<code>/<deckId>   (the same, at a shared table on the relay)
 *   #/table | #/table/<deckId>           (the table's old address; still opens it, as #/game)
 *
 * plus "?card=<id>" on any of them for the card sheet, which is an overlay
 * rather than a place: closing it goes back to wherever it was opened from.
 *
 * The parse and build functions are pure and tested; the subscription below
 * is the only part that touches the window.
 */
import { useMemo, useSyncExternalStore } from 'react'

export const TABS = ['guide', 'cards', 'decks', 'play', 'practice', 'game']
export const DECK_TABS = ['list', 'add', 'coach', 'analysis', 'hand', 'history', 'io']
/** The first-deck flow's steps, in order. The bare #/decks/new means "resume". */
export const STEP_SLUGS = ['colours', 'play', 'commander', 'list']
/**
 * Places inside Learn. A lesson opened from a track keeps the track in its
 * address, so Back from the lesson lands on the track it came from; a lesson
 * reached on its own goes back to Learn.
 */
export const GUIDE_PLACES = ['game', 'glossary', 'track', 'lesson']

const EMPTY = Object.freeze({
  tab: null, deckId: null, deckTab: null, data: false, starting: false, step: null, q: null, cardId: null,
  guide: null, trackId: null, lessonId: null, scenarioId: null, gameDeckId: null, gameRoom: null,
})

/** "#/decks/abc/analysis?card=xyz" -> { tab, deckId, deckTab, data, q, cardId }. */
export function parseRoute(hash) {
  const raw = String(hash ?? '').replace(/^#/, '')
  const [pathPart, queryPart = ''] = raw.split('?')
  const params = new URLSearchParams(queryPart)
  const segments = pathPart.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s) } catch { return s }
  })
  const route = { ...EMPTY }
  route.cardId = params.get('card') || null

  // The table's old address still opens the table: a bookmark or a link
  // from before the rebuild lands where it always did.
  const [tab, second, third, fourth] = segments[0] === 'table' ? ['game', ...segments.slice(1)] : segments
  if (!TABS.includes(tab)) return route
  route.tab = tab
  if (tab === 'cards') route.q = params.get('q') || null
  if (tab === 'practice' && second) route.scenarioId = second
  if (tab === 'game' && second === 'room') {
    // A room code is five letters read out loud; anything else is not one.
    if (/^[A-Z0-9]{5}$/.test(third ?? '')) { route.gameRoom = third; if (fourth) route.gameDeckId = fourth }
  } else if (tab === 'game' && second) route.gameDeckId = second
  if (tab === 'guide' && GUIDE_PLACES.includes(second)) {
    if (second === 'track' && third) {
      route.guide = fourth ? 'lesson' : 'track'
      route.trackId = third
      route.lessonId = fourth ?? null
    } else if (second === 'lesson' && third) {
      route.guide = 'lesson'
      route.lessonId = third
    } else if (second === 'game' || second === 'glossary') route.guide = second
  }
  if (tab === 'decks' && second) {
    if (second === 'data') route.data = true
    else if (second === 'new') {
      route.starting = true
      route.step = STEP_SLUGS.includes(third) ? third : null
    } else {
      route.deckId = second
      route.deckTab = DECK_TABS.includes(third) ? third : null
    }
  }
  return route
}

/** The inverse of parseRoute; always produces a canonical hash. */
export function buildHash(route) {
  const tab = TABS.includes(route?.tab) ? route.tab : 'guide'
  const segments = [tab]
  if (tab === 'guide' && GUIDE_PLACES.includes(route.guide)) {
    if (route.guide === 'lesson' && route.lessonId) {
      if (route.trackId) segments.push('track', encodeURIComponent(route.trackId), encodeURIComponent(route.lessonId))
      else segments.push('lesson', encodeURIComponent(route.lessonId))
    } else if (route.guide === 'track' && route.trackId) segments.push('track', encodeURIComponent(route.trackId))
    else if (route.guide === 'game' || route.guide === 'glossary') segments.push(route.guide)
  }
  if (tab === 'practice' && route.scenarioId) segments.push(encodeURIComponent(route.scenarioId))
  if (tab === 'game' && route.gameRoom) segments.push('room', route.gameRoom)
  if (tab === 'game' && route.gameDeckId) segments.push(encodeURIComponent(route.gameDeckId))
  if (tab === 'decks') {
    if (route.data) segments.push('data')
    else if (route.starting) {
      segments.push('new')
      if (route.step && STEP_SLUGS.includes(route.step)) segments.push(route.step)
    } else if (route.deckId) {
      segments.push(encodeURIComponent(route.deckId))
      if (route.deckTab && route.deckTab !== 'list' && DECK_TABS.includes(route.deckTab)) segments.push(route.deckTab)
    }
  }
  const params = new URLSearchParams()
  if (tab === 'cards' && route.q) params.set('q', route.q)
  if (route.cardId) params.set('card', route.cardId)
  const query = params.toString()
  return `#/${segments.join('/')}${query ? `?${query}` : ''}`
}

/**
 * Applies a change to a route. Changing tab drops the old tab's own state
 * (an open deck, a search) but keeps the card overlay unless told otherwise;
 * a key set to null is cleared.
 */
export function withPatch(current, patch) {
  const base = patch.tab && patch.tab !== current.tab
    ? { ...EMPTY, cardId: current.cardId }
    : { ...current }
  for (const [key, value] of Object.entries(patch)) base[key] = value ?? (key === 'data' || key === 'starting' ? false : null)
  return base
}

// --- the live part -------------------------------------------------------

const listeners = new Set()
const notify = () => { for (const fn of listeners) fn() }

function subscribe(fn) {
  listeners.add(fn)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('popstate', notify)
    window.addEventListener('hashchange', notify)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('popstate', notify)
      window.removeEventListener('hashchange', notify)
    }
  }
}

const readHash = () => (typeof window === 'undefined' ? '' : window.location.hash)

export function currentRoute() {
  return parseRoute(readHash())
}

/**
 * Moves to a new route. `replace` rewrites the current history entry, for
 * changes that are not places of their own (a tab inside a deck, the search
 * text); everything else pushes, so the back button retraces real steps.
 */
export function navigate(patch, { replace = false, state = null } = {}) {
  if (typeof window === 'undefined') return
  const next = buildHash(withPatch(currentRoute(), patch))
  if (next === window.location.hash) return
  if (replace) window.history.replaceState(state, '', next)
  else window.history.pushState(state, '', next)
  notify()
}

/** The current route, re-rendering on every change. */
export function useRoute() {
  const hash = useSyncExternalStore(subscribe, readHash, () => '')
  return useMemo(() => parseRoute(hash), [hash])
}
