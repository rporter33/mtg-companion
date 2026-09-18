// Persisted app state: decks, saved games, guide progress, preferences.
//
// localStorage rather than IndexedDB because this data is small, synchronous
// reads keep first paint simple, and — the real reason — it is trivially
// exportable. "Export my data" is one JSON file the user owns, matching the
// no-accounts promise, and that file's shape is unchanged by anything below.
//
// HOW IT IS LAID OUT. One root document holds the small, whole-app things:
// schema version, collection, games, guide progress, preferences. Each deck
// is its own document under its own key. The first version kept everything
// in one blob and rewrote all of it on every quantity tap; splitting the
// decks out means a save touches one deck's bytes, a corrupt root no longer
// takes the decks down with it, and — the reason it was done now — a deck
// with its own updatedAt is what a sync backend needs to reconcile. The old
// blob is split into documents the first time it is read.

import { defaultBackend, memoryBackend } from './storage-backend.js'
import { dropOldestCheckpoint } from './data-safety.js'

const KEY = 'mtg-companion:v1'
const DECK_PREFIX = `${KEY}:deck:`
const deckKey = (id) => `${DECK_PREFIX}${id}`

// The backend is swappable: `useBackend()` lets tests run against memory and
// lets an IndexedDB or server backend drop in without touching anything below.
let backend = null
const store = () => (backend ??= defaultBackend(KEY))

export function useBackend(next) {
  backend = next ?? memoryBackend()
  // A new backend is a new session: nothing carried in memory from the last
  // one belongs to it, and neither does a save failure it never had.
  cache = null
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
export const SCHEMA_VERSION = 4

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

  // 3 → 4: every deck can carry a history. Nothing had one before, so each
  // deck gets an empty list; a deck that somehow already has one keeps it.
  4: (state) => ({
    ...state,
    decks: (state.decks ?? []).map((deck) => ({ versions: [], ...deck })),
  }),
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
  // The practice table: one saved run per exercise (its action log, which
  // replays to the same state), paper practice by self-report, and the
  // evidence record. Bounded: a run keeps at most PRACTICE_LOG_LIMIT actions.
  practice: { runs: {}, paper: {}, evidence: {} },
  prefs: {
    market: 'usd',
    currency: 'usd', showCardImages: true, lastFormat: 'commander',
    sortId: 'name', sortDir: null,
  },
}

let persistFailed = false

/**
 * The in-memory copy of everything, read from storage once and kept until
 * something invalidates it: our own write updates it in place; another tab's
 * write (the `storage` event) clears it so the next read re-reads. Reads are
 * therefore free after the first, and object identity is stable between
 * reads, which is what lets a save write only the deck that changed.
 */
let cache = null // { root, decks: Map<id, deck>, state }

function parseOr(raw, onCorrupt) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { onCorrupt?.(raw); return null }
}

function load() {
  if (cache) return cache
  const s = store()
  const rootRaw = s.read(KEY)
  let root = parseOr(rootRaw, () => preserveCorrupt(KEY, rootRaw))
  const decks = new Map()

  // A file from before decks had documents of their own: split it. The
  // documents are written first and the blob rewritten without its decks
  // only once every one of them landed, so a refused write leaves the old
  // layout intact and the decks are served from memory meanwhile.
  if (root && Array.isArray(root.decks)) {
    const legacy = root.decks
    const { decks: _drop, ...rest } = root
    for (const deck of legacy) if (deck?.id) decks.set(deck.id, deck)
    let landed = true
    for (const deck of decks.values()) {
      if (!s.write(deckKey(deck.id), JSON.stringify(deck))) { landed = false; break }
    }
    if (landed && s.write(KEY, JSON.stringify(rest))) root = rest
  }

  for (const key of (s.keys?.() ?? [])) {
    if (!key.startsWith(DECK_PREFIX) || key.endsWith(':corrupt')) continue
    const id = key.slice(DECK_PREFIX.length)
    if (decks.has(id)) continue
    const raw = s.read(key)
    const deck = parseOr(raw, () => preserveCorrupt(key, raw))
    if (deck && typeof deck === 'object') decks.set(id, { ...deck, id: deck.id ?? id })
  }

  cache = { root: root ?? null, decks, state: null }
  cache.state = assemble(cache)
  return cache
}

