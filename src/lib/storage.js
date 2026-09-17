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
  return backend
}

export function backendName() {
  return store().name
}

const EMPTY = {
  version: 1,
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

function read() {
  try {
    const raw = store().read()
    if (!raw) return memoryFallback ?? { ...EMPTY }
    const parsed = JSON.parse(raw)
    // Merge against EMPTY so a state file written by an older build still loads
    // with any newly added sections present.
    return {
      ...EMPTY,
      ...parsed,
      guide: { ...EMPTY.guide, ...(parsed.guide ?? {}) },
      prefs: {
    market: 'usd', ...EMPTY.prefs, ...(parsed.prefs ?? {}) },
    }
  } catch {
    // Private mode, disabled storage, or corrupted JSON. Keep working in memory
    // rather than refusing to start.
    return memoryFallback ?? { ...EMPTY }
  }
}

function write(state) {
  // The in-memory copy is updated first and unconditionally, so a failed
  // persist costs durability across a reload rather than the current session.
  memoryFallback = state
  return store().write(JSON.stringify(state))
}

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

  return update((state) => {
    if (replace) {
      return { ...EMPTY, ...parsed, version: 1 }
    }
    const byId = new Map(state.decks.map((d) => [d.id, d]))
    for (const deck of parsed.decks) {
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
          ...(parsed.guide?.completedLessons ?? []),
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
