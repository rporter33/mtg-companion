// Storage backends.
//
// App state benefits from synchronous reads at first paint, so localStorage
// is the right default today. Putting it behind this interface means moving
// to IndexedDB, or to a server, is one swap here rather than a rewrite of
// every caller.
//
// A backend is a keyed string store:
//   { name, read(key): string|null, write(key, value): boolean,
//     remove(key): void, keys(): string[] }
// It deals in strings only. Serialisation belongs to the caller. `write`
// returns false rather than throwing when the browser refuses — quota, or
// storage disabled — because the caller has something it can do about that.

/** localStorage, with every access guarded — private mode throws on access. */
export function localStorageBackend(prefix = '') {
  return {
    name: 'localStorage',
    read(key) {
      try { return localStorage.getItem(key) } catch { return null }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, value)
        return true
      } catch {
        // Quota exceeded, or storage disabled. The caller keeps its in-memory
        // copy, so the session continues — it just will not survive a reload.
        return false
      }
    },
    remove(key) {
      try { localStorage.removeItem(key) } catch { /* nothing to do */ }
    },
    keys() {
      try {
        const out = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k !== null && k.startsWith(prefix)) out.push(k)
        }
        return out
      } catch {
        return []
      }
    },
  }
}

/**
 * In-memory only. Used when localStorage is unavailable, and by tests.
 * `initial`, when given, seeds the root document — the one key the old
 * single-blob store had — so a test can start from a file's contents.
 */
export function memoryBackend(initial = null, rootKey = 'mtg-companion:v1') {
  const values = new Map()
  if (initial !== null && initial !== undefined) values.set(rootKey, initial)
  return {
    name: 'memory',
    read: (key) => values.get(key) ?? null,
    write(key, value) { values.set(key, value); return true },
    remove(key) { values.delete(key) },
    keys: () => [...values.keys()],
  }
}

/**
 * Picks the best backend available. Probes with a real write, because
 * `typeof localStorage !== 'undefined'` is true in Safari private mode right
 * up until the write throws.
 */
export function defaultBackend(prefix) {
  try {
    const probe = `${prefix}:probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorageBackend(prefix)
  } catch {
    return memoryBackend()
  }
}