const byCreation = (a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  || String(a.name ?? '').localeCompare(String(b.name ?? ''))

/** The whole state as callers see it: root plus decks, migrated and defaulted. */
function assemble({ root, decks }) {
  const merged = migrate({ ...(root ?? {}), decks: [...decks.values()].sort(byCreation) })
  return {
    ...EMPTY,
    ...merged,
    guide: { ...EMPTY.guide, ...(merged.guide ?? {}) },
    practice: { ...EMPTY.practice, ...(merged.practice ?? {}) },
    prefs: { ...EMPTY.prefs, ...(merged.prefs ?? {}) },
  }
}

function read() {
  return load().state
}

/** Unparseable text is set aside under its own key rather than overwritten. */
function preserveCorrupt(key, raw) {
  try {
    const at = `${key}:corrupt`
    if (raw && typeof localStorage !== 'undefined' && !localStorage.getItem(at)) localStorage.setItem(at, raw)
  } catch { /* nowhere to keep it; nothing more can be done */ }
}

const corruptKeys = () => {
  try {
    const out = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(KEY) && k.endsWith(':corrupt')) out.push(k)
    }
    return out.sort((a, b) => a.length - b.length)
  } catch { return [] }
}

/** Unparseable state that was set aside rather than overwritten, if any. */
export function corruptBackup() {
  try {
    const [first] = corruptKeys()
    return first ? localStorage.getItem(first) : null
  } catch { return null }
}

export function discardCorruptBackup() {
  try { for (const k of corruptKeys()) localStorage.removeItem(k) } catch { /* nothing to do */ }
}

const PERSIST_EVENT = 'mtg:persist-failed'

let lastRoomMade = 0

/**
 * Persists a whole next state, writing only what changed: the root when its
 * text differs, each deck whose object is not the one already stored, and a
 * removal for each deck no longer present. The in-memory copy is updated
 * first and unconditionally, so a failed persist costs durability across a
 * reload rather than the current session.
 */
function write(next) {
  const prev = cache ?? { root: null, decks: new Map(), state: null }
  const s = store()
  const { decks: nextDecks = [], ...nextRoot } = next
  const changes = []

  const rootText = JSON.stringify(nextRoot)
  if (!prev.root || JSON.stringify(prev.root) !== rootText) changes.push({ key: KEY, text: rootText })

  const nextMap = new Map()
  for (const deck of nextDecks) {
    if (!deck?.id) continue
    nextMap.set(deck.id, deck)
    if (prev.decks.get(deck.id) !== deck) changes.push({ key: deckKey(deck.id), text: JSON.stringify(deck), deckId: deck.id })
  }
  for (const id of prev.decks.keys()) if (!nextMap.has(id)) s.remove(deckKey(id))

  cache = { root: nextRoot, decks: nextMap, state: null }
  cache.state = assemble(cache)

  let ok = true
  let removed = 0
  let current = next
  for (const change of changes) {
    if (s.write(change.key, change.text)) continue
    // A refused write gets more chances: drop automatic version checkpoints
    // — the only thing in the store the app made on its own — one at a time,
    // writing the deck that shrank, and retry. The browser does not say how
    // much it would have accepted, so the write itself is the only oracle.
    // Bounded by the number of automatic checkpoints in the store.
    let landed = false
    for (;;) {
      const step = dropOldestCheckpoint(current)
      if (step.removed === 0) break
      current = step.state
      removed += step.removed
      // Write every deck that changed since the last attempt (the one that
      // shrank), then retry the refused key with its current text.
      for (const deck of current.decks) {
        if (nextMap.get(deck.id) !== deck) {
          nextMap.set(deck.id, deck)
          s.write(deckKey(deck.id), JSON.stringify(deck))
        }
      }
      const text = change.deckId ? JSON.stringify(nextMap.get(change.deckId)) : change.text
      if (s.write(change.key, text)) { landed = true; break }
    }
    if (!landed) { ok = false; break }
  }

  if (removed > 0 && ok) {
    cache = { root: nextRoot, decks: nextMap, state: null }
    cache.state = assemble(cache)
    lastRoomMade = removed
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ROOM_MADE_EVENT, { detail: { removed } }))
    }
  }

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

