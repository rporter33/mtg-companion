// Scryfall's published hard rate limits.
//
// Read from https://scryfall.com/docs/api/rate-limits on 2026-09-20, where
// they are given per endpoint rather than as a single number. They live in
// their own module, apart from the client, because the Node scripts under
// scripts/ need them too and cannot import the client: it reaches for
// IndexedDB through cache.js, which does not exist outside a browser. Six of
// those scripts had drifted to 120ms or 350ms against endpoints with a 500ms
// floor, which is the reason this file exists rather than a constant in each.
//
// Being slower than a limit costs a person nothing they can feel — a search is
// one request, a deck import two — and being faster costs everyone a 429.

/** Two a second: the four endpoints Scryfall names as its expensive ones. */
export const SLOW_INTERVAL_MS = 500

/** Ten a minute. Nothing in this repo asks for the manifest yet. */
export const MANIFEST_INTERVAL_MS = 6000

/** Ten a second: everything else. */
export const MIN_INTERVAL_MS = 100

// How long a 429 shuts an application out, in Scryfall's own words: "Recieving
// an HTTP 429 response will result in your access being limited for 30
// seconds. Continuing to overload the API after this point may result in a
// temporary or permanent ban of your application." Retrying before it is up is
// the overage they are asking us to stop, not a way through it.
export const LOCKOUT_MS = 30_000

const SLOW = /^\/cards\/(search|named|random|collection)(?:[/?]|$)/
const MANIFEST = /^\/cards\/manifest(?:[/?]|$)/

/** How long to leave before a request to this path. */
export function spacingFor(path) {
  if (MANIFEST.test(path)) return MANIFEST_INTERVAL_MS
  return SLOW.test(path) ? SLOW_INTERVAL_MS : MIN_INTERVAL_MS
}
