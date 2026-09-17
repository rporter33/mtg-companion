// Persisted app state: decks, saved games, guide progress, preferences.
//
// localStorage rather than IndexedDB because this data is small, synchronous
// reads keep first paint simple, and — the real reason — it is trivially
// exportable. Everything lives under one versioned key so "export my data"
// is one JSON file the user owns, matching the no-accounts promise.

import { defaultBackend, memoryBackend } from './storage-backend.js'

const KEY = 'mtg-companion:v1'

// The backend is swappable: `useBackend()` lets tests run against memory and
// lets a future IndexedDB backend drop in without touching anything below.
let backend = null
const store = () => (backend ??= defaultBackend(KEY))

export function useBackend(next) {
  backend = next ?? memoryBackend()
  // A new backend is a new session: nothing carried in memory from the last
  // one belongs to it, and neither does a save failure it never had.
  memoryFallback = null
  persistFailed = false
  return backend
}

export function backendName() {
  return store().name
}

/**
 * The shape of stored data, and how older shapes become this one.
 *
 * There are no accounts here, so a user's decks exist in exactly one place:
 * their browser. A migration that loses a deck loses it for good. So each step
 * is additive, they run in order, and the version is only bumped once its step
 * has run.
 *
 * State written by a NEWER build is left alone rather than forced backwards —
 * a stale service worker can serve an old bundle against new data, and
 * downgrading it would discard fields the newer build is still using.
 */
export const SCHEMA_VERSION = 3

const MIGRATIONS = {
  // 1 → 2: decks gained per-card categories and an order to show them in.
  // Nothing needs rewriting, because an entry with no category derives one from
  // the card's type. The version still moves, so a later migration knows what
  // it is looking at.
  2: (state) => ({
    ...state,
    decks: (state.decks ?? []).map((deck) => ({ categoryOrder: [], ...deck })),
  }),

  // 2 → 3: what the player owns, keyed by oracle id so a card is a card
  // whatever printing it is. Nobody owned anything before this, so an empty
  // object is the whole migration.
  3: (state) => ({ collection: {}, ...state }),
}

export function migrate(state) {
  const from = Number(state?.version) || 1
  if (from >= SCHEMA_VERSION) return state

  let out = state
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (step) out = step(out)
    out = { ...out, version: v }
  }
  return out
}

const EMPTY = {
  version: SCHEMA_VERSION,
  collection: {},
  decks: [],
  games: [],
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  prefs: {
    market: 'usd',
    currency: 'usd', showCardImages: true, lastFormat: 'commander',
    sortId: 'name', sortDir: null,
  },
}

let memoryFallback = null
let persistFailed = false

function read() {
  try {
    const raw = store().read()
    if (!raw) return memoryFallback ?? { ...EMPTY }
    const parsed = JSON.parse(raw)
    // Merge against EMPTY so a state file written by an older build still loads
    // with any newly added sections present.
    const state = migrate(parsed)
    return {
      ...EMPTY,
      ...state,
      guide: { ...EMPTY.guide, ...(state.guide ?? {}) },
      prefs: { ...EMPTY.prefs, ...(state.prefs ?? {}) },
    }
  } catch {
    // Private mode, disabled storage, or corrupted JSON. Keep working in memory
    // rather than refusing to start — but first keep the broken text. The next
    // save would otherwise write a fresh empty state straight over the top of
    // whatever a truncated write or a bad extension left there, and that text
    // is often mostly a person's decks.
    preserveCorrupt()
    return memoryFallback ?? { ...EMPTY }
  }
}

const CORRUPT_KEY = `${KEY}:corrupt`

function preserveCorrupt() {
  try {
    const raw = store().read()
    if (raw && typeof localStorage !== 'undefined' && !localStorage.getItem(CORRUPT_KEY)) {
      localStorage.setItem(CORRUPT_KEY, raw)
    }
  } catch { /* nowhere to keep it; nothing more can be done */ }
}

/** Unparseable state that was set aside rather than overwritten, if any. */
export function corruptBackup() {
  try { return localStorage.getItem(CORRUPT_KEY) } catch { return null }
}

export function discardCorruptBackup() {
  try { localStorage.removeItem(CORRUPT_KEY) } catch { /* nothing to do */ }
}

const PERSIST_EVENT = 'mtg:persist-failed'

