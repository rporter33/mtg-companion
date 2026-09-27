// Offline shell.
//
// App code is cached on install and served cache-first, so the app opens with
// no connection. Scryfall responses are deliberately NOT cached here — they go
// through IndexedDB in the app, which understands pinning and staleness in a
// way a blind HTTP cache cannot. Card *images* are cached opportunistically,
// since they are immutable once published.
//
// Only the app's own files are this worker's to keep (`isAppFile`). Served from
// the relay (HANDOFF.md, M8), the app shares its origin with everything the relay
// answers — /health, /rooms, /rooms/<code> — and those answers change from one
// second to the next. Cached like a file, the first answer would have been the
// only one this browser ever saw again: a room's seats frozen, a relay that has
// since started an engine still saying it has none.

const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const IMAGES = `images-${VERSION}`
const MAX_IMAGES = 400
// Every deploy adds freshly hashed chunks and nothing ever removed the old
// ones, so the shell cache grew by one build's worth of assets per release.
// Insertion order is oldest first, so trimming drops previous builds.
const MAX_SHELL = 80

// What the build writes, every one of it named with one of these endings: the
// page, its hashed chunks under assets/, the icons, the manifest, and the fonts
// and season art under mtg-assets/. Nothing the relay answers has an ending at
// all. JSON is left out on purpose: the only JSON the app fetches from its own
// origin is version.json, which exists to be fetched fresh.
const APP_FILE = /\.(?:html|js|css|svg|png|webp|jpg|jpeg|gif|ico|webmanifest|woff2)$/i

/**
 * Whether a request is for one of the app's own files: this origin, inside this
 * worker's scope (the folder the app is served from — the root on the relay, a
 * sub-folder on GitHub Pages), and named as a file of the build is.
 */
function isAppFile(url, scope = self.registration?.scope ?? self.location.href) {
  const home = new URL('./', scope)
  if (url.origin !== home.origin || !url.pathname.startsWith(home.pathname)) return false
  if (url.pathname.endsWith('/version.json')) return false
  return APP_FILE.test(url.pathname)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg']))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== IMAGES).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never intercept the API — the app's own cache layer owns that.
  if (url.hostname === 'api.scryfall.com') return

  if (url.hostname.endsWith('scryfall.io')) {
    event.respondWith(cacheFirstImage(request))
    return
  }

  if (url.origin !== self.location.origin) return

  // Navigations go to the network with revalidation — GitHub Pages sends the
  // page with a ten-minute cache, and honouring it meant a reload straight
  // after a deploy brought back the previous build — and a fresh copy replaces
  // the cached shell, so offline serves the newest build this browser has
  // seen. Only with no network at all does the cached shell answer. Only a page
  // replaces it: opened in a tab, the relay's /health is a navigation too, and
  // its JSON kept as the shell would be what the app opened as offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok && /^text\/html\b/i.test(response.headers.get('content-type') ?? '')) {
            const copy = response.clone()
            caches.open(SHELL).then((cache) => cache.put('./index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? caches.match('./'))),
    )
    return
  }

  // Anything of this origin that is not the app's own — the relay's answers,
  // and version.json — goes to the network untouched, never to or from a cache:
  // not even an answer an older worker kept is given back.
  if (!isAppFile(url)) return

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(SHELL).then((cache) => cache.put(request, copy).then(() => trim(cache, MAX_SHELL)))
      }
      return response
    })),
  )
})

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGES)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
      trim(cache)
    }
    return response
  } catch {
    return cached ?? Response.error()
  }
}

async function trim(cache, max = MAX_IMAGES) {
  const keys = await cache.keys()
  if (keys.length <= max) return
  for (const key of keys.slice(0, keys.length - max)) await cache.delete(key)
}