// Another tab writing the same storage: forget what this one read, so the
// next read sees the other tab's work, and say so for anything listening.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || String(e.key).startsWith(KEY)) {
      cache = null
      window.dispatchEvent(new CustomEvent(STORAGE_CHANGED_EVENT))
    }
  })
}

/** Whether the most recent save reached storage. */
export function lastSaveSucceeded() {
  return !persistFailed
}

export const PERSIST_FAILED_EVENT = PERSIST_EVENT
export const ROOM_MADE_EVENT = 'mtg:room-made'
/** Fired when another tab changed this app's storage. */
export const STORAGE_CHANGED_EVENT = 'mtg:storage-changed'

/** How many automatic checkpoints the last save had to drop to fit. */
export function checkpointsDroppedToFit() {
  return lastRoomMade
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
  // Every deck document carries when it last changed. Deck mutators set it;
  // this is the backstop for anything that did not, since a sync between
  // devices has nothing else to go on.
  const stamped = deck.updatedAt ? deck : { ...deck, updatedAt: new Date().toISOString() }
  return update((state) => {
    const decks = state.decks.some((d) => d.id === stamped.id)
      ? state.decks.map((d) => (d.id === stamped.id ? stamped : d))
      : [...state.decks, stamped]
    return { ...state, decks }
  })
}

