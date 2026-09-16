// Storage backends.
//
// App state is small and benefits from synchronous reads at first paint, so
// localStorage is the right default today. Putting it behind this interface
// means moving to IndexedDB — if a user ever builds enough decks to approach
// the ~5MB limit — is one swap here rather than a rewrite of every caller.
//
// A backend is: { read(): string|null, write(value: string): boolean, remove(): void }
// It deals in strings only. Serialisation belongs to the caller.

/** localStorage, with every access guarded — private mode throws on access. */
export function localStorageBackend(key) {
  return {
    name: 'localStorage',
    read() {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    write(value) {
      try {
        localStorage.setItem(key, value)
        return true
      } catch {
        // Quota exceeded, or storage disabled. The caller keeps its in-memory
        // copy, so the session continues — it just will not survive a reload.
        return false
      }
    },
    remove() {
      try {
        localStorage.removeItem(key)
      } catch { /* nothing to do */ }
    },
  }
}

/** In-memory only. Used when localStorage is unavailable, and by tests. */
export function memoryBackend(initial = null) {
  let value = initial
  return {
    name: 'memory',
    read: () => value,
    write(next) { value = next; return true },
    remove() { value = null },
  }
}

/**
 * Picks the best backend available. Probes with a real write, because
 * `typeof localStorage !== 'undefined'` is true in Safari private mode right
 * up until the write throws.
 */
export function defaultBackend(key) {
  try {
    const probe = `${key}:probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorageBackend(key)
  } catch {
    return memoryBackend()
  }
}
