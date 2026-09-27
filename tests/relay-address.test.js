/**
 * Where the app looks for its relay (src/features/game/relayAddress.js): a
 * person's own address first, then the one the build carries — an address, or
 * `same-origin` for an app the relay serves itself (HANDOFF.md, M8), read as the
 * folder the page came from — and otherwise none.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { relayAddress, setRelayAddress, SAME_ORIGIN } from '../src/features/game/relayAddress.js'

const HOSTED = { origin: 'https://mtg-relay.example.net' }

describe('the relay address', () => {
  beforeEach(() => localStorage.clear())

  it('is none where neither the build nor the person names one', () => {
    expect(relayAddress({ built: undefined, own: undefined, here: HOSTED })).toBeNull()
    expect(relayAddress({ built: '', own: '', here: HOSTED })).toBeNull()
    expect(relayAddress({ built: '   ', own: null, here: HOSTED })).toBeNull()
  })

  it('is the address a build carries, without a trailing slash', () => {
    expect(relayAddress({ built: 'https://relay.example.org/', own: undefined, here: HOSTED })).toBe('https://relay.example.org')
    expect(relayAddress({ built: ' http://localhost:8788 ', own: undefined, here: HOSTED })).toBe('http://localhost:8788')
  })

  it('is the page\'s own origin where the build says same-origin', () => {
    expect(SAME_ORIGIN).toBe('same-origin')
    expect(relayAddress({ built: SAME_ORIGIN, own: undefined, here: HOSTED })).toBe('https://mtg-relay.example.net')
    expect(relayAddress({ built: 'same-origin', own: undefined, here: { origin: 'http://127.0.0.1:8788' } })).toBe('http://127.0.0.1:8788')
  })

  it('reads same-origin forgivingly, as it is typed by hand into a build\'s settings', () => {
    for (const said of ['same-origin', 'SAME-ORIGIN', 'Same-Origin', ' same-origin ', 'same_origin', 'same origin', 'sameorigin', 'same-origin\n']) {
      expect(relayAddress({ built: said, own: undefined, here: HOSTED }), JSON.stringify(said)).toBe('https://mtg-relay.example.net')
    }
    // Not a guess at anything else.
    for (const said of ['same', 'origin', 'same--origin', 'same-origin-please', 'self', '/', 'here']) {
      expect(relayAddress({ built: said, own: undefined, here: HOSTED }), JSON.stringify(said)).toBeNull()
    }
  })

  it('is the folder the page came from, not its origin alone, where a proxy serves the relay under a path', () => {
    // The image serves the app at the root: the page's origin, whichever route the app is on.
    for (const href of ['https://mtg-relay.example.net/', 'https://mtg-relay.example.net/#/game/engine/ABCDE', 'https://mtg-relay.example.net/index.html?x=/a/b#/game']) {
      expect(relayAddress({ built: 'same-origin', own: undefined, here: { origin: 'https://mtg-relay.example.net', href } }), href).toBe('https://mtg-relay.example.net')
    }
    // Behind a proxy that puts the relay's / at /mtg/, the relay's /health is /mtg/health there.
    expect(relayAddress({ built: 'same-origin', own: undefined, here: { origin: 'https://example.org', href: 'https://example.org/mtg/#/game' } })).toBe('https://example.org/mtg')
    expect(relayAddress({ built: 'same-origin', own: undefined, here: { origin: 'https://example.org', href: 'https://example.org/mtg/index.html' } })).toBe('https://example.org/mtg')
    // An address the build or a person names is taken as it is, path and all.
    expect(relayAddress({ built: 'https://example.org/mtg/', own: undefined, here: { origin: 'https://elsewhere.test', href: 'https://elsewhere.test/app/' } })).toBe('https://example.org/mtg')
  })

  it('is none for same-origin where the page has no address of its own', () => {
    // A page opened from a file has the origin "null"; one with no location at all has none.
    expect(relayAddress({ built: 'same-origin', own: undefined, here: { origin: 'null' } })).toBeNull()
    expect(relayAddress({ built: 'same-origin', own: undefined, here: null })).toBeNull()
    expect(relayAddress({ built: 'same-origin', own: undefined, here: { origin: 'file://' } })).toBeNull()
    expect(relayAddress({ built: 'same-origin', own: undefined, here: { origin: 'null', href: 'file:///C:/mtg/dist/index.html' } })).toBeNull()
    expect(relayAddress({ built: 'same-origin', own: undefined, here: { origin: 'null', href: 'about:blank' } })).toBeNull()
  })

  it('lets a person\'s own address win over the build\'s, whichever kind it is', () => {
    expect(relayAddress({ built: 'same-origin', own: 'http://localhost:8788/', here: HOSTED })).toBe('http://localhost:8788')
    expect(relayAddress({ built: 'https://relay.example.org', own: 'http://192.168.1.20:8788', here: HOSTED })).toBe('http://192.168.1.20:8788')
    // And a person may say same-origin themselves.
    expect(relayAddress({ built: 'https://relay.example.org', own: 'same-origin', here: HOSTED })).toBe('https://mtg-relay.example.net')
  })

  it("reads the person's own from their saved settings, as the seats panel's form writes it", () => {
    setRelayAddress('  http://localhost:9000  ')
    expect(relayAddress({ built: 'same-origin', here: HOSTED })).toBe('http://localhost:9000')
    setRelayAddress('')
    expect(relayAddress({ built: 'same-origin', here: HOSTED })).toBe('https://mtg-relay.example.net')
  })

  it('is none for anything that is not a web address', () => {
    expect(relayAddress({ built: 'relay.example.org', own: undefined, here: HOSTED })).toBeNull()
    expect(relayAddress({ built: 'ws://relay.example.org', own: undefined, here: HOSTED })).toBeNull()
    expect(relayAddress({ built: undefined, own: 'javascript:alert(1)', here: HOSTED })).toBeNull()
  })
})
