import { describe, it, expect } from 'vitest'
import { artUrl, faceCardFor, faceIdFor, setDeckArt, stampFace } from '../src/lib/deck-art.js'

const card = (id, over = {}) => ({ id, name: id, prices: { usd: '1.00' }, image_uris: { art_crop: `art:${id}` }, ...over })
const CARDS = {
  cmdr: card('cmdr'),
  cheap: card('cheap', { prices: { usd: '0.10' } }),
  pricey: card('pricey', { prices: { usd: '40.00' } }),
  noart: card('noart', { image_uris: {}, prices: { usd: '99.00' } }),
  dfc: card('dfc', { image_uris: undefined, card_faces: [{ image_uris: { art_crop: 'art:front' } }, { image_uris: { art_crop: 'art:back' } }] }),
}
const lookup = (id) => CARDS[id]
const deck = (over = {}) => ({ id: 'd', commanders: [], main: [{ cardId: 'cheap', quantity: 1 }, { cardId: 'pricey', quantity: 1 }], ...over })

describe('artUrl', () => {
  it('is the art crop, front face first', () => {
    expect(artUrl(CARDS.cmdr)).toBe('art:cmdr')
    expect(artUrl(CARDS.dfc)).toBe('art:front')
    expect(artUrl(CARDS.noart)).toBeNull()
    expect(artUrl(null)).toBeNull()
  })
})

describe('faceCardFor', () => {
  it('prefers a card the person chose', () => {
    expect(faceCardFor(deck({ artCardId: 'cheap', commanders: ['cmdr'] }), lookup).id).toBe('cheap')
  })
  it('then the commander', () => {
    expect(faceCardFor(deck({ commanders: ['cmdr'] }), lookup).id).toBe('cmdr')
  })
  it('then the costliest card in the list', () => {
    expect(faceCardFor(deck(), lookup).id).toBe('pricey')
  })
  it('then the first card, when nothing is priced', () => {
    const unpriced = (id) => ({ ...CARDS[id], prices: {} })
    expect(faceCardFor(deck(), unpriced).id).toBe('cheap')
  })
  it('skips anything without art at every step rather than showing nothing', () => {
    expect(faceCardFor(deck({ artCardId: 'noart', commanders: ['noart'], main: [{ cardId: 'noart', quantity: 1 }, { cardId: 'cheap', quantity: 1 }] }), lookup).id).toBe('cheap')
  })
  it('treats a card not yet loaded as no art', () => {
    expect(faceCardFor(deck({ commanders: ['unknown'] }), lookup).id).toBe('pricey')
  })
  it('is null for an empty deck', () => {
    expect(faceCardFor(deck({ main: [] }), lookup)).toBeNull()
    expect(faceCardFor(null, lookup)).toBeNull()
  })
  it('weighs price by quantity, as the deck total does', () => {
    const d = deck({ main: [{ cardId: 'cheap', quantity: 1000 }, { cardId: 'pricey', quantity: 1 }] })
    expect(faceCardFor(d, lookup).id).toBe('cheap')
  })
})

describe('faceCardFor, with printings that are not out yet', () => {
  // A fixed day in spoiler season, so the suite means the same after release.
  const NOW = '2026-09-21'
  const PREVIEWS = {
    ...CARDS,
    preorder: card('preorder', { prices: { usd: '60.00' }, released_at: '2026-10-02' }),
    unpriced: card('unpriced', { prices: {}, released_at: '2026-11-13' }),
    out: card('out', { prices: { usd: '2.00' }, released_at: '2026-08-14' }),
    outUnpriced: card('outUnpriced', { prices: {}, released_at: '2026-08-14' }),
  }
  const look = (id) => PREVIEWS[id]
  const main = (...ids) => ids.map((cardId) => ({ cardId, quantity: 1 }))

  it('passes over a costlier card that is not out for the costliest one that is', () => {
    expect(faceCardFor(deck({ main: main('preorder', 'out', 'cheap') }), look, 'usd', NOW).id).toBe('out')
  })
  it('takes the first card that is out when none of those is priced', () => {
    expect(faceCardFor(deck({ main: main('unpriced', 'preorder', 'outUnpriced') }), look, 'usd', NOW).id).toBe('outUnpriced')
  })
  it('takes a card that is not out only when no card with art is', () => {
    expect(faceCardFor(deck({ main: main('unpriced', 'preorder', 'noart') }), look, 'usd', NOW).id).toBe('preorder')
    expect(faceCardFor(deck({ main: main('unpriced') }), look, 'usd', NOW).id).toBe('unpriced')
  })
  it('still honours a chosen card and the commander that are not out', () => {
    const d = deck({ main: main('preorder', 'out') })
    expect(faceCardFor({ ...d, artCardId: 'unpriced' }, look, 'usd', NOW).id).toBe('unpriced')
    expect(faceCardFor({ ...d, commanders: ['preorder'] }, look, 'usd', NOW).id).toBe('preorder')
  })
  it('lets the costliest card lead again on its release day', () => {
    expect(faceCardFor(deck({ main: main('preorder', 'out') }), look, 'usd', '2026-10-02').id).toBe('preorder')
  })
  it('stamps the same answer', () => {
    expect(stampFace(deck({ main: main('preorder', 'out') }), look, 'usd', NOW).faceCardId).toBe('out')
  })
})

describe('faceIdFor, with no cards loaded', () => {
  it('follows the same order using what the deck records', () => {
    expect(faceIdFor(deck({ artCardId: 'a', faceCardId: 'b', commanders: ['c'] }))).toBe('a')
    expect(faceIdFor(deck({ faceCardId: 'b', commanders: ['c'] }))).toBe('b')
    expect(faceIdFor(deck({ commanders: ['c'] }))).toBe('c')
    expect(faceIdFor(deck())).toBe('cheap')
    expect(faceIdFor(deck({ main: [] }))).toBeNull()
  })
})

describe('setDeckArt and stampFace', () => {
  it('chooses, and returns to automatic', () => {
    const chosen = setDeckArt(deck(), 'cheap')
    expect(chosen.artCardId).toBe('cheap')
    expect(chosen.updatedAt).toMatch(/T/)
    expect('artCardId' in setDeckArt(chosen, null)).toBe(false)
  })
  it('records the automatic face, and returns the same object when unchanged', () => {
    const d = deck({ commanders: ['cmdr'] })
    const stamped = stampFace(d, lookup)
    expect(stamped.faceCardId).toBe('cmdr')
    expect(stampFace(stamped, lookup)).toBe(stamped)
  })
  it('drops the record when no card has art any more', () => {
    const stamped = stampFace(deck({ commanders: ['cmdr'] }), lookup)
    const bare = stampFace({ ...stamped, commanders: [], main: [] }, lookup)
    expect('faceCardId' in bare).toBe(false)
  })
})