function write(state) {
  // The in-memory copy is updated first and unconditionally, so a failed
  // persist costs durability across a reload rather than the current session.
  memoryFallback = state
  const ok = store().write(JSON.stringify(state))

  // Returning false into a caller that ignored it was the same as returning
  // nothing: the screen showed the change and the reload lost it, with no
  // moment in between where the app said so. Announce it instead.
  if (!ok && !persistFailed && typeof window !== 'undefined') {
    persistFailed = true
    window.dispatchEvent(new CustomEvent(PERSIST_EVENT))
  }
  if (ok) persistFailed = false
  return ok
}

/** Whether the most recent save reached storage. */
export function lastSaveSucceeded() {
  return !persistFailed
}

export const PERSIST_FAILED_EVENT = PERSIST_EVENT

export function loadState() {
  return read()
}

export function saveState(state) {
  return write(state)
}

export function update(mutator) {
  const next = mutator(read())
  write(next)
  return next
}

// --- decks ---------------------------------------------------------------

export function listDecks() {
  return read().decks
}

export function getDeck(id) {
  return read().decks.find((d) => d.id === id) ?? null
}

export function saveDeck(deck) {
  return update((state) => {
    const decks = state.decks.some((d) => d.id === deck.id)
      ? state.decks.map((d) => (d.id === deck.id ? deck : d))
      : [...state.decks, deck]
    return { ...state, decks }
  })
}

export function deleteDeck(id) {
  return update((state) => ({ ...state, decks: state.decks.filter((d) => d.id !== id) }))
}

// --- games ---------------------------------------------------------------

export function listGames() {
  return read().games
}

export function saveGame(game) {
  return update((state) => {
    const games = state.games.some((g) => g.id === game.id)
      ? state.games.map((g) => (g.id === game.id ? game : g))
      : [game, ...state.games]
    // Keep the history bounded; nobody needs their 200th game night back.
    return { ...state, games: games.slice(0, 30) }
  })
}

export function deleteGame(id) {
  return update((state) => ({ ...state, games: state.games.filter((g) => g.id !== id) }))
}

// --- guide ---------------------------------------------------------------

export function getGuideProgress() {
  return read().guide
}

export function markLessonComplete(lessonId) {
  return update((state) => {
    if (state.guide.completedLessons.includes(lessonId)) return state
    return {
      ...state,
      guide: { ...state.guide, completedLessons: [...state.guide.completedLessons, lessonId] },
    }
  })
}

export function resetLesson(lessonId) {
  return update((state) => ({
    ...state,
    guide: {
      ...state.guide,
      completedLessons: state.guide.completedLessons.filter((id) => id !== lessonId),
    },
  }))
}

export function saveTutorialState(tutorialState) {
  return update((state) => ({ ...state, guide: { ...state.guide, tutorialState } }))
}

// --- collection ----------------------------------------------------------

export function getCollection() {
  return read().collection ?? {}
}

export function saveCollection(collection) {
  return update((state) => ({ ...state, collection }))
}

// --- prefs ---------------------------------------------------------------

export function getPrefs() {
  return read().prefs
}

export function setPref(key, value) {
  return update((state) => ({ ...state, prefs: { ...state.prefs, [key]: value } }))
}

// --- import / export -----------------------------------------------------

export function exportAll() {
  return JSON.stringify({ ...read(), exportedAt: new Date().toISOString() }, null, 2)
}

/**
 * Imports a previously exported file. Merges by default so importing a
 * friend's deck list does not wipe your own; `replace` is opt-in.
 */
export function importAll(json, { replace = false } = {}) {
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.decks)) {
    throw new Error('That file does not look like an mtg-companion export.')
  }

  // A backup can be older than the build restoring it, so it goes through the
  // same migration as stored state. Pinning it to version 1 on replace, as this
  // did, would have written the whole store back to an older schema.
  const incoming = migrate(parsed)

  return update((state) => {
    if (replace) {
      return { ...EMPTY, ...incoming }
    }
    const byId = new Map(state.decks.map((d) => [d.id, d]))
    for (const deck of incoming.decks) {
      // On a collision, keep both — an imported deck should never silently
      // overwrite work the user did locally.
      if (byId.has(deck.id)) {
        byId.set(`${deck.id}_imported`, { ...deck, id: `${deck.id}_imported`, name: `${deck.name} (imported)` })
      } else {
        byId.set(deck.id, deck)
      }
    }
    return {
      ...state,
      decks: [...byId.values()],
      guide: {
        ...state.guide,
        completedLessons: [...new Set([
          ...state.guide.completedLessons,
          ...(incoming.guide?.completedLessons ?? []),
        ])],
      },
    }
  })
}

export function clearAll() {
  memoryFallback = { ...EMPTY }
  store().remove()
  return { ...EMPTY }
}

export const __EMPTY = EMPTY
