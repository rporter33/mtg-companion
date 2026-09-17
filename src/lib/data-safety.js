// Keeping a person's data.
//
// There are no accounts. Everything lives in one browser's localStorage, which
// browsers cap at a few megabytes and never say exactly how many. Two things
// follow. The app has to be able to say how much of that it is using and what
// the space is going on, so a full store is a thing someone sees coming. And
// when a write is refused anyway, the app has to have something it can safely
// throw away to make the write fit — rather than losing the change.
//
// THE THING IT CAN THROW AWAY is automatic version checkpoints. They were
// taken by the app, not asked for, they are marked as such, and history is
// the one part of the store that grows on its own. Nothing else is disposable:
// decks are the point, the collection was typed in, and a labelled version was
// a decision.

const bytesOf = (value) => new TextEncoder().encode(JSON.stringify(value ?? null)).length

/**
 * Browsers do not expose the localStorage cap. 5 MB is the common figure and
 * the conservative one; a browser with more headroom simply fails later than
 * this predicts, which is the safe direction to be wrong in.
 */
export const ASSUMED_CAP_BYTES = 5 * 1024 * 1024

/** How much the store holds, and what it is spent on. */
export function storageUsage(state) {
  const decks = state?.decks ?? []
  const versions = decks.flatMap((d) => d.versions ?? [])
  const total = bytesOf(state)

  const sections = {
    decks: bytesOf(decks.map(({ versions: _v, ...rest }) => rest)),
    versions: bytesOf(versions),
    collection: bytesOf(state?.collection ?? {}),
    games: bytesOf(state?.games ?? []),
    guide: bytesOf(state?.guide ?? {}),
    prefs: bytesOf(state?.prefs ?? {}),
  }

  return {
    total,
    cap: ASSUMED_CAP_BYTES,
    fraction: total / ASSUMED_CAP_BYTES,
    sections,
    counts: {
      decks: decks.length,
      versions: versions.length,
      autoVersions: versions.filter((v) => v.auto).length,
      collection: Object.keys(state?.collection ?? {}).length,
      games: (state?.games ?? []).length,
    },
  }
}

export const formatBytes = (n) => (n >= 1024 * 1024
  ? `${(n / (1024 * 1024)).toFixed(2)} MB`
  : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)

/**
 * Drops the single oldest automatic checkpoint anywhere in the store.
 *
 * Never a deck's newest version, whatever kind it is — that is the one a
 * restore relies on. Returns the state unchanged, with removed: 0, when there
 * is nothing it may drop, so a caller can loop on it without a separate test.
 */
export function dropOldestCheckpoint(state) {
  let oldest = null
  for (const deck of state?.decks ?? []) {
    const vs = deck.versions ?? []
    for (let i = vs.length - 1; i >= 1; i--) {
      if (vs[i].auto && (!oldest || vs[i].at < oldest.at)) oldest = { deckId: deck.id, id: vs[i].id, at: vs[i].at }
    }
  }
  if (!oldest) return { state, removed: 0 }
  return {
    state: {
      ...state,
      decks: state.decks.map((d) => (d.id === oldest.deckId
        ? { ...d, versions: d.versions.filter((v) => v.id !== oldest.id) }
        : d)),
    },
    removed: 1,
  }
}

/**
 * Drops automatic checkpoints, oldest first, until the store would fit a
 * size — or until there are none left. Reports what it removed so the app
 * can say so, because silently thinning history is the kind of thing that
 * later reads as data loss.
 *
 * This is for a target you can measure against. When the browser has just
 * refused a write, there is no such number — the write itself is the only
 * oracle — and storage.js loops on dropOldestCheckpoint with a real write
 * between each step instead.
 */
export function makeRoom(state, targetBytes = ASSUMED_CAP_BYTES * 0.9) {
  let current = state
  let removed = 0
  while (bytesOf(current) > targetBytes) {
    const step = dropOldestCheckpoint(current)
    if (step.removed === 0) break
    current = step.state
    removed += step.removed
  }
  return { state: current, removed, fits: bytesOf(current) <= targetBytes }
}

/**
 * Is the backup stale?
 *
 * Compares the newest deck edit to the last export. "Never exported" with
 * decks in the store is the case that matters most; a stale backup with one
 * small change since is not worth a nag.
 */
export function backupStatus(state, now = Date.now()) {
  const decks = state?.decks ?? []
  const last = state?.prefs?.lastExportedAt ? Date.parse(state.prefs.lastExportedAt) : null
  const newestEdit = decks.reduce((t, d) => Math.max(t, Date.parse(d.updatedAt ?? 0) || 0), 0)
  const changedSince = last ? decks.filter((d) => (Date.parse(d.updatedAt ?? 0) || 0) > last).length : decks.length

  if (!decks.length) return { level: 'none', changedSince: 0, last }
  if (!last) return { level: 'never', changedSince, last }
  if (newestEdit <= last) return { level: 'fresh', changedSince: 0, last }
  const days = (now - last) / 86400000
  return { level: changedSince >= 3 || days >= 14 ? 'stale' : 'recent', changedSince, last }
}