export function deleteDeck(id) {
  return update((state) => {
    const next = { ...state, decks: state.decks.filter((d) => d.id !== id) }
    // The list's remembered open section goes with the deck.
    if (state.prefs?.deckOpen?.[id] !== undefined) {
      const { [id]: _gone, ...deckOpen } = state.prefs.deckOpen
      next.prefs = { ...state.prefs, deckOpen }
    }
    // So does the first-deck flow's memory of which deck it was building.
    if (state.prefs?.firstDeck?.deckId === id) {
      next.prefs = { ...(next.prefs ?? state.prefs), firstDeck: null }
    }
    return next
  })
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

// --- practice ------------------------------------------------------------

export const PRACTICE_LOG_LIMIT = 400

export function getPractice() {
  return read().practice
}

/** Saves the current run of an exercise: its action log and the coach's side-state. Committed checkpoints only. */
export function savePracticeRun(scenarioId, run) {
  return update((state) => ({
    ...state,
    practice: {
      ...state.practice,
      runs: {
        ...state.practice.runs,
        [scenarioId]: {
          version: run.version ?? 1,
          log: (run.log ?? []).slice(-PRACTICE_LOG_LIMIT),
          hints: run.hints ?? [],
          explained: run.explained ?? null,
          savedAt: run.savedAt ?? new Date().toISOString(),
        },
      },
    },
  }))
}

export function clearPracticeRun(scenarioId) {
  return update((state) => {
    const runs = { ...state.practice.runs }
    delete runs[scenarioId]
    return { ...state, practice: { ...state.practice, runs } }
  })
}

/** Paper practice is self-reported: it is recorded as such and never counts as a demonstration. */
export function markPaperPractice(scenarioId, done = true) {
  return update((state) => {
    const paper = { ...state.practice.paper }
    if (done) paper[scenarioId] = { doneAt: new Date().toISOString(), selfReported: true }
    else delete paper[scenarioId]
    return { ...state, practice: { ...state.practice, paper } }
  })
}

/** Evidence per lesson: viewed, practiced, demonstrated, each with when. Never removed by revisiting. */
export function recordEvidence(lessonId, kind, detail = {}) {
  return update((state) => {
    const current = state.practice.evidence[lessonId] ?? {}
    if (current[kind]) return state
    return {
      ...state,
      practice: { ...state.practice, evidence: { ...state.practice.evidence, [lessonId]: { ...current, [kind]: { at: new Date().toISOString(), ...detail } } } },
    }
  })
}

/** A completed exercise: kept per scenario with the fewest hints seen and the first date. Never removed. */
export function recordCompletion(lessonId, scenarioId, { hints = 0 } = {}) {
  return update((state) => {
    const current = state.practice.evidence[lessonId] ?? {}
    const completions = { ...(current.completions ?? {}) }
    const previous = completions[scenarioId]
    const at = new Date().toISOString()
    completions[scenarioId] = previous ? { hints: Math.min(previous.hints, hints), at: previous.at } : { hints, at }
    const clean = Object.values(completions).filter((c) => c.hints === 0).length
    const next = { ...current, completions, practiced: current.practiced ?? { at } }
    if (clean >= 2 && !next.demonstrated) next.demonstrated = { at }
    return { ...state, practice: { ...state.practice, evidence: { ...state.practice.evidence, [lessonId]: next } } }
  })
}

/** Clears practice progress only. Decks, collection, games, guide and prefs are untouched. */
export function resetPractice() {
  return update((state) => ({ ...state, practice: { runs: {}, paper: {}, evidence: {} } }))
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

export function markExported(at = new Date().toISOString()) {
  return update((state) => ({ ...state, prefs: { ...state.prefs, lastExportedAt: at } }))
}

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
        // A place in the guided game is kept from whichever side has one;
        // this device's own place wins, since it is the one being played.
        tutorialState: state.guide.tutorialState ?? incoming.guide?.tutorialState ?? null,
      },
      practice: mergePractice(state.practice, incoming.practice),
    }
  })
}

/**
 * Practice merges by evidence: a run is kept from whichever side saved it
 * later, paper self-reports and evidence are unioned and never lost, and
 * the earliest date wins for evidence already held on both sides.
 */
function mergePractice(local, incoming) {
  const base = { runs: {}, paper: {}, evidence: {}, ...(local ?? {}) }
  if (!incoming || typeof incoming !== 'object') return base
  const runs = { ...base.runs }
  for (const [id, run] of Object.entries(incoming.runs ?? {})) {
    if (!run || !Array.isArray(run.log)) continue
    const mine = runs[id]
    if (!mine || String(run.savedAt ?? '') > String(mine.savedAt ?? '')) runs[id] = { ...run, log: run.log.slice(-PRACTICE_LOG_LIMIT) }
  }
  const paper = { ...(incoming.paper ?? {}), ...base.paper }
  const evidence = { ...base.evidence }
  for (const [lesson, kinds] of Object.entries(incoming.evidence ?? {})) {
    const mine = evidence[lesson] ?? {}
    const completions = { ...(kinds?.completions ?? {}) }
    for (const [id, c] of Object.entries(mine.completions ?? {})) {
      completions[id] = completions[id] ? { hints: Math.min(completions[id].hints, c.hints), at: [completions[id].at, c.at].sort()[0] } : c
    }
    evidence[lesson] = { ...(kinds ?? {}), ...mine, completions }
  }
  return { runs, paper, evidence }
}

export function clearAll() {
  const s = store()
  for (const key of (s.keys?.() ?? [])) if (key === KEY || key.startsWith(DECK_PREFIX)) s.remove(key)
  s.remove(KEY)
  cache = { root: null, decks: new Map(), state: null }
  cache.state = assemble(cache)
  return { ...EMPTY }
}

export const __EMPTY = EMPTY
