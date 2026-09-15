// Offline shell.
//
// App code is cached on install and served cache-first, so the app opens with
// no connection. Scryfall responses are deliberately NOT cached here — they go
// through IndexedDB in the app, which understands pinning and staleness in a
// way a blind HTTP cache cannot. Card *images* are cached opportunistically,
// since they are immutable once published.

const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const IMAGES = `images-${VERSION}`
const MAX_IMAGES = 400

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

  // Navigations fall back to the cached shell so a reload works offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((r) => r ?? caches.match('./'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(SHELL).then((cache) => cache.put(request, copy))
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

async function trim(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_IMAGES) return
  for (const key of keys.slice(0, keys.length - MAX_IMAGES)) await cache.delete(key)
}
