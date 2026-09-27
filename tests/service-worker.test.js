// @vitest-environment node
/**
 * The service worker (public/sw.js) keeps the app's own files and nothing else.
 *
 * Served from the relay (HANDOFF.md, M8), the app shares its origin with the
 * relay's answers — /health, /rooms, /rooms/<code> — and the worker used to cache
 * every same-origin GET and answer it from the cache ever after, so a room's
 * seats, or whether the relay had an engine, stayed as they were the first time
 * they were asked. The worker is run here as a browser runs it, its own file in a
 * context of its own, with a cache and a network that record what they are asked;
 * hosted.spec.mjs holds it to the same in Chromium.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

/** A worker, loaded at `scope`, with a cache and a network of its own. */
function workerAt(scope) {
  const listeners = {}
  const stores = new Map()
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, scope).href
  const storeOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)
    return {
      match: async (request) => store.get(key(request))?.clone(),
      put: async (request, response) => { store.set(key(request), response) },
      addAll: async (list) => { for (const r of list) store.set(key(r), new Response('shell', { headers: { 'content-type': 'text/html' } })) },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (request) => store.delete(key(request)),
    }
  }
  const caches = {
    open: async (name) => storeOf(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (request) => {
      for (const name of stores.keys()) {
        const hit = await storeOf(name).match(request)
        if (hit) return hit
      }
      return undefined
    },
  }
  const fetched = []
  const answers = new Map()
  const fetch = async (request) => {
    const url = key(request)
    fetched.push(url)
    const answer = answers.get(new URL(url).pathname)
    if (!answer) return new Response('not found', { status: 404 })
    return new Response(answer.body, { headers: { 'content-type': answer.type } })
  }
  const self = {
    location: new URL('sw.js', scope),
    registration: { scope },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn },
  }
  const context = vm.createContext({ self, caches, fetch, Response, URL, console })
  vm.runInContext(SOURCE, context, { filename: 'sw.js' })
  /** A request as the page would make it; what the worker did with it. */
  const request = async (path, { mode = 'cors', method = 'GET' } = {}) => {
    let answered = null
    const url = new URL(path, scope).href
    listeners.fetch({ request: { url, method, mode }, respondWith: (p) => { answered = p } })
    const response = answered ? await answered : null
    // A put happens a moment after the answer, as the browser's would.
    await new Promise((r) => setTimeout(r, 0))
    return { intercepted: Boolean(answered), response, body: response ? await response.clone().text() : null }
  }
  return { context, caches, stores, fetched, answers, request, isAppFile: (path, at = scope) => context.isAppFile(new URL(path, scope), at) }
}

const RELAY = 'https://mtg-relay.example.net/'
const PAGES = 'https://someone.github.io/mtg-companion/'

describe('the service worker', () => {
  let worker
  beforeEach(() => {
    worker = workerAt(RELAY)
    worker.answers.set('/health', { body: '{"ok":true,"rooms":0,"engine":true}', type: 'application/json' })
    worker.answers.set('/rooms/ABCDE', { body: '{"code":"ABCDE","seats":[]}', type: 'application/json' })
    worker.answers.set('/assets/index-Ab12Cd.js', { body: 'app', type: 'text/javascript; charset=utf-8' })
    worker.answers.set('/', { body: '<!doctype html>', type: 'text/html; charset=utf-8' })
  })

  it("counts as the app's own only the files the build writes, at the app's own address", () => {
    for (const path of ['index.html', 'assets/index-Ab12Cd.js', 'assets/GameView-DHU5lqIR.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png',
      'mtg-assets/assets/core/art/worlds-hero-768.webp', 'mtg-assets/assets/shared/fonts/cinzel.woff2', 'assets/x.js?v=2']) {
      expect(worker.isAppFile(path), path).toBe(true)
    }
    // What the relay answers has no ending at all, and version.json is to be fetched fresh.
    for (const path of ['health', 'rooms', 'rooms/ABCDE', 'engine/check', 'version.json', '', 'rooms/ABCDE/ws']) {
      expect(worker.isAppFile(path), path || '(the root)').toBe(false)
    }
    // Another origin's, or another folder's on the same one, is not the app's.
    expect(worker.isAppFile('https://elsewhere.example.com/assets/x.js')).toBe(false)
    const pages = workerAt(PAGES)
    expect(pages.isAppFile('assets/index-Ab12Cd.js')).toBe(true)
    expect(pages.isAppFile('https://someone.github.io/another-app/assets/x.js')).toBe(false)
  })

  it("leaves the relay's answers to the network, and keeps none of them", async () => {
    const first = await worker.request('/health')
    expect(first.intercepted).toBe(false)
    const room = await worker.request('/rooms/ABCDE')
    expect(room.intercepted).toBe(false)
    expect(await worker.caches.match(`${RELAY}health`)).toBeUndefined()
    expect(await worker.caches.match(`${RELAY}rooms/ABCDE`)).toBeUndefined()
  })

  it('never answers one of them from a cache, even one an older worker filled', async () => {
    // What the worker before this one would have left behind.
    await (await worker.caches.open('shell-v1')).put(`${RELAY}health`, new Response('{"ok":true,"rooms":0,"engine":false}'))
    const asked = await worker.request('/health')
    expect(asked.intercepted).toBe(false)
  })

  it("keeps the app's own files and answers them from the cache after", async () => {
    const first = await worker.request('/assets/index-Ab12Cd.js')
    expect(first.intercepted).toBe(true)
    expect(first.body).toBe('app')
    expect(worker.fetched).toEqual([`${RELAY}assets/index-Ab12Cd.js`])
    const again = await worker.request('/assets/index-Ab12Cd.js')
    expect(again.body).toBe('app')
    expect(worker.fetched).toHaveLength(1)
  })

  it('leaves version.json to the network', async () => {
    expect((await worker.request('/version.json')).intercepted).toBe(false)
  })

  it('replaces the offline shell with a page, and never with a JSON answer opened in a tab', async () => {
    const shell = async () => (await (await worker.caches.open('shell-v1')).match('./index.html'))?.text()
    const tab = await worker.request('/health', { mode: 'navigate' })
    expect(tab.intercepted).toBe(true)
    expect(tab.body).toBe('{"ok":true,"rooms":0,"engine":true}')
    expect(await shell()).toBeUndefined()
    await worker.request('/', { mode: 'navigate' })
    expect(await shell()).toBe('<!doctype html>')
    await worker.request('/rooms/ABCDE', { mode: 'navigate' })
    expect(await shell()).toBe('<!doctype html>')
  })

  it('still leaves Scryfall\'s API to the app, and keeps its card images', async () => {
    expect((await worker.request('https://api.scryfall.com/cards/named?exact=Opt')).intercepted).toBe(false)
    worker.answers.set('/normal/front/a/b.jpg', { body: 'jpeg', type: 'image/jpeg' })
    const image = await worker.request('https://cards.scryfall.io/normal/front/a/b.jpg')
    expect(image.intercepted).toBe(true)
    expect(await worker.caches.match('https://cards.scryfall.io/normal/front/a/b.jpg')).toBeDefined()
  })

  it('lets a POST past, as it always has', async () => {
    expect((await worker.request('/rooms', { method: 'POST' })).intercepted).toBe(false)
  })
})
